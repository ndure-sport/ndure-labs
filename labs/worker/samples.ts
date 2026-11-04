// Example emails for the team's preview, made by the real engine with made up data,
// so a preview always shows exactly what riders get.

import { Labs } from '../core/engine';
import { DEFAULT_CONFIG } from '../core/config';
import { emptyDb, type Email, type Booking } from '../core/types';

export function sampleEmails(): { email: Email; booking?: Booking }[] {
  let now = Date.parse('2026-12-01T10:00:00+01:00');
  const labs = new Labs(emptyDb(), { ...DEFAULT_CONFIG, opensOn: null, minNoticeHours: 0 }, () => now);
  const consents = { ready: true, health: true, inperson: true, terms: true };
  const start = '2026-12-09T09:30:00+01:00';
  const o = labs.checkout({ name: 'Mette Jensen', email: 'mette@example.dk', phone: '+45 1234 5678', qty: 3, partner: false, start, consents } as any);
  labs.paid(o.id);
  const b = labs.db.bookings[0];
  labs.requestLogin('mette@example.dk', () => '123456');
  const moved = labs.book(b.customerId, '2026-12-16T09:30:00+01:00', { by: 'rider' });
  labs.reschedule(moved.id, '2026-12-17T09:30:00+01:00', 'rider');
  labs.cancel(moved.id, 'rider');
  now = Date.parse('2026-12-07T12:00:00+01:00'); labs.tick(); // reminder
  now = Date.parse('2026-12-09T09:31:00+01:00'); labs.markAttendance(b.id, 'attended');
  now = Date.parse('2026-12-11T12:00:00+01:00'); labs.tick(); // after
  now = Date.parse('2027-01-07T12:00:00+01:00'); labs.tick(); // check in reminder, 4 weeks
  now = Date.parse('2027-01-20T12:00:00+01:00'); labs.sendCheckIn(b.customerId, 'team');
  now = Date.parse('2027-11-10T12:00:00+01:00'); labs.tick(); // expiry
  const o2 = labs.checkout({ name: 'Pia Rider', email: 'pia@example.dk', qty: 1, partner: true, partnerName: 'Pat', partnerEmail: 'pat@example.dk', start: '2027-11-23T09:30:00+01:00', consents } as any);
  labs.paid(o2.id);
  const seen = new Set<string>();
  const out: { email: Email; booking?: Booking }[] = [];
  for (const e of labs.db.emails) {
    if (seen.has(e.template)) continue;
    seen.add(e.template);
    const id = e.key.split(':')[1];
    out.push({ email: e, booking: labs.db.bookings.find((x) => x.id === id) ?? (e.template === 'reminder' ? b : undefined) });
  }
  return out;
}
