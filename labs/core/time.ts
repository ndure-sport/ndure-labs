// Copenhagen time helpers without any library.

export const TZ = 'Europe/Copenhagen';
const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const hours = (n: number) => n * HOUR;
export const days = (n: number) => n * DAY;

const pad = (n: number) => String(n).padStart(2, '0');

// Copenhagen is UTC+1 in winter and UTC+2 from the last Sunday of March to the last Sunday of October.
export function cphOffset(y: number, m: number, d: number): string {
  const lastSunday = (month: number) => {
    const last = new Date(Date.UTC(y, month + 1, 0));
    return last.getUTCDate() - last.getUTCDay();
  };
  const t = Date.UTC(y, m, d);
  const summer = t >= Date.UTC(y, 2, lastSunday(2)) && t < Date.UTC(y, 9, lastSunday(9));
  return summer ? '+02:00' : '+01:00';
}

export function cphDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

// Every session start (ISO with Copenhagen offset) between two moments, for the given weekdays and times.
export function localStarts(fromMs: number, toMs: number, weekdays: number[], times: { id: string; time: string }[]) {
  const out: { start: string; blockId: string; date: string }[] = [];
  const first = new Date(fromMs - DAY);
  for (let t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()); t <= toMs + DAY; t += DAY) {
    const d = new Date(t);
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
    if (!weekdays.includes(d.getUTCDay())) continue;
    const date = `${y}-${pad(m + 1)}-${pad(day)}`;
    for (const b of times) {
      const start = `${date}T${b.time}:00${cphOffset(y, m, day)}`;
      const ms = Date.parse(start);
      if (ms >= fromMs && ms <= toMs) out.push({ start, blockId: b.id, date });
    }
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.getTime();
}

export function fmt(iso: string | number, o: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).format(new Date(iso));
}

export const when = (iso: string | number) =>
  `${fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmt(iso, { hour: '2-digit', minute: '2-digit' })}`;
