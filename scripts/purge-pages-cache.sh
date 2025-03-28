#!/bin/bash

# Check if account ID is provided
if [ -z "$1" ]; then
  echo "Error: Please provide your Cloudflare account ID as the first argument"
  echo "Usage: ./purge-pages-cache.sh ACCOUNT_ID API_TOKEN"
  exit 1
fi

# Check if API token is provided
if [ -z "$2" ]; then
  echo "Error: Please provide your Cloudflare API token as the second argument"
  echo "Usage: ./purge-pages-cache.sh ACCOUNT_ID API_TOKEN"
  exit 1
fi

ACCOUNT_ID="$1"
API_TOKEN="$2"
PROJECT_NAME="pom-bolt"

echo "Checking project status..."
PROJECT_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/$PROJECT_NAME" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json")

if [ "$PROJECT_CHECK" != "200" ]; then
  echo "⚠️ Project not found. Please create the project first with: npx wrangler pages project create $PROJECT_NAME"
  exit 1
fi

echo "Project verified. Finding latest deployment..."
DEPLOYMENTS_RESPONSE=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/$PROJECT_NAME/deployments?page=1&per_page=1" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json")

# Check if there are no deployments
DEPLOYMENT_COUNT=$(echo "$DEPLOYMENTS_RESPONSE" | grep -o '"result":\[\]' | wc -l)

if [ "$DEPLOYMENT_COUNT" -gt 0 ]; then
  echo "⚠️ No deployments found for $PROJECT_NAME."
  echo "Please deploy first with: pnpm run deploy:cloudflare"
  exit 0
fi

DEPLOYMENT_ID=$(echo "$DEPLOYMENTS_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$DEPLOYMENT_ID" ]; then
  echo "⚠️ Could not parse deployment ID from response. Please deploy first."
  exit 0
fi

echo "Purging cache for deployment $DEPLOYMENT_ID..."
PURGE_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/$PROJECT_NAME/deployments/$DEPLOYMENT_ID/cache_purge" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}')

SUCCESS=$(echo "$PURGE_RESPONSE" | grep -o '"success":true' | wc -l)

if [ "$SUCCESS" -gt 0 ]; then
  echo "✅ Cache purged successfully!"
else
  echo "❌ Failed to purge cache. Response:"
  echo "$PURGE_RESPONSE"
fi 