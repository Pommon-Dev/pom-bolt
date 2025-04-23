#!/bin/bash

# Netlify GitHub Deployment E2E Test Script
# This script tests the complete flow from project creation to GitHub repository setup to Netlify deployment.

# Define colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Configuration - Edit these values
API_BASE_URL="http://localhost:5173"  # Change to your server URL
PROJECT_NAME="test-netlify-deploy"
GITHUB_TOKEN=${GITHUB_TOKEN:-""}  # Set your GitHub token as an environment variable
GITHUB_OWNER=${GITHUB_OWNER:-""}  # Set your GitHub username as an environment variable
NETLIFY_TOKEN=${NETLIFY_TOKEN:-""}  # Set your Netlify token as an environment variable

# Print header
echo -e "${GREEN}===== Netlify GitHub Deployment E2E Test =====${NC}"
echo -e "API URL: ${API_BASE_URL}"
echo -e "Project Name: ${PROJECT_NAME}"
echo

# Check if required tokens are set
if [ -z "$GITHUB_TOKEN" ]; then
  echo -e "${RED}Error: GitHub token is not set. Edit this script to add your token.${NC}"
  exit 1
fi

if [ -z "$NETLIFY_TOKEN" ]; then
  echo -e "${RED}Error: Netlify token is not set. Edit this script to add your token.${NC}"
  exit 1
fi

# Step 1: Create a new project with requirements
echo -e "${GREEN}Step 1: Creating a new project...${NC}"
CREATE_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/api/requirements" \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "'"${PROJECT_NAME}"'",
    "requirements": "Create a simple React app with a homepage that displays a counter. Use Netlify for deployment.",
    "githubCredentials": {
      "token": "'"${GITHUB_TOKEN}"'",
      "owner": "'"${GITHUB_OWNER}"'"
    },
    "netlifyCredentials": {
      "apiToken": "'"${NETLIFY_TOKEN}"'"
    }
  }')

# Extract project ID from the response
PROJECT_ID=$(echo $CREATE_RESPONSE | grep -o '"projectId":"[^"]*"' | sed 's/"projectId":"//;s/"//')

if [ -z "$PROJECT_ID" ]; then
  echo -e "${RED}Error: Failed to create project or extract project ID.${NC}"
  echo "Response: $CREATE_RESPONSE"
  exit 1
fi

echo -e "${GREEN}Project created successfully!${NC}"
echo "Project ID: $PROJECT_ID"
echo

# Step 2: Wait for code generation to complete (optional)
echo -e "${YELLOW}Waiting 5 seconds for code generation to complete...${NC}"
sleep 5
echo

# Step 3: Deploy the project to Netlify via GitHub
echo -e "${GREEN}Step 3: Deploying project to Netlify via GitHub...${NC}"
DEPLOY_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/api/deploy" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'"${PROJECT_ID}"'",
    "targetName": "netlify-github",
    "setupGitHub": true,
    "githubCredentials": {
      "token": "'"${GITHUB_TOKEN}"'",
      "owner": "'"${GITHUB_OWNER}"'"
    },
    "netlifyCredentials": {
      "apiToken": "'"${NETLIFY_TOKEN}"'"
    }
  }')

# Extract deployment URL from the response
DEPLOYMENT_URL=$(echo $DEPLOY_RESPONSE | grep -o '"url":"[^"]*"' | sed 's/"url":"//;s/"//')
DEPLOYMENT_STATUS=$(echo $DEPLOY_RESPONSE | grep -o '"status":"[^"]*"' | sed 's/"status":"//;s/"//')

if [ -z "$DEPLOYMENT_URL" ]; then
  echo -e "${RED}Error: Deployment failed or couldn't extract deployment URL.${NC}"
  echo "Response: $DEPLOY_RESPONSE"
  exit 1
fi

echo -e "${GREEN}Deployment initiated!${NC}"
echo "Deployment Status: $DEPLOYMENT_STATUS"
echo "Deployment URL: $DEPLOYMENT_URL"
echo

# Step 4: Summary
echo -e "${GREEN}===== Test Summary =====${NC}"
echo "Project ID: $PROJECT_ID"
echo "Deployment URL: $DEPLOYMENT_URL"
echo "Deployment Status: $DEPLOYMENT_STATUS"
echo
echo -e "${YELLOW}Note: If deployment status is 'in-progress', you may need to wait for the build to complete on Netlify.${NC}"
echo "You can visit the deployment URL in a few minutes to see your application." 