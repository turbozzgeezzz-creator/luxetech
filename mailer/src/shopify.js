// Shopify access for LuxeMail: client-credentials token, Admin GraphQL, order verification,
// best-effort unsubscribe, one-off discount codes, and public storefront JSON
// (products, recommendations, collections, blog feed).
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

/* ---------- Public storefront data (no token needed) ---------- */

async function storefrontJson(env, path) {
  const res = await fetch(env.STORE_URL + path, { headers: { Accept: 'application/json' }, cf: { cacheTtl: 900 } });
  if (!res.ok) return null;
  return res.json();
}

export function normaliseProduct(env, p) {
  if (!p || !p.handle) return null;
  let image = p.featured_image || (p.images && p.images[0] && (p.images[0].src || p.images[0])) || null;
  if (image && image.startsWith('//')) image = 'https:' + image;
  const cents = typeof p.price === 'number' ? p.price
    : p.variants && p.variants[0] ? Math.round(parseFloat(p.variants[0].price) * 100) : null;
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    url: `${env.STORE_URL}/products/${p.handle}`,
    image,
    price: cents,
    available: p.available !== false,
  };
}

export async function productByHandle(env, handle) {
  return normaliseProduct(env, await storefrontJson(env, `/products/${encodeURIComponent(handle)}.js`));
}

export async function recommendations(env, productId, limit = 4) {
  const body = await storefrontJson(env, `/recommendations/products.json?product_id=${productId}&limit=${limit}`);
  return body && body.products ? body.products.map((p) => normaliseProduct(env, p)).filter((p) => p && p.available) : [];
}

export async function collectionProducts(env, handle, limit = 6) {
  const body = await storefrontJson(env, `/collections/${handle}/products.json?limit=${limit}`);
  return body && body.products ? body.products.map((p) => normaliseProduct(env, p)).filter(Boolean) : [];
}

export async function latestArticles(env, limit = 3) {
  const res = await fetch(`${env.STORE_URL}/blogs/news.atom`, { cf: { cacheTtl: 900 } });
  if (!res.ok) return [];
  const xml = await res.text();
  const strip = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;.*?&gt;/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  return xml.split('<entry>').slice(1, limit + 1).map((entry) => {
    const pick = (re) => { const m = entry.match(re); return m ? m[1] : ''; };
    return {
      title: strip(pick(/<title[^>]*>([\s\S]*?)<\/title>/)),
      url: pick(/<link[^>]*href="([^"]+)"/),
      summary: strip(pick(/<summary[^>]*>([\s\S]*?)<\/summary>/)).slice(0, 160),
    };
  }).filter((a) => a.title && a.url);
}
