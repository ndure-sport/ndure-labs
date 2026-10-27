import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { env } from '@/lib/env';
import { db, type Order } from '@/lib/db';
import { sendOrderLink, sendPartnerInvite } from '@/lib/email';
import { book } from '@/lib/booking';
import { releaseHolds } from '@/lib/holds';

// Stripe tells us when a payment is done. This is the only place an order becomes paid
// and gets its session credits, so a rider closing the tab after paying is not a problem.

export async function POST(req: Request) {
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, req.headers.get('stripe-signature') || '', env('STRIPE_WEBHOOK_SECRET'));
  } catch (e) {
    return new Response(`Webhook signature check failed: ${(e as Error).message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== 'paid') return new Response('waiting for payment', { status: 200 });
    const orderId = session.metadata?.order_id;
    if (!orderId) return new Response('no order id', { status: 200 });

    const { data: found, error: findError } = await db().from('orders').select('qty').eq('id', orderId).maybeSingle();
    if (findError) return new Response('db error', { status: 500 }); // Stripe retries
    if (!found) return new Response('unknown order', { status: 200 });

    // Only the first delivery of this event flips pending to paid; Stripe retries are ignored.
    const { data, error } = await db()
      .from('orders')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        amount_paid: (session.amount_total ?? 0) / 100,
        credits_left: found.qty,
        stripe_session_id: session.id
      })
      .eq('id', orderId)
      .in('status', ['pending', 'expired'])
      .select('*');
    if (error) return new Response('db error', { status: 500 });
    const order = (data?.[0] as Order | undefined) ?? null;
    if (order) {
      // Book the session the rider picked before paying. Their seat was held during checkout.
      let firstStatus: Order['first_status'] = order.first_status;
      if (order.first_status === 'pending' && order.first_event_type_id && order.first_start) {
        try {
          await book(order, order.first_event_type_id, order.first_start);
          firstStatus = 'booked';
        } catch (e) {
          // Rare: the session was filled from Cal.com directly while they paid. The credit stays on the order.
          console.error('Booking the chosen session after payment failed', order.id, e);
          firstStatus = 'failed';
        }
        await db().from('orders').update({ first_status: firstStatus }).eq('id', order.id);
      }
      await releaseHolds(order.id).catch(() => {});
      await sendOrderLink({ ...order, first_status: firstStatus });
      if (order.partner && order.partner_email && order.partner_token) {
        await sendPartnerInvite({
          rider_name: order.rider_name,
          partner_name: order.partner_name || 'there',
          partner_email: order.partner_email,
          partner_token: order.partner_token
        });
      }
    }
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;
    if (orderId) {
      await db().from('orders').update({ status: 'expired' }).eq('id', orderId).eq('status', 'pending');
      await releaseHolds(orderId).catch(() => {});
    }
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const orderId = charge.metadata?.order_id;
    // Full refund: no sessions left to book. Partial refunds are handled by the team.
    if (orderId && charge.amount_refunded >= charge.amount) {
      await db().from('orders').update({ status: 'refunded', credits_left: 0 }).eq('id', orderId);
    }
  }

  return new Response('ok', { status: 200 });
}
