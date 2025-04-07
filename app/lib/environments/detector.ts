import { EnvironmentType } from './base';
import type { Environment } from './base';
import { CloudflareEnvironment } from './cloudflare';
import { LocalEnvironment } from './local';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('environment-detector');

// Singleton instance
let environment: Environment | null = null;

/**
 * Detect the current environment
 */
export function detectEnvironment(context?: any): Environment {
  // Check for Cloudflare environment first
  if (detectCloudflareEnvironment(context)) {
    logger.debug('Detected Cloudflare environment');
    return new CloudflareEnvironment(context?.env);
  }
  
  // Fallback to local environment
  logger.debug('Using local environment');
  return new LocalEnvironment();
}

/**
 * Detect Cloudflare environment
 */
function detectCloudflareEnvironment(context?: any): boolean {
  try {
    // Access environment variables from context or process.env
    const cloudflareEnv = context?.env || process.env;
    
    // Check for Cloudflare Pages environment variable
    const isPagesEnv = 
      cloudflareEnv?.CF_PAGES === '1' || 
      cloudflareEnv?.CF_PAGES === 'true' ||
      !!cloudflareEnv?.CF_PAGES_URL;
    
    // Check for Cloudflare Pages branch
    const hasPagesInfo = 
      !!cloudflareEnv?.CF_PAGES_BRANCH ||
      !!cloudflareEnv?.CF_PAGES_COMMIT_SHA;
    
    // Check for KV binding in context or global scope
    const hasKvBinding = 
      !!cloudflareEnv?.POM_BOLT_PROJECTS ||
      (typeof globalThis !== 'undefined' && 'POM_BOLT_PROJECTS' in globalThis);
    
    // Check for Cloudflare request context
    const hasCloudflareRequest = !!context?.request?.cf;
    
    // Log the detection factors
    logger.debug('Cloudflare environment detection:', {
      isPagesEnv,
      hasPagesInfo,
      hasKvBinding,
      hasCloudflareRequest,
      cf_pages: cloudflareEnv?.CF_PAGES, 
      cf_pages_url: cloudflareEnv?.CF_PAGES_URL,
      cf_pages_branch: cloudflareEnv?.CF_PAGES_BRANCH,
      node_env: cloudflareEnv?.NODE_ENV
    });
    
    return isPagesEnv || hasKvBinding || hasPagesInfo || hasCloudflareRequest;
  } catch (error) {
    logger.warn('Error detecting Cloudflare environment:', error);
    return false;
  }
}

/**
 * Get the current environment
 * Creates it if it doesn't exist yet, or if a new context is provided
 */
export function getEnvironment(context?: any): Environment {
  if (!environment || context) {
    environment = detectEnvironment(context);
  }
  
  return environment;
}

/**
 * Set the current environment
 * Used primarily for testing or when environment detection needs to be overridden
 */
export function setEnvironment(env: Environment): void {
  environment = env;
  logger.debug(`Environment manually set to: ${env.getInfo().type}`);
}

/**
 * Reset the environment (for testing)
 */
export function resetEnvironment(): void {
  environment = null;
}
