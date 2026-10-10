# LuxeMail: next session handoff

Status: rebuilt to the "no-permission subscriber list" design (below) and tested locally (20-case harness:
sign-up + double opt-in, rate limit, every flow, pixel, VIP/win-back from verified orders, unsubscribe, send limits).
Not deployed yet. Environment now has CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
RESEND_API_KEY, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE_DOMAIN, and network access to
api.cloudflare.com, api.resend.com, tech.luxedealers.com, *.workers.dev. Never print, log or commit any of them.

## Facts
- Cloudflare workers.dev subdomain: turbozzgeezzz (Worker will be luxemail-tech.turbozzgeezzz.workers.dev).
- Resend: separate free account; sending domain tech.luxedealers.com (from noreply@tech.luxedealers.com; DNS in the tech.luxedealers.com
  Cloudflare zone). May still be verifying; deploy.sh skips test sends until verified.
- Store is on Shopify Basic. Shopify Flow "Send HTTP request" is NOT available (Grow+ only).
- Protected customer data access is NOT available for this Dev Dashboard app: the Admin API returns
  "Anonymous" customers with @example.com emails, and customer/checkout webhooks will be redacted or refused.

## Done: rebuilt to the "no-permission subscriber list" design
Implemented as specified, plus double opt-in: the sign-up beacon is unauthenticated, so anyone could submit
someone else's address. (Later removed at the owner's request: subscribers now join straight away, with a per-IP limit.)
Orders from the pixel are verified with the Admin API (read_orders works; totals aren't protected data).
All webhooks dropped (orders/create too); deploy.sh now only removes old LuxeMail webhooks.

Original brief:
LuxeMail must not depend on Shopify showing customer emails.
1. The mailer keeps its own `subscribers` list (email, first name, consent source and time, status).
   Sources:
   - Theme newsletter form, with an explicit "Email me deals and new arrivals" tick box (record consent).
   - Signed-in customers whose Liquid `customer.accepts_marketing` is true (theme identify call).
   - A Shopify Custom Pixel (Settings > Customer events): `checkout_started` / `checkout_contact_info_submitted`
     (email plus cart lines, to recover abandoned checkouts) and `checkout_completed` (stops reminders, triggers
     post-purchase, builds order history). Only email people already in the subscriber list.
     Write the pixel code into mailer/pixel.js and give the user paste steps.
2. Consent check before each send = our own list (subscribed, not suppressed), not Shopify's marketingStatus.
3. VIP and win-back from our own order history (built from the pixel's checkout_completed), not from Shopify segments.
4. Personal discount codes: create without customer context (single use, expiry), since customer IDs aren't reliable.
5. Unsubscribe: our suppression list. Best-effort Shopify unsubscribe only if it works.
6. Drop Shopify customer/checkout webhook registration from deploy.sh. Keep orders/create only if it isn't
   redacted to uselessness; otherwise rely on the pixel.
7. Re-run the local harness (scratchpad is gone; rebuild a quick node:sqlite D1 shim) and test every flow.

## Then deploy
`./mailer/deploy.sh`. It handles the Resend domain check, D1, secrets, deploy, PUBLIC_URL, theme tracking URL,
health, test emails to support@luxedealers.com, and commit + push. Remove the webhook step per point 6.
Also publish the New arrivals and Best sellers collections if `write_publications` is now granted.

## After it's live, tell the user to
- Paste the custom pixel (Settings > Customer events > Add custom pixel), with exact steps.
- Turn off the Shopify Flow "Recover abandoned checkout" and any Shopify Email automations for welcome,
  abandoned cart or browse. Keep Shopify's order, shipping and delivery notifications.
- Delete the Hello World worker "holy-shape-4b85" (optional).
