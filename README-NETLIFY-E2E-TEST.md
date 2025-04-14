# GitHub to Netlify Deployment E2E Testing

This document explains how to test the end-to-end flow from project creation with code generation to GitHub repository creation and finally to Netlify deployment.

## Implemented Functionality

We've added the following key improvements to fix the E2E deployment flow:

1. **Standardized Key Format Utilities**:
   - Created utilities to ensure consistent format conversion between project IDs and archive keys
   - Fixed project metadata persistence by using consistent key formats
   
2. **Enhanced Project Metadata Structure**:
   - Added a `GitHubRepositoryInfo` type to properly store GitHub repository information
   - Modified project state management to handle GitHub metadata
   
3. **GitHub Integration Layer**:
   - Created helpers for GitHub repository setup and updates
   - Implemented logic to either create a new repository or use an existing one
   
4. **Improved Netlify-GitHub Deployment**:
   - Enhanced deployment flow to use GitHub metadata when available
   - Fixed issues with deployment credential handling
   
5. **Testing Scripts**:
   - Created a comprehensive test script with curl commands to verify the E2E flow

## Testing Instructions

### Prerequisites

- You need a [GitHub Personal Access Token](https://github.com/settings/tokens) with the following permissions:
  - `repo` (Full control of private repositories)
  - `repo:status` (Access commit status)
  - `repo_deployment` (Access deployment status)
  - `repo:invite` (Access repository invitations)
  - `repo:admin` (For repository administration)
  - `workflow` (Edit GitHub Actions workflows)
- You need a [Netlify API Token](https://app.netlify.com/user/applications#personal-access-tokens) with full access
- The application should be running locally on port 5173 (default)

### Common Issues

- **GitHub Token Permissions**: If you see errors like "Resource not accessible by integration" or "Not Found" when trying to create or access a GitHub repository, it's likely due to insufficient token permissions. Make sure your token has all the required scopes mentioned above.

- **Netlify Site Creation Errors**: If you see "Failed to get Netlify site info: Not Found", it means the deployment code is trying to access a Netlify site that doesn't exist yet. The fix we've implemented should prevent this by always creating a new site first.

- **404 Project Not Found**: If your project wasn't properly saved, the deployment will fail with "Project not found". This can happen if the project metadata wasn't saved correctly in Cloudflare KV or if you're using an incorrect project ID.

### Setup

1. **Edit the test script** with your credentials:
   
   Open `scripts/curl-netlify-deploy-test.sh` and add your tokens:
   
   ```bash
   GITHUB_TOKEN="your_github_token_here"
   GITHUB_OWNER="your_github_username"  # Optional
   NETLIFY_TOKEN="your_netlify_token_here"
   ```

2. **Run the application** if it's not already running:
   
   ```bash
   pnpm run dev
   ```

### Running the Test

We provide two test scripts:

#### Option 1: Two-Step Test (Recommended for Debugging)

This option creates the project first, then separately deploys it:

```bash
./scripts/curl-netlify-deploy-test.sh
```

#### Option 2: Single-Step Test

This option creates and deploys the project in a single API call:

```bash
./scripts/single-step-netlify-deploy.sh
```

Both scripts perform the following steps:

1. Creates a new project via the `/api/requirements` endpoint
2. Waits briefly for code generation to complete
3. Deploys the project to Netlify via GitHub using the `/api/deploy` endpoint
4. Displays the deployment results

### Expected Results

- The script should output a project ID and a Netlify deployment URL
- The deployment status may initially be "in-progress"
- After a few minutes, you should be able to visit the deployment URL to see your application
- You should also see a new repository created in your GitHub account

### Troubleshooting

If the test fails, check the following:

1. **API Endpoints**: Ensure the application is running and accessible at http://localhost:5173
2. **Token Permissions**: Verify your GitHub token has `repo` permissions
3. **Logs**: Check the application logs for detailed error messages
4. **GitHub Rate Limits**: GitHub API has rate limits, which may cause failures if exceeded
5. **Netlify Account**: Ensure your Netlify account is properly set up and the token is valid

## Manual Testing

You can also test manually using the following curl commands:

### Step 1: Create a project
```bash
curl -X POST "http://localhost:5173/api/requirements" \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "test-netlify-manual",
    "requirements": "Create a simple React app with a counter",
    "githubCredentials": {
      "token": "your_github_token",
      "owner": "your_github_username"
    },
    "netlifyCredentials": {
      "apiToken": "your_netlify_token"
    }
  }'
```

### Step 2: Deploy the project
```bash
curl -X POST "http://localhost:5173/api/deploy" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "your_project_id_from_step_1",
    "targetName": "netlify-github",
    "setupGitHub": true,
    "githubCredentials": {
      "token": "your_github_token",
      "owner": "your_github_username"
    },
    "netlifyCredentials": {
      "apiToken": "your_netlify_token"
    }
  }'
```

## Next Steps

- Add automated tests for this flow
- Improve error handling and recovery
- Add a UI for configuring deployment settings 