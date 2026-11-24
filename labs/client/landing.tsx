// The NDURE Labs page (design: version 1 on the review board) with the real booking flow built in.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { quote, type Slot } from '../core/engine';
import { DEFAULT_CONFIG, noticeText } from '../core/config';
import { fmt, when } from '../core/time';
import type { ConsentKey } from '../core/types';
import { MonthPicker } from './picker';
import { api, ApiError, getConfig, kr, Msg, Turnstile, Header, Footer, type Note, type PublicConfig } from './shared';
import { CONTACT_EMAIL, LINKS, EUR_PER_DKK, PLAN_INFO, RECOMMENDED, PLAN_ORDER, FLOW, FAQS } from './content';

const CFG = DEFAULT_CONFIG;
const PACKS = PLAN_ORDER.filter((n) => CFG.packs.includes(n));
const unitFor = (n: number) => quote(CFG, n, false).unit;
const LOWEST = Math.min(...PACKS.map(unitFor));
const SINGLE = unitFor(1);
const longDay = (iso: string) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' });
const clock = (iso: string) => fmt(iso, { hour: '2-digit', minute: '2-digit' });


const bookHref = (n: number) => {
  const src = new URLSearchParams(location.search).get('src');
  return `/book?qty=${n}${src ? `&src=${encodeURIComponent(src)}` : ''}`;
};

const eur = (n: number) => `about €${Math.round(n * EUR_PER_DKK)}`;

// ---------------- sections (design: version 1) ----------------
function Hero() {
  return (
    <section className="v-hero" aria-labelledby="hero-t">
      <img className="v-hero-img" src="/img/hero-sensor.jpg" alt="The NDURE lactate sensor strapped to a rider's upper arm during a test" width="1000" height="1777" />
      <div className="v-hero-in">
        <span className="v-tag dark">NDURE Labs · Copenhagen</span>
        <h1 id="hero-t" className="v-h1"><span className="bl">Lactate testing for cyclists.</span><span className="bl">Come back every month.</span></h1>
        <ul className="v-chips">
          <li>Cycling only</li>
          <li>In person, in our lab in Copenhagen</li>
          <li>A test, not a device: no sensor to take home</li>
        </ul>
        <div className="v-hero-foot">
          <p>Know exactly how hard to train. Two hours in our lab gives you your LT1, LT2 and training zones, and every visit keeps them up to date as you get fitter.</p>
          <div className="v-hero-cta">
            <span>From <b>{kr(LOWEST)}</b> a session</span>
            <a className="v-btn white lg" href="#price">Book your session</a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Why() {
  return (
    <section id="why" className="v-sec" aria-labelledby="why-t">
      <span className="v-tag">Why come back</span>
      <h2 id="why-t" className="v-h2"><span className="bl">Other labs sell you one test.</span><span className="bl">We made coming back cheaper.</span></h2>
      <div className="v-why">
        <div className="v-card grey">
          <span className="v-k">1 · Better data</span>
          <b className="v-big">Our sensor measures your lactate continuously.</b>
          <span className="v-s">Not just a few drops of blood. You see the whole curve, so your LT1 and LT2 are more precise.</span>
        </div>
        <div className="v-card black">
          <span className="v-k">2 · Continuous improvement</span>
          <div>
            <span className="v-lbl">NDURE Labs</span>
            <span className="v-num">{kr(LOWEST)}</span>
            <span className="v-lbl">a session, every few weeks · {eur(LOWEST)}</span>
          </div>
          <p className="v-line">Your zones keep moving as you get fitter. So we made it affordable to measure your lactate every few weeks.</p>
        </div>
      </div>
    </section>
  );
}

const SKIN: Record<number, string> = { 1: 'white', 3: 'black', 6: 'cream' };

function Prices() {
  return (
    <section id="price" className="v-sec grey" aria-labelledby="price-t">
      <div className="v-price-head">
        <div>
          <span className="v-tag white">Prices</span>
          <h2 id="price-t" className="v-h2"><span className="bl">Pick your program.</span><span className="bl">Come back whenever you want.</span></h2>
        </div>
        <ul className="v-perks"><li>✓&nbsp; Valid {CFG.validityMonths} months</li><li>✓&nbsp; Pay once</li><li>✓&nbsp; No subscription</li></ul>
      </div>
      <div className="v-plans">
        {PACKS.map((n) => {
          const p = PLAN_INFO[n];
          const q = quote(CFG, n, false);
          const singles = n * quote(CFG, 1, false).unit;
          const save = singles - q.total;
          const pct = Math.round((save / singles) * 100);
          return (
            <div key={n} className={`v-plan ${SKIN[n] ?? 'white'}`}>
              <span className="v-ptags"><span className="v-ptag">{p.tag}</span>{save > 0 && <span className="v-save">Save {kr(save)}</span>}</span>
              <b className="v-pname">{p.tier}</b>
              <span className="v-ptot">{kr(q.total)} <span>total · {n === 1 ? '1 session' : `${n} sessions`}</span></span>
              {save > 0 && <span className="v-pless">{pct}% less than {n} single sessions</span>}
              <span className="v-pprice">{kr(q.unit)}</span>
              <span className="v-pm">{n === 1 ? 'for one session' : 'per session'} · {eur(q.unit)}</span>
              <ul>
                {p.inc.map((t) => <li key={t}><span aria-hidden="true">✓</span>{t}</li>)}
                {(p.not ?? []).map((t) => <li key={t} className="no"><span aria-hidden="true">✕</span>{t}</li>)}
              </ul>
              <a className="v-pbtn" href={bookHref(n)}>Choose {p.tier}</a>
            </div>
          );
        })}
      </div>
      <p className="v-note">Already have sessions? <a href="/account">Log in</a>. Team or club? <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Team pricing, NDURE Labs')}`}>Email {CONTACT_EMAIL}</a>.</p>
    </section>
  );
}

function Session() {
  return (
    <section id="session" className="v-sec" aria-labelledby="session-t">
      <span className="v-tag">The session</span>
      <h2 id="session-t" className="v-h2">How NDURE Labs works.</h2>
      <ol className="v-steps">
        {FLOW.map(([t, d], i) => (
          <li key={t}><span className="v-n">{String(i + 1).padStart(2, '0')}</span><b>{t}</b><span>{d}</span></li>
        ))}
      </ol>
    </section>
  );
}

function Anna() {
  return (
    <section className="v-sec black tall" aria-labelledby="anna-t">
      <div className="v-anna">
        <div className="v-video">
          <img src="/img/anna-fit.jpg" alt={LINKS.annaVideo ? '' : 'Anna fits the NDURE lactate sensor on a rider'} aria-hidden={LINKS.annaVideo ? true : undefined} loading="lazy" width="1000" height="1777" />
          {LINKS.annaVideo && (
            <a className="v-play" href={LINKS.annaVideo} target="_blank" rel="noopener noreferrer" aria-label="Watch Anna explain NDURE Labs">
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="#000" /></svg>
            </a>
          )}
        </div>
        <div className="v-anna-txt">
          <span className="v-tag dark">Your tester</span>
          <h2 id="anna-t" className="v-h3">Meet our Performance Physiologist, Anna Serop.</h2>
          <p>Anna is the NDURE performance physiologist. She runs every session in the lab, sets you up on the bike and the sensor, and takes you through your report so you know how to train.</p>
          <p>When you come back, you see her again. She knows your history and what changed since last time.</p>
          <a className="v-btn white" href="#price">Book a session with Anna</a>
        </div>
      </div>
    </section>
  );
}

function Lactate() {
  return (
    <section className="v-sec tall" aria-labelledby="lac-t">
      <span className="v-tag">Good to know</span>
      <h2 id="lac-t" className="v-h3 big">Lactate, LT1 and LT2.</h2>
      <div className="v-lac">
        <div className="v-card grey sm wide"><b>What is lactate?</b><span>A substance your muscles make when you work. The harder you ride, the more of it ends up in your blood. How it rises tells us how your body handles effort.</span></div>
        <div className="v-card line sm"><b>LT1</b><span>Where lactate first starts to rise. Below it is your easy, all day endurance riding.</span></div>
        <div className="v-card black sm"><b>LT2</b><span>Where lactate shoots up. Roughly the hardest pace you can hold for a long effort.</span></div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="v-sec flush" aria-labelledby="faq-t">
      <div className="v-faq">
        <div>
          <span className="v-tag">FAQ</span>
          <h2 id="faq-t" className="v-h3 big">Questions.</h2>
          <p className="v-s" style={{ marginTop: 12 }}>Something else? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
        </div>
        <div className="v-qs">{FAQS.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
      </div>
    </section>
  );
}

function SiteFooter() {
  const ext = { target: '_blank', rel: 'noopener noreferrer' };
  const social: [string, string, React.ReactNode][] = [
    [LINKS.youtube, 'NDURE on YouTube', <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7v10l8-5z" fill="#000" /></svg>],
    [LINKS.linkedin, 'NDURE on LinkedIn', <b>in</b>],
    [LINKS.instagram, 'NDURE on Instagram', <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5" /><circle cx="12" cy="12" r="3.5" /></svg>]
  ];
  return (
    <footer className="v-foot">
      <div className="v-foot-top">
        <div className="v-foot-l">
          <img src="/img/ndure-logo.png" alt="NDURE" width="64" height="64" />
          <p className="v-foot-h"><span className="bl">Built by athletes,</span><span className="bl">for athletes.</span></p>
          <p className="v-foot-p">Lactate testing for cyclists at our lab in Lyngby. Continuous and blood lactate, a performance report with your LT1, LT2 and zones, and new zones every time you come back.</p>
          <p className="v-foot-d">NDURE Labs is a sports performance test for adults 18+. It is not a medical examination and is not intended to diagnose, prevent, monitor or treat any disease, injury or medical condition.</p>
          <a className="v-btn white" href="#price">Book a session</a>
          {social.some(([u]) => u) && <div className="v-social">{social.filter(([u]) => u).map(([u, l, i]) => <a key={l} href={u} aria-label={l} {...ext}>{i}</a>)}</div>}
        </div>
        <nav aria-label="Footer" className="v-foot-nav">
          {LINKS.home && <a href={LINKS.home}>Home</a>}
          {LINKS.ambassador && <a href={LINKS.ambassador} {...ext}>Become an Ambassador</a>}
          {LINKS.careers && <a href={LINKS.careers} {...ext}>Careers</a>}
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms and Conditions</a>
          <a href="/health-check">Health check</a>
        </nav>
      </div>
      <div className="v-foot-bot"><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a><span>NDURE ApS · CVR: 45530701<br />Diplomvej 376,<br />2800 Kongens Lyngby</span></div>
    </footer>
  );
}

// ---------------- booking ----------------
const LINK_FOR: Partial<Record<ConsentKey, [string, string]>> = {
  ready: ['/health-check', 'Read the health check'],
  health: ['/privacy', 'Privacy policy'],
  terms: ['/terms', 'Read the terms']
};

// The three packs. On the Labs page "Choose" opens the booking page; on the booking page it goes to the date.
function Plans({ qty, onPick, onChoose }: { qty: number; onPick: (n: number) => void; onChoose: (n: number) => void }) {
  return (
    <>
      <div className="plans" role="list">
        {PACKS.map((n) => {
          const p = PLAN_INFO[n];
          const pq = quote(CFG, n, false);
          const rec = n === RECOMMENDED;
          return (
            <div key={n} role="listitem" className={`plan${rec ? ' rec' : ''}${qty === n ? ' sel' : ''}`} onClick={() => onPick(n)}>
              <span className="tag">{rec && <b>RECOMMENDED</b>}</span>
              <span className="h3">{p.tier}</span>
              <span className="m">{n === 1 ? '1 session' : `${n} sessions`}</span>
              <span className="price"><b>{kr(pq.unit)}</b><span className="m">per session</span></span>
              <span className="m">{n === 1 ? 'one session' : `${kr(pq.total)} in total`}</span>
              {pq.saving > 0 && <span className="save">Save {kr(pq.saving)}</span>}
              <span className="m" style={{ marginTop: 6 }}>{p.line}</span>
              <ul className="inc"><p>WHAT YOU GET</p>{p.inc.map((t) => <li key={t}>{t}</li>)}</ul>
              <button type="button" className="btn" onClick={(e) => { e.stopPropagation(); onChoose(n); }}>Choose {p.tier}</button>
            </div>
          );
        })}
      </div>
      <p className="note-s">We suggest a session every 8 weeks. Packs are valid for {CFG.validityMonths} months: book the rest whenever you want.</p>
    </>
  );
}


function Booking({ slots, slotError, reloadSlots }: { slots: Slot[] | null; slotError: string | null; reloadSlots: () => void }) {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const startQty = Number(params.get('qty'));
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [cfgErr, setCfgErr] = useState(false);
  const [step, setStep] = useState(() => {
    const st = Number(params.get('step'));
    return PACKS.includes(startQty) ? (st === 3 ? 2 : 2) : 1; // never land on the details step without a picked time
  });
  const [qty, setQty] = useState(PACKS.includes(startQty) ? startQty : RECOMMENDED);
  const [start, setStart] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', email: '', phone: '' });
  const [consents, setConsents] = useState<Partial<Record<ConsentKey, boolean>>>({});
  const [human, setHuman] = useState('');
  const [tsRound, setTsRound] = useState(0); // a bot check token works once: show a fresh one after a failed try
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(params.get('cancelled') ? { kind: 'err', text: 'Payment was cancelled. Nothing was charged. Pick a time again to try again.' } : null);

  const loadCfg = useCallback(() => {
    setCfgErr(false);
    getConfig().then(setCfg).catch(() => setCfgErr(true));
  }, []);
  useEffect(loadCfg, [loadCfg]);
  // Browser back and forward move between the steps.
  useEffect(() => {
    const onPop = () => {
      const u = new URLSearchParams(location.search);
      const n = Number(u.get('qty'));
      if (PACKS.includes(n)) setQty(n);
      setStep(PACKS.includes(n) ? Math.min(Number(u.get('step')) || 2, start ? 3 : 2) : 1);
      setNote(null);
      window.scrollTo(0, 0);
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [start]);

  const q = quote(CFG, qty, false);
  const info = PLAN_INFO[qty];
  // Keep the chosen time valid when the list of free sessions changes.
  useEffect(() => {
    if (slots && start && !slots.some((s) => s.start === start)) setStart(null);
  }, [slots]);

  // Each step is its own view: the page starts at the top, no smooth scrolling around.
  const go = (n: number, q = qty) => {
    setStep(n);
    setNote(null);
    const u = new URLSearchParams(location.search);
    u.delete('cancelled');
    if (n === 1) { u.delete('qty'); u.delete('step'); } else { u.set('qty', String(q)); u.set('step', String(n)); }
    history.pushState(null, '', `/book${u.toString() ? `?${u}` : ''}`);
    window.scrollTo(0, 0);
  };
  const choose = (n: number) => {
    setQty(n);
    go(2, n);
  };

  const missing = (cfg?.required ?? []).filter((k) => !consents[k]);
  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!start) { setNote({ kind: 'err', text: 'Pick a date first.' }); go(2); return; }
    if (missing.length) { setNote({ kind: 'err', text: 'Tick all the required boxes.' }); return; }
    if (cfg?.turnstileSiteKey && !human) { setNote({ kind: 'err', text: 'Wait for the security check to finish, then try again.' }); return; }
    setBusy(true);
    setNote(null);
    try {
      const d = await api<{ url: string }>('/api/checkout', {
        qty, partner: false, start,
        name: f.name, email: f.email, phone: f.phone,
        consents, src: params.get('src') || 'web', turnstile: human
      });
      location.assign(d.url);
    } catch (e) {
      const err = e as ApiError;
      setHuman('');
      setTsRound((n) => n + 1);
      setBusy(false);
      if (err.status === 409) {
        const lost = start;
        setStart(null);
        reloadSlots();
        go(2);
        setNote({ kind: 'err', text: lost ? `Sorry, ${clock(lost)} on ${longDay(lost)} was just taken by someone else. Nothing was charged. Pick another time.` : err.message });
      } else setNote({ kind: 'err', text: err.message });
      window.scrollTo(0, 0);
    }
  }

  const summary = (
    <aside className="side panel sum" aria-label="Your booking">
      <p style={{ margin: 0, fontWeight: 600, fontSize: 17 }}>Your booking</p>
      <div className="sumqty"><b>{qty}</b><span><b>{qty === 1 ? 'lab session' : 'lab sessions'}</b><small>{info.tier} pack · {qty === 1 ? '1 test, 1 report' : `${qty} tests, ${qty} reports`}</small></span></div>
      <div className="ln"><span>{qty > 1 ? 'Session 1' : 'Session'}</span><span style={{ textAlign: 'right' }}>{start ? when(start) : 'Not chosen yet'}</span></div>
      {qty > 1 && <div className="ln"><span style={{ whiteSpace: 'nowrap' }}>{qty === 2 ? 'Session 2' : `Sessions 2 to ${qty}`}</span><span style={{ textAlign: 'right' }}>Book later in your account</span></div>}
      <div className="ln"><span>Where</span><span style={{ textAlign: 'right' }}>DTU Science Park reception<br />Diplomvej 381, Kongens Lyngby</span></div>
      <div className="ln"><span>Price</span><span>{qty > 1 && `${qty} × `}{q.saving > 0 && <s style={{ color: '#999', margin: '0 4px' }}>{kr(SINGLE)}</s>}{kr(q.unit)}</span></div>
      <div className="ln tot"><span style={{ color: '#000' }}>{qty > 1 ? `Total for ${qty} sessions` : 'Total'}</span><span>{kr(q.total)}</span></div>
      {q.saving > 0 && <p className="small" style={{ margin: '-4px 0 0', color: 'var(--blue)', fontWeight: 600, textAlign: 'right' }}>You save {kr(q.saving)}</p>}
      {(() => {
        const up = PACKS.find((n) => n > qty);
        if (!up) return null;
        const uq = quote(CFG, up, false);
        return (
          <button type="button" className="upsell" onClick={() => { setQty(up); const u = new URLSearchParams(location.search); u.set('qty', String(up)); history.replaceState(null, '', `/book?${u}`); }}>
            <b>Upgrade to {PLAN_INFO[up].tier}: {up} sessions at {kr(uq.unit)} each</b>
            <span>{kr(uq.total)} in total, {kr(uq.total - q.total)} more. Same first date, book the rest later.</span>
          </button>
        );
      })()}
      <ul>
        <li>Move or cancel for free until 24 hours before</li>
        <li>Pay once. No subscription</li>
        <li>Valid for {CFG.validityMonths} months</li>
      </ul>
    </aside>
  );

  return (
    <section className="band tight bookpage" aria-labelledby="book-t">
      <div className="stack g24">
        <h1 id="book-t" className="sr">{step === 1 ? 'Choose your sessions' : step === 2 ? 'Pick a date' : 'Your details'}</h1>
        <div className="book">
          <div className="steps">
            <ol aria-label="Booking steps">
              {['Sessions', 'Date', 'Details and payment'].map((s, i) => {
                const n = i + 1;
                // Every step you have reached, or can reach, is a link: details only once a time is picked.
                const can = n !== step && (n < step || (n === 2) || (n === 3 && !!start));
                const inner = <><span>{step > n ? '✓' : n}</span>{s}</>;
                return (
                  <li key={s} className={step === n ? 'on' : step > n ? 'done' : ''} aria-current={step === n ? 'step' : undefined}>
                    {can ? <button type="button" className="stepbtn" onClick={() => go(n)}>{inner}</button> : inner}
                  </li>
                );
              })}
            </ol>
            <a href="/account" style={{ fontSize: 14 }}>Already have sessions? Log in</a>
          </div>
          <Msg note={note} />

          {step === 1 && <Plans qty={qty} onPick={setQty} onChoose={choose} />}

          {step === 2 && (
            <div className="cols">
              <div className="main panel stack g16">
                <div className="row spread"><p className="h3" style={{ margin: 0 }}>{qty > 1 ? 'Pick your first session' : 'Pick your session'}</p><span className="muted small">Tue to Thu{noticeText(DEFAULT_CONFIG) && ` · book at least ${noticeText(DEFAULT_CONFIG)} ahead`}</span></div>
                {qty > 1 && <p className="muted small" style={{ margin: 0 }}>Your other {qty - 1} sessions you book later from your account, whenever it suits you.</p>}
                {slotError ? (
                  <div className="stack g12"><Msg note={{ kind: 'err', text: slotError }} /><button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={reloadSlots}>Try again</button></div>
                ) : !slots ? (
                  <p className="muted" aria-live="polite">Loading free sessions…</p>
                ) : slots.length === 0 ? (
                  <div className="soldout"><p><b>No free sessions in the coming weeks</b></p><p className="muted">We're fully booked right now. Email us and we find a time for you, or check back soon: new dates open every week.</p><a className="btn sm" href={`mailto:${CONTACT_EMAIL}`}>Email {CONTACT_EMAIL}</a></div>
                ) : (
                  <MonthPicker slots={slots} value={start} onChange={setStart} compact />
                )}
                <div className="row">
                  <button type="button" className="btn ghost sm" onClick={() => go(1)}>‹ Back</button>
                  <button type="button" className="btn sm" disabled={!start} onClick={() => go(3)}>Next: your details</button>
                </div>
              </div>
              {summary}
            </div>
          )}

          {step === 3 && (
            <div className="cols">
              <form className="main panel stack g24" onSubmit={pay} noValidate={false}>
                <div className="fields">
                  <label className="fld">Full name<input required maxLength={80} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
                  <label className="fld">Email<input required maxLength={254} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
                  <label className="fld">Phone<input maxLength={30} type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /><small>So we can reach you on the day</small></label>
                </div>
                {cfgErr && <div className="stack g8"><Msg note={{ kind: 'err', text: 'Could not load the consent texts.' }} /><button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={loadCfg}>Try again</button></div>}
                {cfg && (
                  <fieldset className="checks">
                    <legend>Before you pay</legend>
                    {(Object.keys(cfg.consents) as ConsentKey[]).map((k) => {
                      const req = cfg.required.includes(k);
                      const link = LINK_FOR[k];
                      return (
                        <label key={k} className="chk">
                          <input type="checkbox" checked={!!consents[k]} onChange={() => setConsents({ ...consents, [k]: !consents[k] })} />
                          <span>{cfg.consents[k].replace(/^Optional: /, '')}{link && <> <a href={link[0]} target="_blank" rel="noopener noreferrer">{link[1]}</a></>}<em>{req ? 'Required' : 'Optional'}</em></span>
                        </label>
                      );
                    })}
                  </fieldset>
                )}
                <Turnstile key={tsRound} siteKey={cfg?.turnstileSiteKey ?? null} onToken={setHuman} />
                <div className="row">
                  <button type="button" className="btn ghost sm" onClick={() => go(2)}>‹ Back</button>
                  <button type="submit" className="btn" disabled={busy || !cfg}>{busy ? 'Opening payment…' : `Pay ${kr(q.total)}`}</button>
                </div>
                <p className="muted small" style={{ margin: 0 }}>Secure payment by Stripe: card, Apple Pay or Google Pay. We hold your time while you pay.</p>
              </form>
              {summary}
            </div>
          )}
        </div>
        <p className="note-s" style={{ textAlign: 'center' }}>Team or club? <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Team pricing, NDURE Labs')}`}>Email {CONTACT_EMAIL}</a> for team pricing.</p>
      </div>
    </section>
  );
}

// ---------------- the page ----------------
export function Landing() {
  useEffect(() => { document.title = 'NDURE Labs · Lactate testing for cyclists in Copenhagen'; }, []);
  return (
    <>
      <a className="skip" href="#price">Skip to prices</a>
      <Header home />
      <main>
        <Hero />
        <Why />
        <Prices />
        <Session />
        <Anna />
        <Lactate />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}

// ---------------- the booking page (/book) ----------------
export function BookPage() {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const loadSlots = useCallback(() => {
    setSlotError(null);
    setSlots(null);
    api<{ slots: Slot[] }>('/api/slots?need=1').then((d) => setSlots(d.slots)).catch((e) => setSlotError((e as Error).message));
  }, []);
  useEffect(loadSlots, [loadSlots]);
  useEffect(() => { document.title = 'Book, NDURE Labs'; }, []);
  return (
    <>
      <Header />
      <main><Booking slots={slots} slotError={slotError} reloadSlots={loadSlots} /></main>
      <Footer />
    </>
  );
}
