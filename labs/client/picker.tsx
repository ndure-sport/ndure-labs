// Month calendar and time list, used on the Labs page, in the rider account and on the team page.
// Days with free sessions can be clicked; other days are grey (closed, full or not an opening day).

import { useEffect, useMemo, useState } from 'react';
import type { Slot } from '../core/engine';
import { cphDate, fmt } from '../core/time';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_DA = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
const pad = (n: number) => String(n).padStart(2, '0');

export function MonthPicker({ slots, value, onChange, compact = false, lang = 'en' }: { slots: Slot[]; value: string | null; onChange: (start: string) => void; compact?: boolean; lang?: 'en' | 'da' }) {
  const da = lang === 'da';
  const t = (en: string, dk: string) => (da ? dk : en);
  const loc = da ? 'da-DK' : 'en-GB';
  const longDay = (iso: string) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' }, loc);
  const clock = (iso: string) => fmt(iso, { hour: '2-digit', minute: '2-digit' }, loc);
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots) {
      const d = cphDate(Date.parse(s.start));
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return m;
  }, [slots]);
  const months = useMemo(() => [...new Set([...byDay.keys()].map((d) => d.slice(0, 7)))].sort(), [byDay]);
  const [day, setDay] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);

  // Keep the chosen day valid when the free sessions change; start on the picked time or the first free day.
  useEffect(() => {
    const fromValue = value ? cphDate(Date.parse(value)) : null;
    const d = fromValue && byDay.has(fromValue) ? fromValue : day && byDay.has(day) ? day : [...byDay.keys()].sort()[0] ?? null;
    setDay(d);
    if (!month || !months.includes(month)) setMonth(d ? d.slice(0, 7) : months[0] ?? null);
  }, [byDay]);

  if (!month) return null;
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${pad(i + 1)}`)];
  const mi = months.indexOf(month);
  const times = day ? byDay.get(day) ?? [] : [];

  const calendar = (
    <div className="mcal">
      <div className="mcal-head">
        <b>{fmt(`${month}-15T12:00:00Z`, { month: 'long', year: 'numeric' }, loc)}</b>
        <span className="mcal-nav">
          <button type="button" className="mnav" aria-label={t('Previous month', 'Forrige måned')} disabled={mi <= 0} onClick={() => setMonth(months[mi - 1])}>‹</button>
          <button type="button" className="mnav" aria-label={t('Next month', 'Næste måned')} disabled={mi >= months.length - 1} onClick={() => setMonth(months[mi + 1])}>›</button>
        </span>
      </div>
      <div className="mgrid" role="grid" aria-label={t('Pick a day', 'Vælg en dag')}>
        {(da ? WEEK_DA : WEEK).map((w) => <span key={w} className="mwd" role="columnheader">{w}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} />;
          const list = byDay.get(d);
          const n = Number(d.slice(8));
          if (!list) return <span key={d} className="mday off" aria-hidden="true">{n}</span>;
          const free = list.reduce((s, x) => s + x.free, 0);
          return (
            <button key={d} type="button" className="mday" aria-pressed={day === d} aria-label={`${longDay(list[0].start)}, ${free === 1 ? t('last spot', 'sidste plads') : t(`${free} spots free`, `${free} ledige pladser`)}`} onClick={() => setDay(d)}>
              {n}<i className={free <= 1 ? 'few' : ''} />
            </button>
          );
        })}
      </div>
      <p className="mkey"><span><i /> {t('Free', 'Ledig')}</span><span><i className="few" /> {t('Almost full', 'Næsten fuld')}</span><span>{t('Grey: closed or full', 'Grå: lukket eller fuld')}</span></p>
    </div>
  );

  const list = day && (
    <div className="stack g8">
      <p className="tday">{longDay(times[0].start)}</p>
      <div className="tlist" role="group" aria-label={t('Time', 'Tid')}>
        {times.map((s) => (
          <button type="button" key={s.start} className="tslot" aria-pressed={value === s.start} onClick={() => onChange(s.start)}>
            <span><b>{clock(s.start)}</b><small>{clock(s.start)} {t('to', 'til')} {clock(s.end)}</small></span>
            <em className={s.free === 1 ? 'last' : ''}>{s.free === 1 ? t('1 spot left', '1 plads tilbage') : t(`${s.free} spots left`, `${s.free} pladser tilbage`)}</em>
          </button>
        ))}
      </div>
    </div>
  );

  return compact ? <div className="mpick side-by-side">{calendar}{list}</div> : <div className="mpick">{calendar}{list}</div>;
}
