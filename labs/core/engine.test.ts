import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Labs, quote } from './engine.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { emptyDb } from './types.ts';
import { days, hours } from './time.ts';

// A fixed clock: Monday 30 November 2026, 10:00 Copenhagen.
// Most tests book close to "now", so they run with a short notice period; the 1 week rule has its own test.
// Every automatic email on in the tests, so they all keep being tested.
// The older tests run on the earlier week (Tue to Fri, 09:30 for 2 riders, 13:00 for 1), so they keep testing
// seats, partners and holds. The current week (config.ts) has its own tests at the end of this file.
const LEGACY: typeof DEFAULT_CONFIG = {
  ...DEFAULT_CONFIG,
  days: [2, 3, 4, 5],
  blocks: [
    { id: 'am', label: 'Morning', time: '09:30', minutes: 150, capacity: 2 },
    { id: 'pm', label: 'Afternoon', time: '13:00', minutes: 180, capacity: 1 }
  ],
  week: undefined,
  pairs: []
};
const TEST_CONFIG: typeof DEFAULT_CONFIG = { ...LEGACY, minNoticeHours: 12, opensOn: null, emails: { ...DEFAULT_CONFIG.emails, off: [] } };
const NOW_CONFIG: typeof DEFAULT_CONFIG = { ...DEFAULT_CONFIG, minNoticeHours: 12, opensOn: null, emails: { ...DEFAULT_CONFIG.emails, off: [] } };
function setup(config = TEST_CONFIG) {
  let now = Date.parse('2026-11-30T10:00:00+01:00');
  const labs = new Labs(emptyDb(), config, () => now);
  const tick = (ms: number) => {
    now += ms;
    return labs.tick();
  };
  return { labs, tick, now: () => now };
}
const consents = { ready: true, health: true, inperson: true, terms: true };
const rider = (email: string, extra: object = {}) => ({ name: 'Test Rider', email, consents, partner: false, qty: 1, ...extra });

test('prices: tiers, partner, lines add up', () => {
  assert.equal(quote(DEFAULT_CONFIG, 1, false).total, 499);
  assert.equal(quote(DEFAULT_CONFIG, 3, false).unit, 429);
  assert.equal(quote(DEFAULT_CONFIG, 3, false).total, 1287);
  assert.equal(quote(DEFAULT_CONFIG, 3, true).total, 1287 + DEFAULT_CONFIG.partnerPrice);
  const q = quote(DEFAULT_CONFIG, 6, false);
  assert.equal(q.total, 2250);
  assert.equal(q.saving, 744);
  assert.equal(q.lines.reduce((s, l) => s + l.amount, 0), q.total);
  assert.deepEqual(quote(DEFAULT_CONFIG, 1, false).next, { more: 2, unit: 429 });
  assert.equal(q.next, null);
});

test('prices: only the 1, 3 and 6 session packs can be bought', () => {
  for (const n of [0, 2, 4, 5, 7, 10, -1, 1.5, NaN]) assert.throws(() => quote(DEFAULT_CONFIG, n as number, false), String(n));
  const { labs } = setup();
  assert.throws(() => labs.checkout(rider('a@x.dk', { qty: 5, later: true })));
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
  const o = labs.checkout(rider('a@x.dk', { qty: 6, later: true }));
  labs.paid(o.id);
  const c = labs.customerByEmail('a@x.dk')!;
  assert.equal(labs.balance(c.id).total, 6);
  const b = labs.book(c.id, '2026-12-02T09:30:00+01:00', { by: 'rider' });
  assert.equal(labs.balance(c.id).total, 5);
  labs.cancel(b.id, 'rider');
  assert.equal(labs.balance(c.id).total, 6);
});

test('riders can book up to 12 weeks ahead; the team can book further', () => {
  const { labs } = setup();
  labs.paid(labs.checkout(rider('a@x.dk', { qty: 6, later: true })).id);
  const c = labs.customerByEmail('a@x.dk')!;
  assert.equal(DEFAULT_CONFIG.bookingWeeksAhead, 12);
  const last = Math.max(...labs.slots().map((s) => Date.parse(s.start)));
  assert.ok(last <= Date.parse('2026-11-30T10:00:00+01:00') + 12 * 7 * 86_400_000, 'the calendar stops at 12 weeks');
  assert.throws(() => labs.book(c.id, '2027-03-03T09:30:00+01:00', { by: 'rider' }), /up to 12 weeks ahead/);
  const b = labs.book(c.id, '2027-02-17T09:30:00+01:00', { by: 'rider' });
  assert.throws(() => labs.reschedule(b.id, '2027-03-03T09:30:00+01:00', 'rider'), /up to 12 weeks ahead/);
  assert.ok(labs.book(c.id, '2027-03-03T09:30:00+01:00', { by: 'team' }));
  assert.throws(() => labs.checkout(rider('b@x.dk', { start: '2027-03-03T09:30:00+01:00' })), /up to 12 weeks ahead/);
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

test('emails: reminder the day before, follow up after, nudges only when nothing is booked', () => {
  const { labs, tick } = setup();
  const o = labs.checkout(rider('a@x.dk', { qty: 3, later: true }));
  labs.paid(o.id);
  const c = labs.customerByEmail('a@x.dk')!;
  labs.book(c.id, '2026-12-04T09:30:00+01:00', { by: 'rider' });
  assert.equal(tick(hours(1)).length, 0);
  assert.equal(tick(days(2)).length, 0); // 46 hours before: too early
  const rem = tick(hours(21)); // Thursday 08:00, 25.5 hours before
  assert.deepEqual(rem.map((e) => e.template), ['reminder']);
  assert.equal(rem[0].subject, 'Getting ready for your NDURE Labs session tomorrow');
  assert.ok(rem[0].body.includes('DTU Science Park reception, Diplomvej 381'));
  assert.ok(rem[0].body.includes('https://tally.so/r/peyDxB?') && rem[0].body.includes('email=a%40x.dk'), 'form link with the rider prefilled');
  assert.ok(rem[0].body.includes('sleeveless top'));
  assert.deepEqual(tick(days(3) + hours(3)).map((e) => e.template), ['after']);
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

// ---------- hardening (October 2026) ----------

test('S1: a checkout with someone else\'s email does not change their details', () => {
  const { labs } = setup();
  const start = '2026-12-01T13:00:00+01:00';
  const o = labs.checkout(rider('victim@x.dk', { start, name: 'Real Name', phone: '+45 1111' }));
  labs.paid(o.id);
  assert.equal(o.newCustomer, true);
  const attack = labs.checkout(rider('victim@x.dk', { qty: 3, later: true, name: 'Attacker', phone: '+45 9999', consents: { ...consents, film: true } }));
  assert.equal(attack.newCustomer, false, 'an existing rider: this checkout may not log a browser in');
  const c = labs.customerByEmail('victim@x.dk')!;
  assert.equal(c.name, 'Real Name');
  assert.equal(c.phone, '+45 1111');
  assert.equal(c.consents!.items.film, false);
});

test('S2: text is cut to size and stripped of line breaks; nonsense FTP is dropped', () => {
  const { labs } = setup();
  const o = labs.checkout(rider('a@x.dk', { start: '2026-12-01T13:00:00+01:00', name: 'A'.repeat(5000) + '\nX', goal: 'g'.repeat(1000), ftp: 99999, src: 's'.repeat(500) }));
  const c = labs.customer(o.customerId);
  assert.equal(c.name.length, 80);
  assert.ok(!c.name.includes('\n'));
  assert.equal(c.goal!.length, 120);
  assert.equal(c.ftp, null);
  assert.equal(o.src!.length, 40);
  assert.throws(() => labs.checkout(rider('a'.repeat(300) + '@x.dk', { start: '2026-12-02T13:00:00+01:00' })), /valid email/);
});

test('S2: unpaid checkouts close, and are removed with their never-paying rider after 3 weeks', () => {
  const { labs, tick } = setup();
  labs.checkout(rider('ghost@x.dk', { qty: 3, later: true }));
  tick(hours(3));
  assert.equal(labs.db.orders[0].status, 'expired', 'an unpaid order without a seat closes after 2 hours');
  tick(days(22));
  assert.equal(labs.db.orders.length, 0);
  assert.equal(labs.db.customers.length, 0);
});

test('S3: a new checkout by the same rider frees the seat of the earlier unpaid one', () => {
  const { labs } = setup();
  const start = '2026-12-01T13:00:00+01:00';
  labs.checkout(rider('a@x.dk', { start }));
  // Back from the payment page, same rider picks the same session again: allowed.
  const again = labs.checkout(rider('a@x.dk', { start }));
  assert.equal(labs.db.holds.length, 1);
  assert.equal(labs.db.holds[0].orderId, again.id);
});

test('S4: a payment that arrives after the hold ran out is still credited, and staff are alerted', () => {
  const { labs, tick } = setup();
  const start = '2026-12-02T13:00:00+01:00';
  const o = labs.checkout(rider('slow@x.dk', { start }));
  tick(hours(1));
  assert.equal(o.status, 'expired');
  labs.paid(o.id); // bank payment confirmed later
  assert.equal(o.status, 'paid');
  assert.equal(o.late, true);
  assert.equal(o.firstStatus, 'booked', 'the seat was still free');
  assert.equal(labs.db.alerts.filter((a) => a.kind === 'late_payment').length, 1);

  // And when the seat is gone by then: the session stays in the account.
  const o2 = labs.checkout(rider('slow2@x.dk', { start: '2026-12-03T13:00:00+01:00' }));
  tick(hours(1));
  const other = labs.checkout(rider('fast@x.dk', { start: '2026-12-03T13:00:00+01:00' }));
  labs.paid(other.id);
  labs.paid(o2.id);
  assert.equal(o2.firstStatus, 'failed');
  assert.equal(labs.balance(o2.customerId).total, 1);
});

test('S5: 10 wrong codes in a day lock the account, rider and team alike', () => {
  const { labs, tick } = setup();
  labs.paid(labs.checkout(rider('a@x.dk', { start: '2026-12-01T13:00:00+01:00' })).id);
  let n = 0;
  const code = () => String(100000 + n++);
  for (let round = 0; round < 2; round++) {
    labs.requestLogin('a@x.dk', code);
    for (let i = 0; i < 5; i++) assert.throws(() => labs.verifyLogin('a@x.dk', '000000'));
  }
  labs.db.emails = []; // pretend the hourly code limit has passed
  assert.throws(() => labs.requestLogin('a@x.dk', code), /Too many wrong codes/);
  tick(hours(25));
  labs.requestLogin('a@x.dk', () => '123456');
  assert.equal(labs.verifyLogin('a@x.dk', '123456').email, 'a@x.dk');

  for (let i = 0; i < 5; i++) {
    labs.requestTeamLogin('team@x.dk', code);
    tick(1000);
  }
  assert.throws(() => labs.requestTeamLogin('team@x.dk', code), /Too many codes/, 'team codes are limited per hour too');
});

test('old emails are cleaned up but never sent twice', () => {
  const { labs, tick } = setup();
  const o = labs.checkout(rider('a@x.dk', { start: '2026-12-01T13:00:00+01:00' }));
  labs.paid(o.id);
  for (const e of labs.db.emails) e.sent = true;
  tick(days(4)); // session done, "after" email due
  for (const e of labs.db.emails) e.sent = true;
  const afterCount = labs.db.emails.filter((e) => e.template === 'after').length;
  assert.equal(afterCount, 1);
  tick(days(40));
  assert.ok(labs.db.emails.every((e) => e.template !== 'after'), 'old email removed');
  assert.ok(labs.db.done.some((k) => k.startsWith('after:')), 'its key is kept');
  tick(hours(1));
  assert.equal(labs.db.emails.filter((e) => e.template === 'after').length, 0, 'not sent again');
});

test('partner gets a private consent link; the team sees the consent', () => {
  const { labs } = setup();
  const o = labs.checkout(rider('a@x.dk', { start: '2026-12-01T09:30:00+01:00', partner: true, partnerName: 'Pat', partnerEmail: 'pat@x.dk' }));
  labs.paid(o.id);
  const mail = labs.db.emails.find((e) => e.template === 'partner')!;
  assert.ok(mail.body.includes(`/consent/${o.partnerToken}`));
  assert.ok(!mail.body.includes('[link]'));
  assert.equal(labs.partnerInvite(o.partnerToken!).partnerName, 'Pat');
  assert.throws(() => labs.partnerInvite('x'.repeat(24)), /not valid/);
  assert.throws(() => labs.partnerConsent(o.partnerToken!, { consents: { ready: true } }), /Tick/);
  labs.partnerConsent(o.partnerToken!, { consents, phone: '+45 2222' });
  assert.equal(labs.teamDays()[0].list[0].order.partnerConsents!.items.health, true);
});

test('calendar feed escapes names', () => {
  const { labs } = setup();
  labs.paid(labs.checkout(rider('a@x.dk', { start: '2026-12-01T13:00:00+01:00', name: 'Evil; Name, X' })).id);
  const feed = labs.calendarFeed();
  assert.ok(feed.includes('SUMMARY:Labs: Evil\\; Name\\, X'));
});

test('S1: pressing back and paying again still counts as new; a second payment ends automatic logins', () => {
  const { labs } = setup();
  const first = labs.checkout(rider('new@x.dk', { start: '2026-12-01T13:00:00+01:00', name: 'First Try' }));
  const again = labs.checkout(rider('new@x.dk', { start: '2026-12-01T13:00:00+01:00', name: 'Second Try' }));
  assert.equal(again.newCustomer, true);
  assert.equal(labs.customerByEmail('new@x.dk')!.name, 'Second Try', 'never paid: details can still change');
  labs.paid(again.id);
  const sv = labs.customerByEmail('new@x.dk')!.sv ?? 0;
  // Someone else pays with the same email: no automatic login, and existing ones end.
  const other = labs.checkout(rider('new@x.dk', { qty: 3, later: true, name: 'Someone Else' }));
  assert.equal(other.newCustomer, false);
  labs.paid(other.id);
  assert.equal(labs.customerByEmail('new@x.dk')!.sv, sv + 1);
  assert.equal(labs.customerByEmail('new@x.dk')!.name, 'Second Try');
  void first;
});

test('riders book at least 1 week ahead; the team can book any time', () => {
  const { labs } = setup({ ...LEGACY, minNoticeHours: 168 }) // the rule as it will be switched on again;
  const first = labs.slots()[0].start;
  assert.ok(Date.parse(first) >= Date.parse('2026-12-07T10:00:00+01:00'), 'nothing inside the first week');
  assert.equal(first, '2026-12-08T09:30:00+01:00');
  assert.throws(() => labs.checkout(rider('soon@x.dk', { start: '2026-12-01T09:30:00+01:00' })), /at least 1 week ahead/);
  assert.ok(labs.slots(1, { team: true }).some((s) => s.start === '2026-12-01T09:30:00+01:00'));
});

test('riders can only book from the opening day; the team can book before', () => {
  const { labs } = setup({ ...TEST_CONFIG, opensOn: '2026-12-08' });
  const slots = labs.slots(1);
  assert.ok(slots.length > 0);
  assert.ok(slots.every((s) => s.start >= '2026-12-08'));
  assert.ok(labs.slots(1, { team: true }).some((s) => s.start < '2026-12-08'));
  assert.throws(() => labs.checkout(rider('early@x.dk', { start: '2026-12-02T09:30:00+01:00' })), /Booking opens/);
});

test('CRM: riders due for a check in, contact log, check in email, stop link', () => {
  const { labs, tick } = setup();
  const o = labs.checkout(rider('crm@x.dk', { qty: 3, start: '2026-12-01T09:30:00+01:00', phone: '+45 1234' }));
  labs.paid(o.id);
  const c = labs.customerByEmail('crm@x.dk')!;
  tick(2 * 86_400_000);
  labs.markAttendance(labs.db.bookings[0].id, 'attended');
  let r = labs.crm().riders.find((x) => x.id === c.id)!;
  assert.equal(r.status, 'fine');
  assert.equal(r.visits, 1);
  assert.equal(r.left, 2);
  // 9 weeks later with nothing booked: due, and the automatic reminders went out and are logged.
  tick(9 * 7 * 86_400_000);
  r = labs.crm().riders.find((x) => x.id === c.id)!;
  assert.equal(r.status, 'due');
  assert.ok(r.history.some((h) => h.kind === 'email' && h.text.startsWith('Automatic reminder')));
  const nudge = labs.db.emails.find((e) => e.template === 'nudge')!;
  const token = nudge.body.match(/stop\/([\w-]+)/)![1];
  // Team logs a call with a follow up date, then sends a check in email; a second one right after is refused.
  labs.logContact({ by: 'team@ndure.dk', customerId: c.id, kind: 'call', text: 'Wants to come in January' });
  labs.setFollowUp(c.id, '2027-01-05');
  assert.equal(labs.crm().riders[0].followUpOn, '2027-01-05');
  labs.sendCheckIn(c.id, 'team@ndure.dk');
  assert.ok(labs.db.emails.some((e) => e.template === 'checkin' && e.body.includes('2 sessions left') && e.body.includes('/stop/')));
  assert.throws(() => labs.sendCheckIn(c.id, 'team@ndure.dk'), /Wait at least/);
  // The rider stops reminders with the link: no more check in emails.
  assert.throws(() => labs.stopReminders('nonsense-token-that-is-long'), /not valid/);
  labs.stopReminders(token);
  assert.equal(labs.customer(c.id).noReminders, true);
  assert.throws(() => labs.sendCheckIn(c.id, 'team@ndure.dk'), /asked not to/);
  // Sales count the payment once.
  const s = labs.crm().sales.find((x) => x.month === '2026-11' || x.month === '2026-12')!;
  assert.equal(labs.crm().sales.reduce((n, x) => n + x.revenue, 0), 1287);
  assert.ok(s);
});

test('CRM: contacts need a name and a phone or email; unpaid checkouts are listed', () => {
  const { labs } = setup();
  assert.throws(() => labs.saveLead({ name: 'No Way' }), /email or a phone/);
  const l = labs.saveLead({ name: 'Expo Rider', phone: '+45 5555', source: 'Ironman expo', okToCall: true, followUpOn: '2026-11-30' });
  assert.equal(labs.crm().leads[0].followUpDue, true);
  labs.saveLead({ id: l.id, status: 'interested' });
  assert.equal(labs.lead(l.id).status, 'interested');
  assert.equal(labs.lead(l.id).phone, '+45 5555');
  labs.logContact({ by: 'team@ndure.dk', leadId: l.id, kind: 'call', text: 'Will book after Christmas' });
  assert.equal(labs.crm().leads[0].history.length, 1);
  labs.checkout(rider('maybe@x.dk', { qty: 6, later: true, name: 'Maybe Rider' }));
  const u = labs.crm().unpaid;
  assert.equal(u.length, 1);
  assert.equal(u[0].total, 2250);
  labs.removeLead(l.id);
  assert.equal(labs.db.contacts.length, 0);
});

test('opening: weekly hours, open date and closed periods set by the team', () => {
  const { labs } = setup();
  // Default: Tuesday to Friday, morning and afternoon.
  assert.deepEqual(labs.hoursFor(1), []);
  assert.deepEqual(labs.hoursFor(2), ['am', 'pm']);
  // Mondays mornings open, Fridays closed.
  labs.setHours({ 1: ['am'], 2: ['am', 'pm'], 3: ['am', 'pm'], 4: ['am', 'pm'], 5: [] });
  const slots = labs.slots(1);
  assert.ok(slots.some((s) => s.start === '2026-12-07T09:30:00+01:00'), 'Monday morning');
  assert.ok(!slots.some((s) => s.start === '2026-12-07T13:00:00+01:00'), 'not Monday afternoon');
  assert.ok(!slots.some((s) => s.start.startsWith('2026-12-04')), 'no Friday');
  assert.throws(() => labs.setHours({}), /at least one/);
  // A booked day can be closed: the booking stays and is reported, new bookings are refused.
  labs.paid(labs.checkout(rider('a@x.dk', { start: '2026-12-08T09:30:00+01:00' })).id);
  const clash = labs.closeDays('2026-12-08', '2026-12-10', 'Christmas party');
  assert.equal(clash.length, 1);
  assert.equal(labs.db.closed.length, 3);
  assert.ok(!labs.slots(1).some((s) => s.start.startsWith('2026-12-09')));
  assert.throws(() => labs.checkout(rider('b@x.dk', { start: '2026-12-09T09:30:00+01:00' })), /no session/);
  assert.equal(labs.schedule('2026-12-07', 1).find((d) => d.date === '2026-12-08')!.booked, 1);
  labs.reopenDays('2026-12-09', '2026-12-10');
  assert.equal(labs.db.closed.length, 1);
  assert.throws(() => labs.closeDays('2026-12-10', '2026-12-01', ''), /before/);
  // Open date from the team overrides the default.
  labs.setOpensOn('2026-12-15');
  assert.ok(labs.slots(1).every((s) => s.start >= '2026-12-15'));
  labs.setOpensOn(null);
  assert.equal(labs.opensOn(), null);
});

test('emails: switch automatic ones off, never send old ones, pause on a burst', () => {
  const { labs, tick } = setup();
  assert.throws(() => labs.setEmail('confirmation', false), /can not be switched off/);
  labs.setEmail('reminder', false);
  labs.paid(labs.checkout(rider('a@x.dk', { start: '2026-12-02T09:30:00+01:00' })).id);
  tick(36 * 3_600_000); // a day and a half: inside the 48 hour reminder window
  assert.ok(!labs.db.emails.some((e) => e.template === 'reminder'), 'reminder is off');
  labs.setEmail('reminder', true);
  tick(60_000);
  assert.ok(labs.db.emails.some((e) => e.template === 'reminder'), 'reminder back on');
  // "How was your session?" switched off for a month, then on: the old one never goes out.
  labs.setEmail('after', false);
  tick(30 * 86_400_000);
  labs.setEmail('after', true);
  tick(60_000);
  assert.ok(!labs.db.emails.some((e) => e.template === 'after'), 'no late after-session email');
});

test('emails: more than 40 automatic emails in one run pauses them all and alerts', () => {
  const big = { ...TEST_CONFIG, blocks: TEST_CONFIG.blocks.map((b) => ({ ...b, capacity: 60 })) };
  const { labs, tick } = setup(big);
  // 45 riders in one session (as after an import), so 45 "How was your session?" emails are due at once.
  for (let i = 0; i < 45; i++) {
    const o = labs.giveSessions({ email: `r${i}@x.dk`, name: `R ${i}`, qty: 2, note: 'team' });
    labs.book(o.customerId, '2026-12-01T09:30:00+01:00', { by: 'team' });
  }
  tick(3 * 86_400_000);
  assert.ok(labs.db.autoPaused, 'paused');
  assert.equal(labs.db.emails.filter((e) => e.template === 'after').length, 0);
  assert.ok(labs.db.alerts.some((a) => a.kind === 'emails_paused'));
  tick(60_000);
  assert.equal(labs.db.emails.filter((e) => e.template === 'after').length, 0, 'stays paused');
  // Drop them: they never go out, and normal emails continue.
  labs.resumeEmails(false);
  tick(60_000);
  assert.equal(labs.db.autoPaused, null);
  assert.equal(labs.db.emails.filter((e) => e.template === 'after').length, 0, 'dropped');
  // A new burst (45 reminders for one session), this time sent anyway.
  for (let i = 0; i < 45; i++) labs.book(labs.customerByEmail(`r${i}@x.dk`)!.id, '2026-12-08T09:30:00+01:00', { by: 'team' });
  tick(4 * 86_400_000);
  assert.ok(labs.db.autoPaused);
  assert.equal(labs.db.emails.filter((e) => e.template === 'reminder').length, 0);
  labs.resumeEmails(true);
  tick(60_000);
  assert.equal(labs.db.emails.filter((e) => e.template === 'reminder').length, 45, 'sent after the team said yes');
  // Essential emails still work while paused.
  assert.ok(labs.db.emails.some((e) => e.template === 'confirmation'));
});


test('emails: the off list in the config stops those automatic emails', () => {
  const { labs, tick } = setup({ ...TEST_CONFIG, emails: { ...TEST_CONFIG.emails, off: ['after', 'reminder'] } });
  const o = labs.checkout(rider('off@x.dk', { qty: 1, start: labs.slots()[3].start }));
  labs.paid(o.id);
  for (let i = 0; i < 40; i++) tick(6 * 3_600_000);
  const sent = labs.db.emails.filter((e) => e.to === 'off@x.dk').map((e) => e.template);
  assert.ok(sent.includes('confirmation'));
  assert.ok(!sent.includes('after') && !sent.includes('reminder'), sent.join(','));
});

test('reports: to do after came, sent and redo by hand, never touches sessions or emails', () => {
  const { labs, tick } = setup();
  const start = labs.slots()[0].start;
  const o = labs.checkout(rider('rep@x.dk', { qty: 3, start }));
  labs.paid(o.id);
  const b = labs.db.bookings.find((x) => x.orderId === o.id)!;
  assert.throws(() => labs.setReport(b.id, { status: 'sent' }), /came first/);
  tick(Date.parse(start) - Date.parse('2026-11-30T10:00:00+01:00') + 60_000);
  const before = { balance: labs.balance(o.customerId).total, emails: labs.db.emails.length };
  labs.markAttendance(b.id, 'attended');
  assert.equal(b.report, 'todo');
  assert.deepEqual(labs.reports().open.map((r) => r.id), [b.id]);
  assert.throws(() => labs.setReport(b.id, { status: 'done' }), /To do, Sent or Redo/);
  assert.throws(() => labs.setReport(b.id, { status: 'sent', link: 'dropbox/report.pdf' }), /https/);
  assert.throws(() => labs.setReport(b.id, { status: 'sent', link: 'javascript:alert(1)' }), /https/);
  labs.setReport(b.id, { status: 'sent', link: 'https://www.dropbox.com/s/abc/report.pdf', note: 'Zones look good\nnew line' });
  assert.equal(b.report, 'sent');
  assert.ok(b.reportAt);
  assert.equal(b.reportNote, 'Zones look good new line');
  assert.equal(labs.reports().open.length, 0);
  assert.equal(labs.reports().sent[0].link, 'https://www.dropbox.com/s/abc/report.pdf');
  labs.setReport(b.id, { status: 'redo', note: 'Bad sensor data' });
  assert.equal(b.reportAt, null);
  assert.equal(b.reportLink, 'https://www.dropbox.com/s/abc/report.pdf'); // a missing link field keeps the link
  assert.equal(labs.reports().open[0].report, 'redo');
  labs.setReport(b.id, { status: 'todo', link: '' });
  assert.equal(b.reportLink, null);
  // Changing to no show clears an open report; sessions and emails are untouched throughout.
  labs.markAttendance(b.id, 'no_show');
  assert.equal(b.report, null);
  assert.equal(labs.reports().open.length, 0);
  assert.equal(labs.balance(o.customerId).total, before.balance);
  assert.equal(labs.db.emails.length, before.emails);
  // Old bookings saved before this feature (no report field) count as to do once marked came.
  labs.markAttendance(b.id, 'attended');
  delete (b as { report?: unknown }).report;
  assert.equal(labs.reports().open[0].report, 'todo');
});

test('emails: confirmation and day before emails render the visit info, form box and no "tester"', async () => {
  const { renderEmail } = await import('../worker/mail.ts');
  const { labs, tick } = setup();
  const o = labs.checkout(rider('a@x.dk', { qty: 3, later: true, name: 'Mette Jensen' }));
  labs.paid(o.id);
  const c = labs.customerByEmail('a@x.dk')!;
  const b = labs.book(c.id, '2026-12-04T09:30:00+01:00', { by: 'rider' });
  const conf = labs.db.emails.find((e) => e.template === 'confirmation')!;
  tick(days(2) + hours(22));
  const rem = labs.db.emails.find((e) => e.template === 'reminder')!;
  const app = { appUrl: 'https://book.ndure.dk' };
  const ch = renderEmail(conf, { ...app, booking: b, icsUrl: 'https://book.ndure.dk/x.ics' }).html;
  const rh = renderEmail(rem, app).html;
  for (const h of [ch, rh, conf.body, rem.body]) assert.ok(!/tester/i.test(h), 'no "tester"');
  assert.ok(ch.includes('a sleeveless top (the sensor goes on your upper arm)') && ch.includes('Our bike has Shimano SPD-SL pedals. Other cleats? Bring your own pedals.'));
  assert.ok(ch.includes('Fill in the pre session form') && ch.includes('We pick you up at the reception'));
  assert.ok(rh.includes('Where and when') && rh.includes('Tomorrow, 09:30') && rh.includes('Directions →'));
  assert.ok(rh.indexOf('Please bring') < rh.indexOf('Fill in the pre session form') && rh.indexOf('Fill in the pre session form') < rh.indexOf('If you feel ill'), 'form box at the bottom, before the closing lines');
  assert.ok(rh.includes('email=a%40x.dk'), 'form link prefilled');
  assert.ok(!rh.includes('>Directions</a>'), 'no separate Directions button');
  if (process.env.WRITE_MAIL) { const fs = await import('node:fs'); fs.writeFileSync(`${process.env.WRITE_MAIL}/confirmation.html`, ch); fs.writeFileSync(`${process.env.WRITE_MAIL}/reminder.html`, rh); }
});

test('pre session form: matched by booking number, then email, else waits until they book', async () => {
  const { parseTally, verifyTally } = await import('../worker/tally.ts');
  const { formKeys, formLine } = await import('./form.ts');
  const { labs } = setup();
  const o = labs.checkout(rider('a@x.dk', { qty: 3, later: true, name: 'Mette Jensen' }));
  labs.paid(o.id);
  const c = labs.customerByEmail('a@x.dk')!;
  const slots = labs.slots();
  const b1 = labs.book(c.id, slots[6].start, { by: 'rider' });
  // The shape Tally sends (FORM_RESPONSE), with hidden fields from our link.
  const payload = (id: string, booking: string | null, email = 'a@x.dk') => ({
    eventId: 'e' + id, eventType: 'FORM_RESPONSE', createdAt: '2026-11-29T19:14:00Z',
    data: { responseId: id, createdAt: '2026-11-29T19:14:00Z', fields: [
      { key: 'h1', label: 'email', type: 'HIDDEN_FIELDS', value: email },
      { key: 'h2', label: 'booking', type: 'HIDDEN_FIELDS', value: booking },
      { key: 'q1', label: 'Full name', type: 'INPUT_TEXT', value: 'Mette Jensen' },
      { key: 'q2', label: 'Estimated FTP (watts)', type: 'INPUT_NUMBER', value: 265 },
      { key: 'q3', label: 'Do you want to bring your own bike?', type: 'MULTIPLE_CHOICE', value: ['o2'], options: [{ id: 'o1', text: 'No, I ride your lab bike' }, { id: 'o2', text: 'Yes, I bring my own bike' }] },
      { key: 'q4', label: 'Which cleats do you use?', type: 'MULTIPLE_CHOICE', value: ['c1'], options: [{ id: 'c1', text: 'Shimano SPD-SL' }] },
      { key: 'q5', label: 'Which platforms do you use?', type: 'CHECKBOXES', value: ['p1', 'p2'], options: [{ id: 'p1', text: 'Garmin' }, { id: 'p2', text: 'Zwift' }] },
      { key: 'q5_p1', label: 'Which platforms do you use? (Garmin)', type: 'CHECKBOXES', value: true },
      { key: 'q6', label: 'Saddle height (mm)', type: 'INPUT_NUMBER', value: null },
      { key: 'q7', label: 'Attach here (optional)', type: 'FILE_UPLOAD', value: [{ name: 'test.pdf', url: 'https://storage.tally.so/x/test.pdf' }] }
    ] }
  });
  const f = parseTally(payload('r1', b1.id))!;
  assert.equal(f.booking, b1.id);
  assert.deepEqual(f.answers.find((x) => x.q.startsWith('Which platforms'))!.a, 'Garmin, Zwift');
  assert.ok(!f.answers.some((x) => x.q.includes('(Garmin)')), 'checkbox helper fields skipped');
  assert.ok(!f.answers.some((x) => x.q.startsWith('Saddle')), 'unanswered skipped');
  assert.equal(f.files[0].name, 'test.pdf');
  assert.equal(labs.receiveForm(f), 'booking');
  assert.equal(labs.receiveForm(f), 'duplicate', 'Tally retries do nothing');
  const k = formKeys(labs.db.bookings.find((x) => x.id === b1.id)!.form!);
  assert.equal(k.ftp, '265');
  assert.equal(k.bike, 'Own bike');
  assert.equal(formLine(labs.db.bookings.find((x) => x.id === b1.id)!.form!), 'FTP 265 W · OWN BIKE, Shimano SPD-SL');
  // Moving the session keeps the form.
  labs.reschedule(b1.id, slots[8].start, 'team');
  assert.ok(labs.db.bookings.find((x) => x.id === b1.id)!.form);
  // No booking number: goes to their next booked session by email.
  labs.cancel(b1.id, 'team');
  const b2 = labs.book(c.id, slots[10].start, { by: 'rider' });
  assert.equal(labs.receiveForm(parseTally(payload('r2', null))!), 'email');
  assert.equal(labs.db.bookings.find((x) => x.id === b2.id)!.form!.id, 'r2');
  // Somebody without a session: waits, then moves to their first booking.
  assert.equal(labs.receiveForm(parseTally(payload('r3', null, 'new@x.dk'))!), 'loose');
  assert.equal(labs.db.looseForms.length, 1);
  const n = labs.checkout(rider('new@x.dk', { qty: 1, start: slots[12].start }));
  labs.paid(n.id);
  const nb = labs.db.bookings.find((x) => x.customerId === n.customerId)!;
  assert.equal(nb.form?.id, 'r3');
  assert.equal(labs.db.looseForms.length, 0);
  assert.ok(labs.db.emails.find((e) => e.key === `confirm:${nb.id}`)!.body.includes('We already have your pre session form'));
  // The day before email leaves out the form box when the form is in.
  // Signature: base64 HMAC SHA256 of the raw body with the signing secret.
  const raw = JSON.stringify(payload('r9', null));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('sekret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))));
  assert.equal(await verifyTally('sekret', raw, sig), true);
  assert.equal(await verifyTally('sekret', raw + ' ', sig), false);
  assert.equal(await verifyTally(undefined, raw, sig), false, 'no secret set: nothing accepted');
});

test('reminder: no form box when the form is already in', () => {
  const { labs, tick } = setup();
  const o = labs.checkout(rider('a@x.dk', { qty: 3, later: true }));
  labs.paid(o.id);
  const c = labs.customerByEmail('a@x.dk')!;
  const b = labs.book(c.id, '2026-12-04T09:30:00+01:00', { by: 'rider' });
  labs.receiveForm({ id: 'f1', at: '2026-12-01T10:00:00Z', email: 'a@x.dk', name: 'A', answers: [{ q: 'Estimated FTP (watts)', a: '250' }], files: [], booking: b.id });
  tick(days(2) + hours(22));
  const rem = labs.db.emails.find((e) => e.template === 'reminder')!;
  assert.ok(!rem.body.includes('tally.so'), 'no form link');
  assert.ok(rem.body.includes('Please bring'));
});

// ---------- the current week: Tue 4, Wed 4 with a flex pair, Thu 3, one rider each ----------
const dayOf = (iso: string) => new Date(iso).getUTCDay();
const clockOf = (iso: string) => iso.slice(11, 16);

test('week: Tue 08:00 10:00 12:30 14:45, Wed the same, Thu without 14:45, one rider each', () => {
  const { labs } = setup(NOW_CONFIG);
  const s = labs.slots();
  const on = (date: string) => s.filter((x) => x.start.startsWith(date)).map((x) => clockOf(x.start));
  assert.deepEqual(on('2026-12-08'), ['08:00', '10:00', '12:30', '14:45']); // Tuesday
  assert.deepEqual(on('2026-12-09'), ['08:00', '10:00', '12:30', '14:45']); // Wednesday
  assert.deepEqual(on('2026-12-10'), ['08:00', '10:00', '12:30']); // Thursday
  assert.equal(on('2026-12-07').length + on('2026-12-11').length, 0); // Monday and Friday closed
  for (const x of s) {
    assert.ok([2, 3, 4].includes(dayOf(x.start)));
    assert.equal(x.capacity, 1);
    assert.equal(Date.parse(x.end) - Date.parse(x.start), 2 * 3600_000);
  }
});

test('week: Wednesday 08:00 and 14:45 are one flex session, only one can be booked', () => {
  const { labs } = setup(NOW_CONFIG);
  const c = labs.giveSessions({ email: 'flex@x.dk', name: 'Flex', qty: 6, note: 't' }).customerId;
  const early = '2026-12-09T08:00:00+01:00', late = '2026-12-09T14:45:00+01:00';
  const free = (start: string) => labs.slots().some((x) => x.start === start);
  assert.ok(free(early) && free(late));
  const b = labs.book(c, early, { by: 'rider' });
  assert.equal(free(late), false, '14:45 shows as full once 08:00 is booked');
  assert.throws(() => labs.book(c, late, { by: 'rider' }), /filled up/);
  // Other Wednesdays and other sessions that day are not touched.
  assert.ok(free('2026-12-16T14:45:00+01:00') && free('2026-12-09T10:00:00+01:00') && free('2026-12-09T12:30:00+01:00'));
  // Moving the 08:00 rider to 14:45 the same day works: the pair is their own booking.
  const moved = labs.reschedule(b.id, late, 'rider');
  assert.equal(free(early), false, 'now 08:00 is the one that is full');
  labs.cancel(moved.id, 'rider');
  assert.ok(free(early) && free(late), 'after a cancel both are free again');
});

test('week: a rider paying for Wednesday 14:45 blocks 08:00 until the hold runs out', () => {
  const { labs, tick } = setup(NOW_CONFIG);
  labs.checkout(rider('hold@x.dk', { start: '2026-12-09T14:45:00+01:00' }));
  assert.equal(labs.slots().some((x) => x.start === '2026-12-09T08:00:00+01:00'), false);
  assert.throws(() => labs.checkout(rider('other@x.dk', { start: '2026-12-09T08:00:00+01:00' })), /filled up/);
  tick(hours(1));
  assert.ok(labs.slots().some((x) => x.start === '2026-12-09T08:00:00+01:00'));
});

test('week: the team still cannot book both flex sessions on a Wednesday', () => {
  const { labs } = setup(NOW_CONFIG);
  const a = labs.giveSessions({ email: 'a@x.dk', name: 'A', qty: 1, note: 't' }).customerId;
  const b2 = labs.giveSessions({ email: 'b@x.dk', name: 'B', qty: 1, note: 't' }).customerId;
  labs.book(a, '2026-12-09T14:45:00+01:00', { by: 'team' });
  assert.throws(() => labs.book(b2, '2026-12-09T08:00:00+01:00', { by: 'team' }), /filled up/);
});

test('calendar invite is its own short email; the content email says it comes separately', async () => {
  const { riderInvite, sessionIcs } = await import('../worker/mail.ts');
  const { labs } = setup(NOW_CONFIG);
  const c = labs.giveSessions({ email: 'inv@x.dk', name: 'Ina Vite', qty: 2, note: 't' }).customerId;
  const b = labs.book(c, '2026-12-09T10:00:00+01:00', { by: 'rider' });
  const conf = labs.db.emails.find((e) => e.template === 'confirmation')!;
  assert.ok(conf.body.includes('The calendar invite comes in a separate email') && !conf.body.includes('attached'));
  const cust = labs.customerByEmail('inv@x.dk')!;
  const inv = riderInvite(b, cust, 'confirmation', 'https://book.ndure.dk');
  assert.ok(inv.subject.startsWith('NDURE Labs session,') && inv.details.includes('tally.so/r/peyDxB') && inv.details.includes('https://book.ndure.dk/account'));
  assert.ok(sessionIcs(b, { method: 'REQUEST', to: 'inv@x.dk', from: 'performance@ndure.dk', details: inv.details }).includes('METHOD:REQUEST'));
  assert.ok(riderInvite(b, cust, 'rescheduled', 'x').subject.startsWith('Updated: '));
  assert.ok(riderInvite(b, cust, 'cancelled', 'x').subject.startsWith('Cancelled: '));
  assert.ok(!riderInvite({ ...b, form: { at: 'x' } as any }, cust, 'confirmation', 'x').details.includes('tally.so'), 'no form link once the form is in');
});
