import { db } from '@/lib/db';
import { loadPricing, quote } from '@/lib/pricing';
import { stripe, cents } from '@/lib/stripe';
import { appUrl } from '@/lib/env';
import { consentRecord, REQUIRED_CONSENTS, CONSENT_VERSION, VALID_MONTHS } from '@/lib/policy';
import { newToken, cleanText, isEmail, json, fail } from '@/lib/util';
import { calcomFree, BookingError } from '@/lib/booking';
import { placeHold, releaseHolds } from '@/lib/holds';

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

  // The first session: picked before paying. Riders buying a pack may choose later.
  const slotEt = Number(body?.slot?.eventTypeId);
  const slotStart = typeof body?.slot?.start === 'string' && !Number.isNaN(Date.parse(body.slot.start)) ? body.slot.start : null;
  const hasSlot = !!slotEt && !!slotStart;
  if (!hasSlot && !(body?.later === true && q.qty > 1)) return fail('Pick a date for your session.');
  if (hasSlot && new Date(slotStart!).getTime() < Date.now()) return fail('That session has already started. Pick another one.');
  const need = partner ? 2 : 1;
  let calFree = 0;
  if (hasSlot) {
    try {
      calFree = (await calcomFree(slotEt, slotStart!)).free;
    } catch (e) {
      if (e instanceof BookingError) return fail(e.message, e.status);
      console.error('Slot check failed', e);
      return fail('Could not check that session. Try again in a moment.', 502);
    }
    if (calFree < need) return fail('That session just filled up. Pick another one.', 409);
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
      src: cleanText(body?.src, 60) || null,
      first_event_type_id: hasSlot ? slotEt : null,
      first_start: hasSlot ? new Date(slotStart!).toISOString() : null,
      first_status: hasSlot ? 'pending' : 'none'
    })
    .select('id')
    .single();
  if (error || !order) {
    console.error('Order insert failed', error);
    return fail('Something went wrong on our side. Please try again.', 500);
  }

  // Hold the seats while the rider pays, so nobody else can take them in the meantime.
  if (hasSlot) {
    let held = false;
    try {
      held = await placeHold(order.id, slotEt, slotStart!, need, calFree);
    } catch (e) {
      console.error('Hold failed', e);
    }
    if (!held) {
      await db().from('orders').delete().eq('id', order.id);
      return fail('Someone is booking that session right now. Pick another one.', 409);
    }
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
      // Stripe's minimum. The seat hold lasts a little longer, so a rider who pays at minute 29 still gets their seat.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      success_url: `${appUrl()}/order/${token}?paid=1`,
      cancel_url: `${appUrl()}/?cancelled=1`
    });
    await db().from('orders').update({ stripe_session_id: session.id }).eq('id', order.id);
    return json({ url: session.url });
  } catch (e) {
    console.error('Stripe session failed', e);
    await releaseHolds(order.id).catch(() => {});
    return fail('Payment could not be started. Please try again.', 502);
  }
}
