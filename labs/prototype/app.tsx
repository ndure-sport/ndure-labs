// Functional prototype of the NDURE Labs booking flow. Plain on purpose: it exists to check
// that the rules and the flow are right before any design work. It runs the real engine
// (labs/core) against a database that lives in this browser tab.

import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Labs, LabsError, quote, CONSENT_TEXT, REQUIRED_CONSENTS, type Slot } from '../core/engine';
import { DEFAULT_CONFIG } from '../core/config';
import { emptyDb, type Db, type ConsentKey, type Booking } from '../core/types';
import { fmt, when, days, hours, cphDate } from '../core/time';

const KEY = 'ndure-labs-prototype-v1';
type Saved = { db: Db; offset: number };
function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* storage unavailable: start fresh */
  }
  return { db: emptyDb(), offset: 0 };
}
function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* fine: the prototype still works for this visit */
  }
}

const saved = load();
const state = { offset: saved.offset };
const labs = new Labs(saved.db, DEFAULT_CONFIG, () => Date.now() + state.offset);
const eur = (n: number) => `€${n}`;
const longDay = (iso: string) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' });
const time = (iso: string) => fmt(iso, { hour: '2-digit', minute: '2-digit' });

type Tab = 'signup' | 'account' | 'team' | 'emails';

function App() {
  const [, setRev] = useState(0);
  const [tab, setTab] = useState<Tab>('signup');
  const [me, setMe] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [prefill, setPrefill] = useState<string>('');

  // Run an action, persist, show success or the rule that stopped it.
  const run = (fn: () => void, ok?: string) => {
    try {
      fn();
      labs.tick();
      save({ db: labs.db, offset: state.offset });
      setMsg(ok ? { kind: 'ok', text: ok } : null);
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof LabsError ? e.message : String(e) });
    }
    setRev((r) => r + 1);
  };

  const move = (ms: number, label: string) =>
    run(() => {
      state.offset += ms;
    }, `Clock moved ${label}. ${labs.db.emails.length} emails in the outbox.`);

  const unread = labs.db.emails.length;
  const now = Date.now() + state.offset;

  return (
    <div className="wrap">
      <div className="clock">
        <span>
          <b>Prototype clock</b> {fmt(now, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, {time(new Date(now).toISOString())}
        </span>
        <span className="row">
          <button onClick={() => move(hours(1), '1 hour')}>+1 hour</button>
          <button onClick={() => move(days(1), '1 day')}>+1 day</button>
          <button onClick={() => move(days(7), '1 week')}>+1 week</button>
          <button onClick={() => move(days(28), '4 weeks')}>+4 weeks</button>
          <button
            className="ghost"
            onClick={() => {
              labs.db = emptyDb();
              state.offset = 0;
              save({ db: labs.db, offset: 0 });
              setMe(null);
              setMsg({ kind: 'ok', text: 'Everything reset.' });
              setRev((r) => r + 1);
            }}
          >
            Reset all
          </button>
        </span>
      </div>

      <nav className="tabs" aria-label="Views">
        {(
          [
            ['signup', 'Sign up'],
            ['account', 'My account'],
            ['team', 'Team'],
            ['emails', `Emails (${unread})`]
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} aria-pressed={tab === k} onClick={() => { setTab(k); setMsg(null); }}>
            {l}
          </button>
        ))}
      </nav>

      {msg && <div className={msg.kind === 'ok' ? 'note ok' : 'note err'} role="status">{msg.text}</div>}

      {tab === 'signup' && (
        <SignUp
          key={prefill}
          prefillEmail={prefill}
          run={run}
          onPaid={(customerId) => {
            setMe(customerId);
            setTab('account');
          }}
        />
      )}
      {tab === 'account' && (
        <Account
          me={me}
          setMe={setMe}
          run={run}
          buyMore={(email) => {
            setPrefill(email + ':' + Date.now());
            setTab('signup');
          }}
        />
      )}
      {tab === 'team' && <Team run={run} />}
      {tab === 'emails' && <Emails />}
    </div>
  );
}

type Run = (fn: () => void, ok?: string) => void;

// ---------------- Sign up ----------------
function SignUp({ run, onPaid, prefillEmail }: { run: Run; onPaid: (customerId: string) => void; prefillEmail: string }) {
  const [step, setStep] = useState(1);
  const [qty, setQty] = useState(1);
  const [partner, setPartner] = useState(false);
  const [pName, setPName] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [start, setStart] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const [f, setF] = useState({ name: '', email: prefillEmail.split(':')[0] || '', phone: '', ftp: '', goal: 'Racing' });
  const [consents, setConsents] = useState<Partial<Record<ConsentKey, boolean>>>({});
  const [orderId, setOrderId] = useState<string | null>(null);

  const q = quote(DEFAULT_CONFIG, qty, partner);
  const need = partner ? 2 : 1;
  const slots = labs.slots(need);
  const order = orderId ? labs.db.orders.find((o) => o.id === orderId) : null;

  if (order) {
    return (
      <section className="card">
        <h2>Stripe checkout (simulated)</h2>
        <p className="muted">In the live app this is Stripe's own page: card, Apple Pay, MobilePay, discount codes. The seat stays held for {DEFAULT_CONFIG.holdMinutes} minutes.</p>
        <Lines q={q} />
        {order.firstStart && <p>Session: <b>{when(order.firstStart)}</b> (held until {time(labs.db.holds.find((h) => h.orderId === order.id)?.expiresAt ?? order.firstStart)})</p>}
        {order.status === 'pending' ? (
          <div className="row">
            <button className="primary" onClick={() => run(() => { labs.paid(order.id); onPaid(order.customerId); }, 'Paid. You are logged in to your account (in the live app, right after Stripe).')}>
              Pay {eur(q.total)}
            </button>
            <button onClick={() => { setOrderId(null); setStep(3); }}>Back</button>
          </div>
        ) : (
          <p className="note err">This checkout is {order.status}. The held seat was released. Start again.</p>
        )}
        <p className="muted small">Try: move the clock +1 hour before paying. The checkout expires and the seat is freed.</p>
      </section>
    );
  }

  return (
    <div className="grid">
      <section className="card">
        <ol className="steps">
          {['Sessions', 'Date', 'Details'].map((s, i) => (
            <li key={s} aria-current={step === i + 1}>{i + 1}. {s}</li>
          ))}
        </ol>

        {step === 1 && (
          <>
            <h2>How many sessions?</h2>
            <div className="row">
              {DEFAULT_CONFIG.tiers.map((t) => (
                <button key={t.min} aria-pressed={qty === t.min} onClick={() => setQty(t.min)}>
                  {t.min} × {eur(t.unit)}
                </button>
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
            <h2>{qty > 1 ? 'Your first session' : 'Your session'}</h2>
            {qty > 1 && (
              <label className="check"><input type="checkbox" checked={later} onChange={() => setLater(!later)} /> I'll choose dates later, after paying</label>
            )}
            {!later && <SlotPicker slots={slots} value={start} onChange={setStart} need={need} />}
            <div className="row">
              <button onClick={() => setStep(1)}>Back</button>
              <button className="primary" disabled={!start && !later} onClick={() => setStep(3)}>Continue</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Your details</h2>
            <div className="row">
              <label>Full name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
              <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
              <label>Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
              <label>FTP (optional)<input inputMode="numeric" value={f.ftp} onChange={(e) => setF({ ...f, ftp: e.target.value })} /></label>
              <label>Goal
                <select value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })}>
                  <option>Racing</option><option>Long rides</option><option>Getting fitter</option><option>Something else</option>
                </select>
              </label>
            </div>
            <fieldset>
              <legend>Consent</legend>
              {(Object.keys(CONSENT_TEXT) as ConsentKey[]).map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={!!consents[k]} onChange={() => setConsents({ ...consents, [k]: !consents[k] })} />
                  {CONSENT_TEXT[k]} {REQUIRED_CONSENTS.includes(k) ? <span className="req">required</span> : null}
                </label>
              ))}
            </fieldset>
            <div className="row">
              <button onClick={() => setStep(2)}>Back</button>
              <button
                className="primary"
                onClick={() =>
                  run(() => {
                    const o = labs.checkout({
                      qty, partner, partnerName: pName, partnerEmail: pEmail, start: later ? null : start, later,
                      name: f.name, email: f.email, phone: f.phone, ftp: f.ftp ? Number(f.ftp) : null, goal: f.goal, consents, src: 'prototype'
                    });
                    setOrderId(o.id);
                  })
                }
              >
                Go to payment
              </button>
            </div>
          </>
        )}
      </section>

      <aside className="card">
        <h3>Basket</h3>
        <Lines q={q} />
        <p className="small muted">{later ? 'Dates: chosen after paying' : start ? `First session: ${when(start)}` : 'No date chosen yet'}</p>
      </aside>
    </div>
  );
}

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

function SlotPicker({ slots, value, onChange, need }: { slots: Slot[]; value: string | null; onChange: (s: string) => void; need: number }) {
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots) m.set(cphDate(Date.parse(s.start)), [...(m.get(cphDate(Date.parse(s.start))) ?? []), s]);
    return [...m.entries()];
  }, [slots]);
  if (slots.length === 0) return <p className="note err">No free sessions{need > 1 ? ' with 2 spots' : ''} in the coming weeks.</p>;
  const first = slots[0];
  return (
    <div>
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

// ---------------- Account ----------------
// Kept outside the component so switching tabs doesn't reset the login form.
const loginForm = { email: '', sent: false };

function Account({ me, setMe, run, buyMore }: { me: string | null; setMe: (id: string | null) => void; run: Run; buyMore: (email: string) => void }) {
  const [email, setEmailState] = useState(loginForm.email);
  const [code, setCode] = useState('');
  const [sent, setSentState] = useState(loginForm.sent);
  const setEmail = (v: string) => { loginForm.email = v; setEmailState(v); };
  const setSent = (v: boolean) => { loginForm.sent = v; setSentState(v); };
  const [booking, setBooking] = useState<{ mode: 'book' } | { mode: 'move'; id: string } | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  if (!me) {
    return (
      <section className="card narrow">
        <h2>Log in</h2>
        <p className="muted">Enter the email you signed up with. We send a 6 digit code (in the prototype it lands in the Emails tab).</p>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {!sent ? (
          <button className="primary" onClick={() => run(() => { labs.requestLogin(email, () => String(Math.floor(100000 + Math.random() * 900000))); setSent(true); }, 'If that email has an account, a code is on its way.')}>Send code</button>
        ) : (
          <>
            <label>Code<input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></label>
            {(() => {
              const last = [...labs.db.emails].reverse().find((m) => m.template === 'login_code' && m.to === email.trim().toLowerCase());
              return last ? <p className="small muted">Prototype only: the email says <b>{last.subject.slice(-6)}</b>. In the live app it's only in the rider's inbox.</p> : <p className="small muted">No code sent: that email has no account yet. Sign up first.</p>;
            })()}
            <div className="row">
              <button className="primary" onClick={() => run(() => { setMe(labs.verifyLogin(email, code).id); setSent(false); }, 'Logged in.')}>Log in</button>
              <button onClick={() => setSent(false)}>Use another email</button>
            </div>
          </>
        )}
      </section>
    );
  }

  const a = labs.account(me);
  const exclude = booking?.mode === 'move' ? booking.id : undefined;
  const moving = booking?.mode === 'move' ? labs.db.bookings.find((b) => b.id === booking.id) : null;
  const need = moving ? moving.seats : a.balance.orders[0]?.partner && !a.balance.orders[0]?.partnerUsed ? 2 : 1;
  const slots = booking ? labs.slotsFor(me, need, { excludeBooking: exclude }).filter((s) => !moving || s.start !== moving.start) : [];

  return (
    <div className="grid">
      <section className="card">
        <div className="row spread">
          <h2>Hi {a.customer.name.split(' ')[0]}</h2>
          <button className="ghost" onClick={() => setMe(null)}>Log out</button>
        </div>

        <h3>Upcoming</h3>
        {a.upcoming.length === 0 && <p className="muted">Nothing booked.</p>}
        {a.upcoming.map((b) => (
          <div key={b.id} className="item">
            <span><b>{when(b.start)}</b> {b.label}{b.withPartner ? `, with ${b.partnerName}` : ''}</span>
            {b.changeable ? (
              confirmCancel === b.id ? (
                <span className="row">
                  Cancel this session?
                  <button onClick={() => run(() => { labs.cancel(b.id, 'rider'); setConfirmCancel(null); }, 'Cancelled. The session is back in your account.')}>Yes, cancel</button>
                  <button onClick={() => setConfirmCancel(null)}>Keep it</button>
                </span>
              ) : (
                <span className="row">
                  <button onClick={() => { setBooking({ mode: 'move', id: b.id }); setPick(null); }}>Change date</button>
                  <button onClick={() => setConfirmCancel(b.id)}>Cancel</button>
                </span>
              )
            ) : (
              <span className="muted small">Less than 24 h to go: email contact@ndure.dk</span>
            )}
          </div>
        ))}

        {booking ? (
          <div className="box">
            <h3>{booking.mode === 'book' ? 'Book a session' : 'Pick a new time'}</h3>
            <SlotPicker slots={slots} value={pick} onChange={setPick} need={need} />
            <div className="row">
              <button
                className="primary"
                disabled={!pick}
                onClick={() =>
                  run(() => {
                    if (booking.mode === 'book') labs.book(me, pick!, { by: 'rider' });
                    else labs.reschedule(booking.id, pick!, 'rider');
                    setBooking(null);
                  }, booking.mode === 'book' ? 'Booked. Confirmation sent.' : 'Moved. Confirmation sent.')
                }
              >
                Confirm
              </button>
              <button onClick={() => setBooking(null)}>Close</button>
            </div>
          </div>
        ) : (
          <div className="row">
            {a.balance.total > 0 && <button className="primary" onClick={() => { setBooking({ mode: 'book' }); setPick(null); }}>Book a session</button>}
            <button onClick={() => buyMore(a.customer.email)}>Buy more sessions</button>
          </div>
        )}

        <h3>Past</h3>
        {a.past.length === 0 && <p className="muted">No sessions yet.</p>}
        {a.past.map((b) => (
          <div key={b.id} className="item"><span>{when(b.start)} {b.label}</span><span className="muted">{b.status === 'no_show' ? 'No show' : 'Done'}</span></div>
        ))}
      </section>

      <aside className="card">
        <h3>Sessions left</h3>
        <p className="big">{a.balance.total}</p>
        {a.balance.orders.map((o) => (
          <p key={o.id} className="small muted">{o.remaining} of {o.qty}{o.free ? ' (free)' : ''}, valid until {fmt(o.expiresAt!, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
        ))}
        {a.nextDue &&
          (Date.parse(a.nextDue) <= Date.now() + state.offset ? (
            <p className="small"><b>Your next test is due now.</b> Your last one was over {DEFAULT_CONFIG.emails.retestNudgeWeeks.at(-1)} weeks ago.</p>
          ) : (
            <p className="small">Next test due around <b>{fmt(a.nextDue, { day: 'numeric', month: 'long' })}</b></p>
          ))}
      </aside>
    </div>
  );
}

// ---------------- Team ----------------
function Team({ run }: { run: Run }) {
  const [give, setGive] = useState({ email: '', name: '', qty: 1 });
  const [close, setClose] = useState({ date: '', reason: '' });
  const [late, setLate] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const now = Date.now() + state.offset;
  const daysList = labs.teamDays();
  const customers = labs.customersOverview();
  const moving = moveId ? labs.db.bookings.find((b) => b.id === moveId) : null;

  return (
    <>
      <section className="card">
        <h2>Upcoming sessions</h2>
        {daysList.length === 0 && <p className="muted">Nothing booked yet. Sign up as a rider first.</p>}
        {daysList.map(({ date, list }) => (
          <div key={date}>
            <h3>{longDay(list[0].start)} <span className="muted small">{list.reduce((n, r) => n + r.seats, 0)} riders</span></h3>
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
                      <td className="small">{cs?.health ? 'Health ok' : 'Missing'}{cs?.film ? ', film ok' : ''}{cs?.research ? ', R&D ok' : ''}</td>
                      <td>{statusLabel(r)}</td>
                      <td className="actions">
                        {started && r.status === 'booked' && (
                          <>
                            <button onClick={() => run(() => labs.markAttendance(r.id, 'attended'), 'Marked as attended.')}>Attended</button>
                            <button onClick={() => run(() => labs.markAttendance(r.id, 'no_show'), 'Marked as no show. The session stays used.')}>No show</button>
                          </>
                        )}
                        {!started && r.status === 'booked' && (
                          late === r.id ? (
                            <>
                              <button onClick={() => run(() => { labs.cancel(r.id, 'team', true); setLate(null); }, 'Cancelled, session returned to the rider.')}>Cancel, give session back</button>
                              <button onClick={() => run(() => { labs.cancel(r.id, 'team', false); setLate(null); }, 'Cancelled, session counted as used.')}>Cancel, session used</button>
                              <button onClick={() => setLate(null)}>Keep</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setMoveId(r.id); setPick(null); }}>Move</button>
                              <button onClick={() => setLate(r.id)}>Cancel</button>
                            </>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        {moving && (
          <div className="box">
            <h3>Move {labs.customer(moving.customerId).name} from {when(moving.start)}</h3>
            <SlotPicker slots={labs.slots(moving.seats, { excludeBooking: moving.id, team: true }).filter((s) => s.start !== moving.start)} value={pick} onChange={setPick} need={moving.seats} />
            <div className="row">
              <button className="primary" disabled={!pick} onClick={() => run(() => { labs.reschedule(moving.id, pick!, 'team'); setMoveId(null); }, 'Moved. The rider got an email.')}>Move</button>
              <button onClick={() => setMoveId(null)}>Close</button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Riders</h2>
        <table className="team">
          <thead><tr><th>Name</th><th>Email</th><th>Sessions left</th><th>Next</th><th>Last</th><th></th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.email}</td>
                <td>{c.balance.total}</td>
                <td>{c.upcoming[0] ? when(c.upcoming[0].start) : <span className="muted">none</span>}</td>
                <td>{c.past[0] ? when(c.past[0].start) : ''}</td>
                <td className="actions">
                  {c.orders.filter((o) => o.status === 'paid' && !o.free).slice(-1).map((o) => (
                    <button key={o.id} onClick={() => run(() => labs.refund(o.id), `Refunded ${eur(o.total)} order (in the live app: done in Stripe).`)}>Refund last order</button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid">
        <section className="card">
          <h3>Give free sessions</h3>
          <p className="muted small">For athletes, partners, friends testing the flow.</p>
          <div className="row">
            <label>Email<input type="email" value={give.email} onChange={(e) => setGive({ ...give, email: e.target.value })} /></label>
            <label>Name<input value={give.name} onChange={(e) => setGive({ ...give, name: e.target.value })} /></label>
            <label>Sessions<input type="number" min={1} max={10} value={give.qty} onChange={(e) => setGive({ ...give, qty: Number(e.target.value) })} /></label>
          </div>
          <button onClick={() => run(() => labs.giveSessions(give), `${give.qty} free sessions added. They can log in and book.`)}>Add sessions</button>
        </section>
        <section className="card">
          <h3>Close a day</h3>
          <p className="muted small">Holidays, coach away. Riders can't book it.</p>
          <div className="row">
            <label>Date<input type="date" value={close.date} onChange={(e) => setClose({ ...close, date: e.target.value })} /></label>
            <label>Reason<input value={close.reason} onChange={(e) => setClose({ ...close, reason: e.target.value })} /></label>
          </div>
          <button onClick={() => run(() => labs.closeDay(close.date, close.reason), 'Day closed.')}>Close day</button>
          {labs.db.closed.length > 0 && <p className="small muted">Closed: {labs.db.closed.map((c) => c.date).join(', ')}</p>}
        </section>
      </div>

      <section className="card">
        <details>
          <summary>Team calendar feed (subscribe once in Outlook or Google)</summary>
          <pre>{labs.calendarFeed()}</pre>
        </details>
      </section>
    </>
  );
}

function statusLabel(b: Booking) {
  return { booked: 'Booked', attended: 'Attended', no_show: 'No show', cancelled: 'Cancelled' }[b.status];
}

// ---------------- Emails ----------------
function Emails() {
  const list = [...labs.db.emails].reverse();
  return (
    <section className="card">
      <h2>Outbox</h2>
      <p className="muted">Every email the app would send. Automatic ones (reminder, follow up, retest nudge, expiry) appear when you move the clock.</p>
      {list.length === 0 && <p className="muted">No emails yet.</p>}
      {list.map((e) => (
        <details key={e.id} className="mail">
          <summary>
            <span className="tag">{e.template.replace('_', ' ')}</span> <b>{e.subject}</b> <span className="muted small">to {e.to}, {when(e.at)}</span>
          </summary>
          <pre>{e.body}</pre>
        </details>
      ))}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
