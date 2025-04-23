#!/bin/bash

# Single-Step Netlify GitHub Deployment Test Script
# This script tests the complete flow in a single API call with shouldDeploy=true

# Define colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Debugging mode (set to true for verbose output)
DEBUG=true

# Configuration - Edit these values
API_BASE_URL="http://localhost:5173"  # Change to your server URL
PROJECT_NAME="test-netlify-oneshot"
GITHUB_TOKEN=${GITHUB_TOKEN:-""}  # Set your GitHub token as an environment variable
GITHUB_OWNER=${GITHUB_OWNER:-""}  # Set your GitHub username as an environment variable
NETLIFY_TOKEN=${NETLIFY_TOKEN:-""}  # Set your Netlify token as an environment variable

# Create temp files for storing request/response
TEMP_DIR=$(mktemp -d)
REQUEST_FILE="$TEMP_DIR/request.json"
RESPONSE_FILE="$TEMP_DIR/response.json"
HEADERS_FILE="$TEMP_DIR/headers.txt"

# Clean up temp files on exit
cleanup() {
  if [ "$DEBUG" = true ]; then
    echo -e "${BLUE}[DEBUG] Temp files remain at: $TEMP_DIR for inspection${NC}"
  else
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

# Print header
echo -e "${GREEN}===== Single-Step Netlify GitHub Deployment Test =====${NC}"
echo -e "API URL: ${API_BASE_URL}"
echo -e "Project Name: ${PROJECT_NAME}"
echo

# Check if curl is installed
if ! command -v curl &> /dev/null; then
  echo -e "${RED}Error: curl is not installed. Please install curl to run this script.${NC}"
  exit 1
fi

# Check if jq is installed (optional but helpful for parsing JSON)
JQ_AVAILABLE=false
if command -v jq &> /dev/null; then
  JQ_AVAILABLE=true
  echo -e "${GREEN}jq is available. Will use for JSON parsing.${NC}"
else
  echo -e "${YELLOW}Note: jq is not installed. Basic parsing will be used instead.${NC}"
fi

# Debug function
debug() {
  if [ "$DEBUG" = true ]; then
    local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
    echo -e "${BLUE}[DEBUG ${timestamp}] $1${NC}"
  fi
}

# Add more detailed error handling
error() {
  local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
  echo -e "${RED}[ERROR ${timestamp}] $1${NC}"
  if [ "$DEBUG" = true ] && [ ! -z "$2" ]; then
    echo -e "${RED}Details: $2${NC}"
  fi
}

# Add a warning function
warning() {
  local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
  echo -e "${YELLOW}[WARNING ${timestamp}] $1${NC}"
}

# More descriptive step function
step() {
  local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
  echo -e "${GREEN}[STEP ${timestamp}] $1${NC}"
}

# Add a success function
success() {
  local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
  echo -e "${GREEN}[SUCCESS ${timestamp}] $1${NC}"
}

# Check if required tokens are set
if [ -z "$GITHUB_TOKEN" ]; then
  echo -e "${RED}Error: GitHub token is not set. Edit this script to add your token.${NC}"
  exit 1
fi

if [ -z "$NETLIFY_TOKEN" ]; then
  echo -e "${RED}Error: Netlify token is not set. Edit this script to add your token.${NC}"
  exit 1
fi

# Create request payload JSON file for easier debugging
cat > "$REQUEST_FILE" << EOF
{
  "projectName": "${PROJECT_NAME}",
  "requirements": "Create a simple React app with a homepage that displays a counter.",
  "shouldDeploy": true,
  "deploymentTarget": "netlify-github",
  "setupGitHub": true,
  "githubCredentials": {
    "token": "${GITHUB_TOKEN}",
    "owner": "${GITHUB_OWNER}"
  },
  "netlifyCredentials": {
    "apiToken": "${NETLIFY_TOKEN}"
  }
}
EOF

debug "Created request payload in $REQUEST_FILE"

# One-step deployment request
step "Sending combined requirements+deployment request..."
debug "Sending POST request to ${API_BASE_URL}/api/requirements"

# Send the request and save response to file
curl -s -X POST "${API_BASE_URL}/api/requirements" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -D "$HEADERS_FILE" \
  -o "$RESPONSE_FILE" \
  --data-binary "@$REQUEST_FILE"

# Check if the request was successful
HTTP_STATUS=$(grep -oP 'HTTP/[\d.]+ \K\d+' "$HEADERS_FILE" | head -1)
debug "HTTP Status: ${HTTP_STATUS:-Unknown}"

# Output response file contents
if [ -f "$RESPONSE_FILE" ]; then
  RESPONSE_SIZE=$(wc -c < "$RESPONSE_FILE")
  debug "Response size: $RESPONSE_SIZE bytes"
  debug "Response content:"
  cat "$RESPONSE_FILE" | tee >(debug)
else
  debug "No response file found!"
fi

# Parse response using jq if available
if [ "$JQ_AVAILABLE" = true ]; then
  debug "Parsing JSON with jq..."
  PROJECT_ID=$(jq -r '.projectId // ""' "$RESPONSE_FILE")
  DEPLOYMENT_URL=$(jq -r '.deployment.url // ""' "$RESPONSE_FILE")
  DEPLOYMENT_STATUS=$(jq -r '.deployment.status // ""' "$RESPONSE_FILE")
  FILES_GENERATED=$(jq -r '.filesGenerated // 0' "$RESPONSE_FILE")
  ARCHIVE_KEY=$(jq -r '.archive.key // ""' "$RESPONSE_FILE")
  SUCCESS=$(jq -r '.success // false' "$RESPONSE_FILE")
  ERROR=$(jq -r '.error // ""' "$RESPONSE_FILE")
else
  debug "Parsing JSON with grep..."
  # Fallback to grep if jq is not available
  PROJECT_ID=$(grep -o '"projectId":"[^"]*"' "$RESPONSE_FILE" | sed 's/"projectId":"//;s/"//')
  DEPLOYMENT_URL=$(grep -o '"url":"[^"]*"' "$RESPONSE_FILE" | sed 's/"url":"//;s/"//')
  DEPLOYMENT_STATUS=$(grep -o '"status":"[^"]*"' "$RESPONSE_FILE" | sed 's/"status":"//;s/"//')
  FILES_GENERATED=$(grep -o '"filesGenerated":[0-9]*' "$RESPONSE_FILE" | sed 's/"filesGenerated"://;s/,//')
  ARCHIVE_KEY=$(grep -o '"key":"[^"]*"' "$RESPONSE_FILE" | sed 's/"key":"//;s/"//')
  SUCCESS=$(grep -o '"success":\(true\|false\)' "$RESPONSE_FILE" | sed 's/"success"://;s/,//')
  ERROR=$(grep -o '"error":"[^"]*"' "$RESPONSE_FILE" | sed 's/"error":"//;s/"//')
fi

debug "Extracted values:"
debug "- PROJECT_ID: $PROJECT_ID"
debug "- DEPLOYMENT_URL: $DEPLOYMENT_URL"
debug "- DEPLOYMENT_STATUS: $DEPLOYMENT_STATUS"
debug "- FILES_GENERATED: $FILES_GENERATED"
debug "- ARCHIVE_KEY: $ARCHIVE_KEY"
debug "- SUCCESS: $SUCCESS"
debug "- ERROR: $ERROR"

if [ -z "$PROJECT_ID" ]; then
  echo -e "${RED}Error: Project creation failed.${NC}"
  cat "$RESPONSE_FILE"
  if [ ! -z "$ERROR" ]; then
    echo -e "${RED}Error message: $ERROR${NC}"
  fi
  exit 1
fi

step "Project created successfully!"
echo "Project ID: $PROJECT_ID"
echo "Files generated: ${FILES_GENERATED:-N/A}"
if [ ! -z "$ARCHIVE_KEY" ]; then
  echo "Archive key: $ARCHIVE_KEY"
fi

# Check deployment status
if [ -z "$DEPLOYMENT_URL" ]; then
  echo -e "${YELLOW}No deployment information found in the response.${NC}"
  step "Checking the current state of the project to verify deployment status..."
  
  # Get project details to check if deployment was added
  echo "{\"projectId\":\"$PROJECT_ID\"}" > "$TEMP_DIR/project_request.json"
  curl -s -X POST "${API_BASE_URL}/api/debug-projects" \
    -H "Content-Type: application/json" \
    -o "$TEMP_DIR/project_details.json" \
    --data-binary "@$TEMP_DIR/project_request.json"
  
  debug "Project details response:"
  cat "$TEMP_DIR/project_details.json" | tee >(debug)
  
  # Extract deployment information from project details
  if [ "$JQ_AVAILABLE" = true ]; then
    HAS_DEPLOYMENTS=$(jq 'if .project.deployments and (.project.deployments | length > 0) then true else false end' "$TEMP_DIR/project_details.json")
    LATEST_DEPLOYMENT_URL=$(jq -r 'if .project.deployments and (.project.deployments | length > 0) then .project.deployments[0].url else "" end' "$TEMP_DIR/project_details.json")
    LATEST_DEPLOYMENT_STATUS=$(jq -r 'if .project.deployments and (.project.deployments | length > 0) then .project.deployments[0].status else "" end' "$TEMP_DIR/project_details.json")
    GITHUB_METADATA=$(jq -r 'if .project.metadata and .project.metadata.github then .project.metadata.github.fullName else "" end' "$TEMP_DIR/project_details.json")
  else
    # Basic check without jq
    HAS_DEPLOYMENTS=$(grep -o '"deployments":\[\{' "$TEMP_DIR/project_details.json" > /dev/null && echo "true" || echo "false")
    LATEST_DEPLOYMENT_URL=$(grep -o '"url":"[^"]*"' "$TEMP_DIR/project_details.json" | head -1 | sed 's/"url":"//;s/"//')
    LATEST_DEPLOYMENT_STATUS=$(grep -o '"status":"[^"]*"' "$TEMP_DIR/project_details.json" | head -1 | sed 's/"status":"//;s/"//')
    GITHUB_METADATA=$(grep -o '"github":{[^}]*}' "$TEMP_DIR/project_details.json" > /dev/null && echo "true" || echo "false")
  fi
  
  if [ "$HAS_DEPLOYMENTS" = "true" ] && [ ! -z "$LATEST_DEPLOYMENT_URL" ]; then
    step "Found deployment in project metadata!"
    echo "Deployment URL: $LATEST_DEPLOYMENT_URL"
    echo "Deployment Status: ${LATEST_DEPLOYMENT_STATUS:-Unknown}"
    DEPLOYMENT_URL=$LATEST_DEPLOYMENT_URL
    DEPLOYMENT_STATUS=$LATEST_DEPLOYMENT_STATUS
  else
    echo -e "${YELLOW}No deployments found in project metadata.${NC}"
    if [ "$GITHUB_METADATA" = "true" ]; then
      echo -e "${YELLOW}Project has GitHub metadata but no deployments recorded.${NC}"
    else 
      echo -e "${RED}No GitHub metadata found. GitHub repository may not have been created.${NC}"
    fi
  fi
else
  step "Deployment initiated!"
  echo "Deployment Status: $DEPLOYMENT_STATUS"
  echo "Deployment URL: $DEPLOYMENT_URL"
fi

# Summary
echo
step "===== Test Summary ====="
echo "Project ID: $PROJECT_ID"
echo "Files Generated: ${FILES_GENERATED:-0}"
if [ ! -z "$DEPLOYMENT_URL" ]; then
  echo "Deployment URL: $DEPLOYMENT_URL"
  echo "Deployment Status: ${DEPLOYMENT_STATUS:-Unknown}"
fi
echo
echo -e "${YELLOW}Note: If deployment status is 'in-progress', you may need to wait for the build to complete on Netlify.${NC}"
echo "You can visit the deployment URL in a few minutes to see your application." 

if [ -z "$DEPLOYMENT_URL" ]; then
  echo -e "${RED}WARNING: No deployment URL was returned. The deployment process may not have started.${NC}"
  echo -e "${YELLOW}Double-check server logs to see why deployment didn't occur.${NC}"
  exit 1
fi

exit 0 