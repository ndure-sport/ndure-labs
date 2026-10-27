// Stripe through its plain HTTP API, no library, to keep the Worker small and fast.

import type { Env } from './store';
import type { Order } from '../core/types';
import type { Config } from '../core/config';
import { hmacHex } from './auth';

export async function createCheckout(env: Env, config: Config, order: Order, email: string, appUrl: string): Promise<string> {
  const f = new URLSearchParams();
  const cur = (env.CURRENCY || 'eur').toLowerCase();
  f.set('mode', 'payment');
  f.set('customer_email', email);
  f.set('client_reference_id', order.id);
  f.set('metadata[order_id]', order.id);
  f.set('payment_intent_data[metadata][order_id]', order.id);
  f.set('allow_promotion_codes', 'true');
  f.set('locale', 'auto');
  f.set('success_url', `${appUrl}/account?paid=${order.id}`);
  f.set('cancel_url', `${appUrl}/?cancelled=1`);
  // Stripe's minimum. The seat hold lasts 35 minutes, a little longer.
  f.set('expires_at', String(Math.floor(Date.now() / 1000) + 31 * 60));
  let i = 0;
  f.set(`line_items[${i}][quantity]`, String(order.qty));
  f.set(`line_items[${i}][price_data][currency]`, cur);
  f.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(order.unit * 100)));
  f.set(`line_items[${i}][price_data][product_data][name]`, order.qty > 1 ? `NDURE Labs, ${order.qty} lactate sessions` : 'NDURE Labs lactate session');
  if (order.partner) {
    i++;
    f.set(`line_items[${i}][quantity]`, '1');
    f.set(`line_items[${i}][price_data][currency]`, cur);
    f.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(config.partnerPrice * 100)));
    f.set(`line_items[${i}][price_data][product_data][name]`, 'Training partner, same session');
  }
  const res = await fetch(`${env.STRIPE_API_BASE || 'https://api.stripe.com'}/v1/checkout/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: f
  });
  const data = (await res.json()) as { url?: string; error?: { message: string } };
  if (!res.ok || !data.url) throw new Error(`Stripe: ${data.error?.message || res.status}`);
  return data.url;
}

// Checks the Stripe-Signature header: HMAC SHA256 of "timestamp.body" with the webhook secret.
export async function verifyStripe(env: Env, body: string, header: string | null): Promise<boolean> {
  if (!header || !env.STRIPE_WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${body}`);
  const given = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return given.some((g) => g.length === expected.length && g === expected);
}
