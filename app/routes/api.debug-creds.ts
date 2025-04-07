import { json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getEnvironment } from '~/lib/environments';
import { getCloudflareCredentials } from '~/lib/deployment/credentials';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';

const logger = createScopedLogger('api-debug-creds');

/**
 * Debug endpoint to check the availability of Cloudflare credentials
 * Redacts actual credential values for security
 */
export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const environment = getEnvironment();
    const envInfo = environment.getInfo();
    
    // Get Cloudflare credentials (safely - don't expose actual values)
    const accountId = environment.getEnvVariable('CLOUDFLARE_ACCOUNT_ID');
    const apiToken = environment.getEnvVariable('CLOUDFLARE_API_TOKEN');
    
    // Check runtime environment
    const runtime = {
      hasWindow: typeof window !== 'undefined',
      hasProcess: typeof process !== 'undefined',
      hasGlobalThis: typeof globalThis !== 'undefined',
      nodeEnv: typeof process !== 'undefined' ? process.env?.NODE_ENV : 'undefined',
    };
    
    // Check context paths
    const contextPaths = {
      hasContext: !!context,
      hasCloudflare: !!(context?.cloudflare),
      hasEnv: !!(context?.env || context?.cloudflare?.env),
      contextKeys: context ? Object.keys(context as any).join(',') : 'none'
    };
    
    // Try to get credentials from helper function
    const credentials = getCloudflareCredentials(context);
    
    return json({
      success: true,
      environment: {
        type: envInfo.type,
        runtime
      },
      credentials: {
        hasAccountId: !!accountId,
        accountIdType: typeof accountId,
        hasApiToken: !!apiToken,
        apiTokenType: typeof apiToken,
        complete: !!(accountId && apiToken)
      },
      context: contextPaths,
      helperCredentials: {
        hasAccountId: !!credentials.accountId,
        hasApiToken: !!credentials.apiToken,
        complete: !!(credentials.accountId && credentials.apiToken)
      }
    });
  } catch (error) {
    logger.error('Error in debug-creds endpoint:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      runtime: {
        hasWindow: typeof window !== 'undefined',
        hasProcess: typeof process !== 'undefined',
        hasGlobalThis: typeof globalThis !== 'undefined'
      }
    }, { status: 500 });
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  return action({ request, context, params: {} });
} 