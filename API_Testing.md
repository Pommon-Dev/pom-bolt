# API End-to-End Testing Documentation

This document provides curl commands for testing end-to-end functionality of the Pom Bolt API. These tests cover project creation, code generation, persistence, and deployment workflows.

All commands use the base URL: `https://23d4935a.pom-bolt.pages.dev`

## Test Scenario 1: Create project → Generate code → Persistence → Deploy to Netlify

### Step 1: Create a new project with requirements

```bash
curl -X POST https://23d4935a.pom-bolt.pages.dev/api/requirements \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Create a simple React weather app that shows the current weather for a given location. It should have a search box to enter a city name and display temperature, humidity, and weather conditions with a simple, clean UI.",
    "deploy": false
  }'
```

Expected response:
```json
{
  "success": true,
  "projectId": "some-project-id",
  "isNewProject": true,
  "filesGenerated": 10
}
```

Save the `projectId` from the response for use in subsequent steps.

### Step 2: Deploy the generated project to Netlify

```bash
curl -X POST https://23d4935a.pom-bolt.pages.dev/api/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "1a337717-d9eb-42a1-b6f1-bde04da47420",
    "targetName": "netlify",
    "netlifyCredentials": {
      "apiToken": "nfp_PvdZJ7GfrLyf5ZdnogBRMHQzK1emNPZK9f7b"
    }
  }'
```

Expected response:
```json
{
  "success": true,
  "deployment": {
    "id": "some-deployment-id",
    "url": "https://your-deployment-site.netlify.app",
    "status": "success",
    "provider": "netlify"
  }
}
```

## Test Scenario 2: Add features to an existing project → Generate code with context → Persistence → Deploy to Netlify

### Step 1: Add features to an existing project

```bash
curl -X POST https://23d4935a.pom-bolt.pages.dev/api/requirements \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "YOUR_PROJECT_ID",
    "content": "Add a 5-day forecast feature to the weather app. Show daily high/low temperatures and weather conditions for the next 5 days.",
    "additionalRequirement": true,
    "deploy": false
  }'
```

Expected response:
```json
{
  "success": true,
  "projectId": "YOUR_PROJECT_ID",
  "isNewProject": false,
  "filesGenerated": 5
}
```

### Step 2: Deploy the updated project to Netlify

```bash
curl -X POST https://23d4935a.pom-bolt.pages.dev/api/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "YOUR_PROJECT_ID",
    "targetName": "netlify",
    "netlifyCredentials": {
      "apiToken": "YOUR_NETLIFY_TOKEN"
    }
  }'
```

Expected response:
```json
{
  "success": true,
  "deployment": {
    "id": "some-deployment-id",
    "url": "https://your-deployment-site.netlify.app",
    "status": "success",
    "provider": "netlify"
  }
}
```

## Test Scenario 3: Download project code

### Step 1: Get project download URL

First, we need to confirm if there's an archive key available from a previous requirements call. If you don't have an archive key from the requirements call response, you can use the following approach:

```bash
curl -X POST https://23d4935a.pom-bolt.pages.dev/api/requirements \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "1a337717-d9eb-42a1-b6f1-bde04da47420",
    "content": "",
    "additionalRequirement": false,
    "deploy": false
  }'
```

Look for an `archive.key` property in the response.

### Step 2: Download the project ZIP

If you have an archive key:

```bash
curl -X GET https://23d4935a.pom-bolt.pages.dev/api/download/YOUR_ARCHIVE_KEY \
  -o project.zip
```

Alternatively, you can use:

```bash
curl -X GET https://23d4935a.pom-bolt.pages.dev/api/local-zip/YOUR_PROJECT_ID \
  -o project.zip
```

## Test Scenario 4: Deploy downloaded project to Netlify

### Step 1: Unzip the project (manual step)

```bash
unzip project.zip -d project-folder
```

### Step 2: Deploy the local files to Netlify

You'll need to create a files object with the contents of all files in the unzipped project, which is complex to do in a curl command. Here's a simplified version showing the structure:

```bash
curl -X POST https://23d4935a.pom-bolt.pages.dev/api/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "Downloaded Project",
    "files": {
      "index.html": "<!DOCTYPE html><html>...</html>",
      "app.js": "// JavaScript code",
      "style.css": "/* CSS styles */"
      // Add all project files here
    },
    "targetName": "netlify",
    "netlifyCredentials": {
      "apiToken": "YOUR_NETLIFY_TOKEN"
    }
  }'
```

A more practical approach would be to use a script to read the files and create the JSON payload:

```bash
# Example bash script to create the deployment payload (not a curl command)
FILES_JSON="{"
for file in $(find project-folder -type f); do
  CONTENT=$(cat "$file" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr -d '\n')
  REL_PATH=$(echo "$file" | sed 's/project-folder\///')
  FILES_JSON+="\"$REL_PATH\":\"$CONTENT\","
done
FILES_JSON=${FILES_JSON%,}
FILES_JSON+="}"

curl -X POST https://23d4935a.pom-bolt.pages.dev/api/deploy \
  -H "Content-Type: application/json" \
  -d "{
    \"projectName\": \"Downloaded Project\",
    \"files\": $FILES_JSON,
    \"targetName\": \"netlify\",
    \"netlifyCredentials\": {
      \"apiToken\": \"YOUR_NETLIFY_TOKEN\"
    }
  }"
```

## Notes

1. Replace `YOUR_PROJECT_ID` with the actual project ID returned from the first API call.
2. Replace `YOUR_NETLIFY_TOKEN` with your actual Netlify personal access token.
3. Replace `YOUR_ARCHIVE_KEY` with the archive key from the requirements API response.
4. These tests assume that Netlify deployment is available as a deployment target. If not, the API will attempt to find the best available target.
5. Error handling is not shown in these examples. In a real-world scenario, you would check for error responses and handle them appropriately. 