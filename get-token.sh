#!/bin/bash
SECRET="$BROKER_CLIENT_SECRET"
BODY='{"owner":"trieloff","repo":"as-a-bot"}'
AUTH=$(echo -n "POST/token${BODY}" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

echo "Getting installation token for trieloff/as-a-bot..."
response=$(curl -sS -X POST https://as-bot-worker.minivelos.workers.dev/token \
  -H "Content-Type: application/json" \
  -H "X-Client-Auth: $AUTH" \
  -d "$BODY")

echo "$response" | jq '.'

# Extract the token
TOKEN=$(echo "$response" | jq -r '.token')
if [ "$TOKEN" != "null" ] && [ -n "$TOKEN" ]; then
  echo ""
  echo "✅ Token obtained successfully!"
  echo "Token (first 10 chars): ${TOKEN:0:10}..."
  export GH_TOKEN="$TOKEN"
else
  echo ""
  echo "❌ Failed to get token"
  exit 1
fi
