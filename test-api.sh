#!/bin/bash
SECRET="test-broker-secret"
BODY='{"installation_id": 123}'
AUTH=$(echo -n "POST/token${BODY}" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

curl -X POST https://as-bot-worker.minivelos.workers.dev/token \
  -H "Content-Type: application/json" \
  -H "X-Client-Auth: $AUTH" \
  -d "$BODY" \
  -w "\n\nHTTP Status: %{http_code}\n"
