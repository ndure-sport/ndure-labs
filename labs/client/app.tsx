// Pages for book.ndure.dk: the Labs page with booking (/), rider account (/account), team (/team),
// partner consent (/consent/...) and the terms, privacy and health check pages.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type Slot } from '../core/engine';
import { fmt, when, cphDate } from '../core/time';
import type { ConsentKey, Booking, Customer, Order } from '../core/types';
import { api, ApiError, getConfig, Msg, Turnstile, Header, Footer, type Note } from './shared';
import { Landing } from './landing';
import { Terms, Privacy, HealthCheck } from './docs';

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
type AccountData = {
  customer: Customer;
  balance: { total: number; orders: Order[] };
  upcoming: (Booking & { changeable: boolean })[];
  past: Booking[];
  nextDue: string | null;
  pendingOrder: { status: string; firstStatus: string; firstStart: string | null } | null;
};

function Account() {
  const [paidId, setPaidId] = useState(() => new URLSearchParams(location.search).get('paid'));
  // After logging out, start clean: not the "back from Stripe" view.
  const loggedOut = () => { setPaidId(null); history.replaceState(null, '', '/account'); setA(null); setNeedLogin(true); };
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

  return (
    <Shell>
      <NoteBox note={note} />
      {a.pendingOrder?.firstStatus === 'failed' && (
        <div className="msg err">The session you picked filled up while you were paying. Your session is safe in your account: choose another time below.</div>
      )}
      <div className="grid">
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
              <a className="button" href="/#book">Buy more sessions</a>
            </div>
          )}

          <h3>Past</h3>
          {a.past.length === 0 && <p className="muted">No sessions yet.</p>}
          {a.past.map((b) => <div key={b.id} className="item"><span>{when(b.start)} {b.label}</span><span className="muted">{b.status === 'no_show' ? 'No show' : 'Done'}</span></div>)}
        </section>

        <aside className="card">
          <h3>Sessions left</h3>
          <p className="bignum">{a.balance.total}</p>
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
  riders: { id: string; name: string; email: string; phone: string | null; balance: number; next: string | null; last: string | null; src: string | null; lastPaidOrder: string | null }[];
  closed: { date: string; reason: string }[];
  calendarUrl: string;
  emailErrors: { to: string; subject: string; error: string; gaveUp: boolean }[];
  status: { bytes: number; limit: number; lastJob: string | null; emailsWaiting: number; emailsToday: number; riders: number; openCheckouts: number };
  alerts: { at: string; kind: string; text: string }[];
  audit: { at: string; by: string; action: string; detail: string }[];
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
  if (!t) return <Shell><NoteBox note={note} />{!note && <p className="muted">Loading…</p>}</Shell>;
  const now = Date.now();

  return (
    <Shell>
      <NoteBox note={note} />
      {t.emailErrors.length > 0 && (
        <div className="msg err">Some emails could not be sent{t.emailErrors.some((e) => !e.gaveUp) ? ' (retrying automatically)' : ''}: {t.emailErrors.map((e) => `${e.subject} to ${e.to}${e.gaveUp ? ' (gave up)' : ''}`).join('; ')}. Check the Brevo key, sender and daily limit.</div>
      )}
      <section className="card">
        <div className="row spread">
          <h1>Upcoming sessions</h1>
          <span className="row muted small">Logged in as {t.me}
            <button className="ghost" onClick={() => api('/api/logout', {}).then(() => { setT(null); setNeedLogin(true); })}>Log out</button>
            <button className="ghost" onClick={() => api('/api/team/logout-all', {}).then(() => { setT(null); setNeedLogin(true); })}>Log out on all devices</button>
          </span>
        </div>
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
                        <td>{cs?.health ? 'Health ok' : <b>Missing</b>}{cs?.film ? ', film ok' : ''}{cs?.research ? ', R&D ok' : ''}{r.withPartner && <><br />Partner: {r.order.partnerConsents?.items.health ? 'ok' : <b>missing</b>}</>}</td>
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
  if (done) return <Shell><section className="card narrow"><h1>Thanks, {inv.partnerName}</h1><p className="muted">Your consent is saved.{inv.start ? ` See you ${when(inv.start)} at Diplomvej 376, Kongens Lyngby.` : ''}</p></section></Shell>;
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

function App() {
  const p = location.pathname;
  if (p.startsWith('/consent/')) return <PartnerConsent />;
  if (p.startsWith('/team')) return <Team />;
  if (p.startsWith('/account')) return <Account />;
  if (p === '/terms') return <Terms />;
  if (p === '/privacy') return <Privacy />;
  if (p === '/health-check') return <HealthCheck />;
  return <Landing />;
}

createRoot(document.getElementById('root')!).render(<App />);
