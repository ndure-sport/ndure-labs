// NDURE Labs booking app on Cloudflare Workers.
// Pages are static files in /public (built from /client); everything under /api runs here.

import { Labs, LabsError, quote, CONSENT_TEXT, REQUIRED_CONSENTS } from '../core/engine';
import { DEFAULT_CONFIG, type Config } from '../core/config';
import { cphDate, fmt, when } from '../core/time';
import { change, read, Conflict, type Env, type State } from './store';
import { sign, verify, getCookie, cookie, sixDigits } from './auth';
import { createCheckout, verifyStripe } from './stripe';
import { flush, teamEmails, sendRaw } from './email';

const config: Config = DEFAULT_CONFIG;
const engine = (s: State) => new Labs(s.db, config, () => Date.now());
type Session = { k: 'rider' | 'team'; id: string; exp: number };
const SESSION_DAYS = 30;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const fail = (message: string, status = 400) => json({ error: message }, status);

async function session(env: Env, req: Request, s?: State): Promise<Session | null> {
  const state = s ?? (await read(env));
  return verify<Session>(state.secrets.session, getCookie(req, 'sid'));
}

// After a change: send its emails, then record which went out.
async function deliver(env: Env, ctx: ExecutionContext, minAgeMs = 0) {
  const work = (async () => {
    const snapshot = await read(env);
    const { sent, failed } = await flush(env, snapshot, minAgeMs);
    if (sent.length || Object.keys(failed).length) {
      await change(env, (s) => {
        for (const e of s.db.emails) {
          if (sent.includes(e.id)) e.sent = true;
          if (failed[e.id]) e.error = failed[e.id];
        }
      });
    }
  })().catch((e) => console.error('Email delivery failed', e));
  ctx.waitUntil(work);
}

async function body(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function api(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;
  const appUrl = env.APP_URL.replace(/\/$/, '');

  // Basic protection against other sites posting to our API.
  if (m === 'POST' && p !== '/api/stripe/webhook') {
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) return fail('Not allowed.', 403);
  }

  // ---------- public ----------
  if (m === 'GET' && p === '/api/config') {
    return json({
      currency: env.CURRENCY || 'eur',
      tiers: config.tiers,
      partnerPrice: config.partnerPrice,
      maxQty: config.maxQty,
      validityMonths: config.validityMonths,
      changeDeadlineHours: config.changeDeadlineHours,
      consents: CONSENT_TEXT,
      required: REQUIRED_CONSENTS
    });
  }

  if (m === 'GET' && p === '/api/slots') {
    const need = url.searchParams.get('need') === '2' ? 2 : 1;
    const s = await read(env);
    return json({ need, slots: engine(s).slots(need) });
  }

  if (m === 'POST' && p === '/api/checkout') {
    const b = await body(req);
    const s0 = await read(env);
    const order = await change(env, (s) => engine(s).checkout({ ...b, src: String(b.src || 'web').slice(0, 40) }));
    const customer = (await read(env)).db.customers.find((c) => c.id === order.customerId)!;
    let checkoutUrl: string;
    try {
      checkoutUrl = await createCheckout(env, config, order, customer.email, appUrl);
    } catch (e) {
      console.error(e);
      await change(env, (s) => engine(s).checkoutExpired(order.id));
      // With test keys, show Stripe's own reason so setup problems are easy to fix.
      const key = env.STRIPE_SECRET_KEY || '';
      const testing = !key || key.startsWith('sk_test_') || key.startsWith('rk_test_');
      const reason = !key ? 'STRIPE_SECRET_KEY is not set in Cloudflare.' : String((e as Error).message || e);
      return fail(testing ? `Payment could not be started (test mode): ${reason}` : 'Payment could not be started. Please try again.', 502);
    }
    // Remembers this checkout in this browser, so the rider is logged in when they come back from Stripe.
    const co = await sign(s0.secrets.session, { o: order.id, exp: Date.now() + 2 * 3_600_000 });
    return json({ url: checkoutUrl }, 200, { 'Set-Cookie': cookie('co', co, 7200) });
  }

  if (m === 'POST' && p === '/api/stripe/webhook') {
    const raw = await req.text();
    if (!(await verifyStripe(env, raw, req.headers.get('stripe-signature')))) return new Response('bad signature', { status: 400 });
    const evt = JSON.parse(raw) as { type: string; data: { object: { metadata?: { order_id?: string }; payment_status?: string } } };
    const obj = evt.data.object;
    const orderId = obj.metadata?.order_id;
    if (!orderId) return new Response('ok');
    if ((evt.type === 'checkout.session.completed' && obj.payment_status === 'paid') || evt.type === 'checkout.session.async_payment_succeeded') {
      await change(env, (s) => {
        try {
          engine(s).paid(orderId);
        } catch (e) {
          console.error('paid() refused', orderId, e);
        }
      });
      await deliver(env, ctx);
    }
    if (evt.type === 'checkout.session.expired') await change(env, (s) => engine(s).checkoutExpired(orderId));
    return new Response('ok');
  }

  // ---------- login with an emailed code ----------
  if (m === 'POST' && p === '/api/login/request') {
    const b = await body(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('Fill in a valid email address.');
    const isTeam = teamEmails(env).includes(email) && b.team === true;
    await change(env, (s) => {
      if (isTeam) {
        const code = sixDigits();
        const key = `team:${email}`;
        s.db.codes = s.db.codes.filter((c) => c.email !== key);
        s.db.codes.push({ email: key, code, expiresAt: new Date(Date.now() + config.loginCodeMinutes * 60_000).toISOString(), attempts: 0 });
        s.db.emails.push({ id: `t${Date.now()}`, key: `teamcode:${email}:${Date.now()}`, to: email, template: 'login_code', subject: `NDURE Labs team code: ${code}`, body: `Your team login code is ${code}. It expires in ${config.loginCodeMinutes} minutes.`, at: new Date().toISOString() });
      } else {
        engine(s).requestLogin(email, sixDigits);
      }
    });
    await deliver(env, ctx);
    return json({ ok: true });
  }

  if (m === 'POST' && p === '/api/login/verify') {
    const b = await body(req);
    const email = String(b.email || '').trim().toLowerCase();
    const code = String(b.code || '').trim();
    const team = b.team === true;
    const result = await change(env, (s) => {
      if (team) {
        const key = `team:${email}`;
        const rec = s.db.codes.find((c) => c.email === key);
        if (!rec || Date.parse(rec.expiresAt) <= Date.now()) throw new LabsError('That code has expired. Ask for a new one.', 'code_expired');
        if (rec.attempts >= config.loginMaxAttempts) throw new LabsError('Too many wrong tries. Ask for a new code.', 'code_locked');
        if (rec.code !== code) {
          rec.attempts += 1;
          return { error: 'That code is not right.' };
        }
        s.db.codes = s.db.codes.filter((c) => c !== rec);
        return { session: { k: 'team', id: email } as const, secret: s.secrets.session };
      }
      try {
        const c = engine(s).verifyLogin(email, code);
        return { session: { k: 'rider', id: c.id } as const, secret: s.secrets.session };
      } catch (e) {
        if (e instanceof LabsError && e.code === 'code_wrong') return { error: e.message }; // keep the attempt count
        throw e;
      }
    });
    if ('error' in result) return fail(result.error!, 401);
    const token = await sign(result.secret, { ...result.session, exp: Date.now() + SESSION_DAYS * 86_400_000 });
    return json({ ok: true, role: result.session.k }, 200, { 'Set-Cookie': cookie('sid', token, SESSION_DAYS * 86_400) });
  }

  if (m === 'POST' && p === '/api/logout') {
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('sid', '', 0) });
  }

  // ---------- the rider ----------
  if (p === '/api/me' || p.startsWith('/api/me/')) {
    const s = await read(env);
    let sess = await session(env, req, s);
    let setCookie: string | undefined;
    // Coming back from Stripe in the same browser: log in without a code.
    if (!sess) {
      const co = await verify<{ o: string; exp: number }>(s.secrets.session, getCookie(req, 'co'));
      const order = co ? s.db.orders.find((o) => o.id === co.o) : undefined;
      if (order && (order.status === 'paid' || order.status === 'pending')) {
        sess = { k: 'rider', id: order.customerId, exp: Date.now() + SESSION_DAYS * 86_400_000 };
        setCookie = cookie('sid', await sign(s.secrets.session, sess), SESSION_DAYS * 86_400);
      }
    }
    if (!sess || sess.k !== 'rider') return fail('Please log in.', 401);
    const cid = sess.id;
    const extra: Record<string, string> = setCookie ? { 'Set-Cookie': setCookie } : {};

    if (m === 'GET' && p === '/api/me') {
      const pending = s.db.orders.find((o) => o.customerId === cid && o.id === url.searchParams.get('paid'));
      return json({ ...engine(s).account(cid), pendingOrder: pending ? { status: pending.status, firstStatus: pending.firstStatus, firstStart: pending.firstStart } : null }, 200, extra);
    }
    if (m === 'GET' && p === '/api/me/slots') {
      const e = engine(s);
      const bid = url.searchParams.get('booking') || undefined;
      const existing = bid ? s.db.bookings.find((b) => b.id === bid && b.customerId === cid) : undefined;
      if (bid && !existing) return fail('Session not found.', 404);
      const first = e.balance(cid).orders[0];
      const need = existing ? existing.seats : first && first.partner && !first.partnerUsed ? 2 : 1;
      return json({ need, slots: e.slotsFor(cid, need, { excludeBooking: bid }).filter((x) => !existing || Date.parse(x.start) !== Date.parse(existing.start)) }, 200, extra);
    }
    if (m === 'POST') {
      const b = await body(req);
      await change(env, (st) => {
        const e = engine(st);
        if (p === '/api/me/book') return e.book(cid, String(b.start), { by: 'rider' });
        const own = st.db.bookings.find((x) => x.id === b.bookingId && x.customerId === cid);
        if (!own) throw new LabsError('Session not found.', 'booking');
        if (p === '/api/me/reschedule') return e.reschedule(own.id, String(b.start), 'rider');
        if (p === '/api/me/cancel') return e.cancel(own.id, 'rider');
        throw new LabsError('Unknown action.', 'action');
      });
      await deliver(env, ctx);
      return json(engine(await read(env)).account(cid), 200, extra);
    }
  }

  // ---------- the team ----------
  if (p.startsWith('/api/team')) {
    const s = await read(env);
    const sess = await session(env, req, s);
    if (!sess || sess.k !== 'team' || !teamEmails(env).includes(sess.id)) return fail('Team login required.', 401);
    const view = (st: State) => {
      const e = engine(st);
      return {
        me: sess.id,
        days: e.teamDays(),
        riders: e.customersOverview().map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, balance: c.balance.total, next: c.upcoming[0]?.start ?? null, last: c.past[0]?.start ?? null, lastPaidOrder: c.orders.filter((o) => o.status === 'paid' && !o.free).at(-1)?.id ?? null })),
        closed: st.db.closed,
        calendarUrl: `${appUrl}/calendar/${st.secrets.feed}.ics`,
        emailErrors: st.db.emails.filter((x) => x.error && !x.sent).slice(-10).map((x) => ({ to: x.to, subject: x.subject, error: x.error }))
      };
    };
    if (m === 'GET' && p === '/api/team') return json(view(s));
    if (m === 'GET' && p === '/api/team/slots') {
      const bid = url.searchParams.get('booking') || undefined;
      const bk = bid ? s.db.bookings.find((x) => x.id === bid) : undefined;
      return json({ slots: engine(s).slots(bk ? bk.seats : 1, { excludeBooking: bid, team: true }).filter((x) => !bk || Date.parse(x.start) !== Date.parse(bk.start)) });
    }
    if (m === 'POST' && p === '/api/team/action') {
      const b = await body(req);
      await change(env, (st) => {
        const e = engine(st);
        switch (b.action) {
          case 'attended': return e.markAttendance(b.bookingId, 'attended');
          case 'no_show': return e.markAttendance(b.bookingId, 'no_show');
          case 'cancel': return e.cancel(b.bookingId, 'team', b.returnCredit !== false);
          case 'move': return e.reschedule(b.bookingId, b.start, 'team');
          case 'give': return e.giveSessions({ email: b.email, name: b.name, qty: Math.max(1, Math.min(10, Number(b.qty) || 1)), note: 'team' });
          case 'book': return e.book(b.customerId, b.start, { by: 'team' });
          case 'refund': return e.refund(b.orderId);
          case 'close': return e.closeDay(String(b.date), String(b.reason || ''));
          case 'reopen': st.db.closed = st.db.closed.filter((c) => c.date !== b.date); return null;
          default: throw new LabsError('Unknown action.', 'action');
        }
      });
      await deliver(env, ctx);
      return json(view(await read(env)));
    }
  }

  return fail('Not found.', 404);
}

// Team calendar feed: a private link the team subscribes to in Outlook or Google.
async function calendar(req: Request, env: Env): Promise<Response> {
  const s = await read(env);
  const token = new URL(req.url).pathname.replace('/calendar/', '').replace(/\.ics$/, '');
  if (token !== s.secrets.feed) return new Response('Not found', { status: 404 });
  return new Response(engine(s).calendarFeed(), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const p = new URL(req.url).pathname;
    try {
      if (p.startsWith('/calendar/')) return await calendar(req, env);
      if (p.startsWith('/api/')) return await api(req, env, ctx);
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof LabsError) return fail(e.message, e.code === 'slot_taken' ? 409 : 400);
      if (e instanceof Conflict) return fail(e.message, 503);
      console.error('Unhandled', e);
      return fail('Something went wrong on our side. Nothing was changed. Please try again.', 500);
    }
  },

  // Every hour: automatic emails, expired checkouts, the 07:00 staff summary.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    await change(env, (s) => {
      engine(s).tick();
      // Keep the stored document small: drop bodies of emails older than 60 days.
      const cutoff = Date.now() - 60 * 86_400_000;
      for (const e of s.db.emails) if (Date.parse(e.at) < cutoff) e.body = '';
    });
    const hour = Number(fmt(Date.now(), { hour: '2-digit', hour12: false }));
    const today = cphDate(Date.now());
    const s = await read(env);
    const todays = engine(s).teamDays().flatMap((d) => d.list).filter((r) => cphDate(Date.parse(r.start)) === today && r.status === 'booked');
    if (hour >= 7 && !s.staffSent.includes(today) && todays.length) {
      const lines = todays.map((r) => `${fmt(r.start, { hour: '2-digit', minute: '2-digit' })}  ${r.customer.name}${r.withPartner ? ` + ${r.partnerName}` : ''}, ${r.customer.phone ?? 'no phone'}, FTP ${r.customer.ftp ?? 'n/a'}, ${r.customer.goal ?? ''}${r.customer.consents?.items.health ? '' : '  (consent missing)'}`);
      try {
        for (const t of teamEmails(env)) await sendRaw(env, t, `Today at Labs: ${todays.reduce((n, r) => n + r.seats, 0)} riders`, `Sessions today, ${when(todays[0].start).split(',')[0]}:\n\n${lines.join('\n')}`);
        await change(env, (st) => {
          st.staffSent = [...st.staffSent.slice(-30), today];
        });
      } catch (e) {
        console.error('Staff summary failed', e);
      }
    }
    // Anything not yet sent (older than 2 minutes, so we don't race a request that is sending it now).
    await deliver(env, ctx, 2 * 60_000);
  }
} satisfies ExportedHandler<Env>;
