# Testing NDURE Labs locally

Nothing here touches the real Stripe, Brevo or Cloudflare account.

1. `cp .dev.vars.example .dev.vars`
2. Fresh local database: `rm -rf .wrangler/state/v3/d1 && npx wrangler d1 execute ndure-labs-test --local --file=schema.sql`
3. Fake Stripe, Brevo and Turnstile: `node test/fake-services.mjs /tmp/labs-log.jsonl`
4. The app, with a 30 ms delay on every database call to imitate the real network:
   `npx wrangler dev --port 8787 --var TEST_DB_DELAY_MS:30`
5. Run the checks:
   - `npm test`: the booking rules (24 tests)
   - `node test/flow.mjs /tmp/labs-log.jsonl`: the whole system end to end (52 checks)
   - `node test/rush.mjs /tmp/labs-log.jsonl 100 60000 realistic`: 100 sign-ups in a minute
   - `node test/rush.mjs /tmp/labs-log.jsonl 100 60000`: same, with all payments confirmed at once
   - `node test/outage.mjs /tmp/labs-log.jsonl`: email provider down, then back (takes 3 minutes)

The rush test fills the calendar: reset the database (step 2) before running flow.mjs again.
