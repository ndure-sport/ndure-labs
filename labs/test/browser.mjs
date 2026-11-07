// Clicks through the real pages in a browser: every link and button on the Labs page, then a full
// booking: plan, date, details, payment (fake Stripe), back to the account, log out, log in again.
// Needs: fake services on 8788 and the app on BASE without the bot check, for example
//   npx wrangler dev --port 8790 --var TURNSTILE_SITE_KEY: --var APP_URL:http://localhost:8790
// Run: node test/browser.mjs /tmp/labs-log.jsonl [base] [shots folder]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
// Playwright is not a project dependency: use the one installed on this machine.
const req = createRequire(import.meta.url);
let pw;
try { pw = req('playwright'); } catch { pw = req(execSync('npm root -g').toString().trim() + '/playwright'); }
const { chromium, devices } = pw;
import crypto from 'node:crypto';
import fs from 'node:fs';

const LOG = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:8790';
const SHOTS = process.argv[4] || '';
let fails = 0;
const ok = (label, cond, info = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${info ? '  ' + info : ''}`); };
const lastEmail = (to) => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter((x) => x.email && x.email.to === to).at(-1)?.email;
async function webhook(orderId) {
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { metadata: { order_id: orderId }, payment_status: 'paid' } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_localtest').update(`${t}.${body}`).digest('hex');
  return (await fetch(BASE + '/api/stripe/webhook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${sig}` } })).status;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

const browser = await chromium.launch();

for (const [label, ctxOpts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]]) {
  console.log(`\n== ${label}`);
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The browser logs every 4xx as an error; expected API answers (401 logged out) are fine, the rest is not.
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !(r.status() === 401 && /\/api\/(me|team)$/.test(new URL(r.url()).pathname))) errors.push(`${r.status()} ${r.url()}`); });
  let stripeUrl = null;
  await page.route('https://checkout.stripe.test/**', (r) => { stripeUrl = r.request().url(); r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Fake Stripe</h1>' }); });

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok('page loads with the headline', await page.getByRole('heading', { level: 1 }).innerText().then((t) => t.includes('right intensity')));
  ok('hero shows the first free date', /First free date: \w+day \d+ \w+/.test(await page.locator('.avail').innerText()), await page.locator('.avail').innerText());
  ok('three plans with the right prices', (await page.locator('.plan').count()) === 3 && (await page.locator('.plan .price b').allInnerTexts()).join('|') === '499 kr|435 kr|375 kr', (await page.locator('.plan .price b').allInnerTexts()).join('|'));
  ok('Progress is the recommended plan', (await page.locator('.plan.rec .h3').innerText()) === 'Progress');

  // Every link on the page goes somewhere real.
  const links = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
  const anchors = [...new Set(links.filter((h) => h.startsWith('#') || h.startsWith('/#')).map((h) => h.replace(/^\//, '').slice(1)))];
  for (const id of anchors) ok(`anchor #${id} exists`, (await page.locator(`[id="${id}"]`).count()) === 1);
  for (const p of [...new Set(links.filter((h) => h.startsWith('/') && !h.startsWith('/#')))]) {
    const r = await fetch(BASE + p);
    ok(`link ${p} opens`, r.status === 200);
  }
  for (const m of [...new Set(links.filter((h) => h.startsWith('mailto:')))]) ok(`email link ${m.split('?')[0]}`, /^mailto:contact@ndure\.dk/.test(m));
  ok('no empty or placeholder links', !links.some((h) => h === '#' || h === '' || /placeholder|intro-call|documentary/.test(h)), links.filter((h) => h === '#' || /placeholder|intro-call|documentary/.test(h)).join(', '));
  ok('no placeholder text on the page', !/PLACEHOLDER|DRAFT|\[x\]|\[date\]/i.test(await page.locator('body').innerText()));

  // Header buttons scroll to the booking.
  await page.locator('.hdr a.btn:not(.ghost)').click();
  await page.waitForTimeout(800);
  ok('header Book scrolls to booking', await page.locator('#book-t').isVisible() && (await page.locator('#book-t').boundingBox()).y < 400);
  await shot(page, `${label}-1-landing`);

  // FAQ opens.
  await page.locator('.faq summary').first().click();
  ok('FAQ answer opens', await page.locator('.faq details').first().evaluate((d) => d.open));

  // Booking: Snapshot first, then back and Progress.
  await page.getByRole('button', { name: 'Choose Snapshot' }).click();
  await page.waitForURL(/\/book\?qty=1/);
  ok('Choose opens the booking page', page.url().includes('/book?qty=1'));
  await page.getByText('Pick your session', { exact: true }).waitFor({ timeout: 10000 }).catch(() => {});
  ok('step 2 opens', await page.getByText('Pick your session', { exact: true }).isVisible());
  ok('booking page starts at the top', (await page.evaluate(() => scrollY)) === 0);
  ok('Snapshot shows the upgrade to Progress', await page.getByText('Upgrade to Progress: 3 sessions at 435 kr each').isVisible());
  ok('no "choose later" any more', (await page.getByText('Choose dates later').count()) === 0);
  ok('Next is locked until a time is picked', await page.getByRole('button', { name: 'Next: your details' }).isDisabled());
  await page.getByRole('button', { name: '‹ Back' }).click();
  ok('Back shows the packs on the booking page', await page.getByRole('button', { name: 'Choose Progress' }).isVisible() && page.url().endsWith('/book'));
  await page.getByRole('button', { name: 'Choose Progress' }).click();
  ok('Progress: other sessions are booked later from the account', await page.getByText('Your other 2 sessions you book later').isVisible());
  await page.locator('button.mday').first().waitFor({ timeout: 10000 }).catch(() => {});
  ok('month calendar shows', (await page.locator('button.mday').count()) > 3, `${await page.locator('button.mday').count()} free days`);
  const firstDay = await page.locator('button.mday').first().getAttribute('aria-label');
  ok('first bookable day is on or after 1 December', /December|January|February/.test(firstDay), firstDay);
  ok('summary shows the full address', (await page.locator('.sum').innerText()).includes('2800 Kongens Lyngby'));
  await page.locator('button.mday').nth(1).click();
  await page.locator('.tslot').first().click();
  ok('summary shows the picked time', !(await page.locator('.sum').innerText()).includes('Not chosen yet'));
  ok('summary total is 1,305 kr', (await page.locator('.sum .tot').innerText()).includes('1,305 kr'));
  await shot(page, `${label}-2-date`);
  await page.getByRole('button', { name: 'Next: your details' }).click();

  // Details: try to pay with nothing filled in.
  await page.getByRole('button', { name: /^Pay / }).click();
  ok('empty form is not sent', stripeUrl === null && page.url().startsWith(BASE));
  const email = `browser-${label}-${Date.now().toString(36)}@test.dk`;
  await page.getByLabel('Full name').fill('Browser Rider');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Phone').fill('+45 2000 0000');
  await page.getByLabel('FTP in watts').fill('2a50');
  ok('FTP keeps digits only', (await page.getByLabel('FTP in watts').inputValue()) === '250');
  await page.getByRole('button', { name: /^Pay / }).click();
  ok('missing consents are caught on the page', await page.getByText('Tick all the required boxes.').isVisible());
  const boxes = page.locator('.checks .chk');
  const n = await boxes.count();
  ok('six consent lines, four required', n === 6 && (await page.locator('.checks em', { hasText: 'Required' }).count()) === 4, `${n}`);
  for (let i = 0; i < n; i++) if ((await boxes.nth(i).locator('em').innerText()) === 'Required') await boxes.nth(i).locator('input').check();
  ok('pay button shows the total', (await page.getByRole('button', { name: /^Pay / }).innerText()) === 'Pay 1,305 kr');
  await shot(page, `${label}-3-details`);
  await page.getByRole('button', { name: /^Pay / }).click();
  await page.waitForURL('https://checkout.stripe.test/**', { timeout: 15000 }).catch(() => {});
  ok('goes to Stripe', !!stripeUrl, stripeUrl || (await page.locator('.msg').allInnerTexts()).join(' '));
  const orderId = stripeUrl?.split('/').pop();

  // Cancel on Stripe: back on the page with a clear message.
  await page.goto(BASE + '/book?cancelled=1&qty=3', { waitUntil: 'networkidle' });
  ok('cancelled payment message shown', await page.getByText('Payment was cancelled').isVisible());

  // Pay: webhook, then Stripe sends the rider to the account page.
  ok('payment confirmed', (await webhook(orderId)) === 200);
  await page.goto(`${BASE}/account?paid=${orderId}`, { waitUntil: 'networkidle' });
  await page.getByText('Hi Browser').waitFor({ timeout: 15000 }).catch(() => {});
  ok('back from Stripe: logged in', await page.getByText('Hi Browser').isVisible());
  ok('first session is booked, 2 left', (await page.locator('.scard').count()) >= 1 && (await page.locator('.bignum').innerText()) === '2');
  await shot(page, `${label}-4-account`);
  const conf = lastEmail(email);
  ok('confirmation email sent', !!conf, conf?.subject);

  ok('session card shows where and what to bring', (await page.locator('.scard').first().innerText()).includes('Cycling shoes'));
  ok('add to calendar links', (await page.locator('.cal-links a').count()) === 3);
  ok('add sessions at the pack price: 1 more is 435 kr', (await page.getByRole('button', { name: /^Add 1 session, pay/ }).innerText()) === 'Add 1 session, pay 435 kr');

  // Book a second session from the account.
  await page.getByRole('button', { name: 'Book a session' }).click();
  await page.locator('#picker button.mday').nth(2).click();
  await page.locator('#picker .tslot').first().click();
  await shot(page, `${label}-5-account-book`);
  await page.getByRole('button', { name: /^Book \w+day/ }).click();
  await page.getByText('Booked. A confirmation is on its way.').waitFor({ timeout: 10000 }).catch(() => {});
  ok('second session booked from the account, 1 left', (await page.locator('.bignum').innerText()) === '1');

  // Add 2 sessions: Stripe, then they are in the account.
  stripeUrl = null;
  await page.locator('.stp[aria-label="One more"]').click();
  ok('2 more is 870 kr', (await page.getByRole('button', { name: /^Add 2 sessions/ }).innerText()) === 'Add 2 sessions, pay 870 kr');
  await page.getByRole('button', { name: /^Add 2 sessions/ }).click();
  await page.waitForURL('https://checkout.stripe.test/**', { timeout: 15000 }).catch(() => {});
  const addId = stripeUrl?.split('/').pop();
  ok('add sessions goes to Stripe', !!addId);
  ok('extra sessions paid', (await webhook(addId)) === 200);
  await page.goto(`${BASE}/account?paid=${addId}`, { waitUntil: 'networkidle' });
  await page.getByText('Hi Browser').waitFor({ timeout: 15000 }).catch(() => {});
  ok('3 sessions left after adding 2', (await page.locator('.bignum').innerText()) === '3');

  // Log out and in again with the emailed code.
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.waitForTimeout(1500);
  const code = lastEmail(email)?.subject.match(/\d{6}/)?.[0];
  ok('login code emailed', !!code);
  await page.getByLabel('Code').fill(code || '');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByText('Hi Browser').waitFor({ timeout: 10000 }).catch(() => {});
  ok('logged in again with the code', await page.getByText('Hi Browser').isVisible());

  // Legal pages render.
  for (const [p, h] of [['/terms', 'Terms'], ['/privacy', 'Privacy policy'], ['/health-check', 'Health check']]) {
    await page.goto(BASE + p);
    ok(`${p} shows "${h}"`, (await page.getByRole('heading', { level: 1 }).innerText()) === h);
  }
  // Header on a sub page goes back to the booking.
  await page.locator('.hdr a.btn:not(.ghost)').click();
  await page.waitForURL(BASE + '/#book');
  ok('Book from a sub page returns to the booking', page.url().endsWith('/#book'));

  // Team page: log in, the three tabs, the rider in the sessions list.
  if (label === 'desktop') {
    await page.goto(BASE + '/team', { waitUntil: 'networkidle' });
    await page.getByLabel('Email').fill('team@ndure.dk');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.waitForTimeout(1500);
    if (await page.getByText('Too many codes requested').isVisible()) {
      console.log('SKIP  team page: too many login codes for team@ndure.dk in the last hour (from earlier runs)');
    } else {
    const tcode = lastEmail('team@ndure.dk')?.subject.match(/\d{6}/)?.[0];
    await page.getByLabel('Code').fill(tcode || '');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByText('Upcoming sessions').waitFor({ timeout: 10000 }).catch(() => {});
    ok('team tabs: Sessions, Opening hours, Admin', (await page.locator('nav.tabs button').allInnerTexts()).join('|') === 'Sessions|Opening hours|Admin', (await page.locator('nav.tabs button').allInnerTexts()).join('|'));
    ok('team list shows the rider with Move date', (await page.locator('.srow', { hasText: 'Browser Rider' }).count()) >= 1 && (await page.getByRole('button', { name: '↔ Move date' }).count()) >= 1);
    ok('free spots can be booked', (await page.getByRole('button', { name: '+ Book a rider' }).count()) >= 1);
    await shot(page, `${label}-6-team`);
    }
  }

  ok('no script errors', errors.length === 0, errors.join(' | '));
  if (label === 'phone') ok('no sideways scrolling on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close();
}
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
