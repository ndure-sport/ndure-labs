// The CRM tabs on the team page: riders to follow up, contacts to call, sales per month.

import { useMemo, useState } from 'react';
import { fmt, when } from '../core/time';
import type { Lead, LeadStatus } from '../core/types';
import { kr } from './shared';

type Touch = { at: string; kind: 'call' | 'email' | 'note'; text: string; by: string };
type Hist = Touch & { id: string };
export type CrmRider = {
  id: string; name: string; email: string; phone: string | null; goal: string | null; firstPaid: string | null; spent: number;
  visits: number; noShows: number; lastVisit: string | null; nextVisit: string | null; left: number; expires: string | null;
  status: 'due' | 'never_came' | 'fine' | 'booked'; followUpOn: string | null; followUpDue: boolean; noReminders: boolean;
  lastContact: Touch | null; history: Hist[]; visitList: string[];
};
export type CrmLead = Lead & { followUpDue: boolean; lastContact: Touch | null; history: Hist[]; isRider: boolean };
export type CrmData = {
  today: string;
  riders: CrmRider[];
  leads: CrmLead[];
  unpaid: { id: string; name: string; email: string; phone: string | null; at: string; qty: number; total: number; open: boolean; inLeads: boolean }[];
  sales: { month: string; revenue: number; orders: number; sessions: number; newRiders: number; visits: number }[];
};
type Act = (payload: object, ok: string) => Promise<boolean>;

const date = (iso: string) => fmt(iso, { day: 'numeric', month: 'short', year: 'numeric' });
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (d < 1) return 'today';
  if (d < 14) return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  const m = Math.round(d / 30.4);
  return m < 24 ? `${m} months ago` : `${Math.round(m / 12)} years ago`;
};
const touch = (t: Touch | null) => (t ? `${{ call: 'Call', email: 'Email', note: 'Note' }[t.kind]} ${ago(t.at)}: ${t.text}` : 'No contact yet');
const STATUS: Record<CrmRider['status'], [string, string]> = {
  due: ['Due for a check in', 'due'],
  never_came: ['Paid, never came in', 'due'],
  fine: ['Recently in', 'fine'],
  booked: ['Booked', 'ok']
};
const LEAD_STATUS: Record<LeadStatus, string> = { new: 'New', contacted: 'Contacted', interested: 'Interested', not_now: 'Not now', booked: 'Booked' };
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// Log a call or note, and set when to follow up next.
function LogBox({ onLog, kinds = ['call', 'note'] }: { onLog: (kind: string, text: string, followUpOn: string | null) => Promise<boolean>; kinds?: string[] }) {
  const [kind, setKind] = useState(kinds[0]);
  const [text, setText] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form className="box" onSubmit={async (e) => { e.preventDefault(); setBusy(true); if (await onLog(kind, text, next || null)) { setText(''); setNext(''); } setBusy(false); }}>
      <div className="row">
        {kinds.map((k) => <button type="button" key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'call' ? 'Log a call' : k === 'email' ? 'Log an email' : 'Add a note'}</button>)}
      </div>
      <label>{kind === 'call' ? 'How did the call go?' : 'Note'}<input maxLength={500} required value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'call' ? 'Talked to him, wants to come in January' : 'Prefers mornings'} /></label>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label>Follow up on<input type="date" value={next} onChange={(e) => setNext(e.target.value)} /></label>
        <span className="row small">{[[7, '1 week'], [28, '4 weeks'], [56, '8 weeks']].map(([n, l]) => <button type="button" key={n} onClick={() => setNext(inDays(n as number))}>{l}</button>)}</span>
        <button className="primary" disabled={busy || !text.trim()}>Save</button>
      </div>
    </form>
  );
}

function History({ items }: { items: Hist[] }) {
  if (!items.length) return <p className="small muted">No calls, emails or notes yet.</p>;
  return (
    <ul className="hist">
      {items.map((h) => <li key={h.id}><span className="muted">{date(h.at)} · {h.by === 'system' ? 'automatic' : h.by.replace(/^rider:/, 'rider ')}</span><b>{{ call: 'Call', email: 'Email', note: 'Note' }[h.kind]}</b> {h.text}</li>)}
    </ul>
  );
}

// ---------------- follow up ----------------
export function FollowUp({ crm, act }: { crm: CrmData; act: Act }) {
  const [filter, setFilter] = useState<'todo' | 'due' | 'left' | 'never' | 'all'>('todo');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => crm.riders.filter((r) => {
    if (q && !`${r.name} ${r.email} ${r.phone ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === 'todo') return r.followUpDue || r.status === 'due' || r.status === 'never_came';
    if (filter === 'due') return r.status === 'due';
    if (filter === 'left') return r.left > 0 && !r.nextVisit;
    if (filter === 'never') return r.status === 'never_came';
    return true;
  }), [crm, filter, q]);
  const count = (f: typeof filter) => crm.riders.filter((r) => (f === 'todo' ? r.followUpDue || r.status === 'due' || r.status === 'never_came' : f === 'due' ? r.status === 'due' : f === 'left' ? r.left > 0 && !r.nextVisit : f === 'never' ? r.status === 'never_came' : true)).length;
  return (
    <section className="card">
      <div className="row spread"><h2 style={{ margin: 0 }}>Follow up</h2><input className="search" type="search" placeholder="Search name, email, phone" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <p className="small muted" style={{ margin: 0 }}>Riders who paid. "Due" means the last session was 8 weeks ago or more and nothing is booked. Riders also get automatic reminders at 4 and 8 weeks unless they stopped them.</p>
      <div className="row" role="group" aria-label="Filter">
        {([['todo', 'To do'], ['due', 'Due for a check in'], ['left', 'Sessions left, nothing booked'], ['never', 'Paid, never came'], ['all', 'All riders']] as const).map(([k, l]) => (
          <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} <span className="muted">{count(k)}</span></button>
        ))}
      </div>
      {list.length === 0 && <p className="muted">Nobody here right now.</p>}
      <div className="crm-list">
        {list.map((r) => (
          <div key={r.id} className={`crm-row${open === r.id ? ' open' : ''}`}>
            <button className="crm-head" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span className="crm-name"><b>{r.name}</b><span className={`pill ${r.followUpDue ? 'due' : STATUS[r.status][1]}`}>{r.followUpDue ? `Follow up ${r.followUpOn === crm.today ? 'today' : 'overdue'}` : STATUS[r.status][0]}</span></span>
              <span><span className="muted small">Last in</span><br />{r.lastVisit ? `${date(r.lastVisit)}, ${ago(r.lastVisit)}` : 'Never'}</span>
              <span><span className="muted small">Next</span><br />{r.nextVisit ? when(r.nextVisit) : 'Nothing booked'}</span>
              <span><span className="muted small">Sessions left</span><br />{r.left}</span>
              <span className="crm-last"><span className="muted small">Last contact</span><br />{touch(r.lastContact)}</span>
            </button>
            {open === r.id && (
              <div className="crm-body">
                <div className="row">
                  {r.phone && <a className="button" href={`tel:${r.phone.replace(/\s/g, '')}`}>Call {r.phone}</a>}
                  <a className="button" href={`mailto:${r.email}`}>Email {r.email}</a>
                  <button disabled={r.noReminders} onClick={() => act({ action: 'checkin', customerId: r.id }, `Check in email sent to ${r.name}.`)}>Send check in email</button>
                </div>
                <p className="small" style={{ margin: 0 }}>
                  {r.visits} {r.visits === 1 ? 'visit' : 'visits'}{r.noShows ? `, ${r.noShows} no show` : ''} · paid {kr(r.spent)} · rider since {r.firstPaid ? date(r.firstPaid) : 'n/a'}
                  {r.expires && r.left > 0 ? ` · sessions expire ${date(r.expires)}` : ''}{r.goal ? ` · goal: ${r.goal}` : ''}
                </p>
                {r.visitList.length > 0 && <p className="small muted" style={{ margin: 0 }}>Visits: {r.visitList.map(date).join(', ')}</p>}
                <div className="row small">
                  <label className="check"><input type="checkbox" checked={!r.noReminders} onChange={() => act({ action: 'reminders', customerId: r.id, on: r.noReminders }, r.noReminders ? 'Reminder emails on.' : 'Reminder emails off.')} /> Gets reminder emails</label>
                  {r.followUpOn && <span>Follow up on {date(r.followUpOn)} <button onClick={() => act({ action: 'followup', customerId: r.id, date: null }, 'Follow up cleared.')}>Clear</button></span>}
                </div>
                <LogBox onLog={(kind, text, followUpOn) => act({ action: 'contact_log', customerId: r.id, kind, text, followUpOn }, 'Saved.')} />
                <History items={r.history} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------- contacts ----------------
const EMPTY = { name: '', phone: '', email: '', source: '', note: '', okToCall: false, followUpOn: '' };
export function Contacts({ crm, act }: { crm: CrmData; act: Act }) {
  const [f, setF] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const list = crm.leads.filter((l) => filter === 'all' || !['booked', 'not_now'].includes(l.status));
  return (
    <>
      <section className="card">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>Contacts</h2>
          <button className="primary" onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'Add a contact'}</button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>People who might book: met at a race, asked for a call, wrote on Instagram. Danish law: only call private people who asked for it or said yes, so tick "OK to call" only then.</p>
        {adding && (
          <form className="box" onSubmit={async (e) => { e.preventDefault(); if (await act({ action: 'lead_save', lead: { ...f, followUpOn: f.followUpOn || null } }, `${f.name} added.`)) { setF(EMPTY); setAdding(false); } }}>
            <div className="fields">
              <label>Name<input required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
              <label>Phone<input type="tel" maxLength={30} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
              <label>Email<input type="email" maxLength={254} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
              <label>Where we met<input maxLength={80} placeholder="Copenhagen Ironman expo" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></label>
              <label>Follow up on<input type="date" value={f.followUpOn} onChange={(e) => setF({ ...f, followUpOn: e.target.value })} /></label>
            </div>
            <label>Note<input maxLength={500} placeholder="Triathlete, wants to test before the season" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={f.okToCall} onChange={() => setF({ ...f, okToCall: !f.okToCall })} /> They asked us to call, or said yes to a call</label>
            <div><button className="primary" disabled={!f.name.trim() || (!f.phone.trim() && !f.email.trim())}>Save contact</button></div>
          </form>
        )}
        <div className="row" role="group" aria-label="Filter">
          <button aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>Open <span className="muted">{crm.leads.filter((l) => !['booked', 'not_now'].includes(l.status)).length}</span></button>
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All <span className="muted">{crm.leads.length}</span></button>
        </div>
        {list.length === 0 && <p className="muted">No contacts yet.</p>}
        <div className="crm-list">
          {list.map((l) => (
            <div key={l.id} className={`crm-row${open === l.id ? ' open' : ''}`}>
              <button className="crm-head" aria-expanded={open === l.id} onClick={() => setOpen(open === l.id ? null : l.id)}>
                <span className="crm-name"><b>{l.name}</b><span className={`pill ${l.followUpDue ? 'due' : l.status === 'booked' || l.isRider ? 'ok' : 'fine'}`}>{l.followUpDue ? 'Follow up now' : l.isRider ? 'Now a rider' : LEAD_STATUS[l.status]}</span></span>
                <span><span className="muted small">Where we met</span><br />{l.source || 'n/a'}</span>
                <span><span className="muted small">Follow up</span><br />{l.followUpOn ? date(l.followUpOn) : 'Not set'}</span>
                <span><span className="muted small">Call</span><br />{l.okToCall ? 'OK to call' : 'Email only'}</span>
                <span className="crm-last"><span className="muted small">Last contact</span><br />{touch(l.lastContact)}</span>
              </button>
              {open === l.id && (
                <div className="crm-body">
                  <div className="row">
                    {l.phone && l.okToCall && <a className="button" href={`tel:${l.phone.replace(/\s/g, '')}`}>Call {l.phone}</a>}
                    {l.phone && !l.okToCall && <span className="small muted">{l.phone} (not OK to call yet)</span>}
                    {l.email && <a className="button" href={`mailto:${l.email}`}>Email {l.email}</a>}
                  </div>
                  {l.note && <p className="small" style={{ margin: 0 }}>{l.note}</p>}
                  <div className="row small">
                    <label>Status
                      <select value={l.status} onChange={(e) => act({ action: 'lead_save', lead: { id: l.id, status: e.target.value } }, 'Status saved.')}>
                        {(Object.keys(LEAD_STATUS) as LeadStatus[]).map((k) => <option key={k} value={k}>{LEAD_STATUS[k]}</option>)}
                      </select>
                    </label>
                    <label className="check"><input type="checkbox" checked={l.okToCall} onChange={() => act({ action: 'lead_save', lead: { id: l.id, okToCall: !l.okToCall } }, 'Saved.')} /> OK to call</label>
                    <button onClick={() => { if (confirm(`Remove ${l.name} and their history?`)) act({ action: 'lead_remove', leadId: l.id }, `${l.name} removed.`); }}>Remove</button>
                  </div>
                  <LogBox kinds={['call', 'email', 'note']} onLog={(kind, text, followUpOn) => act({ action: 'contact_log', leadId: l.id, kind, text, followUpOn, status: l.status === 'new' && kind !== 'note' ? 'contacted' : undefined }, 'Saved.')} />
                  <History items={l.history} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 style={{ margin: 0 }}>Started booking, did not pay</h2>
        <p className="small muted" style={{ margin: 0 }}>Kept for 3 weeks, then deleted. Only reach out if they asked for it; add them to contacts to keep them longer.</p>
        {crm.unpaid.length === 0 && <p className="muted">Nobody right now.</p>}
        <div className="scroll">
          <table className="team">
            <tbody>
              {crm.unpaid.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.name}</b><br /><span className="muted">{u.email}{u.phone ? ` · ${u.phone}` : ''}</span></td>
                  <td>{u.qty} {u.qty === 1 ? 'session' : 'sessions'}, {kr(u.total)}<br /><span className="muted">{when(u.at)}{u.open ? ', paying now' : ''}</span></td>
                  <td className="actions">{u.inLeads ? <span className="muted small">In contacts</span> : <button onClick={() => act({ action: 'lead_from_unpaid', customerId: u.id }, `${u.name} added to contacts.`)}>Add to contacts</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ---------------- sales ----------------
export function Sales({ crm }: { crm: CrmData }) {
  const t = crm.sales.reduce((a, s) => ({ revenue: a.revenue + s.revenue, orders: a.orders + s.orders, sessions: a.sessions + s.sessions, newRiders: a.newRiders + s.newRiders, visits: a.visits + s.visits }), { revenue: 0, orders: 0, sessions: 0, newRiders: 0, visits: 0 });
  const riders = crm.riders.length;
  const back = crm.riders.filter((r) => r.visits >= 2).length;
  const monthName = (m: string) => fmt(`${m}-15T12:00:00Z`, { month: 'long', year: 'numeric' });
  return (
    <section className="card">
      <h2 style={{ margin: 0 }}>Sales</h2>
      <div className="kpis">
        <div><span>Revenue, last 12 months</span><b>{kr(t.revenue)}</b></div>
        <div><span>Riders who paid</span><b>{riders}</b></div>
        <div><span>Came back at least once</span><b>{back}</b><small className="muted">{riders ? Math.round((back / riders) * 100) : 0}% of riders</small></div>
        <div><span>Sessions sold, not used yet</span><b>{crm.riders.reduce((n, r) => n + r.left, 0)}</b></div>
      </div>
      <div className="scroll">
        <table className="team">
          <thead><tr><th>Month</th><th>Revenue</th><th>Payments</th><th>Sessions sold</th><th>New riders</th><th>Sessions done</th></tr></thead>
          <tbody>
            {crm.sales.map((s) => <tr key={s.month}><td>{monthName(s.month)}</td><td>{kr(s.revenue)}</td><td>{s.orders}</td><td>{s.sessions}</td><td>{s.newRiders}</td><td>{s.visits}</td></tr>)}
            {crm.sales.length === 0 && <tr><td colSpan={6} className="muted">No sales yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Free sessions from the team are not counted as revenue. Refunds: close the order on the Sessions tab and it drops out. Stripe stays the source for bookkeeping.</p>
    </section>
  );
}
