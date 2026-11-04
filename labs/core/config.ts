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
  emails: {
    reminderHoursBefore: number;
    afterSessionDays: number;
    retestNudgeWeeks: number[]; // only sent when the rider has nothing booked
    expiryWarningDays: number;
  };
  loginCodeMinutes: number;
  loginMaxAttempts: number;
};

export const DEFAULT_CONFIG: Config = {
  currency: 'DKK',
  // Snapshot, Progress, Season
  tiers: [
    { min: 1, unit: 499 },
    { min: 3, unit: 435 },
    { min: 6, unit: 375 }
  ],
  packs: [1, 3, 6],
  partnerPrice: 375, // not offered on the page yet
  maxQty: 6,
  validityMonths: 12,
  changeDeadlineHours: 24,
  minNoticeHours: 168, // one week
  bookingWeeksAhead: 8,
  opensOn: '2026-12-01', // the relaunch
  holdMinutes: 35,
  days: [2, 3, 4, 5],
  blocks: [
    { id: 'am', label: 'Morning', time: '09:30', minutes: 150, capacity: 2 },
    { id: 'pm', label: 'Afternoon', time: '13:00', minutes: 180, capacity: 1 }
  ],
  emails: { reminderHoursBefore: 48, afterSessionDays: 2, retestNudgeWeeks: [4, 8], expiryWarningDays: 30 },
  loginCodeMinutes: 10,
  loginMaxAttempts: 5
};
