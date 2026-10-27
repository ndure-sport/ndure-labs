// Pages for book.ndure.dk: sign up (/), rider account (/account), team (/team).
// Functional MVP: plain layout, real data from the server. Design comes later.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { quote, type Slot } from '../core/engine';
import { DEFAULT_CONFIG } from '../core/config';
import { fmt, when, cphDate } from '../core/time';
import type { ConsentKey, Booking, Customer, Order } from '../core/types';

const eur = (n: number) => `€${n}`;
const longDay = (iso: string) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' });
const time = (iso: string) => fmt(iso, { hour: '2-digit', minute: '2-digit' });

class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong.', res.status);
  return data as T;
}

type Note = { kind: 'ok' | 'err'; text: string } | null;
function NoteBox({ note }: { note: Note }) {
  return note ? <div className={`note ${note.kind}`} role="status">{note.text}</div> : null;
}

function Shell({ children }: { children: React.ReactNode }) {
  const p = location.pathname;
  return (
    <div className="wrap">
      <header className="top">
        <a href="/" className="brand">NDURE Labs</a>
        <nav className="row">
          <a href="/" aria-current={p === '/' ? 'page' : undefined}>Sign up</a>
          <a href="/account" aria-current={p.startsWith('/account') ? 'page' : undefined}>My account</a>
        </nav>
      </header>
      {children}
      <footer className="muted small">NDURE ApS, CVR 45530701, Diplomvej 376, 2800 Kongens Lyngby · contact@ndure.dk · Test version</footer>
    </div>
  );
}

// ---------------- shared pieces ----------------
function Lines({ q }: { q: ReturnType<typeof quote> }) {
  return (
    <table className="lines">
      <tbody>
        {q.lines.map((l, i) => (
          <tr key={i}><td>{l.label}</td><td className="num">{l.amount < 0 ? `−${eur(-l.amount)}` : eur(l.amount)}</td></tr>
        ))}
        <tr className="total"><td>Total</td><td className="num">{eur(q.total)}</td></tr>
      </tbody>
    </table>
  );
}

function SlotPicker({ slots, value, onChange, need }: { slots: Slot[] | null; value: string | null; onChange: (s: string) => void; need: number }) {
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) m.set(cphDate(Date.parse(s.start)), [...(m.get(cphDate(Date.parse(s.start))) ?? []), s]);
    return [...m.entries()];
  }, [slots]);
  if (!slots) return <p className="muted">Loading free sessions…</p>;
  if (slots.length === 0) return <p className="note err">No free sessions{need > 1 ? ' with 2 spots' : ''} in the coming weeks. Email contact@ndure.dk.</p>;
  const first = slots[0];
  return (
    <div className="stack">
      <p>
        Earliest free{need > 1 ? ' for 2' : ''}: <b>{when(first.start)}</b>{' '}
        <button aria-pressed={value === first.start} onClick={() => onChange(first.start)}>{value === first.start ? 'Selected' : 'Take this'}</button>
      </p>
      <div className="days">
        {byDay.map(([d, list]) => (
          <div key={d} className="day">
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

// ---------------- sign up ----------------
function SignUp() {
  const params = new URLSearchParams(location.search);
  const [cfg, setCfg] = useState<{ consents: Record<ConsentKey, string>; required: ConsentKey[] } | null>(null);
  const [step, setStep] = useState(1);
  const [qty, setQty] = useState(Math.min(10, Math.max(1, Number(params.get('qty')) || 1)));
  const [partner, setPartner] = useState(params.get('partner') === '1');
  const [pName, setPName] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const [f, setF] = useState({ name: '', email: '', phone: '', ftp: '', goal: 'Racing' });
  const [consents, setConsents] = useState<Partial<Record<ConsentKey, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(params.get('cancelled') ? { kind: 'err', text: 'Payment was cancelled. Nothing was charged.' } : null);

  const need = partner ? 2 : 1;
  const q = quote(DEFAULT_CONFIG, qty, partner);
  const loadSlots = useCallback(() => {
    setSlots(null);
    api<{ slots: Slot[] }>(`/api/slots?need=${need}`).then((d) => setSlots(d.slots)).catch((e) => setNote({ kind: 'err', text: e.message }));
  }, [need]);
  useEffect(() => { api('/api/config').then(setCfg); }, []);
  useEffect(() => { loadSlots(); }, [loadSlots]);

  async function pay() {
    setBusy(true);
    setNote(null);
    try {
      const d = await api<{ url: string }>('/api/checkout', {
        qty, partner, partnerName: pName, partnerEmail: pEmail, start: later ? null : start, later,
        name: f.name, email: f.email, phone: f.phone, ftp: f.ftp ? Number(f.ftp) : null, goal: f.goal, consents, src: params.get('src') || 'web'
      });
      location.href = d.url;
    } catch (e) {
      const err = e as ApiError;
      setNote({ kind: 'err', text: err.message });
      if (err.status === 409) { setStart(null); loadSlots(); setStep(2); }
      setBusy(false);
    }
  }

  return (
    <Shell>
      <NoteBox note={note} />
      <div className="grid">
        <section className="card">
          <ol className="steps">{['Sessions', 'Date', 'Details'].map((s, i) => <li key={s} aria-current={step === i + 1}>{i + 1}. {s}</li>)}</ol>

          {step === 1 && (
            <>
              <h1>Sign up for a lactate session</h1>
              <div className="row">
                {DEFAULT_CONFIG.tiers.map((t) => (
                  <button key={t.min} aria-pressed={qty === t.min} onClick={() => setQty(t.min)}>{t.min} × {eur(t.unit)}</button>
                ))}
                <span className="stepper">
                  <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="One less">−</button>
                  <b>{qty}</b>
                  <button onClick={() => setQty(Math.min(DEFAULT_CONFIG.maxQty, qty + 1))} aria-label="One more">+</button>
                </span>
              </div>
              {q.next && <p className="muted">Add {q.next.more} more and each session costs {eur(q.next.unit)}.</p>}
              <label className="check"><input type="checkbox" checked={partner} onChange={() => { setPartner(!partner); setStart(null); }} /> Bring a training partner to my first session ({eur(DEFAULT_CONFIG.partnerPrice)})</label>
              {partner && (
                <div className="row">
                  <label>Partner name<input value={pName} onChange={(e) => setPName(e.target.value)} /></label>
                  <label>Partner email<input type="email" value={pEmail} onChange={(e) => setPEmail(e.target.value)} /></label>
                </div>
              )}
              <button className="primary" onClick={() => setStep(2)}>Choose a date</button>
            </>
          )}

          {step === 2 && (
            <>
              <h1>{qty > 1 ? 'Your first session' : 'Your session'}</h1>
              {qty > 1 && <label className="check"><input type="checkbox" checked={later} onChange={() => setLater(!later)} /> I'll choose dates later, after paying</label>}
              {!later && <SlotPicker slots={slots} value={start} onChange={setStart} need={need} />}
              <div className="row">
                <button onClick={() => setStep(1)}>Back</button>
                <button className="primary" disabled={!start && !later} onClick={() => setStep(3)}>Continue</button>
              </div>
            </>
          )}

          {step === 3 && (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); pay(); }}>
              <h1>Your details</h1>
              <div className="row">
                <label>Full name<input id="name" required autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
                <label>Email<input id="email" required type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
                <label>Phone<input id="phone" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
                <label>FTP (optional)<input id="ftp" inputMode="numeric" value={f.ftp} onChange={(e) => setF({ ...f, ftp: e.target.value })} /></label>
                <label>Goal
                  <select id="goal" value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })}>
                    <option>Racing</option><option>Long rides</option><option>Getting fitter</option><option>Something else</option>
                  </select>
                </label>
              </div>
              {cfg && (
                <fieldset>
                  <legend>Consent</legend>
                  {(Object.keys(cfg.consents) as ConsentKey[]).map((k) => (
                    <label key={k} className="check">
                      <input type="checkbox" checked={!!consents[k]} onChange={() => setConsents({ ...consents, [k]: !consents[k] })} />
                      {cfg.consents[k]} {cfg.required.includes(k) ? <span className="req">required</span> : null}
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="row">
                <button type="button" onClick={() => setStep(2)}>Back</button>
                <button className="primary" type="submit" disabled={busy}>{busy ? 'Opening payment…' : `Pay ${eur(q.total)}`}</button>
              </div>
            </form>
          )}
        </section>
        <aside className="card">
          <h3>Basket</h3>
          <Lines q={q} />
          <p className="small muted">{later ? 'Dates: chosen after paying' : start ? `First session: ${when(start)}` : 'No date chosen yet'}</p>
          <p className="small muted">Secure payment by Stripe. Your seat is held while you pay.</p>
        </aside>
      </div>
    </Shell>
  );
}

// ---------------- login ----------------
function Login({ team, onDone }: { team: boolean; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [note, setNote] = useState<Note>(null);
  return (
    <section className="card narrow">
      <h1>{team ? 'Team login' : 'Log in'}</h1>
      <p className="muted">{team ? 'Team members only.' : 'Use the email you signed up with.'} We email you a 6 digit code.</p>
      <NoteBox note={note} />
      <label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {!sent ? (
        <button className="primary" onClick={() => api('/api/login/request', { email, team }).then(() => { setSent(true); setNote({ kind: 'ok', text: 'If that email has an account, a code is on its way.' }); }).catch((e) => setNote({ kind: 'err', text: e.message }))}>Send code</button>
      ) : (
        <>
          <label>Code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <div className="row">
            <button className="primary" onClick={() => api('/api/login/verify', { email, code, team }).then(onDone).catch((e) => setNote({ kind: 'err', text: e.message }))}>Log in</button>
            <button onClick={() => { setSent(false); setCode(''); }}>Use another email</button>
          </div>
        </>
      )}
    </section>
  );
}

// ---------------- rider account ----------------
type AccountData = {
  customer: Customer;
  balance: { total: number; orders: Order[] };
  upcoming: (Booking & { changeable: boolean })[];
  past: Booking[];
  nextDue: string | null;
  pendingOrder: { status: string; firstStatus: string; firstStart: string | null } | null;
};

function Account() {
  const paidId = new URLSearchParams(location.search).get('paid');
  const [a, setA] = useState<AccountData | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [mode, setMode] = useState<{ type: 'book' } | { type: 'move'; id: string } | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [need, setNeed] = useState(1);
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
      .then((d) => { setSlots(d.slots); setNeed(d.need); })
      .catch((e) => setNote({ kind: 'err', text: e.message }));
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

  if (needLogin) return <Shell><Login team={false} onDone={load} /></Shell>;
  if (!a) return <Shell><NoteBox note={note} /><p className="muted">Loading…</p></Shell>;
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

  return (
    <Shell>
      <NoteBox note={note} />
      {a.pendingOrder?.firstStatus === 'failed' && (
        <div className="note err">The session you picked filled up while you were paying. Your session is safe in your account: choose another time below.</div>
      )}
      <div className="grid">
        <section className="card">
          <div className="row spread">
            <h1>Hi {a.customer.name.split(' ')[0]}</h1>
            <button className="ghost" onClick={() => api('/api/logout', {}).then(() => { setA(null); setNeedLogin(true); })}>Log out</button>
          </div>

          <h3>Upcoming</h3>
          {a.upcoming.length === 0 && <p className="muted">Nothing booked.</p>}
          {a.upcoming.map((b) => (
            <div key={b.id} className="item">
              <span><b>{when(b.start)}</b> {b.label}{b.withPartner ? `, with ${b.partnerName}` : ''}</span>
              {b.changeable ? (
                confirmCancel === b.id ? (
                  <span className="row">Cancel this session?
                    <button disabled={busy} onClick={() => act('/api/me/cancel', { bookingId: b.id }, 'Cancelled. The session is back in your account.')}>Yes, cancel</button>
                    <button onClick={() => setConfirmCancel(null)}>Keep it</button>
                  </span>
                ) : (
                  <span className="row">
                    <button onClick={() => setMode({ type: 'move', id: b.id })}>Change date</button>
                    <button onClick={() => setConfirmCancel(b.id)}>Cancel</button>
                  </span>
                )
              ) : (
                <span className="muted small">Less than 24 h to go: email contact@ndure.dk</span>
              )}
            </div>
          ))}

          {mode ? (
            <div className="box">
              <h3>{mode.type === 'book' ? 'Book a session' : 'Pick a new time'}</h3>
              <SlotPicker slots={slots} value={pick} onChange={setPick} need={need} />
              <div className="row">
                <button className="primary" disabled={!pick || busy} onClick={() => mode.type === 'book' ? act('/api/me/book', { start: pick }, 'Booked. A confirmation is on its way.') : act('/api/me/reschedule', { bookingId: mode.id, start: pick }, 'Moved. A confirmation is on its way.')}>
                  {busy ? 'Saving…' : 'Confirm'}
                </button>
                <button onClick={() => setMode(null)}>Close</button>
              </div>
            </div>
          ) : (
            <div className="row">
              {a.balance.total > 0 && <button className="primary" onClick={() => setMode({ type: 'book' })}>Book a session</button>}
              <a className="button" href="/">Buy more sessions</a>
            </div>
          )}

          <h3>Past</h3>
          {a.past.length === 0 && <p className="muted">No sessions yet.</p>}
          {a.past.map((b) => <div key={b.id} className="item"><span>{when(b.start)} {b.label}</span><span className="muted">{b.status === 'no_show' ? 'No show' : 'Done'}</span></div>)}
        </section>

        <aside className="card">
          <h3>Sessions left</h3>
          <p className="big">{a.balance.total}</p>
          {a.balance.orders.map((o) => <p key={o.id} className="small muted">{o.remaining} of {o.qty}{o.free ? ' (free)' : ''}, valid until {fmt(o.expiresAt!, { day: 'numeric', month: 'short', year: 'numeric' })}</p>)}
          {a.nextDue && (Date.parse(a.nextDue) <= Date.now() ? <p className="small"><b>Your next test is due now.</b></p> : <p className="small">Next test due around <b>{fmt(a.nextDue, { day: 'numeric', month: 'long' })}</b></p>)}
        </aside>
      </div>
    </Shell>
  );
}

// ---------------- team ----------------
type TeamRow = Booking & { customer: Customer; order: Order };
type TeamData = {
  me: string;
  days: { date: string; list: TeamRow[] }[];
  riders: { id: string; name: string; email: string; phone: string | null; balance: number; next: string | null; last: string | null; lastPaidOrder: string | null }[];
  closed: { date: string; reason: string }[];
  calendarUrl: string;
  emailErrors: { to: string; subject: string; error: string }[];
};

function Team() {
  const [t, setT] = useState<TeamData | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [late, setLate] = useState<string | null>(null);
  const [move, setMove] = useState<TeamRow | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [give, setGive] = useState({ email: '', name: '', qty: 1 });
  const [close, setClose] = useState({ date: '', reason: '' });

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
  useEffect(() => {
    if (!move) return;
    setSlots(null);
    setPick(null);
    api<{ slots: Slot[] }>(`/api/team/slots?booking=${move.id}`).then((d) => setSlots(d.slots));
  }, [move]);

  const act = async (payload: object, ok: string) => {
    setNote(null);
    try {
      setT(await api<TeamData>('/api/team/action', payload));
      setNote({ kind: 'ok', text: ok });
      setLate(null);
      setMove(null);
    } catch (e) {
      setNote({ kind: 'err', text: (e as Error).message });
    }
  };

  if (needLogin) return <Shell><Login team onDone={load} /></Shell>;
  if (!t) return <Shell><NoteBox note={note} /><p className="muted">Loading…</p></Shell>;
  const now = Date.now();

  return (
    <Shell>
      <NoteBox note={note} />
      {t.emailErrors.length > 0 && (
        <div className="note err">Some emails could not be sent: {t.emailErrors.map((e) => `${e.subject} to ${e.to}`).join('; ')}. Check the Brevo key and sender.</div>
      )}
      <section className="card">
        <div className="row spread"><h1>Upcoming sessions</h1><span className="muted small">Logged in as {t.me}</span></div>
        {t.days.length === 0 && <p className="muted">Nothing booked yet.</p>}
        {t.days.map(({ date, list }) => (
          <div key={date}>
            <h3>{longDay(list[0].start)} <span className="muted small">{list.reduce((n, r) => n + r.seats, 0)} riders</span></h3>
            <div className="scroll">
              <table className="team">
                <thead><tr><th>Time</th><th>Rider</th><th>Contact</th><th>FTP, goal</th><th>Consent</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {list.map((r) => {
                    const started = Date.parse(r.start) <= now;
                    const cs = r.customer.consents?.items;
                    return (
                      <tr key={r.id}>
                        <td>{time(r.start)}<br /><span className="muted">{r.label}</span></td>
                        <td><b>{r.customer.name}</b>{r.withPartner && <><br />+ {r.partnerName}</>}</td>
                        <td>{r.customer.email}<br />{r.customer.phone}</td>
                        <td>{r.customer.ftp ? `${r.customer.ftp} W` : 'n/a'}<br /><span className="muted">{r.customer.goal}</span></td>
                        <td>{cs?.health ? 'Health ok' : <b>Missing</b>}{cs?.film ? ', film ok' : ''}{cs?.research ? ', R&D ok' : ''}</td>
                        <td>{{ booked: 'Booked', attended: 'Attended', no_show: 'No show', cancelled: 'Cancelled' }[r.status]}</td>
                        <td className="actions">
                          {started && r.status === 'booked' && (
                            <>
                              <button onClick={() => act({ action: 'attended', bookingId: r.id }, 'Marked as attended.')}>Attended</button>
                              <button onClick={() => act({ action: 'no_show', bookingId: r.id }, 'Marked as no show. The session stays used.')}>No show</button>
                            </>
                          )}
                          {!started && r.status === 'booked' && (late === r.id ? (
                            <>
                              <button onClick={() => act({ action: 'cancel', bookingId: r.id, returnCredit: true }, 'Cancelled, session given back.')}>Cancel, give session back</button>
                              <button onClick={() => act({ action: 'cancel', bookingId: r.id, returnCredit: false }, 'Cancelled, session counted as used.')}>Cancel, session used</button>
                              <button onClick={() => setLate(null)}>Keep</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => setMove(r)}>Move</button>
                              <button onClick={() => setLate(r.id)}>Cancel</button>
                            </>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {move && (
          <div className="box">
            <h3>Move {move.customer.name} from {when(move.start)}</h3>
            <SlotPicker slots={slots} value={pick} onChange={setPick} need={move.seats} />
            <div className="row">
              <button className="primary" disabled={!pick} onClick={() => act({ action: 'move', bookingId: move.id, start: pick }, 'Moved. The rider got an email.')}>Move</button>
              <button onClick={() => setMove(null)}>Close</button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Riders</h2>
        <div className="scroll">
          <table className="team">
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Sessions left</th><th>Next</th><th>Last</th><th></th></tr></thead>
            <tbody>
              {t.riders.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td><td>{c.email}</td><td>{c.phone}</td><td>{c.balance}</td>
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
        <section className="card">
          <h3>Close a day</h3>
          <div className="row">
            <label>Date<input type="date" value={close.date} onChange={(e) => setClose({ ...close, date: e.target.value })} /></label>
            <label>Reason<input value={close.reason} onChange={(e) => setClose({ ...close, reason: e.target.value })} /></label>
          </div>
          <button onClick={() => act({ action: 'close', ...close }, 'Day closed.')}>Close day</button>
          {t.closed.map((c) => (
            <p key={c.date} className="small">{c.date} {c.reason} <button onClick={() => act({ action: 'reopen', date: c.date }, 'Day reopened.')}>Reopen</button></p>
          ))}
        </section>
      </div>

      <section className="card">
        <h3>Team calendar</h3>
        <p className="small muted">Subscribe once in Outlook (Add calendar → From internet) or Google Calendar (Other calendars → From URL). Keep this link private.</p>
        <code className="small">{t.calendarUrl}</code>
      </section>
    </Shell>
  );
}

function App() {
  const p = location.pathname;
  if (p.startsWith('/team')) return <Team />;
  if (p.startsWith('/account')) return <Account />;
  return <SignUp />;
}

createRoot(document.getElementById('root')!).render(<App />);
