# LuxeTech theme (tech.luxedealers.com)

A custom Shopify Online Store 2.0 theme for a consumer electronics store. It replaces the
v1 theme: same LuxeTech name and category set, with a new design and most of the code rewritten.

## Connect to Shopify (recommended)

This repo has the theme folders at its root, so Shopify can sync it directly:
1. In Shopify admin, go to **Online Store > Themes > Add theme > Connect from GitHub**.
2. Authorize GitHub, then pick the `turbozzgeezzz-creator` account, the `luxetech` repo and the `main` branch.
3. The theme appears in your theme library. Preview it, then **Publish** when ready.

Every push to `main` updates that theme automatically.
Changes made in the theme editor are committed back to `main` by Shopify (mostly `config/settings_data.json` and `templates/*.json`). Pull before editing locally.

## Install by upload (alternative)

1. Run `sh package.sh`. It builds `dist/luxetech-theme.zip` (git-ignored).
2. In Shopify admin, go to **Online Store > Themes > Add theme > Upload zip file** and pick that zip.
3. Click **Customize** to preview the theme before you publish it.

The zip has `layout/`, `templates/`, `sections/`, `snippets/`, `assets/`, `config/` and `locales/` at its root.

## Design system: "signal"

The look is industrial-design rather than web-template: stone and white surfaces, graphite text, hairline borders, near-square corners and no drop shadows.
Signal orange is the only brand color, and it's spent on purpose:
- primary buttons (Add to cart, Checkout, Subscribe)
- links and sale prices
- Sale badges
- the indicator dot

The dot is the store's signature mark. It appears after the wordmark, before section titles and in the hero kicker, and it's the same shape as the stock-status dots.

| Token | Default | Used for |
|---|---|---|
| Background | `#F5F5F2` | Page (stone) |
| Surface | `#FFFFFF` | Cards, header, panels |
| Panels | `#ECEDE8` | Product image backgrounds, bands, hero |
| Graphite | `#1D1E1B` | Text, utility bar, newsletter band, footer, secondary buttons |
| Signal orange | `#C9441B` | Primary actions, links, sale prices, indicator dot |
| Signal tint | `#FBE8DF` | Save X% labels, highlight chips |
| In stock / Low stock / Error | `#2E7D32` / `#946200` / `#A3221A` | Stock lines and form errors only |

Type: **Bricolage Grotesque** for headings and prices, **Instrument Sans** for body text (both from Google Fonts).
All colors are editable in Theme settings > Colors.

## Placeholder images

Until real photos are added, every image slot shows line-art drawn in the theme's own colors, never a grey box or broken image. This covers hero slides, promo banners, mega menu promo tiles, product cards and galleries for products without photos, cart lines, collection and blog tiles, and search suggestions.

The art disappears automatically once a photo exists:
- **Hero, promo banners and mega menu tiles:** upload a photo in the theme editor image picker.
- **Category tiles:** use an icon by default; upload an image in the block to replace it.
- **Products, collections and articles:** add images in Shopify admin.

No code changes are needed.

## Pages to create (2 minutes each)

The copy for each page lives in its page template, so the page body in admin can stay empty.
In **Online Store > Pages > Add page**, enter the title, then open *Edit website SEO* and set the URL handle.
Pick the template under *Theme template* and save. All text is editable in the theme editor.

| Title | Handle | Template | Contents |
|---|---|---|---|
| About us | `about-us` | `about` | What the store is, four commitments, link to contact |
| Contact us | `contact` | `contact` | Support details from Store details settings, plus Shopify's contact form |
| FAQ | `faq` | `faq` | 10 questions on orders, shipping and returns, with FAQ structured data |
| Shipping and delivery | `shipping-delivery` | `shipping-delivery` | Processing time, delivery and costs, tracking, delivery problems |
| Returns and warranty | `returns-warranty` | `returns-warranty` | 30-day returns process, 12-month warranty, faulty items |
| Track my order | `track-order` | `track-order` | Steps to find tracking, with account and support buttons |

Privacy policy, Terms of service, Refund policy and Shipping policy are Shopify's own policy pages.
Generate them in **Settings > Policies**. The footer bottom bar links to them automatically.

**Before publishing, confirm the numbers in the copy are your real policy:**
- 1-2 business day dispatch
- 30-day returns
- 12-month warranty
- 7 days to report damage

They also appear in the trust row, utility bar and product page trust row, which are editable in the theme editor.

## Email popup

**Theme editor > Email popup** (it's at the bottom of every page).
- **When it shows:** once per visitor, 9 seconds after landing by default. The delay is configurable from 3 to 30 seconds. You can switch it to exit intent: on desktop it opens when the pointer leaves through the top of the window, and on phones it falls back to the delay.
- **When it doesn't:** it never opens over an open cart drawer or dialog. It's hidden on account pages and the password page, and for logged-in customers who already accept marketing.
- **After closing or signing up:** it isn't shown again. You can set it to reappear after N days for people who closed it.
- **Signup:** uses the same Shopify customer form as the footer, tagged `newsletter, popup`.
- **Discount offer:** the 10% copy only appears once you enter a code in *Discount code*. Create the code first in **Discounts > Create discount > Amount off order**, for example `WELCOME10`, 10%, limited to one use per customer. After signing up, the shopper sees the code with *Copy* and *Apply to my cart* buttons. The apply button uses Shopify's `/discount/CODE` link.

## Free shipping

The theme shows the progress bar (cart drawer and cart page), a buy box line and a utility bar message. All three are driven by **Theme settings > Cart > Free shipping threshold**, and all are hidden at 0.

The theme cannot make shipping free at checkout. Do this in admin first:
1. **Settings > Shipping and delivery > Shipping** (General shipping rates), then open your shipping profile.
2. In each shipping zone, click **Add rate**. Name it e.g. *Free shipping*, set *Price* to 0.
3. Click *Add conditions*, choose *Based on order price*, and set *Minimum price* to your threshold (e.g. 100). Save.
4. Enter the same amount in **Theme settings > Cart > Free shipping threshold**.

The threshold is in the store's default currency. If you sell in multiple currencies, the bar compares against that number in the shopper's currency, so set rates per market.

## Collections to create

| Collection | Type | Condition | Used by |
|---|---|---|---|
| Sale | Automated | Compare-at price is not empty | Header *Sale* link, hero slide 2 |
| Best sellers (optional) | Automated | Price is greater than 0, sort *Best selling* | Pick it in the second product rail and rename the rail *Best sellers* |

The *Shop the range* rail shows the whole catalog until you pick a collection. It is not labelled *Best sellers* by default, because the theme can't sort by sales on its own.

## Settings that need merchant setup

| Feature | Where | Notes |
|---|---|---|
| Mega menu columns | Header section > each **Category** block > *Subcategory menu* | Top-level menu items become column headings and their nested items become links. If no menu is picked, the theme uses a menu with the same name as the block (e.g. a menu called "Audio"). Failing that, it uses that item's children in `main-menu`. A category with no menu shows as a plain link. |
| Mega menu promo tile | Same block > *Promo tile* | Optional image, heading, text and link. |
| Collection filters | **Search & Discovery** app > Filters | Add Price, Availability, Vendor, Product type and option filters (e.g. Color). The sidebar and mobile filter sheet only show filters that are configured there. |
| Specs tab | Product metafield `custom.specs` | Supported types: JSON (`{"Battery": "40 h"}`), multi-line text (`Name: Value` per line) or rich text. The namespace and key can be changed in the Product section. The tab is hidden on products without specs. |
| Highlights bullets | Product metafield `custom.highlights` (list of single line text) | Optional. Shown in the buy box. |
| Per-product warranty | Product metafield `custom.warranty` (single line text) | Overrides the default warranty line in the trust row. |
| Category color code | Theme settings > Product cards > *Product type colors* | One `Product type: #hex` per line. Puts a colored tab next to the label on cards. |
| Free shipping bar | Theme settings > Cart > *Free shipping threshold* | Off at 0. The amount is in the store's default currency. |
| Footer address, hours, phone, email | Theme settings > Store details | Each line only shows when it has a value. |
| Social icons | Theme settings > Social media | Only platforms that have a URL get an icon. |
| Footer link columns | Footer > Link column blocks > *Menu* | With no menu picked, each column falls back to real store links (all products, contact page, policies, blog) and only lists links that exist. |
| Utility bar right-side links | Utility bar section > *Right-side links* | Optional. If empty, the support phone is shown. |

The demo links in the default homepage, header and slides point to `/collections/audio`, `/collections/charging`,
`/collections/smart-home` and `/collections/accessories`. Create collections with those handles, or change the links in the theme editor.

## Deliberately data-driven (nothing is invented)

- **Ratings** only appear when a product has the standard `reviews.rating` / `reviews.rating_count` metafields.
  The Shopify Product Reviews app and most review apps write these. Products without them show no stars.
- **Stock lines** use real inventory. *Low stock, only N left* shows when tracked quantity is at or below the threshold (5 by default).
  *Backordered* shows when a variant is out of stock but set to continue selling. Variants with untracked inventory show as in stock.
- **New badge** is based on the product's publish date (last 30 days by default; set it to 0 to turn the badge off).
- **Payment icons** come from Shopify's enabled payment methods (`payment_type_svg_tag`).
- **Product rails** hide themselves on the live store when they have no matching products. The *On sale now* rail only shows products with a compare-at price, so it stays hidden until you mark something down.
- **No "X people bought this", visitor counters or countdown timers.** The store has no such data, so nothing is shown.
- **Product cards** show an always-visible Add to cart button by default. Theme settings > Product cards can switch it to hover-only.
- **Mobile product pages** show a sticky Add to cart bar once the main button scrolls away.

## Not included

- **Wishlist**: the store has no wishlist app, so the theme has no wishlist icon.
- **Reviews widget / review submission**: install a reviews app. The cards and product page pick up its rating metafields automatically.
