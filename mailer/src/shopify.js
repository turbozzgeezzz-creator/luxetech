// Shopify access for LuxeMail: client-credentials token, Admin GraphQL, webhook verification,
// marketing consent, segment members, one-off discount codes, and public storefront JSON
// (products, recommendations, collections, blog feed).
import { now, randomCode, hmacBase64 } from './util.js';

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

/** Shopify signs app webhooks with the app's client secret (HMAC-SHA256, base64). */
export async function verifyWebhook(env, rawBody, headerHmac) {
  if (!headerHmac) return false;
  const expected = await hmacBase64(env.SHOPIFY_CLIENT_SECRET, rawBody);
  if (expected.length !== headerHmac.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ headerHmac.charCodeAt(i);
  return diff === 0;
}

/** Marketing consent straight from Shopify, checked right before every send. */
export async function marketingStatus(env, email) {
  const data = await gql(env, `query($q:String!){ customers(first:1, query:$q){ nodes{
      id firstName numberOfOrders defaultEmailAddress{ emailAddress marketingState } } } }`,
    { q: `email:${JSON.stringify(email)}` });
  const c = data.customers.nodes[0];
  if (!c) return { subscribed: false };
  return {
    subscribed: !!(c.defaultEmailAddress && c.defaultEmailAddress.marketingState === 'SUBSCRIBED'),
    customerId: c.id,
    firstName: c.firstName,
    orders: Number(c.numberOfOrders || 0),
  };
}

export async function unsubscribeInShopify(env, email) {
  const status = await marketingStatus(env, email);
  if (!status.customerId) return;
  await gql(env, `mutation($input: CustomerEmailMarketingConsentUpdateInput!){
      customerEmailMarketingConsentUpdate(input:$input){ userErrors{ message } } }`, {
    input: {
      customerId: status.customerId,
      emailMarketingConsent: { marketingState: 'UNSUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN' },
    },
  });
}

/** Members of a customer segment, looked up by its name (VIP, Lapsed, Email subscribers). */
export async function segmentMembers(env, segmentName, limit = 1000) {
  const seg = await gql(env, `query($q:String!){ segments(first:10, query:$q){ nodes{ id name } } }`, { q: segmentName });
  const found = seg.segments.nodes.find((s) => s.name === segmentName);
  if (!found) throw new Error(`Segment not found: ${segmentName}`);
  const out = [];
  let after = null;
  while (out.length < limit) {
    const data = await gql(env, `query($s:ID!, $after:String){ customerSegmentMembers(first:100, segmentId:$s, after:$after){
        pageInfo{ hasNextPage endCursor }
        edges{ node{ id firstName defaultEmailAddress{ emailAddress marketingState } amountSpent{ amount } } } } }`,
      { s: found.id, after });
    const conn = data.customerSegmentMembers;
    for (const { node } of conn.edges) {
      const email = node.defaultEmailAddress && node.defaultEmailAddress.emailAddress;
      // Without protected customer data access Shopify returns placeholder addresses; skip those.
      if (!email || email.endsWith('@example.com')) continue;
      out.push({
        email: email.toLowerCase(),
        firstName: node.firstName,
        subscribed: node.defaultEmailAddress.marketingState === 'SUBSCRIBED',
        customerId: node.id.replace('CustomerSegmentMember', 'Customer'),
        spent: Number(node.amountSpent ? node.amountSpent.amount : 0),
      });
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

/**
 * Creates a real, single-use code for one customer, e.g. BACK5-7KQ2M. It expires after `days`,
 * and the email states that expiry date, so any urgency in the copy is genuine.
 */
export async function createPersonalCode(env, { prefix, percent, days, customerId, title }) {
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
      context: customerId ? { customers: { add: [customerId] } } : { all: 'ALL' },
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
