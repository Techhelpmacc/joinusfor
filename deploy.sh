#!/usr/bin/env bash
# Deploy the site to Cloudflare Pages.
#
# Wrangler writes a .wrangler/cache directory into the folder it deploys, which
# then gets published — it leaked the Cloudflare account id and owner email on
# 2026-08-18. Strip it before and after every upload.
set -e
cd "$(dirname "$0")"

find public -type d -name '.wrangler' -prune -exec rm -rf {} + 2>/dev/null || true

npx --yes wrangler@latest pages deploy public \
  --project-name=joinusfor --commit-dirty=true

find public -type d -name '.wrangler' -prune -exec rm -rf {} + 2>/dev/null || true
echo "Cleaned wrangler cache out of public/"
