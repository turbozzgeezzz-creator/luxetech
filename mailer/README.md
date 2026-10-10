# LuxeMail (tech store): Tech.LuxeDealers' own email automation (Cloudflare Worker + D1 + Resend).

Tech.LuxeDealers' own email automation: a Cloudflare Worker (free tier) with a D1 database, sending through Resend.
Shopify ignores this folder; it isn't part of the theme.

## What it sends

| Flow | Trigger | Discount |
|---|---|---|
| welcome1 / welcome2 | Customer subscribes (Shopify webhook); reminder 3 days later if no order | WELCOME10 |
| checkout2 | Checkout abandoned 2+ days, no order (Shopify's own 10-hour email goes first) | Unique BACK5-XXXXX, 7 days |
| cart1 / cart2 | Added to cart (theme tracking), no checkout: after 4 h, then 20 h later | cart2: unique BACK5-XXXXX |
| browse | Viewed products 1-3 days ago, no cart or order; max weekly | none |
| wishlist | Saved items 3+ days ago, not bought; max fortnightly | none |
| postpurchase | 7 days after an order: recommendations for what they bought | none |
| vip | Joins segment "LX · VIP (spent $250+)" | VIP10 |
| winback | In segment "LX · Lapsed (no order in 60 days)"; once a quarter | Unique COMEBACK15-XXXXX, 14 days |
| fortnight | Every second Tuesday 6:30 pm Sydney; rotates New arrivals → Picks → Best sellers → Blog | none |
| weekly report | Mondays 9 am to ADMIN_EMAIL | |

Rules built in:
- Marketing consent is re-checked in Shopify right before every send, and only SUBSCRIBED customers get mail.
- One email per person per 20 hours.
- Daily cap of DAILY_SEND_LIMIT, which fits Resend's free tier of 100 a day.
- Every email has a working unsubscribe link (with one-click headers) that also unsubscribes the customer in Shopify.

## Deploy

With CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, RESEND_API_KEY, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in the environment:

```
./deploy.sh
```

It is safe to rerun. It checks the Resend domain (and lists any DNS records still missing), creates the D1 database and
tables, stores the secrets, deploys, sets PUBLIC_URL, registers the Shopify webhooks, sets the theme's tracking URL,
checks /health, emails a test of each flow to ADMIN_EMAIL, and commits and pushes the changed settings.
UNSUB_SECRET is derived from the Shopify client secret, so it stays the same on every deploy.

Preview any email: `PUBLIC_URL/preview?flow=welcome1&key=UNSUB_SECRET` (add `&send=1` to email it to ADMIN_EMAIL).
Health: `PUBLIC_URL/health`.
