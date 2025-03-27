# Scripts

This directory contains utility scripts for development and deployment.

## Cache Purging Scripts

Two scripts are provided for purging Cloudflare Pages cache:

### 1. purge-cache.ts (TypeScript)

This script uses the Cloudflare API to purge the cache for your Cloudflare Pages project.

**Prerequisites**:
- `node-fetch` installed (`pnpm add -D node-fetch`)
- Environment variables set:
  - `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID
  - `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token with Pages permissions

**Usage**:
```bash
# Using npm script
pnpm run purge-cache

# Directly with tsx
tsx scripts/purge-cache.ts
```

### 2. purge-pages-cache.sh (Shell)

A bash script for purging Cloudflare Pages cache with direct arguments.

**Usage**:
```bash
# Directly
./scripts/purge-pages-cache.sh YOUR_ACCOUNT_ID YOUR_API_TOKEN

# Using npm script
pnpm run deploy:purge-cache

# As part of deployment
pnpm run deploy:cloudflare:full
```

## Finding Your Cloudflare Account ID

1. Log in to your Cloudflare dashboard
2. Go to your Cloudflare Pages projects: https://dash.cloudflare.com/?to=/:account/pages
3. Look at the URL in your browser. It will look like:
   `https://dash.cloudflare.com/:account/123456789abcdef/pages`
4. The alphanumeric string (`123456789abcdef`) is your Account ID

## Creating an API Token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use "Create Custom Token"
4. Add permission: Account → Cloudflare Pages → Edit
5. Select your specific account under "Account Resources"
6. Create and copy the token (it's shown only once) 