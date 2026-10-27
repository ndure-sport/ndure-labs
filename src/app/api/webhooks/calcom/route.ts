import { verifyWebhook } from '@/lib/calcom';
import { reconcileCancelled, reconcileRescheduled } from '@/lib/booking';

// Keeps our records in sync when a booking is changed outside this app:
// a reschedule or cancel link in a Cal.com email, or the team in the Cal.com dashboard.

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get('x-cal-signature-256'))) {
    return new Response('bad signature', { status: 401 });
  }
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const trigger: string = body?.triggerEvent;
  const p = body?.payload ?? {};

  try {
    if (trigger === 'BOOKING_CANCELLED' && p.uid) {
      await reconcileCancelled(String(p.uid), p.cancelledBy ?? p.cancelledByEmail ?? null);
    }
    if (trigger === 'BOOKING_RESCHEDULED' && p.uid) {
      const oldUid = p.rescheduleUid ?? p.fromReschedule ?? p.rescheduledFromUid;
      if (oldUid) await reconcileRescheduled(String(oldUid), String(p.uid), p.startTime, p.endTime ?? null);
    }
  } catch (e) {
    console.error('Cal.com webhook handling failed', trigger, e);
    return new Response('error', { status: 500 }); // Cal.com retries
  }
  return new Response('ok', { status: 200 });
}
