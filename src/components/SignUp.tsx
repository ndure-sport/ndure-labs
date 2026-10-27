'use client';

import { useEffect, useMemo, useState } from 'react';
import { quote, type PricingConfig, type AddonKey } from '@/lib/pricing';
import { CONSENT_TEXT, CHANGE_DEADLINE_HOURS, VALID_MONTHS, type ConsentKey } from '@/lib/policy';
import { Header } from './Header';
import { SlotPicker, slotLabel, type Slot } from './SlotPicker';
import { navigate } from '@/lib/nav';

const STEPS = ['Sessions', 'Date', 'Details', 'Payment'];
const eur = (n: number) => `€${Number.isInteger(n) ? n : n.toFixed(2)}`;

type Props = { config: PricingConfig; src: string | null; cancelled: boolean; initialQty: number; initialPartner: boolean };

export function SignUp({ config, src, cancelled, initialQty, initialPartner }: Props) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [qty, setQty] = useState(Math.min(config.maxQty, Math.max(1, initialQty)));
  const [partner, setPartner] = useState(initialPartner);
  const [addons, setAddons] = useState<AddonKey[]>([]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [later, setLater] = useState(false);
  const [rider, setRider] = useState({ name: '', email: '', phone: '', ftp: '', goal: 'Racing' });
  const [partnerInfo, setPartnerInfo] = useState({ name: '', email: '' });
  const [consents, setConsents] = useState<Record<ConsentKey, boolean>>({ ready: false, health: false, terms: false, research: false, film: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(cancelled ? 'Payment was cancelled. Nothing was charged.' : null);

  const need = partner ? 2 : 1;

  async function loadSlots() {
    setSlots(null);
    setSlotsError(null);
    try {
      const r = await fetch(`/api/slots?need=${need}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load free sessions.');
      setSlots(d.slots);
    } catch (e) {
      setSlotsError((e as Error).message);
    }
  }

  // Free sessions depend on whether a partner rides along (needs 2 seats).
  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [need]);

  const q = useMemo(() => quote(config, { qty, partner, addons }), [config, qty, partner, addons]);
  const tiers = [...config.tiers].sort((a, b) => a.min - b.min);
  const enabledAddons = config.addons.filter((a) => a.enabled);
  const canLater = qty > 1;
  const dateOk = !!slot || (later && canLater);
  const requiredOk = consents.ready && consents.health && consents.terms;
  const detailsOk =
    dateOk &&
    requiredOk &&
    rider.name.trim() &&
    /\S+@\S+\.\S+/.test(rider.email) &&
    (!partner || (partnerInfo.name.trim() && /\S+@\S+\.\S+/.test(partnerInfo.email)));

  function go(s: 0 | 1 | 2) {
    setStep(s);
    window.scrollTo({ top: 0 });
  }

  function toggleAddon(k: AddonKey) {
    setAddons((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));
  }

  async function pay() {
    if (!detailsOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qty, partner, addons, rider, partnerInfo, consents, src,
          slot: slot && !later ? { eventTypeId: slot.eventTypeId, start: slot.start } : null,
          later: later && canLater
        })
      });
      const data = await res.json();
      if (res.status === 409) {
        // The session was taken while they filled in the form. Back to the calendar with fresh times.
        setSlot(null);
        setError(data.error || 'That session just filled up. Pick another one.');
        loadSlots();
        go(1);
        setBusy(false);
        return;
      }
      if (!res.ok || !data.url) throw new Error(data.error || 'Payment could not be started.');
      navigate(data.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const cta =
    step === 0
      ? { text: 'Choose a date', short: 'Choose a date', disabled: false, run: () => go(1) }
      : step === 1
        ? { text: dateOk ? 'Continue' : 'Pick a session', short: 'Continue', disabled: !dateOk, run: () => go(2) }
        : { text: busy ? 'Opening payment…' : `Pay ${eur(q.total)}`, short: 'Pay', disabled: !detailsOk || busy, run: pay };

  const note =
    step === 0
      ? slots && slots.length > 0
        ? `Next free session: ${slotLabel(slots[0])}.`
        : 'You choose your date in the next step.'
      : step === 1
        ? 'Your seat is held while you pay.'
        : requiredOk
          ? 'Secure payment by Stripe. Discount codes can be added there.'
          : 'Readiness, data consent and terms are required.';

  return (
    <>
      <Header steps={STEPS} current={step} />
      <main className="main">
        <div className="col">
          {error && <div className="error" role="alert">{error}</div>}

          {step === 0 && (
            <>
              <div className="stack">
                <span className="eyebrow">NDURE Labs, Kongens Lyngby</span>
                <h1 className="h1">Sign up for a lactate session.</h1>
                <p className="lead">
                  One session gives you your zones today. If you want to see them move, add retests now at a lower price per session. They stay valid for {VALID_MONTHS} months.
                </p>
                {config.showAnchor && <span className="small muted">The founding round price was €{config.anchor} per session.</span>}
              </div>

              <section className="sec" aria-labelledby="s-sessions">
                <div className="sec-hd">
                  <h2 id="s-sessions">Sessions</h2>
                  <span className="small muted">Step test with a coach, report within 48 hours</span>
                </div>
                <div className="grid-chips">
                  {tiers.map((t) => (
                    <button key={t.min} type="button" className={`chip${qty === t.min ? ' on' : ''}`} aria-pressed={qty === t.min} onClick={() => setQty(t.min)}>
                      <span className="k">{t.min} {t.min === 1 ? 'session' : 'sessions'}</span>
                      <span className="v">{eur(t.unit)}</span>
                      <span className="s">{t.min === 1 ? 'per session' : `each, ${eur(t.unit * t.min)} total`}</span>
                    </button>
                  ))}
                </div>
                <div className="stepper">
                  <span className="note">{q.next ? `Add ${q.next.more} more and each session costs ${eur(q.next.unit)}.` : 'This is the lowest price per session.'}</span>
                  <div className="ctl">
                    <button type="button" aria-label="One session less" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))}>−</button>
                    <span className="qty" aria-live="polite">{qty} {qty === 1 ? 'session' : 'sessions'}</span>
                    <button type="button" aria-label="One session more" disabled={qty >= config.maxQty} onClick={() => setQty((n) => Math.min(config.maxQty, n + 1))}>+</button>
                  </div>
                </div>
              </section>

              <section className="sec" aria-labelledby="s-partner">
                <div className="sec-hd"><h2 id="s-partner">Bring someone</h2></div>
                <button type="button" className={`row${partner ? ' on' : ''}`} aria-pressed={partner} onClick={() => { setPartner((p) => !p); setSlot(null); }}>
                  <span className="box" aria-hidden="true">{partner ? '✓' : ''}</span>
                  <span className="txt"><b>Training partner</b><span className="small muted">Rides in the same session as you and gets their own report.</span></span>
                  <span className="price">{eur(config.partner)}</span>
                </button>
              </section>

              {enabledAddons.length > 0 && (
                <section className="sec" aria-labelledby="s-extras">
                  <div className="sec-hd"><h2 id="s-extras">Extras</h2></div>
                  {enabledAddons.map((a) => (
                    <button key={a.key} type="button" className={`row${addons.includes(a.key) ? ' on' : ''}`} aria-pressed={addons.includes(a.key)} onClick={() => toggleAddon(a.key)}>
                      <span className="box" aria-hidden="true">{addons.includes(a.key) ? '✓' : ''}</span>
                      <span className="txt"><b>{a.name}</b><span className="small muted">{a.desc}</span></span>
                      <span className="price">{eur(a.price)}</span>
                    </button>
                  ))}
                </section>
              )}

              <ul className="ruled">
                <li>Sessions stay valid for {VALID_MONTHS} months.</li>
                <li>Change or cancel for free up to {CHANGE_DEADLINE_HOURS} hours before.</li>
              </ul>
              <p className="small muted" style={{ margin: 0 }}>
                Signing up a team or club? <a href="mailto:contact@ndure.dk?subject=NDURE%20Labs%20team%20price">Ask for a price per rider</a>.
              </p>
            </>
          )}

          {step === 1 && (
            <div className="stack-lg">
              <button type="button" className="linkbtn" onClick={() => go(0)}>Back to sessions</button>
              <div className="stack">
                <h1 className="h1">{qty > 1 ? 'Choose your first session.' : 'Choose your session.'}</h1>
                <p className="lead">
                  Tuesday to Friday, morning 09:30 or afternoon 13:00. Three riders a day.
                  {partner ? ' Only sessions with 2 free spots are shown, for you and your partner.' : ''}
                  {qty > 1 ? ` You book your other ${qty - 1} later with your personal link.` : ''}
                </p>
              </div>
              <SlotPicker slots={slots} need={need} value={later ? null : slot} onChange={(s) => { setSlot(s); setLater(false); }} error={slotsError} autoPickEarliest={!later} />
              {canLater && (
                <label className="consent opt">
                  <input type="checkbox" checked={later} onChange={() => setLater((l) => !l)} />
                  <span>I'm not sure yet, I'll choose all my dates after paying.</span>
                </label>
              )}
            </div>
          )}

          {step === 2 && (
            <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); pay(); }} aria-label="Your details">
              <button type="button" className="linkbtn" onClick={() => go(1)}>Back to date</button>
              <h1 className="h1">Your details.</h1>
              <div className="grid-2">
                <label className="field">Full name<input required autoComplete="name" value={rider.name} onChange={(e) => setRider({ ...rider, name: e.target.value })} /></label>
                <label className="field">Email<input required type="email" autoComplete="email" value={rider.email} onChange={(e) => setRider({ ...rider, email: e.target.value })} /></label>
                <label className="field">Phone<input type="tel" autoComplete="tel" placeholder="+45" value={rider.phone} onChange={(e) => setRider({ ...rider, phone: e.target.value })} /></label>
                <label className="field">FTP in watts (optional)<input type="number" inputMode="numeric" min={50} max={700} value={rider.ftp} onChange={(e) => setRider({ ...rider, ftp: e.target.value })} /></label>
                <label className="field">Main goal this season
                  <select value={rider.goal} onChange={(e) => setRider({ ...rider, goal: e.target.value })}>
                    <option>Racing</option><option>Long rides and gran fondos</option><option>Getting fitter</option><option>Something else</option>
                  </select>
                </label>
              </div>

              {partner && (
                <div className="side-note">
                  <b style={{ fontSize: 13 }}>Your training partner</b>
                  <div className="grid-2">
                    <label className="field">Their name<input required value={partnerInfo.name} onChange={(e) => setPartnerInfo({ ...partnerInfo, name: e.target.value })} /></label>
                    <label className="field">Their email<input required type="email" value={partnerInfo.email} onChange={(e) => setPartnerInfo({ ...partnerInfo, email: e.target.value })} /></label>
                  </div>
                  <span className="small muted">We email them their own readiness check and consent.</span>
                </div>
              )}

              <fieldset className="consents">
                <legend>Before you ride</legend>
                {(Object.keys(CONSENT_TEXT) as ConsentKey[]).map((k) => (
                  <label key={k} className={`consent${k === 'research' || k === 'film' ? ' opt' : ''}`}>
                    <input type="checkbox" checked={consents[k]} onChange={() => setConsents({ ...consents, [k]: !consents[k] })} />
                    <span>
                      {CONSENT_TEXT[k]}
                      {k === 'ready' && <> <a href="https://www.ndure.dk/labs/readiness" target="_blank" rel="noreferrer">Readiness check</a></>}
                      {k === 'health' && <> <a href="https://www.ndure.dk/privacy" target="_blank" rel="noreferrer">Privacy</a></>}
                      {k === 'terms' && <> <a href="https://www.ndure.dk/labs/terms" target="_blank" rel="noreferrer">Terms</a></>}
                    </span>
                  </label>
                ))}
              </fieldset>
            </form>
          )}
        </div>

        <aside className="aside" aria-label="Your sign up">
          <div className="aside-hd"><b>Your sign up</b><span className="eyebrow">{q.qty + (q.partner ? 1 : 0) + q.addons.length} items</span></div>
          <div className="lines">
            {q.lines.map((l, i) => (
              <div key={i} className={`line${l.kind === 'discount' ? ' discount' : ''}`}>
                <span className="l"><span>{l.label}</span>{l.sub && <small>{l.sub}</small>}</span>
                <span className="a">{l.amount < 0 ? `−${eur(-l.amount)}` : eur(l.amount)}</span>
              </div>
            ))}
          </div>
          {step > 0 && (
            <div className="line" style={{ padding: '0 16px 14px' }}>
              <span className="l"><span>{qty > 1 ? 'First session' : 'Session'}</span><small>{later ? 'You choose after paying' : slot ? slot.label : 'Not chosen yet'}</small></span>
              <span className="a">{later ? '' : slot ? slotLabel(slot) : ''}</span>
            </div>
          )}
          <div className="totals">
            <div className="t"><span className="muted">Total</span><strong>{eur(q.total)}</strong></div>
            <div className="s"><span>Per session</span><span>{eur(q.unit)}</span></div>
            {q.saving > 0 && <div className="s"><span>Saved vs single sessions</span><span style={{ color: 'var(--accent)', fontWeight: 600 }}>{eur(q.saving)}</span></div>}
          </div>
          <button type="button" className="btn full" disabled={cta.disabled} onClick={cta.run}>{cta.text}</button>
          <span className="aside-note">{note}</span>
        </aside>
      </main>

      <div className="mbar">
        <span>{step > 0 && slot && !later ? slotLabel(slot) : `${q.qty + (q.partner ? 1 : 0) + q.addons.length} items`}, <b>{eur(q.total)}</b></span>
        <button type="button" className="btn" disabled={cta.disabled} onClick={cta.run}>{cta.short}</button>
      </div>
    </>
  );
}
