import { createScopedLogger } from '~/utils/logger';
import type { CloudflareConfig } from './types';

interface EnvWithCloudflare {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
}

interface EnvWithNetlify {
  NETLIFY_AUTH_TOKEN?: string;
}

interface EnvWithGitHub {
  GITHUB_TOKEN?: string;
  GITHUB_USER?: string;
}

const logger = createScopedLogger('deployment-credentials');

/**
 * Load Cloudflare credentials from environment variables
 * This version is browser-compatible by avoiding direct fs/path usage
 */
export function loadCloudflareCredentials(): Partial<CloudflareConfig> {
  const credentials: Partial<CloudflareConfig> = {
    projectName: 'genapps', // Always use genapps project
  };

  // First check environment variables
  try {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.CLOUDFLARE_ACCOUNT_ID) {
        credentials.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        logger.debug('Found CLOUDFLARE_ACCOUNT_ID in process.env');
      }

      if (process.env.CLOUDFLARE_API_TOKEN) {
        credentials.apiToken = process.env.CLOUDFLARE_API_TOKEN;
        logger.debug('Found CLOUDFLARE_API_TOKEN in process.env');
      }

      // If we have all credentials from env vars, return them
      if (credentials.accountId && credentials.apiToken) {
        logger.info('Using Cloudflare credentials from environment variables');
        return credentials;
      }
    }
  } catch (error) {
    logger.warn('Error accessing process.env:', error);
  }
  
  // In browser context, we don't attempt to load from .env.deploy
  // That's only possible in Node.js environment
  if (typeof window !== 'undefined') {
    logger.debug('Running in browser context, cannot load .env.deploy file');
    return credentials;
  }
  
  // When running in Cloudflare environment, we don't load from file anyway
  logger.info('No Cloudflare credentials found in environment variables');
  
  return credentials;
}

/**
 * Extract Cloudflare credentials from context or environment
 */
export function getCloudflareCredentials(context: any = {}): { accountId?: string; apiToken?: string; projectName?: string } {
  const env = context.cloudflare?.env || context.env || {};
  
  const accountId = typeof env.CLOUDFLARE_ACCOUNT_ID === 'string' ? env.CLOUDFLARE_ACCOUNT_ID : undefined;
  const apiToken = typeof env.CLOUDFLARE_API_TOKEN === 'string' ? env.CLOUDFLARE_API_TOKEN : undefined;
  
  logger.debug('Cloudflare credentials status:', { 
    hasAccountId: !!accountId,
    hasApiToken: !!apiToken
  });
  
  return {
    accountId,
    apiToken,
    projectName: 'genapps' // Default project name for Cloudflare Pages
  };
}

/**
 * Extract Netlify credentials from context or environment
 */
export function getNetlifyCredentials(context: any = {}): { apiToken?: string } {
  const env = context.cloudflare?.env || context.env || {};
  
  const apiToken = typeof env.NETLIFY_API_TOKEN === 'string' ? env.NETLIFY_API_TOKEN : undefined;
  
  logger.debug('Netlify credentials status:', { 
    hasApiToken: !!apiToken
  });
  
  return {
    apiToken
  };
}

/**
 * Extract GitHub credentials from context or environment
 */
export function getGitHubCredentials(context: any = {}): { token?: string; owner?: string } {
  const env = context.cloudflare?.env || context.env || {};
  
  const token = typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN : undefined;
  const owner = typeof env.GITHUB_OWNER === 'string' ? env.GITHUB_OWNER : undefined;
  
  logger.debug('GitHub credentials status:', { 
    hasToken: !!token,
    hasOwner: !!owner
  });
  
  return {
    token,
    owner
  };
}

/**
 * Extract API keys from cookies or request
 */
export function getApiKeysFromCookie(request: Request): { netlifyToken?: string; githubToken?: string } {
  const cookies = request.headers.get('cookie') || '';
  const netlifyMatch = cookies.match(/netlifyToken=([^;]+)/);
  const githubMatch = cookies.match(/githubToken=([^;]+)/);
  
  return {
    netlifyToken: netlifyMatch ? netlifyMatch[1] : undefined,
    githubToken: githubMatch ? githubMatch[1] : undefined
  };
}

/**
 * Extract provider settings from cookies
 */
export function getProviderSettingsFromCookie(request: Request): { 
  preferredProvider?: string;
  githubOwner?: string; 
} {
  const cookies = request.headers.get('cookie') || '';
  const providerMatch = cookies.match(/preferredProvider=([^;]+)/);
  const ownerMatch = cookies.match(/githubOwner=([^;]+)/);
  
  return {
    preferredProvider: providerMatch ? providerMatch[1] : undefined,
    githubOwner: ownerMatch ? ownerMatch[1] : undefined
  };
} 