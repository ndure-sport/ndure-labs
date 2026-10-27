import { db } from '@/lib/db';
import { loadPricing, quote } from '@/lib/pricing';
import { stripe, cents } from '@/lib/stripe';
import { appUrl } from '@/lib/env';
import { consentRecord, REQUIRED_CONSENTS, CONSENT_VERSION, VALID_MONTHS } from '@/lib/policy';
import { newToken, cleanText, isEmail, json, fail } from '@/lib/util';

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid request.');
  }

  const name = cleanText(body?.rider?.name, 120);
  const email = cleanText(body?.rider?.email, 254).toLowerCase();
  const phone = cleanText(body?.rider?.phone, 40) || null;
  const ftpRaw = Number(body?.rider?.ftp);
  const ftp = Number.isInteger(ftpRaw) && ftpRaw > 0 && ftpRaw < 800 ? ftpRaw : null;
  const goal = cleanText(body?.rider?.goal, 80) || null;
  if (!name) return fail('Please fill in your name.');
  if (!isEmail(email)) return fail('Please fill in a valid email address.');

  const consents = body?.consents ?? {};
  for (const k of REQUIRED_CONSENTS) {
    if (consents[k] !== true) return fail('Please tick the readiness check, data consent and terms.');
  }

  const partner = body?.partner === true;
  const partnerName = partner ? cleanText(body?.partnerInfo?.name, 120) : '';
  const partnerEmail = partner ? cleanText(body?.partnerInfo?.email, 254).toLowerCase() : '';
  if (partner && (!partnerName || !isEmail(partnerEmail))) return fail("Please fill in your partner's name and email.");
  if (partner && partnerEmail === email) return fail('Your partner needs their own email address.');

  const config = await loadPricing();
  let q;
  try {
    q = quote(config, { qty: body?.qty, partner, addons: Array.isArray(body?.addons) ? body.addons : [] });
  } catch (e) {
    return fail((e as Error).message);
  }

  const token = newToken();
  const { data: order, error } = await db()
    .from('orders')
    .insert({
      token,
      rider_name: name,
      rider_email: email,
      rider_phone: phone,
      ftp,
      goal,
      qty: q.qty,
      unit_price: q.unit,
      total: q.total,
      addons: q.addons,
      partner,
      partner_name: partner ? partnerName : null,
      partner_email: partner ? partnerEmail : null,
      partner_token: partner ? newToken() : null,
      consents: consentRecord(consents),
      consent_version: CONSENT_VERSION,
      src: cleanText(body?.src, 60) || null
    })
    .select('id')
    .single();
  if (error || !order) {
    console.error('Order insert failed', error);
    return fail('Something went wrong on our side. Please try again.', 500);
  }

  const lineItems: any[] = [
    {
      quantity: q.qty,
      price_data: {
        currency: 'eur',
        unit_amount: cents(q.unit),
        product_data: {
          name: 'NDURE Labs lactate session',
          description: q.qty > 1 ? `${q.qty} sessions at €${q.unit} each, valid ${VALID_MONTHS} months` : 'Step test with a coach, report within 48 hours'
        }
      }
    }
  ];
  if (partner) {
    lineItems.push({
      quantity: 1,
      price_data: { currency: 'eur', unit_amount: cents(config.partner), product_data: { name: 'Training partner, same session' } }
    });
  }
  for (const key of q.addons) {
    const a = config.addons.find((x) => x.key === key)!;
    lineItems.push({ quantity: 1, price_data: { currency: 'eur', unit_amount: cents(a.price), product_data: { name: a.name } } });
  }

  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: email,
      client_reference_id: order.id,
      metadata: { order_id: order.id },
      payment_intent_data: { metadata: { order_id: order.id }, description: `NDURE Labs, ${q.qty} session(s)` },
      allow_promotion_codes: true,
      locale: 'auto',
      success_url: `${appUrl()}/order/${token}?paid=1`,
      cancel_url: `${appUrl()}/?cancelled=1`
    });
    await db().from('orders').update({ stripe_session_id: session.id }).eq('id', order.id);
    return json({ url: session.url });
  } catch (e) {
    console.error('Stripe session failed', e);
    return fail('Payment could not be started. Please try again.', 502);
  }
}
