// NDURE Labs booking app on Cloudflare Workers.
// Pages are static files in /public (built from /client); everything under /api runs here.

import { Labs, LabsError, CONSENT_TEXT, REQUIRED_CONSENTS, cleanEmail, clean, LIMITS } from '../core/engine';
import { DEFAULT_CONFIG, type Config } from '../core/config';
import { cphDate, fmt, when } from '../core/time';
import { change, read, readWithSize, Conflict, type Env, type State } from './store';
import { sign, verify, getCookie, cookie, sixDigits } from './auth';
import { createCheckout, verifyStripe, paidCheckoutOrders } from './stripe';
import { deliver, teamEmails, sendStaff, dailySummary } from './email';

const config: Config = DEFAULT_CONFIG;
const engine = (s: State) => new Labs(s.db, config, () => Date.now());
type Session = { k: 'rider' | 'team'; id: string; v?: number; exp: number };
const RIDER_DAYS = 30;
const TEAM_DAYS = 7;
const MAX_BODY = 10_000; // bytes; no form here comes close
const SIZE_WARN = 1_000_000; // D1 refuses records over 2,000,000 bytes

// Sent with everything the Worker answers. Pages get the same through public/_headers.
const SECURITY: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};

function json(data: unknown, status = 200, cookies: string[] = []) {
  const res = new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY } });
  for (const c of cookies) res.headers.append('Set-Cookie', c);
  return res;
}
const fail = (message: string, status = 400) => json({ error: message }, status);

async function body(req: Request): Promise<Record<string, any>> {
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) throw new LabsError('That request is too large.', 'too_large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new LabsError('That request is too large.', 'too_large');
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

// Per IP limits (approximate, per Cloudflare location). Missing binding: no limit (local tests).
async function allowed(limiter: RateLimit | undefined, key: string) {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch (e) {
    console.error('Rate limiter failed', e);
    return true;
  }
}

// Cloudflare Turnstile, the invisible bot check. Only enforced once its secret is set.
async function human(env: Env, token: unknown, ip: string) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (typeof token !== 'string' || !token || token.length > 4096) return false;
  const f = new FormData();
  f.set('secret', env.TURNSTILE_SECRET_KEY);
  f.set('response', token);
  if (ip) f.set('remoteip', ip);
  try {
    const res = await fetch(`${env.TURNSTILE_API_BASE || 'https://challenges.cloudflare.com'}/turnstile/v0/siteverify`, { method: 'POST', body: f });
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch (e) {
    console.error('Turnstile check failed', e);
    return false;
  }
}

async function riderSession(s: State, req: Request): Promise<Session | null> {
  const sess = await verify<Session>(s.secrets.session, getCookie(req, 'sid'));
  if (!sess || sess.k !== 'rider') return null;
  const c = s.db.customers.find((x) => x.id === sess.id);
  return c && (c.sv ?? 0) === (sess.v ?? 0) ? sess : null;
}

async function teamSession(env: Env, s: State, req: Request): Promise<Session | null> {
  const sess = await verify<Session>(s.secrets.session, getCookie(req, 'sid'));
  if (!sess || sess.k !== 'team' || !teamEmails(env).includes(sess.id)) return null;
  return (s.db.teamSv[sess.id] ?? 0) === (sess.v ?? 0) ? sess : null;
}

const loginCookie = async (s: State, sess: Omit<Session, 'exp'>, daysValid: number) =>
  cookie('sid', await sign(s.secrets.session, { ...sess, exp: Date.now() + daysValid * 86_400_000 }), daysValid * 86_400);

// After a change: send its emails in the background.
function sendSoon(env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(deliver(env, 10).catch((e) => console.error('Email delivery failed', e)));
}

async function api(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;
  const appUrl = env.APP_URL.replace(/\/$/, '');
  const ip = req.headers.get('cf-connecting-ip') || '';

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
      required: REQUIRED_CONSENTS,
      turnstileSiteKey: env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY || null : null
    });
  }

  if (m === 'GET' && p === '/api/health') {
    const s = await read(env);
    const age = s.lastTick ? (Date.now() - Date.parse(s.lastTick)) / 60_000 : null;
    const ok = age !== null && age < 40;
    return json({ ok, lastJob: s.lastTick ?? null, minutesSinceJob: age === null ? null : Math.round(age) }, ok ? 200 : 503);
  }

  if (m === 'GET' && p === '/api/slots') {
    const need = url.searchParams.get('need') === '2' ? 2 : 1;
    const s = await read(env);
    return json({ need, slots: engine(s).slots(need) });
  }

  if (m === 'POST' && p === '/api/checkout') {
    if (!(await allowed(env.RL_CHECKOUT, `checkout:${ip}`))) return fail('Too many attempts from your connection. Wait a minute and try again.', 429);
    const b = await body(req);
    if (!(await human(env, b.turnstile, ip))) return fail('Please complete the check that you are not a robot, then try again.', 403);
    const order = await change(env, (s) => engine(s).checkout(b as any));
    const s1 = await read(env);
    const customer = s1.db.customers.find((c) => c.id === order.customerId)!;
    let checkoutUrl: string;
    try {
      checkoutUrl = await createCheckout(env, config, order, customer.email, appUrl);
    } catch (e) {
      console.error(e);
      await change(env, (s) => engine(s).checkoutExpired(order.id));
      // With test keys, show Stripe's own reason so setup problems are easy to fix.
      const key = env.STRIPE_SECRET_KEY || '';
      const live = /^(sk|rk)_live_/.test(key) && env.ALLOW_LIVE_PAYMENTS === 'yes';
      const reason = !key ? 'STRIPE_SECRET_KEY is not set in Cloudflare.' : String((e as Error).message || e);
      return fail(live ? 'Payment could not be started. Please try again.' : `Payment could not be started (test mode): ${reason}`, 502);
    }
    // Remembers this checkout in this browser. It logs the browser in only once the order is
    // paid, and only for a rider created by this checkout (see /api/me).
    const co = await sign(s1.secrets.session, { o: order.id, exp: Date.now() + 2 * 3_600_000 });
    return json({ url: checkoutUrl }, 200, [cookie('co', co, 7200)]);
  }

  // Status of the checkout this browser started, for the page shown after paying.
  if (m === 'GET' && p === '/api/order-status') {
    const s = await read(env);
    const co = await verify<{ o: string; exp: number }>(s.secrets.session, getCookie(req, 'co'));
    const o = co && co.o === url.searchParams.get('id') ? s.db.orders.find((x) => x.id === co.o) : undefined;
    if (!o) return fail('Not found.', 404);
    return json({ status: o.status, firstStatus: o.firstStatus, firstStart: o.firstStart, newRider: !!o.newCustomer });
  }

  if (m === 'POST' && p === '/api/stripe/webhook') {
    const raw = await req.text();
    if (!(await verifyStripe(env, raw, req.headers.get('stripe-signature')))) return new Response('bad signature', { status: 400 });
    const evt = JSON.parse(raw) as { type: string; data: { object: { metadata?: { order_id?: string }; payment_status?: string; amount_total?: number } } };
    const obj = evt.data.object;
    const orderId = obj.metadata?.order_id;
    if (!orderId) return new Response('ok');
    if ((evt.type === 'checkout.session.completed' && obj.payment_status === 'paid') || evt.type === 'checkout.session.async_payment_succeeded') {
      await change(env, (s) => {
        const e = engine(s);
        try {
          const o = e.paid(orderId);
          e.audit('stripe', 'paid', `${o.id}, ${s.db.customers.find((c) => c.id === o.customerId)?.email}, ${e.money(o.total)}${o.late ? ', late' : ''}`);
        } catch (err) {
          console.error('paid() refused', orderId, err);
          e.alert('payment_problem', `Stripe confirmed a payment for order ${orderId}, but it could not be credited (${(err as Error).message}). Check the payment in Stripe.`);
        }
      });
      sendSoon(env, ctx);
    }
    if (evt.type === 'checkout.session.expired') {
      await change(env, (s) => {
        if (s.db.orders.some((o) => o.id === orderId)) engine(s).checkoutExpired(orderId);
      });
    }
    return new Response('ok');
  }

  // ---------- login with an emailed code ----------
  if (m === 'POST' && p === '/api/login/request') {
    if (!(await allowed(env.RL_LOGIN, `login:${ip}`))) return fail('Too many attempts from your connection. Wait a minute and try again.', 429);
    const b = await body(req);
    if (!(await human(env, b.turnstile, ip))) return fail('Please complete the check that you are not a robot, then try again.', 403);
    const email = cleanEmail(b.email);
    if (!email) return fail('Fill in a valid email address.');
    const team = b.team === true && teamEmails(env).includes(email);
    await change(env, (s) => (team ? engine(s).requestTeamLogin(email, sixDigits) : engine(s).requestLogin(email, sixDigits)));
    sendSoon(env, ctx);
    return json({ ok: true });
  }

  if (m === 'POST' && p === '/api/login/verify') {
    if (!(await allowed(env.RL_LOGIN, `login:${ip}`))) return fail('Too many attempts from your connection. Wait a minute and try again.', 429);
    const b = await body(req);
    const email = cleanEmail(b.email);
    const team = b.team === true;
    if (team && !teamEmails(env).includes(email)) return fail('That code has expired. Ask for a new one.', 401);
    const result = await change(env, (s) => {
      const e = engine(s);
      try {
        if (team) {
          const id = e.verifyTeamLogin(email, String(b.code ?? ''));
          e.audit(id, 'login', 'team');
          return { session: { k: 'team', id, v: s.db.teamSv[id] ?? 0 } as const };
        }
        const c = e.verifyLogin(email, String(b.code ?? ''));
        return { session: { k: 'rider', id: c.id, v: c.sv ?? 0 } as const };
      } catch (err) {
        if (err instanceof LabsError && err.code === 'code_wrong') return { error: err.message }; // keep the attempt count
        throw err;
      }
    });
    if ('error' in result) return fail(result.error!, 401);
    const s = await read(env);
    return json({ ok: true, role: result.session.k }, 200, [await loginCookie(s, result.session, team ? TEAM_DAYS : RIDER_DAYS), cookie('co', '', 0)]);
  }

  if (m === 'POST' && p === '/api/logout') {
    return json({ ok: true }, 200, [cookie('sid', '', 0), cookie('co', '', 0)]);
  }

  // ---------- training partner consent (public, by private link) ----------
  if (p === '/api/partner') {
    if (!(await allowed(env.RL_LOGIN, `partner:${ip}`))) return fail('Too many attempts from your connection. Wait a minute and try again.', 429);
    if (m === 'GET') {
      const s = await read(env);
      return json({ ...engine(s).partnerInvite(url.searchParams.get('t') || ''), consents: CONSENT_TEXT, required: REQUIRED_CONSENTS });
    }
    if (m === 'POST') {
      const b = await body(req);
      await change(env, (s) => {
        const o = engine(s).partnerConsent(String(b.t || ''), { consents: b.consents, phone: b.phone });
        engine(s).audit(`partner:${o.partnerEmail}`, 'partner consent', o.id);
      });
      return json({ ok: true });
    }
  }

  // ---------- the rider ----------
  if (p === '/api/me' || p.startsWith('/api/me/')) {
    const s = await read(env);
    let sess = await riderSession(s, req);
    const cookies: string[] = [];
    // Coming back from Stripe in the same browser as a new rider: log in without a code,
    // but only once the payment is confirmed.
    if (!sess) {
      const co = await verify<{ o: string; exp: number }>(s.secrets.session, getCookie(req, 'co'));
      const order = co ? s.db.orders.find((o) => o.id === co.o) : undefined;
      const c = order ? s.db.customers.find((x) => x.id === order.customerId) : undefined;
      if (order && c && order.status === 'paid' && order.newCustomer) {
        sess = { k: 'rider', id: c.id, v: c.sv ?? 0, exp: 0 };
        cookies.push(await loginCookie(s, sess, RIDER_DAYS), cookie('co', '', 0));
      }
    }
    if (!sess) return fail('Please log in.', 401);
    const cid = sess.id;
    const me = s.db.customers.find((c) => c.id === cid)!;

    if (m === 'GET' && p === '/api/me') {
      const pending = s.db.orders.find((o) => o.customerId === cid && o.id === url.searchParams.get('paid'));
      return json({ ...engine(s).account(cid), pendingOrder: pending ? { status: pending.status, firstStatus: pending.firstStatus, firstStart: pending.firstStart } : null }, 200, cookies);
    }
    if (m === 'GET' && p === '/api/me/slots') {
      const e = engine(s);
      const bid = url.searchParams.get('booking') || undefined;
      const existing = bid ? s.db.bookings.find((b) => b.id === bid && b.customerId === cid) : undefined;
      if (bid && !existing) return fail('Session not found.', 404);
      const first = e.balance(cid).orders[0];
      const need = existing ? existing.seats : first && first.partner && !first.partnerUsed ? 2 : 1;
      return json({ need, slots: e.slotsFor(cid, need, { excludeBooking: bid }).filter((x) => !existing || Date.parse(x.start) !== Date.parse(existing.start)) }, 200, cookies);
    }
    if (m === 'POST' && p === '/api/me/logout-all') {
      await change(env, (st) => {
        const c = st.db.customers.find((x) => x.id === cid);
        if (c) c.sv = (c.sv ?? 0) + 1;
        engine(st).audit(`rider:${me.email}`, 'logout everywhere', '');
      });
      return json({ ok: true }, 200, [cookie('sid', '', 0), cookie('co', '', 0)]);
    }
    if (m === 'POST') {
      const b = await body(req);
      const by = `rider:${me.email}`;
      await change(env, (st) => {
        const e = engine(st);
        const start = clean(b.start, LIMITS.start);
        if (p === '/api/me/book') {
          const bk = e.book(cid, start, { by: 'rider' });
          e.audit(by, 'book', when(bk.start));
          return;
        }
        const own = st.db.bookings.find((x) => x.id === b.bookingId && x.customerId === cid);
        if (!own) throw new LabsError('Session not found.', 'booking');
        const before = when(own.start);
        if (p === '/api/me/reschedule') {
          e.reschedule(own.id, start, 'rider');
          e.audit(by, 'move', `${before} → ${when(own.start)}`);
          return;
        }
        if (p === '/api/me/cancel') {
          e.cancel(own.id, 'rider');
          e.audit(by, 'cancel', before);
          return;
        }
        throw new LabsError('Unknown action.', 'action');
      });
      sendSoon(env, ctx);
      return json(engine(await read(env)).account(cid), 200, cookies);
    }
  }

  // ---------- the team ----------
  if (p.startsWith('/api/team')) {
    const { state: s, bytes } = await readWithSize(env);
    const sess = await teamSession(env, s, req);
    if (!sess) return fail('Team login required.', 401);
    const me = sess.id;
    const view = (st: State, size: number) => {
      const e = engine(st);
      const unsent = st.db.emails.filter((x) => !x.sent && !x.failed);
      return {
        me,
        days: e.teamDays(),
        riders: e.customersOverview().map((c) => ({
          id: c.id, name: c.name, email: c.email, phone: c.phone, balance: c.balance.total,
          next: c.upcoming[0]?.start ?? null, last: c.past[0]?.start ?? null,
          src: st.db.orders.filter((o) => o.customerId === c.id && !o.free).at(0)?.src ?? (st.db.orders.some((o) => o.customerId === c.id && o.free) ? 'team' : null),
          lastPaidOrder: c.orders.filter((o) => o.status === 'paid' && !o.free).at(-1)?.id ?? null
        })),
        closed: st.db.closed,
        calendarUrl: `${appUrl}/calendar/${st.secrets.feed}.ics`,
        emailErrors: st.db.emails.filter((x) => x.error && !x.sent).slice(-10).map((x) => ({ to: x.to, subject: x.subject, error: x.error, gaveUp: !!x.failed })),
        status: {
          bytes: size,
          limit: 2_000_000,
          lastJob: st.lastTick ?? null,
          emailsWaiting: unsent.length,
          emailsToday: st.db.emails.filter((x) => x.sent && cphDate(Date.parse(x.at)) === cphDate(Date.now())).length,
          riders: st.db.customers.length,
          openCheckouts: st.db.orders.filter((o) => o.status === 'pending').length
        },
        alerts: st.db.alerts.slice(-20).reverse().map((a) => ({ at: a.at, kind: a.kind, text: a.text })),
        audit: st.db.audit.slice(-50).reverse()
      };
    };
    if (m === 'GET' && p === '/api/team') return json(view(s, bytes));
    if (m === 'GET' && p === '/api/team/slots') {
      const bid = url.searchParams.get('booking') || undefined;
      const bk = bid ? s.db.bookings.find((x) => x.id === bid) : undefined;
      return json({ slots: engine(s).slots(bk ? bk.seats : 1, { excludeBooking: bid, team: true }).filter((x) => !bk || Date.parse(x.start) !== Date.parse(bk.start)) });
    }
    if (m === 'POST' && p === '/api/team/logout-all') {
      await change(env, (st) => {
        st.db.teamSv[me] = (st.db.teamSv[me] ?? 0) + 1;
        engine(st).audit(me, 'logout everywhere', '');
      });
      return json({ ok: true }, 200, [cookie('sid', '', 0)]);
    }
    if (m === 'POST' && p === '/api/team/action') {
      const b = await body(req);
      await change(env, (st) => {
        const e = engine(st);
        const who = (id: string) => {
          const bk = st.db.bookings.find((x) => x.id === id);
          const c = bk && st.db.customers.find((x) => x.id === bk.customerId);
          return bk ? `${c?.name ?? ''}, ${when(bk.start)}` : id;
        };
        const bookingId = clean(b.bookingId, 40);
        const start = clean(b.start, LIMITS.start);
        switch (b.action) {
          case 'attended': e.markAttendance(bookingId, 'attended'); return e.audit(me, 'attended', who(bookingId));
          case 'no_show': e.markAttendance(bookingId, 'no_show'); return e.audit(me, 'no show', who(bookingId));
          case 'cancel': {
            const d = who(bookingId);
            e.cancel(bookingId, 'team', b.returnCredit !== false);
            return e.audit(me, b.returnCredit !== false ? 'cancel, session back' : 'cancel, session used', d);
          }
          case 'move': {
            const d = who(bookingId);
            e.reschedule(bookingId, start, 'team');
            return e.audit(me, 'move', `${d} → ${when(start)}`);
          }
          case 'give': {
            const qty = Math.max(1, Math.min(10, Math.trunc(Number(b.qty)) || 1));
            const o = e.giveSessions({ email: String(b.email ?? ''), name: String(b.name ?? ''), qty, note: 'team' });
            return e.audit(me, 'give sessions', `${qty} to ${st.db.customers.find((c) => c.id === o.customerId)?.email}`);
          }
          case 'book': {
            const bk = e.book(clean(b.customerId, 40), start, { by: 'team' });
            return e.audit(me, 'book', who(bk.id));
          }
          case 'refund': {
            const o = e.refund(clean(b.orderId, 40));
            return e.audit(me, 'close order', `${o.id}, ${st.db.customers.find((c) => c.id === o.customerId)?.email}, ${e.money(o.total)}`);
          }
          case 'close': {
            e.closeDay(String(b.date ?? ''), String(b.reason ?? ''));
            return e.audit(me, 'close day', clean(b.date, 10));
          }
          case 'reopen': {
            const d = clean(b.date, 10);
            st.db.closed = st.db.closed.filter((c) => c.date !== d);
            return e.audit(me, 'reopen day', d);
          }
          default:
            throw new LabsError('Unknown action.', 'action');
        }
      });
      sendSoon(env, ctx);
      const after = await readWithSize(env);
      return json(view(after.state, after.bytes));
    }
  }

  return fail('Not found.', 404);
}

// Team calendar feed: a private link the team subscribes to in Outlook or Google.
async function calendar(req: Request, env: Env): Promise<Response> {
  const s = await read(env);
  const token = new URL(req.url).pathname.replace('/calendar/', '').replace(/\.ics$/, '');
  if (token !== s.secrets.feed) return new Response('Not found', { status: 404, headers: SECURITY });
  return new Response(engine(s).calendarFeed(), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY } });
}

// Payments Stripe has that we have not credited (a webhook that never arrived). One Stripe call per run.
async function reconcile(env: Env) {
  const ids = await paidCheckoutOrders(env, Math.floor(Date.now() / 1000) - 3 * 86_400);
  if (!ids.length) return;
  await change(env, (s) => {
    const e = engine(s);
    for (const id of ids) {
      const o = s.db.orders.find((x) => x.id === id);
      if (!o || o.status === 'paid' || o.status === 'refunded') continue;
      try {
        e.paid(id);
        e.audit('system', 'paid (found by payment check)', id);
        e.alert('payment_found', `A paid order was missing and has now been credited: ${id}. The Stripe webhook did not arrive; check its status in Stripe.`);
      } catch (err) {
        e.alert('payment_problem', `Stripe has a payment for order ${id}, but it could not be credited (${(err as Error).message}).`);
      }
    }
  });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const p = new URL(req.url).pathname;
    try {
      if (p.startsWith('/calendar/')) return await calendar(req, env);
      if (p.startsWith('/api/')) return await api(req, env, ctx);
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof LabsError) {
        const status = e.code === 'slot_taken' ? 409 : e.code === 'too_large' ? 413 : e.code === 'rate' || e.code === 'locked' ? 429 : 400;
        return fail(e.message, status);
      }
      if (e instanceof Conflict) return fail(e.message, 503);
      console.error('Unhandled', e);
      return fail('Something went wrong on our side. Nothing was changed. Please try again.', 500);
    }
  },

  // Every 15 minutes: automatic emails, expired checkouts, cleanup, the 07:00 staff summary,
  // the payment check and alerts.
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const steps: [string, () => Promise<unknown>][] = [
      ['tick', async () => {
        const { bytes } = await readWithSize(env);
        await change(env, (s) => {
          engine(s).tick();
          s.lastTick = new Date().toISOString();
          const today = cphDate(Date.now());
          if (bytes > SIZE_WARN && s.sizeWarned !== today) {
            s.sizeWarned = today;
            engine(s).alert('data_size', `The stored data is ${Math.round(bytes / 1000)} KB. The hard limit is 2,000 KB. Time to move to separate tables.`);
          }
        });
      }],
      ['summary', async () => {
        const hour = Number(fmt(Date.now(), { hour: '2-digit', hour12: false }));
        const today = cphDate(Date.now());
        const s = await read(env);
        if (hour < 7 || s.staffSent.includes(today)) return;
        const todays = engine(s).teamDays().flatMap((d) => d.list).filter((r) => cphDate(Date.parse(r.start)) === today && r.status === 'booked');
        if (!todays.length) return;
        const { subject, text } = dailySummary(todays);
        await sendStaff(env, subject, text);
        await change(env, (st) => {
          st.staffSent = [...st.staffSent.slice(-30), today];
        });
      }],
      ['reconcile', () => reconcile(env)],
      ['emails', () => deliver(env, 15)]
    ];
    // Each step runs even if an earlier one fails.
    for (const [name, step] of steps) {
      try {
        await step();
      } catch (e) {
        console.error(`Scheduled step ${name} failed`, e);
      }
    }
  }
} satisfies ExportedHandler<Env>;
