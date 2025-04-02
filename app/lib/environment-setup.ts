import getEnvironment, { StorageType } from '~/lib/environments';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('environment-setup');

/**
 * Initialize the environment when this module is imported
 * This should happen as early as possible in the application lifecycle
 */
const env = getEnvironment();
logger.info(`Application running in environment: ${env.getInfo().type}`);

/**
 * Helper to get environment variables with proper typing
 */
export function getEnv<T = string>(key: string, defaultValue?: T): T | undefined {
  return env.getEnvVariable<T>(key, defaultValue);
}

/**
 * Helper to check if an environment variable exists
 */
export function hasEnv(key: string): boolean {
  return env.hasEnvVariable(key);
}

/**
 * Helper to get the best available storage type for the current environment
 * Prioritizes persistent storage types when available
 */
export function getBestStorageType(): StorageType {
  const availableTypes = env.getAvailableStorageTypes();
  
  // Preferred storage types in order
  const preferredTypes = [
    StorageType.CLOUDFLARE_D1,
    StorageType.CLOUDFLARE_KV,
    StorageType.LOCAL_STORAGE,
    StorageType.SESSION_STORAGE,
    StorageType.MEMORY
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
    await env.storeValue<T>(storageType, key, value);
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
    return await env.retrieveValue<T>(storageType, key);
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
    await env.removeValue(storageType, key);
  } catch (error) {
    logger.error(`Failed to remove value with key "${key}": ${error}`);
    throw error;
  }
}

/**
 * Generate a unique ID using the environment's implementation
 */
export function generateUniqueId(): string {
  return env.createUniqueId();
}

/**
 * Get information about the current environment
 */
export function getEnvironmentInfo() {
  return env.getInfo();
}

// Export the environment instance for advanced use cases
export const environment = env; 