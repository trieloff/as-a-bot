#!/bin/bash
SECRET="$BROKER_CLIENT_SECRET"
BODY='{}'
AUTH=$(echo -n "GET/health${BODY}" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

# First verify the worker is responding
echo "Checking worker health..."
curl -s https://as-bot-worker.minivelos.workers.dev/health | jq -r '.service'

# Try to get app info via GitHub API directly
echo ""
echo "Getting GitHub App info..."

# Create a simple JWT and query GitHub
curl -sH "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/app-manifests/$GITHUB_APP_ID" 2>/dev/null || \
curl -sH "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/apps/$GITHUB_APP_ID" 2>/dev/null || \
echo "Note: App details require authentication. Check https://github.com/settings/apps"
