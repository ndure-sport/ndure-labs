// How NDURE Labs emails look, and the calendar invites that go with them.
// The engine writes plain text (easy to test and to read in any client); this turns it into a
// branded HTML email with buttons, a session card and "add to calendar" links.

import type { Booking, Customer, Email } from '../core/types';
import { fmt } from '../core/time';
import { MEET, MEET_SHORT, MEET_MAPS, PICKUP, PREP, BRING, BRING_SENTENCE, BRING_SHORT, PEDALS, SHOWERS, FORM_URL } from '../core/visit';

const BLUE = '#0008FF';
const PLACE = MEET;
const MAPS = MEET_MAPS;
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
    `DESCRIPTION:${icsEsc(opts.details ?? `Meet at the ${MEET_SHORT}. ${PICKUP} Bring: ${BRING_SHORT} Change or cancel in your NDURE Labs account.`)}`,
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
  const details = encodeURIComponent(`Meet at the ${MEET_SHORT}. Bring: ${BRING_SHORT}`);
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
    ${row('Meet', `<a href="${MAPS}" style="color:#000000">${esc(MEET_SHORT)}</a><br><span style="color:#767676;font-size:13px">${esc(PICKUP.replace(/\.$/, ''))}</span>`)}
    ${row('Bring', `${esc(BRING_SENTENCE)}<br><span style="color:#767676;font-size:13px">${esc(PEDALS)}</span>`)}
    ${b.withPartner && b.partnerName ? row('With', esc(b.partnerName)) : ''}
  </table></td></tr></table>`;
}

// ---------- the day before email ----------
// Same texts as the plain version (they come from core/visit.ts), laid out in blocks: where and
// when, how to prepare, what to bring, then the form and the closing lines.
const LABEL = 'margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#767676';
const list = (items: string[]) => `<ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.5;color:#111111">${items.map((i) => `<li style="margin:0 0 6px;padding-left:2px">${esc(i)}</li>`).join('')}</ul>`;
function reminderBody(paras: string[], formUrl: string | null): string | null {
  const m = paras.join(' ').match(/seeing you (today|tomorrow) at (\d{2}:\d{2})/);
  if (!m || !paras[0]?.startsWith('Hi ')) return null;
  const [, day, time] = m;
  const Day = day[0].toUpperCase() + day.slice(1);
  const form = formUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#E8E9FF;border-radius:16px;margin:28px 0 0"><tr><td style="padding:18px 20px">
      <p style="margin:0 0 12px;font-size:15px;color:#000000"><b>Haven&#39;t filled in the pre session form yet?</b><br>Please do it ${day === 'today' ? 'now' : 'today'}, it takes 4 minutes.</p>
      <a href="${esc(formUrl)}" style="display:inline-block;background:#000000;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:100px">Fill in the pre session form</a>
    </td></tr></table>` : '';
  return `<p style="margin:0 0 8px">${esc(paras[0])}</p>
    <p style="margin:0 0 24px">We&#39;re looking forward to seeing you ${day}.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#F4F4F4;border-radius:16px;margin:0 0 32px"><tr><td style="padding:18px 20px">
      <p style="${LABEL}">Where and when</p>
      <p style="margin:0 0 2px;font-size:17px;font-weight:600;color:#000000">${Day}, ${time}</p>
      <p style="margin:0 0 2px;font-size:15px;color:#000000">${esc(MEET_SHORT)}</p>
      <p style="margin:0 0 12px;font-size:13px;color:#767676">${esc(PICKUP)}</p>
      <a href="${MAPS}" style="font-size:14px;font-weight:600;color:${BLUE};text-decoration:none">Directions →</a>
    </td></tr></table>
    <p style="${LABEL}">Before your session</p>
    <p style="margin:0 0 10px;font-size:15px;color:#111111">For reliable results you can compare next time:</p>
    ${list(PREP)}
    <div style="height:28px"></div>
    <p style="${LABEL}">Please bring</p>
    ${list(BRING)}
    <p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#555555">${esc(PEDALS)} ${esc(SHOWERS)}</p>
    ${form}
    <div style="height:1px;background:#EEEEEE;margin:28px 0 20px"></div>
    <p style="margin:0 0 8px;font-size:15px">If you feel ill, just reply to this email and we&#39;ll move your session.</p>
    <p style="margin:0;font-size:15px">See you ${day}!</p>`;
}

// ---------- the email ----------
export function renderEmail(e: Pick<Email, 'template' | 'subject' | 'body'>, x: { appUrl: string; booking?: Booking; icsUrl?: string }): { html: string; text: string } {
  const appHost = x.appUrl.replace(/^https?:\/\//, '');
  let text = e.body.replace(/book\.ndure\.dk/g, appHost);

  // The stop link moves to the footer.
  let stop = '';
  text = text.replace(/\n\nDon't want these reminders\? Stop them here: (\S+)/, (_, u) => { stop = u; return ''; });

  let paras = text.split('\n\n').map((p) => p.trim()).filter(Boolean);
  // The pre session form becomes a highlighted box with a button instead of a long link.
  let form = '';
  let formUrl: string | null = null;
  const fi = paras.findIndex((p) => p.includes(FORM_URL));
  if (fi >= 0) {
    const url = paras[fi].match(/https:\/\/tally\.so\/r\/\S+/)?.[0] ?? FORM_URL;
    formUrl = url;
    const say = paras[fi].replace(/:?\s*https:\/\/tally\.so\/r\/\S+/, '.').replace(/\.\.$/, '.');
    form = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#E8E9FF;border-radius:16px;margin:8px 0 16px"><tr><td style="padding:16px 20px"><p style="margin:0 0 12px;font-size:15px;color:#000000">${esc(say)}</p>${button(url, 'Fill in the pre session form')}</td></tr></table>`;
    paras.splice(fi, 1);
  }
  // The session card below shows date, place and what to bring: no need to say it twice.
  if (x.booking && e.template === 'confirmation') paras = [`You're booked${x.booking.withPartner && x.booking.partnerName ? `, together with ${x.booking.partnerName}` : ''}. See you in the lab.`, ...paras.slice(1)];
  let body = '';
  if (e.template === 'login_code') {
    const code = e.subject.match(/\d{6}/)?.[0] ?? '';
    body = `<p style="margin:0 0 8px;font-size:15px;color:#555555">Your login code</p><p style="margin:0 0 20px;font-size:40px;font-weight:600;letter-spacing:0.18em;color:#000000">${code}</p>` +
      paras.map((p) => `<p style="margin:0 0 14px;font-size:14px;color:#555555">${esc(p.replace(new RegExp(`(Your (team )?login code is )${code}\\. ?`), ''))}</p>`).join('');
  } else if (e.template === 'reminder' && (body = reminderBody(paras, formUrl) ?? '')) {
    // laid out above
  } else {
    body = paras.map((p) => `<p style="margin:0 0 16px">${linkify(esc(p)).replace(/\n/g, '<br>')}</p>`).join('');
    // In the reminder the form goes right before the last two lines (feeling ill, see you).
    if (form) body = e.template === 'reminder' ? body.replace(/(<p[^>]*>If you feel ill)/, `${form}$1`) : body + form;
  }

  // One clear button per email.
  const account = `${x.appUrl}/account`;
  const partner = text.match(/\S+\/consent\/[\w-]+/)?.[0];
  const cta =
    e.template === 'partner' && partner ? button(partner.startsWith('http') ? partner : `https://${partner}`, 'Give your consent')
    : ['payment', 'confirmation', 'rescheduled', 'cancelled', 'checkin', 'nudge', 'expiry'].includes(e.template) ? button(account, e.template === 'cancelled' || e.template === 'nudge' || e.template === 'checkin' || e.template === 'expiry' ? 'Book a session' : 'Open my account')
    : e.template === 'reminder' && !body.includes('Where and when') ? button(MAPS, 'Directions', false)
    : '';
  const card = x.booking && ['confirmation', 'rescheduled'].includes(e.template) ? sessionCard(x.booking) + (x.icsUrl && e.template !== 'reminder' ? calendarLinks(x.booking, x.icsUrl) : '') : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(e.subject)}</title></head>
<body style="margin:0;padding:0;background:#F4F4F4">
<div style="display:none;max-height:0;overflow:hidden">${esc(paras[0]?.slice(0, 120) ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT}">
  <tr><td style="background:#000000;border-radius:20px 20px 0 0;padding:20px 28px">
    <img src="${esc(x.appUrl)}/img/ndure-logo.png" alt="NDURE" width="40" height="40" style="width:40px;height:40px;border-radius:50%;display:inline-block;vertical-align:middle;border:1px solid #333333"> <span style="color:#FFFFFF;background:${BLUE};font-weight:600;font-size:11px;letter-spacing:0.14em;padding:3px 7px;border-radius:4px">LABS</span>
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

// ---------- the list the team sees on the Emails tab ----------
export type Automation = { template: Email['template']; name: string; when: string; to: string; kind: 'essential' | 'automatic' | 'manual' | 'team' };
export const AUTOMATIONS: Automation[] = [
  { template: 'login_code', name: 'Login code', when: 'When someone asks to log in', to: 'Rider or team member', kind: 'essential' },
  { template: 'payment', name: 'Payment received', when: 'Right after paying', to: 'Rider', kind: 'essential' },
  { template: 'confirmation', name: 'Booking confirmed, with calendar invite', when: 'Right after booking a session', to: 'Rider', kind: 'essential' },
  { template: 'rescheduled', name: 'Session moved, calendar updated', when: 'When the rider or team moves a session', to: 'Rider', kind: 'essential' },
  { template: 'cancelled', name: 'Session cancelled, removed from calendar', when: 'When a session is cancelled, or the picked time filled up during payment', to: 'Rider', kind: 'essential' },
  { template: 'partner', name: 'Training partner consent', when: 'When a rider brings a partner (not offered on the page now)', to: 'Partner', kind: 'essential' },
  { template: 'reminder', name: 'Session reminder', when: 'The day before the session (26 hours before)', to: 'Rider', kind: 'automatic' },
  { template: 'after', name: 'How was your session?', when: '2 days after the session', to: 'Rider', kind: 'automatic' },
  { template: 'nudge', name: 'Check in reminder', when: '4 and 8 weeks after the last session, only if nothing is booked. Has a stop link', to: 'Rider', kind: 'automatic' },
  { template: 'expiry', name: 'Sessions about to expire', when: '30 days before unused sessions expire', to: 'Rider', kind: 'automatic' },
  { template: 'checkin', name: 'Personal check in', when: 'Only when someone on the team presses "Send check in email" (max once per 14 days per rider)', to: 'Rider', kind: 'manual' }
];
export const TEAM_MAILS = [
  'Today at Labs: the day\'s riders with phone, every opening day at 07:00',
  'New booking, move or cancel for a session in the next 48 hours',
  'Alerts: late payments, payments found without webhook, emails failing, automatic emails paused',
  'Team calendar invites for every booking, move and cancel (only if TEAM_CALENDAR_EMAIL is set)'
];

// Login codes never show on the team page.
export const maskCodes = (s: string) => s.replace(/\b\d{6}\b/g, '••••••');
