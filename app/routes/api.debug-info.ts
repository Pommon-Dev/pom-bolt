import { json } from '@remix-run/cloudflare';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getKvNamespace } from '~/lib/kv/binding';
import { getProjectStateManager } from '~/lib/projects';
import { getNetlifyCredentials, getGitHubCredentials } from '~/lib/deployment/credentials';

const logger = createScopedLogger('api-debug-info');

/**
 * Debug endpoint to diagnose environment issues
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

  // Try to access KV namespace
  const kv = getKvNamespace(context);
  logger.debug('KV namespace availability:', {
    hasKv: !!kv,
    kvType: kv ? typeof kv : 'none',
    kvMethods: kv ? Object.getOwnPropertyNames(Object.getPrototypeOf(kv)).join(', ') : 'none'
  });

  // Try to create a project state manager
  const projectStateManager = getProjectStateManager(context);
  logger.debug('Project state manager:', {
    managerType: typeof projectStateManager,
    hasStorageAdapter: !!(projectStateManager as any)?.storageAdapter,
    hasStorageService: !!(projectStateManager as any)?.storageService
  });

  // Try to access credentials
  const netlifyCredentials = getNetlifyCredentials(context);
  const githubCredentials = getGitHubCredentials(context);

  // Get API key info
  const env = cf?.env || {};
  
  // Mask sensitive values for security
  const maskValue = (value: string | undefined) => {
    if (!value) return undefined;
    if (value.length <= 8) return '******';
    return value.substring(0, 4) + '...' + value.substring(value.length - 4);
  };

  // Create response with all the diagnostic information
  return json({
    status: 'success',
    message: 'Debug information',
    contextStructure: {
      hasCloudflare: !!cf,
      hasEnv: !!cf?.env,
      availableKeys: cf?.env ? Object.keys(cf.env) : []
    },
    kv: {
      available: !!kv,
      type: kv ? typeof kv : 'none',
      methods: kv ? Object.getOwnPropertyNames(Object.getPrototypeOf(kv)).filter(m => m !== 'constructor').join(', ') : 'none'
    },
    projectStateManager: {
      available: !!projectStateManager,
      type: typeof projectStateManager
    },
    credentials: {
      netlify: {
        hasApiToken: !!netlifyCredentials.apiToken,
        tokenInfo: netlifyCredentials.apiToken ? {
          length: netlifyCredentials.apiToken.length,
          prefix: maskValue(netlifyCredentials.apiToken)
        } : 'missing'
      },
      github: {
        hasToken: !!githubCredentials.token,
        hasOwner: !!githubCredentials.owner,
        tokenInfo: githubCredentials.token ? {
          length: githubCredentials.token.length,
          prefix: maskValue(githubCredentials.token)
        } : 'missing',
        owner: githubCredentials.owner
      }
    },
    apiKeys: {
      openai: {
        exists: !!env.OPENAI_API_KEY,
        masked: maskValue(env.OPENAI_API_KEY)
      },
      netlify: {
        authToken: {
          exists: !!env.NETLIFY_AUTH_TOKEN,
          masked: maskValue(env.NETLIFY_AUTH_TOKEN)
        },
        apiToken: {
          exists: !!env.NETLIFY_API_TOKEN,
          masked: maskValue(env.NETLIFY_API_TOKEN)
        }
      },
      github: {
        token: {
          exists: !!env.GITHUB_TOKEN,
          masked: maskValue(env.GITHUB_TOKEN)
        },
        owner: {
          exists: !!env.GITHUB_OWNER,
          value: env.GITHUB_OWNER
        }
      }
    }
  });
} 