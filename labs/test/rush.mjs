// Launch rush: N riders sign up within `spreadMs`, many aiming for the same few sessions.
// Then all payments are confirmed at once. Checks for overbooking, lost payments, errors and
// duplicate emails. Usage: node rush.mjs <log> <riders> <spreadMs>
import crypto from 'node:crypto';
import fs from 'node:fs';
const B = 'http://localhost:8787', LOG = process.argv[2];
const N = Number(process.argv[3] || 100), SPREAD = Number(process.argv[4] || 60000);
const run = Date.now().toString(36);
const net = Math.floor(Math.random() * 200) + 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = { ready: true, health: true, terms: true };

async function call(path, body, u, extra = {}) {
  const t0 = performance.now();
  const res = await fetch(B + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': u.ip, cookie: Object.entries(u.jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; '), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); u.jar[k] = v.join('='); }
  const t = await res.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: res.status, d, ms: performance.now() - t0 };
}
async function webhook(orderId) {
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { metadata: { order_id: orderId }, payment_status: 'paid' } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_localtest').update(`${t}.${body}`).digest('hex');
  const t0 = performance.now();
  const res = await fetch(B + '/api/stripe/webhook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${sig}` } });
  return { status: res.status, ms: performance.now() - t0 };
}
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] || 0); };
const count = (arr) => arr.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

const slots = (await call('/api/slots', undefined, { jar: {}, ip: '10.1.1.1' })).d.slots;
const popular = slots.slice(0, 5).map((s) => s.start);
const linesBefore = fs.readFileSync(LOG, 'utf8').split('\n').length;

// Each rider: pick a session (half aim for the 5 earliest), pay; on "just taken" pick the first free one, like a person would.
const riders = Array.from({ length: N }, (_, i) => ({ i, jar: {}, ip: `10.${net}.${Math.floor(i / 250)}.${(i % 250) + 1}`, email: `rush${i}-${run}@test.dk` }));
const res = { checkout: [], retry: [], ms: [], orders: [] };
const realistic = process.argv[5] === 'realistic';
await Promise.all(riders.map(async (r) => {
  await sleep(Math.random() * SPREAD);
  const qty = [1, 1, 3, 5][r.i % 4];
  let start = r.i % 2 === 0 ? popular[r.i % 5] : slots[Math.floor(Math.random() * slots.length)].start;
  for (let attempt = 0; attempt < 3; attempt++) {
    const x = await call('/api/checkout', { qty, partner: false, start, name: `Rush Rider ${r.i}`, email: r.email, consents: C, turnstile: 'human-ok' }, r);
    res.ms.push(x.ms);
    (attempt === 0 ? res.checkout : res.retry).push(x.status);
    if (x.status === 200) {
      const o = { id: x.d.url.split('/').pop(), qty, email: r.email };
      res.orders.push(o);
      if (realistic) o.wh = sleep(30000 + Math.random() * 60000).then(() => webhook(o.id));
      return;
    }
    if (x.status !== 409 && x.status !== 503) return;
    const fresh = (await call('/api/slots', undefined, r)).d.slots;
    if (!fresh.length) return;
    start = fresh[0].start;
  }
}));
console.log(`checkouts: ${N} riders within ${SPREAD / 1000}s`);
console.log('  first try  ', JSON.stringify(count(res.checkout)));
console.log('  retries    ', JSON.stringify(count(res.retry)));
console.log(`  time per checkout: median ${pct(res.ms, 50)} ms, 95% under ${pct(res.ms, 95)} ms, slowest ${pct(res.ms, 100)} ms`);

// Payments confirmed: all at the same moment (worst case), or each 30 to 90 seconds after its checkout (realistic).
const wh = await Promise.all(res.orders.map((o) => o.wh ?? webhook(o.id)));
console.log(`webhooks: ${res.orders.length} ${realistic ? 'as riders finish paying' : 'at once'}`, JSON.stringify(count(wh.map((w) => w.status))), `median ${pct(wh.map((w) => w.ms), 50)} ms, 95% under ${pct(wh.map((w) => w.ms), 95)} ms`);
// Stripe retries failed webhooks; do the same once.
const retryWh = res.orders.filter((_, k) => wh[k].status !== 200);
if (retryWh.length) {
  await sleep(1000);
  const again = await Promise.all(retryWh.map((o) => webhook(o.id)));
  console.log('  webhook retries', JSON.stringify(count(again.map((w) => w.status))));
}

// Stripe now lists every order as paid; the scheduled payment check credits anything the
// webhooks missed (in real life Stripe also keeps retrying webhooks for 3 days).
await fetch('http://127.0.0.1:8788/__ctl', { method: 'POST', body: JSON.stringify({ paid: res.orders.map((o) => o.id) }) });

// Let the scheduled job send everything, two runs at the same time.
for (let k = 0; k < 6; k++) {
  await Promise.all([fetch(`${B}/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*`), fetch(`${B}/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*`)]);
}
await sleep(1500);

// Check the result through the team view.
const T = { jar: {}, ip: `10.${net}.250.1` };
await call('/api/login/request', { email: 'team@ndure.dk', team: true, turnstile: 'human-ok' }, T);
await sleep(1500);
const tcode = fs.readFileSync(LOG, 'utf8').trim().split('\n').map(JSON.parse).filter((x) => x.email?.to === 'team@ndure.dk').at(-1).email.subject.match(/\d{6}/)[0];
await call('/api/login/verify', { email: 'team@ndure.dk', code: tcode, team: true }, T);
const tv = (await call('/api/team', undefined, T)).d;

const seatsAt = {};
for (const d of tv.days) for (const b of d.list) if (b.status !== 'cancelled') seatsAt[b.start] = (seatsAt[b.start] ?? 0) + b.seats;
const over = Object.entries(seatsAt).filter(([s, n]) => n > (new Date(s).getUTCHours() < 10 ? 2 : 1));
console.log(`overbooked sessions: ${over.length}`, over.length ? JSON.stringify(over) : '');

let lost = 0;
for (const o of res.orders) {
  const rider = tv.riders.find((x) => x.email === o.email);
  const booked = tv.days.flatMap((d) => d.list).filter((b) => b.customer.email === o.email && b.status === 'booked').length;
  if (!rider || rider.balance + booked !== o.qty) lost++;
}
console.log(`paid orders without the right sessions: ${lost} of ${res.orders.length}`);

const newLines = fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(linesBefore - 1).filter(Boolean).map(JSON.parse).filter((x) => x.email && x.email.to.includes(`-${run}@`));
const keyCount = count(newLines.map((x) => `${x.email.to}|${x.email.subject}`));
const dups = Object.entries(keyCount).filter(([, n]) => n > 1);
const gotPayment = new Set(newLines.filter((x) => x.email.subject.startsWith('Payment received')).map((x) => x.email.to));
console.log(`emails: ${newLines.length} sent to riders, duplicates ${dups.length}, payment emails ${gotPayment.size} of ${res.orders.length}, still waiting ${tv.status.emailsWaiting}`);
console.log(`stored data now: ${Math.round(tv.status.bytes / 1000)} KB`);
