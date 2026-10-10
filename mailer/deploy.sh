#!/usr/bin/env bash
# One-command LuxeMail deploy. Safe to run again: every step checks what already exists.
#
# Needs these environment variables (never printed):
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, RESEND_API_KEY,
#   SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
# and network access to api.cloudflare.com, api.resend.com, tech.luxedealers.com and the Shopify store.
#
# Steps: Resend domain check -> D1 database + schema -> secrets -> deploy -> PUBLIC_URL ->
#        Shopify webhooks -> theme tracking URL -> health check -> test emails to ADMIN_EMAIL.
set -euo pipefail
cd "$(dirname "$0")"

for v in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID RESEND_API_KEY SHOPIFY_CLIENT_ID SHOPIFY_CLIENT_SECRET; do
  if [ -z "${!v:-}" ]; then echo "Missing environment variable $v" >&2; exit 1; fi
done
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

WRANGLER="npx --yes wrangler@4.135.0"
SEND_DOMAIN="send.tech.luxedealers.com"

# Unsubscribe-link secret, derived from the Shopify client secret so every deploy gets the same value
# (changing it would break links in emails already sent).
UNSUB_SECRET="$(node -e 'const c=require("crypto");process.stdout.write(c.createHmac("sha256",process.env.SHOPIFY_CLIENT_SECRET).update("luxemail-unsubscribe-v1").digest("hex"))')"
export UNSUB_SECRET

echo "== 1. Resend sending domain"
DOMAIN_STATUS="$(node lib/resend-domain.mjs "$SEND_DOMAIN")"
echo "   $SEND_DOMAIN: $DOMAIN_STATUS"

echo "== 2. D1 database"
DB_ID="$($WRANGLER d1 list --json 2>/dev/null | node -e 'const l=JSON.parse(require("fs").readFileSync(0));const d=l.find(x=>x.name==="luxemail-tech");process.stdout.write(d?d.uuid:"")')"
if [ -z "$DB_ID" ]; then
  $WRANGLER d1 create luxemail-tech >/dev/null
  DB_ID="$($WRANGLER d1 list --json 2>/dev/null | node -e 'const l=JSON.parse(require("fs").readFileSync(0));const d=l.find(x=>x.name==="luxemail-tech");process.stdout.write(d?d.uuid:"")')"
fi
[ -n "$DB_ID" ] || { echo "Could not create the D1 database" >&2; exit 1; }
sed -i "s/^database_id = \".*\"/database_id = \"$DB_ID\"/" wrangler.toml
$WRANGLER d1 execute luxemail-tech --remote --file schema.sql --yes >/dev/null
echo "   database ready"

echo "== 3. Deploy"
DEPLOY_OUT="$($WRANGLER deploy 2>&1)" || { echo "$DEPLOY_OUT" >&2; exit 1; }
WORKER_URL="$(printf '%s' "$DEPLOY_OUT" | grep -oE 'https://luxemail-tech\.[a-z0-9-]+\.workers\.dev' | head -1)"
[ -n "$WORKER_URL" ] || { echo "$DEPLOY_OUT" >&2; echo "No workers.dev address found. Open Workers & Pages in Cloudflare once to choose a subdomain, then rerun." >&2; exit 1; }
if ! grep -q "PUBLIC_URL = \"$WORKER_URL\"" wrangler.toml; then
  sed -i "s#^PUBLIC_URL = \".*\"#PUBLIC_URL = \"$WORKER_URL\"#" wrangler.toml
  $WRANGLER deploy >/dev/null
fi
echo "   live at $WORKER_URL"

echo "== 4. Secrets"
SECRETS_FILE="$(mktemp)"; chmod 600 "$SECRETS_FILE"; trap 'rm -f "$SECRETS_FILE"' EXIT
node -e 'const e=process.env;require("fs").writeFileSync(process.argv[1],JSON.stringify({SHOPIFY_CLIENT_ID:e.SHOPIFY_CLIENT_ID,SHOPIFY_CLIENT_SECRET:e.SHOPIFY_CLIENT_SECRET,RESEND_API_KEY:e.RESEND_API_KEY,UNSUB_SECRET:e.UNSUB_SECRET}))' "$SECRETS_FILE"
$WRANGLER secret bulk "$SECRETS_FILE" >/dev/null
rm -f "$SECRETS_FILE"
echo "   4 secrets stored in Cloudflare"

echo "== 5. Shopify webhooks"
node lib/shopify-webhooks.mjs "$WORKER_URL/webhooks"

echo "== 6. Theme tracking URL"
node lib/theme-endpoint.mjs "$WORKER_URL/t"

echo "== 7. Health"
curl -fsS "$WORKER_URL/health"; echo

echo "== 8. Test emails"
if [ "$DOMAIN_STATUS" = "verified" ]; then
  for flow in welcome1 welcome2 cart1 browse wishlist vip fortnight; do
    printf '   %-10s ' "$flow"
    curl -fsS "$WORKER_URL/preview?flow=$flow&send=1&key=$UNSUB_SECRET" || echo "failed"
    echo
  done
else
  echo "   Skipped: $SEND_DOMAIN isn't verified in Resend yet (add its DNS records, then rerun this script)."
fi
echo "== 9. Save settings to GitHub (pushing to main makes the tracking live)"
cd ..
if ! git diff --quiet -- config/settings_data.json mailer/wrangler.toml; then
  git add config/settings_data.json mailer/wrangler.toml
  git commit -q -m "LuxeMail live: database id, Worker address and theme tracking URL"
  git push -q origin HEAD:main && echo "   pushed"
else
  echo "   nothing to change"
fi
echo "Done."
