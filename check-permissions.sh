#!/bin/bash

# Get the token
SECRET="$GITHUB_TOKEN"
BODY='{"owner":"trieloff","repo":"as-a-bot"}'

echo "Getting token and checking permissions..."
response=$(curl -sS -X POST https://as-bot-worker.minivelos.workers.dev/token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d "$BODY")

echo "Token response:"
echo "$response" | jq '.'

TOKEN=$(echo "$response" | jq -r '.token')

echo ""
echo "Testing token with GitHub API - checking rate limit..."
curl -sS -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/rate_limit | jq '.rate'

echo ""
echo "Checking authenticated app/installation..."
curl -sS -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/installation/repositories | jq '.total_count, .repositories[].full_name' 2>/dev/null | head -10
