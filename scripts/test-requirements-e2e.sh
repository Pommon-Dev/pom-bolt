#!/bin/bash

# E2E test script for requirements-to-project flow
# This script tests the full flow from submitting requirements to deploying a project

# Define colors for pretty output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
# API_BASE_URL=${1:-"http://localhost:5173"}
API_BASE_URL=${1:-"https://persistence-deploy.pom-bolt.pages.dev"}
GITHUB_TOKEN=${GITHUB_TOKEN:-""}
GITHUB_OWNER=${GITHUB_OWNER:-""}
# Check for both possible Netlify token env var names
NETLIFY_TOKEN=${NETLIFY_TOKEN:-${NETLIFY_AUTH_TOKEN:-""}}
# Debug mode for verbose output
DEBUG=${DEBUG:-false}

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

# Check for required credentials
if [ -z "$GITHUB_TOKEN" ] || [ -z "$GITHUB_OWNER" ] || [ -z "$NETLIFY_TOKEN" ]; then
  echo -e "${YELLOW}Warning: Missing some credentials. Please set environment variables:${NC}"
  [ -z "$GITHUB_TOKEN" ] && echo "  - GITHUB_TOKEN"
  [ -z "$GITHUB_OWNER" ] && echo "  - GITHUB_OWNER"
  [ -z "$NETLIFY_TOKEN" ] && echo "  - NETLIFY_TOKEN"
  
  echo -e "${YELLOW}The test will still run but may not include GitHub and Netlify deployment.${NC}"
  echo ""
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
echo -e "API Base URL: ${API_BASE_URL}"
echo -e "GitHub Owner: ${GITHUB_OWNER:-'(Not provided)'}"
echo -e "GitHub Token: ${GITHUB_TOKEN:0:5}...${GITHUB_TOKEN:(-5)}${NC}" 2>/dev/null || echo -e "(Not provided)${NC}"
echo -e "Netlify Token: ${NETLIFY_TOKEN:0:5}...${NETLIFY_TOKEN:(-5)}${NC}" 2>/dev/null || echo -e "(Not provided)${NC}"
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
# REQUIREMENTS="Create a simple landing page for a coffee shop called ${PROJECT_NAME}. The page should have a header with a logo and navigation menu, a hero section with a welcome message and a call-to-action button, a section showcasing the coffee menu with prices, and a footer with contact information and social media links."
REQUIREMENTS="Create detailed components with these requirements:
1. Use 'use client' directive for client-side components
2. Style with Tailwind CSS utility classes for responsive design
3. Use Lucide React for icons (from lucide-react package). Do NOT use other UI libraries unless requested
4. Use stock photos from picsum.photos where appropriate, only valid URLs you know exist
5. Configure next.config.js image remotePatterns to enable stock photos from picsum.photos
6. Create root layout.tsx page that wraps necessary navigation items to all pages
7. MUST implement the navigation elements items in their rightful place i.e. Left sidebar, Top header
8. Accurately implement necessary grid layouts
9. Follow proper import practices:
   - Use @/ path aliases
   - Keep component imports organized
   - Update current src/app/page.tsx with new comprehensive code
   - Don't forget root route (page.tsx) handling
   - You MUST complete the entire prompt before stopping
<summary_title>
Coffee Brand Landing Page
</summary_title>
<image_analysis>
1. Navigation Elements:
   - Shop Now button: A primary call-to-action button, likely linking to the product catalog or store page.
   - Learn Our Story button: A secondary call-to-action button, presumably linking to the brand's about page or story.
2. Layout Components:
   - Hero Section: Contains the main headline, subheadline, and call-to-action buttons, along with a background image of coffee being poured into a mug.
   - Product Section: Displays three coffee roast options (Light, Medium, Dark) with corresponding descriptions and images of the coffee bags.
   - Features Section: Highlights key features such as \"Ethically Sourced Beans,\" \"Small Batch Roasting,\" and \"Fresh to Your Door in 3 Days\" with corresponding icons.
   - Testimonial Section: Includes a customer quote and a headshot of the customer.
3. Content Sections:
   - Headline: 'Brew Bold. Live Smooth.'
   - Subheadline: Exceptional coffee. Sustainably sourced. Roasted to perfection.
   - Product Titles: Light Roast, Medium Roast, Dark Roast.
   - Product Descriptions: Bright & Citrus, Balanced & Nutty, 'Bold & Smoky.'
   - Feature Titles: Ethically Sourced Beans, Small Batch Roasting, Fresh to Your Door in 3 Days.
   - Testimonial: This is hands-down the best coffee I've ever had.
4. Interactive Controls:
   - Shop Now button: Navigates to the product page.
   - Learn Our Story button: Navigates to the about page.
   - Coffee Roast Options: Likely clickable, potentially leading to individual product pages or adding the item to a cart.
5. Colors:
   - Primary Colors: Dark brown/black (for text and buttons), off-white/beige (for background and mug).
   - Accent Colors: Yellow, orange, and dark brown for the roast labels.
6. Grid/Layout Structure:
   - The page appears to use a multi-section layout with a clear hierarchy.
   - The hero section takes up the top portion of the page.
   - The product section is likely a horizontal grid with three columns.
   - The features section is a horizontal grid with three columns.
   - The testimonial section is at the bottom.
</image_analysis>
<development_planning>
1. Project Structure:
   - app/: Contains the main application code.
     - components/: Reusable UI components.
       - HeroSection.tsx: Hero section with headline, subheadline, and buttons.
       - ProductCard.tsx: Reusable component for displaying each coffee roast option.
       - FeatureItem.tsx: Reusable component for displaying each feature with its icon.
       - Testimonial.tsx: Component for displaying the customer testimonial.
     - assets/: Contains images and other static assets.
       - images/:
         - coffee-pouring.jpg: Background image for the hero section.
         - light-roast.jpg: Image for the light roast coffee.
         - medium-roast.jpg: Image for the medium roast coffee.
         - dark-roast.jpg: Image for the dark roast coffee.
         - ethically-sourced.svg: Icon for ethically sourced beans.
         - small-batch.svg: Icon for small batch roasting.
         - fresh-delivery.svg: Icon for fresh delivery.
         - customer-headshot.jpg: Image for the customer testimonial.
     - page.tsx: Main page component that renders all sections.
2. Key Features:
   - Hero section with compelling headline and call-to-action buttons.
   - Product display with visually appealing coffee roast options.
   - Feature highlights with relevant icons.
   - Customer testimonial to build trust.
   - Responsive design for optimal viewing on different devices.
3. State Management:
   - No specific state management is required for this static landing page.
4. Routes:
   - /: The main landing page.
5. Component Architecture:
   - The page is composed of several reusable components: HeroSection, ProductCard, FeatureItem, Testimonial\" 
   "

echo -e "${YELLOW}Project name: $PROJECT_NAME${NC}"
echo -e "${YELLOW}Requirements:${NC} $REQUIREMENTS"

# Create a temporary file for the JSON payload
PAYLOAD_FILE=$(mktemp)

# Configuration for deployment
SHOULD_DEPLOY=false
DEPLOY_SECTION=""

if [ -n "$GITHUB_TOKEN" ] && [ -n "$GITHUB_OWNER" ] && [ -n "$NETLIFY_TOKEN" ]; then
  SHOULD_DEPLOY=true
  DEPLOY_SECTION='"shouldDeploy": true,
    "deploymentTarget": "netlify-github",
    "setupGitHub": true,
    "githubCredentials": {
      "token": "'"$GITHUB_TOKEN"'",
      "owner": "'"$GITHUB_OWNER"'"
    },
    "netlifyCredentials": {
      "apiToken": "'"$NETLIFY_TOKEN"'"
    }'
  
  echo -e "${YELLOW}Deployment will be attempted with GitHub and Netlify.${NC}"
  echo -e "${BLUE}Using deployment target: netlify-github${NC}"
else
  echo -e "${YELLOW}Deployment will be skipped due to missing credentials.${NC}"
fi

# Create the JSON payload
cat > "$PAYLOAD_FILE" << EOF
{
  "content": $(python3 -c "import json; print(json.dumps('''$REQUIREMENTS'''))"),
  "projectName": "$PROJECT_NAME"
EOF

# Add deployment section if needed
if [ "$SHOULD_DEPLOY" = true ]; then
  cat >> "$PAYLOAD_FILE" << EOF
  ,
  $DEPLOY_SECTION
EOF
fi

# Close the JSON object
echo "}" >> "$PAYLOAD_FILE"

# Submit the requirements to create a project
echo -e "${YELLOW}Submitting requirements...${NC}"
echo -e "${YELLOW}URL: ${API_BASE_URL}/api/requirements${NC}"

# Print a summary of what we're sending for debugging
echo -e "${BLUE}Request Summary:${NC}"
echo -e "  Project Name: ${PROJECT_NAME}"
echo -e "  Deployment Target: ${SHOULD_DEPLOY:+'netlify-github'}"
echo -e "  GitHub Token: ${GITHUB_TOKEN:0:5}...${GITHUB_TOKEN:(-5)}${NC}" 2>/dev/null || echo -e "  GitHub Token: (not provided)${NC}"
echo -e "  GitHub Owner: ${GITHUB_OWNER:-'(not provided)'}"
echo -e "  Netlify Token: ${NETLIFY_TOKEN:0:5}...${NETLIFY_TOKEN:(-5)}${NC}" 2>/dev/null || echo -e "  Netlify Token: (not provided)${NC}"

# Debug: Print the request payload
if [ "$DEBUG" = true ]; then
  echo -e "${BLUE}Request Payload:${NC}"
  cat "$PAYLOAD_FILE" | python3 -m json.tool || cat "$PAYLOAD_FILE"
  echo ""
fi

CREATE_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/api/requirements" \
  -H "Content-Type: application/json" \
  -d @"$PAYLOAD_FILE")

# Clean up temporary file
rm -f "$PAYLOAD_FILE"

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
  echo "$CREATE_RESPONSE" | python3 -m json.tool || echo "$CREATE_RESPONSE"
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

# Check if deployment was requested and completed
if [ "$SHOULD_DEPLOY" = true ]; then
  # Extract deployment URL if present
  DEPLOYMENT_URL=$(echo "$CREATE_RESPONSE" | grep -o '"url":"[^"]*"' | sed 's/"url":"//;s/"//')
  DEPLOYMENT_STATUS=$(echo "$CREATE_RESPONSE" | grep -o '"status":"[^"]*"' | sed 's/"status":"//;s/"//')
  DEPLOYMENT_PROVIDER=$(echo "$CREATE_RESPONSE" | grep -o '"provider":"[^"]*"' | sed 's/"provider":"//;s/"//')
  
  # Extract any error information
  ERROR_MESSAGE=$(echo "$CREATE_RESPONSE" | grep -o '"error":"[^"]*"' | sed 's/"error":"//;s/"//')
  
  # More detailed deployment diagnostics
  echo -e "${BLUE}Deployment Diagnostics:${NC}"
  echo -e "  Deployment Provider: ${DEPLOYMENT_PROVIDER:-'(not reported)'}"
  echo -e "  Deployment Status: ${DEPLOYMENT_STATUS:-'(not reported)'}"
  echo -e "  Deployment URL: ${DEPLOYMENT_URL:-'(not reported)'}"
  echo -e "  Error Messages: ${ERROR_MESSAGE:-'(none reported)'}"
  
  if [ -n "$DEPLOYMENT_URL" ]; then
    echo -e "${GREEN}Deployment initiated!${NC}"
    echo -e "Deployment URL: $DEPLOYMENT_URL"
    echo -e "Deployment Status: $DEPLOYMENT_STATUS"
    
    # If deployment is in progress, wait and check status
    if [ "$DEPLOYMENT_STATUS" = "in-progress" ]; then
      echo -e "${YELLOW}Deployment is in progress. Waiting for completion...${NC}"
      
      # Try to poll the status for up to 5 minutes
      MAX_ATTEMPTS=30
      ATTEMPT=0
      
      while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
        ATTEMPT=$((ATTEMPT+1))
        echo -e "${YELLOW}Checking deployment status (attempt $ATTEMPT/$MAX_ATTEMPTS)...${NC}"
        
        sleep 10
        
        # Check if the URL is accessible
        if check_url "$DEPLOYMENT_URL"; then
          echo -e "${GREEN}Deployment is now accessible at: $DEPLOYMENT_URL${NC}"
          break
        fi
        
        # If we've reached max attempts, notify but don't fail
        if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
          echo -e "${YELLOW}Max check attempts reached. Deployment may still be in progress.${NC}"
          echo -e "${YELLOW}Check manually at: $DEPLOYMENT_URL${NC}"
        fi
      done
    fi
  else
    echo -e "${YELLOW}No deployment information found in the response.${NC}"
  fi
fi

# Summary
echo ""
echo -e "${GREEN}===== Test Summary =====${NC}"
echo -e "Project ID: $PROJECT_ID"
echo -e "Project Name: $PROJECT_NAME"
if [ -n "$DEPLOYMENT_URL" ]; then
  echo -e "Deployment URL: $DEPLOYMENT_URL"
  echo -e "Deployment Status: $DEPLOYMENT_STATUS"
fi

echo ""
echo -e "${GREEN}🎉 E2E Test Completed!${NC}" 