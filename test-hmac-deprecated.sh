#!/bin/bash

# Test deprecated HMAC authentication still works
SECRET="$BROKER_CLIENT_SECRET"

if [ -z "$SECRET" ]; then
    echo "BROKER_CLIENT_SECRET not set, skipping HMAC test"
    exit 0
fi

echo "Testing deprecated HMAC authentication..."
BODY='{"owner":"trieloff","repo":"as-a-bot"}'
MESSAGE="POST/token${BODY}"
AUTH=$(echo -n "$MESSAGE" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

response=$(curl -sS -w "\n%{http_code}" -X POST "https://as-bot-worker.minivelos.workers.dev/token" \
  -H "Content-Type: application/json" \
  -H "X-Client-Auth: $AUTH" \
  -d "$BODY" 2>&1 || true)

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

echo "HTTP Status: $http_code"
if [ "$http_code" = "201" ] || [ "$http_code" = "200" ]; then
    echo "HMAC auth still works (deprecated)"
    echo "Response (first 100 chars): ${body:0:100}..."
else
    echo "HMAC auth failed"
    echo "Response: $body"
fi