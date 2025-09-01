# GitHub App Token Broker for Cloudflare Workers

A secure token broker service that manages GitHub App tokens, providing both installation tokens and user-to-server tokens via OAuth device flow.

## Features

- **Installation Tokens**: Mint GitHub App installation tokens for automated workflows
- **User-to-Server Tokens**: Support explicit user attribution via OAuth device flow
- **Security**: HMAC authentication, rate limiting, CORS protection
- **Performance**: Runs on Cloudflare Workers edge network
- **Minimal Dependencies**: Uses Web Crypto API for JWT signing

## Setup

### 1. Create GitHub App

1. Go to GitHub Settings > Developer settings > GitHub Apps
2. Create a new GitHub App with required permissions
3. Generate and download a private key
4. Note the App ID and Client ID

### 2. Create Cloudflare KV Namespaces

```bash
wrangler kv:namespace create "RATE_LIMIT"
wrangler kv:namespace create "DEVICE_CODES"
```

Update `wrangler.toml` with the generated namespace IDs.

### 3. Configure Secrets

```bash
# GitHub App credentials
wrangler secret put GITHUB_APP_PRIVATE_KEY  # Paste entire PEM key
wrangler secret put GITHUB_APP_ID           # Numeric App ID
wrangler secret put GITHUB_CLIENT_ID        # Client ID

# Broker authentication
wrangler secret put BROKER_CLIENT_SECRET    # Your shared secret

# For GitHub Actions deployment
# Add CLOUDFLARE_TOKEN to your GitHub repository secrets
```

### 4. Deploy

```bash
npm install
wrangler deploy
```

## API Usage

### Get Installation Token

```bash
# By installation ID
curl -X POST https://your-worker.workers.dev/token \
  -H "Content-Type: application/json" \
  -H "X-Client-Auth: $(echo -n 'POST/token{"installation_id":123}' | openssl dgst -sha256 -hmac $SECRET -binary | base64)" \
  -d '{"installation_id": 123}'

# By repository
curl -X POST https://your-worker.workers.dev/token \
  -H "Content-Type: application/json" \
  -H "X-Client-Auth: $(echo -n 'POST/token{"owner":"org","repo":"repo"}' | openssl dgst -sha256 -hmac $SECRET -binary | base64)" \
  -d '{"owner": "org", "repo": "repo"}'
```

### User-to-Server Token (Device Flow)

```bash
# Start device flow
curl -X POST https://your-worker.workers.dev/user-token/start \
  -H "Content-Type: application/json" \
  -H "X-Client-Auth: $(echo -n 'POST/user-token/start{"scopes":"repo user"}' | openssl dgst -sha256 -hmac $SECRET -binary | base64)" \
  -d '{"scopes": "repo user"}'

# Poll for token
curl -X POST https://your-worker.workers.dev/user-token/poll \
  -H "Content-Type: application/json" \
  -H "X-Client-Auth: $(echo -n 'POST/user-token/poll{"device_code":"..."}' | openssl dgst -sha256 -hmac $SECRET -binary | base64)" \
  -d '{"device_code": "..."}'
```

### Shell Integration

```bash
# Export token for GitHub CLI
export GH_TOKEN=$(curl -sS -X POST https://your-worker.workers.dev/token \
  -H "Content-Type: application/json" \
  -H "X-Client-Auth: $(echo -n 'POST/token{"installation_id":123}' | openssl dgst -sha256 -hmac $SECRET -binary | base64)" \
  -d '{"installation_id": 123}' | jq -r .token)

# Use with GitHub CLI
gh api user --jq .login
```

## Authentication

All requests require HMAC-SHA256 authentication via `X-Client-Auth` header:

1. Construct message: `METHOD + PATH + BODY`
2. Sign with shared secret using HMAC-SHA256
3. Base64 encode the signature
4. Send as `X-Client-Auth` header

## Rate Limiting

- 100 requests per hour per IP address
- Returns 429 status when exceeded
- Uses Cloudflare Workers KV for distributed tracking

## Security Features

- HMAC authentication on all endpoints
- No token storage or caching
- Automatic expiration headers
- CORS protection (configurable origins)
- Content Security Policy headers
- Rate limiting per IP

## Testing

```bash
npm test
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_APP_PRIVATE_KEY` | RSA private key in PEM format | Yes |
| `GITHUB_APP_ID` | Numeric GitHub App ID | Yes |
| `GITHUB_CLIENT_ID` | GitHub App Client ID | Yes |
| `BROKER_CLIENT_SECRET` | Shared secret for HMAC auth | Yes |
| `GITHUB_API` | GitHub API URL (default: https://api.github.com) | No |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | No |

## Endpoints

- `POST /token` - Get installation access token
- `POST /user-token/start` - Start OAuth device flow
- `POST /user-token/poll` - Poll for user token

## Response Format

### Installation Token
```json
{
  "token": "ghs_...",
  "expires_at": "2024-01-01T00:00:00Z",
  "permissions": {...},
  "repositories": [...]
}
```

### Device Flow Start
```json
{
  "device_code": "...",
  "user_code": "XXXX-XXXX",
  "verification_uri": "https://github.com/login/device",
  "expires_in": 900,
  "interval": 5
}
```

### User Token
```json
{
  "access_token": "ghu_...",
  "token_type": "bearer",
  "expires_at": "2024-01-01T00:00:00Z",
  "scope": "repo user"
}
```

## License

MIT