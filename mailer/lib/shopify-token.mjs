// Admin API access for the deploy scripts, using the app's client credentials.
export async function adminGql(query, variables = {}) {
  const shop = process.env.SHOPIFY_STORE_DOMAIN || 'vyc3tw-gf.myshopify.com';
  if (!adminGql.token) {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET }),
    });
    if (!r.ok) throw new Error(`Shopify token request failed: ${r.status}`);
    adminGql.token = (await r.json()).access_token;
  }
  const r = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': adminGql.token },
    body: JSON.stringify({ query, variables }),
  });
  const body = await r.json();
  if (body.errors) throw new Error('Shopify GraphQL: ' + JSON.stringify(body.errors).slice(0, 400));
  return body.data;
}
