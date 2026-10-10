// Publishes the given collections (by handle) to the Online Store sales channel, if the app has write_publications.
import { adminGql } from './shopify-token.mjs';

const handles = process.argv.slice(2);
const scopes = (await adminGql(`{ currentAppInstallation { accessScopes { handle } } }`)).currentAppInstallation.accessScopes.map((s) => s.handle);
if (!scopes.includes('write_publications')) {
  console.log('   skipped: the app does not have write_publications');
  process.exit(0);
}
const pubs = (await adminGql(`{ publications(first: 20) { nodes { id name } } }`)).publications.nodes;
const store = pubs.find((p) => p.name === 'Online Store');
if (!store) { console.log('   skipped: no Online Store publication found'); process.exit(0); }
for (const handle of handles) {
  const c = (await adminGql(`query($h: String!, $p: ID!) { collectionByHandle(handle: $h) { id title publishedOnPublication(publicationId: $p) } }`, { h: handle, p: store.id })).collectionByHandle;
  if (!c) { console.log(`   ${handle}: not found`); continue; }
  if (c.publishedOnPublication) { console.log(`   ${handle}: already published`); continue; }
  const res = (await adminGql(`mutation($id: ID!, $p: ID!) { publishablePublish(id: $id, input: { publicationId: $p }) { userErrors { message } } }`, { id: c.id, p: store.id })).publishablePublish;
  console.log(res.userErrors.length ? `   ${handle}: FAILED - ${res.userErrors.map((e) => e.message).join('; ')}` : `   ${handle}: published`);
}
