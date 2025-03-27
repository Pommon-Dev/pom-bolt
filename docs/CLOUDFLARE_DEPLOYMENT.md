# Cloudflare Pages Deployment Guide

This guide provides comprehensive instructions for deploying the Pom-bolt application to Cloudflare Pages.

## Setup Prerequisites
- **Cloudflare Account**: You need a Cloudflare account (free tier is sufficient)
- **API Token**: Create a custom API token with "Cloudflare Pages:Edit" permissions
- **Account ID**: Find in your Cloudflare dashboard URL: `https://dash.cloudflare.com/:account/{your-account-id}/pages`

## Environment Configuration
1. Create or update `.env.production` with required variables:
   ```bash
   # Application settings
   ENVIRONMENT=production
   DEFAULT_PROVIDER=anthropic
   DEFAULT_MODEL=claude-3-5-sonnet-latest
   BETA_ACCESS_CODES=your-access-codes-here

   # Cloudflare configuration
   CLOUDFLARE_ACCOUNT_ID=your-account-id
   CLOUDFLARE_API_TOKEN=your-api-token
   ```

2. **Critical**: Configure environment variables in Cloudflare Pages dashboard:
   - Go to Cloudflare Pages → Your Project → Settings → Environment variables
   - Add these essential variables:
     - `ENVIRONMENT`: production
     - `DEFAULT_PROVIDER`: anthropic
     - `DEFAULT_MODEL`: claude-3-5-sonnet-latest
     - `BETA_ACCESS_CODES`: your actual access codes
     - `ANTHROPIC_API_KEY`: your Anthropic API key
     - `OPENAI_API_KEY`: your OpenAI API key (if using OpenAI)
     - `NODE_ENV`: production
   - Set the scope to "Production" or both "Production" and "Preview" as needed
   - Click "Save" to apply the changes
   - **Note**: After updating environment variables, you must redeploy the application or purge cache for changes to take effect

## Deployment Methods

### Method 1: Using the Deployment Script (Recommended)
We've created a comprehensive deployment script that handles building, deploying, and cache purging:

1. Run the deployment script:
   ```bash
   pnpm run deploy:cf
   ```

This script will:
- Validate environment variables
- Build the application with production settings
- Deploy to Cloudflare Pages
- Safely purge the deployment cache
- Provide detailed status messages throughout the process

### Method 2: Manual Step-by-Step Deployment
If you prefer more control, you can run the deployment steps individually:

1. Build the application:
   ```bash
   pnpm run build
   ```

2. Deploy to Cloudflare Pages:
   ```bash
   pnpm run deploy:cloudflare
   ```

3. Purge the cache (to ensure users get the latest version):
   ```bash
   pnpm run deploy:purge-cache
   ```

4. Alternatively, execute the full deployment sequence:
   ```bash
   pnpm run deploy:cloudflare:full
   ```

### Method 3: GitHub Actions Deployment
For automated deployments via GitHub:

1. Ensure the following secrets are set in your GitHub repository:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `BETA_ACCESS_CODES`
   - Any other required API keys

2. Push changes to the `cloudflare-dep` branch to trigger automatic deployment

## Cache Management
Cloudflare heavily caches content for performance. After deployment, you may need to purge the cache:

1. Using the standalone purge script:
   ```bash
   # Using environment variables from .env.production
   pnpm run purge-cache

   # Or with direct account ID and token parameters
   ./scripts/purge-pages-cache.sh YOUR_ACCOUNT_ID YOUR_API_TOKEN
   ```

## Troubleshooting Deployments

1. **Build Failures**:
   - Check the build logs in the Cloudflare dashboard
   - Ensure all required environment variables are set
   - Verify the build command in `wrangler.toml`

2. **Deployment Failures**:
   - Confirm your API token has the correct permissions
   - Check for any error messages in the deployment logs
   - Verify your account ID is correct

3. **Cache Issues**:
   - If changes aren't visible after deployment, try purging the cache
   - Check the network tab in browser dev tools for caching headers
   - Use a private/incognito window to test

4. **Missing UI Elements**:
   - Verify that environment variables are correctly set in Cloudflare
   - Check the browser console for any JavaScript errors
   - Ensure the build output directory is correctly configured

5. **Viewing Application Logs**:
   - View live logs from your deployment:
     ```bash
     npx wrangler pages deployment tail --project-name=pom-bolt
     ```
   
   - List all deployments:
     ```bash
     npx wrangler pages deployment list --project-name=pom-bolt
     ```
   
   - Tail logs from a specific deployment:
     ```bash
     npx wrangler pages deployment tail <deployment-id> --project-name=pom-bolt
     ```

6. **Environment Variable Updates**:
   - After changing environment variables in the Cloudflare dashboard:
     ```bash
     # Redeploy to apply environment variable changes
     pnpm run deploy:cf
     
     # Or just purge the cache if you've already redeployed
     pnpm run deploy:purge-cache
     ```

7. **Testing Production Configuration Locally**:
   - To test with production environment variables:
     ```bash
     # Build with production settings
     NODE_ENV=production pnpm run build
     
     # Run locally with production settings
     NODE_ENV=production pnpm run start
     ```

## Environment-Specific Features
The application includes environment detection to enable or disable features based on the context:

- In `app/config/environment.ts`, features are toggled based on the runtime environment
- Some features like webhook testing are only available in development
- Production builds may have different UI elements and functionality

## Post-Deployment Verification
After deploying, perform these checks:
- Verify the application loads correctly at your Cloudflare Pages URL
- Test key features like authentication and API calls
- Check that environment variables are correctly applied
- Monitor for any errors in the browser console
- Verify asset loading (CSS, JavaScript, images) 