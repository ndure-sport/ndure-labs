// Fake Stripe, Brevo and Turnstile for local tests (see test/README.md).
// Fake Stripe, Brevo and Turnstile for local tests. Control: POST /__ctl {brevoDown, paid:[orderIds]}
import http from 'node:http'; import fs from 'node:fs';
const log = process.argv[2];
const sessions = new Map(); // orderId -> {payment_status}
let brevoDown = false;
const out = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__ctl') { const j = JSON.parse(b || '{}'); if ('brevoDown' in j) brevoDown = j.brevoDown; for (const id of j.paid || []) sessions.set(id, { payment_status: 'paid' }); return out(res, 200, { ok: true }); }
  if (u.pathname === '/v1/checkout/sessions' && req.method === 'POST') { const p = new URLSearchParams(b); const id = p.get('metadata[order_id]'); sessions.set(id, { payment_status: 'unpaid' }); fs.appendFileSync(log, JSON.stringify({ stripe: { order: id, amount: p.get('line_items[0][price_data][unit_amount]') } }) + '\n'); return out(res, 200, { id: 'cs_' + id, url: 'https://checkout.stripe.test/' + id }); }
  if (u.pathname === '/v1/checkout/sessions' && req.method === 'GET') { fs.appendFileSync(log, JSON.stringify({ stripeList: u.search }) + '\n'); return out(res, 200, { data: [...sessions].filter(([, v]) => v.payment_status === 'paid').map(([id, v]) => ({ payment_status: v.payment_status, metadata: { order_id: id } })) }); }
  if (u.pathname === '/v3/smtp/email') { if (brevoDown) return out(res, 503, { message: 'down' }); const j = JSON.parse(b); fs.appendFileSync(log, JSON.stringify({ email: { to: j.to.map((t) => t.email).join(','), subject: j.subject, text: j.textContent, attach: !!j.attachment } }) + '\n'); return out(res, 201, { messageId: 'x' }); }
  if (u.pathname === '/turnstile/v0/siteverify') { const ok = b.includes('human-ok'); return out(res, 200, { success: ok }); }
  res.writeHead(404); res.end();
}); }).listen(8788, '127.0.0.1');
