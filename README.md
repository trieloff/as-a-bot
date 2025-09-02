# GitHub App Token Broker for ai-aligned-gh

A minimal Cloudflare Worker that provides user-to-server GitHub tokens via device flow for `ai-aligned-gh`. 

**Key Feature**: Actions appear as the user (with app badge), not as "app/as-a-bot".

## 🎯 Problem Solved

- ❌ **Without this worker**: PRs show `app/as-a-bot` as author
- ✅ **With this worker**: PRs show `username` + app badge as author

## 🚀 Quick Start

### Prerequisites

1. **GitHub App with Device Flow enabled**:
   - Go to your GitHub App settings
   - Check ✅ "Enable Device Flow"
   - Note the Client ID

2. **Cloudflare Workers account**

### Deploy

```bash
# Clone and install
git clone https://github.com/trieloff/as-a-bot
cd as-a-bot
npm install

# Configure
wrangler secret put GITHUB_CLIENT_ID  # Enter your GitHub App Client ID

# Deploy
wrangler deploy
```

## 🔌 API Endpoints

Only two endpoints needed for device flow:

### Start Device Flow
```bash
POST /user-token/start
Body: {"scopes": "repo"}

Response:
{
  "device_code": "...",
  "user_code": "ABCD-1234",
  "verification_uri": "https://github.com/login/device",
  "expires_in": 900,
  "interval": 5
}
```

### Poll for Token
```bash
POST /user-token/poll
Body: {"device_code": "..."}

Response:
{
  "access_token": "ghu_...",  # User-to-server token
  "token_type": "bearer",
  "expires_at": "...",
  "scope": "repo"
}
```

## 🔧 Integration with ai-aligned-gh

`ai-aligned-gh` will automatically use this worker to get properly attributed tokens:

```bash
# Configure ai-aligned-gh with your worker URL
export AS_A_BOT_WORKER_URL="https://your-worker.workers.dev"

# Use ai-aligned-gh normally - it handles the device flow
ai-aligned-gh pr create --title "My PR" --body "Properly attributed!"
```

## 📝 Manual Testing

```bash
# Start device flow
RESPONSE=$(curl -sS -X POST https://your-worker.workers.dev/user-token/start \
  -H "Content-Type: application/json" \
  -d '{"scopes": "repo"}')

# Extract values
USER_CODE=$(echo $RESPONSE | jq -r .user_code)
DEVICE_CODE=$(echo $RESPONSE | jq -r .device_code)

# Show instructions
echo "1. Go to: https://github.com/login/device"
echo "2. Enter code: $USER_CODE"
echo "3. Then run: curl -X POST https://your-worker.workers.dev/user-token/poll -d '{\"device_code\":\"$DEVICE_CODE\"}'"
```

## 🔍 Verify Attribution

Create a test issue to verify proper attribution:

```bash
# Get token from device flow
TOKEN="ghu_..."  # Your user-to-server token

# Create issue
curl -X POST https://api.github.com/repos/OWNER/REPO/issues \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "body": "Should show me as author with app badge"}'
```

**Expected**: Issue shows your username + app badge, NOT "app/as-a-bot"

## ⚙️ Configuration

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_CLIENT_ID` | GitHub App Client ID | Yes |
| `GITHUB_API` | GitHub API URL (default: https://api.github.com) | No |

## 🏗️ Architecture

```
ai-aligned-gh
     ↓
[Device Flow Start] → User authorizes on GitHub
     ↓
[Device Flow Poll] → Receives user-to-server token
     ↓
GitHub API calls show proper user attribution
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

## 📄 License

Apache 2.0