// LuxeMail no longer uses Shopify webhooks (customer and checkout data is redacted for this app).
// Removes any LuxeMail webhooks an earlier deploy registered, so Shopify stops posting to a route that's gone.
import { adminGql } from './shopify-token.mjs';

const existing = (await adminGql(`{ webhookSubscriptions(first: 100) { nodes { id topic uri } } }`)).webhookSubscriptions.nodes;
const ours = existing.filter((w) => /luxemail/.test(w.uri || ''));
for (const w of ours) {
  await adminGql(`mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { userErrors { message } } }`, { id: w.id });
  console.log(`   removed old ${w.topic} webhook`);
}
if (!ours.length) console.log('   none registered');
