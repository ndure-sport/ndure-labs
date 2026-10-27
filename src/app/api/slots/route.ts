import { publicSlots } from '@/lib/booking';
import { json, fail } from '@/lib/util';

// Free sessions for the sign up page. need=2 when a training partner rides along.
export async function GET(req: Request) {
  const need = new URL(req.url).searchParams.get('need') === '2' ? 2 : 1;
  try {
    const slots = await publicSlots(need);
    return json({
      need,
      slots: slots.map((s) => ({ eventTypeId: s.eventTypeId, label: s.label, start: s.start, end: s.end, free: s.free, seats: s.seats }))
    });
  } catch (e) {
    console.error('Public slots failed', e);
    return fail('Could not load free sessions. Try again in a moment.', 502);
  }
}
