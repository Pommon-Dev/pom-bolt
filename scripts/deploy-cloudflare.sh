#!/bin/bash

# Cloudflare Pages Deployment Script
# This script builds and deploys your application to Cloudflare Pages,
# then purges the cache to ensure the latest version is available.

# Display a colorful header
echo -e "\033[1;34m
========================================
 Cloudflare Pages Deployment
========================================
\033[0m"

# Check if API token is set in environment
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  # Check if .env.production exists and has the token
  if [ -f ".env.production" ]; then
    CLOUDFLARE_API_TOKEN=$(grep CLOUDFLARE_API_TOKEN .env.production | sed 's/.*=//')
    if [ "$CLOUDFLARE_API_TOKEN" = "your-api-token-here" ]; then
      echo -e "\033[1;31mError: CLOUDFLARE_API_TOKEN is not set in .env.production\033[0m"
      echo "Please update .env.production with your actual Cloudflare API token"
      exit 1
    fi
  else
    echo -e "\033[1;31mError: CLOUDFLARE_API_TOKEN environment variable is not set\033[0m"
    echo "Please set it in .env.production or export it in your shell"
    exit 1
  fi
fi

# Check if account ID is set in environment
if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  # Check if .env.production exists and has the account ID
  if [ -f ".env.production" ]; then
    CLOUDFLARE_ACCOUNT_ID=$(grep CLOUDFLARE_ACCOUNT_ID .env.production | sed 's/.*=//')
    if [ "$CLOUDFLARE_ACCOUNT_ID" = "your-account-id-here" ]; then
      echo -e "\033[1;31mError: CLOUDFLARE_ACCOUNT_ID is not set in .env.production\033[0m"
      exit 1
    fi
  else
    echo -e "\033[1;31mError: CLOUDFLARE_ACCOUNT_ID environment variable is not set\033[0m"
    exit 1
  fi
fi

PROJECT_NAME="pom-bolt"

# Verify the project exists or create it
echo -e "\033[1;32m[1/4] Verifying Cloudflare Pages project...\033[0m"
PROJECT_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT_NAME" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json")

if [ "$PROJECT_CHECK" != "200" ]; then
  echo "Project doesn't exist. Creating project $PROJECT_NAME..."
  npx wrangler pages project create $PROJECT_NAME
  
  if [ $? -ne 0 ]; then
    echo -e "\033[1;31mFailed to create project! Please create it manually in the Cloudflare dashboard.\033[0m"
    exit 1
  fi
  echo -e "\033[1;32mProject created successfully.\033[0m"
else
  echo -e "\033[1;32mProject verified successfully.\033[0m"
fi

# Step 2: Build the application
echo -e "\033[1;32m[2/4] Building application...\033[0m"
NODE_ENV=production pnpm run build
if [ $? -ne 0 ]; then
  echo -e "\033[1;31mBuild failed! Check the errors above.\033[0m"
  exit 1
fi
echo -e "\033[1;32mBuild completed successfully.\033[0m"

# Step 3: Deploy to Cloudflare Pages
echo -e "\033[1;32m[3/4] Deploying to Cloudflare Pages...\033[0m"
npx wrangler pages deploy build/client \
  --project-name=$PROJECT_NAME \
  --commit-message="Deploy $(date +'%Y-%m-%d %H:%M:%S')"
if [ $? -ne 0 ]; then
  echo -e "\033[1;31mDeployment failed! Check the errors above.\033[0m"
  exit 1
fi
echo -e "\033[1;32mDeployment completed successfully.\033[0m"

# Step 4: Purge cache
echo -e "\033[1;32m[4/4] Purging Cloudflare Pages cache...\033[0m"

# Give Cloudflare a moment to process the deployment
echo "Waiting for deployment to be processed..."
sleep 5

# Get deployment ID
DEPLOYMENT_RESPONSE=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT_NAME/deployments?page=1&per_page=1" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json")

DEPLOYMENT_COUNT=$(echo "$DEPLOYMENT_RESPONSE" | grep -o '"result":\[\]' | wc -l)

if [ "$DEPLOYMENT_COUNT" -gt 0 ]; then
  echo -e "\033[1;33mNo deployments found yet. Skipping cache purge.\033[0m"
else
  DEPLOYMENT_ID=$(echo "$DEPLOYMENT_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  
  if [ -z "$DEPLOYMENT_ID" ]; then
    echo -e "\033[1;33mCould not find deployment ID. Skipping cache purge.\033[0m"
  else
    echo "Purging cache for deployment $DEPLOYMENT_ID..."
    
    PURGE_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT_NAME/deployments/$DEPLOYMENT_ID/cache_purge" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data '{"purge_everything":true}')
    
    SUCCESS=$(echo "$PURGE_RESPONSE" | grep -o '"success":true' | wc -l)
    
    if [ "$SUCCESS" -gt 0 ]; then
      echo -e "\033[1;32mCache purged successfully.\033[0m"
    else
      echo -e "\033[1;31mCache purge failed! Response:\033[0m"
      echo "$PURGE_RESPONSE"
    fi
  fi
fi

echo -e "\033[1;34m
========================================
 Deployment Complete!
 Your application is now live.
========================================
\033[0m" 