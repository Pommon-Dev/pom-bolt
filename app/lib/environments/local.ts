import { v4 as uuidv4 } from 'uuid';
import type { Environment, EnvironmentInfo } from './base';
import { EnvironmentType, StorageType, BaseEnvironment } from './base';
import { createScopedLogger } from '~/utils/logger';
import * as os from 'node:os';

const logger = createScopedLogger('local-environment');

/**
 * Implementation of the Environment interface for local development
 */
export class LocalEnvironment extends BaseEnvironment {
  getInfo(): EnvironmentInfo {
    const isDev = process.env.NODE_ENV === 'development';

    return {
      type: EnvironmentType.LOCAL,
      isProduction: process.env.NODE_ENV === 'production',
      isDevelopment: isDev,
      isPreview: false,
    };
  }

  getEnvVariable<T = string>(key: string, defaultValue?: T): T | undefined {
    const value = process.env[key];

    if (value === undefined) {
      return defaultValue;
    }

    // Try to parse as JSON for complex types
    if (typeof defaultValue !== 'string' && value) {
      try {
        return JSON.parse(value) as T;
      } catch (e) {
        logger.warn(`Failed to parse environment variable ${key} as JSON`);
      }
    }

    return value as unknown as T;
  }

  hasEnvVariable(key: string): boolean {
    return process.env[key] !== undefined;
  }

  getAvailableStorageTypes(): StorageType[] {
    // In browser context, we have access to local and session storage
    const hasWindow = typeof window !== 'undefined';
    const storageTypes: StorageType[] = [StorageType.MEMORY];

    if (hasWindow) {
      try {
        // Test localStorage access (may be disabled in some browsers)
        localStorage.setItem('__test__', 'test');
        localStorage.removeItem('__test__');
        storageTypes.push(StorageType.LOCAL_STORAGE);
      } catch (e) {
        logger.warn('localStorage is not available');
      }

      try {
        // Test sessionStorage access
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
        await super.storeValue(StorageType.MEMORY, key, value);
        break;

      default:
        throw new Error(`Storage type ${storageType} is not supported in local environment`);
    }
  }

  async retrieveValue<T>(storageType: StorageType, key: string): Promise<T | null> {
    switch (storageType) {
      case StorageType.LOCAL_STORAGE:
        if (typeof localStorage !== 'undefined') {
          const value = localStorage.getItem(key);

          if (value === null) {
            return null;
          }

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

          if (value === null) {
            return null;
          }

          try {
            return JSON.parse(value) as T;
          } catch (e) {
            return value as unknown as T;
          }
        }
        throw new Error('sessionStorage is not available in this environment');

      case StorageType.MEMORY:
        return super.retrieveValue<T>(StorageType.MEMORY, key);

      default:
        throw new Error(`Storage type ${storageType} is not supported in local environment`);
    }
  }

  async removeValue(storageType: StorageType, key: string): Promise<void> {
    switch (storageType) {
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
        await super.removeValue(StorageType.MEMORY, key);
        break;

      default:
        throw new Error(`Storage type ${storageType} is not supported in local environment`);
    }
  }

  canExecuteCommands(): boolean {
    // In local development, we typically can execute commands
    return typeof process !== 'undefined' && process.versions && !!process.versions.node;
  }

  hasFilesystemAccess(): boolean {
    // Check if we're in a Node.js environment with fs access
    return typeof process !== 'undefined' && process.versions && !!process.versions.node;
  }

  getTempDirectoryPath(): string | null {
    if (!this.hasFilesystemAccess()) {
      return null;
    }

    try {
      // In Node.js environment, use os.tmpdir
      // In Cloudflare Workers, return a fallback path
      return os?.tmpdir?.() || '/tmp';
    } catch (error) {
      logger.error('Error getting temp directory path:', error);
      return '/tmp';
    }
  }

  createUniqueId(): string {
    return uuidv4();
  }

  // Used to implement the listKeys method for different storage types
  async listKeys(storageType: StorageType, prefix: string): Promise<string[]> {
    switch (storageType) {
      case StorageType.LOCAL_STORAGE:
        if (typeof localStorage !== 'undefined') {
          const keys: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
              keys.push(key);
            }
          }
          return keys;
        }
        throw new Error('localStorage is not available in this environment');

      case StorageType.SESSION_STORAGE:
        if (typeof sessionStorage !== 'undefined') {
          const keys: string[] = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith(prefix)) {
              keys.push(key);
            }
          }
          return keys;
        }
        throw new Error('sessionStorage is not available in this environment');

      case StorageType.MEMORY:
        return super.listKeys(StorageType.MEMORY, prefix);

      default:
        throw new Error(`Storage type ${storageType} is not supported in local environment`);
    }
  }
}
