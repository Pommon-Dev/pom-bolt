import { v4 as uuidv4 } from 'uuid';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('environments');

/**
 * Environment types for the application
 */
export enum EnvironmentType {
  CLOUDFLARE = 'cloudflare',
  LOCAL = 'local',
  MEMORY = 'memory'
}

/**
 * Storage types available in the application
 */
export enum StorageType {
  CLOUDFLARE_D1 = 'd1',
  CLOUDFLARE_KV = 'kv',
  LOCAL_STORAGE = 'localStorage',
  SESSION_STORAGE = 'sessionStorage',
  MEMORY = 'memory'
}

/**
 * Environment information structure
 */
export interface EnvironmentInfo {
  type: EnvironmentType;
  isProduction: boolean;
  isClient: boolean;
}

/**
 * Environment manager interface
 */
export interface EnvironmentManager {
  /**
   * Get environment type
   */
  getEnvironmentType(): EnvironmentType;
  
  /**
   * Check if this is a production environment
   */
  isProduction(): boolean;
  
  /**
   * Check if this is a client-side environment
   */
  isClient(): boolean;
  
  /**
   * Get environment information
   */
  getInfo(): EnvironmentInfo;
  
  /**
   * Get environment variable
   */
  getEnvVariable<T>(key: string, defaultValue?: T): T | undefined;
  
  /**
   * Check if environment variable exists
   */
  hasEnvVariable(key: string): boolean;
  
  /**
   * Get available storage types
   */
  getAvailableStorageTypes(): StorageType[];
  
  /**
   * Store a value
   */
  storeValue<T>(storageType: StorageType, key: string, value: T): Promise<void>;
  
  /**
   * Retrieve a value
   */
  retrieveValue<T>(storageType: StorageType, key: string): Promise<T | null>;
  
  /**
   * Remove a value
   */
  removeValue(storageType: StorageType, key: string): Promise<void>;
  
  /**
   * Create a unique ID
   */
  createUniqueId(): string;
}

// Import environment creators
import { createCloudflareEnvironment } from './cloudflare-environment';
import { createMemoryEnvironment } from './memory-environment';
import { createClientEnvironment } from './client-environment';

// Global environment instance
let environmentInstance: EnvironmentManager;

/**
 * Get the environment instance, creating it if necessary
 */
export function getEnvironment(context?: any): EnvironmentManager {
  if (environmentInstance) {
    return environmentInstance;
  }

  logger.info('Creating new environment instance');

  // Determine which environment to create based on the context
  if (typeof window === 'undefined') {
    // Server-side
    if (context?.cloudflare?.env) {
      logger.info('Creating Cloudflare environment');
      environmentInstance = createCloudflareEnvironment(context.cloudflare.env);
    } else {
      logger.warn('No Cloudflare context, falling back to memory environment');
      environmentInstance = createMemoryEnvironment();
    }
  } else {
    // Client-side
    logger.info('Creating client environment');
    environmentInstance = createClientEnvironment();
  }

  return environmentInstance;
}

// Export environment creators
export { createCloudflareEnvironment, createMemoryEnvironment, createClientEnvironment };

// Function to detect the current environment type
export function detectEnvironment(): EnvironmentType {
  if (typeof process !== 'undefined' && process.env.CLOUDFLARE_WORKER) {
    return EnvironmentType.CLOUDFLARE;
  }
  
  if (typeof window !== 'undefined') {
    return EnvironmentType.LOCAL;
  }
  
  // Default to memory for testing or other environments
  return EnvironmentType.MEMORY;
}

// Detect if we're in a browser environment
// const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

// Global environment instance
// let globalEnvironment: EnvironmentManager | null = null;

// Function to detect the current environment type
// export function detectEnvironment(): EnvironmentType {
//   if (typeof process !== 'undefined' && process.env.CLOUDFLARE_WORKER) {
//     return EnvironmentType.CLOUDFLARE;
//   }
//   
//   if (isBrowser) {
//     return EnvironmentType.LOCAL;
//   }
//   
//   // Default to memory for testing or other environments
//   return EnvironmentType.MEMORY;
// }

// Function to get or create the global environment
// export function getEnvironment(): EnvironmentManager {
//   if (globalEnvironment) {
//     return globalEnvironment;
//   }
// 
//   // For server-side, we need to detect the environment
//   const envType = detectEnvironment();
//   
//   logger.debug(`Creating environment of type: ${envType}`);
//   
//   // In a real implementation, we would create the appropriate environment based on the detected type
//   // For now, let's just provide a basic implementation
//   
//   globalEnvironment = {
//     getInfo() {
//       return {
//         type: envType,
//         isProduction: process.env.NODE_ENV === 'production',
//         isClient: isBrowser
//       };
//     },
//     getEnvVariable(key: string) {
//       if (isBrowser) {
//         return undefined; // Browser doesn't have access to env vars
//       }
//       return process.env[key];
//     },
//     isProduction() {
//       return process.env.NODE_ENV === 'production';
//     },
//     isClient() {
//       return isBrowser;
//     },
//     getStorage(type: StorageType) {
//       // This would be implemented with actual storage adapters
//       return null;
//     }
//   };
//   
//   return globalEnvironment;
// } 