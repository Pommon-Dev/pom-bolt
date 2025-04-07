import { json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { CloudflarePagesTarget } from '~/lib/deployment/targets/cloudflare-pages';
import { getEnvironment } from '~/lib/environments/detector';

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
    const accountId = requestBody.accountId || environment.getEnvVariable('CLOUDFLARE_ACCOUNT_ID');
    const apiToken = requestBody.apiToken || environment.getEnvVariable('CLOUDFLARE_API_TOKEN');
    const projectName = requestBody.projectName || 'genapps'; // Default fixed project name
    
    logger.debug('Debug target creation credentials:', {
      hasAccountId: !!accountId,
      hasApiToken: !!apiToken,
      projectName,
      fromRequestBody: !!(requestBody.accountId || requestBody.apiToken)
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
    
    // Attempt to create the target manually
    let target = null;
    let isAvailableResult = false;
    let error = null;
    
    if (accountId && apiToken) {
      try {
        target = new CloudflarePagesTarget({
          accountId,
          apiToken,
          projectName
        });
        
        logger.debug('Target created, checking availability');
        isAvailableResult = await target.isAvailable();
        logger.debug(`Target availability check result: ${isAvailableResult}`);
      } catch (err) {
        error = `${err}`;
        logger.error('Error creating or checking target:', err);
      }
    }
    
    return json({
      success: true,
      environment: {
        type: envInfo.type,
        isProduction: envInfo.isProduction,
        isDevelopment: envInfo.isDevelopment,
        isPreview: envInfo.isPreview
      },
      credentials: {
        accountId: accountId ? '***' : null,
        apiToken: apiToken ? '***' : null,
        helperAccountId: helperAccountId ? '***' : null,
        helperApiToken: helperApiToken ? '***' : null,
        projectName,
        fromRequestBody: !!(requestBody.accountId || requestBody.apiToken)
      },
      cfEnvironment: cfEnvVars,
      targetCreation: {
        targetCreated: !!target,
        isAvailable: isAvailableResult,
        error
      }
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