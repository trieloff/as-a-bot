#!/bin/bash
SECRET="$BROKER_CLIENT_SECRET"
BODY='{"owner":"trieloff","repo":"as-a-bot"}'
AUTH=$(echo -n "POST/token${BODY}" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

echo "Testing token generation for trieloff/as-a-bot..."
curl -X POST https://as-bot-worker.minivelos.workers.dev/token \
  -H "Content-Type: application/json" \
  -H "X-Client-Auth: $AUTH" \
  -d "$BODY" \
  -w "\n\nHTTP Status: %{http_code}\n" 2>/dev/null | jq '.'
