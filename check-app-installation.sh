#!/bin/bash

# GitHub App Token Broker - Installation Checker
# Usage: ./check-app-installation.sh <owner> <repo>
# Example: ./check-app-installation.sh trieloff as-a-bot

set -e

# Configuration
APP_NAME="as-a-bot"
APP_URL="https://github.com/apps/${APP_NAME}"
BROKER_URL="https://as-bot-worker.minivelos.workers.dev"

# Colors for output (only if terminal supports it)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m' # No Color
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

# Function to print colored output
print_color() {
    echo -e "${1}${2}${NC}"
}

# Function to check if shell is interactive
is_interactive() {
    # Check if stdin is a terminal
    if [ -t 0 ] && [ -t 1 ]; then
        return 0
    else
        return 1
    fi
}

# Function to open URL
open_url() {
    local url=$1
    
    # Detect OS and open browser
    if command -v xdg-open > /dev/null 2>&1; then
        xdg-open "$url" 2>/dev/null
    elif command -v open > /dev/null 2>&1; then
        open "$url" 2>/dev/null
    elif command -v start > /dev/null 2>&1; then
        start "$url" 2>/dev/null
    else
        return 1
    fi
    return 0
}

# Check arguments
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <owner> <repo>"
    echo "Example: $0 trieloff as-a-bot"
    exit 1
fi

OWNER=$1
REPO=$2

print_color "$BLUE" "🔍 Checking GitHub App installation for ${OWNER}/${REPO}..."
echo ""

# Check if required environment variable is set
if [ -z "$GITHUB_TOKEN" ]; then
    print_color "$RED" "❌ Error: GITHUB_TOKEN environment variable is not set"
    echo "Please set your GitHub personal access token:"
    echo "  export GITHUB_TOKEN=your_github_token"
    exit 1
fi

# Prepare the request
BODY="{\"owner\":\"${OWNER}\",\"repo\":\"${REPO}\"}"

# Try to get a token for the repository
print_color "$BLUE" "Checking with token broker..."
response=$(curl -sS -X POST "${BROKER_URL}/token" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -d "$BODY" \
    -w "\n__HTTP_STATUS__%{http_code}" 2>/dev/null || echo "ERROR")

# Extract HTTP status code
http_status=$(echo "$response" | grep "__HTTP_STATUS__" | sed 's/__HTTP_STATUS__//')
response_body=$(echo "$response" | grep -v "__HTTP_STATUS__")

# Check the response
if [ "$http_status" = "201" ]; then
    # App is installed - token was successfully generated
    print_color "$GREEN" "✅ GitHub App '${APP_NAME}' is installed on ${OWNER}/${REPO}"
    
    # Extract token details
    expires_at=$(echo "$response_body" | jq -r '.expires_at' 2>/dev/null || echo "unknown")
    permissions=$(echo "$response_body" | jq -r '.permissions | keys | join(", ")' 2>/dev/null || echo "unknown")
    
    echo ""
    echo "Token details:"
    echo "  • Expires: ${expires_at}"
    echo "  • Permissions: ${permissions}"
    echo ""
    print_color "$GREEN" "You can use the token broker to generate installation tokens for this repository."
    
elif [ "$http_status" = "404" ]; then
    # App is not installed
    print_color "$YELLOW" "⚠️  GitHub App '${APP_NAME}' is NOT installed on ${OWNER}/${REPO}"
    echo ""
    echo "To use the token broker with this repository, you need to install the app."
    echo ""
    print_color "$BLUE" "Installation URL: ${APP_URL}"
    
    # If interactive shell, offer to open the browser
    if is_interactive; then
        echo ""
        read -p "Would you like to open the GitHub App page to install it? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_color "$BLUE" "Opening ${APP_URL} in your browser..."
            if open_url "$APP_URL"; then
                echo ""
                echo "After installation:"
                echo "1. Select the repository '${OWNER}/${REPO}'"
                echo "2. Click 'Install' or 'Save'"
                echo "3. Run this script again to verify installation"
            else
                print_color "$YELLOW" "Could not open browser automatically."
                echo "Please visit: ${APP_URL}"
            fi
        fi
    else
        # Non-interactive shell - just print instructions
        echo ""
        echo "To install the app:"
        echo "1. Visit ${APP_URL}"
        echo "2. Click 'Install' or 'Configure'"
        echo "3. Select the repository '${OWNER}/${REPO}'"
        echo "4. Click 'Install' or 'Save'"
    fi
    
elif [ "$http_status" = "401" ]; then
    print_color "$RED" "❌ Authentication failed"
    echo "Please check your GITHUB_TOKEN environment variable"
    exit 1
    
elif [ "$http_status" = "500" ]; then
    print_color "$RED" "❌ Server error from token broker"
    echo "Response: $response_body"
    exit 1
    
else
    print_color "$RED" "❌ Unexpected response (HTTP ${http_status})"
    echo "Response: $response_body"
    exit 1
fi

echo ""
print_color "$BLUE" "Token Broker URL: ${BROKER_URL}"
print_color "$BLUE" "GitHub App: ${APP_NAME} (ID: 1881227)"