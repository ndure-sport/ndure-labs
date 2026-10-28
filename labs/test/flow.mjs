// End-to-end checks against a local worker with fake Stripe, Brevo and Turnstile.
import crypto from 'node:crypto';
import fs from 'node:fs';
const B = 'http://localhost:8787', MOCK = 'http://127.0.0.1:8788', LOG = process.argv[2];
const run = Date.now().toString(36);
let fails = 0;
const ok = (label, cond, info = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${info ? '  ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ipN = 1;
const net = Math.floor(Math.random() * 200) + 20;
const who = () => ({ jar: {}, ip: `10.${net}.${Math.floor(ipN / 250)}.${ipN++ % 250}` });

async function call(path, body, u = who(), extra = {}) {
  const res = await fetch(B + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': u.ip, cookie: Object.entries(u.jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; '), ...extra },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });
  for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); u.jar[k] = v.join('='); }
  const t = await res.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: res.status, d, headers: res.headers };
}
const emails = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter((x) => x.email).map((x) => x.email);
const lastEmail = (to) => emails().filter((e) => e.to.split(',').includes(to)).at(-1);
async function webhook(orderId, type = 'checkout.session.completed', payment_status = 'paid') {
  const body = JSON.stringify({ type, data: { object: { metadata: { order_id: orderId }, payment_status } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_localtest').update(`${t}.${body}`).digest('hex');
  return (await fetch(B + '/api/stripe/webhook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${sig}` } })).status;
}
const scheduled = () => fetch(`${B}/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*`).then((r) => r.status);
const ctl = (j) => fetch(`${MOCK}/__ctl`, { method: 'POST', body: JSON.stringify(j) });
const C = { ready: true, health: true, terms: true };
const H = 'human-ok';
const orderOf = (r) => r.d.url.split('/').pop();
const checkout = (u, extra) => call('/api/checkout', { qty: 1, partner: false, consents: C, turnstile: H, ...extra }, u);

// Free sessions at least 3 days out (so riders may still change them).
const free = (await call('/api/slots')).d.slots.filter((s) => Date.parse(s.start) > Date.now() + 3 * 86400000);
const pm = free.filter((s) => s.label === 'Afternoon');
const am = free.filter((s) => s.label === 'Morning' && s.free === 2);

console.log('\n-- sign up and payment');
const A = who();
const emailA = `a-${run}@test.dk`;
ok('checkout without the bot check is refused', (await checkout(A, { qty: 5, start: pm[0].start, name: 'Anna Rider', email: emailA, turnstile: '' })).status === 403);
let r = await checkout(A, { qty: 5, start: pm[0].start, name: 'Anna Rider', email: emailA, phone: '+45 1111 1111' });
ok('checkout returns a Stripe link', r.status === 200 && r.d.url, r.d.error);
ok('S1: before paying, the browser is NOT logged in', (await call('/api/me', undefined, A)).status === 401);
r = await checkout(A, { qty: 5, start: pm[0].start, name: 'Anna Rider', email: emailA, phone: '+45 1111 1111' });
ok('going back and picking the same session again works (old hold freed)', r.status === 200, r.d.error);
const orderA = orderOf(r);
const st = await call(`/api/order-status?id=${orderA}`, undefined, A);
ok('after-payment page sees "pending"', st.status === 200 && st.d.status === 'pending' && st.d.newRider === true);
ok('another rider cannot take the held seat', (await checkout(who(), { start: pm[0].start, name: 'Bo', email: `b-${run}@test.dk` })).status === 409);
ok('webhook with a bad signature is refused', (await fetch(B + '/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=abc' } })).status === 400);
ok('webhook accepted', (await webhook(orderA)) === 200);
r = await call(`/api/me?paid=${orderA}`, undefined, A);
ok('new rider back from Stripe is logged in, booked, 4 left', r.status === 200 && r.d.upcoming.length === 1 && r.d.balance.total === 4, `status ${r.status}`);
await sleep(1500);
ok('confirmation email with calendar invite', emails().some((e) => e.to === emailA && e.subject.startsWith('Booked') && e.attach));
ok('payment webhook twice does not double book', (await webhook(orderA)) === 200 && (await call('/api/me', undefined, A)).d.upcoming.length === 1);

console.log('\n-- S1 account takeover attempt');
const X = who();
r = await checkout(X, { qty: 3, later: true, name: 'Attacker', email: emailA, phone: '+45 6666 6666', consents: { ...C, film: true } });
ok('attacker can start a checkout with Anna\'s email', r.status === 200);
const orderX = orderOf(r);
ok('attacker browser is not logged in before paying', (await call('/api/me', undefined, X)).status === 401);
const sx = await call(`/api/order-status?id=${orderX}`, undefined, X);
ok('order status reveals nothing personal', sx.status === 200 && !JSON.stringify(sx.d).includes('@'));
await webhook(orderX);
ok('even after paying, attacker browser is not logged in as Anna', (await call(`/api/me?paid=${orderX}`, undefined, X)).status === 401);
ok('order status from another browser is refused', (await call(`/api/order-status?id=${orderA}`, undefined, who())).status === 404);

console.log('\n-- S2 input limits');
ok('a 20 KB request is refused', (await call('/api/checkout', JSON.stringify({ name: 'x'.repeat(20000) }), who())).status === 413);
r = await checkout(who(), { qty: 3, later: true, name: 'Long'.repeat(1000) + '\nline', email: `long-${run}@test.dk`, goal: 'g'.repeat(5000) });
ok('long fields are accepted but cut', r.status === 200, r.d.error);
await webhook(orderOf(r), 'checkout.session.expired');

console.log('\n-- S3 rate limit');
const same = who();
const codes = [];
for (let i = 0; i < 7; i++) codes.push((await checkout(same, { start: pm.at(-1).start, name: 'Bot', email: `bot${i}-${run}@test.dk` })).status);
ok('one IP is limited to 5 checkouts a minute', codes.includes(429), codes.join(' '));

console.log('\n-- S4 late payment');
const L = who();
r = await checkout(L, { start: pm[1].start, name: 'Late Payer', email: `late-${run}@test.dk` });
const orderL = orderOf(r);
await webhook(orderL, 'checkout.session.expired');
ok('expired checkout frees the seat', (await call('/api/slots')).d.slots.some((s) => s.start === pm[1].start));
ok('late payment confirmation accepted', (await webhook(orderL, 'checkout.session.async_payment_succeeded')) === 200);
r = await call(`/api/me?paid=${orderL}`, undefined, L);
ok('late payer has the session booked', r.status === 200 && r.d.upcoming.length === 1, `status ${r.status}`);

console.log('\n-- payment check (webhook lost)');
const D = who();
r = await checkout(D, { qty: 3, later: true, name: 'Lost Webhook', email: `lost-${run}@test.dk` });
const orderD = orderOf(r);
await ctl({ paid: [orderD] });
await scheduled();
await sleep(500);
r = await call(`/api/me?paid=${orderD}`, undefined, D);
ok('payment without webhook is found and credited by the scheduled check', r.status === 200 && r.d.balance.total === 3, `status ${r.status}`);

console.log('\n-- logins');
const A2 = who();
ok('login code request needs the bot check', (await call('/api/login/request', { email: emailA }, A2)).status === 403);
await call('/api/login/request', { email: emailA, turnstile: H }, A2);
await sleep(1500);
const code = lastEmail(emailA)?.subject.match(/\d{6}/)?.[0];
ok('login code emailed', !!code);
ok('wrong code refused', (await call('/api/login/verify', { email: emailA, code: '000000' }, A2)).status === 401);
ok('right code logs in', (await call('/api/login/verify', { email: emailA, code }, A2)).status === 200 && (await call('/api/me', undefined, A2)).status === 200);
ok('rider cannot open the team view', (await call('/api/team', undefined, A2)).status === 401);

console.log('\n-- S7 log out everywhere');
ok('S1: a second payment with Anna\'s email ended her automatic login (code needed)', (await call('/api/me', undefined, A)).status === 401);
const A3 = who();
await sleep(1100);
await call('/api/login/request', { email: emailA, turnstile: H }, A3);
await sleep(1500);
const code3 = lastEmail(emailA)?.subject.match(/\d{6}/)?.[0];
ok('second device logs in', (await call('/api/login/verify', { email: emailA, code: code3 }, A3)).status === 200);
ok('log out everywhere', (await call('/api/me/logout-all', {}, A2)).status === 200);
ok('the other device is logged out too', (await call('/api/me', undefined, A3)).status === 401);

console.log('\n-- team');
const T = who();
await call('/api/login/request', { email: 'team@ndure.dk', team: true, turnstile: H }, T);
await sleep(1500);
const tcode = lastEmail('team@ndure.dk')?.subject.match(/\d{6}/)?.[0];
ok('team login', (await call('/api/login/verify', { email: 'team@ndure.dk', code: tcode, team: true }, T)).status === 200);
const tv = (await call('/api/team', undefined, T)).d;
const anna = tv.riders.find((x) => x.email === emailA);
ok('S1: Anna\'s name and phone unchanged by the attacker', anna?.name === 'Anna Rider' && anna?.phone === '+45 1111 1111', JSON.stringify(anna));
const longR = tv.riders.find((x) => x.email === `long-${run}@test.dk`);
ok('S2: long name stored at 80 characters, no line break', longR && longR.name.length === 80 && !longR.name.includes('\n'));
ok('S4: staff alert about the late payment', tv.alerts.some((a) => a.kind === 'late_payment' && a.text.includes(`late-${run}`)));
ok('alert about the payment found without webhook', tv.alerts.some((a) => a.kind === 'payment_found' && a.text.includes(orderD)));
ok('S9: activity log shows payments and logins', tv.audit.some((x) => x.by === 'stripe' && x.detail.includes(emailA)) && tv.audit.some((x) => x.by === 'team@ndure.dk' && x.action === 'login'));
ok('status panel', tv.status.bytes > 0 && tv.status.lastJob, JSON.stringify(tv.status));
ok('sign-up source shown', anna?.src === 'web' || anna?.src === null, anna?.src);
r = await call('/api/team/action', { action: 'give', email: `free-${run}@test.dk`, name: 'Free Rider', qty: 2 }, T);
ok('team gives free sessions, logged', r.status === 200 && r.d.audit[0].action === 'give sessions');
ok('team log out everywhere', (await call('/api/team/logout-all', {}, T)).status === 200 && (await call('/api/team', undefined, T)).status === 401);

console.log('\n-- partner consent');
const P = who();
r = await checkout(P, { start: am[0].start, partner: true, partnerName: 'Pat Partner', partnerEmail: `pat-${run}@test.dk`, name: 'Pia Rider', email: `pia-${run}@test.dk` });
await webhook(orderOf(r));
await sleep(1500);
const pmail = lastEmail(`pat-${run}@test.dk`);
const token = pmail?.text.match(/consent\/([\w-]+)/)?.[1];
ok('partner email has a real consent link', !!token && !pmail.text.includes('[link]'));
ok('partner page loads', (await call(`/api/partner?t=${token}`)).d.partnerName === 'Pat Partner');
ok('partner page with a wrong link is refused', (await call(`/api/partner?t=${'x'.repeat(24)}`)).status === 400);
ok('partner consent saved', (await call('/api/partner', { t: token, consents: C, phone: '+45 2222' })).status === 200);
ok('partner page shows it is done', (await call(`/api/partner?t=${token}`)).d.done === true);

console.log('\n-- S6 headers, cross-site, health');
r = await call('/api/config');
ok('API responses carry security headers', r.headers.get('x-frame-options') === 'DENY' && r.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
ok('pages carry security headers', (await fetch(B + '/team')).headers.get('x-frame-options') === 'DENY');
ok('cross-site post refused', (await call('/api/me/book', { start: pm[2].start }, A2, { origin: 'https://evil.example' })).status === 403);
await scheduled();
ok('health check green after the scheduled job', (await call('/api/health')).status === 200);

console.log('\n-- emails exactly once, also when senders run at the same time');
await Promise.all([scheduled(), scheduled(), scheduled(), scheduled(), scheduled()]);
await sleep(2000);
const riderMails = emails().filter((e) => !/code/i.test(e.subject));
const seen = new Map();
for (const e of riderMails) seen.set(`${e.to}|${e.subject}|${e.text}`, (seen.get(`${e.to}|${e.subject}|${e.text}`) ?? 0) + 1);
const dups = [...seen].filter(([, n]) => n > 1);
ok('no email sent twice', dups.length === 0, dups.slice(0, 3).map(([k, n]) => `${n}x ${k.slice(0, 80)}`).join(' | '));

console.log(`\n${fails === 0 ? 'ALL PASSED' : `${fails} FAILED`}`);
process.exit(fails ? 1 : 0);
