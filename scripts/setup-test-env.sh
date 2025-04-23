#!/bin/bash

# Script to set up environment variables for testing
# Source this script before running tests:
# source scripts/setup-test-env.sh

# Define colors for pretty output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Setting up environment variables for testing...${NC}"

# Check for .env file
ENV_FILE=".env.testing"
if [ -f "$ENV_FILE" ]; then
  echo -e "${GREEN}Found $ENV_FILE file, loading variables...${NC}"
  
  # Source environment variables from .env file
  export $(grep -v '^#' $ENV_FILE | xargs)
  
  # Check which variables were loaded
  echo -e "${GREEN}Environment variables loaded:${NC}"
  [ -n "$GITHUB_TOKEN" ] && echo "  - GITHUB_TOKEN: ${GITHUB_TOKEN:0:5}...${GITHUB_TOKEN:(-5)}" || echo "  - GITHUB_TOKEN: Not set"
  [ -n "$GITHUB_OWNER" ] && echo "  - GITHUB_OWNER: $GITHUB_OWNER" || echo "  - GITHUB_OWNER: Not set"
  [ -n "$NETLIFY_TOKEN" ] && echo "  - NETLIFY_TOKEN: ${NETLIFY_TOKEN:0:5}...${NETLIFY_TOKEN:(-5)}" || echo "  - NETLIFY_TOKEN: Not set"
  [ -n "$OPENAI_API_KEY" ] && echo "  - OPENAI_API_KEY: ${OPENAI_API_KEY:0:5}...${OPENAI_API_KEY:(-5)}" || echo "  - OPENAI_API_KEY: Not set"
else
  echo -e "${YELLOW}$ENV_FILE file not found. Please create it with the following format:${NC}"
  echo
  echo "GITHUB_TOKEN=your_github_token"
  echo "GITHUB_OWNER=your_github_username"
  echo "NETLIFY_TOKEN=your_netlify_token"
  echo "OPENAI_API_KEY=your_openai_api_key"
  echo
  
  # Ask if user wants to create a .env file
  read -p "Do you want to create a $ENV_FILE file now? (y/n) " CREATE_ENV
  
  if [[ "$CREATE_ENV" == "y" || "$CREATE_ENV" == "Y" ]]; then
    echo "Creating $ENV_FILE file..."
    
    read -p "Enter your GitHub token: " GITHUB_TOKEN
    read -p "Enter your GitHub username: " GITHUB_OWNER
    read -p "Enter your Netlify token: " NETLIFY_TOKEN
    read -p "Enter your OpenAI API key: " OPENAI_API_KEY
    
    echo "GITHUB_TOKEN=$GITHUB_TOKEN" > $ENV_FILE
    echo "GITHUB_OWNER=$GITHUB_OWNER" >> $ENV_FILE
    echo "NETLIFY_TOKEN=$NETLIFY_TOKEN" >> $ENV_FILE
    echo "OPENAI_API_KEY=$OPENAI_API_KEY" >> $ENV_FILE
    
    echo -e "${GREEN}$ENV_FILE file created successfully.${NC}"
    
    # Export the variables
    export GITHUB_TOKEN
    export GITHUB_OWNER
    export NETLIFY_TOKEN
    export OPENAI_API_KEY
  else
    echo -e "${YELLOW}No $ENV_FILE file created. You can set environment variables manually.${NC}"
  fi
fi

# Provide additional instructions
echo
echo -e "${BLUE}Reminder: Use credentials only on your personal development account.${NC}"
echo -e "${BLUE}Make sure the following are properly configured:${NC}"
echo "  1. GitHub token needs 'repo' and 'workflow' scopes"
echo "  2. Netlify token should be a personal access token"
echo "  3. OpenAI API key should have sufficient quota"
echo 
echo -e "${GREEN}Environment setup complete!${NC}" 