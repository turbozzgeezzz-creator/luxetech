// Shopify access for LuxeMail: client-credentials token, Admin GraphQL, order verification,
// best-effort unsubscribe, one-off discount codes, and product, collection and blog data.
import { now, randomCode, sendingReady } from './util.js';

export async function shopifyToken(env) {
  const cached = await env.DB.prepare('SELECT v, expires_at FROM kv WHERE k = ?').bind('shopify_token').first();
  if (cached && cached.expires_at > now() + 300) return cached.v;
  const res = await fetch(`https://${env.SHOP_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Shopify token request failed: ${res.status}`);
  const body = await res.json();
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v, expires_at) VALUES (?, ?, ?)')
    .bind('shopify_token', body.access_token, now() + (body.expires_in || 3600)).run();
  return body.access_token;
}

export async function gql(env, query, variables = {}) {
  const token = await shopifyToken(env);
  const res = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error('Shopify GraphQL: ' + JSON.stringify(body.errors).slice(0, 400));
  return body.data;
}

/**
 * Confirms an order reported by the custom pixel really exists, and returns its total in cents.
 * Order totals aren't protected customer data, so this works without that access.
 */
export async function verifyOrder(env, orderId) {
  const id = String(orderId).startsWith('gid://') ? String(orderId) : `gid://shopify/Order/${String(orderId).replace(/\D/g, '')}`;
  const data = await gql(env, `query($id: ID!){ order(id: $id){ id createdAt cancelledAt totalPriceSet{ shopMoney{ amount } } } }`, { id });
  const o = data.order;
  if (!o || o.cancelledAt) return null;
  return { totalCents: Math.round(parseFloat(o.totalPriceSet.shopMoney.amount) * 100), createdAt: Math.floor(Date.parse(o.createdAt) / 1000) };
}

/** LuxeMail only creates discount codes in Shopify: unsubscribes are kept in LuxeMail's own list. */
export async function unsubscribeInShopify() {}

/**
 * Creates a real, single-use code, e.g. BACK5-7KQ2M, sent to one person only. Customer IDs aren't reliable
 * without protected customer data, so the code isn't tied to a customer; the single use keeps it personal.
 * It expires after `days`, and the email states that date, so any urgency in the copy is genuine.
 */
export async function createPersonalCode(env, { prefix, percent, days, title }) {
  const endsAt = new Date(Date.now() + days * 86400000).toISOString();
  if (env.PREVIEW) return { code: `${prefix}-PREVIEW`, endsAt }; // previews never create real codes
  if (!(await sendingReady(env))) throw new Error('Sending is not live yet: no codes are created');
  const code = `${prefix}-${randomCode(5)}`;
  const data = await gql(env, `mutation($d: DiscountCodeBasicInput!){
      discountCodeBasicCreate(basicCodeDiscount:$d){ codeDiscountNode{ id } userErrors{ field message } } }`, {
    d: {
      title: `${title} (${code})`,
      code,
      startsAt: new Date().toISOString(),
      endsAt,
      usageLimit: 1,
      appliesOncePerCustomer: true,
      customerGets: { value: { percentage: percent / 100 }, items: { all: true } },
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
      context: { all: 'ALL' },
    },
  });
  const errs = data.discountCodeBasicCreate.userErrors;
  if (errs.length) throw new Error('Discount create failed: ' + JSON.stringify(errs));
  return { code, endsAt };
}

/**
 * A subscriber-only code shared by everyone on the list for one fortnightly email, e.g. NEWIN10-7KQ2.
 * Once per customer, expires after `days`, optionally limited to one collection. The email states all of that.
 */
export async function createSharedCode(env, { prefix, percent, days, title, collection }) {
  const endsAt = new Date(Date.now() + days * 86400000).toISOString();
  if (env.PREVIEW) return { code: `${prefix}-PREVIEW`, endsAt };
  if (!(await sendingReady(env))) throw new Error('Sending is not live yet: no codes are created');
  let items = { all: true };
  if (collection) {
    const c = await gql(env, `query($h: String!){ collectionByIdentifier(identifier: { handle: $h }){ id } }`, { h: collection });
    if (!c.collectionByIdentifier) throw new Error(`Collection not found: ${collection}`);
    items = { collections: { add: [c.collectionByIdentifier.id] } };
  }
  const code = `${prefix}-${randomCode(4)}`;
  const data = await gql(env, `mutation($d: DiscountCodeBasicInput!){
      discountCodeBasicCreate(basicCodeDiscount:$d){ codeDiscountNode{ id } userErrors{ field message } } }`, {
    d: {
      title: `${title} (${code})`, code, startsAt: new Date().toISOString(), endsAt,
      appliesOncePerCustomer: true,
      customerGets: { value: { percentage: percent / 100 }, items },
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
      context: { all: 'ALL' },
    },
  });
  const errs = data.discountCodeBasicCreate.userErrors;
  if (errs.length) throw new Error('Discount create failed: ' + JSON.stringify(errs));
  return { code, endsAt };
}

/** Shopify's own abandoned checkouts created since `sinceIso` (every sales channel, no pixel needed). */
export async function abandonedCheckouts(env, sinceIso) {
  const d = await gql(env, `query($q: String!){ abandonedCheckouts(first: 50, sortKey: CREATED_AT, reverse: true, query: $q){ nodes {
      id createdAt updatedAt completedAt abandonedCheckoutUrl
      customer { email firstName }
      subtotalPriceSet { shopMoney { amount } }
      lineItems(first: 10) { nodes { quantity title variant { id product { handle } } } } } } }`, { q: `created_at:>='${sinceIso}'` });
  return d.abandonedCheckouts.nodes;
}

/** Orders placed since `sinceIso` (any channel), newest first. */
export async function ordersSince(env, sinceIso) {
  const d = await gql(env, `query($q: String!){ orders(first: 50, sortKey: CREATED_AT, reverse: true, query: $q){ nodes {
      id email createdAt cancelledAt customer { firstName } totalPriceSet { shopMoney { amount } }
      lineItems(first: 10) { nodes { product { handle } } } } } }`, { q: `created_at:>='${sinceIso}'` });
  return d.orders.nodes;
}

/** This customer's orders from the last 40 days, with shipping and delivery dates (read-only). */
export async function recentOrdersFor(env, email) {
  const since = new Date(Date.now() - 40 * 86400000).toISOString();
  const d = await gql(env, `query($q: String!){ orders(first: 5, sortKey: CREATED_AT, reverse: true, query: $q){ nodes {
      createdAt cancelledAt fulfillments(first: 5) { createdAt deliveredAt displayStatus } } } }`,
    { q: `email:"${String(email).replace(/["\\]/g, '')}" created_at:>='${since}'` });
  return d.orders.nodes;
}

/** True when Shopify has an order from this email created after `sinceIso`. */
export async function shopifyOrderedSince(env, email, sinceIso) {
  try {
    const d = await gql(env, `query($q: String!){ orders(first: 1, query: $q){ nodes { id } } }`,
      { q: `email:"${String(email).replace(/["\\]/g, '')}" created_at:>='${sinceIso}'` });
    return !!(d.orders && d.orders.nodes.length);
  } catch (e) {
    console.error('order lookup', e);
    return false;
  }
}

/** Product IDs this email has ever bought (Shopify orders, newest 50), so reminders never show something they own. */
export async function boughtProductIds(env, email) {
  const d = await gql(env, `query($q: String!){ orders(first: 50, sortKey: CREATED_AT, reverse: true, query: $q){ nodes {
      cancelledAt lineItems(first: 50){ nodes{ product{ legacyResourceId } } } } } }`,
    { q: `email:"${String(email).replace(/["\\]/g, '')}"` });
  const ids = new Set();
  for (const o of d.orders.nodes) if (!o.cancelledAt) for (const l of o.lineItems.nodes) if (l.product) ids.add(String(l.product.legacyResourceId));
  return ids;
}

/** True when Shopify has an order for this email (read-only; Shopify searches recent orders). */
export async function shopifyHasOrders(env, email) {
  try {
    const d = await gql(env, `query($q: String!){ orders(first: 1, query: $q){ nodes { id } } }`, { q: `email:"${String(email).replace(/["\\]/g, '')}"` });
    return !!(d.orders && d.orders.nodes.length);
  } catch (e) {
    console.error('order lookup', e);
    return false;
  }
}

/* ---------- Products, collections and blog posts (Admin API) ---------- */
// The storefront's public JSON (/products/x.js etc.) refuses requests from Cloudflare Workers,
// so product data comes from the Admin API, which this app can read (read_products, read_content).

const PRODUCT_FIELDS = `legacyResourceId handle title status onlineStoreUrl
  featuredMedia{ preview{ image{ url } } } priceRangeV2{ minVariantPrice{ amount } } compareAtPriceRange{ maxVariantCompareAtPrice{ amount } } variants(first: 20){ nodes{ availableForSale } }`;

export function normaliseProduct(env, p) {
  if (!p || !p.handle) return null;
  let image = p.featuredMedia && p.featuredMedia.preview && p.featuredMedia.preview.image ? p.featuredMedia.preview.image.url : null;
  // Serve product photos from the store's own domain (same Shopify CDN), cropped square for even cards.
  if (image) image = image.replace(/^https:\/\/cdn\.shopify\.com\/s\/files\/\d+\/\d+\/\d+\/\d+\//, `${env.STORE_URL}/cdn/shop/`);
  return {
    id: p.legacyResourceId,
    handle: p.handle,
    title: p.title,
    url: `${env.STORE_URL}/products/${p.handle}`,
    // Small progressive JPEGs (about 25-45 KB): sharp on phones, and emails stay light enough to open instantly.
    image: image ? `${image}${image.includes('?') ? '&' : '?'}width=440&height=440&crop=center&format=pjpg` : null,
    price: p.priceRangeV2 ? Math.round(parseFloat(p.priceRangeV2.minVariantPrice.amount) * 100) : null,
    // Genuine was-price (Shopify compare-at), only when it is above the selling price.
    compareAt: p.compareAtPriceRange && p.priceRangeV2 && parseFloat(p.compareAtPriceRange.maxVariantCompareAtPrice.amount) > parseFloat(p.priceRangeV2.minVariantPrice.amount)
      ? Math.round(parseFloat(p.compareAtPriceRange.maxVariantCompareAtPrice.amount) * 100) : null,
    // On sale only if active, published to the online store, and at least one variant can be bought.
    available: p.status === 'ACTIVE' && !!p.onlineStoreUrl && (p.variants ? p.variants.nodes.some((v) => v.availableForSale) : true),
  };
}

export async function productByHandle(env, handle, hop = 0) {
  const data = await gql(env, `query($h: String!){ productByIdentifier(identifier: { handle: $h }){ ${PRODUCT_FIELDS} } }`, { h: handle });
  if (data.productByIdentifier || hop > 1 || !handle) return normaliseProduct(env, data.productByIdentifier);
  // Renamed product: follow the store's /products/<old> redirect (saved carts and wishlists keep old handles).
  const r = await gql(env, `query($q: String!){ urlRedirects(first: 10, query: $q){ nodes{ path target } } }`, { q: `path:/products/${handle}` });
  const hit = (r.urlRedirects.nodes || []).find((x) => x.path.toLowerCase() === `/products/${handle}`.toLowerCase());
  const m = /\/products\/([^/?#]+)/.exec((hit || {}).target || '');
  return m ? productByHandle(env, m[1], hop + 1) : null;
}

/**
 * Picks products a subscriber hasn't been shown lately. env._seen holds handles from their emails in the last
 * 60 days, env._shown collects what this email uses (saved after it sends), and the starting point rotates by
 * day and person, so two people, or two weeks in a row, get different products. Falls back to seen ones if needed.
 */
export function pickFresh(env, list, limit) {
  const seen = env._seen || new Set();
  const shown = env._shown || [];
  const pool = list.filter((p) => p && p.available && !shown.includes(p.handle));
  if (!pool.length) return [];
  const day = Math.floor(Date.now() / 86400000);
  let h = day; for (const ch of String(env._who || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const start = env._who ? h % pool.length : 0;
  const rotated = pool.slice(start).concat(pool.slice(0, start));
  const fresh = rotated.filter((p) => !seen.has(p.handle));
  const out = fresh.concat(rotated.filter((p) => seen.has(p.handle))).slice(0, limit);
  if (env._shown) out.forEach((p) => env._shown.push(p.handle));
  return out;
}

/** "You might also like": other products from the same collections (skipping the catch-all ones). */
export async function recommendations(env, productId, limit = 4) {
  const data = await gql(env, `query($id: ID!, $n: Int!){ product(id: $id){ handle collections(first: 5){ nodes{ handle
      products(first: $n, sortKey: COLLECTION_DEFAULT){ nodes{ ${PRODUCT_FIELDS} } } } } } }`,
    { id: `gid://shopify/Product/${String(productId).replace(/\D/g, '')}`, n: Math.min(30, limit * 5) });
  if (!data.product) return [];
  const generic = ['all', 'frontpage', 'shop-all', 'new-arrivals', 'best-sellers'];
  const cols = [...data.product.collections.nodes].sort((a, b) => generic.includes(a.handle) - generic.includes(b.handle));
  const seen = new Set([data.product.handle]);
  const out = [];
  for (const c of cols) {
    for (const node of c.products.nodes) {
      const p = normaliseProduct(env, node);
      if (p && p.available && !seen.has(p.handle)) { seen.add(p.handle); out.push(p); }
    }
  }
  return pickFresh(env, out, limit);
}

export async function collectionProducts(env, handle, limit = 6) {
  const data = await gql(env, `query($h: String!, $n: Int!){ collectionByIdentifier(identifier: { handle: $h }){
      products(first: $n, sortKey: COLLECTION_DEFAULT){ nodes{ ${PRODUCT_FIELDS} } } } }`, { h: handle, n: Math.min(48, limit * 8) });
  if (!data.collectionByIdentifier) return [];
  return pickFresh(env, data.collectionByIdentifier.products.nodes.map((n) => normaliseProduct(env, n)), limit);
}

export async function latestArticles(env, limit = 3, sinceIso = null) {
  const q = 'published_status:published' + (sinceIso ? ` AND published_at:>'${sinceIso}'` : '');
  const data = await gql(env, `query($n: Int!, $q: String!){ articles(first: $n, sortKey: PUBLISHED_AT, reverse: true, query: $q){
      nodes{ title handle summary publishedAt image{ url } blog{ handle } } } }`, { n: limit, q });
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  return data.articles.nodes.map((a) => ({
    title: a.title,
    url: `${env.STORE_URL}/blogs/${a.blog.handle}/${a.handle}`,
    summary: ((t) => (t.length > 160 ? t.slice(0, 157).replace(/\s+\S*$/, '') + '…' : t))(strip(a.summary)),
    image: a.image ? a.image.url + (a.image.url.includes('?') ? '&' : '?') + 'width=1096&height=616&crop=center' : null,
    publishedAt: a.publishedAt,
  }));
}

/**
 * Order tracking for the store's Track your order page. Answers only when the order number AND the email on the
 * order match; never returns addresses or payment details. Carrier links go straight to the carrier (4PX etc.),
 * with a universal tracker as the fallback, never to a third-party app page.
 */
// Every shipment is tracked on 17TRACK's public tracking website (it reads Huahan, 4PX, China Post and the local
// postal services in every destination country). ParcelsApp is shown as a second option. These are public
// websites, not the 17TRACK Shopify app.
// Carrier and courier names are kept private: stripped from any scan text shown to customers.
const CARRIERS = /\b(hua\s*han|huahan|hh-?exp\w*|4px|yun\s*express|yanwen|cainiao|17track|china post)\b[\s:,-]*/gi;
export function hideCarrier(s) { return s ? String(s).replace(CARRIERS, '').replace(/\s{2,}/g, ' ').trim() : s; }
export function carrierLinks(number) {
  const n = encodeURIComponent(number);
  return { primary: `https://t.17track.net/en#nums=${n}`, backup: `https://parcelsapp.com/en/tracking/${n}` };
}

export async function trackOrder(env, rawNumber, rawEmail) {
  // With the order's email: full details. Without it: progress and dates only (no items, tracking number or
  // places), so guessing order numbers reveals nothing personal.
  const email = String(rawEmail || '').trim().toLowerCase();
  const num = String(rawNumber || '').trim().replace(/^#/, '').replace(/\s+/g, '').toUpperCase();
  if (!/^[0-9A-Z-]{3,20}$/.test(num)) return null;
  const q = `query($q: String!){ orders(first: 3, query: $q){ nodes{ name email createdAt cancelledAt displayFulfillmentStatus statusPageUrl
      lineItems(first: 20){ nodes{ title quantity variantTitle image{ url } } }
      fulfillments(first: 5){ createdAt displayStatus estimatedDeliveryAt inTransitAt deliveredAt
        trackingInfo(first: 3){ company number }
        events(first: 25, sortKey: HAPPENED_AT){ nodes{ status happenedAt message city country } } } } } }`;
  const names = /[A-Z]$/.test(num) ? [num] : [num, `${num}A`];
  for (const n of names) {
    const data = await gql(env, q, { q: `name:#${n}` });
    const order = (data.orders.nodes || []).find((o) => o.name.replace('#', '').toUpperCase() === n && (!email || (o.email || '').toLowerCase() === email));
    if (!order) continue;
    if (!email) {
      return {
        limited: true, name: order.name, placedAt: order.createdAt, cancelled: !!order.cancelledAt, status: order.displayFulfillmentStatus,
        shipments: order.fulfillments.map((f) => ({ shippedAt: f.createdAt, status: f.displayStatus, estimate: f.estimatedDeliveryAt, inTransitAt: f.inTransitAt,
          deliveredAt: f.deliveredAt, tracking: [], numbers: f.trackingInfo.filter((t) => t.number).map((t) => t.number), events: f.events.nodes.map((e) => ({ status: e.status, at: e.happenedAt })) })),
      };
    }
    return {
      name: order.name,
      placedAt: order.createdAt,
      cancelled: !!order.cancelledAt,
      status: order.displayFulfillmentStatus,
      statusPage: order.statusPageUrl,
      items: order.lineItems.nodes.map((l) => ({ title: l.title, variant: l.variantTitle && l.variantTitle !== 'Default Title' ? l.variantTitle : null, qty: l.quantity,
        image: l.image ? `${l.image.url}${l.image.url.includes('?') ? '&' : '?'}width=160` : null })),
      shipments: order.fulfillments.map((f) => ({
        shippedAt: f.createdAt, status: f.displayStatus, estimate: f.estimatedDeliveryAt, inTransitAt: f.inTransitAt, deliveredAt: f.deliveredAt,
        tracking: f.trackingInfo.filter((t) => t.number).map((t) => ({ number: t.number })),
        events: f.events.nodes.map((e) => ({ status: e.status, at: e.happenedAt, message: hideCarrier(e.message) || null, place: [e.city, e.country].filter(Boolean).join(', ') || null })),
      })),
    };
  }
  return null;
}
