# GitHub App Token Broker for Cloudflare Workers

![As-A-Bot Token Broker](./hero-image.png)

A secure token broker service that provides **user-to-server GitHub tokens** with proper user attribution. Actions performed with these tokens appear as the user (with app badge), not as the app itself.

🌐 **Live at**: https://as-bot-worker.minivelos.workers.dev

## 🚀 Key Features

- **✅ Proper User Attribution**: Actions show as "username" + app badge, not "app/as-a-bot"
- **🔐 User-to-Server Tokens**: OAuth device flow and web OAuth for user-attributed tokens  
- **🚫 No Installation Tokens**: Removed app-level tokens that act as the bot
- **🌐 Multiple Auth Flows**: Device flow (CLI-friendly) and web OAuth (browser-friendly)
- **⚡ Serverless**: Runs on Cloudflare Workers edge network
- **🔒 Secure**: No authentication required for token endpoints (OAuth handles security)
- **📊 Audit Trail**: Proper "GitHub App user-to-server token" attribution in logs

## 🎯 User Attribution Comparison

| Method | Author Shown | Attribution | Use Case |
|--------|--------------|-------------|----------|
| **This Worker** | `username` + badge ✅ | User | Proper attribution |
| ~~Installation Tokens~~ | `app/as-a-bot` ❌ | App | Removed (wrong attribution) |
| Personal Access Token | `username` | User | No app association |

## 📋 Installation for End Users

To use the As-A-Bot GitHub App in your repositories:

1. **Install the GitHub App**: Visit https://github.com/apps/as-a-bot-app
2. **Select repositories**: Choose which repositories the app should have access to
3. **Configure permissions**: Grant the necessary permissions for your use case
4. **Get tokens**: Use the API endpoints below to get user-attributed tokens

## 🔧 Setup for Self-Hosting

### 1. Create GitHub App

1. Go to GitHub Settings > Developer settings > GitHub Apps
2. Create a new GitHub App with required permissions
3. Note the **Client ID** (you don't need the private key anymore!)

### 2. Deploy to Cloudflare Workers

```bash
npm install
wrangler deploy
```

### 3. Configure Secrets

```bash
# Only need the Client ID now!
wrangler secret put GITHUB_CLIENT_ID        # Client ID

# Optional: For device flow persistence (recommended)
wrangler kv:namespace create "DEVICE_CODES"
# Update wrangler.toml with the namespace ID
```

## 🔌 API Usage

### Health Check

```bash
curl https://as-bot-worker.minivelos.workers.dev/health
```

### Method 1: Device Flow (CLI-Friendly) 

Perfect for CLI tools like `ai-aligned-gh`:

```bash
# Start device flow
curl -X POST https://as-bot-worker.minivelos.workers.dev/user-token/start \
  -H "Content-Type: application/json" \
  -d '{"scopes": "repo"}'

# Response: {"device_code": "...", "user_code": "ABCD-1234", "verification_uri": "https://github.com/login/device", ...}

# Go to verification_uri and enter user_code
# Then poll for token:

curl -X POST https://as-bot-worker.minivelos.workers.dev/user-token/poll \
  -H "Content-Type: application/json" \
  -d '{"device_code": "YOUR_DEVICE_CODE"}'

# Response: {"access_token": "ghu_...", "token_type": "bearer", ...}
```

### Method 2: Web OAuth Flow (Browser-Friendly)

Perfect for web applications:

```bash
# Start OAuth flow
curl -X POST https://as-bot-worker.minivelos.workers.dev/oauth/authorize \
  -H "Content-Type: application/json" \
  -d '{"scopes": "repo", "state": "random-state"}'

# Response: {"authorization_url": "https://github.com/login/oauth/authorize?client_id=...", ...}
# Redirect user to authorization_url

# After user approval, GitHub redirects to your callback with a code
# Exchange code for token:

curl -X POST https://as-bot-worker.minivelos.workers.dev/oauth/callback \
  -H "Content-Type: application/json" \
  -d '{"code": "AUTH_CODE", "state": "random-state"}'

# Response: {"access_token": "ghu_...", "token_type": "bearer", ...}
```

### Shell Integration

```bash
# Device flow for CLI tools
DEVICE_DATA=$(curl -sS -X POST https://as-bot-worker.minivelos.workers.dev/user-token/start -d '{}')
echo "Go to: $(echo $DEVICE_DATA | jq -r .verification_uri)"
echo "Enter code: $(echo $DEVICE_DATA | jq -r .user_code)"

# Poll for token (repeat until success)
DEVICE_CODE=$(echo $DEVICE_DATA | jq -r .device_code)
export GH_TOKEN=$(curl -sS -X POST https://as-bot-worker.minivelos.workers.dev/user-token/poll \
  -d "{\"device_code\": \"$DEVICE_CODE\"}" | jq -r .access_token)

# Use with GitHub CLI (will show proper user attribution!)
gh api user --jq .login
gh pr create --title "Test PR" --body "Created with user-attributed token"
```

## 🔍 Verifying User Attribution

Create an issue to test proper attribution:

```bash
curl -X POST https://api.github.com/repos/OWNER/REPO/issues \
  -H "Authorization: Bearer YOUR_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test issue from user-to-server token",
    "body": "This should show me as the author with app badge!"
  }'
```

**Expected Result:**
- ✅ Issue shows **your username** as the author
- ✅ **App badge** appears next to your name
- ✅ GitHub audit logs show: `"programmatic_access_type": "GitHub App user-to-server token"`

## 🛡️ Security Features

- **No Pre-Authentication Required**: OAuth flows handle security directly with GitHub
- **Proper User Scoping**: Tokens respect user's existing permissions  
- **No Token Storage**: Stateless operation (except optional device code caching)
- **Automatic Expiration**: Tokens expire according to GitHub's OAuth policy
- **CORS Protection**: Configurable allowed origins
- **CSP Headers**: Content Security Policy protection

## 🧪 Testing

```bash
npm test  # All tests should pass
```

See `test-user-attribution.md` for detailed testing instructions.

## ⚙️ Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_CLIENT_ID` | GitHub App Client ID | Yes |
| `GITHUB_API` | GitHub API URL (default: https://api.github.com) | No |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | No |

## 📡 Endpoints

| Endpoint | Method | Purpose | Authentication |
|----------|---------|---------|---------------|
| `/health` | GET | Health check and service info | None |
| `/user-token/start` | POST | Start OAuth device flow | None (OAuth handles it) |
| `/user-token/poll` | POST | Poll for user token | None (OAuth handles it) |
| `/oauth/authorize` | POST | Start web OAuth flow | None (OAuth handles it) |
| `/oauth/callback` | POST | Complete web OAuth flow | None (OAuth handles it) |

## 📝 Response Formats

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

### User Token (Both Flows)
```json
{
  "access_token": "ghu_...",  // User-to-server token!
  "token_type": "bearer",
  "expires_at": "2024-01-01T00:00:00Z", 
  "scope": "repo user"
}
```

### OAuth Authorize
```json
{
  "authorization_url": "https://github.com/login/oauth/authorize?client_id=...&scope=repo",
  "message": "Redirect user to authorization_url to complete OAuth flow"
}
```

## 🎯 Integration Examples

### With ai-aligned-gh

This worker is designed to work with `ai-aligned-gh`:

```bash
# ai-aligned-gh can use device flow automatically
ai-aligned-gh pr create --title "AI-generated PR" --body "Proper user attribution!"
```

### With GitHub CLI

```bash  
# Use device flow to get token
export GH_TOKEN=$(# ... device flow commands from above ...)

# All gh commands will show proper user attribution
gh pr create --title "My PR" --body "Shows as me + app badge"
```

## 🚫 What Was Removed

- **`/token` endpoint**: Generated installation tokens that acted as the app
- **Installation tokens**: Always showed "app/as-a-bot" as author
- **GitHub token authentication**: No longer needed (OAuth handles auth)
- **Permission validation logic**: OAuth scopes handle this properly

## 🔄 Migration Guide

If you were using the old `/token` endpoint:

1. **Replace** installation token requests with device/OAuth flow
2. **Update** your tools to use the new endpoints  
3. **Enjoy** proper user attribution in all GitHub activity!

## 📄 License

Apache 2.0