import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SignUp } from '../src/components/SignUp';
import { OrderClient } from '../src/components/OrderClient';
import { Header } from '../src/components/Header';
import { DEFAULT_PRICING } from '../src/lib/pricing';
import { publicOrder } from '../src/lib/public';
import { db, demoFlags, installFetch, ordersWithBookings, payOrder, seed } from './mock';

installFetch();
seed();

type View =
  | { name: 'signup'; n: number; cancelled?: boolean }
  | { name: 'pay'; token: string }
  | { name: 'order'; token: string; justPaid: boolean; n: number }
  | { name: 'team'; n: number };

const eur = (n: number) => `€${Number.isInteger(n) ? n : n.toFixed(2)}`;
const TZ = 'Europe/Copenhagen';
const f = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).format(new Date(iso));

function App() {
  const [view, setView] = useState<View>({ name: 'signup', n: 0 });
  const [lastToken, setLastToken] = useState<string | null>(null);

  useEffect(() => {
    (globalThis as any).__ndureNavigate = (url: string) => {
      if (url.startsWith('demo-pay:')) {
        const token = url.slice('demo-pay:'.length);
        setLastToken(token);
        setView({ name: 'pay', token });
      }
    };
    window.scrollTo({ top: 0 });
  }, [view]);

  const go = (v: View) => {
    setView(v);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <div className="demo-bar" role="region" aria-label="Demo controls">
        <span className="demo-tag">Demo</span>
        <span className="demo-txt">Fake sessions and payments. Nothing is saved or charged.</span>
        <nav className="demo-nav" aria-label="Demo views">
          <button type="button" aria-pressed={view.name === 'signup'} onClick={() => go({ name: 'signup', n: Date.now() })}>Sign up</button>
          <button type="button" aria-pressed={view.name === 'order'} disabled={!lastToken || db.orders.get(lastToken)?.status !== 'paid'} onClick={() => lastToken && go({ name: 'order', token: lastToken, justPaid: false, n: Date.now() })}>Rider page</button>
          <button type="button" aria-pressed={view.name === 'team'} onClick={() => go({ name: 'team', n: Date.now() })}>Team view</button>
          <button type="button" onClick={() => { db.orders.clear(); db.bookings.length = 0; seed(); setLastToken(null); go({ name: 'signup', n: Date.now() }); }}>Reset</button>
        </nav>
      </div>

      {view.name === 'signup' && (
        <SignUp key={view.n} config={DEFAULT_PRICING} src="demo" cancelled={!!view.cancelled} initialQty={1} initialPartner={false} />
      )}
      {view.name === 'pay' && (
        <FakeStripe
          token={view.token}
          onPaid={() => { payOrder(view.token); go({ name: 'order', token: view.token, justPaid: true, n: Date.now() }); }}
          onCancel={() => go({ name: 'signup', n: Date.now(), cancelled: true })}
        />
      )}
      {view.name === 'order' && <OrderView key={view.n} token={view.token} justPaid={view.justPaid} />}
      {view.name === 'team' && <TeamView key={view.n} />}
    </>
  );
}

function OrderView({ token, justPaid }: { token: string; justPaid: boolean }) {
  const o = db.orders.get(token)!;
  const initial = publicOrder(o, db.bookings.filter((b) => b.order_id === o.id));
  return <OrderClient token={token} initial={initial} justPaid={justPaid} />;
}

// Stands in for Stripe Checkout, which in the live app is Stripe's own page.
function FakeStripe({ token, onPaid, onCancel }: { token: string; onPaid: () => void; onCancel: () => void }) {
  const o = db.orders.get(token)!;
  const [fail, setFail] = useState(false);
  return (
    <div className="fake-stripe">
      <div className="fs-card">
        <span className="eyebrow">Stripe Checkout, simulated</span>
        <h1 className="h1" style={{ fontSize: 22 }}>Pay NDURE ApS</h1>
        <div className="lines" style={{ padding: 0 }}>
          <div className="line"><span className="l"><span>Lactate session × {o.qty}</span><small>{eur(o.unit_price)} each</small></span><span className="a">{eur(o.qty * o.unit_price)}</span></div>
          {o.partner && <div className="line"><span className="l"><span>Training partner</span></span><span className="a">{eur(DEFAULT_PRICING.partner)}</span></div>}
          {(o.addons as string[]).map((k) => {
            const a = DEFAULT_PRICING.addons.find((x) => x.key === k)!;
            return <div key={k} className="line"><span className="l"><span>{a.name}</span></span><span className="a">{eur(a.price)}</span></div>;
          })}
        </div>
        <div className="totals" style={{ padding: '12px 0 0' }}>
          <div className="t"><span className="muted">Total</span><strong>{eur(o.total)}</strong></div>
        </div>
        <div className="fs-methods" aria-hidden="true"><span>Card</span><span>Apple Pay</span><span>MobilePay</span></div>
        <p className="small muted" style={{ margin: 0 }}>In the live app this is Stripe's own page, where riders also enter discount codes. The payment window stays open 31 minutes while their seat is held.</p>
        {o.first_start && (
          <label className="consent opt">
            <input type="checkbox" checked={fail} onChange={() => setFail((v) => !v)} />
            <span>Simulate: the session fills up from Cal.com while this rider pays.</span>
          </label>
        )}
        <button type="button" className="btn full" onClick={() => { demoFlags.failNextBooking = fail; onPaid(); }}>Pay {eur(o.total)}</button>
        <button type="button" className="linkbtn" onClick={onCancel}>Back to NDURE Labs</button>
      </div>
    </div>
  );
}

// What the team sees on /admin and in Cal.com: who comes when.
function TeamView() {
  const { orders, bookings } = ordersWithBookings();
  const byOrder = new Map(orders.map((o) => [o.id, o]));
  const upcoming = bookings.filter((b) => b.status === 'booked').sort((a, b) => a.start_at.localeCompare(b.start_at));
  const days = new Map<string, typeof upcoming>();
  for (const b of upcoming) {
    const k = f(b.start_at, { weekday: 'long', day: 'numeric', month: 'long' });
    days.set(k, [...(days.get(k) ?? []), b]);
  }
  const unbooked = orders.filter((o) => o.status === 'paid' && o.credits_left > 0);
  return (
    <>
      <Header />
      <div className="main" style={{ display: 'block' }}>
        <div className="stack" style={{ marginBottom: 28 }}>
          <span className="eyebrow">Team only, /admin</span>
          <h1 className="h1">Upcoming sessions</h1>
          <p className="lead">Riders you signed up in this demo appear here, grouped by day. The same bookings show in Cal.com and the team calendar.</p>
        </div>
        {days.size === 0 && <div className="notice">Nothing booked yet in this demo. Sign up as a rider first.</div>}
        {[...days.entries()].map(([day, list]) => (
          <section key={day} className="sec" style={{ marginBottom: 28 }}>
            <div className="sec-hd"><h2>{day}</h2><span className="small muted">{list.reduce((n, b) => n + (b.with_partner ? 2 : 1), 0)} of your riders</span></div>
            <div className="scroll-x">
              <table className="admin">
                <thead><tr><th>Time</th><th>Rider</th><th>Contact</th><th>FTP, goal</th><th>Partner</th><th>Order</th><th>Flags</th></tr></thead>
                <tbody>
                  {list.map((b) => {
                    const o = byOrder.get(b.order_id)!;
                    const c = (o.consents as any)?.items ?? {};
                    return (
                      <tr key={b.id}>
                        <td>{f(b.start_at, { hour: '2-digit', minute: '2-digit' })}<br /><span className="muted">{b.label}</span></td>
                        <td><b>{o.rider_name}</b></td>
                        <td>{o.rider_email}<br />{o.rider_phone ?? ''}</td>
                        <td>{o.ftp ? `${o.ftp} W` : 'n/a'}<br /><span className="muted">{o.goal ?? ''}</span></td>
                        <td>{b.with_partner ? <>{o.partner_name}<br /><span className="muted">{o.partner_email}</span></> : ''}</td>
                        <td>{o.qty} sessions, {o.credits_left} left</td>
                        <td>
                          {b.with_partner && !o.partner_consents && <span className="tag warn">partner consent missing</span>}{' '}
                          {c.film?.agreed && <span className="tag">ok to film</span>}{' '}
                          {c.research?.agreed && <span className="tag">R&amp;D data ok</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        <section className="sec" style={{ marginTop: 40 }}>
          <div className="sec-hd"><h2>Paid, sessions left to book</h2><span className="small muted">People to nudge</span></div>
          {unbooked.length === 0 ? (
            <span className="small muted">Nobody yet.</span>
          ) : (
            <div className="scroll-x">
              <table className="admin">
                <thead><tr><th>Rider</th><th>Email</th><th>Left</th></tr></thead>
                <tbody>{unbooked.map((o) => <tr key={o.id}><td>{o.rider_name}</td><td>{o.rider_email}</td><td>{o.credits_left} of {o.qty}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
