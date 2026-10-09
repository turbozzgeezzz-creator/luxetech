# LuxeMail

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

```
npm i -g wrangler
wrangler login                      # or CLOUDFLARE_API_TOKEN in the environment
wrangler d1 create luxemail         # put the id into wrangler.toml
wrangler d1 execute luxemail --remote --file schema.sql
wrangler secret put SHOPIFY_CLIENT_ID
wrangler secret put SHOPIFY_CLIENT_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put UNSUB_SECRET    # any long random string
wrangler deploy                     # then set PUBLIC_URL in wrangler.toml and deploy again
```

Register Shopify webhooks (customers/create, customers/update, checkouts/create, checkouts/update, orders/create)
pointing to `PUBLIC_URL/webhooks`, then set Theme settings > Email tracking > Endpoint to `PUBLIC_URL/t`.

Preview any email: `PUBLIC_URL/preview?flow=welcome1&key=UNSUB_SECRET` (add `&send=1` to email it to ADMIN_EMAIL).
Health: `PUBLIC_URL/health`.
