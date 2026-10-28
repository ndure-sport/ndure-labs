// Every business rule for NDURE Labs in one place. Change a number here and both
// the prototype and the live app follow.

export type Block = { id: string; label: string; time: string; minutes: number; capacity: number };

export type Config = {
  currency: 'EUR' | 'DKK';
  tiers: { min: number; unit: number }[]; // price per session from `min` sessions up
  partnerPrice: number;
  maxQty: number;
  validityMonths: number; // sessions expire this long after payment
  changeDeadlineHours: number; // riders can change or cancel until this long before
  minNoticeHours: number; // earliest a session can be booked before it starts
  bookingWeeksAhead: number;
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
  currency: 'EUR',
  tiers: [
    { min: 1, unit: 99 },
    { min: 3, unit: 85 },
    { min: 5, unit: 76 },
    { min: 10, unit: 69 }
  ],
  partnerPrice: 79,
  maxQty: 10,
  validityMonths: 12,
  changeDeadlineHours: 24,
  minNoticeHours: 168, // one week
  bookingWeeksAhead: 8,
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
