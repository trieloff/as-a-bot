# GitHub App Token Broker - Deployment Information

## Deployed Worker

The GitHub App Token Broker has been successfully deployed to Cloudflare Workers:

🌐 **URL**: https://as-bot-worker.minivelos.workers.dev

## Current Configuration

- **Worker Name**: as-bot-worker
- **Account**: AEM Demo (155ec15a52a18a14801e04b019da5e5a)
- **Rate Limiting**: Disabled (removed to simplify deployment)
- **Device Flow**: Available but requires KV namespace setup for production

## Test Endpoints

### Health Check
```bash
curl https://as-bot-worker.minivelos.workers.dev/health
```

### Get Installation Token (requires real GitHub App credentials)
```bash
SECRET="your-broker-secret"
BODY='{"installation_id": 123}'
AUTH=$(echo -n "POST/token${BODY}" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

curl -X POST https://as-bot-worker.minivelos.workers.dev/token \
  -H "Content-Type: application/json" \
  -H "X-Client-Auth: $AUTH" \
  -d "$BODY"
```

## Configured Secrets (Test Values)

The following secrets have been configured with test values:
- `BROKER_CLIENT_SECRET` - Test HMAC secret
- `GITHUB_APP_ID` - Test App ID
- `GITHUB_CLIENT_ID` - Test Client ID  
- `GITHUB_APP_PRIVATE_KEY` - Test RSA private key

⚠️ **Important**: Replace these with real GitHub App credentials for production use.

## Production Setup

To use with a real GitHub App:

1. Create a GitHub App with required permissions
2. Update the secrets with real values:
   ```bash
   wrangler secret put GITHUB_APP_PRIVATE_KEY  # Paste real PEM key
   wrangler secret put GITHUB_APP_ID           # Real App ID
   wrangler secret put GITHUB_CLIENT_ID        # Real Client ID
   wrangler secret put BROKER_CLIENT_SECRET    # Your secure secret
   ```

3. (Optional) Enable device flow by creating KV namespace:
   ```bash
   wrangler kv namespace create "DEVICE_CODES"
   # Update wrangler.toml with the namespace ID
   ```

## API Documentation

The worker exposes the following endpoints:

- `GET /health` - Health check endpoint
- `POST /token` - Get GitHub App installation token
- `POST /user-token/start` - Start OAuth device flow (requires KV)
- `POST /user-token/poll` - Poll for device flow token (requires KV)

All POST endpoints require HMAC authentication via `X-Client-Auth` header.

## Monitoring

View logs in real-time:
```bash
wrangler tail
```

## Updates

To update the worker:
```bash
wrangler deploy
```