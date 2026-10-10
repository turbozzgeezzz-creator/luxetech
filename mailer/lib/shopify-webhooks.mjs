// Registers the Shopify webhooks LuxeMail listens to, pointing at the given URL. Skips ones already there.
import { adminGql } from './shopify-token.mjs';

const uri = process.argv[2];
const TOPICS = ['CUSTOMERS_CREATE', 'CUSTOMERS_UPDATE', 'CHECKOUTS_CREATE', 'CHECKOUTS_UPDATE', 'ORDERS_CREATE'];

const existing = (await adminGql(`{ webhookSubscriptions(first: 100) { nodes { id topic uri } } }`)).webhookSubscriptions.nodes;
let failed = false;
for (const topic of TOPICS) {
  if (existing.some((w) => w.topic === topic && w.uri === uri)) { console.log(`   ${topic}: already registered`); continue; }
  // An older LuxeMail address for the same topic gets replaced.
  for (const old of existing.filter((w) => w.topic === topic && /luxemail/.test(w.uri))) {
    await adminGql(`mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { userErrors { message } } }`, { id: old.id });
  }
  const res = (await adminGql(`mutation($t: WebhookSubscriptionTopic!, $s: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $t, webhookSubscription: $s) { webhookSubscription { id } userErrors { message } } }`,
    { t: topic, s: { uri, format: 'JSON' } })).webhookSubscriptionCreate;
  if (res.userErrors.length) { failed = true; console.log(`   ${topic}: FAILED - ${res.userErrors.map((e) => e.message).join('; ')}`); }
  else console.log(`   ${topic}: registered`);
}
if (failed) {
  console.log('   Customer and checkout webhooks need "Protected customer data" (Name, Email) approved for the app.');
  process.exitCode = 1;
}
