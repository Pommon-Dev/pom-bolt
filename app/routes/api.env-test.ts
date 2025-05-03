import { json } from '@remix-run/cloudflare';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api-env-test');

/**
 * Debug endpoint to test environment variable access
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  // Log the structure of the context object
  logger.info('Context structure:', {
    contextType: typeof context,
    hasContext: !!context,
    contextKeys: context ? Object.keys(context as any).join(',') : 'none'
  });

  // Check cloudflare context
  const cf = (context as any)?.cloudflare;
  logger.info('Cloudflare context:', {
    hasCf: !!cf,
    cfType: typeof cf,
    cfKeys: cf ? Object.keys(cf).join(',') : 'none',
    hasEnv: !!cf?.env,
    envKeys: cf?.env ? Object.keys(cf.env).join(',') : 'none'
  });

  // Try to access environment variables from various locations
  const env = cf?.env || {};
  
  // Mask sensitive values for security
  const maskValue = (value: string | undefined) => {
    if (!value) return undefined;
    if (value.length <= 8) return '******';
    return value.substring(0, 4) + '...' + value.substring(value.length - 4);
  };

  // Create response with environment variable info
  const envInfo = {
    github: {
      token: maskValue(env.GITHUB_TOKEN),
      owner: env.GITHUB_OWNER,
      hasToken: !!env.GITHUB_TOKEN,
      hasOwner: !!env.GITHUB_OWNER
    },
    netlify: {
      apiToken: maskValue(env.NETLIFY_API_TOKEN),
      authToken: maskValue(env.NETLIFY_AUTH_TOKEN),
      hasApiToken: !!env.NETLIFY_API_TOKEN,
      hasAuthToken: !!env.NETLIFY_AUTH_TOKEN
    },
    openai: {
      apiKey: maskValue(env.OPENAI_API_KEY),
      hasApiKey: !!env.OPENAI_API_KEY
    }
  };
  
  // Return the environment info
  return json({
    status: 'success',
    message: 'Environment variable test',
    envInfo,
    contextStructure: {
      hasCloudflare: !!cf,
      hasEnv: !!cf?.env,
      availableKeys: cf?.env ? Object.keys(cf.env) : []
    }
  });
} 