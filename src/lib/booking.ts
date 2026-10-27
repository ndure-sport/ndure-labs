import 'server-only';
import { db, useCredit, returnCredit, type Order, type Booking } from './db';
import { allSlots, slotsFor, createBooking, cancelSeat, getBooking, sameInstant, type CreatedSeat, type Slot } from './calcom';
import { eventTypes } from './env';
import { canChange, hoursUntil, CHANGE_DEADLINE_HOURS } from './policy';
import { heldSeats, slotKey } from './holds';

export class BookingError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// Seats this booking needs: the rider, plus the partner on the first booking of an order with a partner.
export function seatsNeeded(order: Order, existing?: Booking): number {
  if (existing) return existing.with_partner ? 2 : 1;
  return order.partner && !order.partner_used ? 2 : 1;
}

function bookingWindow() {
  const weeks = Number(process.env.BOOKING_WEEKS_AHEAD || 6);
  const from = new Date();
  const to = new Date(from.getTime() + weeks * 7 * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Cal.com's free seats minus seats held for riders who are paying right now.
async function freeAfterHolds(slots: Slot[], from: string, to: string, excludeOrder?: string): Promise<Slot[]> {
  const held = await heldSeats(from, to, excludeOrder);
  return slots.map((s) => ({ ...s, free: Math.max(0, s.free - (held.get(slotKey(s.eventTypeId, s.start)) ?? 0)) }));
}

// Raw Cal.com slots are cached briefly so a busy sign up page doesn't hammer the API.
// Holds are always read fresh, and every booking is checked again right before it's made.
let rawCache: { at: number; slots: Slot[] } | null = null;
async function cachedSlots(from: string, to: string): Promise<Slot[]> {
  if (rawCache && Date.now() - rawCache.at < 20_000) return rawCache.slots;
  const slots = await allSlots(from, to);
  rawCache = { at: Date.now(), slots };
  return slots;
}

// For the sign up page, before there is an order.
export async function publicSlots(need: number) {
  const { from, to } = bookingWindow();
  const slots = await freeAfterHolds(await cachedSlots(from, to), from, to);
  return slots.filter((s) => s.free >= need && new Date(s.start).getTime() > Date.now());
}

export async function availableSlots(order: Order, existing?: Booking) {
  const { from, to } = bookingWindow();
  const need = seatsNeeded(order, existing);
  const slots = await freeAfterHolds(await allSlots(from, to), from, to, order.id);
  return {
    need,
    slots: slots
      .filter((s) => s.free >= need)
      .filter((s) => !existing || !sameInstant(s.start, existing.start_at))
  };
}

// Seats Cal.com still has free in one session, before subtracting holds.
export async function calcomFree(eventTypeId: number, start: string) {
  const et = eventTypes().find((e) => e.id === eventTypeId);
  if (!et) throw new BookingError('Unknown session type.');
  const day = new Date(start);
  const from = new Date(day.getTime() - 60_000).toISOString();
  const to = new Date(day.getTime() + 60_000).toISOString();
  const slots = await slotsFor(et, from, to);
  const slot = slots.find((s) => sameInstant(s.start, start));
  return { et, free: slot ? slot.free : 0, from, to };
}

async function confirmFree(eventTypeId: number, start: string, need: number, orderId?: string) {
  const { et, free, from, to } = await calcomFree(eventTypeId, start);
  const held = (await heldSeats(from, to, orderId)).get(slotKey(eventTypeId, start)) ?? 0;
  if (free - held < need) {
    throw new BookingError(need > 1 ? 'There are no longer 2 free spots in this session. Pick another one.' : 'This session just filled up. Pick another one.', 409);
  }
  return et;
}

async function bookSeats(order: Order, eventTypeId: number, start: string, withPartner: boolean) {
  const meta = { order_id: order.id, source: 'book.ndure.dk' };
  const rider = await createBooking({
    eventTypeId,
    start,
    name: order.rider_name,
    email: order.rider_email,
    phone: order.rider_phone,
    metadata: { ...meta, role: 'rider' }
  });
  let partner: CreatedSeat | null = null;
  if (withPartner) {
    try {
      partner = await createBooking({
        eventTypeId,
        start,
        name: order.partner_name || 'Training partner',
        email: order.partner_email!,
        metadata: { ...meta, role: 'partner' }
      });
    } catch (e) {
      // Don't leave the rider booked alone in a session they meant to share.
      await cancelSeat(rider.uid, rider.seatUid, 'Partner seat could not be booked').catch(() => {});
      throw new BookingError('There are no longer 2 free spots in this session. Pick another one.', 409);
    }
  }
  return { rider, partner };
}

export async function book(order: Order, eventTypeId: number, start: string): Promise<Booking> {
  if (order.status !== 'paid') throw new BookingError('This order is not paid yet.', 402);
  const withPartner = seatsNeeded(order) === 2;
  const et = await confirmFree(eventTypeId, start, withPartner ? 2 : 1, order.id);

  if (!(await useCredit(order.id))) throw new BookingError('You have no sessions left on this order.', 409);

  let seats;
  try {
    seats = await bookSeats(order, eventTypeId, start, withPartner);
  } catch (e) {
    await returnCredit(order.id);
    if (e instanceof BookingError) throw e;
    throw new BookingError('The booking did not go through. Try again or pick another session.', 502);
  }

  const { data, error } = await db()
    .from('bookings')
    .insert({
      order_id: order.id,
      event_type_id: eventTypeId,
      label: et.label,
      start_at: seats.rider.start || start,
      end_at: seats.rider.end || null,
      cal_uid: seats.rider.uid,
      seat_uid: seats.rider.seatUid,
      with_partner: withPartner,
      partner_cal_uid: seats.partner?.uid ?? null,
      partner_seat_uid: seats.partner?.seatUid ?? null
    })
    .select('*')
    .single();
  if (error) {
    // The seat exists in Cal.com but we failed to record it. Log loudly; the admin page shows Cal.com as source of truth.
    console.error('Booking created in Cal.com but not saved', seats, error);
    throw new BookingError('Your session is booked, but we could not update your page. We will check it and email you.', 500);
  }
  if (withPartner) await db().from('orders').update({ partner_used: true }).eq('id', order.id);
  return data as Booking;
}

export async function cancel(order: Order, booking: Booking): Promise<void> {
  if (booking.status !== 'booked') throw new BookingError('This session is already cancelled.', 409);
  if (!canChange(booking.start_at)) {
    throw new BookingError(`Sessions can be cancelled up to ${CHANGE_DEADLINE_HOURS} hours before. Email contact@ndure.dk if something came up.`, 409);
  }
  await cancelSeat(booking.cal_uid, booking.seat_uid, 'Cancelled by rider');
  if (booking.with_partner && booking.partner_cal_uid) {
    await cancelSeat(booking.partner_cal_uid, booking.partner_seat_uid, 'Cancelled by rider').catch((e) =>
      console.error('Partner seat cancel failed', booking.id, e)
    );
  }
  await markCancelled(order, booking, true);
}

// Book the new session first, then release the old one, so a failed change never leaves the rider without a session.
export async function reschedule(order: Order, booking: Booking, eventTypeId: number, start: string): Promise<Booking> {
  if (booking.status !== 'booked') throw new BookingError('This session is cancelled.', 409);
  if (!canChange(booking.start_at)) {
    throw new BookingError(`Sessions can be changed up to ${CHANGE_DEADLINE_HOURS} hours before. Email contact@ndure.dk if something came up.`, 409);
  }
  const et = await confirmFree(eventTypeId, start, booking.with_partner ? 2 : 1, order.id);
  let seats;
  try {
    seats = await bookSeats(order, eventTypeId, start, booking.with_partner);
  } catch (e) {
    if (e instanceof BookingError) throw e;
    throw new BookingError('The change did not go through. Your original session is still booked.', 502);
  }
  // Point our record at the new seat before releasing the old one, so the
  // cancellation webhook for the old seat finds nothing to cancel on our side.
  const { data, error } = await db()
    .from('bookings')
    .update({
      event_type_id: eventTypeId,
      label: et.label,
      start_at: seats.rider.start || start,
      end_at: seats.rider.end || null,
      cal_uid: seats.rider.uid,
      seat_uid: seats.rider.seatUid,
      partner_cal_uid: seats.partner?.uid ?? null,
      partner_seat_uid: seats.partner?.seatUid ?? null
    })
    .eq('id', booking.id)
    .select('*')
    .single();
  if (error) throw error;
  await cancelSeat(booking.cal_uid, booking.seat_uid, 'Rescheduled by rider').catch((e) =>
    console.error('Old seat cancel failed after reschedule, cancel it in Cal.com', booking.cal_uid, e)
  );
  if (booking.with_partner && booking.partner_cal_uid) {
    await cancelSeat(booking.partner_cal_uid, booking.partner_seat_uid, 'Rescheduled by rider').catch((e) =>
      console.error('Old partner seat cancel failed after reschedule', booking.partner_cal_uid, e)
    );
  }
  return data as Booking;
}

async function markCancelled(order: Order, booking: Booking, giveCreditBack: boolean) {
  const { data } = await db()
    .from('bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), credit_returned: giveCreditBack })
    .eq('id', booking.id)
    .eq('status', 'booked')
    .select('id');
  if (!data || data.length === 0) return; // already handled
  if (giveCreditBack) await returnCredit(order.id);
  if (booking.with_partner) await db().from('orders').update({ partner_used: false }).eq('id', order.id);
}

// Called from the Cal.com webhook when a booking changes outside this app
// (a link in a Cal.com email, or the team in the Cal.com dashboard).
// We re-read the booking from Cal.com instead of trusting the webhook payload.
export async function reconcileCancelled(uid: string, cancelledBy?: string | null) {
  const { data: rows } = await db().from('bookings').select('*, orders(*)').eq('cal_uid', uid).eq('status', 'booked');
  if (!rows || rows.length === 0) return;
  let live: Awaited<ReturnType<typeof getBooking>> | null = null;
  try {
    live = await getBooking(uid);
  } catch {
    live = null;
  }
  for (const row of rows as (Booking & { orders: Order })[]) {
    const order = row.orders;
    const seatGone =
      !live ||
      live.status === 'cancelled' ||
      (row.seat_uid ? !live.attendees?.some((a) => a.seatUid === row.seat_uid) : false);
    if (!seatGone) continue;
    const by = (cancelledBy || '').toLowerCase();
    const riderCancelledLate = hoursUntil(row.start_at) < CHANGE_DEADLINE_HOURS && (!by || by === order.rider_email.toLowerCase());
    await markCancelled(order, row, !riderCancelledLate);
  }
}

export async function reconcileRescheduled(oldUid: string, newUid: string, start: string, end: string | null) {
  await db()
    .from('bookings')
    .update({ cal_uid: newUid, start_at: start, end_at: end })
    .eq('cal_uid', oldUid)
    .eq('status', 'booked');
}
