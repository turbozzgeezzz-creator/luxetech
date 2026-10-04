#!/usr/bin/env sh
# Builds an uploadable theme zip (theme folders at the zip root) for manual
# upload. Not needed when the store is connected to this repo through
# Shopify's GitHub integration.
set -e
cd "$(dirname "$0")"
mkdir -p dist
rm -f dist/luxetech-theme.zip
zip -rq dist/luxetech-theme.zip layout templates sections snippets assets config locales -x '.*'
echo "Wrote $(pwd)/dist/luxetech-theme.zip"
