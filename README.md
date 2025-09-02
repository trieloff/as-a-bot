# GitHub App Token Broker for Cloudflare Workers

![As-A-Bot Token Broker](./hero-image.png)

A secure token broker service that manages GitHub App tokens, providing both installation tokens and user-to-server tokens via OAuth device flow.

🌐 **Live at**: https://as-bot-worker.minivelos.workers.dev

## Features

- **Installation Tokens**: Mint GitHub App installation tokens for automated workflows
- **User-to-Server Tokens**: Support explicit user attribution via OAuth device flow (optional, requires KV)
- **Security**: GitHub token authentication with permission validation
- **Privilege Prevention**: Ensures users can't escalate permissions beyond their access level
- **Performance**: Runs on Cloudflare Workers edge network
- **Minimal Dependencies**: Uses Web Crypto API for JWT signing
- **Health Check**: Built-in health endpoint for monitoring

## Installation for End Users

To use the As-A-Bot GitHub App in your repositories:

1. **Install the GitHub App**: Visit https://github.com/apps/as-a-bot-app
2. **Select repositories**: Choose which repositories the app should have access to
3. **Configure permissions**: Grant the necessary permissions for your use case
4. **Start using the API**: Once installed, you can request tokens for your repositories using the API endpoints

## Setup for Self-Hosting

### 1. Create GitHub App

1. Go to GitHub Settings > Developer settings > GitHub Apps
2. Create a new GitHub App with required permissions
3. Generate and download a private key
4. Note the App ID and Client ID

### 2. Deploy to Cloudflare Workers

```bash
npm install
wrangler deploy
```

Note: Device flow requires KV namespace. To enable it:
```bash
wrangler kv:namespace create "DEVICE_CODES"
# Update wrangler.toml with the namespace ID
```

### 3. Configure Secrets

```bash
# GitHub App credentials
wrangler secret put GITHUB_APP_PRIVATE_KEY  # Paste entire PEM key
wrangler secret put GITHUB_APP_ID           # Numeric App ID
wrangler secret put GITHUB_CLIENT_ID        # Client ID

# For GitHub Actions deployment
# Add CLOUDFLARE_TOKEN to your GitHub repository secrets
```

## API Usage

### Health Check

```bash
curl https://as-bot-worker.minivelos.workers.dev/health
```

### Get Installation Token

```bash
# Authenticate with your GitHub personal access token
curl -X POST https://as-bot-worker.minivelos.workers.dev/token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d '{"owner": "org", "repo": "repo"}'
```

### User-to-Server Token (Device Flow)

Note: Requires KV namespace configuration.

```bash
# Start device flow
curl -X POST https://as-bot-worker.minivelos.workers.dev/user-token/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d '{"scopes": "repo user"}'

# Poll for token
curl -X POST https://as-bot-worker.minivelos.workers.dev/user-token/poll \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d '{"device_code": "..."}'
```

### Shell Integration

```bash
# Export token for GitHub CLI
export GH_TOKEN=$(curl -sS -X POST https://as-bot-worker.minivelos.workers.dev/token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d '{"owner": "org", "repo": "repo"}' | jq -r .token)

# Use with GitHub CLI
gh api user --jq .login
```

## Authentication

All requests require GitHub authentication via `Authorization: Bearer` header:

1. Obtain a GitHub personal access token or OAuth token
2. Send as `Authorization: Bearer <token>` header
3. The broker verifies:
   - Token validity
   - User has access to the requested repository
   - User permissions match or exceed app requirements

## Utility Scripts

### Installation Checker

Check if the GitHub App is installed on a repository:

```bash
# First, set your GitHub token
export GITHUB_TOKEN=your_github_token

# Check installation status
./check-app owner/repo

# Examples
./check-app trieloff/as-a-bot  # Check this repo
./check-app facebook/react      # Check any repo
```

The script will:
- Verify if the app is installed
- Show installation URL if not installed
- Offer to open browser for installation (interactive mode)

## Security Features

- GitHub token authentication with user verification
- Repository access validation
- Permission matching to prevent privilege escalation
- No token storage or caching
- Automatic expiration headers
- CORS protection (configurable origins)
- Content Security Policy headers
- Audit logging of all token requests

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
| `GITHUB_API` | GitHub API URL (default: https://api.github.com) | No |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | No |

## Endpoints

- `GET /health` - Health check and service info
- `POST /token` - Get installation access token
- `POST /user-token/start` - Start OAuth device flow (requires KV)
- `POST /user-token/poll` - Poll for user token (requires KV)

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

## Related Projects

This project is part of a suite of tools designed to improve the AI coding agent experience on GitHub:

### 🤖 AI Agent Tools

- **[ai-aligned-git](https://github.com/trieloff/ai-aligned-git)** - Git wrapper that ensures AI agent commits are properly attributed with co-authorship
- **[ai-aligned-gh](https://github.com/trieloff/ai-aligned-gh)** - Transparent GitHub CLI wrapper that automatically attributes AI-initiated actions to a bot acting on the user's behalf

### 📊 Developer Tools

- **[gh-workflow-peek](https://github.com/trieloff/gh-workflow-peek)** - GitHub CLI extension for intelligently filtering and highlighting errors in GitHub Actions workflow logs
- **[vibe-coded-badge-action](https://github.com/trieloff/vibe-coded-badge-action)** - GitHub Action that analyzes your repository's git history to display the percentage of AI-generated commits

Together, these tools create a transparent and accountable environment for AI-assisted development on GitHub.

## License

Apache 2.0