import { LocalEnvironment } from './local';
import { CloudflareEnvironment } from './cloudflare';
import type { Environment } from './base';
import { EnvironmentType } from './base';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('environment-detector');

/**
 * Detects the current runtime environment and returns the appropriate implementation
 */
export function detectEnvironment(cloudflareEnv?: any): Environment {
  // Check for Cloudflare Pages environment
  const isPagesEnv = typeof process !== 'undefined' && 
                    (process.env.CF_PAGES === '1' || (cloudflareEnv && cloudflareEnv.CF_PAGES === '1'));
                    
  // Check if we're in a browser environment (client-side rendering)
  const isBrowser = typeof window !== 'undefined';
  
  if (isPagesEnv) {
    logger.info('Detected Cloudflare Pages environment');
    return new CloudflareEnvironment(cloudflareEnv);
  }
  
  // For local development, browser-side code, and fallback
  logger.info('Using local environment');
  return new LocalEnvironment();
}

/**
 * Singleton instance of the current environment
 * Use this for most application needs
 */
let environmentInstance: Environment | null = null;

/**
 * Get the environment instance, creating it if it doesn't exist
 */
export function getEnvironment(cloudflareEnv?: any): Environment {
  if (!environmentInstance) {
    environmentInstance = detectEnvironment(cloudflareEnv);
  }
  
  return environmentInstance;
}

/**
 * Reset the environment instance
 * This is primarily used for testing
 */
export function resetEnvironment(): void {
  environmentInstance = null;
}

/**
 * Override the environment instance
 * This is primarily used for testing or specialized initialization
 */
export function setEnvironment(environment: Environment): void {
  environmentInstance = environment;
} 