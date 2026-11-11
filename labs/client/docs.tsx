// Terms, privacy and the health check. FIRST VERSIONS: have them checked before launch.

import { DEFAULT_CONFIG as CFG } from '../core/config';
import { CONTACT_EMAIL } from './content';
import { Header, Footer, kr } from './shared';

const UPDATED = '4 November 2026';

function Doc({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="page doc">
        <h1>{title}</h1>
        <p className="muted small">Last updated {UPDATED}</p>
        {children}
      </main>
      <Footer />
    </>
  );
}

export function Terms() {
  const prices = CFG.tiers.map((t) => `${t.min} ${t.min === 1 ? 'session' : 'sessions'}: ${kr(t.unit)} each`).join(', ');
  return (
    <Doc title="Terms">
      <p>These terms cover NDURE Labs sessions sold by NDURE ApS, CVR 45530701, Diplomvej 376, 2800 Kongens Lyngby, Denmark ({CONTACT_EMAIL}).</p>
      <h2>The session</h2>
      <p>A session is an in person lactate test on a bike in our lab in Kongens Lyngby. It takes about 2 hours. You get a written performance report within 48 hours. No sensor or device is sold or included.</p>
      <h2>Prices and payment</h2>
      <p>Prices include VAT: {prices}. You pay once, in advance, through Stripe. It is not a subscription.</p>
      <h2>Validity</h2>
      <p>Sessions are valid for {CFG.validityMonths} months from the day you pay. Sessions not used in that time expire.</p>
      <h2>Booking, changes and cancellation</h2>
      <ul>
        <li>Sessions are booked at least 1 week ahead.</li>
        <li>You can move or cancel a session for free until {CFG.changeDeadlineHours} hours before it starts, from your account. A cancelled session goes back into your account.</li>
        <li>Later than that, or if you do not show up, the session counts as used. Email us if something serious came up.</li>
        <li>If we have to cancel, you get the session back or your money back for it, your choice.</li>
      </ul>
      <h2>Right of withdrawal</h2>
      <p>You can withdraw from your purchase within 14 days of paying by emailing {CONTACT_EMAIL}. Sessions you already took within those 14 days are deducted at the single session price. Sessions taken count as delivered.</p>
      <h2>Your health</h2>
      <p>The test ends with a maximal effort. Before every session you confirm that you answered no to every question in the <a href="/health-check">health check</a>. If anything changes, tell us before you ride. You ride at your own risk within what Danish law allows.</p>
      <h2>Questions and complaints</h2>
      <p>Email {CONTACT_EMAIL}. If we cannot agree, you can complain to the Danish Consumer Complaints Board (Nævnenes Hus) or through the EU online dispute portal.</p>
    </Doc>
  );
}

export function Privacy() {
  return (
    <Doc title="Privacy policy">
      <p>NDURE ApS, CVR 45530701, Diplomvej 376, 2800 Kongens Lyngby, is responsible for your data. Contact: {CONTACT_EMAIL}.</p>
      <h2>What we keep and why</h2>
      <ul>
        <li><b>Name, email and phone</b>: to book your sessions, send confirmations and reach you on the day. Legal basis: our contract with you.</li>
        <li><b>FTP and goal</b> (optional): to plan your test.</li>
        <li><b>Pre session form</b>: year of birth, sex, weight, height, training background and equipment, to set up your test and make your report.</li>
        <li><b>Test data</b>: blood lactate, heart rate and power. This is health data. We only process it with your explicit consent, given when you book, to make your report.</li>
        <li><b>Payment records</b>: kept for 5 years, as Danish bookkeeping law requires. Card details go to Stripe and never reach us.</li>
        <li><b>Optional</b>: anonymised sensor data for developing our sensor, and filming for NDURE content, only if you tick those boxes.</li>
      </ul>
      <h2>Who helps us</h2>
      <p>Stripe (payments), Brevo (emails), Tally (the pre session form) and Cloudflare (hosting and the security check). They process data on our behalf under data processing agreements.</p>
      <h2>How long</h2>
      <p>We keep your account and test data while you use NDURE Labs, and delete it when you ask, except what bookkeeping law requires us to keep.</p>
      <h2>Your rights</h2>
      <p>You can see, correct, move or delete your data, and withdraw a consent at any time, by emailing {CONTACT_EMAIL}. You can complain to the Danish Data Protection Agency (Datatilsynet).</p>
      <h2>Cookies</h2>
      <p>We use one necessary cookie to keep you logged in. No tracking or advertising cookies.</p>
    </Doc>
  );
}

export function HealthCheck() {
  const qs = [
    'Has a doctor ever said you have a heart condition or high blood pressure?',
    'Do you get pain in your chest at rest, in daily life, or when you exercise?',
    'In the last 12 months, have you lost balance because of dizziness, or lost consciousness?',
    'Do you have another long term medical condition, other than heart disease or high blood pressure?',
    'Do you take prescription medicine for a long term condition, including blood thinners?',
    'Do you have a bone, joint or muscle problem that hard exercise could make worse?',
    'Has a doctor said you should only exercise under medical supervision?',
    'Are you pregnant, ill, or do you have a fever today?'
  ];
  return (
    <Doc title="Health check">
      <p>The test ends with a maximal effort and takes a few drops of blood. Answer these questions before you book, and again on the day.</p>
      <ol>{qs.map((q) => <li key={q}>{q}</li>)}</ol>
      <p><b>If you answer yes to any question</b>, do not book yet. Talk to your doctor first and email us at {CONTACT_EMAIL}. We find a safe way together.</p>
    </Doc>
  );
}
