// The NDURE Labs page (design N1) with the real booking flow built in.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { quote, type Slot } from '../core/engine';
import { DEFAULT_CONFIG, noticeText } from '../core/config';
import { fmt, when, cphDate } from '../core/time';
import type { ConsentKey } from '../core/types';
import { MonthPicker } from './picker';
import { MEET_SHORT, MEET_MAPS, BRING_LINE } from '../core/visit';
import { api, ApiError, getConfig, kr, Msg, Turnstile, Header, Footer, type Note, type PublicConfig } from './shared';
import { CONTACT_EMAIL, LINKS, OTHER_LABS_PRICE, JACK, PLAN_INFO, RECOMMENDED, PLAN_ORDER, FLOW, FAQS } from './content';

const CFG = DEFAULT_CONFIG;
const PACKS = PLAN_ORDER.filter((n) => CFG.packs.includes(n));
const unitFor = (n: number) => quote(CFG, n, false).unit;
const LOWEST = Math.min(...PACKS.map(unitFor));
const BIGGEST = Math.max(...PACKS);
const SINGLE = unitFor(1);
const introHref = LINKS.introCall || `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Free 15 min call about NDURE Labs')}`;
const longDay = (iso: string) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' });
const clock = (iso: string) => fmt(iso, { hour: '2-digit', minute: '2-digit' });


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
          <div><span>WHERE</span><a href={MEET_MAPS} target="_blank" rel="noopener noreferrer">{MEET_SHORT}, Kongens Lyngby</a></div>
          <div><span>WHEN</span>Tue to Fri, daytime. About 2 hours.</div>
          <div><span>BRING</span>{BRING_LINE}</div>
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

const bookHref = (n: number) => {
  const src = new URLSearchParams(location.search).get('src');
  return `/book?qty=${n}${src ? `&src=${encodeURIComponent(src)}` : ''}`;
};

// Prices on the Labs page: the packs, each opens the booking page.
function Prices() {
  const [qty, setQty] = useState(RECOMMENDED);
  return (
    <section id="book" className="band tight" aria-labelledby="book-t">
      <div className="stack g24">
        <div className="stack g12">
          <p className="eb">Prices</p>
          <h2 id="book-t" className="h2">Choose your sessions.</h2>
        </div>
        <div className="book">
          <div className="steps">
            <span />
            <a href="/account" style={{ fontSize: 14 }}>Already have sessions? Log in</a>
          </div>
          <Plans qty={qty} onPick={setQty} onChoose={(n) => location.assign(bookHref(n))} />
        </div>
        <p className="note-s" style={{ textAlign: 'center' }}>Team or club? <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Team pricing, NDURE Labs')}`}>Email {CONTACT_EMAIL}</a> for team pricing. Questions first? <a href={introHref}>Book a free 15 minute call</a>.</p>
      </div>
    </section>
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
                <div className="row spread"><p className="h3" style={{ margin: 0 }}>{qty > 1 ? 'Pick your first session' : 'Pick your session'}</p><span className="muted small">Tue to Fri{noticeText(DEFAULT_CONFIG) && ` · book at least ${noticeText(DEFAULT_CONFIG)} ahead`}</span></div>
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
        <Prices />
        <Process />
        <Practical />
        <Jack />
        <Close />
      </main>
      <Footer />
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
