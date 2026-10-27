import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env, eventTypes, TIME_ZONE, type EventTypeConfig } from './env';

// Thin wrapper around the Cal.com API v2.
// Docs: https://cal.com/docs/api-reference/v2
// The API version headers are pinned; Cal.com falls back to old behaviour without them.
const BASE = 'https://api.cal.com/v2';
const SLOTS_VERSION = process.env.CALCOM_SLOTS_API_VERSION || '2024-09-04';
const BOOKINGS_VERSION = process.env.CALCOM_BOOKINGS_API_VERSION || '2026-02-25';

export class CalcomError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call<T>(path: string, version: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${env('CALCOM_API_KEY')}`,
      'cal-api-version': version,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    },
    cache: 'no-store'
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok || body?.status === 'error') {
    const msg = body?.error?.message || body?.message || `Cal.com request failed (${res.status})`;
    throw new CalcomError(typeof msg === 'string' ? msg : JSON.stringify(msg), res.status);
  }
  return body?.data as T;
}

export type Slot = {
  eventTypeId: number;
  label: string;
  start: string; // ISO with offset
  end: string | null;
  seats: number;
  taken: number;
  free: number;
};

type RawSlot = string | { start: string; end?: string; attendeesCount?: number; bookingUid?: string };

export async function slotsFor(et: EventTypeConfig, startIso: string, endIso: string): Promise<Slot[]> {
  const qs = new URLSearchParams({
    eventTypeId: String(et.id),
    start: startIso,
    end: endIso,
    timeZone: TIME_ZONE,
    format: 'range'
  });
  const data = await call<Record<string, RawSlot[]>>(`/slots?${qs}`, SLOTS_VERSION);
  const out: Slot[] = [];
  for (const list of Object.values(data || {})) {
    for (const s of list) {
      const start = typeof s === 'string' ? s : s.start;
      const end = typeof s === 'string' ? null : s.end ?? null;
      const taken = typeof s === 'string' ? 0 : s.attendeesCount ?? 0;
      out.push({ eventTypeId: et.id, label: et.label, start, end, seats: et.seats, taken, free: Math.max(0, et.seats - taken) });
    }
  }
  return out;
}

export async function allSlots(startIso: string, endIso: string): Promise<Slot[]> {
  const lists = await Promise.all(eventTypes().map((et) => slotsFor(et, startIso, endIso)));
  return lists.flat().sort((a, b) => a.start.localeCompare(b.start));
}

export function sameInstant(a: string, b: string): boolean {
  return new Date(a).getTime() === new Date(b).getTime();
}

type RawBooking = {
  uid: string;
  id: number;
  status: string;
  start: string;
  end: string;
  seatUid?: string;
  attendees?: { email: string; name: string; seatUid?: string }[];
  cancelledByEmail?: string;
};

export type CreatedSeat = { uid: string; seatUid: string | null; start: string; end: string };

export async function createBooking(input: {
  eventTypeId: number;
  start: string;
  name: string;
  email: string;
  phone?: string | null;
  metadata?: Record<string, string>;
}): Promise<CreatedSeat> {
  const attendee: Record<string, string> = {
    name: input.name,
    email: input.email,
    timeZone: TIME_ZONE,
    language: 'en'
  };
  // Cal.com wants international format; skip anything else rather than fail the booking.
  if (input.phone && /^\+\d{7,15}$/.test(input.phone.replace(/\s/g, ''))) {
    attendee.phoneNumber = input.phone.replace(/\s/g, '');
  }
  const data = await call<RawBooking | RawBooking[]>('/bookings', BOOKINGS_VERSION, {
    method: 'POST',
    body: JSON.stringify({
      start: new Date(input.start).toISOString(),
      eventTypeId: input.eventTypeId,
      attendee,
      metadata: input.metadata ?? {}
    })
  });
  const b = Array.isArray(data) ? data[0] : data;
  const seatUid =
    b.seatUid ??
    b.attendees?.find((a) => a.email.toLowerCase() === input.email.toLowerCase())?.seatUid ??
    null;
  return { uid: b.uid, seatUid, start: b.start, end: b.end };
}

export async function cancelSeat(uid: string, seatUid: string | null, reason: string): Promise<void> {
  const body: Record<string, string> = { cancellationReason: reason };
  if (seatUid) body.seatUid = seatUid;
  await call(`/bookings/${encodeURIComponent(uid)}/cancel`, BOOKINGS_VERSION, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function getBooking(uid: string): Promise<RawBooking> {
  return call<RawBooking>(`/bookings/${encodeURIComponent(uid)}`, BOOKINGS_VERSION);
}

// Cal.com signs webhooks with HMAC SHA256 of the raw body, hex encoded, in x-cal-signature-256.
export function verifyWebhook(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', env('CALCOM_WEBHOOK_SECRET')).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
