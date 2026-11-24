// Every business rule for NDURE Labs in one place. Change a number here and both
// the prototype and the live app follow.

export type Block = { id: string; label: string; time: string; minutes: number; capacity: number };

export type Config = {
  currency: 'EUR' | 'DKK';
  tiers: { min: number; unit: number }[]; // price per session from `min` sessions up
  packs: number[]; // the only session counts a rider can buy
  partnerPrice: number;
  maxQty: number;
  validityMonths: number; // sessions expire this long after payment
  changeDeadlineHours: number; // riders can change or cancel until this long before
  minNoticeHours: number; // earliest a session can be booked before it starts
  bookingWeeksAhead: number;
  opensOn: string | null; // first day riders can book (YYYY-MM-DD, Copenhagen), null for no limit
  holdMinutes: number; // seat held while a rider pays
  days: number[]; // 0 Sunday … 6 Saturday
  blocks: Block[];
  // Which sessions are open on each weekday (0 Sunday … 6 Saturday). A day that is missing opens every session.
  // The team can change this on the team page; that choice wins.
  week?: Record<number, string[]>;
  // Sessions on one weekday that share one rider: once one of them is booked (or held while paying),
  // the others in the group show as full that day.
  pairs?: { dow: number; blocks: string[] }[];
  emails: {
    reminderHoursBefore: number;
    afterSessionDays: number;
    retestNudgeWeeks: number[]; // only sent when the rider has nothing booked
    expiryWarningDays: number;
    // Automatic emails that are switched off. Change this list to switch one on or off (see EMAILS.md).
    // Possible: 'reminder', 'after', 'nudge', 'expiry'. Booking emails (login, payment, confirmation,
    // moved, cancelled) always go out.
    off: string[];
  };
  loginCodeMinutes: number;
  loginMaxAttempts: number;
};

export const DEFAULT_CONFIG: Config = {
  currency: 'DKK',
  // Snapshot, Progress, Season
  tiers: [
    { min: 1, unit: 499 },
    { min: 3, unit: 429 },
    { min: 6, unit: 375 }
  ],
  packs: [1, 3, 6],
  partnerPrice: 375, // not offered on the page yet
  maxQty: 6,
  validityMonths: 12,
  changeDeadlineHours: 24,
  // Switched off for testing. To turn the rules on again: minNoticeHours: 168 (one week) and
  // opensOn: '2026-12-01'. The texts on the site follow these two settings by themselves.
  minNoticeHours: 0,
  bookingWeeksAhead: 12,
  opensOn: null,
  holdMinutes: 35,
  // Tuesday 4 sessions, Wednesday 4 with one flex pair, Thursday 3. One rider per session.
  days: [2, 3, 4],
  blocks: [
    { id: 's0800', label: 'Morning', time: '08:00', minutes: 120, capacity: 1 },
    { id: 's1000', label: 'Morning', time: '10:00', minutes: 120, capacity: 1 },
    { id: 's1230', label: 'Afternoon', time: '12:30', minutes: 120, capacity: 1 },
    { id: 's1445', label: 'Afternoon', time: '14:45', minutes: 120, capacity: 1 }
  ],
  week: {
    2: ['s0800', 's1000', 's1230', 's1445'],
    3: ['s0800', 's1000', 's1230', 's1445'],
    4: ['s0800', 's1000', 's1230']
  },
  // Wednesday: 08:00 and 14:45 are one flex session. Only one of the two can be booked.
  pairs: [{ dow: 3, blocks: ['s0800', 's1445'] }],
  emails: { reminderHoursBefore: 26, afterSessionDays: 2, retestNudgeWeeks: [4, 8], expiryWarningDays: 30, off: ['after', 'nudge', 'expiry'] },
  loginCodeMinutes: 10,
  loginMaxAttempts: 5
};

// " · at least 1 week ahead" when the notice rule is on, otherwise nothing.
export function noticeText(c: Config): string {
  const h = c.minNoticeHours;
  if (h < 24) return '';
  return h % 24 === 0 ? (h / 24 === 7 ? '1 week' : `${h / 24} days`) : `${h} hours`;
}
