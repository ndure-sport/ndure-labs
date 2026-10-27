// Business rules in one place, so they're easy to find and change.

// Riders can change or cancel for free until this many hours before the session.
export const CHANGE_DEADLINE_HOURS = 24;

// Sessions in a pack stay valid this long after payment (shown to riders, enforced by the team).
export const VALID_MONTHS = 12;

// Bump this whenever the consent wording below changes, so you can prove who agreed to what.
export const CONSENT_VERSION = '2026-10-27';

export const CONSENT_TEXT = {
  ready: 'I answered no to every question in the readiness check and I am fit for a maximal effort.',
  health:
    'I explicitly consent to NDURE ApS processing my health data (blood lactate, heart rate, power) to make my report.',
  terms: 'I accept the terms and cancellation policy.',
  research: 'Optional: NDURE may use my anonymised sensor data to develop its sensor.',
  film: 'Optional: I am fine with being filmed for NDURE content.'
} as const;

export type ConsentKey = keyof typeof CONSENT_TEXT;
export const REQUIRED_CONSENTS: ConsentKey[] = ['ready', 'health', 'terms'];

export function hoursUntil(iso: string, now = Date.now()): number {
  return (new Date(iso).getTime() - now) / 3_600_000;
}

export function canChange(startIso: string, now = Date.now()): boolean {
  return hoursUntil(startIso, now) >= CHANGE_DEADLINE_HOURS;
}

export function consentRecord(input: Partial<Record<ConsentKey, boolean>>) {
  const at = new Date().toISOString();
  const out: Record<string, { agreed: boolean; text: string }> = {};
  for (const k of Object.keys(CONSENT_TEXT) as ConsentKey[]) {
    out[k] = { agreed: !!input[k], text: CONSENT_TEXT[k] };
  }
  return { at, version: CONSENT_VERSION, items: out };
}
