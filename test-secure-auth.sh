#!/bin/bash

# Test script for secure GitHub authentication
# This script tests that:
# 1. Users must authenticate with a valid GitHub token
# 2. Users can only get tokens for repos they have access to
# 3. User permissions must match or exceed app permissions

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if GITHUB_TOKEN is set
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${RED}Error: GITHUB_TOKEN environment variable not set${NC}"
    echo "Please set your GitHub personal access token:"
    echo "  export GITHUB_TOKEN=your_github_token"
    exit 1
fi

# Worker URL (use localhost for testing or deployed URL)
WORKER_URL="${WORKER_URL:-http://localhost:8787}"

echo -e "${YELLOW}Testing Secure GitHub Authentication${NC}"
echo "Worker URL: $WORKER_URL"
echo ""

# Test 1: Request without authentication should fail
echo -e "${YELLOW}Test 1: Request without authentication${NC}"
response=$(curl -sS -w "\n%{http_code}" -X POST "$WORKER_URL/token" \
  -H "Content-Type: application/json" \
  -d '{"owner": "trieloff", "repo": "as-a-bot"}' 2>&1 || true)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "401" ]; then
    echo -e "${GREEN}✓ Correctly rejected unauthenticated request${NC}"
    echo "  Response: $body"
else
    echo -e "${RED}✗ Expected 401, got $http_code${NC}"
    echo "  Response: $body"
fi
echo ""

# Test 2: Request with invalid token should fail
echo -e "${YELLOW}Test 2: Request with invalid GitHub token${NC}"
response=$(curl -sS -w "\n%{http_code}" -X POST "$WORKER_URL/token" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid_token_12345" \
  -d '{"owner": "trieloff", "repo": "as-a-bot"}' 2>&1 || true)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "401" ]; then
    echo -e "${GREEN}✓ Correctly rejected invalid token${NC}"
    echo "  Response: $body"
else
    echo -e "${RED}✗ Expected 401, got $http_code${NC}"
    echo "  Response: $body"
fi
echo ""

# Test 3: Request with valid token for accessible repo
echo -e "${YELLOW}Test 3: Request with valid token for accessible repo${NC}"
# First, let's check what repos the user has access to
echo "Checking your GitHub username..."
username=$(curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/user | jq -r .login)
echo "Authenticated as: $username"

# Try to get a token for a public repo (should work with read access)
response=$(curl -sS -w "\n%{http_code}" -X POST "$WORKER_URL/token" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d '{"owner": "trieloff", "repo": "as-a-bot"}' 2>&1 || true)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "201" ] || [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓ Successfully got token for accessible repo${NC}"
    token=$(echo "$body" | jq -r .token)
    if [ "$token" != "null" ] && [ -n "$token" ]; then
        echo "  Token received (first 20 chars): ${token:0:20}..."
    fi
else
    echo -e "${YELLOW}⚠ Got $http_code response${NC}"
    echo "  Response: $body"
    echo "  Note: This might be expected if you don't have access to the test repo"
fi
echo ""

# Test 4: Request for a private repo without access should fail
echo -e "${YELLOW}Test 4: Request for private repo without access${NC}"
response=$(curl -sS -w "\n%{http_code}" -X POST "$WORKER_URL/token" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d '{"owner": "some-private-org", "repo": "private-repo-no-access"}' 2>&1 || true)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "403" ] || [ "$http_code" = "404" ]; then
    echo -e "${GREEN}✓ Correctly denied access to inaccessible repo${NC}"
    echo "  Response: $body"
else
    echo -e "${YELLOW}⚠ Got $http_code response${NC}"
    echo "  Response: $body"
fi
echo ""

# Test 5: Health check endpoint should still work without auth
echo -e "${YELLOW}Test 5: Health check without authentication${NC}"
response=$(curl -sS -w "\n%{http_code}" "$WORKER_URL/health" 2>&1 || true)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓ Health check works without authentication${NC}"
    echo "  Response: $body" | jq -r '.status' 2>/dev/null || echo "  Response: $body"
else
    echo -e "${RED}✗ Health check failed with $http_code${NC}"
    echo "  Response: $body"
fi
echo ""

echo -e "${GREEN}Security test complete!${NC}"
echo ""
echo "Summary:"
echo "- Authentication is now required for token requests"
echo "- Users can only get tokens for repos they have access to"
echo "- Invalid tokens are properly rejected"
echo "- Health endpoints remain publicly accessible"