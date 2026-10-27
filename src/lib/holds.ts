import 'server-only';
import { db } from './db';

// Seats held for riders who are paying right now (Stripe Checkout stays open 30 minutes).
export const HOLD_MINUTES = 35;

export function slotKey(eventTypeId: number, iso: string): string {
  return `${eventTypeId}|${new Date(iso).getTime()}`;
}

export async function heldSeats(fromIso: string, toIso: string, excludeOrder?: string): Promise<Map<string, number>> {
  let q = db()
    .from('holds')
    .select('order_id, event_type_id, start_at, seats')
    .gt('expires_at', new Date().toISOString())
    .gte('start_at', fromIso)
    .lte('start_at', toIso);
  if (excludeOrder) q = q.neq('order_id', excludeOrder);
  const { data, error } = await q;
  if (error) throw error;
  const map = new Map<string, number>();
  for (const h of data ?? []) {
    const k = slotKey(h.event_type_id, h.start_at);
    map.set(k, (map.get(k) ?? 0) + h.seats);
  }
  return map;
}

export async function placeHold(orderId: string, eventTypeId: number, start: string, seats: number, free: number): Promise<boolean> {
  const { data, error } = await db().rpc('place_hold', {
    p_order: orderId,
    p_et: eventTypeId,
    p_start: new Date(start).toISOString(),
    p_seats: seats,
    p_free: free,
    p_minutes: HOLD_MINUTES
  });
  if (error) throw error;
  return data === true;
}

export async function releaseHolds(orderId: string): Promise<void> {
  await db().from('holds').delete().eq('order_id', orderId);
}
