#!/bin/bash

# Check if GITHUB_TOKEN is set
if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GITHUB_TOKEN environment variable not set"
    echo "Please set your GitHub personal access token:"
    echo "  export GITHUB_TOKEN=your_github_token"
    exit 1
fi

# Test with a specific repo
BODY='{"owner": "trieloff", "repo": "as-a-bot"}'

curl -X POST https://as-bot-worker.minivelos.workers.dev/token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d "$BODY" \
  -w "\n\nHTTP Status: %{http_code}\n"
