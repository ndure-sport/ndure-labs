// Pages for book.ndure.dk: the Labs page with booking (/), rider account (/account), team (/team),
// partner consent (/consent/...) and the terms, privacy and health check pages.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type Slot } from '../core/engine';
import { fmt, when, cphDate, cphOffset } from '../core/time';
import type { ConsentKey, Booking, Customer, Order } from '../core/types';
import { api, ApiError, getConfig, kr, Msg, Turnstile, Header, Footer, type Note } from './shared';
import { MonthPicker } from './picker';
import { MEET, MEET_SHORT, MEET_MAPS, PICKUP, PREP, BRING, BRING_SHORT, PEDALS, SHOWERS, formLink } from '../core/visit';
import { Landing, BookPage } from './landing';
import { Terms, Privacy, HealthCheck } from './docs';
import { Opening, type OpeningData } from './opening';

const longDay = (iso: string) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' });
const time = (iso: string) => fmt(iso, { hour: '2-digit', minute: '2-digit' });
const NoteBox = Msg;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="page">{children}</main>
      <Footer />
    </>
  );
}

// ---------------- shared pieces ----------------
function SlotPicker({ slots, value, onChange, need }: { slots: Slot[] | null; value: string | null; onChange: (s: string) => void; need: number }) {
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) m.set(cphDate(Date.parse(s.start)), [...(m.get(cphDate(Date.parse(s.start))) ?? []), s]);
    return [...m.entries()];
  }, [slots]);
  if (!slots) return <p className="muted">Loading free sessions…</p>;
  if (slots.length === 0) return <p className="msg err">No free sessions{need > 1 ? ' with 2 spots' : ''} in the coming weeks. Email contact@ndure.dk.</p>;
  const first = slots[0];
  return (
    <div className="stack">
      <p>
        Earliest free{need > 1 ? ' for 2' : ''}: <b>{when(first.start)}</b>{' '}
        <button aria-pressed={value === first.start} onClick={() => onChange(first.start)}>{value === first.start ? 'Selected' : 'Take this'}</button>
      </p>
      <div className="pdays">
        {byDay.map(([d, list]) => (
          <div key={d} className="pday">
            <span className="dayname">{longDay(list[0].start)}</span>
            {list.map((s) => (
              <button key={s.start} aria-pressed={value === s.start} onClick={() => onChange(s.start)}>
                {time(s.start)} {s.label} · {s.free} of {s.capacity} free
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- login ----------------
function Login({ team, onDone, intro }: { team: boolean; onDone: () => void; intro?: Note }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [note, setNote] = useState<Note>(intro ?? null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [human, setHuman] = useState('');
  const [tsRound, setTsRound] = useState(0);
  useEffect(() => { getConfig().then((c) => setSiteKey(c.turnstileSiteKey)).catch(() => {}); }, []);
  const request = () =>
    api('/api/login/request', { email, team, turnstile: human })
      .then(() => { setSent(true); setNote({ kind: 'ok', text: 'If that email has an account, a code is on its way.' }); })
      .catch((e) => { setNote({ kind: 'err', text: e.message }); setHuman(''); setTsRound((n) => n + 1); });
  return (
    <section className="card narrow">
      <h1>{team ? 'Team login' : 'Log in'}</h1>
      <p className="muted">{team ? 'Team members only.' : 'Use the email you signed up with.'} We email you a 6 digit code.</p>
      <NoteBox note={note} />
      <label>Email<input type="email" maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {!sent ? (
        <>
          <Turnstile key={tsRound} siteKey={siteKey} onToken={setHuman} />
          <button className="primary" disabled={!!siteKey && !human} onClick={request}>Send code</button>
        </>
      ) : (
        <>
          <label>Code<input inputMode="numeric" maxLength={12} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <div className="row">
            <button className="primary" onClick={() => api('/api/login/verify', { email, code, team }).then(onDone).catch((e) => setNote({ kind: 'err', text: e.message }))}>Log in</button>
            <button onClick={() => { setSent(false); setCode(''); setHuman(''); setTsRound((n) => n + 1); }}>Use another email</button>
          </div>
        </>
      )}
    </section>
  );
}

// After paying, in a browser that is not logged in: wait for the payment, then log in.
type OrderStatus = { status: string; firstStatus: string; firstStart: string | null; newRider: boolean };
function AfterPayment({ orderId, onLoggedIn }: { orderId: string; onLoggedIn: () => void }) {
  const [st, setSt] = useState<OrderStatus | null>(null);
  const [gone, setGone] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const d = await api<OrderStatus>(`/api/order-status?id=${encodeURIComponent(orderId)}`);
        if (stop) return;
        setSt(d);
        if (d.status === 'paid' && d.newRider) onLoggedIn();
      } catch {
        if (!stop) setGone(true);
      }
      setTries((n) => n + 1);
    };
    check();
    const t = setInterval(() => { if (!stop) check(); }, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [orderId]);
  if (gone || st?.status === 'paid') {
    return <Login team={false} onDone={onLoggedIn} intro={st?.status === 'paid' ? { kind: 'ok', text: 'Payment received. Log in with your email to see and book your sessions.' } : null} />;
  }
  if (st && st.status !== 'pending') {
    return <section className="card narrow"><h1>Payment not completed</h1><p className="muted">Nothing was charged. <a href="/">Start again</a>.</p></section>;
  }
  return (
    <section className="card narrow">
      <h1>One moment</h1>
      <p className="muted">
        {st?.firstStart ? `Confirming your payment and your session on ${when(st.firstStart)}.` : 'Confirming your payment.'} This page updates by itself.
        {tries > 30 ? ' This is taking longer than usual. You will get an email as soon as the payment is confirmed.' : ''}
      </p>
    </section>
  );
}

// ---------------- rider account ----------------
type Upcoming = Booking & { changeable: boolean; icsUrl: string };
type TopUp = { parentId: string; has: number; max: number; expiresAt: string; options: { n: number; price: number; unit: number }[] } | null;
type AccountData = {
  customer: Customer;
  balance: { total: number; orders: Order[] };
  upcoming: Upcoming[];
  past: Booking[];
  nextDue: string | null;
  topUp: TopUp;
  pendingOrder: { status: string; firstStatus: string; firstStart: string | null } | null;
};

const PLACE = MEET;
const MAPS = MEET_MAPS;
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function CalendarLinks({ b }: { b: Upcoming }) {
  const title = encodeURIComponent('NDURE Labs lactate session');
  const loc = encodeURIComponent(PLACE);
  const details = encodeURIComponent(`Meet at the ${MEET_SHORT}. Bring: ${BRING_SHORT}`);
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${stamp(b.start)}/${stamp(b.end)}&location=${loc}&details=${details}`;
  const outlook = `https://outlook.office.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=${title}&startdt=${encodeURIComponent(new Date(b.start).toISOString())}&enddt=${encodeURIComponent(new Date(b.end).toISOString())}&location=${loc}&body=${details}`;
  return (
    <p className="cal-links">Add to calendar: <a href={outlook} target="_blank" rel="noopener noreferrer">Outlook</a><a href={google} target="_blank" rel="noopener noreferrer">Google</a><a href={b.icsUrl}>Apple / other</a></p>
  );
}

function SessionCard({ b, c, busy, onMove, onCancel, confirming, onConfirm, onKeep }: { b: Upcoming; c: Customer; busy: boolean; onMove: () => void; onCancel: () => void; confirming: boolean; onConfirm: () => void; onKeep: () => void }) {
  return (
    <div className="scard">
      <div className="scard-top">
        <div>
          <p className="scard-day">{longDay(b.start)}</p>
          <p className="muted" style={{ margin: 0 }}>{time(b.start)} to {time(b.end)}, {b.label.toLowerCase()} session{b.withPartner ? `, with ${b.partnerName}` : ''}</p>
        </div>
        {b.changeable && !confirming && (
          <span className="row"><button onClick={onMove}>Change date</button><button onClick={onCancel}>Cancel</button></span>
        )}
      </div>
      {confirming && (
        <div className="msg err row spread"><span>Cancel this session? It goes back on your account.</span>
          <span className="row"><button disabled={busy} onClick={onConfirm}>Yes, cancel</button><button onClick={onKeep}>Keep it</button></span>
        </div>
      )}
      <dl className="sinfo">
        <dt>Meet</dt><dd><a href={MAPS} target="_blank" rel="noopener noreferrer">{MEET_SHORT}</a><br /><span className="muted small">{PICKUP}</span></dd>
        <dt>Bring</dt><dd>{BRING.join(', ')}<br /><span className="muted small">{PEDALS}</span></dd>
        <dt>Prep</dt><dd>{PREP.join(' ')}<br /><span className="muted small">{SHOWERS}</span></dd>
      </dl>
      <div className="formbox"><span>Fill in the pre session form before you come (4 minutes), so your tester can set up your test.</span><a className="btn sm" href={formLink(c, b)} target="_blank" rel="noopener noreferrer">Open the form</a></div>
      <CalendarLinks b={b} />
      <p className="muted small" style={{ margin: 0 }}>{b.changeable ? 'Free to move or cancel until 24 hours before.' : 'Less than 24 hours to go: to change, email contact@ndure.dk.'}</p>
    </div>
  );
}

function AddSessions({ t, busy, onBuy }: { t: NonNullable<TopUp>; busy: boolean; onBuy: (n: number) => void }) {
  const snapshot = t.has === 1 && t.max >= 2;
  const [n, setN] = useState(snapshot ? 2 : 1);
  const opt = t.options.find((o) => o.n === n) ?? t.options[0];
  return (
    <div className="stack g12">
      <h3 style={{ margin: 0 }}>{snapshot ? 'Upgrade to Progress' : 'Add sessions'}</h3>
      {snapshot && <p className="small" style={{ margin: 0 }}>One test is a snapshot. The value is in coming back: add 2 sessions and pay the Progress price, {kr(opt.unit)} a session.</p>}
      <p className="small muted" style={{ margin: 0 }}>You pay the same as if you had bought {t.has + n} sessions in one go. Extra sessions are valid until {fmt(t.expiresAt, { day: 'numeric', month: 'short', year: 'numeric' })}.</p>
      <div className="row spread" style={{ alignItems: 'center' }}>
        <span className="stepper">
          <button className="stp" aria-label="One less" disabled={n <= 1} onClick={() => setN(n - 1)}>−</button>
          <b aria-live="polite">{n}</b>
          <button className="stp" aria-label="One more" disabled={n >= t.max} onClick={() => setN(n + 1)}>+</button>
        </span>
        <span style={{ textAlign: 'right' }}><b style={{ fontSize: 20 }}>{kr(opt.price)}</b><br /><span className="small muted">{kr(opt.unit)} per session</span></span>
      </div>
      <button className="btn full" disabled={busy} onClick={() => onBuy(n)}>{busy ? 'Opening payment…' : `Add ${n} ${n === 1 ? 'session' : 'sessions'}, pay ${kr(opt.price)}`}</button>
    </div>
  );
}

function Account() {
  const params = new URLSearchParams(location.search);
  const [paidId, setPaidId] = useState(() => params.get('paid'));
  // After logging out, start clean: not the "back from Stripe" view.
  const loggedOut = () => { setPaidId(null); history.replaceState(null, '', '/account'); setA(null); setNeedLogin(true); };
  const [a, setA] = useState<AccountData | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [note, setNote] = useState<Note>(params.get('cancelled') ? { kind: 'err', text: 'Payment was cancelled. Nothing was charged.' } : null);
  const [mode, setMode] = useState<{ type: 'book' } | { type: 'move'; id: string } | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setA(await api<AccountData>(`/api/me${paidId ? `?paid=${paidId}` : ''}`));
      setNeedLogin(false);
    } catch (e) {
      if ((e as ApiError).status === 401) setNeedLogin(true);
      else setNote({ kind: 'err', text: (e as Error).message });
    }
  }, [paidId]);
  useEffect(() => { load(); }, [load]);

  // Right after Stripe: wait for the payment confirmation and the booking.
  const waiting = !!a?.pendingOrder && (a.pendingOrder.status === 'pending' || a.pendingOrder.firstStatus === 'pending');
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [waiting, load]);

  useEffect(() => {
    if (!mode) return;
    setSlots(null);
    setPick(null);
    api<{ slots: Slot[]; need: number }>(`/api/me/slots${mode.type === 'move' ? `?booking=${mode.id}` : ''}`)
      .then((d) => setSlots(d.slots))
      .catch((e) => setNote({ kind: 'err', text: e.message }));
    requestAnimationFrame(() => document.getElementById('picker')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [mode]);

  async function act(path: string, payload: object, ok: string) {
    setBusy(true);
    setNote(null);
    try {
      setA({ ...(await api<AccountData>(path, payload)), pendingOrder: null });
      setMode(null);
      setConfirmCancel(null);
      setNote({ kind: 'ok', text: ok });
    } catch (e) {
      setNote({ kind: 'err', text: (e as Error).message });
      if (mode) setMode({ ...mode });
    }
    setBusy(false);
  }
  async function buy(n: number) {
    setBusy(true);
    setNote(null);
    try {
      const d = await api<{ url: string }>('/api/me/topup', { qty: n });
      location.assign(d.url);
    } catch (e) {
      setNote({ kind: 'err', text: (e as Error).message });
      setBusy(false);
    }
  }

  if (needLogin) return <Shell>{paidId ? <AfterPayment orderId={paidId} onLoggedIn={load} /> : <Login team={false} onDone={load} />}</Shell>;
  if (!a) return <Shell><NoteBox note={note} />{!note && <p className="muted">Loading…</p>}</Shell>;
  if (waiting) {
    return (
      <Shell>
        <section className="card narrow">
          <h1>One moment</h1>
          <p className="muted">{a.pendingOrder?.firstStart ? `Confirming your payment and your session on ${when(a.pendingOrder.firstStart)}.` : 'Confirming your payment.'} This page updates by itself.</p>
        </section>
      </Shell>
    );
  }
  const moving = mode?.type === 'move' ? a.upcoming.find((b) => b.id === mode.id) : null;

  return (
    <Shell>
      <NoteBox note={note} />
      {a.pendingOrder?.firstStatus === 'failed' && (
        <div className="msg err">The session you picked filled up while you were paying. Your session is safe in your account: choose another time below.</div>
      )}
      <div className="grid acct">
        <section className="card">
          <div className="row spread">
            <h1>Hi {a.customer.name.split(' ')[0]}</h1>
            <span className="row">
              <button className="ghost" onClick={() => api('/api/logout', {}).then(loggedOut, (e) => setNote({ kind: 'err', text: e.message }))}>Log out</button>
              <button className="ghost" onClick={() => api('/api/me/logout-all', {}).then(loggedOut, (e) => setNote({ kind: 'err', text: e.message }))}>Log out on all devices</button>
            </span>
          </div>

          <h3>Upcoming</h3>
          {a.upcoming.length === 0 && <p className="muted">Nothing booked.</p>}
          {a.upcoming.map((b) => (
            <SessionCard key={b.id} b={b} c={a.customer} busy={busy} confirming={confirmCancel === b.id}
              onMove={() => setMode({ type: 'move', id: b.id })} onCancel={() => setConfirmCancel(b.id)} onKeep={() => setConfirmCancel(null)}
              onConfirm={() => act('/api/me/cancel', { bookingId: b.id }, 'Cancelled. The session is back in your account.')} />
          ))}

          {mode && (
            <div className="scard" id="picker" style={{ scrollMarginTop: 96 }}>
              <div className="row spread"><h2 style={{ margin: 0, fontSize: 21 }}>{mode.type === 'book' ? 'Book your next session' : `Move ${moving ? longDay(moving.start) : 'your session'}`}</h2><span className="muted small">Tue to Fri · at least 1 week ahead</span></div>
              {!slots ? <p className="muted">Loading free sessions…</p> : slots.length === 0 ? (
                <div className="soldout"><p><b>No free sessions in the coming weeks</b></p><p className="muted">Email contact@ndure.dk and we find a time for you.</p></div>
              ) : <MonthPicker slots={slots} value={pick} onChange={setPick} compact />}
              <div className="row">
                <button className="btn" disabled={!pick || busy} onClick={() => mode.type === 'book' ? act('/api/me/book', { start: pick }, 'Booked. A confirmation is on its way.') : act('/api/me/reschedule', { bookingId: mode.id, start: pick }, 'Moved. A confirmation is on its way.')}>
                  {busy ? 'Saving…' : pick ? `${mode.type === 'book' ? 'Book' : 'Move to'} ${longDay(pick)}, ${time(pick)}` : 'Pick a time'}
                </button>
                <button onClick={() => setMode(null)}>Cancel</button>
              </div>
              <p className="muted small" style={{ margin: 0 }}>{mode.type === 'book' ? 'Uses 1 of your sessions. ' : ''}Free to move until 24 hours before.</p>
            </div>
          )}

          <h3>Past</h3>
          {a.past.length === 0 && <p className="muted">No sessions yet.</p>}
          {a.past.map((b) => <div key={b.id} className="item"><span>{when(b.start)} {b.label}</span><span className="muted">{b.status === 'no_show' ? 'No show' : 'Done'}</span></div>)}
        </section>

        <aside className="card stack g16">
          <div className="stack g8">
            <h3 style={{ margin: 0 }}>Sessions left</h3>
            <p className="bignum">{a.balance.total}</p>
            {a.balance.orders.map((o) => <p key={o.id} className="small muted" style={{ margin: 0 }}>{o.remaining} of {o.qty}{o.free ? ' (free)' : o.parentId ? ' (added)' : ''}, valid until {fmt(o.expiresAt!, { day: 'numeric', month: 'short', year: 'numeric' })}</p>)}
            {a.nextDue && (Date.parse(a.nextDue) <= Date.now() ? <p className="small" style={{ margin: 0 }}><b>Your next test is due now.</b></p> : <p className="small" style={{ margin: 0 }}>Next test due around <b>{fmt(a.nextDue, { day: 'numeric', month: 'long' })}</b></p>)}
          </div>
          {a.balance.total > 0 ? (
            <button className="btn full" disabled={mode?.type === 'book'} onClick={() => setMode({ type: 'book' })}>Book a session</button>
          ) : (
            <a className="btn full" href="/#book">Buy sessions</a>
          )}
          {a.topUp && <><hr className="sep" /><AddSessions t={a.topUp} busy={busy} onBuy={buy} /></>}
        </aside>
      </div>
    </Shell>
  );
}

// ---------------- team: reports ----------------
type ReportRow = { id: string; start: string; label: string; name: string; email: string; report: 'todo' | 'sent' | 'redo'; note: string | null; link: string | null; sentAt: string | null };
const REPORT_LABEL = { todo: 'Report to do', sent: 'Report sent', redo: 'Redo report' } as const;
const REPORT_PILL = { todo: 'due', sent: 'ok', redo: 'bad' } as const;

function ReportLine({ r, act }: { r: ReportRow; act: Act }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ link: r.link ?? '', note: r.note ?? '' });
  const save = async (status: ReportRow['report']) => {
    if (await act({ action: 'report', bookingId: r.id, status, link: f.link.trim(), note: f.note }, `${r.name}: ${REPORT_LABEL[status].toLowerCase()}.`)) setOpen(false);
  };
  return (
    <div className="rline">
      <div className="rline-top">
        <span className="scell"><b>{r.name}</b><span className="small muted">{when(r.start)} · <a href={`mailto:${r.email}`}>{r.email}</a></span></span>
        <span className="pills"><span className={`pill ${REPORT_PILL[r.report]}`}>{REPORT_LABEL[r.report]}</span>{r.link && <a className="small" href={r.link} target="_blank" rel="noopener noreferrer">Open report</a>}</span>
        <span className="sacts">
          {!open && r.report !== 'sent' && <button className="sbtn go" onClick={() => setOpen(true)}>✓ Mark as sent</button>}
          {!open && <button className="sbtn" onClick={() => setOpen(true)}>{r.report === 'sent' ? 'Change' : 'Note or redo'}</button>}
        </span>
      </div>
      {r.note && !open && <p className="small muted" style={{ margin: 0 }}>{r.note}</p>}
      {open && (
        <div className="rform">
          <label>Dropbox link to the report<input type="url" maxLength={500} placeholder="https://www.dropbox.com/..." value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} /></label>
          <label>Note<input maxLength={300} placeholder="For example: bad data, redo booked" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <span className="row">
            <button className="sbtn go" onClick={() => save('sent')}>✓ Sent</button>
            <button className="sbtn red" onClick={() => save('redo')}>Redo</button>
            <button className="sbtn" onClick={() => save('todo')}>To do</button>
            <button className="sbtn" onClick={() => setOpen(false)}>Close</button>
          </span>
        </div>
      )}
    </div>
  );
}

function Reports({ d, act }: { d: TeamData['reports']; act: Act }) {
  const [showSent, setShowSent] = useState(false);
  return (
    <section className="card" style={{ gap: 12 }} id="reports">
      <div className="row spread">
        <h2 style={{ margin: 0, fontSize: 22 }}>Reports to do {d.open.length > 0 && <span className="badge">{d.open.length}</span>}</h2>
        <span className="small muted">Anna sends the report from Outlook, then marks it here.</span>
      </div>
      {d.open.length === 0 && <p className="muted small" style={{ margin: 0 }}>All reports are sent.</p>}
      {d.open.map((r) => <ReportLine key={r.id} r={r} act={act} />)}
      {d.sent.length > 0 && (
        <>
          <button className="sbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setShowSent(!showSent)}>{showSent ? 'Hide' : 'Show'} sent in the last 14 days ({d.sent.length})</button>
          {showSent && d.sent.map((r) => <ReportLine key={r.id} r={r} act={act} />)}
        </>
      )}
    </section>
  );
}

// ---------------- team: sessions ----------------
type Act = (payload: object, ok: string) => Promise<boolean>;
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function TimeChip({ iso, label, dim = false }: { iso: string; label: string; dim?: boolean }) {
  return <span className={`tchip ${label === 'Morning' ? 'am' : 'pm'}${dim ? ' dim' : ''}`}><b>{time(iso)}</b><small>{label}</small></span>;
}

function Sessions({ t, act, onLogout }: { t: TeamData; act: Act; onLogout: () => void }) {
  const [cancel, setCancel] = useState<string | null>(null);
  const [move, setMove] = useState<TeamRow | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [bookAt, setBookAt] = useState<string | null>(null);
  const [rider, setRider] = useState('');
  useEffect(() => {
    if (!move) return;
    setSlots(null);
    setPick(null);
    api<{ slots: Slot[] }>(`/api/team/slots?booking=${move.id}`).then((d) => setSlots(d.slots));
  }, [move]);
  const run = async (payload: object, ok: string) => { if (await act(payload, ok)) { setCancel(null); setMove(null); setBookAt(null); setRider(''); } };
  const now = Date.now();
  const today = cphDate(now);
  const upcoming = t.days.flatMap((d) => d.list).filter((r) => Date.parse(r.start) > now).length;
  const withCredit = t.riders.filter((r) => r.balance > 0);

  // Each day: per session time, the booked riders and then the free spots.
  const dayRows = (date: string, list: TeamRow[]) => {
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const open = t.opening.blocks.filter((b) => (t.opening.hours[dow] ?? []).includes(b.id) || list.some((r) => r.blockId === b.id));
    return open.flatMap((b) => {
      const at = `${date}T${b.time}:00${cphOffset(y, m - 1, d)}`;
      const here = list.filter((r) => r.blockId === b.id);
      const used = here.reduce((n, r) => n + r.seats, 0);
      return [...here.map((r) => ({ kind: 'rider' as const, r, at, label: b.label })), ...Array.from({ length: Math.max(0, b.capacity - used) }, (_, i) => ({ kind: 'free' as const, key: `${at}-${i}`, at, label: b.label }))];
    });
  };
  const capacityOf = (date: string, list: TeamRow[]) => {
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return t.opening.blocks.filter((b) => (t.opening.hours[dow] ?? []).includes(b.id) || list.some((r) => r.blockId === b.id)).reduce((n, b) => n + b.capacity, 0);
  };

  return (
    <section className="card" style={{ gap: 18 }}>
      <div className="row spread">
        <div className="stack g4"><h1>Upcoming sessions</h1><span className="muted"><b style={{ color: '#000' }}>{upcoming} {upcoming === 1 ? 'rider' : 'riders'}</b> booked</span></div>
        <span className="row muted small">Logged in as {t.me}
          <button className="ghost" onClick={() => api('/api/logout', {}).then(onLogout)}>Log out</button>
          <button className="ghost" onClick={() => api('/api/team/logout-all', {}).then(onLogout)}>Log out on all devices</button>
        </span>
      </div>
      <div className="skey"><span className="tchip am"><b>09:30</b><small>Morning</small></span><span className="tchip pm"><b>13:00</b><small>Afternoon</small></span><span className="pill ok">Health ok</span><span className="pill bad">Consent missing</span><span>On the day: mark who came. Before the day: move or cancel.</span></div>
      {t.days.length === 0 && <p className="muted">Nothing booked yet.</p>}
      {t.days.length > 0 && <div className="srow shead"><span>Session</span><span>Rider</span><span>Contact</span><span>Status</span><span style={{ textAlign: 'right' }}>Actions</span></div>}
      {t.days.map(({ date, list }) => {
        const isToday = date === today;
        const rows = dayRows(date, list);
        const taken = rows.filter((x) => x.kind === 'rider').reduce((n, x) => n + (x.kind === 'rider' ? x.r.seats : 0), 0);
        const cap = capacityOf(date, list);
        const [y, m, d] = date.split('-').map(Number);
        return (
          <div key={date} className={`sday${isToday ? ' today' : ''}`}>
            <div className="sday-head">
              <span className="row" style={{ gap: 10 }}><span className="stag">{isToday ? 'Today' : date < today ? 'Past' : SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}</span><b>{longDay(`${date}T12:00:00Z`)}</b></span>
              <span className="row small" style={{ gap: 10 }}>{taken} of {cap} spots taken<span className="sbar"><i style={{ width: `${cap ? Math.round((taken / cap) * 100) : 0}%` }} /></span></span>
            </div>
            {rows.map((x) => {
              if (x.kind === 'free') {
                const past = Date.parse(x.at) <= now;
                return (
                  <div key={x.key} className="srow free">
                    <TimeChip iso={x.at} label={x.label} dim />
                    {bookAt === x.key ? (
                      <span className="srow-wide row">
                        <select value={rider} onChange={(e) => setRider(e.target.value)} aria-label="Rider">
                          <option value="">Pick a rider with sessions left</option>
                          {withCredit.map((c) => <option key={c.id} value={c.id}>{c.name}, {c.email} ({c.balance} left)</option>)}
                        </select>
                        <button className="primary" disabled={!rider} onClick={() => run({ action: 'book', customerId: rider, start: x.at }, 'Booked. The rider got a confirmation.')}>Book</button>
                        <button onClick={() => setBookAt(null)}>Close</button>
                        {withCredit.length === 0 && <span className="small muted">Nobody has sessions left. Give sessions on the Admin tab first.</span>}
                      </span>
                    ) : (
                      <>
                        <span className="muted srow-mid">Free spot</span>
                        <span className="sacts">{!past && <button className="sbtn" onClick={() => { setBookAt(x.key); setRider(''); }}>+ Book a rider</button>}</span>
                      </>
                    )}
                  </div>
                );
              }
              const r = x.r;
              const started = Date.parse(r.start) <= now;
              const cs = r.customer.consents?.items;
              const partnerOk = !r.withPartner || !!r.order.partnerConsents?.items.health;
              return (
                <div key={r.id} className="srow">
                  <TimeChip iso={r.start} label={r.label} />
                  <span className="scell"><b>{r.customer.name}</b>{r.withPartner && <span className="small">+ {r.partnerName}</span>}<span className="small muted">{r.customer.ftp ? `${r.customer.ftp} W` : 'No FTP'} · {r.customer.goal ?? 'No goal given'}</span></span>
                  <span className="scell small">{r.customer.phone ? <a href={`tel:${r.customer.phone.replace(/\s/g, '')}`}>{r.customer.phone}</a> : <span className="muted">No phone</span>}<a className="muted ell" href={`mailto:${r.customer.email}`}>{r.customer.email}</a></span>
                  <span className="pills">
                    {r.status === 'attended' && <span className="pill ok">Came</span>}
                    {r.status === 'attended' && <span className={`pill ${REPORT_PILL[r.report ?? 'todo']}`}>{REPORT_LABEL[r.report ?? 'todo']}</span>}
                    {r.status === 'no_show' && <span className="pill bad">No show</span>}
                    {cs?.health && partnerOk ? <span className="pill ok">Health ok</span> : <span className="pill bad">Consent missing</span>}
                    {cs?.film && <span className="pill fine">Film ok</span>}
                  </span>
                  <span className="sacts">
                    {started && r.status === 'booked' && (<>
                      <button className="sbtn go" onClick={() => run({ action: 'attended', bookingId: r.id }, `${r.customer.name}: came.`)}>✓ Came</button>
                      <button className="sbtn red" onClick={() => run({ action: 'no_show', bookingId: r.id }, `${r.customer.name}: no show. The session stays used.`)}>✕ No show</button>
                    </>)}
                    {started && r.status !== 'booked' && (
                      <button className="sbtn" onClick={() => run({ action: r.status === 'attended' ? 'no_show' : 'attended', bookingId: r.id }, 'Changed.')}>{r.status === 'attended' ? 'Change to no show' : 'Change to came'}</button>
                    )}
                    {!started && r.status === 'booked' && (cancel === r.id ? (<>
                      <button className="sbtn red" onClick={() => run({ action: 'cancel', bookingId: r.id, returnCredit: true }, 'Cancelled, session given back. The rider got an email.')}>Cancel, give session back</button>
                      <button className="sbtn red" onClick={() => run({ action: 'cancel', bookingId: r.id, returnCredit: false }, 'Cancelled, session counted as used. The rider got an email.')}>Cancel, session used</button>
                      <button className="sbtn" onClick={() => setCancel(null)}>Keep</button>
                    </>) : (<>
                      <button className="sbtn line" onClick={() => setMove(r)}>↔ Move date</button>
                      <button className="sbtn red" onClick={() => setCancel(r.id)}>Cancel booking</button>
                    </>))}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
      <p className="small muted" style={{ margin: 0 }}>Move date: pick a new time, the rider gets an email and a calendar update. Cancel booking: you choose if the session goes back on their account. Came and No show appear once the session has started.</p>
      {move && (
        <div className="scard">
          <h3 style={{ margin: 0 }}>Move {move.customer.name} from {when(move.start)}</h3>
          {!slots ? <p className="muted">Loading free sessions…</p> : slots.length === 0 ? <p className="muted">No free sessions in the coming weeks.</p> : <MonthPicker slots={slots} value={pick} onChange={setPick} compact />}
          <div className="row">
            <button className="primary" disabled={!pick} onClick={() => run({ action: 'move', bookingId: move.id, start: pick }, 'Moved. The rider got an email.')}>{pick ? `Move to ${when(pick)}` : 'Pick a time'}</button>
            <button onClick={() => setMove(null)}>Close</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------- team ----------------
type TeamRow = Booking & { customer: Customer; order: Order };
type TeamData = {
  me: string;
  days: { date: string; list: TeamRow[] }[];
  riders: { id: string; name: string; email: string; phone: string | null; balance: number; next: string | null; last: string | null; src: string | null; lastPaidOrder: string | null }[];
  closed: { date: string; reason: string }[];
  calendarUrl: string;
  emailErrors: { to: string; subject: string; error: string; gaveUp: boolean }[];
  status: { bytes: number; limit: number; lastJob: string | null; emailsWaiting: number; emailsToday: number; riders: number; openCheckouts: number };
  alerts: { at: string; kind: string; text: string }[];
  audit: { at: string; by: string; action: string; detail: string }[];
  opening: OpeningData;
  emails: { paused: { at: string; count: number } | null };
  reports: { open: ReportRow[]; sent: ReportRow[] };
};

function Team() {
  const [t, setT] = useState<TeamData | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [give, setGive] = useState({ email: '', name: '', qty: 1 });
  type Tab = 'sessions' | 'opening' | 'admin';
  const [tab, setTabState] = useState<Tab>(() => (['sessions', 'opening', 'admin'].includes(location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : 'sessions'));
  const setTab = (x: Tab) => { setTabState(x); setNote(null); history.replaceState(null, '', `/team#${x}`); };

  const load = useCallback(async () => {
    try {
      setT(await api<TeamData>('/api/team'));
      setNeedLogin(false);
    } catch (e) {
      if ((e as ApiError).status === 401) setNeedLogin(true);
      else setNote({ kind: 'err', text: (e as Error).message });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (payload: object, ok: string): Promise<boolean> => {
    setNote(null);
    try {
      setT(await api<TeamData>('/api/team/action', payload));
      setNote({ kind: 'ok', text: ok });
      return true;
    } catch (e) {
      setNote({ kind: 'err', text: (e as Error).message });
      if ((e as ApiError).status === 401) setNeedLogin(true);
      return false;
    }
  };

  if (needLogin) return <Shell><Login team onDone={load} /></Shell>;
  if (!t) return <Shell><NoteBox note={note} />{!note && <p className="muted">Loading…</p>}</Shell>;
  const now = Date.now();

  return (
    <Shell>
      <NoteBox note={note} />
      {t.emailErrors.length > 0 && (
        <div className="msg err">Some emails could not be sent{t.emailErrors.some((e) => !e.gaveUp) ? ' (retrying automatically)' : ''}: {t.emailErrors.map((e) => `${e.subject} to ${e.to}${e.gaveUp ? ' (gave up)' : ''}`).join('; ')}. Check the Brevo key, sender and daily limit.</div>
      )}
      {t.emails?.paused && (
        <div className="msg err stack g8">
          <span><b>All automatic emails are paused.</b> On {when(t.emails.paused.at)}, {t.emails.paused.count} automatic emails were about to go out at once, which is far more than normal. Nothing was sent. Booking emails (payments, confirmations, login codes) kept working.</span>
          <span className="row">
            <button className="primary" onClick={() => act({ action: 'emails_resume', send: false }, 'Resumed. The held emails are dropped.')}>Drop the held emails and resume</button>
            <button onClick={() => act({ action: 'emails_resume', send: true }, 'Resumed. The held emails go out in the next minutes.')}>Send them anyway</button>
          </span>
        </div>
      )}
      <nav className="tabs" aria-label="Team">
        {([['sessions', 'Sessions'], ['opening', 'Opening hours'], ['admin', 'Admin']] as const).map(([k, l]) => (
          <button key={k} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>
      {tab === 'sessions' && (
        <>
          {t.reports && <Reports d={t.reports} act={act} />}
          <Sessions t={t} act={act} onLogout={() => { setT(null); setNeedLogin(true); }} />
        </>
      )}
      {tab === 'opening' && <Opening o={t.opening} act={act} />}
      {tab === 'admin' && (
        <>
      <section className="card">
        <h2>Riders</h2>
        <div className="scroll">
          <table className="team">
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Source</th><th>Sessions left</th><th>Next</th><th>Last</th><th></th></tr></thead>
            <tbody>
              {t.riders.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td><td>{c.email}</td><td>{c.phone}</td><td className="muted">{c.src}</td><td>{c.balance}</td>
                  <td>{c.next ? when(c.next) : <span className="muted">none</span>}</td>
                  <td>{c.last ? when(c.last) : ''}</td>
                  <td className="actions">{c.lastPaidOrder && <button onClick={() => act({ action: 'refund', orderId: c.lastPaidOrder }, 'Order closed. Now refund the money in Stripe.')}>Close last order</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid">
        <section className="card">
          <h3>Give free sessions</h3>
          <div className="row">
            <label>Email<input type="email" value={give.email} onChange={(e) => setGive({ ...give, email: e.target.value })} /></label>
            <label>Name<input value={give.name} onChange={(e) => setGive({ ...give, name: e.target.value })} /></label>
            <label>Sessions<input type="number" min={1} max={10} value={give.qty} onChange={(e) => setGive({ ...give, qty: Number(e.target.value) })} /></label>
          </div>
          <button onClick={() => act({ action: 'give', ...give }, `${give.qty} free sessions added. They log in with their email to book.`)}>Add sessions</button>
        </section>
      </div>

      <section className="card">
        <h3>System status</h3>
        <p className="small">
          Data {Math.round(t.status.bytes / 1000)} KB of {Math.round(t.status.limit / 1000)} KB{t.status.bytes > t.status.limit / 2 ? <b> (getting large)</b> : ''} ·
          last automatic run {t.status.lastJob ? `${Math.round((now - Date.parse(t.status.lastJob)) / 60000)} min ago` : <b>never</b>}
          {t.status.lastJob && now - Date.parse(t.status.lastJob) > 40 * 60000 ? <b> (late)</b> : ''} ·
          emails sent today {t.status.emailsToday}, waiting {t.status.emailsWaiting} · riders {t.status.riders} · open checkouts {t.status.openCheckouts}
        </p>
        <h3>Alerts</h3>
        {t.alerts.length === 0 && <p className="small muted">None.</p>}
        {t.alerts.map((a, i) => <p key={i} className="small"><span className="muted">{when(a.at)}</span> <b>{a.kind.replace(/_/g, ' ')}</b>: {a.text}</p>)}
        <h3>Activity</h3>
        {t.audit.length === 0 && <p className="small muted">Nothing yet.</p>}
        <div className="scroll">
          <table className="team small">
            <tbody>{t.audit.map((x, i) => <tr key={i}><td className="muted">{when(x.at)}</td><td>{x.by}</td><td>{x.action}</td><td>{x.detail}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Team calendar</h3>
        <p className="small muted">Subscribe once in Outlook (Add calendar → From internet) or Google Calendar (Other calendars → From URL). Keep this link private.</p>
        <code className="small">{t.calendarUrl}</code>
      </section>
        </>
      )}
    </Shell>
  );
}

// ---------------- training partner consent ----------------
function PartnerConsent() {
  const token = location.pathname.split('/')[2] || '';
  const [inv, setInv] = useState<{ partnerName: string; riderName: string; start: string | null; done: boolean; consents: Record<ConsentKey, string>; required: ConsentKey[] } | null>(null);
  const [consents, setConsents] = useState<Partial<Record<ConsentKey, boolean>>>({});
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState<Note>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    api(`/api/partner?t=${encodeURIComponent(token)}`).then((d) => { setInv(d); setDone(d.done); }).catch((e) => setNote({ kind: 'err', text: e.message }));
  }, [token]);
  if (!inv) return <Shell><NoteBox note={note} />{!note && <p className="muted">Loading…</p>}</Shell>;
  if (done) return <Shell><section className="card narrow"><h1>Thanks, {inv.partnerName}</h1><p className="muted">Your consent is saved.{inv.start ? ` See you ${when(inv.start)} at the ${MEET_SHORT}.` : ''}</p></section></Shell>;
  return (
    <Shell>
      <section className="card narrow">
        <h1>Hi {inv.partnerName}</h1>
        <p className="muted">{inv.riderName} signed you up as training partner for a lactate session{inv.start ? ` on ${when(inv.start)}` : ''}. Please confirm the points below before you ride.</p>
        <NoteBox note={note} />
        <label>Phone (optional)<input maxLength={30} autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <fieldset>
          <legend>Consent</legend>
          {(Object.keys(inv.consents) as ConsentKey[]).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={!!consents[k]} onChange={() => setConsents({ ...consents, [k]: !consents[k] })} />
              {inv.consents[k]} {inv.required.includes(k) ? <span className="req">required</span> : null}
            </label>
          ))}
        </fieldset>
        <button className="primary" onClick={() => api('/api/partner', { t: token, consents, phone }).then(() => setDone(true)).catch((e) => setNote({ kind: 'err', text: e.message }))}>Confirm</button>
      </section>
    </Shell>
  );
}

// Link in reminder emails: stop them without logging in.
function StopReminders() {
  const token = location.pathname.split('/')[2] || '';
  const [state, setState] = useState<'ask' | 'busy' | 'done'>('ask');
  const [note, setNote] = useState<Note>(null);
  return (
    <Shell>
      <section className="card narrow">
        {state === 'done' ? (
          <><h1>Done</h1><p className="muted">You will not get reminder emails from NDURE Labs any more. Booking confirmations still arrive. Changed your mind? Email contact@ndure.dk.</p></>
        ) : (
          <>
            <h1>Stop reminder emails?</h1>
            <p className="muted">We send a short reminder when it is time for your next check in. You can stop those here. Emails about your bookings still arrive.</p>
            <NoteBox note={note} />
            <button className="primary" disabled={state === 'busy'} onClick={() => { setState('busy'); api('/api/stop', { t: token }).then(() => setState('done'), (e) => { setNote({ kind: 'err', text: e.message }); setState('ask'); }); }}>Stop reminder emails</button>
          </>
        )}
      </section>
    </Shell>
  );
}

function App() {
  const p = location.pathname;
  if (p.startsWith('/consent/')) return <PartnerConsent />;
  if (p.startsWith('/stop/')) return <StopReminders />;
  if (p.startsWith('/team')) return <Team />;
  if (p.startsWith('/account')) return <Account />;
  if (p === '/book') return <BookPage />;
  if (p === '/terms') return <Terms />;
  if (p === '/privacy') return <Privacy />;
  if (p === '/health-check') return <HealthCheck />;
  return <Landing />;
}

createRoot(document.getElementById('root')!).render(<App />);
