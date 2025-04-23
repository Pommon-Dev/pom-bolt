#!/bin/bash

# Test script for debugging the requirements endpoint
# This script tests the API for debugging the requirements flow

# Define colors for pretty output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL=${1:-"http://localhost:5173"}
ENDPOINT="${API_BASE_URL}/api/debug-requirements"

# Banner
echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}   Debug Requirements Chain Test   ${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""

# Test with simple requirements
echo -e "${GREEN}Testing debug requirements endpoint with simple requirements...${NC}"

# Function to create a random project name
random_project_name() {
  echo "TestProject-$(date +%s)"
}

PROJECT_NAME=$(random_project_name)
REQUIREMENTS="Create a simple landing page for a coffee shop called ${PROJECT_NAME}. The page should have a header with a logo and navigation menu."

echo -e "${YELLOW}Project name: $PROJECT_NAME${NC}"
echo -e "${YELLOW}Requirements:${NC} $REQUIREMENTS"

# Submit the requirements
echo -e "${YELLOW}Submitting requirements...${NC}"
RESPONSE=$(curl -s -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "'"$REQUIREMENTS"'",
    "shouldDeploy": false
  }')

# Check if the request was successful
if [ -z "$RESPONSE" ]; then
  echo -e "${RED}Error: Failed to communicate with the API.${NC}"
  exit 1
fi

echo -e "${YELLOW}API Response:${NC} $RESPONSE"

# Extract project ID from response if available
PROJECT_ID=$(echo "$RESPONSE" | grep -o '"projectId":"[^"]*"' | head -1 | sed 's/"projectId":"\([^"]*\)"/\1/')

if [ -n "$PROJECT_ID" ]; then
  echo -e "${GREEN}Project ID: $PROJECT_ID${NC}"
fi

# Check success status
SUCCESS=$(echo "$RESPONSE" | grep -o '"success":\s*\(true\|false\)' | sed 's/"success":\s*\(true\|false\)/\1/')

if [ "$SUCCESS" = "true" ]; then
  echo -e "${GREEN}Test passed! Requirements chain executed successfully.${NC}"
else
  ERROR=$(echo "$RESPONSE" | grep -o '"error":"[^"]*"' | sed 's/"error":"//;s/"//')
  echo -e "${RED}Test failed: $ERROR${NC}"
fi

echo ""
echo -e "${GREEN}========================${NC}"
echo -e "${GREEN}Test completed!${NC}" 