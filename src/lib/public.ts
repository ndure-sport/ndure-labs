import type { Order, Booking } from './db';
import { canChange } from './policy';

// What the rider's own page may see. No internal ids beyond what it needs, no consents.
export function publicOrder(order: Order, bookings: Booking[]) {
  const now = Date.now();
  return {
    status: order.status,
    firstName: order.rider_name.split(' ')[0],
    qty: order.qty,
    creditsLeft: order.credits_left,
    partner: order.partner
      ? { name: order.partner_name, used: order.partner_used, consented: !!order.partner_consents }
      : null,
    bookings: bookings.map((b) => ({
      id: b.id,
      status: b.status,
      label: b.label,
      start: b.start_at,
      end: b.end_at,
      withPartner: b.with_partner,
      upcoming: new Date(b.start_at).getTime() > now,
      changeable: b.status === 'booked' && canChange(b.start_at, now)
    }))
  };
}

export type PublicOrder = ReturnType<typeof publicOrder>;
