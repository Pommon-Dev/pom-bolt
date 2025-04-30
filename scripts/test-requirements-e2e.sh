#!/bin/bash

# E2E test script for requirements-to-project flow
# This script tests the full flow from submitting requirements to deploying a project

# Define colors for pretty output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the environment from the first argument
ENVIRONMENT=${1:-"local"}

# Set API base URL based on environment
case "$ENVIRONMENT" in
  "local")
    API_BASE_URL="http://localhost:5173"
    ;;
  "preview")
    API_BASE_URL="https://persistence-deploy.pom-bolt.pages.dev"
    ;;
  "prod" | "production")
    API_BASE_URL="https://pom-bolt.com"
    ;;
  *)
    echo -e "${RED}Invalid environment: $ENVIRONMENT${NC}"
    echo -e "Usage: $0 [local|preview|prod] [tenant_id] [--github] [--deploy] [--full]"
    exit 1
    ;;
esac

# Get tenant ID from the second argument (or default)
TENANT_ID=${2:-"default"}

# Parse additional options
SETUP_GITHUB=false
SHOULD_DEPLOY=false
for arg in "$@"; do
  case $arg in
    --github)
      SETUP_GITHUB=true
      ;;
    --deploy)
      SHOULD_DEPLOY=true
      ;;
    --full)
      SETUP_GITHUB=true
      SHOULD_DEPLOY=true
      ;;
  esac
done

# Configuration
GITHUB_TOKEN=${GITHUB_TOKEN:-""}
GITHUB_OWNER=${GITHUB_OWNER:-""}
# Check for both possible Netlify token env var names
NETLIFY_TOKEN=${NETLIFY_TOKEN:-${NETLIFY_AUTH_TOKEN:-""}}
# Debug mode for verbose output
DEBUG=${DEBUG:-true}

# Banner
echo -e "${BLUE}===============================================${NC}"
echo -e "${BLUE}   Pom Bolt Requirements-to-Project E2E Test   ${NC}"
echo -e "${BLUE}===============================================${NC}"
echo ""

# Check for DEBUG mode
if [ "$DEBUG" = true ]; then
  echo -e "${YELLOW}Debug mode enabled - verbose output will be shown${NC}"
  echo ""
fi

# Add function to print debug info
debug() {
  if [ "$DEBUG" = true ]; then
    echo -e "${BLUE}[DEBUG] $1${NC}"
  fi
}

# Add function to display credential info
debug_token() {
  local token=$1
  local name=$2
  if [ -n "$token" ]; then
    local len=${#token}
    local prefix=${token:0:4}
    local suffix=${token: -4}
    echo -e "${BLUE}[DEBUG] $name token details: Length=$len, Prefix=$prefix, Suffix=$suffix${NC}"
  else
    echo -e "${BLUE}[DEBUG] $name token is empty${NC}"
  fi
}

# Check for required credentials based on options
if [ "$SETUP_GITHUB" = true ] && [ -z "$GITHUB_TOKEN" -o -z "$GITHUB_OWNER" ]; then
  echo -e "${RED}Error: GitHub setup is enabled but credentials are missing. Please set:${NC}"
  [ -z "$GITHUB_TOKEN" ] && echo "  - GITHUB_TOKEN"
  [ -z "$GITHUB_OWNER" ] && echo "  - GITHUB_OWNER"
  echo -e "${RED}Aborting test as GitHub credentials are required for GitHub setup.${NC}"
  exit 1
fi

if [ "$SHOULD_DEPLOY" = true ] && [ -z "$NETLIFY_TOKEN" ]; then
  echo -e "${RED}Error: Deployment is enabled but Netlify token is missing. Please set:${NC}"
  echo "  - NETLIFY_TOKEN or NETLIFY_AUTH_TOKEN"
  echo -e "${RED}Aborting test as Netlify token is required for deployment.${NC}"
  exit 1
fi

# More detailed credentials debugging
if [ "$DEBUG" = true ]; then
  echo -e "${BLUE}==== Credential Details ====${NC}"
  debug_token "$GITHUB_TOKEN" "GitHub"
  debug_token "$NETLIFY_TOKEN" "Netlify"
  echo -e "${BLUE}============================${NC}"
  echo ""
fi

# Configuration output
echo -e "${BLUE}Test Configuration:${NC}"
echo -e "Environment: ${ENVIRONMENT}"
echo -e "API Base URL: ${API_BASE_URL}"
echo -e "Tenant ID: ${TENANT_ID}"
echo -e "Setup GitHub: ${SETUP_GITHUB}"
echo -e "Deploy: ${SHOULD_DEPLOY}"
if [ "$SETUP_GITHUB" = true ]; then
  echo -e "GitHub Owner: ${GITHUB_OWNER}"
  echo -e "GitHub Token: ${GITHUB_TOKEN:0:4}...${GITHUB_TOKEN:(-4)}" 2>/dev/null || echo -e "(Not provided)"
fi
if [ "$SHOULD_DEPLOY" = true ]; then
  echo -e "Netlify Token: ${NETLIFY_TOKEN:0:4}...${NETLIFY_TOKEN:(-4)}" 2>/dev/null || echo -e "(Not provided)"
fi
echo ""

# Function to create a random project name
random_project_name() {
  echo "TestProject-$(date +%s)"
}

# Function to check if a URL is reachable
check_url() {
  curl --silent --head --fail "$1" > /dev/null
  return $?
}

# Step 1: Submit requirements to generate a project
echo -e "${GREEN}Step 1: Submitting requirements to generate a project...${NC}"

PROJECT_NAME=$(random_project_name)
REQUIREMENTS="Create a simple landing page for a coffee shop called ${PROJECT_NAME}. The page should have a header with a logo and navigation menu, a hero section with a welcome message and a call-to-action button, a section showcasing the coffee menu with prices, and a footer with contact information and social media links."

echo -e "${YELLOW}Project name: $PROJECT_NAME${NC}"
echo -e "${YELLOW}Requirements:${NC} $REQUIREMENTS"

# Create JSON payload for the API request - aligned with NewFlowUpdates.md schema
create_payload() {
  local payload="{"
  
  # Basic project info
  payload+="\"content\":\"$REQUIREMENTS\","
  payload+="\"name\":\"$PROJECT_NAME\""
  
  # Explicitly add setupGitHub flag if enabled
  if [ "$SETUP_GITHUB" = true ]; then
    payload+=",\"setupGitHub\":true"
  fi
  
  # Add deployment configuration if needed
  if [ "$SHOULD_DEPLOY" = true ]; then
    payload+=",\"shouldDeploy\":true,"
    payload+="\"deploymentTarget\":\"netlify\""
  fi
  
  # Add credentials section - must be present for both flows
  if [ "$SETUP_GITHUB" = true ] || [ "$SHOULD_DEPLOY" = true ]; then
    payload+=",\"credentials\":{"
    
    # Add GitHub credentials
    if [ "$SETUP_GITHUB" = true ]; then
      payload+="\"github\":{\"token\":\"$GITHUB_TOKEN\",\"owner\":\"$GITHUB_OWNER\"}"
      if [ "$SHOULD_DEPLOY" = true ]; then
        payload+=","
      fi
    fi
    
    # Add Netlify credentials
    if [ "$SHOULD_DEPLOY" = true ]; then
      payload+="\"netlify\":{\"apiToken\":\"$NETLIFY_TOKEN\"}"
    fi
    
    payload+="}"
  fi
  
  payload+="}"
  echo "$payload"
}

# Generate the payload
PAYLOAD=$(create_payload)

# Debug output of payload
if [ "$DEBUG" = true ]; then
  echo -e "${BLUE}==== API Request Payload ====${NC}"
  echo "$PAYLOAD" | python3 -m json.tool 2>/dev/null || echo "$PAYLOAD"
  echo -e "${BLUE}============================${NC}"
  echo ""
fi

echo -e "${YELLOW}Submitting requirements...${NC}"
CREATE_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/api/requirements" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: ${TENANT_ID}" \
  -d "$PAYLOAD")

# Check if the request was successful
if [[ ! "$CREATE_RESPONSE" == *"\"success\":true"* ]]; then
  echo -e "${RED}Error: Failed to communicate with the API.${NC}"
  echo -e "${RED}Response: $CREATE_RESPONSE${NC}"
  exit 1
fi

echo -e "${YELLOW}API Response:${NC} $CREATE_RESPONSE"

# In debug mode, print the entire response in a more readable format
if [ "$DEBUG" = true ]; then
  echo ""
  echo -e "${BLUE}==== Complete API Response (formatted) ====${NC}"
  echo "$CREATE_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$CREATE_RESPONSE"
  echo -e "${BLUE}==========================================${NC}"
  echo ""
fi

# Extract project ID from response
PROJECT_ID=$(echo "$CREATE_RESPONSE" | grep -o '"projectId":"[^"]*"' | head -1 | sed 's/"projectId":"\([^"]*\)"/\1/')

if [ -z "$PROJECT_ID" ]; then
  echo -e "${RED}Error: Failed to extract project ID from response.${NC}"
  exit 1
fi

echo -e "${GREEN}Project created successfully!${NC}"
echo -e "Project ID: $PROJECT_ID"
echo ""

# Extract phases information
if [[ "$CREATE_RESPONSE" == *"\"phases\":"* ]]; then
  echo -e "${BLUE}Phases Results:${NC}"
  
  # Extract code generation phase status
  if [[ "$CREATE_RESPONSE" == *"\"codeGeneration\":"* ]]; then
    CODEGEN_STATUS=$(echo "$CREATE_RESPONSE" | grep -o '"codeGeneration":{[^}]*}' | grep -o '"status":"[^"]*"' | sed 's/"status":"//;s/"//')
    CODEGEN_ERROR=$(echo "$CREATE_RESPONSE" | grep -o '"codeGeneration":{[^}]*}' | grep -o '"error":"[^"]*"' | sed 's/"error":"//;s/"//')
    echo -e "  Code Generation: ${CODEGEN_STATUS:-'unknown'}"
    if [ -n "$CODEGEN_ERROR" ]; then
      echo -e "    Error: $CODEGEN_ERROR"
    fi
  else
    echo -e "  Code Generation: No results reported"
  fi
  
  # Extract GitHub phase status if present
  if [[ "$CREATE_RESPONSE" == *"\"github\":"* ]]; then
    GITHUB_STATUS=$(echo "$CREATE_RESPONSE" | grep -o '"github":{[^}]*}' | grep -o '"status":"[^"]*"' | sed 's/"status":"//;s/"//')
    GITHUB_ERROR=$(echo "$CREATE_RESPONSE" | grep -o '"github":{[^}]*}' | grep -o '"error":"[^"]*"' | sed 's/"error":"//;s/"//')
    GITHUB_URL=$(echo "$CREATE_RESPONSE" | grep -o '"repositoryUrl":"[^"]*"' | sed 's/"repositoryUrl":"//;s/"//')
    echo -e "  GitHub Setup: ${GITHUB_STATUS:-'unknown'}"
    if [ -n "$GITHUB_ERROR" ]; then
      echo -e "    Error: $GITHUB_ERROR"
    fi
    if [ -n "$GITHUB_URL" ]; then
      echo -e "    URL: $GITHUB_URL"
    fi
  elif [ "$SETUP_GITHUB" = true ]; then
    echo -e "  GitHub Setup: No results reported (but was requested)"
    echo -e "    This may indicate that the server does not yet implement Phase 2 from NewFlowUpdates.md"
  fi
  
  # Extract deployment phase status if present
  if [[ "$CREATE_RESPONSE" == *"\"deployment\":"* ]]; then
    DEPLOYMENT_STATUS=$(echo "$CREATE_RESPONSE" | grep -o '"deployment":{[^}]*}' | grep -o '"status":"[^"]*"' | sed 's/"status":"//;s/"//')
    DEPLOYMENT_ERROR=$(echo "$CREATE_RESPONSE" | grep -o '"deployment":{[^}]*}' | grep -o '"error":"[^"]*"' | sed 's/"error":"//;s/"//')
    DEPLOYMENT_URL=$(echo "$CREATE_RESPONSE" | grep -o '"url":"[^"]*"' | sed 's/"url":"//;s/"//')
    echo -e "  Deployment: ${DEPLOYMENT_STATUS:-'unknown'}"
    if [ -n "$DEPLOYMENT_ERROR" ]; then
      echo -e "    Error: $DEPLOYMENT_ERROR"
    fi
    if [ -n "$DEPLOYMENT_URL" ]; then
      echo -e "    URL: $DEPLOYMENT_URL"
    fi
  elif [ "$SHOULD_DEPLOY" = true ]; then
    echo -e "  Deployment: No results reported (but was requested)"
    echo -e "    This may indicate that the server does not yet implement Phase 3 from NewFlowUpdates.md"
  fi
fi

# Extract available links
if [[ "$CREATE_RESPONSE" == *"\"links\":"* ]]; then
  echo -e "${BLUE}Available Links:${NC}"
  
  # Extract download URL
  DOWNLOAD_URL=$(echo "$CREATE_RESPONSE" | grep -o '"downloadUrl":"[^"]*"' | sed 's/"downloadUrl":"//;s/"//')
  if [ -n "$DOWNLOAD_URL" ]; then
    echo -e "  Download URL: ${API_BASE_URL}${DOWNLOAD_URL}"
  fi
  
  # Extract GitHub URL
  GITHUB_URL=$(echo "$CREATE_RESPONSE" | grep -o '"githubUrl":"[^"]*"' | sed 's/"githubUrl":"//;s/"//')
  if [ -n "$GITHUB_URL" ]; then
    echo -e "  GitHub URL: $GITHUB_URL"
  elif [ "$SETUP_GITHUB" = true ]; then
    echo -e "  GitHub URL: Not available (but was requested)"
  fi
  
  # Extract deployment URL
  DEPLOYMENT_URL=$(echo "$CREATE_RESPONSE" | grep -o '"deploymentUrl":"[^"]*"' | sed 's/"deploymentUrl":"//;s/"//')
  if [ -n "$DEPLOYMENT_URL" ]; then
    echo -e "  Deployment URL: $DEPLOYMENT_URL"
  elif [ "$SHOULD_DEPLOY" = true ]; then
    echo -e "  Deployment URL: Not available (but was requested)"
  fi
fi

# Summary
echo ""
echo -e "${GREEN}===== Test Summary =====${NC}"
echo -e "Environment: $ENVIRONMENT"
echo -e "Tenant ID: $TENANT_ID"
echo -e "Project ID: $PROJECT_ID"
echo -e "Project Name: $PROJECT_NAME"
echo -e "GitHub Setup: ${SETUP_GITHUB}"
echo -e "Deploy: ${SHOULD_DEPLOY}"

# Implementation status check
echo ""
echo -e "${YELLOW}===== Implementation Status Check =====${NC}"
if [ "$SETUP_GITHUB" = true ] && [[ ! "$CREATE_RESPONSE" == *"\"github\":"* ]]; then
  echo -e "${YELLOW}⚠️  GitHub integration appears not to be implemented${NC}"
  echo -e "   - setupGitHub flag is set to true in the request"
  echo -e "   - Credentials are properly provided"
  echo -e "   - But the response does not contain GitHub phase information"
  echo -e "   - This suggests Phase 2 from NewFlowUpdates.md is not yet implemented"
fi

if [ "$SHOULD_DEPLOY" = true ] && [[ ! "$CREATE_RESPONSE" == *"\"deployment\":"* ]]; then
  echo -e "${YELLOW}⚠️  Deployment appears not to be implemented${NC}"
  echo -e "   - shouldDeploy flag is set to true in the request"
  echo -e "   - Credentials are properly provided"
  echo -e "   - But the response does not contain deployment phase information" 
  echo -e "   - This suggests Phase 3 from NewFlowUpdates.md is not yet implemented"
fi

echo ""
echo -e "${GREEN}🎉 E2E Test Completed!${NC}" 

# Display usage instructions at the end
echo ""
echo -e "${BLUE}Usage:${NC}"
echo -e "  $0 [local|preview|prod] [tenant_id] [--github] [--deploy] [--full]"
echo -e "  - local: Test against local development environment (default)"
echo -e "  - preview: Test against preview environment"
echo -e "  - prod: Test against production environment"
echo -e "  - tenant_id: Optional tenant ID (default: 'default')"
echo -e "  - --github: Enable GitHub setup"
echo -e "  - --deploy: Enable deployment"
echo -e "  - --full: Enable both GitHub setup and deployment"
echo -e ""
echo -e "Example: $0 preview test-tenant --full" 