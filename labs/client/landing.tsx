// The NDURE Labs page (design N1) with the real booking flow built in.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { quote, type Slot } from '../core/engine';
import { DEFAULT_CONFIG } from '../core/config';
import { fmt, when, cphDate } from '../core/time';
import type { ConsentKey } from '../core/types';
import { api, ApiError, getConfig, kr, Msg, Turnstile, Header, Footer, type Note, type PublicConfig } from './shared';
import { CONTACT_EMAIL, LINKS, OTHER_LABS_PRICE, JACK, PLAN_INFO, RECOMMENDED, PLAN_ORDER, FLOW, FAQS } from './content';

const CFG = DEFAULT_CONFIG;
const PACKS = PLAN_ORDER.filter((n) => CFG.packs.includes(n));
const unitFor = (n: number) => quote(CFG, n, false).unit;
const LOWEST = Math.min(...PACKS.map(unitFor));
const BIGGEST = Math.max(...PACKS);
const SINGLE = unitFor(1);
const introHref = LINKS.introCall || `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Free 15 min call about NDURE Labs')}`;
const dayName = (iso: string) => fmt(iso, { weekday: 'short' });
const dayNum = (iso: string) => fmt(iso, { day: 'numeric' });
const monthShort = (iso: string) => fmt(iso, { month: 'short' });
const longDay = (iso: string) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' });
const clock = (iso: string) => fmt(iso, { hour: '2-digit', minute: '2-digit' });

function scrollToBook() {
  document.getElementById('book')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

// Reveal sections as they come into view, and count numbers up once.
function useReveal() {
  useEffect(() => {
    const root = document.documentElement;
    if (!('IntersectionObserver' in window)) return;
    root.classList.add('js');
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const count = (el: HTMLElement) => {
      const to = Number(el.dataset.count);
      if (calm || !to) { el.textContent = to.toLocaleString('en-US'); return; }
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / 1400);
        el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString('en-US');
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver((list) => {
      for (const e of list) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        el.classList.add('seen');
        el.querySelectorAll<HTMLElement>('[data-count]').forEach(count);
        io.unobserve(el);
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    document.querySelectorAll('.rv').forEach((el) => io.observe(el));
    // Safety net: never leave anything hidden, even if the observer misses it.
    const t = setTimeout(() => document.querySelectorAll('.rv:not(.seen)').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight) el.classList.add('seen');
    }), 2500);
    return () => { io.disconnect(); clearTimeout(t); };
  }, []);
}

const Icon = {
  bike: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="5.5" cy="17.5" r="3.5" /><circle cx="18.5" cy="17.5" r="3.5" /><path d="M15 6h2l3 11.5M5.5 17.5 9 9h7l-4.5 8.5H5.5M9 9 7.5 6H6" /></svg>,
  pin: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>,
  info: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>
};

// ---------------- sections ----------------
function Hero({ firstFree }: { firstFree: string | null | undefined }) {
  return (
    <section className="band hero" aria-labelledby="hero-t">
      <div className="split">
        <div className="txt stack g24">
          <p className="eb in1">NDURE Labs · Lactate testing for cyclists</p>
          <h1 id="hero-t" className="h1 in2">Train at the<br /><span className="hl">right intensity.</span></h1>
          <p className="lead in3">A performance test for cyclists in our Copenhagen lab. You ride our bike, we measure your lactate, and you learn exactly how hard to train.</p>
          <div className="row in4">
            <a className="btn" href="#book">Book your session</a>
            <span className="avail" aria-live="polite">
              {firstFree ? <><span className="dot" aria-hidden="true" />First free date: {longDay(firstFree)}</> : firstFree === null ? `From ${kr(LOWEST)} a session` : null}
            </span>
          </div>
          <ul className="chips in4">
            <li>{Icon.bike}Cycling only</li>
            <li>{Icon.pin}In person at our lab in Copenhagen</li>
            <li>{Icon.info}A test, not a device: no sensor to take home</li>
          </ul>
        </div>
        <div className="pic stack g12 in3">
          <div className="photo"><img src="/img/labs-session.jpg" alt="Anna Serop runs a lactate test on a rider in the NDURE lab" width="960" height="1200" /></div>
          <p className="lac"><b>What is lactate?</b> A substance in your blood that rises as you ride harder. Where it starts to rise shows your easy, steady and hard zones.</p>
        </div>
      </div>
    </section>
  );
}

function Vision() {
  const rows: [string, string, string][] = [
    ['Week 1', 'You test on a tired day. That day becomes your plan.', 'You test and get your first zones.'],
    ['Week 6', 'You got fitter. Your zones did not.', 'Check in. New zones that match your fitness.'],
    ['Week 12', 'You train on old numbers, and progress stalls.', 'Check in. See what worked, adjust, keep going.']
  ];
  return (
    <section id="back" className="band black rv" aria-labelledby="vision-t">
      <div className="stack g56">
        <div className="split" style={{ alignItems: 'flex-end', gap: '20px 56px' }}>
          <div className="stack g16" style={{ flex: '1 1 520px' }}>
            <p className="eb w">Our vision</p>
            <h2 id="vision-t" className="h2" style={{ fontSize: 'clamp(30px, 3.6vw, 48px)', lineHeight: 1.18 }}>Other labs sell you one test.<br /><span className="hl">We sell you progress.</span></h2>
          </div>
          <div className="stack g12" style={{ flex: '1 1 340px' }}>
            <p className="p" style={{ color: '#BBB' }}>A lab test is a snapshot of one day. Build a whole plan on it and you train on old numbers for months.</p>
            <p className="p" style={{ color: '#fff' }}>We think testing should be a habit: short, affordable, every few weeks. So your training adapts as you improve.</p>
          </div>
        </div>
        <div className="cmp">
          <div className="old">
            <p className="k">THE USUAL WAY: ONE TEST</p>
            <p className="s" style={{ color: '#666' }}>How most labs in Copenhagen do it</p>
            {rows.map(([w, a]) => <div className="r" key={w}><span className="w">{w}</span><span className="t">{a}</span></div>)}
            {OTHER_LABS_PRICE > 0 && (
              <div className="r"><span className="w" style={{ paddingTop: 14 }}>Price</span>
                <span className="stack g8"><span className="strike">{kr(OTHER_LABS_PRICE)}<i aria-hidden="true" /></span><span style={{ fontSize: 15 }}>for one test</span></span>
              </div>
            )}
          </div>
          <div className="us">
            <p className="k">OUR LAB</p>
            <p className="s" style={{ color: '#BBB' }}>Built for coming back</p>
            {rows.map(([w, , b]) => <div className="r" key={w}><span className="w">{w}</span><span className="t">{b}</span></div>)}
            <div className="r last"><span className="w" style={{ paddingTop: 14 }}>Price</span>
              <span className="stack g8"><span className="big"><span data-count={LOWEST}>{LOWEST}</span> kr</span><span style={{ fontSize: 15 }}>a session with the {BIGGEST} session plan</span></span>
            </div>
            <div style={{ marginTop: 18 }}><a className="btn white" href="#book">Book now for {kr(LOWEST)} a session</a></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Process() {
  return (
    <section id="how" className="band grey rv" aria-labelledby="how-t">
      <div className="stack g32">
        <div className="row spread" style={{ alignItems: 'flex-end', gap: 16 }}>
          <div className="stack g12"><p className="eb">The process</p><h2 id="how-t" className="h2">From booking to better training.</h2></div>
          <p className="ab"><b style={{ color: '#000' }}>A</b> Today<i aria-hidden="true" /><b style={{ color: 'var(--blue)' }}>B</b> Training in your real zones</p>
        </div>
        <div className="flow">
          <div className="bar" aria-hidden="true" />
          <ol>{FLOW.map(([t, d], i) => <li key={t}><span className="n">{i + 1}</span><b>{t}</b><span className="d">{d}</span></li>)}</ol>
        </div>
      </div>
      <div className="anna split">
        <div className="txt stack g12">
          <p className="eb">Steps 3 and 4: you ride with Anna</p>
          <h2 className="h2" style={{ fontSize: 'clamp(30px, 3.4vw, 44px)' }}>Meet Anna Serop.</h2>
          <p className="p">Anna is the NDURE performance scientist. She runs every session in the lab and is an expert in lactate and cycling performance.</p>
        </div>
        <div className="photo"><img src="/img/labs-session.jpg" alt="Anna Serop in the NDURE lab" loading="lazy" width="960" height="1200" /></div>
      </div>
    </section>
  );
}

function Practical() {
  return (
    <section id="faq" className="band rv" aria-labelledby="faq-t">
      <div className="stack g56">
        <div className="kv">
          <div><span>WHERE</span><a href="https://maps.google.com/?q=Diplomvej+376,+2800+Kongens+Lyngby" target="_blank" rel="noopener noreferrer">Diplomvej 376, Kongens Lyngby (DTU)</a></div>
          <div><span>WHEN</span>Tue to Fri, daytime. About 2 hours.</div>
          <div><span>BRING</span>Shoes, pedals, kit, a bottle</div>
          <div><span>FOR</span>Any cyclist who rides regularly</div>
        </div>
        <div className="stack g16">
          <h2 id="faq-t" className="h3" style={{ fontSize: 24 }}>Questions</h2>
          <div className="faq">{FAQS.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
        </div>
      </div>
    </section>
  );
}

function Jack() {
  if (!JACK.approved) return null;
  return (
    <section id="jack" className="band black rv" aria-labelledby="jack-t">
      <div className="stack g16" style={{ maxWidth: 760 }}>
        <p className="eb w">NDURE athlete</p>
        <h2 id="jack-t" className="h2" style={{ fontSize: 'clamp(38px, 5vw, 68px)' }}>Train like {JACK.name}.</h2>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, letterSpacing: '.04em', color: '#999' }}>{JACK.fact.toUpperCase()}</p>
        <p className="p" style={{ color: '#BBB' }}>{JACK.text}</p>
        <blockquote className="quote" style={{ margin: 0 }}>“{JACK.quote}”</blockquote>
        {LINKS.jackStory && <a href={LINKS.jackStory} target="_blank" rel="noopener noreferrer" style={{ color: '#fff' }}>Watch Jack's story</a>}
      </div>
    </section>
  );
}

function Close() {
  return (
    <section className="band black rv" aria-labelledby="close-t">
      <div className="stack g24" style={{ alignItems: 'flex-start' }}>
        <h2 id="close-t" className="close-h">Stop guessing.<br /><span className="hl">Keep improving.</span></h2>
        <div className="row"><a className="btn white" href="#book">Book your session</a><span style={{ color: '#999', fontSize: 15 }}>From {kr(LOWEST)} a session</span></div>
      </div>
      <div id="contact" className="contact">
        <div className="stack g8">
          <p style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Questions first?</p>
          <p style={{ margin: 0, fontSize: 15, color: '#999' }}>Not sure which option fits you, or want to book for a group? Talk to us and we help you plan your first session.</p>
        </div>
        <div className="row">
          <a className="btn white" href={introHref} {...(LINKS.introCall ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>Book a free 15 min call</a>
          <a className="btn ghost dark" href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('NDURE Labs question')}`}>Email {CONTACT_EMAIL}</a>
        </div>
      </div>
    </section>
  );
}

// ---------------- booking ----------------
const LINK_FOR: Partial<Record<ConsentKey, [string, string]>> = {
  ready: ['/health-check', 'Read the health check'],
  health: ['/privacy', 'Privacy policy'],
  terms: ['/terms', 'Read the terms']
};

function Booking({ slots, slotError, reloadSlots }: { slots: Slot[] | null; slotError: string | null; reloadSlots: () => void }) {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const startQty = Number(params.get('qty'));
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [cfgErr, setCfgErr] = useState(false);
  const [step, setStep] = useState(PACKS.includes(startQty) ? 2 : 1);
  const [qty, setQty] = useState(PACKS.includes(startQty) ? startQty : RECOMMENDED);
  const [day, setDay] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const [f, setF] = useState({ name: '', email: '', phone: '', ftp: '', goal: 'Racing' });
  const [consents, setConsents] = useState<Partial<Record<ConsentKey, boolean>>>({});
  const [human, setHuman] = useState('');
  const [tsRound, setTsRound] = useState(0); // a bot check token works once: show a fresh one after a failed try
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(params.get('cancelled') ? { kind: 'err', text: 'Payment was cancelled. Nothing was charged. Your choices are below, so you can try again.' } : null);
  const top = useRef<HTMLDivElement>(null);

  const loadCfg = useCallback(() => {
    setCfgErr(false);
    getConfig().then(setCfg).catch(() => setCfgErr(true));
  }, []);
  useEffect(loadCfg, [loadCfg]);
  useEffect(() => { if (params.get('cancelled') || params.get('qty')) setTimeout(scrollToBook, 300); }, [params]);

  const q = quote(CFG, qty, false);
  const info = PLAN_INFO[qty];
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const d = cphDate(Date.parse(s.start));
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return [...m.entries()];
  }, [slots]);
  // Keep the chosen day and time valid when the list of free sessions changes.
  useEffect(() => {
    if (!slots) return;
    if (start && !slots.some((s) => s.start === start)) setStart(null);
    if (!day || !byDay.some(([d]) => d === day)) setDay(byDay[0]?.[0] ?? null);
  }, [slots, byDay]);
  const times = byDay.find(([d]) => d === day)?.[1] ?? [];

  const go = (n: number) => {
    setStep(n);
    setNote(null);
    requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const choose = (n: number) => {
    setQty(n);
    if (n === 1) setLater(false);
    go(2);
  };

  const missing = (cfg?.required ?? []).filter((k) => !consents[k]);
  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!start && !later) { setNote({ kind: 'err', text: 'Pick a date first.' }); go(2); return; }
    if (missing.length) { setNote({ kind: 'err', text: 'Tick all the required boxes.' }); return; }
    if (cfg?.turnstileSiteKey && !human) { setNote({ kind: 'err', text: 'Wait for the security check to finish, then try again.' }); return; }
    setBusy(true);
    setNote(null);
    try {
      const d = await api<{ url: string }>('/api/checkout', {
        qty, partner: false, start: later ? null : start, later,
        name: f.name, email: f.email, phone: f.phone, ftp: f.ftp ? Number(f.ftp) : null, goal: f.goal,
        consents, src: params.get('src') || 'web', turnstile: human
      });
      location.assign(d.url);
    } catch (e) {
      const err = e as ApiError;
      setHuman('');
      setTsRound((n) => n + 1);
      setBusy(false);
      if (err.status === 409) {
        setStart(null);
        reloadSlots();
        setStep(2);
        setNote({ kind: 'err', text: err.message || 'That time was just taken. Pick another one.' });
      } else setNote({ kind: 'err', text: err.message });
      requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  const summary = (
    <aside className="side panel sum" aria-label="Your booking">
      <p style={{ margin: 0, fontWeight: 600, fontSize: 17 }}>Your booking</p>
      <div className="ln"><span>Sessions</span><span>{info.tier}, {qty}</span></div>
      <div className="ln"><span>{qty > 1 ? 'First session' : 'Session'}</span><span style={{ textAlign: 'right' }}>{later ? 'You pick after paying' : start ? when(start) : 'Not chosen yet'}</span></div>
      <div className="ln"><span>Where</span><span>NDURE Lab, DTU Lyngby</span></div>
      <div className="ln"><span>Per session</span><span>{q.saving > 0 && <s style={{ color: '#999', marginRight: 6 }}>{kr(SINGLE)}</s>}{kr(q.unit)}</span></div>
      <div className="ln tot"><span style={{ color: '#000' }}>Total</span><span>{kr(q.total)}</span></div>
      <ul>
        <li>Move or cancel for free until 24 hours before</li>
        <li>Pay once. No subscription</li>
        <li>Valid for {CFG.validityMonths} months</li>
      </ul>
    </aside>
  );

  return (
    <section id="book" className="band tight" aria-labelledby="book-t">
      <div className="stack g24">
        <div className="stack g12" ref={top} style={{ scrollMarginTop: 88 }}>
          <p className="eb">Prices</p>
          <h2 id="book-t" className="h2">Choose your sessions.</h2>
        </div>
        <div className="book">
          <div className="steps">
            <ol aria-label="Booking steps">
              {['Sessions', 'Date', 'Details and payment'].map((s, i) => (
                <li key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}><span>{step > i + 1 ? '✓' : i + 1}</span>{s}</li>
              ))}
            </ol>
            <a href="/account" style={{ fontSize: 14 }}>Already have sessions? Log in</a>
          </div>
          <Msg note={note} />

          {step === 1 && (
            <>
              <div className="plans" role="list">
                {PACKS.map((n) => {
                  const p = PLAN_INFO[n];
                  const pq = quote(CFG, n, false);
                  const rec = n === RECOMMENDED;
                  return (
                    <div key={n} role="listitem" className={`plan${rec ? ' rec' : ''}${qty === n ? ' sel' : ''}`} onClick={() => setQty(n)}>
                      <span className="tag">{rec && <b>RECOMMENDED</b>}</span>
                      <span className="h3">{p.tier}</span>
                      <span className="m">{n === 1 ? '1 session' : `${n} sessions`}</span>
                      <span className="price"><b>{kr(pq.unit)}</b><span className="m">per session</span></span>
                      <span className="m">{n === 1 ? 'one session' : `${kr(pq.total)} in total`}</span>
                      {pq.saving > 0 && <span className="save">Save {kr(pq.saving)}</span>}
                      <span className="m" style={{ marginTop: 6 }}>{p.line}</span>
                      <ul className="inc"><p>WHAT YOU GET</p>{p.inc.map((t) => <li key={t}>{t}</li>)}</ul>
                      <button type="button" className="btn" onClick={(e) => { e.stopPropagation(); choose(n); }}>Choose {p.tier}</button>
                    </div>
                  );
                })}
              </div>
              <p className="note-s">We suggest a session every 8 weeks. Packs are valid for {CFG.validityMonths} months: book the rest whenever you want.</p>
            </>
          )}

          {step === 2 && (
            <div className="cols">
              <div className="main panel stack g16">
                <div className="row spread"><p className="h3" style={{ margin: 0 }}>{qty > 1 ? 'Pick your first session' : 'Pick your session'}</p><span className="muted small">Tue to Fri · book at least 1 week ahead</span></div>
                {slotError ? (
                  <div className="stack g12"><Msg note={{ kind: 'err', text: slotError }} /><button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={reloadSlots}>Try again</button></div>
                ) : !slots ? (
                  <p className="muted" aria-live="polite">Loading free sessions…</p>
                ) : slots.length === 0 ? (
                  <Msg note={{ kind: 'err', text: `No free sessions in the coming weeks. Email ${CONTACT_EMAIL} and we find a time.` }} />
                ) : (
                  <>
                    <div className="days" role="group" aria-label="Day">
                      {byDay.map(([d, list]) => (
                        <button type="button" key={d} className="day" aria-pressed={day === d && !later} aria-label={longDay(list[0].start)} onClick={() => { setDay(d); setLater(false); }}>
                          <small>{dayName(list[0].start)}</small><b>{dayNum(list[0].start)}</b><small>{monthShort(list[0].start)}</small>
                        </button>
                      ))}
                    </div>
                    {!later && day && (
                      <div className="times" role="group" aria-label="Time">
                        {times.map((s) => (
                          <button type="button" key={s.start} className="time" aria-pressed={start === s.start} onClick={() => setStart(s.start)}>
                            <b>{clock(s.start)} {s.label}</b>
                            <small>{longDay(s.start)} · {s.free === 1 ? 'last spot' : `${s.free} spots left`}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {qty > 1 && (
                  <button type="button" className="later" aria-pressed={later} onClick={() => { setLater(!later); setStart(null); }}>
                    <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden="true">{later ? '✓' : '○'}</span>
                    <span><b>Choose dates later</b><br /><span className="muted small">Pay now and book every session from your account.</span></span>
                  </button>
                )}
                <div className="row">
                  <button type="button" className="btn ghost sm" onClick={() => go(1)}>Change sessions</button>
                  <button type="button" className="btn sm" disabled={!start && !later} onClick={() => go(3)}>Next: your details</button>
                </div>
              </div>
              {summary}
            </div>
          )}

          {step === 3 && (
            <div className="cols">
              <form className="main panel stack g24" onSubmit={pay} noValidate={false}>
                <p className="h3" style={{ margin: 0 }}>Your details</p>
                <div className="fields">
                  <label className="fld">Full name<input required maxLength={80} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
                  <label className="fld">Email<input required maxLength={254} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
                  <label className="fld">Phone<input maxLength={30} type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /><small>So we can reach you on the day</small></label>
                  <label className="fld">FTP in watts<input inputMode="numeric" pattern="[0-9]{0,4}" maxLength={4} value={f.ftp} onChange={(e) => setF({ ...f, ftp: e.target.value.replace(/\D/g, '') })} /><small>Optional. Helps Anna plan your test</small></label>
                  <label className="fld">Your goal
                    <select value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })}>
                      <option>Racing</option><option>Long rides</option><option>Getting fitter</option><option>Something else</option>
                    </select>
                  </label>
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
                  <button type="button" className="btn ghost sm" onClick={() => go(2)}>Change date</button>
                  <button type="submit" className="btn" disabled={busy || !cfg}>{busy ? 'Opening payment…' : `Pay ${kr(q.total)}`}</button>
                </div>
                <p className="muted small" style={{ margin: 0 }}>Secure payment by Stripe: card, Apple Pay or Google Pay. If you picked a time, we hold it for you while you pay.</p>
              </form>
              {summary}
            </div>
          )}
        </div>
        <p className="note-s" style={{ textAlign: 'center' }}>Team or club? <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Team pricing, NDURE Labs')}`}>Email {CONTACT_EMAIL}</a> for team pricing. Questions first? <a href={introHref}>Book a free 15 minute call</a>.</p>
      </div>
    </section>
  );
}

// ---------------- the page ----------------
export function Landing() {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const loadSlots = useCallback(() => {
    setSlotError(null);
    setSlots(null);
    api<{ slots: Slot[] }>('/api/slots?need=1').then((d) => setSlots(d.slots)).catch((e) => setSlotError((e as Error).message));
  }, []);
  useEffect(loadSlots, [loadSlots]);
  useReveal();
  const firstFree = slotError ? null : slots === null ? undefined : slots[0]?.start ?? null;
  return (
    <>
      <a className="skip" href="#book">Skip to booking</a>
      <Header home />
      <main>
        <Hero firstFree={firstFree} />
        <Vision />
        <Booking slots={slots} slotError={slotError} reloadSlots={loadSlots} />
        <Process />
        <Practical />
        <Jack />
        <Close />
      </main>
      <Footer />
    </>
  );
}
