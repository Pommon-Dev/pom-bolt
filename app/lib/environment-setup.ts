import { createCloudflareEnvironment } from './environments/cloudflare-environment';
import { createMemoryEnvironment } from './environments/memory-environment';
import { createClientEnvironment } from './environments/client-environment';
import type { EnvironmentManager } from './environments';
import { EnvironmentType, StorageType } from './environments';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('environment-setup');

// Singleton
export let environment: EnvironmentManager | undefined;

export function getEnvironmentInfo() {
  if (!environment) {
    // In development, initialize a default client environment rather than returning null
    if (typeof window !== 'undefined' && (!process.env.NODE_ENV || process.env.NODE_ENV === 'development')) {
      logger.warn('Environment not initialized yet, initializing client environment for development');
      environment = createClientEnvironment();
    } else {
      logger.warn('Environment not initialized yet');
      return {
        type: 'unknown',
        isProduction: false,
        isClient: typeof window !== 'undefined'
      };
    }
  }
  
  return {
    type: environment.getEnvironmentType(),
    isProduction: environment.isProduction(),
    isDevelopment: !environment.isProduction(),
    isClient: environment.isClient()
  };
}

export function initEnvironmentWithContext(context?: any) {
  if (environment) {
    logger.debug('Environment already initialized');
    return environment;
  }

  logger.info('Initializing environment', {
    context: context ? 'provided' : 'not provided',
    isClient: typeof window !== 'undefined'
  });

  // Server-side (Cloudflare Workers environment)
  if (typeof window === 'undefined') {
    if (context?.cloudflare?.env) {
      const { env } = context.cloudflare;
      
      // Log available bindings
      logger.info('Cloudflare environment bindings available:', {
        DB: !!env.DB,
        POM_BOLT_PROJECTS: !!env.POM_BOLT_PROJECTS,
        POM_BOLT_FILES: !!env.POM_BOLT_FILES,
        POM_BOLT_CACHE: !!env.POM_BOLT_CACHE,
      });
      
      if (env.DB && env.POM_BOLT_PROJECTS) {
        logger.info('Creating Cloudflare environment with database and KV bindings');
        environment = createCloudflareEnvironment(env);
      } else {
        logger.warn('Missing required bindings, creating memory environment', {
          missingDB: !env.DB,
          missingProjects: !env.POM_BOLT_PROJECTS
        });
        environment = createMemoryEnvironment();
      }
    } else {
      logger.warn('No Cloudflare context provided, creating memory environment');
      environment = createMemoryEnvironment();
    }
  } 
  // Client-side
  else {
    logger.info('Creating client environment');
    environment = createClientEnvironment();
    
    // Set window.__ENV__ for client-side access to environment variables 
    if (typeof window !== 'undefined' && !window.__ENV__) {
      window.__ENV__ = {
        NODE_ENV: process.env.NODE_ENV || 'development',
        ENVIRONMENT: 'local'
      };
    }
  }

  return environment;
}

export function getEnvironment(): EnvironmentManager {
  if (!environment) {
    logger.warn('Environment not initialized yet, initializing with defaults');
    initEnvironmentWithContext();
  }
  
  return environment as EnvironmentManager;
}

// For testing and debugging
export function resetEnvironment() {
  logger.info('Resetting environment');
  environment = undefined;
}

/**
 * Helper to get environment variables with proper typing
 */
export function getEnv<T = string>(key: string, defaultValue?: T): T | undefined {
  return getEnvironment().getEnvVariable<T>(key, defaultValue);
}

/**
 * Helper to check if an environment variable exists
 */
export function hasEnv(key: string): boolean {
  return getEnvironment().hasEnvVariable(key);
}

/**
 * Helper to get the best available storage type for the current environment
 * Prioritizes persistent storage types when available
 */
export function getBestStorageType(): StorageType {
  const availableTypes = getEnvironment().getAvailableStorageTypes();

  // Preferred storage types in order
  const preferredTypes = [
    StorageType.CLOUDFLARE_D1,
    StorageType.CLOUDFLARE_KV,
    StorageType.LOCAL_STORAGE,
    StorageType.SESSION_STORAGE,
    StorageType.MEMORY,
  ];

  // Find the first available preferred storage type
  for (const type of preferredTypes) {
    if (availableTypes.includes(type)) {
      return type;
    }
  }

  // Fallback to memory storage if nothing else is available
  return StorageType.MEMORY;
}

/**
 * Store a value in the best available storage
 */
export async function storeValue<T>(key: string, value: T): Promise<void> {
  const storageType = getBestStorageType();
  logger.debug(`Storing value with key "${key}" using storage type: ${storageType}`);

  try {
    await getEnvironment().storeValue<T>(storageType, key, value);
  } catch (error) {
    logger.error(`Failed to store value with key "${key}": ${error}`);
    throw error;
  }
}

/**
 * Retrieve a value from the best available storage
 */
export async function retrieveValue<T>(key: string): Promise<T | null> {
  const storageType = getBestStorageType();
  logger.debug(`Retrieving value with key "${key}" using storage type: ${storageType}`);

  try {
    return await getEnvironment().retrieveValue<T>(storageType, key);
  } catch (error) {
    logger.error(`Failed to retrieve value with key "${key}": ${error}`);
    throw error;
  }
}

/**
 * Remove a value from the best available storage
 */
export async function removeValue(key: string): Promise<void> {
  const storageType = getBestStorageType();
  logger.debug(`Removing value with key "${key}" using storage type: ${storageType}`);

  try {
    await getEnvironment().removeValue(storageType, key);
  } catch (error) {
    logger.error(`Failed to remove value with key "${key}": ${error}`);
    throw error;
  }
}

/**
 * Generate a unique ID using the environment's implementation
 */
export function generateUniqueId(): string {
  return getEnvironment().createUniqueId();
}

// Export the environment instance for advanced use cases
export const environmentInstance = environment;
