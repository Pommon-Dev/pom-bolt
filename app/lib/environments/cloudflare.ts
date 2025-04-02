import { v4 as uuidv4 } from 'uuid';
import type { Environment, EnvironmentInfo } from './base';
import { EnvironmentType, StorageType } from './base';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('cloudflare-environment');

/**
 * Implementation of the Environment interface for Cloudflare Pages
 */
export class CloudflareEnvironment implements Environment {
  private inMemoryStorage: Map<string, any> = new Map();
  private readonly env: any;

  constructor(env?: any) {
    this.env = env || {};
  }

  getInfo(): EnvironmentInfo {
    // Cloudflare Pages sets CF_PAGES=1 for all Pages deployments
    const isPages = this.env.CF_PAGES === '1' || process.env.CF_PAGES === '1';
    
    // Preview deployments set CF_PAGES_BRANCH to something other than 'main' or 'production'
    const branch = this.env.CF_PAGES_BRANCH || process.env.CF_PAGES_BRANCH || 'unknown';
    const isPreview = isPages && branch !== 'main' && branch !== 'production';
    const isProduction = isPages && (branch === 'main' || branch === 'production');
    
    return {
      type: EnvironmentType.CLOUDFLARE,
      isProduction,
      isDevelopment: !isProduction,
      isPreview
    };
  }

  getEnvVariable<T = string>(key: string, defaultValue?: T): T | undefined {
    // Check Cloudflare environment bindings first
    if (this.env && this.env[key] !== undefined) {
      const value = this.env[key];
      
      // Try to parse as JSON for complex types
      if (typeof defaultValue !== 'string' && typeof value === 'string') {
        try {
          return JSON.parse(value) as T;
        } catch (e) {
          logger.warn(`Failed to parse environment variable ${key} as JSON`);
        }
      }
      
      return value as T;
    }
    
    // Then check process.env
    const value = process.env[key];
    if (value !== undefined) {
      // Try to parse as JSON for complex types
      if (typeof defaultValue !== 'string') {
        try {
          return JSON.parse(value) as T;
        } catch (e) {
          logger.warn(`Failed to parse environment variable ${key} as JSON`);
        }
      }
      
      return value as unknown as T;
    }
    
    return defaultValue;
  }

  hasEnvVariable(key: string): boolean {
    return (this.env && this.env[key] !== undefined) || process.env[key] !== undefined;
  }

  getAvailableStorageTypes(): StorageType[] {
    const storageTypes: StorageType[] = [StorageType.MEMORY];
    
    // Check if we have KV access
    if (this.env && this.env.KV) {
      storageTypes.push(StorageType.CLOUDFLARE_KV);
    }
    
    // Check if we have D1 access
    if (this.env && this.env.DB) {
      storageTypes.push(StorageType.CLOUDFLARE_D1);
    }
    
    // Browser storage is available in client-side code
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('__test__', 'test');
        localStorage.removeItem('__test__');
        storageTypes.push(StorageType.LOCAL_STORAGE);
      } catch (e) {
        logger.warn('localStorage is not available');
      }
      
      try {
        sessionStorage.setItem('__test__', 'test');
        sessionStorage.removeItem('__test__');
        storageTypes.push(StorageType.SESSION_STORAGE);
      } catch (e) {
        logger.warn('sessionStorage is not available');
      }
    }
    
    return storageTypes;
  }

  isStorageAvailable(storageType: StorageType): boolean {
    return this.getAvailableStorageTypes().includes(storageType);
  }

  async storeValue<T>(storageType: StorageType, key: string, value: T): Promise<void> {
    const stringValue = JSON.stringify(value);
    
    switch (storageType) {
      case StorageType.CLOUDFLARE_KV:
        if (this.env && this.env.KV) {
          await this.env.KV.put(key, stringValue);
        } else {
          throw new Error('Cloudflare KV is not available in this environment');
        }
        break;
        
      case StorageType.CLOUDFLARE_D1:
        if (this.env && this.env.DB) {
          // This is a simplified example - actual implementation would depend on your DB schema
          await this.env.DB.prepare(
            'INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)'
          ).bind(key, stringValue).run();
        } else {
          throw new Error('Cloudflare D1 is not available in this environment');
        }
        break;
        
      case StorageType.LOCAL_STORAGE:
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, stringValue);
        } else {
          throw new Error('localStorage is not available in this environment');
        }
        break;
        
      case StorageType.SESSION_STORAGE:
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(key, stringValue);
        } else {
          throw new Error('sessionStorage is not available in this environment');
        }
        break;
        
      case StorageType.MEMORY:
        this.inMemoryStorage.set(key, value);
        break;
        
      default:
        throw new Error(`Storage type ${storageType} is not supported in Cloudflare environment`);
    }
  }

  async retrieveValue<T>(storageType: StorageType, key: string): Promise<T | null> {
    switch (storageType) {
      case StorageType.CLOUDFLARE_KV:
        if (this.env && this.env.KV) {
          const value = await this.env.KV.get(key);
          if (value === null) return null;
          
          try {
            return typeof value === 'string' ? JSON.parse(value) as T : value as T;
          } catch (e) {
            return value as unknown as T;
          }
        }
        throw new Error('Cloudflare KV is not available in this environment');
        
      case StorageType.CLOUDFLARE_D1:
        if (this.env && this.env.DB) {
          // This is a simplified example - actual implementation would depend on your DB schema
          const result = await this.env.DB.prepare(
            'SELECT value FROM kv_store WHERE key = ?'
          ).bind(key).first();
          
          if (!result) return null;
          
          try {
            return JSON.parse(result.value) as T;
          } catch (e) {
            return result.value as unknown as T;
          }
        }
        throw new Error('Cloudflare D1 is not available in this environment');
        
      case StorageType.LOCAL_STORAGE:
        if (typeof localStorage !== 'undefined') {
          const value = localStorage.getItem(key);
          if (value === null) return null;
          
          try {
            return JSON.parse(value) as T;
          } catch (e) {
            return value as unknown as T;
          }
        }
        throw new Error('localStorage is not available in this environment');
        
      case StorageType.SESSION_STORAGE:
        if (typeof sessionStorage !== 'undefined') {
          const value = sessionStorage.getItem(key);
          if (value === null) return null;
          
          try {
            return JSON.parse(value) as T;
          } catch (e) {
            return value as unknown as T;
          }
        }
        throw new Error('sessionStorage is not available in this environment');
        
      case StorageType.MEMORY:
        return this.inMemoryStorage.get(key) || null;
        
      default:
        throw new Error(`Storage type ${storageType} is not supported in Cloudflare environment`);
    }
  }

  async removeValue(storageType: StorageType, key: string): Promise<void> {
    switch (storageType) {
      case StorageType.CLOUDFLARE_KV:
        if (this.env && this.env.KV) {
          await this.env.KV.delete(key);
        } else {
          throw new Error('Cloudflare KV is not available in this environment');
        }
        break;
        
      case StorageType.CLOUDFLARE_D1:
        if (this.env && this.env.DB) {
          // This is a simplified example - actual implementation would depend on your DB schema
          await this.env.DB.prepare(
            'DELETE FROM kv_store WHERE key = ?'
          ).bind(key).run();
        } else {
          throw new Error('Cloudflare D1 is not available in this environment');
        }
        break;
        
      case StorageType.LOCAL_STORAGE:
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(key);
        } else {
          throw new Error('localStorage is not available in this environment');
        }
        break;
        
      case StorageType.SESSION_STORAGE:
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem(key);
        } else {
          throw new Error('sessionStorage is not available in this environment');
        }
        break;
        
      case StorageType.MEMORY:
        this.inMemoryStorage.delete(key);
        break;
        
      default:
        throw new Error(`Storage type ${storageType} is not supported in Cloudflare environment`);
    }
  }

  canExecuteCommands(): boolean {
    // Cloudflare Workers/Pages cannot execute system commands
    return false;
  }

  hasFilesystemAccess(): boolean {
    // Cloudflare Workers/Pages don't have file system access
    return false;
  }

  getTempDirectoryPath(): string | null {
    // No filesystem access in Cloudflare environment
    return null;
  }

  createUniqueId(): string {
    return uuidv4();
  }
} 