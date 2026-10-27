'use client';

import { useMemo, useState } from 'react';
import { quote, type PricingConfig, type AddonKey } from '@/lib/pricing';
import { CONSENT_TEXT, CHANGE_DEADLINE_HOURS, VALID_MONTHS, type ConsentKey } from '@/lib/policy';
import { Header } from './Header';

const STEPS = ['Sessions', 'Details', 'Payment', 'Date'];
const eur = (n: number) => `€${Number.isInteger(n) ? n : n.toFixed(2)}`;

type Props = { config: PricingConfig; src: string | null; cancelled: boolean; initialQty: number; initialPartner: boolean };

export function SignUp({ config, src, cancelled, initialQty, initialPartner }: Props) {
  const [step, setStep] = useState<0 | 1>(0);
  const [qty, setQty] = useState(Math.min(config.maxQty, Math.max(1, initialQty)));
  const [partner, setPartner] = useState(initialPartner);
  const [addons, setAddons] = useState<AddonKey[]>([]);
  const [rider, setRider] = useState({ name: '', email: '', phone: '', ftp: '', goal: 'Racing' });
  const [partnerInfo, setPartnerInfo] = useState({ name: '', email: '' });
  const [consents, setConsents] = useState<Record<ConsentKey, boolean>>({ ready: false, health: false, terms: false, research: false, film: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(cancelled ? 'Payment was cancelled. Nothing was charged.' : null);

  const q = useMemo(() => quote(config, { qty, partner, addons }), [config, qty, partner, addons]);
  const tiers = [...config.tiers].sort((a, b) => a.min - b.min);
  const enabledAddons = config.addons.filter((a) => a.enabled);
  const requiredOk = consents.ready && consents.health && consents.terms;
  const detailsOk =
    requiredOk && rider.name.trim() && /\S+@\S+\.\S+/.test(rider.email) && (!partner || (partnerInfo.name.trim() && /\S+@\S+\.\S+/.test(partnerInfo.email)));

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
        body: JSON.stringify({ qty, partner, addons, rider, partnerInfo, consents, src })
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Payment could not be started.');
      window.location.href = data.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const cta =
    step === 0
      ? { text: 'Continue', disabled: false, run: () => { setStep(1); window.scrollTo({ top: 0 }); } }
      : { text: busy ? 'Opening payment…' : `Pay ${eur(q.total)}`, disabled: !detailsOk || busy, run: pay };

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
                <button type="button" className={`row${partner ? ' on' : ''}`} aria-pressed={partner} onClick={() => setPartner((p) => !p)}>
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
                <li>You choose your date right after paying.</li>
              </ul>
              <p className="small muted" style={{ margin: 0 }}>
                Signing up a team or club? <a href="mailto:contact@ndure.dk?subject=NDURE%20Labs%20team%20price">Ask for a price per rider</a>.
              </p>
            </>
          )}

          {step === 1 && (
            <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); pay(); }} aria-label="Your details">
              <button type="button" className="linkbtn" onClick={() => setStep(0)}>Back to sessions</button>
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
          <div className="totals">
            <div className="t"><span className="muted">Total</span><strong>{eur(q.total)}</strong></div>
            <div className="s"><span>Per session</span><span>{eur(q.unit)}</span></div>
            {q.saving > 0 && <div className="s"><span>Saved vs single sessions</span><span style={{ color: 'var(--accent)', fontWeight: 600 }}>{eur(q.saving)}</span></div>}
          </div>
          <button type="button" className="btn full" disabled={cta.disabled} onClick={cta.run}>{cta.text}</button>
          <span className="aside-note">
            {step === 0 ? 'Secure payment by Stripe. Discount codes can be added there.' : requiredOk ? 'You pay on the next screen, then choose your date.' : 'Readiness, data consent and terms are required.'}
          </span>
        </aside>
      </main>

      <div className="mbar">
        <span>{q.qty + (q.partner ? 1 : 0) + q.addons.length} items, <b>{eur(q.total)}</b></span>
        <button type="button" className="btn" disabled={cta.disabled} onClick={cta.run}>{step === 0 ? 'Continue' : 'Pay'}</button>
      </div>
    </>
  );
}
