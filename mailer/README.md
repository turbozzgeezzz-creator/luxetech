# LuxeMail (tech store): Tech.LuxeDealers' own email automation (Cloudflare Worker + D1 + Resend).

Tech.LuxeDealers' own email automation: a Cloudflare Worker (free tier) with a D1 database, sending through Resend.
Shopify ignores this folder; it isn't part of the theme.

## Who gets email

LuxeMail keeps its own mailing list (`subscribers` table) and never relies on Shopify showing customer emails
(this app has no protected customer data access). Someone joins by:

- ticking "Email me deals and new arrivals" on any newsletter form (footer, popup, homepage, password page), or
- being signed in with "accepts marketing" on their Shopify account (added once only; an unsubscribe sticks).

That's express consent under the Spam Act, so they're subscribed straight away and the welcome email goes out
at once. The source, consent wording, page and time are recorded. Every email says why they're getting it and
has a one-click unsubscribe.

## What it sends

| Flow | When | Offer |
|---|---|---|
| welcome1 | Straight after sign-up | WELCOME10: 10% off first order |
| welcome2 | Day 3, if no order | WELCOME10 reminder |
| welcome3 | Day 7, if no order (once per address ever) | Unique WELCOME15-XXXXX: 15%, single use, 3 days |
| checkout1 | Pixel: checkout started, not finished, after 4 h | none (shows how close they are to spend-and-save) |
| checkout2 | Same, after 2 days | Unique BACK5-XXXXX: 5%, single use, 7 days |
| cart1 / cart2 | Added to cart, no checkout: after 4 h, then 20 h later | cart2: unique BACK5-XXXXX |
| browse | Viewed products 1-3 days ago, no cart or order; max weekly | none |
| wishlist | Saved items 3+ days ago, not bought; max fortnightly | none |
| postpurchase | 7 days after an order | Unique NEXT10-XXXXX: 10% off next order, 30 days |
| nextreminder | A week before that code ends, if no new order | the same NEXT10 code |
| vip | Verified orders total $250+ | VIP10: 10% off every order |
| winback | Last order 60+ days ago; once a quarter | Unique COMEBACK15-XXXXX: 15%, 14 days |
| fortnight | Every second Tuesday 6:30 pm Sydney, whole list, rotating: | |
| | New arrivals | Shared NEWIN10-XXXX: 10% off New arrivals, 7 days, once per customer |
| | Picked for you (banner matches their interest) | Spend $100 save 5%, $150 save 10% (automatic) |
| | Best sellers | Spend-and-save (automatic) |
| | From the tech desk (blog) | Shared INSIDER10-XXXX: 10% off everything, 7 days, once per customer |
| weekly report | Mondays 9 am to ADMIN_EMAIL | |

Rules built in:
- Consent is re-checked against our own list right before every send: only `subscribed`, never suppressed.
- One email per person per 20 hours; daily cap of DAILY_SEND_LIMIT (Resend free tier is 100 a day).
- Every code is a real Shopify discount whose conditions and expiry are stated in the email. Codes don't
  combine with other discounts. Previews never create real codes.
- Orders from the pixel are checked in Shopify; only verified orders count towards VIP.
- Sign-ups are limited to 5 per IP per hour. Images are embedded in each email so they show even when the
  mail app blocks remote images.
- `/health` shows queue and send counts, plus today's pixel and theme activity (counts only, no personal data).

New banners in the same style: `node tools/banner.mjs <original 1200x600 banner> <out.jpg> "EYEBROW" "Line 1" "Line 2"`.

## Inputs

- `POST /t`: theme beacon (`assets/experience.js`): views, cart adds, wishlist saves, sign-ups with consent.
- `POST /p`: Shopify custom pixel (`pixel.js`, pasted into Settings > Customer events): checkouts and orders.
  Ignored unless the email is a subscriber (a completed checkout always stops its reminders).
- `/u`: unsubscribe.

## Deploy

With CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, RESEND_API_KEY, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in the environment:

```
./deploy.sh
```

It is safe to rerun. It checks the Resend domain (and lists any DNS records still missing), creates the D1 database and
tables, deploys, sets PUBLIC_URL, stores the secrets, removes any old LuxeMail webhooks, sets the theme's tracking URL
and the address in `pixel.js`, publishes the New arrivals and Best sellers collections (if the app may), checks
/health, checks every email builds (`SEND_TESTS=1 ./deploy.sh` also emails them to ADMIN_EMAIL), and commits
and pushes the changed settings.
UNSUB_SECRET is derived from the Shopify client secret, so it stays the same on every deploy.

Preview any email: `PUBLIC_URL/preview?flow=welcome1&key=UNSUB_SECRET` (any flow above; fortnight takes
`&theme=new|picks|best|blog`) (add `&send=1` to email it to ADMIN_EMAIL).
Health: `PUBLIC_URL/health`.
