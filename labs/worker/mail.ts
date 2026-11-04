// How NDURE Labs emails look, and the calendar invites that go with them.
// The engine writes plain text (easy to test and to read in any client); this turns it into a
// branded HTML email with buttons, a session card and "add to calendar" links.

import type { Booking, Customer, Email } from '../core/types';
import { fmt } from '../core/time';

const BLUE = '#0008FF';
const PLACE = 'NDURE Lab, Diplomvej 376, 2800 Kongens Lyngby';
const MAPS = 'https://maps.google.com/?q=Diplomvej+376,+2800+Kongens+Lyngby';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const linkify = (escaped: string) => escaped.replace(/\b((?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\/[^\s<]*[^\s<.,)])/gi, (u) => `<a href="${u.startsWith('http') ? u : `https://${u}`}" style="color:${BLUE}">${u.replace(/^https?:\/\//, '')}</a>`);

const button = (href: string, label: string, dark = true) =>
  `<a href="${esc(href)}" style="display:inline-block;background:${dark ? '#000000' : '#FFFFFF'};color:${dark ? '#FFFFFF' : '#000000'};border:1px solid ${dark ? '#000000' : '#CCCCCC'};text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:100px;margin:0 8px 8px 0">${esc(label)}</a>`;

// ---------- calendar ----------
const stamp = (iso: string | number) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsEsc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');

// One session as a calendar file. REQUEST makes Outlook and Gmail treat it as an invite (it lands
// in the calendar); CANCEL with the same UID removes it again. SEQUENCE grows with every change.
export function sessionIcs(b: Booking, opts: { method: 'REQUEST' | 'CANCEL' | 'PUBLISH'; to?: string; from: string; uid?: string; title?: string; details?: string }): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NDURE Labs//Bookings//EN', `METHOD:${opts.method}`,
    'BEGIN:VEVENT',
    `UID:${opts.uid ?? b.id}@book.ndure.dk`,
    `SEQUENCE:${Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60_000)}`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(b.start)}`, `DTEND:${stamp(b.end)}`,
    `SUMMARY:${icsEsc(opts.title ?? 'NDURE Labs lactate session')}`,
    `LOCATION:${icsEsc(PLACE)}`,
    `DESCRIPTION:${icsEsc(opts.details ?? 'Bring cycling shoes, pedals, kit and a bottle. Change or cancel in your NDURE Labs account.')}`,
    ...(opts.method !== 'PUBLISH' ? [`ORGANIZER;CN=NDURE Labs:mailto:${opts.from}`] : []),
    ...(opts.method !== 'PUBLISH' && opts.to ? [`ATTENDEE;CN=${icsEsc(opts.to)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${opts.to}`] : []),
    `STATUS:${opts.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(opts.method === 'CANCEL' ? [] : ['BEGIN:VALARM', 'TRIGGER:-PT12H', 'ACTION:DISPLAY', 'DESCRIPTION:NDURE Labs session tomorrow', 'END:VALARM']),
    'END:VEVENT', 'END:VCALENDAR'
  ];
  // Lines over 75 bytes must be folded.
  return lines.map((l) => (l.length <= 74 ? l : l.match(/.{1,73}/g)!.join('\r\n '))).join('\r\n') + '\r\n';
}

function calendarLinks(b: Booking, icsUrl: string) {
  const title = encodeURIComponent('NDURE Labs lactate session');
  const loc = encodeURIComponent(PLACE);
  const details = encodeURIComponent('Bring cycling shoes, pedals, kit and a bottle.');
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${stamp(b.start)}/${stamp(b.end)}&location=${loc}&details=${details}`;
  const outlook = (host: string) => `https://${host}/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=${title}&startdt=${encodeURIComponent(new Date(b.start).toISOString())}&enddt=${encodeURIComponent(new Date(b.end).toISOString())}&location=${loc}&body=${details}`;
  const link = (href: string, label: string) => `<a href="${esc(href)}" style="color:${BLUE};font-weight:600;text-decoration:none;margin-right:16px;white-space:nowrap">${label}</a>`;
  return `<p style="margin:16px 0 0;font-size:13px;color:#555555">Add to calendar: ${link(outlook('outlook.office.com'), 'Outlook')}${link(outlook('outlook.live.com'), 'Outlook.com')}${link(google, 'Google')}${link(icsUrl, 'Apple / other')}</p>`;
}

function sessionCard(b: Booking) {
  const row = (k: string, v: string) => `<tr><td style="padding:6px 16px 6px 0;color:#767676;font-size:13px;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 0;font-size:15px;color:#000000">${v}</td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#F4F4F4;border-radius:16px;padding:16px 20px;margin:4px 0 8px"><tr><td>
  <table role="presentation" cellpadding="0" cellspacing="0">
    ${row('When', `<b>${esc(fmt(b.start, { weekday: 'long', day: 'numeric', month: 'long' }))}</b>, ${esc(fmt(b.start, { hour: '2-digit', minute: '2-digit' }))} to ${esc(fmt(b.end, { hour: '2-digit', minute: '2-digit' }))}`)}
    ${row('Where', `<a href="${MAPS}" style="color:#000000">Diplomvej 376, Kongens Lyngby</a><br><span style="color:#767676;font-size:13px">DTU campus</span>`)}
    ${row('Bring', 'Cycling shoes and pedals, kit, a bottle')}
    ${b.withPartner && b.partnerName ? row('With', esc(b.partnerName)) : ''}
  </table></td></tr></table>`;
}

// ---------- the email ----------
export function renderEmail(e: Pick<Email, 'template' | 'subject' | 'body'>, x: { appUrl: string; booking?: Booking; icsUrl?: string }): { html: string; text: string } {
  const appHost = x.appUrl.replace(/^https?:\/\//, '');
  let text = e.body.replace(/book\.ndure\.dk/g, appHost);

  // The stop link moves to the footer.
  let stop = '';
  text = text.replace(/\n\nDon't want these reminders\? Stop them here: (\S+)/, (_, u) => { stop = u; return ''; });

  let paras = text.split('\n\n').map((p) => p.trim()).filter(Boolean);
  // The session card below shows date, place and what to bring: no need to say it twice.
  if (x.booking && e.template === 'confirmation') paras = [`You're booked${x.booking.withPartner && x.booking.partnerName ? `, together with ${x.booking.partnerName}` : ''}. See you in the lab.`, ...paras.slice(1)];
  let body = '';
  if (e.template === 'login_code') {
    const code = e.subject.match(/\d{6}/)?.[0] ?? '';
    body = `<p style="margin:0 0 8px;font-size:15px;color:#555555">Your login code</p><p style="margin:0 0 20px;font-size:40px;font-weight:600;letter-spacing:0.18em;color:#000000">${code}</p>` +
      paras.map((p) => `<p style="margin:0 0 14px;font-size:14px;color:#555555">${esc(p.replace(new RegExp(`(Your (team )?login code is )${code}\\. ?`), ''))}</p>`).join('');
  } else {
    body = paras.map((p) => `<p style="margin:0 0 16px">${linkify(esc(p)).replace(/\n/g, '<br>')}</p>`).join('');
  }

  // One clear button per email.
  const account = `${x.appUrl}/account`;
  const partner = text.match(/\S+\/consent\/[\w-]+/)?.[0];
  const cta =
    e.template === 'partner' && partner ? button(partner.startsWith('http') ? partner : `https://${partner}`, 'Give your consent')
    : ['payment', 'confirmation', 'rescheduled', 'cancelled', 'checkin', 'nudge', 'expiry'].includes(e.template) ? button(account, e.template === 'cancelled' || e.template === 'nudge' || e.template === 'checkin' || e.template === 'expiry' ? 'Book a session' : 'Open my account')
    : e.template === 'reminder' ? button(MAPS, 'Directions', false)
    : '';
  const card = x.booking && ['confirmation', 'rescheduled', 'reminder'].includes(e.template) ? sessionCard(x.booking) + (x.icsUrl && e.template !== 'reminder' ? calendarLinks(x.booking, x.icsUrl) : '') : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(e.subject)}</title></head>
<body style="margin:0;padding:0;background:#F4F4F4">
<div style="display:none;max-height:0;overflow:hidden">${esc(paras[0]?.slice(0, 120) ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT}">
  <tr><td style="background:#000000;border-radius:20px 20px 0 0;padding:20px 28px">
    <span style="color:#FFFFFF;font-weight:700;font-size:16px;letter-spacing:0.02em">NDURE</span> <span style="color:#FFFFFF;background:${BLUE};font-weight:600;font-size:11px;letter-spacing:0.14em;padding:3px 7px;border-radius:4px">LABS</span>
  </td></tr>
  <tr><td style="background:#FFFFFF;padding:32px 28px 28px;border-radius:0 0 20px 20px;color:#111111;font-size:16px;line-height:1.55">
    ${e.template === 'login_code' ? '' : `<h1 style="margin:0 0 20px;font-size:26px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:#000000">${esc(e.subject)}</h1>`}
    ${body}
    ${card}
    ${cta ? `<div style="margin-top:24px">${cta}</div>` : ''}
  </td></tr>
  <tr><td style="padding:20px 28px;font-size:12px;line-height:1.6;color:#767676">
    NDURE Labs · Diplomvej 376, 2800 Kongens Lyngby · <a href="mailto:contact@ndure.dk" style="color:#767676">contact@ndure.dk</a><br>
    Questions? Just reply to this email.${stop ? `<br><a href="${esc(stop.startsWith('http') ? stop : `https://${stop}`)}" style="color:#767676">Stop reminder emails</a>` : ''}
  </td></tr>
</table></td></tr></table></body></html>`;

  return { html, text: text + (stop ? `\n\nStop reminder emails: ${stop}` : '') + '\n\nNDURE Labs, Diplomvej 376, 2800 Kongens Lyngby. contact@ndure.dk' };
}

// The team's calendar copy of a session: who is coming, how to reach them.
export function teamDetails(b: Booking, c: Customer | undefined): { title: string; details: string } {
  return {
    title: `Labs: ${c?.name ?? 'rider'}${b.withPartner && b.partnerName ? ` + ${b.partnerName}` : ''}`,
    details: [`${c?.name ?? ''} ${c?.phone ? `· ${c.phone}` : ''}`, c?.email ?? '', c?.ftp ? `FTP ${c.ftp} W` : '', c?.goal ? `Goal: ${c.goal}` : '', b.withPartner ? `Partner: ${b.partnerName}` : '', 'Team page: book.ndure.dk/team'].filter(Boolean).join('\n')
  };
}
