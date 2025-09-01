#!/bin/bash
SECRET="$BROKER_CLIENT_SECRET"

# Try with a test installation ID 
BODY='{"installation_id":1}'
AUTH=$(echo -n "POST/token${BODY}" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

echo "Testing with installation_id=1..."
response=$(curl -sS -X POST https://as-bot-worker.minivelos.workers.dev/token \
  -H "Content-Type: application/json" \
  -H "X-Client-Auth: $AUTH" \
  -d "$BODY" \
  -w "\n\nHTTP_STATUS:%{http_code}")

echo "$response" | head -n -1 | jq '.' 2>/dev/null || echo "$response"
echo "$response" | tail -n 1
