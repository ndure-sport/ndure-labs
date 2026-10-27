'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PublicOrder } from '@/lib/public';
import { Header } from './Header';

type Slot = { eventTypeId: number; label: string; start: string; end: string | null; free: number; seats: number };
type Mode = { type: 'book' } | { type: 'reschedule'; bookingId: string } | null;

const TZ = 'Europe/Copenhagen';
const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).format(new Date(iso));
const when = (iso: string) => `${fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' })}, ${fmt(iso, { hour: '2-digit', minute: '2-digit' })}`;

export function OrderClient({ token, initial, justPaid }: { token: string; initial: PublicOrder; justPaid: boolean }) {
  const [order, setOrder] = useState(initial);
  const [mode, setMode] = useState<Mode>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [need, setNeed] = useState(1);
  const [day, setDay] = useState<string | null>(null);
  const [pick, setPick] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/order/${token}`, { cache: 'no-store' });
    if (res.ok) setOrder(await res.json());
  }, [token]);

  // Right after Stripe, the payment confirmation can take a few seconds to arrive.
  useEffect(() => {
    if (order.status !== 'pending') return;
    let tries = 0;
    const id = setInterval(async () => {
      tries++;
      await refresh();
      if (tries > 30) clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
  }, [order.status, refresh]);

  const upcoming = order.bookings.filter((b) => b.status === 'booked' && b.upcoming);
  const past = order.bookings.filter((b) => b.status === 'booked' && !b.upcoming);

  // Open the date picker straight away for a fresh order with nothing booked yet.
  useEffect(() => {
    if (order.status === 'paid' && order.creditsLeft > 0 && order.bookings.length === 0 && mode === null) setMode({ type: 'book' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.status]);

  useEffect(() => {
    if (!mode) return;
    setSlots(null);
    setDay(null);
    setPick(null);
    setError(null);
    const qs = mode.type === 'reschedule' ? `?booking=${mode.bookingId}` : '';
    fetch(`/api/order/${token}/slots${qs}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not load free sessions.');
        setSlots(d.slots);
        setNeed(d.need);
      })
      .catch((e) => setError(e.message));
  }, [mode, token]);

  const days = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const k = dayKey(s.start);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return [...map.entries()].map(([k, list]) => ({ key: k, list, first: list[0].start, free: list.reduce((n, s) => n + s.free, 0) }));
  }, [slots]);

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/order/${token}/book`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Something went wrong.');
      setOrder(d);
      setMode(null);
      setMessage(success);
    } catch (e) {
      setError((e as Error).message);
      // A slot may have filled in the meantime; reload the list.
      if (mode) setMode({ ...mode });
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!pick || !mode) return;
    const base = { eventTypeId: pick.eventTypeId, start: pick.start };
    if (mode.type === 'book') act({ action: 'book', ...base }, `Booked: ${when(pick.start)}. A calendar invite is on its way.`);
    else act({ action: 'reschedule', bookingId: mode.bookingId, ...base }, `Moved to ${when(pick.start)}. Your calendar invite is updated.`);
  }

  function cancel(id: string, start: string) {
    if (!window.confirm(`Cancel your session on ${when(start)}? The session goes back to your account.`)) return;
    act({ action: 'cancel', bookingId: id }, 'Cancelled. The session is back in your account.');
  }

  if (order.status === 'pending') {
    return (
      <>
        <Header steps={['Sessions', 'Details', 'Payment', 'Date']} current={2} />
        <div className="narrow">
          <span className="eyebrow">{justPaid ? 'Confirming payment' : 'Waiting for payment'}</span>
          <h1 className="h1">One moment.</h1>
          <p className="lead">{justPaid ? 'Stripe is confirming your payment. This page updates by itself.' : 'This order has not been paid yet.'}</p>
        </div>
      </>
    );
  }

  if (order.status !== 'paid') {
    return (
      <>
        <Header />
        <div className="narrow">
          <h1 className="h1">This order is closed.</h1>
          <p className="lead">It was {order.status}. Questions? Email <a href="mailto:contact@ndure.dk">contact@ndure.dk</a>.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Header steps={['Sessions', 'Details', 'Payment', 'Date']} current={3} />
      <div className="narrow">
        <div className="stack">
          <span className="eyebrow accent">Paid</span>
          <h1 className="h1">{mode?.type === 'book' && order.bookings.length === 0 ? `Choose a date, ${order.firstName}.` : `Your sessions, ${order.firstName}.`}</h1>
          <p className="lead">Diplomvej 376, Kongens Lyngby. Bring cycling shoes and pedals. Changes are free up to 24 hours before.</p>
        </div>

        {message && <div className="notice" role="status">{message}</div>}
        {error && <div className="error" role="alert">{error}</div>}

        <dl className="facts">
          <div><dt>Bought</dt><dd>{order.qty} {order.qty === 1 ? 'session' : 'sessions'}</dd></div>
          <div><dt>Left to book</dt><dd>{order.creditsLeft}</dd></div>
          {order.partner && (
            <div><dt>Training partner</dt><dd>{order.partner.name}{order.partner.consented ? '' : ', consent pending'}</dd></div>
          )}
        </dl>

        {(upcoming.length > 0 || past.length > 0) && (
          <section className="sec" aria-labelledby="s-booked">
            <div className="sec-hd"><h2 id="s-booked">Booked</h2></div>
            <div className="sessions" style={{ borderTop: 0 }}>
              {upcoming.map((b) => (
                <div key={b.id} className="session">
                  <span className="when"><b>{when(b.start)}</b><span className="small muted">{b.label}{b.withPartner ? ', with your partner' : ''}</span></span>
                  {b.changeable ? (
                    <span className="acts">
                      <button type="button" className="linkbtn" disabled={busy} onClick={() => setMode({ type: 'reschedule', bookingId: b.id })}>Change date</button>
                      <button type="button" className="linkbtn" disabled={busy} onClick={() => cancel(b.id, b.start)}>Cancel</button>
                    </span>
                  ) : (
                    <span className="small muted">Less than 24 h to go. Email contact@ndure.dk to change.</span>
                  )}
                </div>
              ))}
              {past.map((b) => (
                <div key={b.id} className="session">
                  <span className="when"><b>{when(b.start)}</b><span className="small muted">Done</span></span>
                </div>
              ))}
            </div>
          </section>
        )}

        {!mode && order.creditsLeft > 0 && (
          <button type="button" className="btn" onClick={() => setMode({ type: 'book' })}>
            Book {order.bookings.some((b) => b.status === 'booked') ? 'your next' : 'a'} session
          </button>
        )}

        {mode && (
          <section className="sec" aria-labelledby="s-pick">
            <div className="sec-hd">
              <h2 id="s-pick">{mode.type === 'book' ? 'Pick a day' : 'Pick a new day'}</h2>
              {need > 1 && <span className="small muted">Only sessions with 2 free spots, for you and your partner</span>}
            </div>
            {!slots && !error && <span className="small muted">Loading free sessions…</span>}
            {slots && days.length === 0 && <div className="notice">No free sessions in the coming weeks. Email contact@ndure.dk and we will find a time.</div>}
            {days.length > 0 && (
              <div className="grid-days">
                {days.map((d) => (
                  <button key={d.key} type="button" className={`chip${day === d.key ? ' on' : ''}`} aria-pressed={day === d.key} onClick={() => { setDay(d.key); setPick(null); }}>
                    <span className="k">{fmt(d.first, { weekday: 'short' })}</span>
                    <span className="v" style={{ fontSize: 14 }}>{fmt(d.first, { day: 'numeric', month: 'short' })}</span>
                    <span className="s">{d.free} free</span>
                  </button>
                ))}
              </div>
            )}
            {day && (
              <div className="grid-chips" style={{ marginTop: 8 }}>
                {days.find((d) => d.key === day)!.list.map((s) => (
                  <button key={s.eventTypeId + s.start} type="button" className={`chip${pick === s ? ' on' : ''}`} aria-pressed={pick === s} onClick={() => setPick(s)}>
                    <span className="k">{s.label}</span>
                    <span className="v" style={{ fontSize: 16 }}>{fmt(s.start, { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="s">{s.free} of {s.seats} free</span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', alignItems: 'center', marginTop: 8 }}>
              <button type="button" className="btn" disabled={!pick || busy} onClick={confirm}>
                {busy ? 'Saving…' : pick ? `Confirm ${fmt(pick.start, { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmt(pick.start, { hour: '2-digit', minute: '2-digit' })}` : 'Choose a day and session'}
              </button>
              <button type="button" className="linkbtn" onClick={() => setMode(null)}>
                {mode.type === 'book' && order.bookings.length === 0 ? 'Pick a date later' : 'Close'}
              </button>
            </div>
          </section>
        )}

        <p className="small muted" style={{ margin: 0 }}>
          This page is your private link, also sent by email. Know a rider who would like this? Send them to ndure.dk/labs.
        </p>
      </div>
    </>
  );
}
