# Pom-Bolt Environment Setup Guide

This guide provides detailed instructions for setting up all required environments and dependencies for the Pom-Bolt platform from scratch - local development, preview, and production deployments.

## Prerequisites

- Node.js 18.18.0 or higher
- pnpm 9.4.0 or higher
- Cloudflare account with access to:
  - Cloudflare Pages
  - Cloudflare D1 Database
  - Cloudflare KV Storage
- Git

## Initial Project Setup

1. Clone the repository and install dependencies:

```bash
git clone https://github.com/your-org/pom-bolt.git
cd pom-bolt
pnpm install
```

## Setting Up Environment Variables

Create a `.env.local` file for local development:

```bash
# Application Configuration
NODE_ENV=development
ENVIRONMENT=development

# LLM API Keys (at least one is required)
OPENAI_API_KEY=your_openai_api_key
# ANTHROPIC_API_KEY=your_anthropic_api_key
# GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key

# LLM Configuration
DEFAULT_LLM_PROVIDER=openai  # Options: openai, anthropic, google, etc.
DEFAULT_LLM_MODEL=gpt-4o    # Model to use by default

# Cloudflare Credentials (for deployment/testing)
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token

# Netlify Credentials (for deployment testing)
NETLIFY_AUTH_TOKEN=your_netlify_personal_access_token

# Optional GitHub Integration
GITHUB_TOKEN=your_github_personal_access_token

# Debug Settings (optional)
DEBUG_LLM_CALLS=true
DEBUG_STORAGE_OPERATIONS=true
DEBUG_DEPLOYMENT_STEPS=true

# Feature Flags
SEARCH_INDEX_ENABLED=true
MAX_FILE_CHUNK_SIZE=1048576
CACHE_TTL=3600
```

## Database Setup

### 1. Creating Cloudflare D1 Database

Create a new D1 database in Cloudflare Dashboard:

1. Navigate to the Cloudflare Dashboard > Workers & Pages > D1
2. Click "Create database"
3. Name it `pom-bolt-db`
4. Copy the database ID

Update your `wrangler.toml` with the correct database ID:

```toml
[[d1_databases]]
binding = "DB"
database_name = "pom-bolt-db"
database_id = "your-d1-database-id"
```

### 2. Creating KV Namespaces

Create three KV namespaces in Cloudflare Dashboard:

1. Navigate to the Cloudflare Dashboard > Workers & Pages > KV
2. Create the following namespaces:
   - `POM_BOLT_PROJECTS` - For project metadata
   - `POM_BOLT_FILES` - For file storage
   - `POM_BOLT_CACHE` - For caching data

Update your `wrangler.toml` with the correct namespace IDs:

```toml
[[kv_namespaces]]
binding = "POM_BOLT_PROJECTS"
id = "your-projects-namespace-id"

[[kv_namespaces]]
binding = "POM_BOLT_FILES"
id = "your-files-namespace-id"

[[kv_namespaces]]
binding = "POM_BOLT_CACHE"
id = "your-cache-namespace-id"
```

### 3. Initializing Database Schema

#### Local Development

Initialize the local D1 database with the schema:

```bash
# 1. Create a local D1 database
npx wrangler d1 create pom_bolt_metadata --local

# 2. Run the schema setup script
./scripts/setup-d1-local.sh
```

#### Remote Environment

Initialize the remote D1 database:

```bash
# Run the remote schema setup script
./scripts/setup-d1-remote.sh
```

## Cloudflare Pages Setup

### 1. Creating a Cloudflare Pages Project

1. Navigate to Cloudflare Dashboard > Workers & Pages > Create application > Pages
2. Connect to your GitHub repository
3. Configure build settings:
   - Build command: `pnpm build`
   - Build output directory: `build/client`
   - Node.js version: 18.x

### 2. Configuring Environment Variables

Add the following environment variables in the Cloudflare Pages dashboard:

#### Production Environment:

```
NODE_ENV=production
ENVIRONMENT=production
OPENAI_API_KEY=your_openai_api_key
DEFAULT_LLM_PROVIDER=openai
DEFAULT_LLM_MODEL=gpt-4o
SEARCH_INDEX_ENABLED=true
CACHE_TTL=3600
MAX_FILE_CHUNK_SIZE=1048576
```

#### Preview Environment:

```
NODE_ENV=production
ENVIRONMENT=preview
OPENAI_API_KEY=your_openai_api_key
DEFAULT_LLM_PROVIDER=openai
DEFAULT_LLM_MODEL=gpt-4o
SEARCH_INDEX_ENABLED=true
CACHE_TTL=3600
MAX_FILE_CHUNK_SIZE=1048576
```

### 3. Binding D1 and KV to Your Pages Project

In the Cloudflare Dashboard, under your Pages project settings:

1. Go to "Settings" > "Functions"
2. Scroll to "D1 database bindings"
   - Add binding: Name = "DB", D1 database = "pom-bolt-db"
3. Scroll to "KV namespace bindings"
   - Add binding: Name = "POM_BOLT_PROJECTS", KV namespace = your projects namespace
   - Add binding: Name = "POM_BOLT_FILES", KV namespace = your files namespace
   - Add binding: Name = "POM_BOLT_CACHE", KV namespace = your cache namespace

## Running the Application

### Local Development

Start the development server:

```bash
pnpm dev
```

The application will be available at http://localhost:5173

### Production Build and Preview

Build for production:

```bash
pnpm build
```

Preview the production build locally:

```bash
pnpm preview
```

### Deploying to Cloudflare Pages

The application will automatically deploy to Cloudflare Pages when you push to your configured branch. You can also manually deploy from the Cloudflare Dashboard.

For direct deployment from the command line:

```bash
# Deploy to production
pnpm run deploy:cf
```

## Testing

### Running E2E Tests Locally

```bash
# Setup test environment
./scripts/setup-test-env.sh

# Run E2E tests
pnpm test
```

### API Testing

API testing can be performed with the included test scripts:

```bash
# Test requirements API
./scripts/test-requirements-e2e.sh

# Test direct requirements
./scripts/test-direct-requirements.sh
```

## Cleanup

### Clearing KV Data

To clear all data from KV namespaces (use with caution):

```bash
npx wrangler kv:key list --namespace-id=your-projects-namespace-id | jq -r '.[] | .name' | xargs -I{} npx wrangler kv:key delete {} --namespace-id=your-projects-namespace-id

npx wrangler kv:key list --namespace-id=your-files-namespace-id | jq -r '.[] | .name' | xargs -I{} npx wrangler kv:key delete {} --namespace-id=your-files-namespace-id

npx wrangler kv:key list --namespace-id=your-cache-namespace-id | jq -r '.[] | .name' | xargs -I{} npx wrangler kv:key delete {} --namespace-id=your-cache-namespace-id
```

### Resetting D1 Database

To completely reset your D1 database:

```bash
# Local development
npx wrangler d1 execute pom_bolt_metadata --local --command="DROP TABLE IF EXISTS projects; DROP TABLE IF EXISTS deployments; DROP TABLE IF EXISTS file_metadata; DROP TABLE IF EXISTS search_index; DROP TABLE IF EXISTS file_chunks;"

# Then re-run the setup script
./scripts/setup-d1-local.sh

# Remote environment (use with extreme caution)
npx wrangler d1 execute pom_bolt_metadata --remote --command="DROP TABLE IF EXISTS projects; DROP TABLE IF EXISTS deployments; DROP TABLE IF EXISTS file_metadata; DROP TABLE IF EXISTS search_index; DROP TABLE IF EXISTS file_chunks;"

# Then re-run the setup script
./scripts/setup-d1-remote.sh
```

## Troubleshooting

### Common Issues

1. **Database Migration Errors**: If you encounter errors during database setup, ensure your Cloudflare credentials have the appropriate permissions.

2. **KV Binding Issues**: If KV operations fail, verify that your KV namespaces are correctly bound to your Pages project.

3. **Local Development Errors**: For local development issues, try:
   ```bash
   pnpm clean
   pnpm install
   rm -rf ./dist/* ./build/*
   pnpm dev
   ```

4. **API Key Validation**: If LLM calls are failing, verify your API keys are valid and correctly configured:
   ```bash
   # Test OpenAI key
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer $OPENAI_API_KEY"
   ```

### Logs and Monitoring

For deployed applications, check logs in the Cloudflare Dashboard:

1. Navigate to Workers & Pages > Your Pages Project
2. Click on "Logs" to view runtime logs

## Required Environment Variables Summary

Here's a complete list of required environment variables for a full setup:

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Environment type (development, production) |
| `ENVIRONMENT` | Yes | Specific environment name (development, preview, production) |
| `OPENAI_API_KEY` | Yes* | OpenAI API key (required if using OpenAI) |
| `ANTHROPIC_API_KEY` | No | Anthropic API key (optional) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | No | Google AI API key (optional) |
| `DEFAULT_LLM_PROVIDER` | Yes | Default LLM provider (openai, anthropic, google, etc) |
| `DEFAULT_LLM_MODEL` | Yes | Default model for the selected provider |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | For Cloudflare deployments/operations |
| `CLOUDFLARE_API_TOKEN` | Yes | For Cloudflare deployments/operations |
| `NETLIFY_AUTH_TOKEN` | No | Required for Netlify deployments |
| `GITHUB_TOKEN` | No | Required for GitHub deployments |
| `SEARCH_INDEX_ENABLED` | No | Enable search indexing (recommended) |
| `CACHE_TTL` | No | Cache time-to-live in seconds |
| `MAX_FILE_CHUNK_SIZE` | No | Maximum size of file chunks |

\* At least one LLM API key is required 