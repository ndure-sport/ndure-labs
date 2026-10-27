import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Labs, quote } from './engine.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { emptyDb } from './types.ts';
import { days, hours } from './time.ts';

// A fixed clock: Monday 30 November 2026, 10:00 Copenhagen.
function setup() {
  let now = Date.parse('2026-11-30T10:00:00+01:00');
  const labs = new Labs(emptyDb(), DEFAULT_CONFIG, () => now);
  const tick = (ms: number) => {
    now += ms;
    return labs.tick();
  };
  return { labs, tick, now: () => now };
}
const consents = { ready: true, health: true, terms: true };
const rider = (email: string, extra: object = {}) => ({ name: 'Test Rider', email, consents, partner: false, qty: 1, ...extra });

test('prices: tiers, partner, lines add up', () => {
  assert.equal(quote(DEFAULT_CONFIG, 1, false).total, 99);
  assert.equal(quote(DEFAULT_CONFIG, 4, false).unit, 85);
  assert.equal(quote(DEFAULT_CONFIG, 5, true).total, 380 + 79);
  const q = quote(DEFAULT_CONFIG, 10, false);
  assert.equal(q.total, 690);
  assert.equal(q.lines.reduce((s, l) => s + l.amount, 0), q.total);
  assert.throws(() => quote(DEFAULT_CONFIG, 11, false));
});

test('sessions: Tuesday to Friday only, 2 seats morning, 1 afternoon', () => {
  const { labs } = setup();
  const s = labs.slots();
  assert.ok(s.length > 0);
  for (const x of s) assert.ok([2, 3, 4, 5].includes(new Date(x.start).getUTCDay()));
  assert.equal(s.find((x) => x.blockId === 'am')!.capacity, 2);
  assert.equal(s.find((x) => x.blockId === 'pm')!.capacity, 1);
  assert.equal(s[0].start, '2026-12-01T09:30:00+01:00');
});

test('single session: pick date, pay, booked, seat counted', () => {
  const { labs } = setup();
  const start = '2026-12-01T13:00:00+01:00';
  const o = labs.checkout(rider('a@x.dk', { start }));
  assert.equal(labs.slots().some((s) => s.start === start), false, 'seat held while paying');
  labs.paid(o.id);
  assert.equal(o.firstStatus, 'booked');
  assert.equal(o.remaining, 0);
  assert.equal(labs.db.holds.length, 0);
  assert.equal(labs.slots().some((s) => s.start === start), false, 'afternoon is full');
  assert.ok(labs.db.emails.some((e) => e.template === 'confirmation'));
});

test('two riders cannot get the last seat', () => {
  const { labs } = setup();
  const start = '2026-12-01T13:00:00+01:00';
  labs.checkout(rider('a@x.dk', { start }));
  assert.throws(() => labs.checkout(rider('b@x.dk', { start })), /filled up/);
});

test('hold expires when the rider does not pay', () => {
  const { labs, tick } = setup();
  const start = '2026-12-01T13:00:00+01:00';
  const o = labs.checkout(rider('a@x.dk', { start }));
  tick(hours(1));
  assert.equal(o.status, 'expired');
  assert.ok(labs.slots().some((s) => s.start === start));
});

test('a partner needs 2 seats, so only the morning fits', () => {
  const { labs } = setup();
  assert.throws(() => labs.checkout(rider('a@x.dk', { partner: true, partnerName: 'P', partnerEmail: 'p@x.dk', start: '2026-12-01T13:00:00+01:00' })), /2 free spots/);
  const o = labs.checkout(rider('a@x.dk', { partner: true, partnerName: 'P', partnerEmail: 'p@x.dk', start: '2026-12-01T09:30:00+01:00' }));
  labs.paid(o.id);
  const b = labs.db.bookings[0];
  assert.equal(b.seats, 2);
  assert.equal(labs.slots(1).some((s) => s.start === '2026-12-01T09:30:00+01:00'), false);
});

test('pack: pay now, book later, balance goes down and up', () => {
  const { labs } = setup();
  const o = labs.checkout(rider('a@x.dk', { qty: 5, later: true }));
  labs.paid(o.id);
  const c = labs.customerByEmail('a@x.dk')!;
  assert.equal(labs.balance(c.id).total, 5);
  const b = labs.book(c.id, '2026-12-02T09:30:00+01:00', { by: 'rider' });
  assert.equal(labs.balance(c.id).total, 4);
  labs.cancel(b.id, 'rider');
  assert.equal(labs.balance(c.id).total, 5);
});

test('a rider cannot book the same session twice', () => {
  const { labs } = setup();
  labs.paid(labs.checkout(rider('a@x.dk', { qty: 3, later: true })).id);
  const c = labs.customerByEmail('a@x.dk')!;
  labs.book(c.id, '2026-12-02T09:30:00+01:00', { by: 'rider' });
  assert.throws(() => labs.book(c.id, '2026-12-02T09:30:00+01:00', { by: 'rider' }), /already booked/);
  assert.equal(labs.slotsFor(c.id).some((s) => s.start === '2026-12-02T09:30:00+01:00'), false);
});

test('past sessions stay in the team view until marked', () => {
  const { labs, tick } = setup();
  labs.paid(labs.checkout(rider('a@x.dk', { qty: 3, later: true })).id);
  const c = labs.customerByEmail('a@x.dk')!;
  const b = labs.book(c.id, '2026-12-02T09:30:00+01:00', { by: 'rider' });
  tick(days(14));
  assert.equal(labs.teamDays().flatMap((d) => d.list).some((r) => r.id === b.id), true);
  labs.markAttendance(b.id, 'attended');
  assert.equal(labs.teamDays().flatMap((d) => d.list).some((r) => r.id === b.id), false);
});

test('riders cannot cancel or move inside 24 hours; the team can', () => {
  const { labs, tick } = setup();
  const o = labs.checkout(rider('a@x.dk', { qty: 3, later: true }));
  labs.paid(o.id);
  const c = labs.customerByEmail('a@x.dk')!;
  const b = labs.book(c.id, '2026-12-02T09:30:00+01:00', { by: 'rider' });
  tick(days(1) + hours(12)); // Tue 22:00, session Wed 09:30
  assert.throws(() => labs.cancel(b.id, 'rider'), /24 hours/);
  assert.throws(() => labs.reschedule(b.id, '2026-12-03T09:30:00+01:00', 'rider'), /24 hours/);
  labs.cancel(b.id, 'team', false); // late cancel by team, session used
  assert.equal(labs.balance(c.id).total, 2);
});

test('no show uses the session; packs expire after 12 months', () => {
  const { labs, tick } = setup();
  const o = labs.checkout(rider('a@x.dk', { qty: 3, later: true }));
  labs.paid(o.id);
  const c = labs.customerByEmail('a@x.dk')!;
  const b = labs.book(c.id, '2026-12-01T09:30:00+01:00', { by: 'rider' });
  tick(days(1));
  labs.markAttendance(b.id, 'no_show');
  assert.equal(labs.balance(c.id).total, 2);
  tick(days(366));
  assert.equal(labs.balance(c.id).total, 0);
  assert.throws(() => labs.book(c.id, labs.slots()[0].start, { by: 'rider' }), /no sessions left/);
});

test('emails: reminder 2 days before, follow up after, nudges only when nothing is booked', () => {
  const { labs, tick } = setup();
  const o = labs.checkout(rider('a@x.dk', { qty: 3, later: true }));
  labs.paid(o.id);
  const c = labs.customerByEmail('a@x.dk')!;
  labs.book(c.id, '2026-12-04T09:30:00+01:00', { by: 'rider' });
  assert.equal(tick(hours(1)).length, 0);
  assert.deepEqual(tick(days(2)).map((e) => e.template), ['reminder']);
  assert.deepEqual(tick(days(4)).map((e) => e.template), ['after']);
  assert.deepEqual(tick(days(28)).map((e) => e.template), ['nudge']);
  // Rider books again: no more nudges.
  labs.book(c.id, labs.slots()[0].start, { by: 'rider' });
  const later = tick(days(21));
  assert.equal(later.filter((e) => e.template === 'nudge').length, 0);
  // Every automatic email goes out once.
  const keys = labs.db.emails.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('login code: works once, expires, locks after 5 wrong tries', () => {
  const { labs, tick } = setup();
  labs.paid(labs.checkout(rider('a@x.dk', { qty: 3, later: true })).id);
  labs.requestLogin('a@x.dk', () => '123456');
  assert.throws(() => labs.verifyLogin('a@x.dk', '000000'), /not right/);
  assert.equal(labs.verifyLogin('a@x.dk', '123456').email, 'a@x.dk');
  assert.throws(() => labs.verifyLogin('a@x.dk', '123456'), /expired/);
  labs.requestLogin('a@x.dk', () => '222222');
  for (let i = 0; i < 5; i++) assert.throws(() => labs.verifyLogin('a@x.dk', '999999'));
  assert.throws(() => labs.verifyLogin('a@x.dk', '222222'), /Too many/);
  labs.requestLogin('a@x.dk', () => '333333');
  tick(hours(1));
  assert.throws(() => labs.verifyLogin('a@x.dk', '333333'), /expired/);
  labs.requestLogin('nobody@x.dk', () => '444444');
  assert.equal(labs.db.codes.some((x) => x.email === 'nobody@x.dk'), false);
});

test('team: free sessions, closed days, calendar feed', () => {
  const { labs } = setup();
  const o = labs.giveSessions({ email: 'athlete@x.dk', name: 'Athlete', qty: 2 });
  assert.equal(o.total, 0);
  assert.equal(o.remaining, 2);
  labs.closeDay('2026-12-01', 'Coach away');
  assert.equal(labs.slots().some((s) => s.start.startsWith('2026-12-01')), false);
  labs.book(o.customerId, '2026-12-02T09:30:00+01:00', { by: 'team' });
  assert.match(labs.calendarFeed(), /SUMMARY:Labs: Athlete/);
});
