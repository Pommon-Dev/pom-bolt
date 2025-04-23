import { v4 as uuidv4 } from 'uuid';
import { createScopedLogger } from '~/utils/logger';
import { EnvironmentType, type EnvironmentManager, StorageType, type EnvironmentInfo } from './index';

const logger = createScopedLogger('memory-environment');

// In-memory storage
const memoryStore = new Map<string, string>();
const envVars = new Map<string, any>();

export function createMemoryEnvironment(): EnvironmentManager {
  logger.info('Creating memory environment');
  
  return {
    getEnvironmentType() {
      return EnvironmentType.MEMORY;
    },
    
    isProduction() {
      return false;
    },
    
    isClient() {
      return false;
    },
    
    getInfo(): EnvironmentInfo {
      return {
        type: EnvironmentType.MEMORY,
        isProduction: false,
        isClient: false
      };
    },
    
    getEnvVariable<T>(key: string, defaultValue?: T): T | undefined {
      if (envVars.has(key)) {
        return envVars.get(key) as T;
      }
      return defaultValue;
    },
    
    hasEnvVariable(key: string): boolean {
      return envVars.has(key);
    },
    
    getAvailableStorageTypes(): StorageType[] {
      return [StorageType.MEMORY];
    },
    
    async storeValue<T>(storageType: StorageType, key: string, value: T): Promise<void> {
      try {
        if (storageType !== StorageType.MEMORY) {
          logger.warn(`Storage type ${storageType} not available in memory environment, using memory instead`);
        }
        
        memoryStore.set(key, JSON.stringify(value));
      } catch (error) {
        logger.error(`Failed to store value with key "${key}":`, error);
        throw error;
      }
    },
    
    async retrieveValue<T>(storageType: StorageType, key: string): Promise<T | null> {
      try {
        if (storageType !== StorageType.MEMORY) {
          logger.warn(`Storage type ${storageType} not available in memory environment, using memory instead`);
        }
        
        const value = memoryStore.get(key);
        return value ? JSON.parse(value) as T : null;
      } catch (error) {
        logger.error(`Failed to retrieve value with key "${key}":`, error);
        throw error;
      }
    },
    
    async removeValue(storageType: StorageType, key: string): Promise<void> {
      try {
        if (storageType !== StorageType.MEMORY) {
          logger.warn(`Storage type ${storageType} not available in memory environment, using memory instead`);
        }
        
        memoryStore.delete(key);
      } catch (error) {
        logger.error(`Failed to remove value with key "${key}":`, error);
        throw error;
      }
    },
    
    createUniqueId(): string {
      return uuidv4();
    }
  };
} 