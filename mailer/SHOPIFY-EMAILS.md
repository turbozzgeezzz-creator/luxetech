# Your setup checklist

LuxeMail (marketing emails from noreply@tech.luxedealers.com, replies go to support@luxedealers.com) is live and tested. These steps are in the
Shopify, Cloudflare and Judge.me admins, which only you can reach. About 30 minutes in total.

Logo for Shopify and Judge.me (dark text, for white email headers):
https://luxemail-tech.turbozzgeezzz.workers.dev/brand/logo-dark.png

## 1. Test the LuxeMail pixel (already added, 2 minutes)

1. On your phone or computer, open tech.luxedealers.com, add any product to the cart and go to checkout.
2. Enter an email address and continue to shipping. Don't pay.
3. Tell Claude. The pixel's count shows at https://luxemail-tech.turbozzgeezzz.workers.dev/health
   as `pixel_checkouts_today_utc`.

Check the pasted pixel code contains `subtotalPrice`. If it says `totalPrice`, paste `mailer/pixel.js` again
(Settings → Customer events → LuxeMail → replace the code → Save).

## 2. Switch off the old marketing automations (LuxeMail sends these now)

- **Apps → Shopify Flow**: turn off "Recover abandoned checkout".
- **Marketing → Automations**: turn off the welcome, abandoned checkout, abandoned cart and browse automations.

Leave every email under **Settings → Notifications** on (order confirmation, shipping, out for delivery,
delivered, refunds). LuxeMail doesn't send those.

## 3. Shopify sender address: noreply@tech.luxedealers.com

1. **Settings → Notifications → Sender email** → enter `noreply@tech.luxedealers.com` → **Save**.
2. Shopify lists some **CNAME** records. In another tab: Cloudflare → **luxedealers.com → DNS → Records →
   Add record**, type **CNAME**, copy each **Name** and **Target** exactly, **Proxy status: DNS only** (grey
   cloud) → **Save**.
3. Back in Shopify click **Verify** (usually minutes, up to 48 hours).
4. **Settings → General → Store contact email**: `support@luxedealers.com` (where customers' replies go).

## 4. Brand Shopify's order and delivery emails (one setting styles them all)

1. **Settings → Notifications → Customer notifications → Customize email templates**.
2. **Logo**: upload the logo above. **Logo width**: `180`. **Colour**: `#7D03FC`. **Save**.
3. Under **Shipping**, open **Shipping confirmation**, **Out for delivery** and **Delivered** and click
   **Send test email** on each to check them.
4. When you fulfil an order, always add the tracking number: it's what triggers "Out for delivery" and
   "Delivered".

## 5. Judge.me review requests

In Shopify admin → **Apps → Judge.me**:

1. Open **Review requests** (or **Settings → Emails**) and turn on **review request emails**.
2. **When to send**: 14 days after fulfilment. If "after delivery" is offered, choose that with a 3 day wait.
3. **Reminder**: one, 7 days later.
4. **Sender name**: `Tech.LuxeDealers`. **Reply-to**: `support@luxedealers.com`.
5. **Design**: upload the same logo; button colour `#7D03FC`.
6. **Email text** (use the placeholder names Judge.me's editor shows if they differ):

   **Subject:** How's your {{product_name}}?

   > Hi {{customer_name}},
   >
   > Your {{product_name}} should have arrived by now. We hope you love it!
   >
   > Could you take a minute to tell other shoppers what you think? Every honest review helps, good or bad.
   >
   > [Write a review]
   >
   > Something not right with your order? Just reply to this email and our team will sort it out.
   >
   > Thanks,
   > The Tech.LuxeDealers team

7. Click **Send test** to see it, then **Save**.

Australian Consumer Law: don't offer a reward only for positive reviews and don't hide negative ones.
The text above offers nothing, which is the simplest option.

## 6. Optional

- Cloudflare → **Workers & Pages** → `holy-shape-4b85` → **Settings → Delete** (an unused test worker).
