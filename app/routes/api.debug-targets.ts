import { json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getCloudflareCredentials, getNetlifyCredentials } from '~/lib/deployment/credentials';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getDeploymentManager } from '~/lib/deployment/deployment-manager';
import type { CloudflareConfig } from '~/lib/deployment/types';

/**
 * Debug endpoint to check available deployment targets and credential status
 */
export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const logger = createScopedLogger('api.debug-targets');
    logger.info('Debug targets called');
    
    // Debug log the context to understand structure
    logger.debug('Context structure in api.debug-targets:', {
      hasContext: !!context,
      contextType: context ? typeof context : 'undefined',
      hasEnv: !!context?.env,
      envType: context?.env ? typeof context.env : 'undefined',
      hasCloudflare: !!context?.cloudflare,
      cloudflareEnvAvailable: !!context?.cloudflare?.env,
    });

    // Log important environment variables
    if (context?.env) {
      logger.debug('Direct env vars available:', Object.keys(context.env));
    }
    if (context?.cloudflare?.env) {
      logger.debug('Cloudflare env vars available:', Object.keys(context.cloudflare.env));
    }
    
    const rawBody = await request.json().catch(() => ({}));
    // Type cast to expected structure
    const body: { 
      netlifyCredentials?: { apiToken?: string }, 
      cfCredentials?: { accountId?: string, apiToken?: string, projectName?: string } 
    } = rawBody as any;
    
    const { netlifyCredentials, cfCredentials } = body;
    
    // Get credentials from multiple sources and log each
    const envNetlifyCredentials = getNetlifyCredentials(context);
    const bodyNetlifyCredentials = netlifyCredentials?.apiToken 
      ? { apiToken: netlifyCredentials.apiToken } 
      : { apiToken: undefined };
    
    // Log what credentials were found
    logger.info('Credentials check:', {
      netlifyFromEnv: !!envNetlifyCredentials.apiToken,
      netlifyFromBody: !!bodyNetlifyCredentials.apiToken,
    });
    
    // Combine env and body credentials, prioritizing env
    let netlifyToken = envNetlifyCredentials.apiToken;
    if (!netlifyToken && netlifyCredentials && netlifyCredentials.apiToken) {
      netlifyToken = netlifyCredentials.apiToken;
      logger.info('Using Netlify credentials from request body (none found in environment)');
    }
    
    // Get Cloudflare credentials similarly
    const cfConfig = getCloudflareCredentials(context);
    if (cfCredentials && cfCredentials.accountId && cfCredentials.apiToken) {
      logger.info('Using Cloudflare credentials from request body');
      Object.assign(cfConfig, {
        accountId: cfCredentials.accountId,
        apiToken: cfCredentials.apiToken,
        projectName: cfCredentials.projectName || cfConfig.projectName
      });
    }
    
    // Get the deployment manager with credentials
    const deploymentManager = await getDeploymentManager({
      cloudflareConfig: cfConfig.accountId && cfConfig.apiToken ? cfConfig as CloudflareConfig : undefined,
      netlifyToken
    });
    
    // Log available targets
    const availableTargets = await deploymentManager.getAvailableTargets();
    const registeredTargets = deploymentManager.getRegisteredTargets();
    
    logger.info('Targets available:', {
      available: availableTargets,
      registered: registeredTargets
    });
    
    // For debugging, create an object with detailed context structure info
    const contextDebugInfo = {
      hasDirectEnv: !!context?.env,
      hasCloudflareProp: !!context?.cloudflare,
      hasCloudflareEnv: !!context?.cloudflare?.env,
      directEnvKeys: context?.env ? Object.keys(context.env) : [],
      cfEnvKeys: context?.cloudflare?.env ? Object.keys(context.cloudflare.env) : [],
      netlifyCreds: {
        fromEnv: !!envNetlifyCredentials.apiToken,
        envSource: envNetlifyCredentials.apiToken ? 'found' : 'not-found',
        fromBody: !!bodyNetlifyCredentials.apiToken,
      }
    };
    
    return json({
      success: true,
      credentials: {
        hasAccountId: !!cfConfig.accountId,
        hasApiToken: !!cfConfig.apiToken,
        hasNetlifyToken: !!netlifyToken,
        complete: !!(cfConfig.accountId && cfConfig.apiToken)
      },
      targets: {
        available: availableTargets,
        registered: registeredTargets
      },
      contextDebug: contextDebugInfo
    });
  } catch (error) {
    const logger = createScopedLogger('api.debug-targets');
    logger.error('Error getting deployment targets:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error getting deployment targets'
    }, { status: 500 });
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  return action({ request, context, params: {} });
} 