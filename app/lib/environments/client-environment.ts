import { v4 as uuidv4 } from 'uuid';
import { createScopedLogger } from '~/utils/logger';
import { EnvironmentType, type EnvironmentManager, StorageType, type EnvironmentInfo } from './index';

const logger = createScopedLogger('client-environment');

// In-memory storage for fallback
const memoryStore = new Map<string, string>();

export function createClientEnvironment(): EnvironmentManager {
  logger.info('Creating client environment');
  
  return {
    getEnvironmentType() {
      return EnvironmentType.LOCAL;
    },
    
    isProduction() {
      return process.env.NODE_ENV === 'production' ? true : false;
    },
    
    isClient() {
      return true;
    },
    
    getInfo(): EnvironmentInfo {
      return {
        type: EnvironmentType.LOCAL,
        isProduction: this.isProduction(),
        isClient: true
      };
    },
    
    getEnvVariable<T>(key: string, defaultValue?: T): T | undefined {
      if (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__[key] !== undefined) {
        return window.__ENV__[key] as T;
      }
      return defaultValue;
    },
    
    hasEnvVariable(key: string): boolean {
      return typeof window !== 'undefined' && !!window.__ENV__ && window.__ENV__[key] !== undefined;
    },
    
    getAvailableStorageTypes(): StorageType[] {
      const types: StorageType[] = [StorageType.MEMORY];
      
      if (typeof window !== 'undefined' && window.localStorage) {
        types.push(StorageType.LOCAL_STORAGE);
      }
      
      if (typeof window !== 'undefined' && window.sessionStorage) {
        types.push(StorageType.SESSION_STORAGE);
      }
      
      return types;
    },
    
    async storeValue<T>(storageType: StorageType, key: string, value: T): Promise<void> {
      try {
        const serialized = JSON.stringify(value);
        
        switch (storageType) {
          case StorageType.LOCAL_STORAGE:
            if (typeof window === 'undefined' || !window.localStorage) {
              throw new Error('localStorage not available');
            }
            window.localStorage.setItem(key, serialized);
            break;
            
          case StorageType.SESSION_STORAGE:
            if (typeof window === 'undefined' || !window.sessionStorage) {
              throw new Error('sessionStorage not available');
            }
            window.sessionStorage.setItem(key, serialized);
            break;
            
          case StorageType.MEMORY:
            memoryStore.set(key, serialized);
            break;
            
          default:
            throw new Error(`Storage type ${storageType} not supported in client environment`);
        }
      } catch (error) {
        logger.error(`Failed to store value with key "${key}":`, error);
        
        // Fallback to memory store if browser storage fails (e.g., quota exceeded)
        if (storageType !== StorageType.MEMORY) {
          logger.warn(`Falling back to memory storage for key "${key}"`);
          memoryStore.set(key, JSON.stringify(value));
        } else {
          throw error;
        }
      }
    },
    
    async retrieveValue<T>(storageType: StorageType, key: string): Promise<T | null> {
      try {
        let value: string | null = null;
        
        switch (storageType) {
          case StorageType.LOCAL_STORAGE:
            if (typeof window === 'undefined' || !window.localStorage) {
              throw new Error('localStorage not available');
            }
            value = window.localStorage.getItem(key);
            break;
            
          case StorageType.SESSION_STORAGE:
            if (typeof window === 'undefined' || !window.sessionStorage) {
              throw new Error('sessionStorage not available');
            }
            value = window.sessionStorage.getItem(key);
            break;
            
          case StorageType.MEMORY:
            value = memoryStore.get(key) || null;
            break;
            
          default:
            throw new Error(`Storage type ${storageType} not supported in client environment`);
        }
        
        return value ? JSON.parse(value) as T : null;
      } catch (error) {
        logger.error(`Failed to retrieve value with key "${key}":`, error);
        
        // Fallback to memory store if browser storage fails
        if (storageType !== StorageType.MEMORY) {
          logger.warn(`Falling back to memory storage for key "${key}"`);
          const memoryValue = memoryStore.get(key);
          return memoryValue ? JSON.parse(memoryValue) as T : null;
        }
        
        throw error;
      }
    },
    
    async removeValue(storageType: StorageType, key: string): Promise<void> {
      try {
        switch (storageType) {
          case StorageType.LOCAL_STORAGE:
            if (typeof window === 'undefined' || !window.localStorage) {
              throw new Error('localStorage not available');
            }
            window.localStorage.removeItem(key);
            break;
            
          case StorageType.SESSION_STORAGE:
            if (typeof window === 'undefined' || !window.sessionStorage) {
              throw new Error('sessionStorage not available');
            }
            window.sessionStorage.removeItem(key);
            break;
            
          case StorageType.MEMORY:
            memoryStore.delete(key);
            break;
            
          default:
            throw new Error(`Storage type ${storageType} not supported in client environment`);
        }
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

// Type definitions for window.__ENV__
declare global {
  interface Window {
    __ENV__?: Record<string, any>;
  }
} 