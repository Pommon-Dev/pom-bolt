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
    // Check if we have context.cloudflare structure first (Remix/Pages specific)
    const hasCloudflareContext = !!context?.cloudflare;
    const hasCloudflarePagesEnv = !!context?.cloudflare?.env?.CF_PAGES;
    
    // Access environment variables from different possible locations
    const directEnv = context?.env || {};
    const cloudflareEnv = context?.cloudflare?.env || {};
    const combinedEnv = { ...directEnv, ...cloudflareEnv, ...process.env };
    
    // Check for Cloudflare Pages environment variable
    const isPagesEnv = 
      combinedEnv?.CF_PAGES === '1' || 
      combinedEnv?.CF_PAGES === 'true' ||
      !!combinedEnv?.CF_PAGES_URL;
    
    // Check for Cloudflare Pages branch
    const hasPagesInfo = 
      !!combinedEnv?.CF_PAGES_BRANCH ||
      !!combinedEnv?.CF_PAGES_COMMIT_SHA;
    
    // Check for KV binding in context, cloudflare.env, or global scope
    const hasKvBinding = 
      !!directEnv?.POM_BOLT_PROJECTS ||
      !!cloudflareEnv?.POM_BOLT_PROJECTS ||
      (typeof globalThis !== 'undefined' && 'POM_BOLT_PROJECTS' in globalThis);
    
    // Check for Cloudflare request context
    const hasCloudflareRequest = !!context?.request?.cf || !!context?.cloudflare?.request?.cf;
    
    // Log the detection factors
    logger.debug('Cloudflare environment detection:', {
      hasCloudflareContext,
      hasCloudflarePagesEnv,
      isPagesEnv,
      hasPagesInfo,
      hasKvBinding,
      hasCloudflareRequest,
      cf_pages: combinedEnv?.CF_PAGES, 
      cf_pages_url: combinedEnv?.CF_PAGES_URL,
      cf_pages_branch: combinedEnv?.CF_PAGES_BRANCH,
      node_env: combinedEnv?.NODE_ENV
    });
    
    return hasCloudflareContext || isPagesEnv || hasKvBinding || hasPagesInfo || hasCloudflareRequest;
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
  // Always recreate environment when context is provided
  if (context) {
    logger.debug('Creating environment with context', {
      hasContext: !!context, 
      hasCloudflare: !!context?.cloudflare,
      hasEnv: !!context?.env,
      hasCfEnv: !!context?.cloudflare?.env
    });
    
    // Force recreation with the provided context
    environment = detectEnvironment(context);
    return environment;
  }
  
  // Reuse existing environment if available
  if (environment) {
    return environment;
  }
  
  // Create a new environment if none exists
  logger.debug('Creating new environment without context');
  environment = detectEnvironment();
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
