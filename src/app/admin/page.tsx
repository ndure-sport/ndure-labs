import { db, type Order, type Booking } from '@/lib/db';
import { Header } from '@/components/Header';

export const dynamic = 'force-dynamic';

const TZ = 'Europe/Copenhagen';
const fmtDay = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
const fmtTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const fmtDate = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }).format(new Date(iso));

type Row = Booking & { orders: Order };

// The team's view: who comes when, with what they need to know at the door.
// Cal.com is the calendar of record; this page adds order, partner and consent status.
export default async function Admin() {
  const since = new Date(Date.now() - 12 * 3_600_000).toISOString();
  const [{ data: bookingRows }, { data: unbooked }] = await Promise.all([
    db().from('bookings').select('*, orders(*)').eq('status', 'booked').gte('start_at', since).order('start_at'),
    db().from('orders').select('*').eq('status', 'paid').gt('credits_left', 0).order('paid_at', { ascending: false }).limit(200)
  ]);
  const rows = (bookingRows ?? []) as Row[];
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const k = fmtDay(r.start_at);
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  const consentOk = (c: any) => !!c?.items?.health?.agreed && !!c?.items?.ready?.agreed;

  return (
    <>
      <Header />
      <div className="main" style={{ display: 'block' }}>
        <div className="stack" style={{ marginBottom: 28 }}>
          <span className="eyebrow">Team only</span>
          <h1 className="h1">Upcoming sessions</h1>
          <p className="lead">Riders and partners by day. Move or cancel a booking from the rider&apos;s own link or in Cal.com; this page follows.</p>
        </div>

        {byDay.size === 0 && <div className="notice">Nothing booked yet.</div>}
        {[...byDay.entries()].map(([dayLabel, list]) => (
          <section key={dayLabel} className="sec" style={{ marginBottom: 28 }}>
            <div className="sec-hd"><h2>{dayLabel}</h2><span className="small muted">{list.reduce((n, r) => n + (r.with_partner ? 2 : 1), 0)} riders</span></div>
            <div className="scroll-x">
              <table className="admin">
                <thead>
                  <tr><th>Time</th><th>Rider</th><th>Contact</th><th>FTP, goal</th><th>Partner</th><th>Order</th><th>Flags</th></tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const o = r.orders;
                    return (
                      <tr key={r.id}>
                        <td>{fmtTime(r.start_at)}<br /><span className="muted">{r.label}</span></td>
                        <td><b>{o.rider_name}</b></td>
                        <td>{o.rider_email}<br />{o.rider_phone ?? ''}</td>
                        <td>{o.ftp ? `${o.ftp} W` : 'n/a'}<br /><span className="muted">{o.goal ?? ''}</span></td>
                        <td>{r.with_partner ? <>{o.partner_name}<br /><span className="muted">{o.partner_email}</span></> : ''}</td>
                        <td>{o.qty} sessions, {o.credits_left} left<br /><span className="muted">{o.src ?? ''}</span></td>
                        <td>
                          {!consentOk(o.consents) && <span className="tag warn">rider consent missing</span>}{' '}
                          {r.with_partner && !consentOk(o.partner_consents) && <span className="tag warn">partner consent missing</span>}{' '}
                          {(o.consents as any)?.items?.film?.agreed && <span className="tag">ok to film</span>}{' '}
                          {(o.consents as any)?.items?.research?.agreed && <span className="tag">R&amp;D data ok</span>}
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
          <div className="scroll-x">
            <table className="admin">
              <thead><tr><th>Paid</th><th>Rider</th><th>Email</th><th>Left</th><th>Partner</th></tr></thead>
              <tbody>
                {((unbooked ?? []) as Order[]).map((o) => (
                  <tr key={o.id}>
                    <td>{o.paid_at ? fmtDate(o.paid_at) : ''}</td>
                    <td>{o.rider_name}</td>
                    <td>{o.rider_email}</td>
                    <td>{o.credits_left} of {o.qty}</td>
                    <td>{o.partner ? (o.partner_used ? 'used' : 'not booked yet') : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
