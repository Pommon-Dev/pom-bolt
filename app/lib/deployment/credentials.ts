import { createScopedLogger } from '~/utils/logger';
import type { CloudflareConfig } from './types';

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
 * Get Cloudflare credentials - combining loaded credentials with any from the context
 */
export function getCloudflareCredentials(context?: any): Partial<CloudflareConfig> {
  // First try to load from environment variables
  const envCredentials = loadCloudflareCredentials();
  
  // If we have complete credentials from environment, use those
  if (envCredentials.accountId && envCredentials.apiToken) {
    return envCredentials;
  }
  
  // Otherwise try to get credentials from the context
  const contextCredentials: Partial<CloudflareConfig> = {
    projectName: 'genapps', // Always use genapps project
  };
  
  if (!context) {
    // If we have any credentials from the environment, return those
    return envCredentials;
  }
  
  // Try different paths to find Cloudflare credentials
  const possibleEnvSources = [
    context?.cloudflare?.env,
    context?.env,
    // If needed, cast context to any to access potentially available paths
    (context as any)?.cloudflare?.context?.env,
    // Direct root access
    context,
    // Add more paths if necessary
  ];
  
  // Find CLOUDFLARE_ACCOUNT_ID in any of the sources
  for (const source of possibleEnvSources) {
    if (source && typeof source.CLOUDFLARE_ACCOUNT_ID === 'string') {
      contextCredentials.accountId = source.CLOUDFLARE_ACCOUNT_ID;
      logger.debug('Found CLOUDFLARE_ACCOUNT_ID in context');
      break;
    }
  }
  
  // Find CLOUDFLARE_API_TOKEN in any of the sources
  for (const source of possibleEnvSources) {
    if (source && typeof source.CLOUDFLARE_API_TOKEN === 'string') {
      contextCredentials.apiToken = source.CLOUDFLARE_API_TOKEN;
      logger.debug('Found CLOUDFLARE_API_TOKEN in context');
      break;
    }
  }
  
  // Merge credentials, prioritizing the environment variables
  return {
    projectName: 'genapps',
    accountId: envCredentials.accountId || contextCredentials.accountId,
    apiToken: envCredentials.apiToken || contextCredentials.apiToken,
  };
} 