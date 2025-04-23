# Testing the Requirements-to-Project Flow

This document provides instructions for testing the end-to-end flow from submitting requirements to generating and deploying a project.

## Prerequisites

Before running the tests, ensure you have the following:

1. **API Keys and Credentials**:
   - GitHub Personal Access Token with `repo` and `workflow` scopes
   - GitHub username (owner)
   - Netlify Personal Access Token
   - OpenAI API Key (or other LLM provider credentials)

2. **Development Environment**:
   - Local development server running (`npm run dev`)
   - D1 database initialized

## Setup

### 1. Initialize the Requirements Database

First, run the database initialization script to set up the necessary database tables and entries:

```bash
# For local development
./scripts/setup-requirements.sh

# For production
./scripts/setup-requirements.sh --remote
```

This script:
- Creates the "requirements" project
- Updates the project list
- Tests the API with a simple requirement

### 2. Set Environment Variables

To set up environment variables for testing, use:

```bash
# Source the environment setup script
source ./scripts/setup-test-env.sh
```

Alternatively, create a `.env.testing` file with the following variables:

```
GITHUB_TOKEN=your_github_token
GITHUB_OWNER=your_github_username
NETLIFY_TOKEN=your_netlify_token
OPENAI_API_KEY=your_openai_api_key
```

## Testing Approaches

### Basic Test: Debug API Endpoint

For quick testing with detailed logs, use the debug API endpoint:

```bash
./scripts/test-debug-requirements.sh
```

This test:
- Sends a simple requirement to the debug endpoint
- Does not attempt to deploy the project
- Returns detailed information about the execution

### Full E2E Test

To test the complete flow including deployment:

```bash
# Set environment variables first
source ./scripts/setup-test-env.sh

# Run the E2E test
./scripts/test-requirements-e2e.sh
```

This test:
- Submits a detailed requirement
- Creates a new project
- Generates code using an LLM
- Deploys to Netlify via GitHub if credentials are available

## Troubleshooting

### Common Issues

1. **Database Initialization Failures**:
   - Check D1 database access permissions
   - Ensure `wrangler.toml` contains proper D1 bindings

2. **Requirements API Errors**:
   - Verify the local server is running
   - Check for proper database initialization
   - Review server logs for detailed errors

3. **LLM Integration Issues**:
   - Confirm API keys are properly set in the environment
   - Check for rate limiting or quota issues
   - Review the detailed logs from the debug endpoint

4. **Deployment Failures**:
   - Validate GitHub token has correct scopes
   - Ensure Netlify token is valid
   - Check for existing repositories with the same name

### Viewing Logs

Enhanced logging has been added to the requirements chain. Look for log entries with prefixes:

- `🚀 [runRequirementsChain]` - Main chain execution
- `🔍 [processRequirements]` - Requirements processing
- `💻 [processRequirements]` - Code generation
- `📝 [processRequirements]` - Project creation

## Manual Testing via API

You can also test the API manually with curl:

```bash
# Test requirements collection endpoint
curl -X POST "http://localhost:5173/api/requirements" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "requirements",
    "requirements": [{
      "id": "test-req-1",
      "content": "Test requirement",
      "timestamp": 1680000000000,
      "status": "pending"
    }]
  }'

# Create a new project from requirements
curl -X POST "http://localhost:5173/api/requirements" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Create a simple landing page for a coffee shop",
    "shouldDeploy": false
  }'
```

## What to Look For

During testing, pay attention to:

1. **Project Creation**: 
   - Is a project ID returned?
   - Is the project saved in the database?

2. **Code Generation**:
   - Are files generated from the requirements?
   - Do the files match what was requested?

3. **Deployment**:
   - Is a deployment URL returned?
   - Is the site accessible at the provided URL?
   - Does the deployed site contain the generated code? 