import { json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { CloudflarePagesTarget } from '~/lib/deployment/targets/cloudflare-pages';
import { NetlifyTarget } from '~/lib/deployment/targets/netlify';
import { getEnvironment } from '~/lib/environments/detector';
import { getDeploymentManager } from '~/lib/deployment/deployment-manager';

const logger = createScopedLogger('debug-target-creation');

export async function action({ request }: { request: Request }) {
  try {
    // Allow credentials to be passed in the request body for testing
    let requestBody: any = {};
    if (request.headers.get('content-type')?.includes('application/json')) {
      try {
        requestBody = await request.json();
      } catch (err) {
        logger.warn('Failed to parse request body as JSON:', err);
      }
    }

    const environment = getEnvironment();
    
    // Get Cloudflare credentials - try request body first, then environment
    const cfAccountId = requestBody.accountId || environment.getEnvVariable('CLOUDFLARE_ACCOUNT_ID');
    const cfApiToken = requestBody.apiToken || environment.getEnvVariable('CLOUDFLARE_API_TOKEN');
    const cfProjectName = requestBody.projectName || 'genapps'; // Default fixed project name
    
    // Get Netlify Credentials
    const netlifyToken = requestBody.netlifyToken || environment.getEnvVariable('NETLIFY_AUTH_TOKEN');
    
    logger.debug('Debug target creation credentials:', {
      cfHasAccountId: !!cfAccountId,
      cfHasApiToken: !!cfApiToken,
      cfProjectName,
      netlifyHasToken: !!netlifyToken,
      fromRequestBody: !!(requestBody.accountId || requestBody.apiToken || requestBody.netlifyToken)
    });
    
    // Create all possible ways to get credentials
    const helperAccountId = environment.getEnvVariable('CLOUDFLARE_ACCOUNT_ID');
    const helperApiToken = environment.getEnvVariable('CLOUDFLARE_API_TOKEN');
    
    // Get environment details
    const envInfo = environment.getInfo();
    
    // Log all available environment vars for debugging
    const cfEnvVars: Record<string, string> = {};
    const cfRelevantKeys = [
      'CLOUDFLARE_ACCOUNT_ID', 
      'CLOUDFLARE_API_TOKEN',
      'CF_PAGES',
      'CF_PAGES_URL',
      'CF_PAGES_BRANCH'
    ];
    
    for (const key of cfRelevantKeys) {
      cfEnvVars[key] = environment.getEnvVariable(key) || 'undefined';
    }
    
    // Initialize Cloudflare target (removed redundant declaration)
    let cfIsAvailableResult = false;
    let cfError = null;
    try {
      if (cfAccountId && cfApiToken) {
        // No need to create cfTarget here anymore, manager does it
        cfIsAvailableResult = true; // Assume available if creds exist, manager confirms later
      } else {
        logger.debug('Cloudflare target skipped - missing credentials');
      }
    } catch (error: any) {
      logger.error('Error initializing Cloudflare target:', error);
      cfError = error.message;
    }

    // Initialize Netlify target (removed redundant declaration)
    let netlifyIsAvailableResult = false;
    let netlifyError = null;
    try {
      if (netlifyToken) {
        // No need to create netlifyTarget here anymore, manager does it
        netlifyIsAvailableResult = true; // Assume available if creds exist, manager confirms later
      } else {
        logger.debug('Netlify target skipped - missing token');
      }
    } catch (error: any) {
      logger.error('Error initializing Netlify target:', error);
      netlifyError = error.message;
    }

    // Initialize DeploymentManager with the detected/provided credentials
    // Await the promise
    const deploymentManager = await getDeploymentManager({
      cloudflareConfig: cfAccountId && cfApiToken
        ? {
          accountId: cfAccountId,
          apiToken: cfApiToken,
          projectName: cfProjectName
        }
        : undefined, // Use undefined instead of null
      netlifyToken: netlifyToken || undefined // Pass token directly, use undefined if falsy
    });

    // Now use the manager to check availability
    const registeredTargets = deploymentManager.getRegisteredTargets();
    const availableTargets = await deploymentManager.getAvailableTargets();

    // Prepare results based on actual registration and availability check
    const cfResult = {
      targetCreated: registeredTargets.includes('cloudflare-pages'),
      isAvailable: availableTargets.includes('cloudflare-pages'),
      error: null // Error handling would be more complex, simplifying for now
    };

    const netlifyResult = {
      targetCreated: registeredTargets.includes('netlify'),
      isAvailable: availableTargets.includes('netlify'),
      error: null // Error handling would be more complex, simplifying for now
    };

    return json({
      success: true,
      environment: {
        type: envInfo.type,
        isProduction: envInfo.isProduction,
        isDevelopment: envInfo.isDevelopment,
        isPreview: envInfo.isPreview
      },
      credentials: {
        cfAccountId: cfAccountId ? '***' : null,
        cfApiToken: cfApiToken ? '***' : null,
        netlifyToken: netlifyToken ? '***' : null,
        helperAccountId: helperAccountId ? '***' : null,
        helperApiToken: helperApiToken ? '***' : null,
        cfProjectName,
        fromRequestBody: !!(requestBody.accountId || requestBody.apiToken || requestBody.netlifyToken)
      },
      cfEnvironment: cfEnvVars,
      cloudflareTargetCreation: cfResult,
      netlifyTargetCreation: netlifyResult
    });
  } catch (error) {
    logger.error('Error in debug-target-creation endpoint:', error);
    return json({
      success: false,
      error: `${error}`
    });
  }
}

export const loader = action; 