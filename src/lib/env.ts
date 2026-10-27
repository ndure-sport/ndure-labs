// Read configuration lazily, so a missing variable fails the one request that
// needs it with a clear message instead of crashing the whole app at boot.

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export function appUrl(): string {
  return env('APP_URL').replace(/\/$/, '');
}

export type EventTypeConfig = { id: number; label: string; seats: number };

export function eventTypes(): EventTypeConfig[] {
  const raw = env('CALCOM_EVENT_TYPES');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('CALCOM_EVENT_TYPES is not valid JSON. See .env.example.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('CALCOM_EVENT_TYPES must be a non empty JSON array.');
  }
  return parsed.map((e) => {
    const o = e as Record<string, unknown>;
    const id = Number(o.id);
    const seats = Number(o.seats);
    if (!Number.isInteger(id) || !Number.isInteger(seats) || seats < 1) {
      throw new Error('Each CALCOM_EVENT_TYPES entry needs a numeric id and seats >= 1.');
    }
    return { id, seats, label: String(o.label ?? 'Session') };
  });
}

export const TIME_ZONE = 'Europe/Copenhagen';
