import 'server-only';
import { appUrl, optionalEnv } from './env';
import { VALID_MONTHS, CHANGE_DEADLINE_HOURS } from './policy';

// Transactional email through Brevo. Booking confirmations, calendar invites,
// reminders and reschedule emails come from Cal.com itself, so we only send
// what Cal.com can't: the order link and the partner consent link.

type Mail = { to: { email: string; name?: string }; subject: string; text: string };

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function toHtml(text: string) {
  const linked = esc(text).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#0A0A0A;max-width:520px">${linked
    .split('\n\n')
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;
}

async function send(mail: Mail): Promise<void> {
  const key = optionalEnv('BREVO_API_KEY');
  if (!key) {
    console.warn(`BREVO_API_KEY not set, email not sent: "${mail.subject}" to ${mail.to.email}`);
    return;
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: {
        name: optionalEnv('EMAIL_FROM_NAME') || 'NDURE Labs',
        email: optionalEnv('EMAIL_FROM_ADDRESS') || 'labs@ndure.dk'
      },
      to: [mail.to],
      subject: mail.subject,
      textContent: mail.text,
      htmlContent: toHtml(mail.text)
    })
  });
  if (!res.ok) console.error('Brevo send failed', res.status, await res.text());
}

export async function sendOrderLink(o: { rider_name: string; rider_email: string; token: string; qty: number }) {
  const first = o.rider_name.split(' ')[0];
  const link = `${appUrl()}/order/${o.token}`;
  const sessions = o.qty === 1 ? 'your session' : `your ${o.qty} sessions`;
  await send({
    to: { email: o.rider_email, name: o.rider_name },
    subject: 'Your NDURE Labs sessions',
    text: `Hi ${first},

Thanks, your payment went through. Use this link to choose a date for ${sessions}, change a date or cancel:
${link}

Keep the link to yourself, it works without a password.

Changes are free up to ${CHANGE_DEADLINE_HOURS} hours before a session. Sessions stay valid for ${VALID_MONTHS} months.

See you at DTU,
NDURE Labs
Diplomvej 376, 2800 Kongens Lyngby`
  });
}

export async function sendPartnerInvite(o: { rider_name: string; partner_name: string; partner_email: string; partner_token: string }) {
  const first = o.partner_name.split(' ')[0];
  await send({
    to: { email: o.partner_email, name: o.partner_name },
    subject: `${o.rider_name} signed you up for NDURE Labs`,
    text: `Hi ${first},

${o.rider_name} booked a lactate session at NDURE Labs and added you as training partner. You ride in the same session.

Before you can ride, please do the short readiness check and give your consent here:
${appUrl()}/consent/${o.partner_token}

${o.rider_name} will choose the date. You'll get a calendar invite once it's set.

NDURE Labs
Diplomvej 376, 2800 Kongens Lyngby`
  });
}
