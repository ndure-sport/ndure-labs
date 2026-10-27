'use client';

import { useEffect, useMemo, useState } from 'react';

export type Slot = { eventTypeId: number; label: string; start: string; end: string | null; free: number; seats: number };

const TZ = 'Europe/Copenhagen';
const dayKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
export const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).format(new Date(iso));
export const slotLabel = (s: Slot) => `${fmt(s.start, { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmt(s.start, { hour: '2-digit', minute: '2-digit' })}`;
export const sameSlot = (a: Slot | null, b: Slot | null) => !!a && !!b && a.eventTypeId === b.eventTypeId && a.start === b.start;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Props = {
  slots: Slot[] | null;
  need: number;
  value: Slot | null;
  onChange: (s: Slot) => void;
  error?: string | null;
  autoPickEarliest?: boolean;
};

// Shows the earliest free session as a one tap suggestion, plus a month calendar to browse.
export function SlotPicker({ slots, need, value, onChange, error, autoPickEarliest = true }: Props) {
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) m.set(dayKey(s.start), [...(m.get(dayKey(s.start)) ?? []), s]);
    return m;
  }, [slots]);
  const earliest = slots && slots.length > 0 ? slots[0] : null;

  const [day, setDay] = useState<string | null>(null);
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);

  // Preselect the earliest free session, and open the calendar on its month.
  useEffect(() => {
    if (!earliest) return;
    const stillThere = value && slots!.some((s) => sameSlot(s, value));
    const pick = stillThere ? value! : autoPickEarliest ? earliest : null;
    if (pick && !stillThere) onChange(pick);
    const k = dayKey((pick ?? earliest).start);
    setDay(k);
    const [y, m] = k.split('-').map(Number);
    setMonth((cur) => cur ?? { y, m: m - 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!slots) return <span className="small muted">Loading free sessions…</span>;
  if (slots.length === 0)
    return (
      <div className="notice">
        No free sessions {need > 1 ? 'with 2 spots ' : ''}in the coming weeks. Email <a href="mailto:contact@ndure.dk">contact@ndure.dk</a> and we will find a time.
      </div>
    );

  const keys = [...byDay.keys()].sort();
  const [firstY, firstM] = keys[0].split('-').map(Number);
  const [lastY, lastM] = keys[keys.length - 1].split('-').map(Number);
  const view = month ?? { y: firstY, m: firstM - 1 };
  const canPrev = view.y * 12 + view.m > firstY * 12 + (firstM - 1);
  const canNext = view.y * 12 + view.m < lastY * 12 + (lastM - 1);
  const shift = (d: number) => setMonth({ y: view.y + Math.floor((view.m + d) / 12), m: (((view.m + d) % 12) + 12) % 12 });

  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(view.y, view.m, 1)).getUTCDay() + 6) % 7; // Monday first
  const cells: ({ key: string; d: number } | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({ key: `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`, d: i + 1 }))
  ];
  const daySlots = day ? byDay.get(day) ?? [] : [];
  const isEarliest = sameSlot(value, earliest);

  return (
    <div className="picker">
      <div className={`suggest${isEarliest ? ' on' : ''}`}>
        <span className="stack" style={{ gap: 0 }}>
          <span className="eyebrow">Earliest free{need > 1 ? ' for 2' : ''}</span>
          <b>{fmt(earliest!.start, { weekday: 'long', day: 'numeric', month: 'long' })}, {fmt(earliest!.start, { hour: '2-digit', minute: '2-digit' })}</b>
          <span className="small muted">{earliest!.label}, {earliest!.free} of {earliest!.seats} free</span>
        </span>
        {isEarliest ? (
          <span className="eyebrow accent">Selected</span>
        ) : (
          <button type="button" className="btn dark" onClick={() => { onChange(earliest!); setDay(dayKey(earliest!.start)); }}>Take this</button>
        )}
      </div>

      <div className="cal" aria-label="Calendar">
        <div className="cal-hd">
          <button type="button" className="cal-nav" aria-label="Previous month" disabled={!canPrev} onClick={() => shift(-1)}>‹</button>
          <b>{MONTHS[view.m]} {view.y}</b>
          <button type="button" className="cal-nav" aria-label="Next month" disabled={!canNext} onClick={() => shift(1)}>›</button>
        </div>
        <div className="cal-grid" role="grid">
          {DOW.map((d) => <span key={d} className="cal-dow">{d}</span>)}
          {cells.map((c, i) => {
            if (!c) return <span key={`e${i}`} />;
            const list = byDay.get(c.key);
            const free = list?.reduce((n, s) => n + s.free, 0) ?? 0;
            const selected = day === c.key;
            const hasPick = !!value && dayKey(value.start) === c.key;
            return (
              <button
                key={c.key}
                type="button"
                className={`cal-day${list ? ' open' : ''}${selected ? ' sel' : ''}${hasPick ? ' pick' : ''}`}
                disabled={!list}
                aria-pressed={selected}
                aria-label={list ? `${c.key}, ${free} free` : `${c.key}, no sessions`}
                onClick={() => setDay(c.key)}
              >
                <span>{c.d}</span>
                {list && <span className="cal-free">{free}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {day && daySlots.length > 0 && (
        <div className="grid-chips">
          {daySlots.map((s) => (
            <button key={s.eventTypeId + s.start} type="button" className={`chip${sameSlot(value, s) ? ' on' : ''}`} aria-pressed={sameSlot(value, s)} onClick={() => onChange(s)}>
              <span className="k">{s.label}</span>
              <span className="v" style={{ fontSize: 16 }}>{fmt(s.start, { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="s">{s.free} of {s.seats} free</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
