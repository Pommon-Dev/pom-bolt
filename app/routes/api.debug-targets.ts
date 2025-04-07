import { json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getDeploymentManager } from '~/lib/deployment';
import { getCloudflareCredentials } from '~/lib/deployment/credentials';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';

const logger = createScopedLogger('api-debug-targets');

/**
 * Debug endpoint to check the available deployment targets
 */
export async function action({ request, context }: ActionFunctionArgs) {
  try {
    // Get cloudflare credentials
    const cfConfig = getCloudflareCredentials(context);
    
    // Log credentials status (redacted)
    logger.debug('Cloudflare credentials status:', {
      hasAccountId: !!cfConfig.accountId,
      hasApiToken: !!cfConfig.apiToken,
      hasProjectName: !!cfConfig.projectName,
      complete: !!(cfConfig.accountId && cfConfig.apiToken)
    });

    // Get deployment manager
    const deploymentManager = getDeploymentManager({
      cloudflareConfig: cfConfig.accountId && cfConfig.apiToken 
        ? cfConfig 
        : undefined
    });
    
    // Get available targets
    const availableTargets = await deploymentManager.getAvailableTargets();
    const registeredTargets = deploymentManager.getRegisteredTargets();
    
    return json({
      success: true,
      credentials: {
        hasAccountId: !!cfConfig.accountId,
        hasApiToken: !!cfConfig.apiToken,
        complete: !!(cfConfig.accountId && cfConfig.apiToken)
      },
      targets: {
        available: availableTargets,
        registered: registeredTargets
      }
    });
  } catch (error) {
    logger.error('Error in debug-targets endpoint:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  return action({ request, context, params: {} });
} 