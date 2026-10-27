'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PublicOrder } from '@/lib/public';
import { Header } from './Header';
import { SlotPicker, fmt, type Slot } from './SlotPicker';

type Mode = { type: 'book' } | { type: 'reschedule'; bookingId: string } | null;

const when = (iso: string) => `${fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' })}, ${fmt(iso, { hour: '2-digit', minute: '2-digit' })}`;
const STEPS = ['Sessions', 'Date', 'Details', 'Payment'];

export function OrderClient({ token, initial, justPaid }: { token: string; initial: PublicOrder; justPaid: boolean }) {
  const [order, setOrder] = useState(initial);
  const [mode, setMode] = useState<Mode>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [need, setNeed] = useState(1);
  const [pick, setPick] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/order/${token}`, { cache: 'no-store' });
    if (res.ok) setOrder(await res.json());
  }, [token]);

  // Right after Stripe, the payment and the booking take a few seconds to confirm.
  const confirming = order.status === 'pending' || (order.status === 'paid' && order.first.status === 'pending');
  useEffect(() => {
    if (!confirming) return;
    let tries = 0;
    const id = setInterval(async () => {
      tries++;
      await refresh();
      if (tries > 30) clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
  }, [confirming, refresh]);

  const upcoming = order.bookings.filter((b) => b.status === 'booked' && b.upcoming);
  const past = order.bookings.filter((b) => b.status === 'booked' && !b.upcoming);

  // Open the calendar straight away when there's nothing booked yet and nothing being booked.
  useEffect(() => {
    if (order.status === 'paid' && !confirming && order.creditsLeft > 0 && upcoming.length === 0 && mode === null) setMode({ type: 'book' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.status, confirming]);

  const loadSlots = useCallback(async (m: Mode) => {
    if (!m) return;
    setSlots(null);
    setSlotsError(null);
    setPick(null);
    const qs = m.type === 'reschedule' ? `?booking=${m.bookingId}` : '';
    try {
      const r = await fetch(`/api/order/${token}/slots${qs}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load free sessions.');
      setSlots(d.slots);
      setNeed(d.need);
    } catch (e) {
      setSlotsError((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    loadSlots(mode);
  }, [mode, loadSlots]);

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
      loadSlots(mode); // a session may have filled in the meantime
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

  if (order.status === 'pending' || (confirming && justPaid)) {
    return (
      <>
        <Header steps={STEPS} current={3} />
        <div className="narrow">
          <span className="eyebrow">{order.status === 'pending' ? (justPaid ? 'Confirming payment' : 'Waiting for payment') : 'Booking your session'}</span>
          <h1 className="h1">One moment.</h1>
          <p className="lead">
            {order.status === 'pending' && !justPaid
              ? 'This order has not been paid yet.'
              : order.first.start
                ? `We're confirming your session on ${when(order.first.start)}. This page updates by itself.`
                : 'Stripe is confirming your payment. This page updates by itself.'}
          </p>
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

  const firstBooked = order.first.status === 'booked' && upcoming.length > 0;

  return (
    <>
      <Header />
      <div className="narrow">
        <div className="stack">
          <span className="eyebrow accent">Paid</span>
          <h1 className="h1">
            {firstBooked && justPaid
              ? `See you ${fmt(upcoming[0].start, { weekday: 'long' })}, ${order.firstName}.`
              : upcoming.length === 0 && order.creditsLeft > 0
                ? `Choose a date, ${order.firstName}.`
                : `Your sessions, ${order.firstName}.`}
          </h1>
          <p className="lead">Diplomvej 376, Kongens Lyngby. Bring cycling shoes and pedals. Changes are free up to 24 hours before.</p>
        </div>

        {order.first.status === 'failed' && upcoming.length === 0 && (
          <div className="error" role="alert">
            The session you picked{order.first.start ? ` (${when(order.first.start)})` : ''} filled up while you were paying. Your session is safe on your account. Choose another time below.
          </div>
        )}
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
            <div>
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
            Book {upcoming.length > 0 || past.length > 0 ? 'your next' : 'a'} session
          </button>
        )}

        {mode && (
          <section className="sec" aria-labelledby="s-pick">
            <div className="sec-hd">
              <h2 id="s-pick">{mode.type === 'book' ? 'Pick a session' : 'Pick a new time'}</h2>
              {need > 1 && <span className="small muted">Sessions with 2 free spots, for you and your partner</span>}
            </div>
            <SlotPicker slots={slots} need={need} value={pick} onChange={setPick} error={slotsError} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', alignItems: 'center' }}>
              <button type="button" className="btn" disabled={!pick || busy} onClick={confirm}>
                {busy ? 'Saving…' : pick ? `Confirm ${fmt(pick.start, { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmt(pick.start, { hour: '2-digit', minute: '2-digit' })}` : 'Choose a session'}
              </button>
              <button type="button" className="linkbtn" onClick={() => setMode(null)}>
                {mode.type === 'book' && upcoming.length === 0 ? 'Pick a date later' : 'Close'}
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
