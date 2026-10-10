# LuxeMail (tech store): Tech.LuxeDealers' own email automation (Cloudflare Worker + D1 + Resend).

Tech.LuxeDealers' own email automation: a Cloudflare Worker (free tier) with a D1 database, sending through Resend.
Shopify ignores this folder; it isn't part of the theme.

## Who gets email

LuxeMail keeps its own mailing list (`subscribers` table) and never relies on Shopify showing customer emails
(this app has no protected customer data access). Someone joins by:

- ticking "Email me deals and new arrivals" on any newsletter form (footer, popup, homepage, password page), or
- being signed in with "accepts marketing" on their Shopify account (asked once only).

Either way they're `pending` and get one confirmation email. Only after they click "Yes, subscribe me" are they
`subscribed`, and the welcome series starts. The source, consent wording, page and times are recorded.

## What it sends

| Flow | Trigger | Discount |
|---|---|---|
| confirm | Sign-up (double opt-in); sent straight away, max one per address per 7 days | none |
| welcome1 / welcome2 | Confirmed; reminder 3 days later if no order | WELCOME10 |
| checkout1 / checkout2 | Custom pixel: checkout started, not completed. After 4 h, then after 2 days | checkout2: unique BACK5-XXXXX, single use, 7 days |
| cart1 / cart2 | Added to cart (theme tracking), no checkout: after 4 h, then 20 h later | cart2: unique BACK5-XXXXX |
| browse | Viewed products 1-3 days ago, no cart or order; max weekly | none |
| wishlist | Saved items 3+ days ago, not bought; max fortnightly | none |
| postpurchase | 7 days after an order (custom pixel): recommendations for what they bought | none |
| vip | Verified orders in our history total $250+ (VIP_SPEND_CENTS) | VIP10 |
| winback | Last order 60+ days ago (LAPSED_DAYS); once a quarter | Unique COMEBACK15-XXXXX, 14 days |
| fortnight | Every second Tuesday 6:30 pm Sydney to the whole list; rotates New arrivals → Picks → Best sellers → Blog | none |
| weekly report | Mondays 9 am to ADMIN_EMAIL | |

Rules built in:
- Consent is re-checked against our own list right before every send: only `subscribed`, never suppressed.
- One email per person per 20 hours (the confirmation email doesn't count).
- Daily cap of DAILY_SEND_LIMIT, which fits Resend's free tier of 100 a day.
- Every email has a working unsubscribe link (with one-click headers). Unsubscribing updates our list and
  suppression list straight away, and tries to unsubscribe them in Shopify too (best effort).
- Personal codes are real single-use Shopify codes with a stated expiry date, not tied to a customer ID.
- Orders reported by the pixel are checked in Shopify (Admin API, order totals aren't protected data); only
  verified orders count towards VIP.
- Sign-up beacons are limited to 5 per IP per hour; confirmation links need a POST, so link scanners can't confirm.

## Inputs

- `POST /t`: theme beacon (`assets/experience.js`): views, cart adds, wishlist saves, sign-ups with consent.
- `POST /p`: Shopify custom pixel (`pixel.js`, pasted into Settings > Customer events): checkouts and orders.
  Ignored unless the email is a confirmed subscriber (a completed checkout always stops its reminders).
- `/c`: confirm subscription. `/u`: unsubscribe.

## Deploy

With CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, RESEND_API_KEY, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in the environment:

```
./deploy.sh
```

It is safe to rerun. It checks the Resend domain (and lists any DNS records still missing), creates the D1 database and
tables, deploys, sets PUBLIC_URL, stores the secrets, removes any old LuxeMail webhooks, sets the theme's tracking URL
and the address in `pixel.js`, publishes the New arrivals and Best sellers collections (if the app may), checks
/health, emails a test of each flow to ADMIN_EMAIL, and commits and pushes the changed settings.
UNSUB_SECRET is derived from the Shopify client secret, so it stays the same on every deploy.

Preview any email: `PUBLIC_URL/preview?flow=welcome1&key=UNSUB_SECRET` (confirm, welcome1, welcome2, checkout1, vip,
browse, cart1, wishlist, fortnight) (add `&send=1` to email it to ADMIN_EMAIL).
Health: `PUBLIC_URL/health`.
