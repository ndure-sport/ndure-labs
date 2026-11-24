// The NDURE Labs page (design: version 1 on the review board) with the real booking flow built in.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { quote, type Slot } from '../core/engine';
import { DEFAULT_CONFIG, noticeText } from '../core/config';
import type { ConsentKey } from '../core/types';
import { MonthPicker } from './picker';
import { api, ApiError, getConfig, Msg, Turnstile, Header, Footer, type Note, type PublicConfig } from './shared';
import { useT } from './i18n';
import { CONTACT_EMAIL, LINKS, PLAN_INFO, PLAN_INFO_DA, RECOMMENDED, PLAN_ORDER, FLOW, FAQS, FLOW_DA, FAQS_DA } from './content';

const CFG = DEFAULT_CONFIG;
const PACKS = PLAN_ORDER.filter((n) => CFG.packs.includes(n));
const unitFor = (n: number) => quote(CFG, n, false).unit;
const LOWEST = Math.min(...PACKS.map(unitFor));
const SINGLE = unitFor(1);


const bookHref = (n: number) => {
  const src = new URLSearchParams(location.search).get('src');
  return `/book?qty=${n}${src ? `&src=${encodeURIComponent(src)}` : ''}`;
};

// ---------------- sections (design: version 1), English and Danish ----------------
function Hero() {
  const { t, kr } = useT();
  return (
    <section className="v-hero" aria-labelledby="hero-t">
      <img className="v-hero-img" src="/img/hero-sensor.jpg" alt={t("The NDURE lactate sensor strapped to a rider's upper arm during a test", 'NDURE laktatsensoren spændt fast på en rytters overarm under en test')} width="1000" height="1777" />
      <div className="v-hero-in">
        <span className="v-tag dark">NDURE Labs · {t('Copenhagen', 'København')}</span>
        <h1 id="hero-t" className="v-h1"><span className="bl">{t('Lactate testing for cyclists.', 'Laktattest for cykelryttere.')}</span><span className="bl">{t('Come back every month.', 'Kom igen hver måned.')}</span></h1>
        <ul className="v-chips">
          <li>{t('Cycling only', 'Kun cykling')}</li>
          <li>{t('In person, in our lab in Copenhagen', 'Personligt, i vores lab i København')}</li>
          <li>{t('A test, not a device: no sensor to take home', 'En test, ikke et produkt: ingen sensor med hjem')}</li>
        </ul>
        <div className="v-hero-foot">
          <p>{t('Know exactly how hard to train. Two hours in our lab gives you your LT1, LT2 and training zones, and every visit keeps them up to date as you get fitter.', 'Vid præcis, hvor hårdt du skal træne. To timer i vores lab giver dig dine LT1, LT2 og træningszoner, og hvert besøg holder dem opdateret, når du kommer i bedre form.')}</p>
          <div className="v-hero-cta">
            <span>{t('From', 'Fra')} <b>{kr(LOWEST)}</b> {t('a session', 'pr. session')}</span>
            <a className="v-btn white lg" href="#price">{t('Book your session', 'Book din session')}</a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Why() {
  const { t, kr, eur } = useT();
  return (
    <section id="why" className="v-sec" aria-labelledby="why-t">
      <span className="v-tag">{t('Why come back', 'Hvorfor komme igen')}</span>
      <h2 id="why-t" className="v-h2"><span className="bl">{t('Other labs sell you one test.', 'Andre labs sælger dig én test.')}</span><span className="bl">{t('We made coming back cheaper.', 'Vi har gjort det billigere at komme igen.')}</span></h2>
      <div className="v-why">
        <div className="v-card grey">
          <span className="v-k">{t('1 · Better data', '1 · Bedre data')}</span>
          <b className="v-big">{t('Our sensor measures your lactate continuously.', 'Vores sensor måler din laktat kontinuerligt.')}</b>
          <span className="v-s">{t('Not just a few drops of blood. You see the whole curve, so your LT1 and LT2 are more precise.', 'Ikke kun et par dråber blod. Du ser hele kurven, så dine LT1 og LT2 bliver mere præcise.')}</span>
        </div>
        <div className="v-card black">
          <span className="v-k">{t('2 · Continuous improvement', '2 · Løbende forbedring')}</span>
          <div>
            <span className="v-lbl">NDURE Labs</span>
            <span className="v-num">{kr(LOWEST)}</span>
            <span className="v-lbl">{t('a session, every few weeks', 'pr. session, med få ugers mellemrum')} · {eur(LOWEST)}</span>
          </div>
          <p className="v-line">{t('Your zones keep moving as you get fitter. So we made it affordable to measure your lactate every few weeks.', 'Dine zoner flytter sig, når du kommer i bedre form. Derfor har vi gjort det overkommeligt at måle din laktat med få ugers mellemrum.')}</p>
        </div>
      </div>
    </section>
  );
}

const SKIN: Record<number, string> = { 1: 'white', 3: 'black', 6: 'cream' };

function Prices() {
  const { t, da, kr, eur } = useT();
  return (
    <section id="price" className="v-sec grey" aria-labelledby="price-t">
      <div className="v-price-head">
        <div>
          <span className="v-tag white">{t('Prices', 'Priser')}</span>
          <h2 id="price-t" className="v-h2"><span className="bl">{t('Pick your program.', 'Vælg dit forløb.')}</span><span className="bl">{t('Come back whenever you want.', 'Kom igen, når det passer dig.')}</span></h2>
        </div>
        <ul className="v-perks"><li>✓&nbsp; {t(`Valid ${CFG.validityMonths} months`, `Gyldig i ${CFG.validityMonths} måneder`)}</li><li>✓&nbsp; {t('Pay once', 'Betal én gang')}</li><li>✓&nbsp; {t('No subscription', 'Intet abonnement')}</li></ul>
      </div>
      <div className="v-plans">
        {PACKS.map((n) => {
          const p = PLAN_INFO[n];
          const pd = PLAN_INFO_DA[n];
          const q = quote(CFG, n, false);
          const singles = n * quote(CFG, 1, false).unit;
          const save = singles - q.total;
          const pct = Math.round((save / singles) * 100);
          const sessions = n === 1 ? '1 session' : t(`${n} sessions`, `${n} sessioner`);
          return (
            <div key={n} className={`v-plan ${SKIN[n] ?? 'white'}`}>
              <span className="v-ptags"><span className="v-ptag">{da ? pd.tag : p.tag}</span>{save > 0 && <span className="v-save">{t('Save', 'Spar')} {kr(save)}</span>}</span>
              <b className="v-pname">{p.tier}</b>
              <span className="v-ptot">{kr(q.total)} <span>{t('total', 'i alt')} · {sessions}</span></span>
              {save > 0 && <span className="v-pless">{t(`${pct}% less than ${n} single sessions`, `${pct}% billigere end ${n} enkeltsessioner`)}</span>}
              <span className="v-pprice">{kr(q.unit)}</span>
              <span className="v-pm">{n === 1 ? t('for one session', 'for én session') : t('per session', 'pr. session')} · {eur(q.unit)}</span>
              <ul>
                {(da ? pd.inc : p.inc).map((x) => <li key={x}><span aria-hidden="true">✓</span>{x}</li>)}
                {((da ? pd.not : p.not) ?? []).map((x) => <li key={x} className="no"><span aria-hidden="true">✕</span>{x}</li>)}
              </ul>
              <a className="v-pbtn" href={bookHref(n)}>{t('Choose', 'Vælg')} {p.tier}</a>
            </div>
          );
        })}
      </div>
      <p className="v-note">{t('Already have sessions?', 'Har du allerede sessioner?')} <a href="/account">{t('Log in', 'Log ind')}</a>. {t('Team or club?', 'Hold eller klub?')} <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Team pricing, NDURE Labs')}`}>{t('Email', 'Skriv til')} {CONTACT_EMAIL}</a>.</p>
    </section>
  );
}

function Session() {
  const { t, da } = useT();
  return (
    <section id="session" className="v-sec" aria-labelledby="session-t">
      <span className="v-tag">{t('The session', 'Sessionen')}</span>
      <h2 id="session-t" className="v-h2">{t('How NDURE Labs works.', 'Sådan foregår NDURE Labs.')}</h2>
      <ol className="v-steps">
        {(da ? FLOW_DA : FLOW).map(([x, d], i) => (
          <li key={x}><span className="v-n">{String(i + 1).padStart(2, '0')}</span><b>{x}</b><span>{d}</span></li>
        ))}
      </ol>
    </section>
  );
}

function Anna() {
  const { t } = useT();
  return (
    <section className="v-sec black tall" aria-labelledby="anna-t">
      <div className="v-anna">
        <div className="v-video">
          <img src="/img/anna-fit.jpg" alt={LINKS.annaVideo ? '' : t('Anna fits the NDURE lactate sensor on a rider', 'Anna sætter NDURE laktatsensoren på en rytter')} aria-hidden={LINKS.annaVideo ? true : undefined} loading="lazy" width="1000" height="1777" />
          {LINKS.annaVideo && (
            <a className="v-play" href={LINKS.annaVideo} target="_blank" rel="noopener noreferrer" aria-label={t('Watch Anna explain NDURE Labs', 'Se Anna forklare NDURE Labs')}>
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="#000" /></svg>
            </a>
          )}
        </div>
        <div className="v-anna-txt">
          <span className="v-tag dark">{t('Your tester', 'Din tester')}</span>
          <h2 id="anna-t" className="v-h3">{t('Meet our Performance Physiologist, Anna Serop.', 'Mød vores performancefysiolog, Anna Serop.')}</h2>
          <p>{t('Anna is the NDURE performance physiologist. She runs every session in the lab, sets you up on the bike and the sensor, and takes you through your report so you know how to train.', 'Anna er NDUREs performancefysiolog. Hun står for hver session i laboratoriet, sætter dig op på cyklen og sensoren og gennemgår din rapport med dig, så du ved, hvordan du skal træne.')}</p>
          <p>{t('When you come back, you see her again. She knows your history and what changed since last time.', 'Når du kommer igen, ser du hende igen. Hun kender din historik og ved, hvad der har ændret sig siden sidst.')}</p>
          <a className="v-btn white" href="#price">{t('Book a session with Anna', 'Book en session med Anna')}</a>
        </div>
      </div>
    </section>
  );
}

function Lactate() {
  const { t } = useT();
  return (
    <section className="v-sec tall" aria-labelledby="lac-t">
      <span className="v-tag">{t('Good to know', 'Godt at vide')}</span>
      <h2 id="lac-t" className="v-h3 big">{t('Lactate, LT1 and LT2.', 'Laktat, LT1 og LT2.')}</h2>
      <div className="v-lac">
        <div className="v-card grey sm wide"><b>{t('What is lactate?', 'Hvad er laktat?')}</b><span>{t('A substance your muscles make when you work. The harder you ride, the more of it ends up in your blood. How it rises tells us how your body handles effort.', 'Et stof, dine muskler danner, når de arbejder. Jo hårdere du kører, jo mere ender i dit blod. Måden, det stiger på, fortæller os, hvordan din krop håndterer belastning.')}</span></div>
        <div className="v-card line sm"><b>LT1</b><span>{t('Where lactate first starts to rise. Below it is your easy, all day endurance riding.', 'Hvor laktaten først begynder at stige. Under den ligger din rolige udholdenhedskørsel, som du kan holde hele dagen.')}</span></div>
        <div className="v-card black sm"><b>LT2</b><span>{t('Where lactate shoots up. Roughly the hardest pace you can hold for a long effort.', 'Hvor laktaten stiger kraftigt. Cirka det hårdeste tempo, du kan holde i en lang indsats.')}</span></div>
      </div>
    </section>
  );
}

function Faq() {
  const { t, da } = useT();
  return (
    <section id="faq" className="v-sec flush" aria-labelledby="faq-t">
      <div className="v-faq">
        <div>
          <span className="v-tag">FAQ</span>
          <h2 id="faq-t" className="v-h3 big">{t('Questions.', 'Spørgsmål.')}</h2>
          <p className="v-s" style={{ marginTop: 12 }}>{t('Something else?', 'Noget andet?')} <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
        </div>
        <div className="v-qs">{(da ? FAQS_DA : FAQS).map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
      </div>
    </section>
  );
}

function SiteFooter() {
  const { t } = useT();
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
          <p className="v-foot-h"><span className="bl">{t('Built by athletes,', 'Bygget af atleter,')}</span><span className="bl">{t('for athletes.', 'for atleter.')}</span></p>
          <p className="v-foot-p">{t('Lactate testing for cyclists at our lab in Lyngby. Continuous and blood lactate, a performance report with your LT1, LT2 and zones, and new zones every time you come back.', 'Laktattest for cykelryttere i vores lab i Lyngby. Kontinuerlig laktat og blodlaktat, en performancerapport med dine LT1, LT2 og zoner, og nye zoner hver gang du kommer igen.')}</p>
          <p className="v-foot-d">{t('NDURE Labs is a sports performance test for adults 18+. It is not a medical examination and is not intended to diagnose, prevent, monitor or treat any disease, injury or medical condition.', 'NDURE Labs er en sportspræstationstest for voksne over 18 år. Det er ikke en medicinsk undersøgelse og er ikke beregnet til at diagnosticere, forebygge, overvåge eller behandle sygdom, skade eller medicinske tilstande.')}</p>
          <a className="v-btn white" href="#price">{t('Book a session', 'Book en session')}</a>
          {social.some(([u]) => u) && <div className="v-social">{social.filter(([u]) => u).map(([u, l, i]) => <a key={l} href={u} aria-label={l} {...ext}>{i}</a>)}</div>}
        </div>
        <nav aria-label="Footer" className="v-foot-nav">
          {LINKS.home && <a href={LINKS.home}>{t('Home', 'Hjem')}</a>}
          {LINKS.ambassador && <a href={LINKS.ambassador} {...ext}>{t('Become an Ambassador', 'Bliv ambassadør')}</a>}
          {LINKS.careers && <a href={LINKS.careers} {...ext}>{t('Careers', 'Karriere')}</a>}
          <a href="/privacy">{t('Privacy Policy', 'Privatlivspolitik (engelsk)')}</a>
          <a href="/terms">{t('Terms and Conditions', 'Vilkår og betingelser (engelsk)')}</a>
          <a href="/health-check">{t('Health check', 'Helbredstjek (engelsk)')}</a>
        </nav>
      </div>
      <div className="v-foot-bot"><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a><span>NDURE ApS · CVR: 45530701<br />Diplomvej 376,<br />2800 Kongens Lyngby</span></div>
    </footer>
  );
}

// ---------------- booking ----------------
const LINK_FOR: Partial<Record<ConsentKey, [string, string, string]>> = {
  ready: ['/health-check', 'Read the health check', 'Læs helbredstjekket (engelsk)'],
  health: ['/privacy', 'Privacy policy', 'Privatlivspolitik (engelsk)'],
  terms: ['/terms', 'Read the terms', 'Læs vilkårene (engelsk)']
};

// The three packs. On the Labs page "Choose" opens the booking page; on the booking page it goes to the date.
function Plans({ qty, onPick, onChoose }: { qty: number; onPick: (n: number) => void; onChoose: (n: number) => void }) {
  const { t, da, kr } = useT();
  return (
    <>
      <div className="plans" role="list">
        {PACKS.map((n) => {
          const p = PLAN_INFO[n];
          const pq = quote(CFG, n, false);
          const rec = n === RECOMMENDED;
          return (
            <div key={n} role="listitem" className={`plan${rec ? ' rec' : ''}${qty === n ? ' sel' : ''}`} onClick={() => onPick(n)}>
              <span className="tag">{rec && <b>{t('RECOMMENDED', 'ANBEFALET')}</b>}</span>
              <span className="h3">{p.tier}</span>
              <span className="m">{n === 1 ? '1 session' : t(`${n} sessions`, `${n} sessioner`)}</span>
              <span className="price"><b>{kr(pq.unit)}</b><span className="m">{t('per session', 'pr. session')}</span></span>
              <span className="m">{n === 1 ? t('one session', 'én session') : t(`${kr(pq.total)} in total`, `${kr(pq.total)} i alt`)}</span>
              {pq.saving > 0 && <span className="save">{t('Save', 'Spar')} {kr(pq.saving)}</span>}
              <span className="m" style={{ marginTop: 6 }}>{da ? PLAN_INFO_DA[n].line : p.line}</span>
              <ul className="inc"><p>{t('WHAT YOU GET', 'DET FÅR DU')}</p>{(da ? PLAN_INFO_DA[n].inc : p.inc).map((x) => <li key={x}>{x}</li>)}</ul>
              <button type="button" className="btn" onClick={(e) => { e.stopPropagation(); onChoose(n); }}>{t('Choose', 'Vælg')} {p.tier}</button>
            </div>
          );
        })}
      </div>
      <p className="note-s">{t(`We suggest a session every 8 weeks. Packs are valid for ${CFG.validityMonths} months: book the rest whenever you want.`, `Vi anbefaler en session hver 8. uge. Pakkerne er gyldige i ${CFG.validityMonths} måneder: book resten, når det passer dig.`)}</p>
    </>
  );
}


function Booking({ slots, slotError, reloadSlots }: { slots: Slot[] | null; slotError: string | null; reloadSlots: () => void }) {
  const { t, da, kr, longDay, clock, when } = useT();
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
  const [note, setNote] = useState<Note>(params.get('cancelled') ? { kind: 'err', text: t('Payment was cancelled. Nothing was charged. Pick a time again to try again.', 'Betalingen blev annulleret. Der blev ikke trukket noget. Vælg en tid igen for at prøve igen.') } : null);

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
    if (!start) { setNote({ kind: 'err', text: t('Pick a date first.', 'Vælg først en dato.') }); go(2); return; }
    if (missing.length) { setNote({ kind: 'err', text: t('Tick all the required boxes.', 'Sæt kryds i alle de påkrævede felter.') }); return; }
    if (cfg?.turnstileSiteKey && !human) { setNote({ kind: 'err', text: t('Wait for the security check to finish, then try again.', 'Vent på, at sikkerhedstjekket er færdigt, og prøv igen.') }); return; }
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
        setNote({ kind: 'err', text: lost ? t(`Sorry, ${clock(lost)} on ${longDay(lost)} was just taken by someone else. Nothing was charged. Pick another time.`, `Beklager, ${clock(lost)} ${longDay(lost)} blev lige taget af en anden. Der blev ikke trukket noget. Vælg en anden tid.`) : err.message });
      } else setNote({ kind: 'err', text: err.message });
      window.scrollTo(0, 0);
    }
  }

  const summary = (
    <aside className="side panel sum" aria-label={t('Your booking', 'Din booking')}>
      <p style={{ margin: 0, fontWeight: 600, fontSize: 17 }}>{t('Your booking', 'Din booking')}</p>
      <div className="sumqty"><b>{qty}</b><span><b>{qty === 1 ? t('lab session', 'labsession') : t('lab sessions', 'labsessioner')}</b><small>{t(`${info.tier} pack`, `${info.tier}-pakke`)} · {qty === 1 ? t('1 test, 1 report', '1 test, 1 rapport') : t(`${qty} tests, ${qty} reports`, `${qty} tests, ${qty} rapporter`)}</small></span></div>
      <div className="ln"><span>{qty > 1 ? 'Session 1' : 'Session'}</span><span style={{ textAlign: 'right' }}>{start ? when(start) : t('Not chosen yet', 'Ikke valgt endnu')}</span></div>
      {qty > 1 && <div className="ln"><span style={{ whiteSpace: 'nowrap' }}>{qty === 2 ? 'Session 2' : t(`Sessions 2 to ${qty}`, `Session 2 til ${qty}`)}</span><span style={{ textAlign: 'right' }}>{t('Book later in your account', 'Book senere på din konto')}</span></div>}
      <div className="ln"><span>{t('Where', 'Hvor')}</span><span style={{ textAlign: 'right' }}>{t('DTU Science Park reception', 'DTU Science Park, receptionen')}<br />Diplomvej 381, Kongens Lyngby</span></div>
      <div className="ln"><span>{t('Price', 'Pris')}</span><span>{qty > 1 && `${qty} × `}{q.saving > 0 && <s style={{ color: '#999', margin: '0 4px' }}>{kr(SINGLE)}</s>}{kr(q.unit)}</span></div>
      <div className="ln tot"><span style={{ color: '#000' }}>{qty > 1 ? t(`Total for ${qty} sessions`, `I alt for ${qty} sessioner`) : t('Total', 'I alt')}</span><span>{kr(q.total)}</span></div>
      {q.saving > 0 && <p className="small" style={{ margin: '-4px 0 0', color: 'var(--blue)', fontWeight: 600, textAlign: 'right' }}>{t('You save', 'Du sparer')} {kr(q.saving)}</p>}
      {(() => {
        const up = PACKS.find((n) => n > qty);
        if (!up) return null;
        const uq = quote(CFG, up, false);
        return (
          <button type="button" className="upsell" onClick={() => { setQty(up); const u = new URLSearchParams(location.search); u.set('qty', String(up)); history.replaceState(null, '', `/book?${u}`); }}>
            <b>{t(`Upgrade to ${PLAN_INFO[up].tier}: ${up} sessions at ${kr(uq.unit)} each`, `Opgrader til ${PLAN_INFO[up].tier}: ${up} sessioner til ${kr(uq.unit)} pr. stk.`)}</b>
            <span>{t(`${kr(uq.total)} in total, ${kr(uq.total - q.total)} more. Same first date, book the rest later.`, `${kr(uq.total)} i alt, ${kr(uq.total - q.total)} mere. Samme første dato, book resten senere.`)}</span>
          </button>
        );
      })()}
      <ul>
        <li>{t('Move or cancel for free until 24 hours before', 'Flyt eller aflys gratis indtil 24 timer før')}</li>
        <li>{t('Pay once. No subscription', 'Betal én gang. Intet abonnement')}</li>
        <li>{t(`Valid for ${CFG.validityMonths} months`, `Gyldig i ${CFG.validityMonths} måneder`)}</li>
      </ul>
    </aside>
  );

  return (
    <section className="band tight bookpage" aria-labelledby="book-t">
      <div className="stack g24">
        <h1 id="book-t" className="sr">{step === 1 ? t('Choose your sessions', 'Vælg dine sessioner') : step === 2 ? t('Pick a date', 'Vælg en dato') : t('Your details', 'Dine oplysninger')}</h1>
        <div className="book">
          <div className="steps">
            <ol aria-label={t('Booking steps', 'Trin i bookingen')}>
              {(da ? ['Sessioner', 'Dato', 'Oplysninger og betaling'] : ['Sessions', 'Date', 'Details and payment']).map((s, i) => {
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
            <a href="/account" style={{ fontSize: 14 }}>{t('Already have sessions? Log in', 'Har du allerede sessioner? Log ind')}</a>
          </div>
          <Msg note={note} />

          {step === 1 && <Plans qty={qty} onPick={setQty} onChoose={choose} />}

          {step === 2 && (
            <div className="cols">
              <div className="main panel stack g16">
                <div className="row spread"><p className="h3" style={{ margin: 0 }}>{qty > 1 ? t('Pick your first session', 'Vælg din første session') : t('Pick your session', 'Vælg din session')}</p><span className="muted small">{t('Tue to Thu', 'Tirs til tors')}{noticeText(DEFAULT_CONFIG) && (da ? ` · book mindst ${noticeText(DEFAULT_CONFIG, true)} før` : ` · book at least ${noticeText(DEFAULT_CONFIG)} ahead`)}</span></div>
                {qty > 1 && <p className="muted small" style={{ margin: 0 }}>{t(`Your other ${qty - 1} sessions you book later from your account, whenever it suits you.`, `Dine øvrige ${qty - 1} sessioner booker du senere fra din konto, når det passer dig.`)}</p>}
                {slotError ? (
                  <div className="stack g12"><Msg note={{ kind: 'err', text: slotError }} /><button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={reloadSlots}>{t('Try again', 'Prøv igen')}</button></div>
                ) : !slots ? (
                  <p className="muted" aria-live="polite">{t('Loading free sessions…', 'Henter ledige sessioner…')}</p>
                ) : slots.length === 0 ? (
                  <div className="soldout"><p><b>{t('No free sessions in the coming weeks', 'Ingen ledige sessioner de kommende uger')}</b></p><p className="muted">{t("We're fully booked right now. Email us and we find a time for you, or check back soon: new dates open every week.", 'Vi er fuldt booket lige nu. Skriv til os, så finder vi en tid til dig, eller kig forbi snart: nye datoer åbner hver uge.')}</p><a className="btn sm" href={`mailto:${CONTACT_EMAIL}`}>{t('Email', 'Skriv til')} {CONTACT_EMAIL}</a></div>
                ) : (
                  <MonthPicker slots={slots} value={start} onChange={setStart} compact lang={da ? 'da' : 'en'} />
                )}
                <div className="row">
                  <button type="button" className="btn ghost sm" onClick={() => go(1)}>‹ {t('Back', 'Tilbage')}</button>
                  <button type="button" className="btn sm" disabled={!start} onClick={() => go(3)}>{t('Next: your details', 'Næste: dine oplysninger')}</button>
                </div>
              </div>
              {summary}
            </div>
          )}

          {step === 3 && (
            <div className="cols">
              <form className="main panel stack g24" onSubmit={pay} noValidate={false}>
                <div className="fields">
                  <label className="fld">{t('Full name', 'Fulde navn')}<input required maxLength={80} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
                  <label className="fld">{t('Email', 'E-mail')}<input required maxLength={254} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
                  <label className="fld">{t('Phone', 'Telefon')}<input maxLength={30} type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /><small>{t('So we can reach you on the day', 'Så vi kan fange dig på dagen')}</small></label>
                </div>
                {cfgErr && <div className="stack g8"><Msg note={{ kind: 'err', text: t('Could not load the consent texts.', 'Kunne ikke hente samtykketeksterne.') }} /><button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={loadCfg}>{t('Try again', 'Prøv igen')}</button></div>}
                {cfg && (
                  <fieldset className="checks">
                    <legend>{t('Before you pay', 'Før du betaler')}</legend>
                    {(Object.keys(cfg.consents) as ConsentKey[]).map((k) => {
                      const req = cfg.required.includes(k);
                      const link = LINK_FOR[k];
                      return (
                        <label key={k} className="chk">
                          <input type="checkbox" checked={!!consents[k]} onChange={() => setConsents({ ...consents, [k]: !consents[k] })} />
                          <span>{cfg.consents[k].replace(/^Optional: /, '')}{link && <> <a href={link[0]} target="_blank" rel="noopener noreferrer">{da ? link[2] : link[1]}</a></>}<em>{req ? t('Required', 'Påkrævet') : t('Optional', 'Valgfrit')}</em></span>
                        </label>
                      );
                    })}
                  </fieldset>
                )}
                <Turnstile key={tsRound} siteKey={cfg?.turnstileSiteKey ?? null} onToken={setHuman} />
                <div className="row">
                  <button type="button" className="btn ghost sm" onClick={() => go(2)}>‹ Back</button>
                  <button type="submit" className="btn" disabled={busy || !cfg}>{busy ? t('Opening payment…', 'Åbner betaling…') : `${t('Pay', 'Betal')} ${kr(q.total)}`}</button>
                </div>
                <p className="muted small" style={{ margin: 0 }}>{t('Secure payment by Stripe: card, Apple Pay or Google Pay. We hold your time while you pay.', 'Sikker betaling via Stripe: kort, Apple Pay eller Google Pay. Vi holder din tid, mens du betaler.')}</p>
              </form>
              {summary}
            </div>
          )}
        </div>
        <p className="note-s" style={{ textAlign: 'center' }}>{t('Team or club?', 'Hold eller klub?')} <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Team pricing, NDURE Labs')}`}>{t('Email', 'Skriv til')} {CONTACT_EMAIL}</a> {t('for team pricing.', 'for holdpriser.')}</p>
      </div>
    </section>
  );
}

// ---------------- the page ----------------
export function Landing() {
  const { t, lang } = useT();
  useEffect(() => { document.title = t('NDURE Labs · Lactate testing for cyclists in Copenhagen', 'NDURE Labs · Laktattest for cykelryttere i København'); document.documentElement.lang = lang; }, [lang]);
  return (
    <>
      <a className="skip" href="#price">{t('Skip to prices', 'Spring til priser')}</a>
      <Header home lang />
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
  const { t, lang } = useT();
  useEffect(() => { document.title = t('Book, NDURE Labs', 'Book, NDURE Labs'); document.documentElement.lang = lang; }, [lang]);
  return (
    <>
      <Header lang />
      <main><Booking slots={slots} slotError={slotError} reloadSlots={loadSlots} /></main>
      <Footer />
    </>
  );
}
