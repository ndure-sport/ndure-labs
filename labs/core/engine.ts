// NDURE Labs booking engine: every rule lives here, with no knowledge of how data is stored
// or how pages look. The prototype runs it in the browser; the live app runs the same code
// on Cloudflare with a real database.

import type { Config, Block } from './config';
import type { Db, Customer, Order, Booking, Email, ConsentKey, Consents } from './types';
import { localStarts, addMonths, cphDate, hours, days, when, fmt } from './time';

export const CONSENT_VERSION = '2026-10-27';
export const CONSENT_TEXT: Record<ConsentKey, string> = {
  ready: 'I answered no to every question in the readiness check and I am fit for a maximal effort.',
  health: 'I explicitly consent to NDURE ApS processing my health data (blood lactate, heart rate, power) to make my report.',
  terms: 'I accept the terms and cancellation policy.',
  research: 'Optional: NDURE may use my anonymised sensor data to develop its sensor.',
  film: 'Optional: I am fine with being filmed for NDURE content.'
};
export const REQUIRED_CONSENTS: ConsentKey[] = ['ready', 'health', 'terms'];

export class LabsError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

export type Slot = { start: string; end: string; blockId: string; label: string; capacity: number; taken: number; free: number };

export type Quote = {
  qty: number;
  unit: number;
  single: number;
  saving: number;
  total: number;
  lines: { label: string; amount: number }[];
  next: { more: number; unit: number } | null;
};

export function quote(config: Config, qty: number, partner: boolean): Quote {
  const n = Math.trunc(Number(qty));
  if (!Number.isFinite(n) || n < 1 || n > config.maxQty) throw new LabsError(`Choose between 1 and ${config.maxQty} sessions.`, 'qty');
  const tiers = [...config.tiers].sort((a, b) => a.min - b.min);
  const single = tiers[0].unit;
  let unit = single;
  for (const t of tiers) if (n >= t.min) unit = t.unit;
  const saving = n * (single - unit);
  const lines = [{ label: `Lactate session × ${n}`, amount: n * single }];
  if (saving > 0) lines.push({ label: `Price for ${n} sessions (${unit} each)`, amount: -saving });
  if (partner) lines.push({ label: 'Training partner, same session', amount: config.partnerPrice });
  const next = tiers.find((t) => t.min > n);
  return { qty: n, unit, single, saving, total: lines.reduce((s, l) => s + l.amount, 0), lines, next: next ? { more: next.min - n, unit: next.unit } : null };
}

type Now = () => number;

export class Labs {
  constructor(public db: Db, public config: Config, private now: Now) {}

  // ---------- helpers ----------
  private id(prefix: string) {
    this.db.seq += 1;
    return `${prefix}${this.db.seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }
  private iso(ms = this.now()) {
    return new Date(ms).toISOString();
  }
  private block(id: string): Block {
    const b = this.config.blocks.find((x) => x.id === id);
    if (!b) throw new LabsError('Unknown session.', 'block');
    return b;
  }
  customer(id: string): Customer {
    const c = this.db.customers.find((x) => x.id === id);
    if (!c) throw new LabsError('Customer not found.', 'customer');
    return c;
  }
  customerByEmail(email: string): Customer | undefined {
    return this.db.customers.find((c) => c.email === email.trim().toLowerCase());
  }
  order(id: string): Order {
    const o = this.db.orders.find((x) => x.id === id);
    if (!o) throw new LabsError('Order not found.', 'order');
    return o;
  }
  booking(id: string): Booking {
    const b = this.db.bookings.find((x) => x.id === id);
    if (!b) throw new LabsError('Session not found.', 'booking');
    return b;
  }
  private sameStart(a: string, b: string) {
    return Date.parse(a) === Date.parse(b);
  }

  // ---------- sessions and seats ----------
  private takenAt(start: string, opts: { excludeOrder?: string; excludeBooking?: string } = {}) {
    const now = this.now();
    let n = 0;
    for (const b of this.db.bookings) {
      if (b.status === 'cancelled' || b.id === opts.excludeBooking) continue;
      if (this.sameStart(b.start, start)) n += b.seats;
    }
    for (const h of this.db.holds) {
      if (h.orderId === opts.excludeOrder || Date.parse(h.expiresAt) <= now) continue;
      if (this.sameStart(h.start, start)) n += h.seats;
    }
    return n;
  }

  private slotDef(start: string) {
    const ms = Date.parse(start);
    const found = localStarts(ms, ms, this.config.days, this.config.blocks).find((s) => Date.parse(s.start) === ms);
    if (!found) return null;
    if (this.db.closed.some((c) => c.date === found.date)) return null;
    return { ...found, block: this.block(found.blockId) };
  }

  // Sessions a rider can still book: leaves out the ones they're already in.
  slotsFor(customerId: string, need = 1, opts: { excludeBooking?: string } = {}): Slot[] {
    const mine = this.db.bookings.filter((b) => b.customerId === customerId && b.status === 'booked' && b.id !== opts.excludeBooking);
    return this.slots(need, opts).filter((s) => !mine.some((b) => this.sameStart(b.start, s.start)));
  }

  slots(need = 1, opts: { excludeOrder?: string; excludeBooking?: string; team?: boolean } = {}): Slot[] {
    const now = this.now();
    const from = now + hours(opts.team ? 0 : this.config.minNoticeHours);
    const to = now + days(7 * this.config.bookingWeeksAhead);
    return localStarts(from, to, this.config.days, this.config.blocks)
      .filter((s) => !this.db.closed.some((c) => c.date === s.date))
      .map((s) => {
        const b = this.block(s.blockId);
        const taken = this.takenAt(s.start, opts);
        return {
          start: s.start,
          end: this.iso(Date.parse(s.start) + b.minutes * 60_000),
          blockId: b.id,
          label: b.label,
          capacity: b.capacity,
          taken,
          free: Math.max(0, b.capacity - taken)
        };
      })
      .filter((s) => s.free >= need);
  }

  private assertBookable(start: string, need: number, opts: { excludeOrder?: string; excludeBooking?: string; team?: boolean }) {
    const def = this.slotDef(start);
    if (!def) throw new LabsError('There is no session at that time.', 'no_session');
    const ms = Date.parse(start);
    if (ms <= this.now()) throw new LabsError('That session has already started.', 'past');
    if (!opts.team && ms < this.now() + hours(this.config.minNoticeHours)) {
      throw new LabsError(`Sessions can be booked up to ${this.config.minNoticeHours} hours before they start.`, 'too_soon');
    }
    const free = def.block.capacity - this.takenAt(start, opts);
    if (free < need) {
      throw new LabsError(need > 1 ? 'There are no longer 2 free spots in that session. Pick another one.' : 'That session just filled up. Pick another one.', 'slot_taken');
    }
    return def;
  }

  // ---------- emails ----------
  private send(to: string, template: Email['template'], key: string, subject: string, body: string) {
    if (this.db.emails.some((e) => e.key === key)) return;
    this.db.emails.push({ id: this.id('e'), key, to, template, subject, body, at: this.iso() });
  }

  // ---------- sign up and payment ----------
  checkout(input: {
    qty: number;
    partner: boolean;
    partnerName?: string;
    partnerEmail?: string;
    start?: string | null;
    later?: boolean;
    name: string;
    email: string;
    phone?: string;
    ftp?: number | null;
    goal?: string;
    consents: Partial<Record<ConsentKey, boolean>>;
    src?: string;
  }): Order {
    const q = quote(this.config, input.qty, input.partner);
    const name = (input.name || '').trim();
    const email = (input.email || '').trim().toLowerCase();
    if (!name) throw new LabsError('Fill in your name.', 'name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new LabsError('Fill in a valid email address.', 'email');
    for (const k of REQUIRED_CONSENTS) if (!input.consents[k]) throw new LabsError('Tick the readiness check, data consent and terms.', 'consent');
    if (input.partner) {
      if (!input.partnerName?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((input.partnerEmail || '').trim())) {
        throw new LabsError("Fill in your partner's name and email.", 'partner');
      }
      if (input.partnerEmail!.trim().toLowerCase() === email) throw new LabsError('Your partner needs their own email address.', 'partner');
    }
    if (!input.start && !(input.later && q.qty > 1)) throw new LabsError('Pick a date for your session.', 'date');
    const need = input.partner ? 2 : 1;
    if (input.start) this.assertBookable(input.start, need, {});

    const consents: Consents = {
      at: this.iso(),
      version: CONSENT_VERSION,
      items: Object.fromEntries((Object.keys(CONSENT_TEXT) as ConsentKey[]).map((k) => [k, !!input.consents[k]])) as Record<ConsentKey, boolean>
    };
    let c = this.customerByEmail(email);
    if (!c) {
      c = { id: this.id('c'), email, name, phone: null, ftp: null, goal: null, createdAt: this.iso(), consents: null };
      this.db.customers.push(c);
    }
    c.name = name;
    c.phone = input.phone?.trim() || c.phone;
    c.ftp = input.ftp ?? c.ftp;
    c.goal = input.goal || c.goal;
    c.consents = consents;

    const o: Order = {
      id: this.id('o'),
      customerId: c.id,
      status: 'pending',
      qty: q.qty,
      unit: q.unit,
      total: q.total,
      remaining: 0,
      partner: input.partner,
      partnerName: input.partner ? input.partnerName!.trim() : null,
      partnerEmail: input.partner ? input.partnerEmail!.trim().toLowerCase() : null,
      partnerUsed: false,
      free: false,
      src: input.src || null,
      createdAt: this.iso(),
      paidAt: null,
      expiresAt: null,
      firstStart: input.start || null,
      firstStatus: input.start ? 'pending' : 'none'
    };
    this.db.orders.push(o);
    if (input.start) {
      this.db.holds.push({ orderId: o.id, start: input.start, seats: need, expiresAt: this.iso(this.now() + this.config.holdMinutes * 60_000) });
    }
    return o;
  }

  // Called when Stripe confirms the payment.
  paid(orderId: string): Order {
    const o = this.order(orderId);
    if (o.status === 'paid') return o; // Stripe can send the same message twice
    if (o.status !== 'pending') throw new LabsError('This order can no longer be paid.', 'order_closed');
    o.status = 'paid';
    o.paidAt = this.iso();
    o.expiresAt = this.iso(addMonths(this.now(), this.config.validityMonths));
    o.remaining = o.qty;
    const c = this.customer(o.customerId);
    this.send(
      c.email,
      'payment',
      `payment:${o.id}`,
      'Payment received, NDURE Labs',
      `Hi ${c.name.split(' ')[0]},\n\nThanks, we received ${this.money(o.total)} for ${o.qty} ${o.qty === 1 ? 'session' : 'sessions'}${o.partner ? ' and a training partner' : ''}. They are valid until ${fmt(o.expiresAt, { day: 'numeric', month: 'long', year: 'numeric' })}.\n\nLog in with your email at book.ndure.dk/account to book, change or cancel sessions.`
    );
    if (o.firstStart) {
      try {
        this.book(o.customerId, o.firstStart, { orderId: o.id, by: 'rider', fromHold: true });
        o.firstStatus = 'booked';
      } catch {
        o.firstStatus = 'failed';
        this.send(c.email, 'cancelled', `firstfail:${o.id}`, 'Please pick another time', `The session you picked (${when(o.firstStart)}) filled up while you were paying. Your session is safe in your account: log in at book.ndure.dk/account to choose another time.`);
      }
    }
    this.db.holds = this.db.holds.filter((h) => h.orderId !== o.id);
    if (o.partner && o.partnerEmail) {
      this.send(o.partnerEmail, 'partner', `partner:${o.id}`, `${c.name} signed you up for NDURE Labs`, `${c.name} added you as training partner. Before you ride, please do the readiness check and give your consent here: book.ndure.dk/consent/[link]`);
    }
    return o;
  }

  // Stripe tells us the payment window closed without payment.
  checkoutExpired(orderId: string) {
    const o = this.order(orderId);
    if (o.status !== 'pending') return;
    o.status = 'expired';
    this.db.holds = this.db.holds.filter((h) => h.orderId !== o.id);
  }

  // ---------- credits ----------
  private usableOrders(customerId: string) {
    const now = this.now();
    return this.db.orders
      .filter((o) => o.customerId === customerId && o.status === 'paid' && o.remaining > 0 && o.expiresAt && Date.parse(o.expiresAt) > now)
      .sort((a, b) => Date.parse(a.expiresAt!) - Date.parse(b.expiresAt!)); // use the credit that expires first
  }

  balance(customerId: string) {
    const orders = this.usableOrders(customerId);
    return { total: orders.reduce((n, o) => n + o.remaining, 0), orders };
  }

  // ---------- booking ----------
  book(customerId: string, start: string, opts: { orderId?: string; by: 'rider' | 'team'; fromHold?: boolean }): Booking {
    const c = this.customer(customerId);
    const order = opts.orderId ? this.order(opts.orderId) : this.usableOrders(customerId)[0];
    if (!order || order.status !== 'paid' || order.remaining < 1 || (order.expiresAt && Date.parse(order.expiresAt) <= this.now())) {
      throw new LabsError('You have no sessions left. Buy a session or a pack first.', 'no_credit');
    }
    const withPartner = order.partner && !order.partnerUsed;
    const seats = withPartner ? 2 : 1;
    if (this.db.bookings.some((b) => b.customerId === customerId && b.status === 'booked' && this.sameStart(b.start, start))) {
      throw new LabsError('You are already booked for that session.', 'already_booked');
    }
    const def = this.assertBookable(start, seats, { excludeOrder: opts.fromHold ? order.id : undefined, team: opts.by === 'team' });
    const b: Booking = {
      id: this.id('b'),
      customerId,
      orderId: order.id,
      start: def.start,
      end: this.iso(Date.parse(def.start) + def.block.minutes * 60_000),
      blockId: def.block.id,
      label: def.block.label,
      seats,
      withPartner,
      partnerName: withPartner ? order.partnerName : null,
      status: 'booked',
      createdAt: this.iso(),
      cancelledAt: null,
      cancelledBy: null,
      creditReturned: false
    };
    this.db.bookings.push(b);
    order.remaining -= 1;
    if (withPartner) order.partnerUsed = true;
    const left = this.balance(customerId).total;
    this.send(
      c.email,
      'confirmation',
      `confirm:${b.id}`,
      `Booked: ${when(b.start)}`,
      `You're booked for ${fmt(b.start, { weekday: 'long', day: 'numeric', month: 'long' })} at ${fmt(b.start, { hour: '2-digit', minute: '2-digit' })}${withPartner ? `, together with ${b.partnerName}` : ''}.\nDiplomvej 376, 2800 Kongens Lyngby. Bring cycling shoes and pedals.\n\nA calendar invite is attached. Change or cancel for free until ${this.config.changeDeadlineHours} hours before at book.ndure.dk/account.${left > 0 ? `\nYou have ${left} more ${left === 1 ? 'session' : 'sessions'} to book.` : ''}`
    );
    return b;
  }

  private assertChangeable(b: Booking, by: 'rider' | 'team') {
    if (b.status !== 'booked') throw new LabsError('This session is not booked.', 'not_booked');
    if (Date.parse(b.start) <= this.now()) throw new LabsError('This session has already started.', 'past');
    if (by === 'rider' && Date.parse(b.start) - this.now() < hours(this.config.changeDeadlineHours)) {
      throw new LabsError(`Changes are possible until ${this.config.changeDeadlineHours} hours before. Email contact@ndure.dk if something came up.`, 'too_late');
    }
  }

  reschedule(bookingId: string, start: string, by: 'rider' | 'team'): Booking {
    const b = this.booking(bookingId);
    this.assertChangeable(b, by);
    if (this.sameStart(b.start, start)) return b;
    if (this.db.bookings.some((x) => x.id !== b.id && x.customerId === b.customerId && x.status === 'booked' && this.sameStart(x.start, start))) {
      throw new LabsError('You are already booked for that session.', 'already_booked');
    }
    const def = this.assertBookable(start, b.seats, { excludeBooking: b.id, team: by === 'team' });
    const old = b.start;
    b.start = def.start;
    b.end = this.iso(Date.parse(def.start) + def.block.minutes * 60_000);
    b.blockId = def.block.id;
    b.label = def.block.label;
    // A moved session gets a fresh reminder.
    this.db.emails = this.db.emails.filter((e) => e.key !== `reminder:${b.id}`);
    const c = this.customer(b.customerId);
    this.send(c.email, 'rescheduled', `moved:${b.id}:${def.start}`, `Moved to ${when(def.start)}`, `Your session moved from ${when(old)} to ${when(def.start)}. The calendar invite is updated.`);
    return b;
  }

  // Riders cancel up to the deadline and always get the session back.
  // The team can cancel any time and chooses whether the session goes back (e.g. a sick coach: yes).
  cancel(bookingId: string, by: 'rider' | 'team', returnCredit = true): Booking {
    const b = this.booking(bookingId);
    this.assertChangeable(b, by);
    b.status = 'cancelled';
    b.cancelledAt = this.iso();
    b.cancelledBy = by;
    b.creditReturned = by === 'rider' ? true : returnCredit;
    const o = this.order(b.orderId);
    if (b.creditReturned) {
      o.remaining += 1;
      if (b.withPartner) o.partnerUsed = false;
    }
    const c = this.customer(b.customerId);
    this.send(
      c.email,
      'cancelled',
      `cancel:${b.id}`,
      `Cancelled: ${when(b.start)}`,
      `Your session on ${when(b.start)} is cancelled${by === 'team' ? ' by the NDURE team' : ''}.${b.creditReturned ? ' The session is back in your account.' : ''}`
    );
    return b;
  }

  markAttendance(bookingId: string, status: 'attended' | 'no_show'): Booking {
    const b = this.booking(bookingId);
    if (b.status === 'cancelled') throw new LabsError('This session was cancelled.', 'cancelled');
    if (Date.parse(b.start) > this.now()) throw new LabsError('Mark attendance once the session has started.', 'future');
    b.status = status; // a no show keeps the session used
    return b;
  }

  // ---------- team tools ----------
  giveSessions(input: { email: string; name: string; qty: number; note?: string }): Order {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new LabsError('Fill in a valid email address.', 'email');
    let c = this.customerByEmail(email);
    if (!c) {
      c = { id: this.id('c'), email, name: input.name.trim() || email, phone: null, ftp: null, goal: null, createdAt: this.iso(), consents: null };
      this.db.customers.push(c);
    }
    const o: Order = {
      id: this.id('o'), customerId: c.id, status: 'pending', qty: input.qty, unit: 0, total: 0, remaining: 0,
      partner: false, partnerName: null, partnerEmail: null, partnerUsed: false, free: true, src: input.note || 'team',
      createdAt: this.iso(), paidAt: null, expiresAt: null, firstStart: null, firstStatus: 'none'
    };
    this.db.orders.push(o);
    return this.paid(o.id);
  }

  refund(orderId: string): Order {
    const o = this.order(orderId);
    for (const b of this.db.bookings) {
      if (b.orderId === o.id && b.status === 'booked' && Date.parse(b.start) > this.now()) {
        b.status = 'cancelled';
        b.cancelledAt = this.iso();
        b.cancelledBy = 'team';
      }
    }
    o.status = 'refunded';
    o.remaining = 0;
    return o;
  }

  closeDay(date: string, reason: string) {
    if (!this.db.closed.some((c) => c.date === date)) this.db.closed.push({ date, reason });
  }

  // ---------- login with an emailed code ----------
  requestLogin(email: string, makeCode: () => string): void {
    const e = email.trim().toLowerCase();
    const c = this.customerByEmail(e);
    // Same answer whether or not the email exists, so nobody can test which emails are customers.
    if (!c) return;
    const recent = this.db.emails.filter((m) => m.to === e && m.template === 'login_code' && Date.parse(m.at) > this.now() - hours(1));
    if (recent.length >= 5) throw new LabsError('Too many codes requested. Try again in an hour.', 'rate');
    const code = makeCode();
    this.db.codes = this.db.codes.filter((x) => x.email !== e);
    this.db.codes.push({ email: e, code, expiresAt: this.iso(this.now() + this.config.loginCodeMinutes * 60_000), attempts: 0 });
    this.send(e, 'login_code', `code:${e}:${this.now()}`, `Your NDURE Labs code: ${code}`, `Your login code is ${code}. It works once and expires in ${this.config.loginCodeMinutes} minutes. If you didn't ask for it, ignore this email.`);
  }

  verifyLogin(email: string, code: string): Customer {
    const e = email.trim().toLowerCase();
    const rec = this.db.codes.find((x) => x.email === e);
    if (!rec || Date.parse(rec.expiresAt) <= this.now()) throw new LabsError('That code has expired. Ask for a new one.', 'code_expired');
    if (rec.attempts >= this.config.loginMaxAttempts) throw new LabsError('Too many wrong tries. Ask for a new code.', 'code_locked');
    if (rec.code !== code.trim()) {
      rec.attempts += 1;
      throw new LabsError('That code is not right.', 'code_wrong');
    }
    this.db.codes = this.db.codes.filter((x) => x !== rec);
    return this.customerByEmail(e)!;
  }

  // ---------- what a rider sees ----------
  account(customerId: string) {
    const now = this.now();
    const mine = this.db.bookings.filter((b) => b.customerId === customerId).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const upcoming = mine.filter((b) => b.status === 'booked' && Date.parse(b.start) > now);
    const past = mine.filter((b) => b.status !== 'cancelled' && Date.parse(b.start) <= now).reverse();
    const last = past.find((b) => b.status === 'attended' || b.status === 'booked');
    const nextDue = last && upcoming.length === 0 ? this.iso(Date.parse(last.start) + days(7 * this.config.emails.retestNudgeWeeks.at(-1)!)) : null;
    return {
      customer: this.customer(customerId),
      balance: this.balance(customerId),
      upcoming: upcoming.map((b) => ({ ...b, changeable: Date.parse(b.start) - now >= hours(this.config.changeDeadlineHours) })),
      past,
      nextDue,
      orders: this.db.orders.filter((o) => o.customerId === customerId && o.status !== 'pending' && o.status !== 'expired')
    };
  }

  // ---------- what the team sees ----------
  // Upcoming sessions, plus past ones nobody has marked as attended or no show yet.
  teamDays(fromMs = this.now() - hours(12)) {
    const now = this.now();
    const rows = this.db.bookings
      .filter((b) => b.status !== 'cancelled' && (Date.parse(b.start) >= fromMs || (b.status === 'booked' && Date.parse(b.start) < now)))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
      .map((b) => ({ ...b, customer: this.customer(b.customerId), order: this.order(b.orderId) }));
    const byDay = new Map<string, typeof rows>();
    for (const r of rows) byDay.set(cphDate(Date.parse(r.start)), [...(byDay.get(cphDate(Date.parse(r.start))) ?? []), r]);
    return [...byDay.entries()].map(([date, list]) => ({ date, list }));
  }

  customersOverview() {
    return this.db.customers.map((c) => ({ ...c, ...this.account(c.id) }));
  }

  // Calendar feed the team subscribes to once in Outlook or Google.
  calendarFeed(): string {
    const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NDURE Labs//Bookings//EN', 'X-WR-CALNAME:NDURE Labs sessions'];
    for (const b of this.db.bookings) {
      if (b.status === 'cancelled') continue;
      const c = this.customer(b.customerId);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${b.id}@book.ndure.dk`,
        `DTSTAMP:${stamp(b.createdAt)}`,
        `DTSTART:${stamp(new Date(b.start).toISOString())}`,
        `DTEND:${stamp(b.end)}`,
        `SUMMARY:Labs: ${c.name}${b.withPartner ? ` + ${b.partnerName}` : ''}`,
        'LOCATION:Diplomvej 376\\, 2800 Kongens Lyngby',
        'END:VEVENT'
      );
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // ---------- the scheduled job (runs every hour in production) ----------
  tick(): Email[] {
    const before = this.db.emails.length;
    const now = this.now();
    const E = this.config.emails;

    // Payment windows that closed: release their seats.
    for (const o of this.db.orders) {
      if (o.status === 'pending' && o.firstStart && !this.db.holds.some((h) => h.orderId === o.id && Date.parse(h.expiresAt) > now)) {
        this.checkoutExpired(o.id);
      }
    }
    this.db.holds = this.db.holds.filter((h) => Date.parse(h.expiresAt) > now);

    for (const b of this.db.bookings) {
      const c = this.customer(b.customerId);
      const start = Date.parse(b.start);
      if (b.status === 'booked' && start > now && start - now <= hours(E.reminderHoursBefore)) {
        this.send(c.email, 'reminder', `reminder:${b.id}`, `See you ${fmt(b.start, { weekday: 'long' })} at ${fmt(b.start, { hour: '2-digit', minute: '2-digit' })}`, `Your session is on ${when(b.start)} at Diplomvej 376, Kongens Lyngby.\n\nPrep: an easy day before, a normal meal 2 to 3 hours before, no caffeine in the last 2 hours. Bring cycling shoes, pedals, kit and a bottle. Showers and towels are on site.`);
      }
      if ((b.status === 'attended' || (b.status === 'booked' && start < now)) && now >= start + days(E.afterSessionDays)) {
        this.send(c.email, 'after', `after:${b.id}`, 'How was your session?', `Thanks for riding with us. Your report with your zones is in your inbox or on its way. Two quick questions: what was most useful, and what would you change? Just reply to this email.`);
      }
    }

    // Retest nudges: only to riders with nothing booked.
    for (const c of this.db.customers) {
      const mine = this.db.bookings.filter((b) => b.customerId === c.id && b.status !== 'cancelled');
      if (mine.some((b) => b.status === 'booked' && Date.parse(b.start) > now)) continue;
      const last = mine.filter((b) => Date.parse(b.start) <= now && b.status !== 'no_show').sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0];
      if (!last) continue;
      const left = this.balance(c.id).total;
      for (const w of E.retestNudgeWeeks) {
        if (now >= Date.parse(last.start) + days(7 * w)) {
          this.send(
            c.email,
            'nudge',
            `nudge${w}:${last.id}`,
            w === E.retestNudgeWeeks[0] ? 'Time to see if your training works' : 'Your thresholds have probably moved',
            `It's ${w} weeks since your last test on ${fmt(last.start, { day: 'numeric', month: 'long' })}. A retest shows whether your zones have moved.\n\n${left > 0 ? `You have ${left} ${left === 1 ? 'session' : 'sessions'} left: book in one tap at book.ndure.dk/account.` : 'Book your next test at book.ndure.dk.'}`
          );
        }
      }
    }

    // Packs about to expire with sessions left.
    for (const o of this.db.orders) {
      if (o.status !== 'paid' || o.remaining < 1 || !o.expiresAt) continue;
      const exp = Date.parse(o.expiresAt);
      if (now < exp && now >= exp - days(E.expiryWarningDays)) {
        const c = this.customer(o.customerId);
        this.send(c.email, 'expiry', `expiry:${o.id}`, `${o.remaining} ${o.remaining === 1 ? 'session expires' : 'sessions expire'} soon`, `You have ${o.remaining} unused ${o.remaining === 1 ? 'session' : 'sessions'} that expire on ${fmt(o.expiresAt, { day: 'numeric', month: 'long' })}. Book now at book.ndure.dk/account.`);
      }
    }
    return this.db.emails.slice(before);
  }

  money(n: number) {
    return this.config.currency === 'EUR' ? `€${n}` : `${n} DKK`;
  }
}
