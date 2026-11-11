// Sends the outbox through Brevo, with a calendar invite on confirmations, and copies staff
// on late changes and alerts.
//
// How an email goes out exactly once:
// 1. claim: in one save, mark up to N unsent emails as "being sent until now + 3 min";
// 2. send them;
// 3. record: in one save, mark each as sent, or count the failure and plan the next try.
// Two senders running at the same time claim different emails. If a sender dies after
// claiming, the claim runs out and the email is picked up again.

import { change, read, type Env } from './store';
import type { Email, Booking, Customer } from '../core/types';
import { Labs } from '../core/engine';
import { DEFAULT_CONFIG } from '../core/config';
import { when } from '../core/time';
import { hmacHex } from './auth';
import { renderEmail, sessionIcs, teamDetails } from './mail';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const plainHtml = (text: string) =>
  `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111;max-width:520px">${esc(text)
    .split('\n\n')
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;

const appUrlOf = (env: Env) => (env.APP_URL || 'https://book.ndure.dk').replace(/\/$/, '');
// Private link to one session's calendar file (for Apple Calendar and others).
export const sessionToken = async (feedSecret: string, bookingId: string) => (await hmacHex(feedSecret, `session:${bookingId}`)).slice(0, 32);

const CLAIM_MS = 3 * 60_000;
const MAX_TRIES = 10; // with the waits below, about 17 hours of trying
const retryWait = (tries: number) => Math.min(2 ** tries, 360) * 60_000; // 2, 4, 8 … minutes, at most 6 hours

export function teamEmails(env: Env): string[] {
  return (env.TEAM_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

async function brevo(env: Env, to: string[], subject: string, text: string, attachment?: { name: string; content: string }, html?: string) {
  if (!env.BREVO_API_KEY) throw new Error('BREVO_API_KEY not set');
  const res = await fetch(`${env.BREVO_API_BASE || 'https://api.brevo.com'}/v3/smtp/email`, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: env.EMAIL_FROM_NAME || 'NDURE Labs', email: env.EMAIL_FROM_ADDRESS || 'labs@ndure.dk' },
      to: to.map((email) => ({ email })),
      subject,
      textContent: text,
      htmlContent: html ?? plainHtml(text),
      ...(attachment ? { attachment: [{ name: attachment.name, content: btoa(attachment.content) }] } : {})
    })
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Sends one email to all staff.
export async function sendStaff(env: Env, subject: string, text: string) {
  const staff = teamEmails(env);
  if (staff.length) await brevo(env, staff, subject, text);
}

type Job = { email: Email; booking?: Booking; customer?: Customer };

// Login codes first: a rider is waiting for those.
const priority = (e: Email) => (e.template === 'login_code' ? 0 : ['payment', 'confirmation', 'rescheduled', 'cancelled'].includes(e.template) ? 1 : 2);

// Sends what is due. `max` keeps each run small (Cloudflare limits outside calls per request).
export async function deliver(env: Env, max: number): Promise<{ sent: number; failed: number }> {
  const now = Date.now();
  const claim = new Date(now + CLAIM_MS).toISOString();

  // Most runs have nothing to send: check with a read before claiming (which writes).
  const peek = await read(env);
  const anyDue =
    peek.db.emails.some((e) => !e.sent && !e.failed && (!e.claimUntil || Date.parse(e.claimUntil) < now) && (!e.nextAt || Date.parse(e.nextAt) <= now)) ||
    peek.db.alerts.some((a) => !a.sent && (a.tries ?? 0) < MAX_TRIES && (!a.claimUntil || Date.parse(a.claimUntil) < now));
  if (!anyDue) return { sent: 0, failed: 0 };

  const work = await change(env, (s) => {
    const due = s.db.emails
      .filter((e) => !e.sent && !e.failed && (!e.claimUntil || Date.parse(e.claimUntil) < now) && (!e.nextAt || Date.parse(e.nextAt) <= now))
      .sort((a, b) => priority(a) - priority(b) || Date.parse(a.at) - Date.parse(b.at))
      .slice(0, max);
    for (const e of due) e.claimUntil = claim;
    const alerts = s.db.alerts.filter((a) => !a.sent && (a.tries ?? 0) < MAX_TRIES && (!a.claimUntil || Date.parse(a.claimUntil) < now)).slice(0, 5);
    for (const a of alerts) a.claimUntil = claim;
    const jobs: Job[] = due.map((e) => {
      const id = e.key.split(':')[1];
      const booking = ['confirmation', 'rescheduled', 'cancelled'].includes(e.template) ? s.db.bookings.find((b) => b.id === id) : undefined;
      return { email: { ...e }, booking, customer: booking ? s.db.customers.find((c) => c.id === booking.customerId) : undefined };
    });
    return { jobs, alerts: alerts.map((a) => ({ ...a })) };
  });
  if (!work.jobs.length && !work.alerts.length) return { sent: 0, failed: 0 };

  const appUrl = appUrlOf(env);
  const from = env.EMAIL_FROM_ADDRESS || 'labs@ndure.dk';
  const results: Record<string, string | null> = {}; // email id → null when sent, else the error
  for (const { email: e, booking: b, customer: c } of work.jobs) {
    const icsUrl = b ? `${appUrl}/calendar/session/${b.id}/${await sessionToken(peek.secrets.feed, b.id)}.ics` : undefined;
    const method = e.template === 'cancelled' ? 'CANCEL' : 'REQUEST';
    try {
      const attach = b ? { name: e.template === 'cancelled' ? 'cancelled.ics' : 'invite.ics', content: sessionIcs(b, { method, to: e.to, from }) } : undefined;
      const out = renderEmail(e, { appUrl, booking: b, icsUrl });
      await brevo(env, [e.to], e.subject, out.text, attach, out.html);
      results[e.id] = null;
    } catch (err) {
      results[e.id] = String(err).slice(0, 300);
      continue;
    }
    // The team calendar gets its own invite for every booking, move and cancel. Best effort.
    if (b && env.TEAM_CALENDAR_EMAIL) {
      const t = teamDetails(b, c);
      t.details = t.details.replace(/https?:\/\/book\.ndure\.dk|book\.ndure\.dk/g, appUrl);
      const cal = env.TEAM_CALENDAR_EMAIL;
      await brevo(env, [cal], `${method === 'CANCEL' ? 'Cancelled' : e.template === 'rescheduled' ? 'Moved' : 'Booked'}: ${t.title}, ${when(b.start)}`, t.details, { name: 'invite.ics', content: sessionIcs(b, { method, to: cal, from, uid: `team-${b.id}`, title: t.title, details: t.details }) }).catch((err) =>
        console.error('Team calendar invite failed', err)
      );
    }
    // Staff hear about changes to sessions in the next 48 hours. Best effort: a failure here
    // must not resend the rider's email.
    if (b && Date.parse(b.start) - now < 48 * 3_600_000) {
      const what = e.template === 'confirmation' ? 'New booking' : e.template === 'rescheduled' ? 'Moved' : 'Cancelled';
      await sendStaff(env, `${what}: ${c?.name ?? 'rider'}, ${when(b.start)}`, `${what}: ${c?.name ?? ''} (${c?.email ?? ''}, ${c?.phone ?? 'no phone'})${b.withPartner ? ` with ${b.partnerName}` : ''}, ${when(b.start)}.`).catch((err) =>
        console.error('Staff copy failed', err)
      );
    }
  }
  const alertResults: Record<string, boolean> = {};
  for (const a of work.alerts) {
    try {
      await sendStaff(env, `NDURE Labs alert: ${a.kind.replace(/_/g, ' ')}`, `${a.text}\n\nSee the team page: ${(env.APP_URL || 'https://book.ndure.dk').replace(/\/$/, '')}/team`);
      alertResults[a.id] = true;
    } catch (err) {
      console.error('Alert failed', err);
      alertResults[a.id] = false;
    }
  }

  let sent = 0;
  let failed = 0;
  await change(env, (s) => {
    const engine = new Labs(s.db, DEFAULT_CONFIG, () => Date.now());
    for (const e of s.db.emails) {
      if (!(e.id in results)) continue;
      delete e.claimUntil;
      const err = results[e.id];
      if (err === null) {
        e.sent = true;
        delete e.error;
        delete e.nextAt;
        sent++;
        continue;
      }
      failed++;
      e.tries = (e.tries ?? 0) + 1;
      e.error = err;
      if (e.template === 'login_code' && e.tries >= 3) e.failed = true; // a code is useless after 10 minutes
      else if (e.tries >= MAX_TRIES) {
        e.failed = true;
        engine.alert('email_failed', `Gave up sending "${e.subject}" to ${e.to} after ${e.tries} tries: ${err}`);
      } else e.nextAt = new Date(Date.now() + retryWait(e.tries)).toISOString();
    }
    for (const a of s.db.alerts) {
      if (!(a.id in alertResults)) continue;
      delete a.claimUntil;
      if (alertResults[a.id]) a.sent = true;
      else a.tries = (a.tries ?? 0) + 1;
    }
  });
  return { sent, failed };
}

// The 07:00 list of today's riders, once a day.
export function dailySummary(todays: ReturnType<Labs['teamDays']>[number]['list']): { subject: string; text: string } {
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' });
  const lines = todays.map((r) => {
    const partner = r.withPartner ? ` + ${r.partnerName}${r.order.partnerConsents ? '' : ' (partner consent missing)'}` : '';
    return `${fmtTime(r.start)}  ${r.customer.name}${partner}, ${r.customer.phone ?? 'no phone'}${r.customer.ftp ? `, FTP ${r.customer.ftp}` : ''}${r.customer.goal ? `, ${r.customer.goal}` : ''}${r.customer.consents?.items.health ? '' : '  (consent missing)'}`;
  });
  return {
    subject: `Today at Labs: ${todays.reduce((n, r) => n + r.seats, 0)} riders`,
    text: `Sessions today, ${when(todays[0].start).split(',')[0]}:\n\n${lines.join('\n')}`
  };
}
