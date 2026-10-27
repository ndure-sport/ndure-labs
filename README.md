# NDURE Labs sign up and booking

The app behind **book.ndure.dk**. Riders pick sessions, fill in their details and consent, pay with Stripe, then choose a date. Each rider gets a private link to book the rest of a pack, change a date or cancel. The team sees everyone in Cal.com, in their own calendar, and on `/admin`.

```
Framer page (ndure.dk/labs)
   │  "Sign up" → book.ndure.dk/?src=framer
   ▼
book.ndure.dk   ── prices ──────────► Airtable "Pricing" table (you edit prices here)
   │  checkout ────────────────────► Stripe Checkout (cards, Apple Pay, MobilePay)
   │  ◄─ webhook: paid ──────────── Stripe          → order + session credits saved, email with private link
   │  date picker ── free seats ───► Cal.com        → booking, calendar invite, reminders, team calendar
   │  ◄─ webhook: changed ───────── Cal.com         → credits stay correct when someone changes things in Cal.com
   ▼
Supabase (EU): orders, bookings, consents
```

## What lives where

| Thing | Where | Who changes it |
|---|---|---|
| Prices | Airtable table `Pricing` | You. Live within about a minute |
| Rules (24 h change limit, 12 month validity, consent wording) | `src/lib/policy.ts` | Code change |
| Opening days, times, seats per session | Cal.com event types | You, in Cal.com |
| Orders, credits, consents | Supabase | The app |
| Refunds | Stripe dashboard | You. A full refund closes the order automatically |

## Setup, in order

Plan about half a day. Do everything in **test mode** first.

### 1. Supabase (database, EU)
1. Create a project at supabase.com. **Pick an EU region** (Frankfurt or Stockholm).
2. SQL editor → paste `supabase/schema.sql` → Run.
3. Settings → API: copy the Project URL and the `service_role` key into `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service role key must never go in the browser or in Framer.

### 2. Cal.com (booking engine)
1. Connect the team calendar (Outlook or Google) under Settings → Calendars, so every booking shows up there.
2. Create the event types riders can book. Recommended: one per block.
   * **Labs morning:** length 150 min, availability Tue to Fri, single start time 09:30, Advanced → **Offer seats**: 2.
   * **Labs afternoon:** length 150 min, Tue to Fri, start time 13:00, **Offer seats**: 1.
   * Set the location to Diplomvej 376, 2800 Kongens Lyngby.
   * Add a minimum notice (for example 24 hours) so nobody books for tomorrow morning at midnight.
   * If your plan offers it, **turn off rescheduling and cancelling from Cal.com emails**, so riders always go through their own link (that's where the 24 hour rule and credits are enforced). If you can't, the webhook below still keeps credits right.
3. Note each event type's id (it's in the URL when you edit it). Put them in `CALCOM_EVENT_TYPES`, with seats matching step 2.
4. Settings → Developer → API keys: create a key → `CALCOM_API_KEY`.
5. Settings → Developer → Webhooks: add `https://book.ndure.dk/api/webhooks/calcom`, triggers **Booking cancelled** and **Booking rescheduled**, set a secret → `CALCOM_WEBHOOK_SECRET`.

> Check before relying on it: Cal.com's pricing page doesn't say clearly whether API keys and webhooks are on the free plan. If step 4 or 5 isn't available, the Teams plan is $12 per user per month (billed yearly) on cal.com/pricing.

### 3. Stripe (payment)
1. Developers → API keys: copy the secret key → `STRIPE_SECRET_KEY` (start with `sk_test_`).
2. Settings → Payment methods: turn on cards, Apple Pay, Google Pay, and MobilePay if your account offers it. Checkout shows whatever is on here, no code change needed.
3. Developers → Webhooks: add `https://book.ndure.dk/api/webhooks/stripe` with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`. Copy the signing secret → `STRIPE_WEBHOOK_SECRET`.
4. Discount and referral codes: Products → Coupons → create a coupon and a promotion code. Riders can enter it on the Stripe page.
5. **VAT: decide with your accountant** whether prices include 25% moms and how the receipt should show it. Stripe Tax can add it; the code treats prices as final prices.

### 4. Airtable (prices)
Create a table `Pricing` with two fields, **Key** (text) and **Value** (number or text), and these rows:

| Key | Value |
|---|---|
| price_1 | 99 |
| price_3 | 85 |
| price_5 | 76 |
| price_10 | 69 |
| partner | 79 |
| anchor | 250 |
| show_anchor | yes |
| addon_call | 39 |
| addon_call_enabled | no |
| addon_plan | 49 |
| addon_plan_enabled | no |

Create a personal access token with read access to that base → `AIRTABLE_TOKEN`, and put the base id (starts with `app`) in `AIRTABLE_BASE_ID`.

Safety net: if a change would make a bigger pack more expensive per session than a smaller one, or a price is 0 or empty, the app ignores the change and keeps the last good prices. The extras stay hidden until you set them to `yes`.

### 5. Brevo (the two emails Cal.com can't send)
API key → `BREVO_API_KEY`. Verify the sender address (`EMAIL_FROM_ADDRESS`) and the ndure.dk domain in Brevo. The app sends: the order link after payment, and the partner consent link. Booking confirmations, calendar invites and reminders come from Cal.com.

### 6. Hosting (Vercel)
1. Push this folder to a private GitHub repo, import it in Vercel.
2. Add every variable from `.env.example` under Settings → Environment Variables. Set `APP_URL=https://book.ndure.dk`.
3. Domains: add `book.ndure.dk`, then create the CNAME record Vercel shows you, wherever ndure.dk's DNS lives.
4. Vercel's free Hobby plan is for non commercial use only; use Pro (about $20 a month) for this.

### 7. Framer
Point every Labs button at the app. Use links that preselect and tag the source:
* `https://book.ndure.dk/?src=framer`
* `https://book.ndure.dk/?qty=5&src=framer_pricing`
* `https://book.ndure.dk/?partner=1&src=instagram`

The `src` value is saved on each order and shown on `/admin`, so you can see which channel sells.

## Test before going live (test mode)

Use Stripe test card `4242 4242 4242 4242`, any future date, any CVC.

1. Buy 1 session. You land on your order page, and within seconds the date picker opens. Book a morning.
   **Check:** the booking is in Cal.com and in the team calendar; the rider got the Cal.com invite and our order email.
2. Change the date from the order page. **Check:** Cal.com shows the new time and no old seat.
3. Cancel from the order page. **Check:** the order shows 1 session left again.
4. Buy 5 sessions with a partner. **Check:** the partner gets the consent email; only sessions with 2 free seats are offered; both appear in Cal.com.
5. Fill the afternoon (1 seat) with one booking. **Check:** it disappears for the next rider.
6. Cancel a booking from the Cal.com dashboard. **Check:** the credit comes back on the order page.
7. Try to cancel a session starting within 24 hours. **Check:** the page refuses and points to email.
8. Refund an order fully in Stripe. **Check:** the order page shows it closed.
9. Open `/admin` with the admin user and password. **Check:** the day list shows riders, partner and consent flags.

Then swap all keys to live keys, do one real €1 test with a promotion code, refund it, and you're live.

## Running it locally

```
cp .env.example .env.local   # fill in test keys
npm install
npm run dev                  # http://localhost:3000
npm test                     # pricing rules
```

For webhooks locally, use `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

## Known limits of version 1

* **12 month validity** is shown to riders but not enforced. Add a check when the first packs approach a year.
* **Partial refunds** don't change credits. Adjust `credits_left` in Supabase by hand.
* **Late cancellations by the team:** if the team cancels a session in Cal.com within 24 hours, the rider gets the credit back only if Cal.com reports who cancelled. Check `/admin` and fix by hand if needed.
* **No waitlist** for full days yet.
* The Cal.com API version headers are pinned in `src/lib/calcom.ts`. If Cal.com changes its API, update `CALCOM_SLOTS_API_VERSION` and `CALCOM_BOOKINGS_API_VERSION`.
* The readiness, privacy and terms links point to `ndure.dk/labs/readiness`, `ndure.dk/privacy` and `ndure.dk/labs/terms`. Those pages need to exist, and the consent wording needs legal review before launch.
