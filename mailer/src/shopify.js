// Shopify access for LuxeMail: client-credentials token, Admin GraphQL, order verification,
// best-effort unsubscribe, one-off discount codes, and product, collection and blog data.
import { now, randomCode } from './util.js';

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

/** Best effort only: without protected customer data access Shopify may not find or update the customer. */
export async function unsubscribeInShopify(env, email) {
  const data = await gql(env, `query($q:String!){ customers(first:1, query:$q){ nodes{ id } } }`, { q: `email:${JSON.stringify(email)}` });
  const c = data.customers.nodes[0];
  if (!c) return;
  await gql(env, `mutation($input: CustomerEmailMarketingConsentUpdateInput!){
      customerEmailMarketingConsentUpdate(input:$input){ userErrors{ message } } }`, {
    input: { customerId: c.id, emailMarketingConsent: { marketingState: 'UNSUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN' } },
  });
}

/**
 * Creates a real, single-use code, e.g. BACK5-7KQ2M, sent to one person only. Customer IDs aren't reliable
 * without protected customer data, so the code isn't tied to a customer; the single use keeps it personal.
 * It expires after `days`, and the email states that date, so any urgency in the copy is genuine.
 */
export async function createPersonalCode(env, { prefix, percent, days, title }) {
  const code = `${prefix}-${randomCode(5)}`;
  const endsAt = new Date(Date.now() + days * 86400000).toISOString();
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

/* ---------- Products, collections and blog posts (Admin API) ---------- */
// The storefront's public JSON (/products/x.js etc.) refuses requests from Cloudflare Workers,
// so product data comes from the Admin API, which this app can read (read_products, read_content).

const PRODUCT_FIELDS = `legacyResourceId handle title status onlineStoreUrl
  featuredMedia{ preview{ image{ url } } } priceRangeV2{ minVariantPrice{ amount } } variants(first: 20){ nodes{ availableForSale } }`;

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
    image: image ? `${image}${image.includes('?') ? '&' : '?'}width=560&height=560&crop=center` : null,
    price: p.priceRangeV2 ? Math.round(parseFloat(p.priceRangeV2.minVariantPrice.amount) * 100) : null,
    // On sale only if active, published to the online store, and at least one variant can be bought.
    available: p.status === 'ACTIVE' && !!p.onlineStoreUrl && (p.variants ? p.variants.nodes.some((v) => v.availableForSale) : true),
  };
}

export async function productByHandle(env, handle) {
  const data = await gql(env, `query($h: String!){ productByIdentifier(identifier: { handle: $h }){ ${PRODUCT_FIELDS} } }`, { h: handle });
  return normaliseProduct(env, data.productByIdentifier);
}

/** "You might also like": other products from the same collections (skipping the catch-all ones). */
export async function recommendations(env, productId, limit = 4) {
  const data = await gql(env, `query($id: ID!, $n: Int!){ product(id: $id){ handle collections(first: 5){ nodes{ handle
      products(first: $n, sortKey: COLLECTION_DEFAULT){ nodes{ ${PRODUCT_FIELDS} } } } } } }`,
    { id: `gid://shopify/Product/${String(productId).replace(/\D/g, '')}`, n: limit + 4 });
  if (!data.product) return [];
  const generic = ['all', 'frontpage', 'best-sellers', 'new-arrivals'];
  const cols = [...data.product.collections.nodes].sort((a, b) => generic.includes(a.handle) - generic.includes(b.handle));
  const seen = new Set([data.product.handle]);
  const out = [];
  for (const c of cols) {
    for (const node of c.products.nodes) {
      const p = normaliseProduct(env, node);
      if (p && p.available && !seen.has(p.handle)) { seen.add(p.handle); out.push(p); }
    }
  }
  return out.slice(0, limit);
}

export async function collectionProducts(env, handle, limit = 6) {
  const data = await gql(env, `query($h: String!, $n: Int!){ collectionByIdentifier(identifier: { handle: $h }){
      products(first: $n, sortKey: COLLECTION_DEFAULT){ nodes{ ${PRODUCT_FIELDS} } } } }`, { h: handle, n: limit + 4 });
  if (!data.collectionByIdentifier) return [];
  return data.collectionByIdentifier.products.nodes.map((n) => normaliseProduct(env, n)).filter((p) => p && p.available).slice(0, limit);
}

export async function latestArticles(env, limit = 3) {
  const data = await gql(env, `query($n: Int!){ articles(first: $n, sortKey: PUBLISHED_AT, reverse: true, query: "published_status:published"){
      nodes{ title handle summary blog{ handle } } } }`, { n: limit });
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  return data.articles.nodes.map((a) => ({
    title: a.title,
    url: `${env.STORE_URL}/blogs/${a.blog.handle}/${a.handle}`,
    summary: strip(a.summary).slice(0, 160),
  }));
}
