# Every email NDURE Labs sends

This is the list of all emails the booking system sends by itself, when they go out, and what they say.
Update this file whenever an email changes.

**Did they go out?** Check Brevo: Transactional, then Logs. It shows every email with delivered, opened, bounced or failed.

**Switch an automatic email on or off:** in `core/config.ts`, the line `off: ['after', 'nudge', 'expiry']`.
Remove a name to switch it on, add one to switch it off. Booking emails (the first table) can't be switched off.

**Change the words:** the texts live in `core/engine.ts` (search for the subject). The design (logo, colours,
buttons, the session card and calendar links) lives in `worker/mail.ts`. Ask Claude, so the tests run before it goes live.

Every rider email has the NDURE logo on top, the address and contact@ndure.dk at the bottom, and replies go to contact@ndure.dk.

## Booking emails: always on

| Email | When | To | Subject | Button |
|---|---|---|---|---|
| Login code | Someone asks to log in | Rider or team | Your NDURE Labs code: 123456 | none |
| Payment received | Stripe confirms a payment | Rider | Payment received, NDURE Labs | Open my account |
| Booking confirmed | A session is booked (by the rider or the team) | Rider | Booked: Tue 8 Dec, 09:30 | Open my account |
| Session moved | The rider or team moves a session | Rider | Moved to Wed 9 Dec, 13:00 | Open my account |
| Session cancelled | The rider or team cancels | Rider | Cancelled: Tue 8 Dec, 09:30 | Book a session |
| Pick another time | The picked time filled up while they were paying | Rider | Please pick another time | Book a session |
| Training partner | A rider brings a partner (not offered on the page now) | Partner | Name signed you up for NDURE Labs | Give your consent |

Confirmed and moved emails carry a calendar invite (Outlook and Gmail put it straight in the calendar) and
"Add to calendar" links. A cancelled email removes it from the calendar again.

### Texts

**Payment received**
> Hi Mette,
> Thanks, we received 1,305 kr for 3 sessions. They are valid until 8 December 2027.
> Log in with your email at book.ndure.dk/account to book, change or cancel sessions.

Extra sessions added from the account say "for 2 extra sessions" and expire with their pack.

**Booking confirmed**
> You're booked. See you in the lab.
> Change or cancel for free until 24 hours before at labs.ndure.dk/account. You have 2 more sessions to book.

Then a blue box: "Before your session, please fill in the pre session form (4 minutes), so your tester can set up
your test." with a **Fill in the pre session form** button. The link fills in the rider's name, email, FTP, session
and booking number in the form. Below it a card with when, where to meet (DTU Science Park reception, Diplomvej 381,
the tester picks them up) and what to bring.

**Session moved**
> Your session moved from Tue 8 Dec, 09:30 to Wed 9 Dec, 13:00. The calendar invite is updated.

**Session cancelled**
> Your session on Tue 8 Dec, 09:30 is cancelled (by the NDURE team). The session is back in your account.

The last sentence only shows when the session went back. "By the NDURE team" only when the team cancelled.

**Pick another time**
> The session you picked (Tue 8 Dec, 09:30) filled up while you were paying. Your session is safe in your account:
> log in at book.ndure.dk/account to choose another time.

## Automatic emails

| Email | When | Status | Subject |
|---|---|---|---|
| Session reminder | The day before (26 hours before) | **On** | Getting ready for your NDURE Labs session tomorrow |
| How was your session? | 2 days after the session | Off: Anna sends the report from Outlook instead | How was your session? |
| Check in reminder | 4 and 8 weeks after the last session, only if nothing is booked | Off | Time to see if your training works (week 4), Your thresholds have probably moved (week 8) |
| Sessions about to expire | 30 days before unused sessions expire | Off | 2 sessions expire soon |

**Session reminder**, the day before (26 hours before, so it always lands the day before). Subject: "Getting ready for
your NDURE Labs session tomorrow" ("today" if the booking was made less than a day ahead). Button: Directions.
> Hi Mette,
>
> We're looking forward to seeing you tomorrow at 09:30. Your tester picks you up at the DTU Science Park reception, Diplomvej 381.
>
> To get the most reliable results, and results you can compare next time:
> • Avoid hard or long training in the 24 hours before.
> • Eat as you normally would, with a normal meal 2 to 3 hours before your session.
> • Drink as you normally would.
>
> Please bring:
> • Cycling shoes and bib shorts
> • A sleeveless top (the sensor goes on your upper arm)
> • A water bottle
> • Your heart rate strap, if you have one
> Our bike has Shimano SPD-SL pedals. Other cleats? Bring your own pedals.
>
> Showers are available after your session.
>
> [blue box] Haven't filled in the pre session form yet? Please do it today, it takes 4 minutes. [Fill in the pre session form]
> (left out when the form is already in)
>
> If you feel ill, just reply to this email and we'll move your session.
>
> See you tomorrow!

The meeting point, what to bring and the prep texts live in `core/visit.ts`. Change them there and the website,
account page, emails and calendar invites all follow.

Safety rules for automatic emails:
- They only go out in a short window after their moment. Switching one back on never mails old sessions.
- If more than 40 would go out in one run, all automatic emails pause, the team gets an alert, and a red box on the team page lets you resume.

## Emails to the team

Sent to everyone in `TEAM_EMAILS` (set in Cloudflare).

| Email | When |
|---|---|
| Today at Labs | Every opening day at 07:00: the day's riders with phone, and per rider "Form ✓" with FTP, bike, cleats and saddle height, or "FORM MISSING" |
| Booking soon | A booking, move or cancel for a session in the next 48 hours |
| Alert | Late payments, emails failing, automatic emails paused |
| Calendar invite | Every booking, move and cancel, only if `TEAM_CALENDAR_EMAIL` is set |

## Pre session form (Tally)

Tally sends each submission to `/api/tally/webhook`. The booking number in the form link says which session it belongs to;
without it, the rider's email picks their next booked session. If they have nothing booked, it waits ("forms without a
session" on the team page) and moves to their first new booking. Moving a session keeps its form.

Setup, once: in Tally open the form, Integrations, Webhooks, add `https://ndure-labs.arthur-2b2.workers.dev/api/tally/webhook`
and set a signing secret. Put the same secret in Cloudflare as `TALLY_SIGNING_SECRET` (Workers, ndure-labs, Settings,
Variables and secrets, type Secret). Without it the team page shows a red line and nothing is stored.
