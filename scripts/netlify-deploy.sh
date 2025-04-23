#!/bin/bash

# Replace these with your actual tokens and values
NETLIFY_TOKEN=""
GITHUB_REPO=""
BRANCH=""
SITE_NAME=""

# Step 1: Check if site exists
site_id=$(curl -s -X GET https://api.netlify.com/api/v1/sites \
  -H "Authorization: Bearer $NETLIFY_TOKEN" | jq -r --arg SITE_NAME "$SITE_NAME" '.[] | select(.name == $SITE_NAME) | .id')

if [ "$site_id" == "null" ]; then
  echo "Site not found. Creating site..."
  
  # Step 2: Create the site if it doesn't exist
  response=$(curl -s -X POST https://api.netlify.com/api/v1/sites \
    -H "Authorization: Bearer $NETLIFY_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "'$SITE_NAME'"
    }')

  site_id=$(echo $response | jq -r '.id')
  if [ "$site_id" == "null" ]; then
    echo "Error creating site. Exiting."
    exit 1
  fi
  echo "Site created with ID: $site_id"
else
  echo "Site already exists with ID: $site_id"
fi

# Step 3: Link GitHub repo to site
link_response=$(curl -s -X POST https://api.netlify.com/api/v1/sites/$site_id/link \
  -H "Authorization: Bearer $NETLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": {
      "provider": "github",
      "repo": "'$GITHUB_REPO'",
      "branch": "'$BRANCH'",
      "private": false
    }
  }')

# Validate if GitHub repo was linked successfully
repo_linked=$(echo $link_response | jq -r '.message')

if [ "$repo_linked" == "Not Found" ]; then
  echo "Error linking GitHub repo. Ensure that the Netlify GitHub App is installed and has access to your repo."
  exit 1
else
  echo "GitHub repo successfully linked to site."
fi

# Step 4: Trigger a deploy
deploy_response=$(curl -s -X POST https://api.netlify.com/api/v1/sites/$site_id/builds \
  -H "Authorization: Bearer $NETLIFY_TOKEN")

# Check if deploy was triggered
if [[ "$deploy_response" == *"Not Found"* ]]; then
  echo "Error triggering deploy. The site may not be fully linked."
  exit 1
else
  echo "Deploy triggered successfully."
fi

echo "Script execution completed!"

