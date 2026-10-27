// Fake backend for the clickable demo. It answers the same /api/* calls the real
// server does, using the real pricing, policy and order logic, so the demo behaves
// like the live app. Nothing leaves the browser.

import { DEFAULT_PRICING, quote } from '../src/lib/pricing';
import { canChange, CHANGE_DEADLINE_HOURS, REQUIRED_CONSENTS } from '../src/lib/policy';
import { publicOrder } from '../src/lib/public';
import type { Order, Booking } from '../src/lib/db';

export const SESSION_TYPES = [
  { id: 1, label: 'Morning', time: '09:30', seats: 2, minutes: 150 },
  { id: 2, label: 'Afternoon', time: '13:00', seats: 1, minutes: 180 }
];
const WEEKS = 6;

type Db = { orders: Map<string, Order>; bookings: Booking[]; seeded: Map<string, number> };
export const db: Db = { orders: new Map(), bookings: [], seeded: new Map() };
export const demoFlags = { failNextBooking: false };

const key = (et: number, iso: string) => `${et}|${new Date(iso).getTime()}`;
const pad = (n: number) => String(n).padStart(2, '0');
let seq = 0;
const id = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`;
const token = () => Array.from({ length: 28 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join('');

// Copenhagen is UTC+1 in winter, UTC+2 from the last Sunday of March.
function cphOffset(y: number, m: number, d: number) {
  const lastSun = (month: number) => {
    const last = new Date(Date.UTC(y, month + 1, 0));
    return last.getUTCDate() - last.getUTCDay();
  };
  const t = Date.UTC(y, m, d);
  const summer = t >= Date.UTC(y, 2, lastSun(2)) && t < Date.UTC(y, 9, lastSun(9));
  return summer ? '+02:00' : '+01:00';
}

export function allSlotDefs() {
  const out: { eventTypeId: number; label: string; start: string; end: string; seats: number }[] = [];
  const now = new Date();
  for (let i = 1; i <= WEEKS * 7; i++) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    const dow = day.getUTCDay();
    if (dow < 2 || dow > 5) continue; // Tuesday to Friday
    const y = day.getUTCFullYear(), m = day.getUTCMonth(), d = day.getUTCDate();
    for (const t of SESSION_TYPES) {
      const start = `${y}-${pad(m + 1)}-${pad(d)}T${t.time}:00${cphOffset(y, m, d)}`;
      const end = new Date(new Date(start).getTime() + t.minutes * 60_000).toISOString();
      out.push({ eventTypeId: t.id, label: t.label, start, end, seats: t.seats });
    }
  }
  return out;
}

// Some sessions are already partly booked by other (pretend) riders, so the calendar looks real.
export function seed() {
  db.seeded.clear();
  const defs = allSlotDefs();
  defs.forEach((s, i) => {
    const r = (i * 7919 + new Date(s.start).getUTCDate() * 31) % 10;
    const taken = i < 3 ? (s.seats > 1 ? 1 : 0) : r < 3 ? s.seats : r < 6 ? Math.min(1, s.seats) : 0;
    if (taken) db.seeded.set(key(s.eventTypeId, s.start), taken);
  });
}

function takenAt(et: number, start: string, excludeBooking?: string) {
  let n = db.seeded.get(key(et, start)) ?? 0;
  for (const b of db.bookings) {
    if (b.status === 'booked' && b.id !== excludeBooking && b.event_type_id === et && new Date(b.start_at).getTime() === new Date(start).getTime()) {
      n += b.with_partner ? 2 : 1;
    }
  }
  return n;
}

function slots(need: number, exclude?: Booking) {
  const now = Date.now();
  return allSlotDefs()
    .map((s) => ({ ...s, free: Math.max(0, s.seats - takenAt(s.eventTypeId, s.start)) }))
    .filter((s) => s.free >= need && new Date(s.start).getTime() > now)
    .filter((s) => !exclude || new Date(s.start).getTime() !== new Date(exclude.start_at).getTime());
}

function freeAt(et: number, start: string) {
  const def = allSlotDefs().find((s) => s.eventTypeId === et && new Date(s.start).getTime() === new Date(start).getTime());
  return def ? def.seats - takenAt(et, start) : 0;
}

class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function bookFor(o: Order, et: number, start: string): Booking {
  const withPartner = o.partner && !o.partner_used;
  if (o.credits_left < 1) throw new ApiError('You have no sessions left on this order.', 409);
  if (freeAt(et, start) < (withPartner ? 2 : 1)) throw new ApiError('This session just filled up. Pick another one.', 409);
  const def = SESSION_TYPES.find((t) => t.id === et)!;
  const b: Booking = {
    id: id(), order_id: o.id, created_at: new Date().toISOString(), status: 'booked', event_type_id: et, label: def.label,
    start_at: new Date(start).toISOString(), end_at: new Date(new Date(start).getTime() + def.minutes * 60_000).toISOString(),
    cal_uid: id(), seat_uid: id(), with_partner: withPartner, partner_cal_uid: null, partner_seat_uid: null, cancelled_at: null, credit_returned: false
  };
  db.bookings.push(b);
  o.credits_left -= 1;
  if (withPartner) o.partner_used = true;
  return b;
}

// Called by the fake payment screen.
export function payOrder(tok: string) {
  const o = db.orders.get(tok);
  if (!o) return;
  o.status = 'paid';
  o.paid_at = new Date().toISOString();
  o.amount_paid = o.total;
  o.credits_left = o.qty;
  if (o.first_status === 'pending') {
    // Like Stripe's webhook: confirm a moment later, then book the held seat.
    setTimeout(() => {
      try {
        if (demoFlags.failNextBooking) throw new Error('simulated');
        bookFor(o, o.first_event_type_id!, o.first_start!);
        o.first_status = 'booked';
      } catch {
        o.first_status = 'failed';
      }
      demoFlags.failNextBooking = false;
    }, 2200);
  }
}

export function ordersWithBookings() {
  return { orders: [...db.orders.values()], bookings: db.bookings };
}

async function handle(method: string, url: URL, body: any): Promise<unknown> {
  const p = url.pathname;

  if (method === 'GET' && p === '/api/slots') {
    return { need: url.searchParams.get('need') === '2' ? 2 : 1, slots: slots(url.searchParams.get('need') === '2' ? 2 : 1) };
  }

  if (method === 'POST' && p === '/api/checkout') {
    const name = String(body?.rider?.name ?? '').trim();
    const email = String(body?.rider?.email ?? '').trim().toLowerCase();
    if (!name) throw new ApiError('Please fill in your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ApiError('Please fill in a valid email address.');
    for (const k of REQUIRED_CONSENTS) if (body?.consents?.[k] !== true) throw new ApiError('Please tick the readiness check, data consent and terms.');
    const q = quote(DEFAULT_PRICING, { qty: body?.qty, partner: !!body?.partner, addons: body?.addons ?? [] });
    const slot = body?.slot;
    if (!slot && !(body?.later && q.qty > 1)) throw new ApiError('Pick a date for your session.');
    if (slot && freeAt(slot.eventTypeId, slot.start) < (q.partner ? 2 : 1)) throw new ApiError('That session just filled up. Pick another one.', 409);
    const t = token();
    const o: Order = {
      id: id(), token: t, status: 'pending', created_at: new Date().toISOString(), paid_at: null,
      rider_name: name, rider_email: email, rider_phone: body?.rider?.phone || null, ftp: Number(body?.rider?.ftp) || null, goal: body?.rider?.goal || null,
      qty: q.qty, unit_price: q.unit, total: q.total, amount_paid: null, addons: q.addons, credits_left: 0,
      partner: q.partner, partner_name: body?.partnerInfo?.name || null, partner_email: body?.partnerInfo?.email || null,
      partner_token: q.partner ? token() : null, partner_used: false, partner_consents: null,
      consents: { items: Object.fromEntries(Object.entries(body?.consents ?? {}).map(([k, v]) => [k, { agreed: v }])) },
      consent_version: 'demo', src: body?.src ?? 'demo', stripe_session_id: null,
      first_event_type_id: slot ? slot.eventTypeId : null, first_start: slot ? new Date(slot.start).toISOString() : null, first_status: slot ? 'pending' : 'none'
    };
    db.orders.set(t, o);
    return { url: `demo-pay:${t}` };
  }

  const m = p.match(/^\/api\/order\/([^/]+)(\/slots|\/book)?$/);
  if (m) {
    const o = db.orders.get(m[1]);
    if (!o) throw new ApiError('Order not found.', 404);
    const mine = () => db.bookings.filter((b) => b.order_id === o.id).sort((a, b) => a.start_at.localeCompare(b.start_at));
    if (!m[2] && method === 'GET') return publicOrder(o, mine());

    if (m[2] === '/slots' && method === 'GET') {
      const bid = url.searchParams.get('booking');
      const existing = bid ? mine().find((b) => b.id === bid && b.status === 'booked') : undefined;
      if (bid && !existing) throw new ApiError('Session not found.', 404);
      if (!bid && o.credits_left < 1) throw new ApiError('You have no sessions left to book.', 409);
      const need = existing ? (existing.with_partner ? 2 : 1) : o.partner && !o.partner_used ? 2 : 1;
      return { need, slots: slots(need, existing) };
    }

    if (m[2] === '/book' && method === 'POST') {
      if (body?.action === 'book') {
        bookFor(o, Number(body.eventTypeId), body.start);
      } else {
        const b = mine().find((x) => x.id === body?.bookingId);
        if (!b || b.status !== 'booked') throw new ApiError('Session not found.', 404);
        if (!canChange(b.start_at)) throw new ApiError(`Sessions can be changed up to ${CHANGE_DEADLINE_HOURS} hours before. Email contact@ndure.dk if something came up.`, 409);
        if (body.action === 'cancel') {
          b.status = 'cancelled';
          b.cancelled_at = new Date().toISOString();
          b.credit_returned = true;
          o.credits_left += 1;
          if (b.with_partner) o.partner_used = false;
        } else if (body.action === 'reschedule') {
          const need = b.with_partner ? 2 : 1;
          const free = freeAt(Number(body.eventTypeId), body.start);
          if (free < need) throw new ApiError('This session just filled up. Pick another one.', 409);
          const def = SESSION_TYPES.find((t) => t.id === Number(body.eventTypeId))!;
          b.event_type_id = def.id;
          b.label = def.label;
          b.start_at = new Date(body.start).toISOString();
          b.end_at = new Date(new Date(body.start).getTime() + def.minutes * 60_000).toISOString();
        } else throw new ApiError('Unknown action.');
      }
      return publicOrder(o, mine());
    }
  }
  throw new ApiError('Not found in demo.', 404);
}

export function installFetch() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'https://demo.local');
    if (!url.pathname.startsWith('/api/')) return real(input, init);
    await new Promise((r) => setTimeout(r, 250)); // feel like a network
    let body: unknown = null;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      body = null;
    }
    try {
      const data = await handle((init?.method || 'GET').toUpperCase(), url, body);
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      return new Response(JSON.stringify({ error: (e as Error).message }), { status, headers: { 'Content-Type': 'application/json' } });
    }
  };
}
