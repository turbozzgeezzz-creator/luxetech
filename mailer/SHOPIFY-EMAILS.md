# Shopify and Judge.me emails: setup steps

LuxeMail (this folder) sends the marketing emails from **hello@send.tech.luxedealers.com**.
Shopify sends the order, shipping and delivery emails, and Judge.me sends review requests. Their settings
aren't reachable through any API this app has, so these steps are done in the admin. About 20 minutes in total.

## 1. Shopify sender address: noreply@tech.luxedealers.com

1. Shopify admin → **Settings → Notifications → Sender email**.
2. Enter `noreply@tech.luxedealers.com` and click **Save**.
3. Shopify says the domain needs authenticating and lists several **CNAME** DNS records. Leave that page open.
4. In another tab: Cloudflare dashboard → **luxedealers.com** → **DNS → Records**. For each record Shopify lists,
   click **Add record**, choose **CNAME**, and copy the **Name** and **Target** exactly.
   Set **Proxy status to "DNS only"** (grey cloud). Save.
5. Back in Shopify, click **Verify**. It can take up to 48 hours, but usually takes minutes.
6. In **Settings → General → Store contact email**, make sure it's `support@luxedealers.com`. Shopify's emails
   point customers there, because replies to a noreply address aren't read.

## 2. Make every Shopify email on-brand (one setting covers them all)

1. **Settings → Notifications → Customer notifications → Customize email templates** (the brand settings
   button at the top).
2. **Logo**: upload `assets/logo-tech-luxedealers.png` (dark text, for Shopify's white header).
   **Logo width**: 180 px.
3. **Colour**: `#7D03FC` (the store violet).
4. **Save**. This applies to order confirmation, shipping, delivery, refund and account emails.

## 3. Delivery emails

In **Settings → Notifications → Customer notifications**, under **Shipping**:

- **Shipping confirmation**: sent when you fulfil an order with tracking. Always add the tracking number when
  fulfilling, because it powers the next two emails.
- **Shipping update**: sent when you change tracking on a fulfilment.
- **Out for delivery** and **Delivered**: sent automatically when the carrier reports those events
  (Australia Post, Aramex, StarTrack and most big carriers do). Open each one: if it has an on/off toggle,
  turn it on.

Click **Send test email** on each one to see it with your logo and colour.

Keep these Shopify emails on. Turn off only the Shopify Email *marketing automations* (welcome, abandoned
cart, abandoned checkout, browse) and the Flow "Recover abandoned checkout", because LuxeMail now sends those.

## 4. Judge.me review requests

In Shopify admin → **Apps → Judge.me**:

1. **Review requests** (or **Settings → Emails**): turn on **Review request emails**.
2. **When to send**: 14 days after fulfilment (orders are dispatched in 3-4 business days, then delivery
   takes a few more). If Judge.me offers "after delivery", choose that with a 3 day wait instead.
3. **Reminder**: one reminder, 7 days later.
4. **Sender name**: `Tech.LuxeDealers`. **Reply-to**: `support@luxedealers.com`.
5. **Branding / design**: upload the same logo, button colour `#7D03FC`.
6. **Email copy**: paste in the text below.

**Subject:** How's your {{product_name}}?

**Body:**
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

Judge.me's placeholder names can differ from `{{product_name}}` and `{{customer_name}}`; use the ones its
editor lists.

**Australian Consumer Law:** don't offer a discount or gift only for *positive* reviews, and don't hide
negative ones. Offering a small thank-you for *any* honest review is allowed if the email says so plainly.
The copy above offers nothing, which is the simplest option.

Optional: Judge.me can send from your own domain (e.g. `reviews@tech.luxedealers.com`) on its paid plan.
It gives you DNS records to add in Cloudflare, the same way as step 1.
