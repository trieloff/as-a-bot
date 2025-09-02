#!/bin/bash
export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_TOKEN"

echo "Updating GITHUB_APP_PRIVATE_KEY..."
echo "$GITHUB_APP_PRIVATE_KEY" | npx wrangler secret put GITHUB_APP_PRIVATE_KEY >/dev/null 2>&1

echo "Updating GITHUB_APP_ID..."
echo "$GITHUB_APP_ID" | npx wrangler secret put GITHUB_APP_ID >/dev/null 2>&1

echo "Updating GITHUB_CLIENT_ID..."
echo "$GITHUB_CLIENT_ID" | npx wrangler secret put GITHUB_CLIENT_ID >/dev/null 2>&1

echo "✅ All secrets updated with real values"
