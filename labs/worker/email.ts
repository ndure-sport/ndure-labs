// Sends the engine's outbox through Brevo, with a calendar invite on confirmations,
// and copies staff on late changes.

import type { Env, State } from './store';
import type { Email, Booking } from '../core/types';
import { when } from '../core/time';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const html = (text: string) =>
  `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111;max-width:520px">${esc(text)
    .split('\n\n')
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;

export function teamEmails(env: Env): string[] {
  return (env.TEAM_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

function ics(b: Booking, cancelled = false): string {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NDURE Labs//Bookings//EN', `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT', `UID:${b.id}@book.ndure.dk`, `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(b.start)}`, `DTEND:${stamp(b.end)}`, 'SUMMARY:NDURE Labs lactate session',
    'LOCATION:Diplomvej 376\\, 2800 Kongens Lyngby', `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
}

async function brevo(env: Env, to: string, subject: string, text: string, attachment?: { name: string; content: string }) {
  if (!env.BREVO_API_KEY) throw new Error('BREVO_API_KEY not set');
  const res = await fetch(`${env.BREVO_API_BASE || 'https://api.brevo.com'}/v3/smtp/email`, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: env.EMAIL_FROM_NAME || 'NDURE Labs', email: env.EMAIL_FROM_ADDRESS || 'labs@ndure.dk' },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html(text),
      ...(attachment ? { attachment: [{ name: attachment.name, content: btoa(attachment.content) }] } : {})
    })
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function bookingFor(state: State, e: Email): Booking | undefined {
  const id = e.key.split(':')[1];
  return state.db.bookings.find((b) => b.id === id);
}

// Sends everything not yet sent (older than `minAgeMs`, so a request and the hourly job
// don't send the same email twice). Returns ids that went out.
export async function flush(env: Env, state: State, minAgeMs = 0): Promise<{ sent: string[]; failed: Record<string, string> }> {
  const sent: string[] = [];
  const failed: Record<string, string> = {};
  const now = Date.now();
  const staff = teamEmails(env);
  for (const e of state.db.emails) {
    if (e.sent || now - Date.parse(e.at) < minAgeMs) continue;
    try {
      const b = ['confirmation', 'rescheduled', 'cancelled'].includes(e.template) ? bookingFor(state, e) : undefined;
      const attach = b && e.template !== 'cancelled' ? { name: 'ndure-labs-session.ics', content: ics(b) } : undefined;
      const body = e.body.replace(/book\.ndure\.dk/g, env.APP_URL.replace(/^https?:\/\//, ''));
      await brevo(env, e.to, e.subject, body, attach);
      // Staff hear about changes to sessions in the next 48 hours.
      if (b && Date.parse(b.start) - now < 48 * 3_600_000 && staff.length) {
        const c = state.db.customers.find((x) => x.id === b.customerId);
        const what = e.template === 'confirmation' ? 'New booking' : e.template === 'rescheduled' ? 'Moved' : 'Cancelled';
        for (const s of staff) await brevo(env, s, `${what}: ${c?.name ?? 'rider'}, ${when(b.start)}`, `${what}: ${c?.name ?? ''} (${c?.email ?? ''}, ${c?.phone ?? 'no phone'})${b.withPartner ? ` with ${b.partnerName}` : ''}, ${when(b.start)}.`);
      }
      sent.push(e.id);
    } catch (err) {
      failed[e.id] = String(err).slice(0, 300);
    }
  }
  return { sent, failed };
}

export async function sendRaw(env: Env, to: string, subject: string, text: string) {
  await brevo(env, to, subject, text);
}
