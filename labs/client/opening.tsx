// Team: when the lab is open. Weekly hours, the first bookable day, and closed days on a calendar.

import { useState } from 'react';
import { fmt } from '../core/time';

export type OpeningData = {
  blocks: { id: string; label: string; time: string; capacity: number }[];
  hours: Record<string, string[]>;
  opensOn: string | null;
  days: { date: string; dow: number; blocks: string[]; closed: string | null; booked: number; before: boolean; past: boolean }[];
};
type Act = (payload: object, ok: string) => Promise<boolean>;

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const nice = (d: string) => fmt(d + 'T12:00:00Z', { weekday: 'short', day: 'numeric', month: 'short' });

export function Opening({ o, act }: { o: OpeningData; act: Act }) {
  const [hours, setHours] = useState(o.hours);
  const [opens, setOpens] = useState(o.opensOn ?? '');
  const [reason, setReason] = useState('Closed');
  const [range, setRange] = useState({ from: '', to: '', reason: '' });
  const changed = JSON.stringify(hours) !== JSON.stringify(o.hours);
  const toggle = (d: number, id: string) => {
    const cur = hours[d] ?? [];
    setHours({ ...hours, [d]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const clash = o.days.filter((d) => d.closed && d.booked > 0 && !d.past);
  const weeks: OpeningData['days'][] = [];
  for (let i = 0; i < o.days.length; i += 7) weeks.push(o.days.slice(i, i + 7));

  return (
    <>
      {clash.length > 0 && (
        <div className="msg err">Riders are booked on closed days: {clash.map((d) => `${nice(d.date)} (${d.booked})`).join(', ')}. Move or cancel them on the Sessions tab, so they get an email.</div>
      )}

      <section className="card">
        <h2 style={{ margin: 0 }}>Calendar</h2>
        <p className="small muted" style={{ margin: 0 }}>Click an open day to close it, click a closed day to open it again. Riders can only book from 1 week ahead.</p>
        <label style={{ maxWidth: 360 }}>Reason when closing a day<input maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Holiday, conference, maintenance" /></label>
        <div className="cal" role="grid" aria-label="Opening calendar">
          <div className="cal-row cal-head" role="row">{WEEK.map((d) => <span key={d} role="columnheader">{DAY[d].slice(0, 3)}</span>)}</div>
          {weeks.map((w) => (
            <div className="cal-row" role="row" key={w[0].date}>
              {w.map((d) => {
                const state = d.past ? 'past' : d.closed ? 'closed' : d.blocks.length === 0 ? 'off' : d.before ? 'before' : 'open';
                const canClick = !d.past && (d.closed || d.blocks.length > 0);
                const first = d.date.endsWith('-01') || d === o.days[0];
                return (
                  <button
                    key={d.date}
                    role="gridcell"
                    className={`cal-day ${state}${d.closed && d.booked ? ' clash' : ''}`}
                    disabled={!canClick}
                    title={d.closed ? `Closed: ${d.closed}` : d.blocks.length ? 'Open' : 'Not an opening day'}
                    aria-label={`${nice(d.date)}: ${d.closed ? `closed, ${d.closed}` : d.blocks.length ? 'open' : 'not an opening day'}${d.booked ? `, ${d.booked} booked` : ''}`}
                    onClick={() => d.closed
                      ? act({ action: 'reopen', from: d.date }, `${nice(d.date)} is open again.`)
                      : act({ action: 'close', from: d.date, reason }, d.booked ? `${nice(d.date)} closed. ${d.booked} already booked: move or cancel them.` : `${nice(d.date)} closed.`)}
                  >
                    <b>{first ? fmt(d.date + 'T12:00:00Z', { day: 'numeric', month: 'short' }) : Number(d.date.slice(8))}</b>
                    <small>{d.closed ? d.closed : d.past || !d.blocks.length ? '' : d.before ? 'Not open yet' : o.blocks.filter((b) => d.blocks.includes(b.id)).map((b) => b.time).join(' · ')}</small>
                    {d.booked > 0 && <span className="cal-n">{d.booked} booked</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="row small muted"><span className="key open" /> Open <span className="key closed" /> Closed <span className="key before" /> Before bookings open <span className="key off" /> Not an opening day</div>
      </section>

      <div className="grid">
        <section className="card">
          <h3>Close a period</h3>
          <p className="small muted" style={{ margin: 0 }}>For holidays or a full week away.</p>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label>From<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value, to: range.to && range.to >= e.target.value ? range.to : e.target.value })} /></label>
            <label>To<input type="date" min={range.from} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
            <label>Reason<input maxLength={120} value={range.reason} placeholder="Christmas" onChange={(e) => setRange({ ...range, reason: e.target.value })} /></label>
          </div>
          <div className="row">
            <button className="primary" disabled={!range.from} onClick={async () => { if (await act({ action: 'close', from: range.from, to: range.to || range.from, reason: range.reason }, 'Period closed.')) setRange({ from: '', to: '', reason: '' }); }}>Close these days</button>
            <button disabled={!range.from} onClick={async () => { if (await act({ action: 'reopen', from: range.from, to: range.to || range.from }, 'Period open again.')) setRange({ from: '', to: '', reason: '' }); }}>Open these days</button>
          </div>
        </section>

        <section className="card">
          <h3>Bookings open from</h3>
          <p className="small muted" style={{ margin: 0 }}>Riders can't book sessions before this day. The team can.</p>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label>Date<input type="date" value={opens} onChange={(e) => setOpens(e.target.value)} /></label>
            <button className="primary" disabled={opens === (o.opensOn ?? '')} onClick={() => act({ action: 'opens_on', date: opens || null }, opens ? `Riders can book from ${nice(opens)}.` : 'No start date: riders can book any open day.')}>Save</button>
            {o.opensOn && <button onClick={() => { setOpens(''); act({ action: 'opens_on', date: null }, 'No start date: riders can book any open day.'); }}>Remove</button>}
          </div>
        </section>
      </div>

      <section className="card">
        <h3>Weekly hours</h3>
        <p className="small muted" style={{ margin: 0 }}>The normal week. Closed days on the calendar come on top of this.</p>
        <div className="scroll">
          <table className="team hours">
            <thead><tr><th>Day</th>{o.blocks.map((b) => <th key={b.id}>{b.label} {b.time}<br /><span className="muted">{b.capacity} {b.capacity === 1 ? 'rider' : 'riders'}</span></th>)}</tr></thead>
            <tbody>
              {WEEK.map((d) => (
                <tr key={d}>
                  <td>{DAY[d]}</td>
                  {o.blocks.map((b) => (
                    <td key={b.id}><label className="check"><input type="checkbox" checked={(hours[d] ?? []).includes(b.id)} onChange={() => toggle(d, b.id)} /><span className="sr">{DAY[d]} {b.label}</span></label></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button className="primary" disabled={!changed} onClick={() => act({ action: 'hours', hours }, 'Weekly hours saved.')}>Save weekly hours</button>
          {changed && <button onClick={() => setHours(o.hours)}>Undo</button>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>Changing times or how many riders fit in a session is a code change: ask Claude.</p>
      </section>
    </>
  );
}
