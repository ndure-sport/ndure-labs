import { orderByToken, bookingsFor } from '@/lib/db';
import { availableSlots } from '@/lib/booking';
import { json, fail } from '@/lib/util';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = await orderByToken(token);
  if (!order) return fail('Order not found.', 404);
  if (order.status !== 'paid') return fail('This order is not paid yet.', 402);

  const bookingId = new URL(req.url).searchParams.get('booking');
  let existing;
  if (bookingId) {
    existing = (await bookingsFor(order.id)).find((b) => b.id === bookingId && b.status === 'booked');
    if (!existing) return fail('Session not found.', 404);
  } else if (order.credits_left < 1) {
    return fail('You have no sessions left to book.', 409);
  }

  try {
    const { need, slots } = await availableSlots(order, existing);
    return json({
      need,
      slots: slots.map((s) => ({ eventTypeId: s.eventTypeId, label: s.label, start: s.start, end: s.end, free: s.free, seats: s.seats }))
    });
  } catch (e) {
    console.error('Slots failed', e);
    return fail('Could not load free sessions. Try again in a moment.', 502);
  }
}
