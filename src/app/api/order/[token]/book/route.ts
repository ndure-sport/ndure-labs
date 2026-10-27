import { orderByToken, bookingsFor } from '@/lib/db';
import { book, reschedule, cancel, BookingError } from '@/lib/booking';
import { publicOrder } from '@/lib/public';
import { json, fail } from '@/lib/util';

// One endpoint for the three things a rider can do with a session:
//   { action: "book", eventTypeId, start }
//   { action: "reschedule", bookingId, eventTypeId, start }
//   { action: "cancel", bookingId }
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = await orderByToken(token);
  if (!order) return fail('Order not found.', 404);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid request.');
  }

  const eventTypeId = Number(body?.eventTypeId);
  const start = typeof body?.start === 'string' && !Number.isNaN(Date.parse(body.start)) ? body.start : null;

  try {
    if (body?.action === 'book') {
      if (!eventTypeId || !start) return fail('Pick a day and session.');
      await book(order, eventTypeId, start);
    } else if (body?.action === 'reschedule' || body?.action === 'cancel') {
      const existing = (await bookingsFor(order.id)).find((b) => b.id === body?.bookingId);
      if (!existing) return fail('Session not found.', 404);
      if (body.action === 'cancel') await cancel(order, existing);
      else {
        if (!eventTypeId || !start) return fail('Pick a day and session.');
        await reschedule(order, existing, eventTypeId, start);
      }
    } else {
      return fail('Unknown action.');
    }
  } catch (e) {
    if (e instanceof BookingError) return fail(e.message, e.status);
    console.error('Booking action failed', body?.action, e);
    return fail('Something went wrong. Nothing was changed, try again.', 500);
  }

  const fresh = await orderByToken(token);
  return json(publicOrder(fresh!, await bookingsFor(order.id)));
}
