#!/bin/bash

# Terminal colors
RESET="\033[0m"
RED="\033[31m"
GREEN="\033[32m"
BLUE="\033[34m"
BOLD="\033[1m"

# Configuration
SERVER_IP="167.99.114.235"
SERVER_USER="root"
SERVER_PATH="/var/www/clauderegistry/mcp-server"
SERVER_CONNECTION="${SERVER_USER}@${SERVER_IP}"

echo -e "${BLUE}${BOLD}Deploying MCP server to ${SERVER_CONNECTION}...${RESET}"
echo

# The service deploys by pulling main ON the server, so push to main first.
ssh "${SERVER_CONNECTION}" << 'EOF'
cd /var/www/clauderegistry/mcp-server || exit 1

echo "Pulling latest changes..."
git pull origin main || exit 1

echo "Installing dependencies..."
npm ci --omit=dev || exit 1

echo "Reloading PM2..."
pm2 startOrReload ecosystem.config.js --update-env || pm2 restart clauderegistry-mcp || exit 1
pm2 save || true

echo "Health check..."
sleep 2
curl -fsS http://127.0.0.1:8787/health || exit 1
echo

echo "✅ Deployment complete!"
EOF

if [ $? -eq 0 ]; then
    echo
    echo -e "${GREEN}${BOLD}✅ MCP server deployed successfully!${RESET}"
else
    echo
    echo -e "${RED}${BOLD}❌ Deployment failed${RESET}"
    exit 1
fi
