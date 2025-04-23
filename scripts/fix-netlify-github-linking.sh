#!/bin/bash

# Colors for terminal output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Netlify API base URL
NETLIFY_API_BASE="https://api.netlify.com/api/v1"

# Check if NETLIFY_TOKEN is set from environment
if [ -z "$NETLIFY_TOKEN" ]; then
  # If not set, try to get it from the command
  if [[ "$1" == *"NETLIFY_TOKEN="* ]]; then
    eval "$1"
    shift # Remove the token from arguments
  fi
fi

# Display usage information
function show_usage() {
  echo -e "${RED}Error: Missing required arguments or environment variables${NC}"
  echo -e "
${BLUE}Usage:${NC}
  NETLIFY_TOKEN=your_token ./scripts/fix-netlify-github-linking.sh <netlify_site_id> <github_repo_owner/repo_name> [main_branch] [build_cmd] [build_dir]
  OR
  ./scripts/fix-netlify-github-linking.sh NETLIFY_TOKEN=your_token <netlify_site_id> <github_repo_owner/repo_name> [main_branch] [build_cmd] [build_dir]

${BLUE}Example:${NC}
  NETLIFY_TOKEN=your_token ./scripts/fix-netlify-github-linking.sh my-site-123abc your-username/your-repo main \"npm run build\" dist

${BLUE}Required:${NC}
  - NETLIFY_TOKEN environment variable 
  - Netlify site ID
  - GitHub repository (owner/repo format)
  "
  exit 1
}

# Get site details
function get_site_details() {
  local site_id=$1
  echo -e "${BLUE}Getting details for Netlify site ${site_id}...${NC}"
  
  # Print debug information
  echo -e "${CYAN}Debug: Using site ID: ${site_id}${NC}"
  echo -e "${CYAN}Debug: API URL: ${NETLIFY_API_BASE}/sites/${site_id}${NC}"
  echo -e "${CYAN}Debug: Netlify Token length: ${#NETLIFY_TOKEN}${NC}"
  echo -e "${CYAN}Debug: Authorization header: Bearer ${NETLIFY_TOKEN:0:4}...${NETLIFY_TOKEN: -4}${NC}"
  
  # Print the curl command for debugging (without the actual token)
  local curl_cmd="curl -v -s -H \"Authorization: Bearer XXXXXX\" -H \"Content-Type: application/json\" \"${NETLIFY_API_BASE}/sites/${site_id}\""
  echo -e "${CYAN}Debug: Curl command: ${curl_cmd}${NC}"
  
  # Execute curl with output redirected
  local response
  local error_output
  response=$(curl -v -s -H "Authorization: Bearer $NETLIFY_TOKEN" \
                 -H "Content-Type: application/json" \
                 "${NETLIFY_API_BASE}/sites/${site_id}" 2>curl_error.log)
  error_output=$(cat curl_error.log)
  
  # Print the error output
  echo -e "${CYAN}Debug: Curl verbose output:${NC}"
  echo "$error_output"
  
  # Print full response for debugging
  echo -e "${CYAN}Debug: API response:${NC}"
  echo "$response"
  
  # Test if the response is valid JSON
  if ! echo "$response" | jq '.' &>/dev/null; then
    echo -e "${RED}Error: Response is not valid JSON${NC}"
    return 1
  fi
  
  # Check if the response contains an error message
  if echo "$response" | grep -q "\"error\""; then
    echo -e "${RED}Failed to get site details:${NC}"
    echo "$response" | jq -r '.error' 2>/dev/null || echo "$response"
    return 1
  fi
  
  # Extract site name and ID
  local site_name
  site_name=$(echo "$response" | jq -r '.name' 2>/dev/null)
  
  if [ -z "$site_name" ] || [ "$site_name" == "null" ]; then
    echo -e "${YELLOW}Warning: Site name not found in response, using default${NC}"
    site_name="(unnamed site)"
  fi
  
  local response_site_id
  response_site_id=$(echo "$response" | jq -r '.id' 2>/dev/null)
  
  if [ -z "$response_site_id" ] || [ "$response_site_id" == "null" ]; then
    echo -e "${RED}Failed to extract site ID from response${NC}"
    return 1
  fi
  
  # Save the response for later use
  echo "$response" > site_details.json
  
  echo -e "${GREEN}Retrieved site details for ${site_name} (${response_site_id})${NC}"
  return 0
}

# Link GitHub repository to Netlify site
function link_github_repo() {
  local site_id=$1
  local repo=$2
  local branch=$3
  local build_cmd=$4
  local build_dir=$5
  
  echo -e "${BLUE}Linking GitHub repo ${repo} to Netlify site ${site_id}...${NC}"
  
  # Try using the service instances endpoint directly (requires fewer permissions)
  echo -e "${CYAN}Trying to link using service-instances endpoint...${NC}"
  
  local alt_body="{
    \"service\": \"github\",
    \"repo\": \"${repo}\",
    \"branch\": \"${branch}\"
  }"
  
  echo -e "${CYAN}Request payload:${NC}"
  echo "$alt_body" | jq '.' 2>/dev/null || echo "$alt_body"
  
  local alt_response
  alt_response=$(curl -v -s -X POST \
                  -H "Authorization: Bearer $NETLIFY_TOKEN" \
                  -H "Content-Type: application/json" \
                  -d "$alt_body" \
                  "${NETLIFY_API_BASE}/sites/${site_id}/service-instances" 2>curl_error.log)
  
  local error_output=$(cat curl_error.log)
  echo -e "${CYAN}Debug: Curl verbose output:${NC}"
  echo "$error_output"
  
  echo -e "${CYAN}Response:${NC}"
  echo "$alt_response"
  
  # Check for 401 in the error output
  if echo "$error_output" | grep -q "HTTP/2 401"; then
    echo -e "${RED}Authentication failed. Your token does not have permission to perform this action.${NC}"
    return 1
  fi
  
  # Check for 404 in the error output
  if echo "$error_output" | grep -q "HTTP/2 404"; then
    echo -e "${RED}Not Found - Site ID might be incorrect or API endpoint not available.${NC}"
    
    # Try with the site name as a fallback
    echo -e "${YELLOW}Trying with site name instead of ID...${NC}"
    
    # First get the site name from the site ID - assumes format pom-app-XXXXXXXX
    local site_name="pom-app-$(echo $site_id | cut -d'-' -f1 | head -c8)"
    echo -e "${YELLOW}Using derived site name: ${site_name}${NC}"
    
    alt_response=$(curl -v -s -X POST \
                  -H "Authorization: Bearer $NETLIFY_TOKEN" \
                  -H "Content-Type: application/json" \
                  -d "$alt_body" \
                  "${NETLIFY_API_BASE}/sites/${site_name}/service-instances" 2>curl_error3.log)
    
    error_output=$(cat curl_error3.log)
    echo -e "${CYAN}Debug: Curl verbose output:${NC}"
    echo "$error_output"
    
    echo -e "${CYAN}Response:${NC}"
    echo "$alt_response"
    
    if echo "$error_output" | grep -q "HTTP/2 404"; then
      echo -e "${RED}Failed to link GitHub repo: Site not found with either ID or name.${NC}"
      echo -e "${YELLOW}Please verify the site exists and you have permissions to access it.${NC}"
      return 1
    fi
  fi
  
  # Check for other errors
  if [[ "$alt_response" == *"error"* ]] || [[ "$alt_response" == "Not Found" ]]; then
    echo -e "${RED}Alternative linking method failed:${NC}"
    echo "$alt_response"
    
    # Try direct method as fallback
    echo -e "${BLUE}Trying fallback direct method...${NC}"
    
    # Prepare the request body
    local request_body="{
      \"build_settings\": {
        \"provider\": \"github\",
        \"repo_url\": \"https://github.com/${repo}\",
        \"repo_branch\": \"${branch}\",
        \"cmd\": \"${build_cmd}\",
        \"dir\": \"${build_dir}\"
      }
    }"
    
    echo -e "${CYAN}Request payload:${NC}"
    echo "$request_body" | jq '.' 2>/dev/null || echo "$request_body"
    
    # Try direct linking method
    local response
    response=$(curl -v -s -X PATCH \
                  -H "Authorization: Bearer $NETLIFY_TOKEN" \
                  -H "Content-Type: application/json" \
                  -d "$request_body" \
                  "${NETLIFY_API_BASE}/sites/${site_id}" 2>curl_error2.log)
    
    error_output=$(cat curl_error2.log)
    echo -e "${CYAN}Debug: Curl verbose output:${NC}"
    echo "$error_output"
    
    echo -e "${CYAN}Response:${NC}"
    echo "$response"
    
    # Check for 401 in the error output
    if echo "$error_output" | grep -q "HTTP/2 401"; then
      echo -e "${RED}Authentication failed. Your token does not have permission to perform this action.${NC}"
      return 1
    fi
    
    # Try with site name as a fallback
    if echo "$error_output" | grep -q "HTTP/2 404"; then
      echo -e "${YELLOW}Trying with site name instead of ID...${NC}"
      
      # Use the derived site name from earlier
      local site_name=${site_name:-"pom-app-$(echo $site_id | cut -d'-' -f1 | head -c8)"}
      echo -e "${YELLOW}Using derived site name: ${site_name}${NC}"
      
      response=$(curl -v -s -X PATCH \
                  -H "Authorization: Bearer $NETLIFY_TOKEN" \
                  -H "Content-Type: application/json" \
                  -d "$request_body" \
                  "${NETLIFY_API_BASE}/sites/${site_name}" 2>curl_error4.log)
      
      error_output=$(cat curl_error4.log)
      echo -e "${CYAN}Debug: Curl verbose output:${NC}"
      echo "$error_output"
      
      echo -e "${CYAN}Response:${NC}"
      echo "$response"
      
      if echo "$error_output" | grep -q "HTTP/2 404"; then
        echo -e "${RED}Failed to link GitHub repo: Site not found with either ID or name.${NC}"
        return 1
      fi
    fi
    
    if echo "$response" | grep -q "\"error\""; then
      echo -e "${RED}Both linking methods failed.${NC}"
      return 1
    fi
    
    echo -e "${GREEN}Successfully linked GitHub repo using direct method${NC}"
    return 0
  fi
  
  echo -e "${GREEN}Successfully linked GitHub repo${NC}"
  
  # Update build settings separately if service-instances method was successful
  if [ "$build_cmd" != "npm run build" ] || [ "$build_dir" != "dist" ]; then
    echo -e "${BLUE}Updating build settings...${NC}"
    
    local build_body="{
      \"build_settings\": {
        \"cmd\": \"${build_cmd}\",
        \"dir\": \"${build_dir}\"
      }
    }"
    
    local build_response
    build_response=$(curl -s -X PATCH \
                      -H "Authorization: Bearer $NETLIFY_TOKEN" \
                      -H "Content-Type: application/json" \
                      -d "$build_body" \
                      "${NETLIFY_API_BASE}/sites/${site_id}")
    
    if echo "$build_response" | grep -q "\"error\""; then
      echo -e "${YELLOW}Warning: Failed to update build settings, but GitHub linking succeeded:${NC}"
      echo "$build_response" | jq -r '.error' 2>/dev/null || echo "$build_response"
      echo -e "${YELLOW}You may need to set build settings manually in the Netlify dashboard.${NC}"
    else
      echo -e "${GREEN}Successfully updated build settings${NC}"
    fi
  fi
  
  return 0
}

# Verify GitHub linking
function verify_linking() {
  local site_id=$1
  echo -e "${BLUE}Verifying GitHub linking for site ${site_id}...${NC}"
  
  local site_data
  site_data=$(curl -s -H "Authorization: Bearer $NETLIFY_TOKEN" \
                  -H "Content-Type: application/json" \
                  "${NETLIFY_API_BASE}/sites/${site_id}")
  
  if [ $? -ne 0 ] || [ -z "$site_data" ]; then
    echo -e "${RED}Failed to get site data for verification${NC}"
    return 1
  fi
  
  # Check if the site has build settings with GitHub provider
  local provider
  provider=$(echo "$site_data" | jq -r '.build_settings.provider' 2>/dev/null)
  
  local repo_url
  repo_url=$(echo "$site_data" | jq -r '.build_settings.repo_url' 2>/dev/null)
  
  if [ "$provider" == "github" ] && [ -n "$repo_url" ] && [ "$repo_url" != "null" ]; then
    echo -e "${GREEN}Verification successful!${NC}"
    echo -e "${GREEN}Site is linked to GitHub repository: ${repo_url}${NC}"
    
    # Get build command and publish directory
    local build_cmd
    build_cmd=$(echo "$site_data" | jq -r '.build_settings.cmd' 2>/dev/null)
    build_cmd=${build_cmd:-"(Not set)"}
    
    local publish_dir
    publish_dir=$(echo "$site_data" | jq -r '.build_settings.dir' 2>/dev/null)
    publish_dir=${publish_dir:-"(Not set)"}
    
    echo -e "${BLUE}Build command:${NC} ${build_cmd}"
    echo -e "${BLUE}Publish directory:${NC} ${publish_dir}"
    return 0
  else
    echo -e "${RED}Verification failed - site is not linked to GitHub${NC}"
    return 1
  fi
}

# Main function
function main() {
  echo -e "${BLUE}=============================================${NC}"
  echo -e "${BLUE}  Netlify-GitHub Repository Linking Script  ${NC}"
  echo -e "${BLUE}=============================================${NC}"
  
  # Debug: Print all arguments
  echo -e "${CYAN}Debug: Arguments received:${NC}"
  echo -e "${CYAN}Site ID: $SITE_ID${NC}"
  echo -e "${CYAN}GitHub Repo: $GITHUB_REPO${NC}"
  echo -e "${CYAN}Branch: $BRANCH${NC}"
  echo -e "${CYAN}Build Command: $BUILD_CMD${NC}"
  echo -e "${CYAN}Build Directory: $BUILD_DIR${NC}"
  
  # Be careful with printing the token - just show first/last few chars
  if [ -n "$NETLIFY_TOKEN" ]; then
    token_length=${#NETLIFY_TOKEN}
    echo -e "${CYAN}Debug: Netlify Token: ${NETLIFY_TOKEN:0:4}...${NETLIFY_TOKEN: -4} (length: $token_length)${NC}"
  else
    echo -e "${RED}Error: NETLIFY_TOKEN is not set${NC}"
    exit 1
  fi
  
  # Skip getting site details since we're having permission issues
  echo -e "${YELLOW}Skipping site details check due to potential permission issues${NC}"
  echo -e "${YELLOW}Proceeding directly to GitHub linking...${NC}"
  
  # Link the GitHub repository
  echo -e "${BLUE}Step 1: Linking GitHub repository${NC}"
  if ! link_github_repo "$SITE_ID" "$GITHUB_REPO" "$BRANCH" "$BUILD_CMD" "$BUILD_DIR"; then
    echo -e "${RED}Failed to link GitHub repository to Netlify site${NC}"
    # Clean up temporary files
    rm -f site_details.json curl_error.log curl_error2.log curl_error3.log curl_error4.log
    exit 1
  fi
  
  # Verify the linking
  echo -e "${BLUE}Step 2: Verifying GitHub linking${NC}"
  if verify_linking "$SITE_ID"; then
    echo -e "${GREEN}=============================================${NC}"
    echo -e "${GREEN}  GitHub repository successfully linked to Netlify!  ${NC}"
    echo -e "${GREEN}=============================================${NC}"
    echo -e "${BLUE}Netlify Site ID:${NC} ${SITE_ID}"
    echo -e "${BLUE}GitHub Repo:${NC} ${GITHUB_REPO}"
    
    # Clean up temporary files
    rm -f site_details.json curl_error.log curl_error2.log curl_error3.log curl_error4.log
    exit 0
  else
    echo -e "${RED}Linking verification failed. Please check your Netlify site settings manually.${NC}"
    echo -e "${YELLOW}You can check your site at: https://app.netlify.com/sites/${SITE_ID}/settings/deploys${NC}"
    
    # Clean up temporary files
    rm -f site_details.json curl_error.log curl_error2.log curl_error3.log curl_error4.log
    exit 1
  fi
}

# Check for jq dependency
if ! command -v jq &> /dev/null; then
  echo -e "${YELLOW}Warning: 'jq' is not installed. Some output parsing may not work correctly.${NC}"
  echo -e "${YELLOW}Consider installing jq: brew install jq (macOS) or apt install jq (Linux)${NC}"
fi

# Get arguments
SITE_ID=$1
GITHUB_REPO=$2
BRANCH=${3:-main}
BUILD_CMD=${4:-"npm run build"}
BUILD_DIR=${5:-dist}

# Debug: Print environment variable status before validation
echo -e "${CYAN}Debug: NETLIFY_TOKEN is ${NETLIFY_TOKEN:+set}${NETLIFY_TOKEN:-not set}${NC}"

# Validate arguments
if [ -z "$SITE_ID" ] || [ -z "$GITHUB_REPO" ] || [ -z "$NETLIFY_TOKEN" ]; then
  show_usage
fi

# Run main function
main 