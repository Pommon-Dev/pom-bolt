import { v4 as uuidv4 } from 'uuid';
import { createScopedLogger } from '~/utils/logger';
import { EnvironmentType, type EnvironmentManager, StorageType, type EnvironmentInfo } from './index';

const logger = createScopedLogger('cloudflare-environment');

interface CloudflareEnv {
  DB?: D1Database;
  POM_BOLT_PROJECTS?: KVNamespace;
  POM_BOLT_FILES?: KVNamespace;
  POM_BOLT_CACHE?: KVNamespace;
  [key: string]: any;
}

export function createCloudflareEnvironment(env: CloudflareEnv): EnvironmentManager {
  logger.info('Creating Cloudflare environment', {
    hasD1: !!env.DB,
    hasKV: !!env.POM_BOLT_PROJECTS
  });
  
  return {
    getEnvironmentType() {
      return EnvironmentType.CLOUDFLARE;
    },
    
    isProduction() {
      return env.ENVIRONMENT === 'production';
    },
    
    isClient() {
      return false;
    },
    
    getInfo(): EnvironmentInfo {
      return {
        type: EnvironmentType.CLOUDFLARE,
        isProduction: this.isProduction(),
        isClient: false
      };
    },
    
    getEnvVariable<T>(key: string, defaultValue?: T): T | undefined {
      if (env[key] !== undefined) {
        return env[key] as T;
      }
      return defaultValue;
    },
    
    hasEnvVariable(key: string): boolean {
      return env[key] !== undefined;
    },
    
    getAvailableStorageTypes(): StorageType[] {
      const types: StorageType[] = [StorageType.MEMORY];
      
      if (env.DB) {
        types.push(StorageType.CLOUDFLARE_D1);
      }
      
      if (env.POM_BOLT_PROJECTS) {
        types.push(StorageType.CLOUDFLARE_KV);
      }
      
      return types;
    },
    
    async storeValue<T>(storageType: StorageType, key: string, value: T): Promise<void> {
      try {
        switch (storageType) {
          case StorageType.CLOUDFLARE_KV:
            if (!env.POM_BOLT_PROJECTS) {
              throw new Error('KV namespace not available');
            }
            await env.POM_BOLT_PROJECTS.put(key, JSON.stringify(value));
            break;
            
          case StorageType.CLOUDFLARE_D1:
            if (!env.DB) {
              throw new Error('D1 database not available');
            }
            // In a real implementation, this would insert into a key-value table
            // This is simplified - you'd need an actual table for this
            logger.warn('D1 key-value storage not implemented');
            break;
            
          case StorageType.MEMORY:
            // Memory storage not persistent between requests in Cloudflare Workers
            logger.warn('Memory storage in Cloudflare environment is not persistent');
            break;
            
          default:
            throw new Error(`Storage type ${storageType} not supported in Cloudflare environment`);
        }
      } catch (error) {
        logger.error(`Failed to store value with key "${key}":`, error);
        throw error;
      }
    },
    
    async retrieveValue<T>(storageType: StorageType, key: string): Promise<T | null> {
      try {
        switch (storageType) {
          case StorageType.CLOUDFLARE_KV: {
            if (!env.POM_BOLT_PROJECTS) {
              throw new Error('KV namespace not available');
            }
            const value = await env.POM_BOLT_PROJECTS.get(key);
            return value ? JSON.parse(value) as T : null;
          }
            
          case StorageType.CLOUDFLARE_D1:
            if (!env.DB) {
              throw new Error('D1 database not available');
            }
            // In a real implementation, this would query from a key-value table
            logger.warn('D1 key-value storage not implemented');
            return null;
            
          case StorageType.MEMORY:
            // Memory storage not persistent between requests in Cloudflare Workers
            logger.warn('Memory storage in Cloudflare environment is not persistent');
            return null;
            
          default:
            throw new Error(`Storage type ${storageType} not supported in Cloudflare environment`);
        }
      } catch (error) {
        logger.error(`Failed to retrieve value with key "${key}":`, error);
        throw error;
      }
    },
    
    async removeValue(storageType: StorageType, key: string): Promise<void> {
      try {
        switch (storageType) {
          case StorageType.CLOUDFLARE_KV:
            if (!env.POM_BOLT_PROJECTS) {
              throw new Error('KV namespace not available');
            }
            await env.POM_BOLT_PROJECTS.delete(key);
            break;
            
          case StorageType.CLOUDFLARE_D1:
            if (!env.DB) {
              throw new Error('D1 database not available');
            }
            // In a real implementation, this would delete from a key-value table
            logger.warn('D1 key-value storage not implemented');
            break;
            
          case StorageType.MEMORY:
            // Memory storage not persistent between requests in Cloudflare Workers
            logger.warn('Memory storage in Cloudflare environment is not persistent');
            break;
            
          default:
            throw new Error(`Storage type ${storageType} not supported in Cloudflare environment`);
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