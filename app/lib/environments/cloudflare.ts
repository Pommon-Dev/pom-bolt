import { v4 as uuidv4 } from 'uuid';
import type { Environment, EnvironmentInfo } from './base';
import { EnvironmentType, StorageType } from './base';
import { createScopedLogger } from '~/utils/logger';
import type { ProjectState as Project } from '~/lib/projects/types';
import { BaseEnvironment } from './base';

const logger = createScopedLogger('cloudflare-environment');

/**
 * Cloudflare environment implementation
 * Handles the specific aspects of running in Cloudflare Pages or Workers
 */
export class CloudflareEnvironment extends BaseEnvironment {
  private _env: Record<string, any>;
  private _kvBinding: any;
  
  constructor(env?: any) {
    super();
    
    // First try to use the provided env, then check for KV binding in global env
    this._env = env || {};
    
    // Try to find KV binding - check both global and env contexts
    this.initializeKvBinding();
    
    logger.debug('Cloudflare environment initialized', {
      hasEnv: Object.keys(this._env).length > 0,
      hasKvBinding: !!this._kvBinding,
      envKeys: Object.keys(this._env).join(', '),
      isCFPagesEnv: this._env?.CF_PAGES === '1',
      cfPagesUrl: this._env?.CF_PAGES_URL,
      cloudflareProject: this._env?.CF_PAGES_BRANCH
    });
  }
  
  /**
   * Initialize KV binding from available sources
   */
  private initializeKvBinding() {
    // First check global binding (available when deployed to Cloudflare)
    try {
      if (typeof (globalThis as any).POM_BOLT_PROJECTS !== 'undefined') {
        this._kvBinding = (globalThis as any).POM_BOLT_PROJECTS;
        logger.debug('KV binding found in global scope');
        return;
      }
    } catch (error) {
      logger.warn('Error checking global KV binding:', error);
    }
    
    // Then check env.POM_BOLT_PROJECTS
    try {
      if (this._env?.POM_BOLT_PROJECTS) {
        // Check if it's actually a KV binding with methods
        const hasKvMethods = typeof this._env.POM_BOLT_PROJECTS?.put === 'function' &&
                            typeof this._env.POM_BOLT_PROJECTS?.get === 'function';
        
        if (hasKvMethods) {
          this._kvBinding = this._env.POM_BOLT_PROJECTS;
          logger.debug('KV binding found in environment', { 
            bindingType: typeof this._env.POM_BOLT_PROJECTS,
            hasPut: typeof this._env.POM_BOLT_PROJECTS?.put === 'function',
            hasGet: typeof this._env.POM_BOLT_PROJECTS?.get === 'function',
            hasDelete: typeof this._env.POM_BOLT_PROJECTS?.delete === 'function',
            hasList: typeof this._env.POM_BOLT_PROJECTS?.list === 'function'
          });
          return;
        } else {
          logger.warn('POM_BOLT_PROJECTS exists in env but is not a valid KV binding', {
            type: typeof this._env.POM_BOLT_PROJECTS,
            isObject: typeof this._env.POM_BOLT_PROJECTS === 'object',
            keys: Object.keys(this._env.POM_BOLT_PROJECTS || {})
          });
        }
      }

      // Check for Remix/Cloudflare Pages special structure (context.cloudflare.env)
      if (this._env?.cloudflare?.env?.POM_BOLT_PROJECTS) {
        const cfKv = this._env.cloudflare.env.POM_BOLT_PROJECTS;
        const hasKvMethods = typeof cfKv?.put === 'function' && typeof cfKv?.get === 'function';
        
        if (hasKvMethods) {
          this._kvBinding = cfKv;
          logger.debug('KV binding found in cloudflare.env path', {
            bindingType: typeof cfKv,
            hasPut: typeof cfKv?.put === 'function',
            hasGet: typeof cfKv?.get === 'function'
          });
          return;
        }
      }
    } catch (error) {
      logger.warn('Error checking env KV binding:', error);
    }
    
    logger.debug('No KV binding found', { 
      envKeys: Object.keys(this._env || {}).join(','),
      hasGlobalPomBoltProjects: typeof (globalThis as any).POM_BOLT_PROJECTS !== 'undefined',
      cfPagesEnv: this._env?.CF_PAGES,
      cfPagesBranch: this._env?.CF_PAGES_BRANCH,
      environment: this._env?.ENVIRONMENT,
      nodeEnv: this._env?.NODE_ENV,
      hasCloudflareInEnv: 'cloudflare' in (this._env || {}),
      cloudflareEnvKeys: this._env?.cloudflare?.env ? Object.keys(this._env.cloudflare.env).join(',') : 'none'
    });
  }
  
  /**
   * Get environment information
   */
  getInfo(): EnvironmentInfo {
    // For Cloudflare deployments, we prioritize the ENVIRONMENT variable over NODE_ENV
    // since NODE_ENV might be 'development' based on build settings
    const envSetting = this._env?.ENVIRONMENT || '';
    
    // CF_PAGES is set to '1' when deployed to Cloudflare Pages
    const isCloudflareDeployment = 
      this._env?.CF_PAGES === '1' || 
      this._env?.CF_PAGES === 'true' ||
      !!this._env?.CF_PAGES_URL;
      
    const isProduction = envSetting === 'production' || 
                        (!envSetting && isCloudflareDeployment && this._env?.CF_PAGES_BRANCH === 'main');
    const isPreview = envSetting === 'preview' || 
                     (!envSetting && isCloudflareDeployment && this._env?.CF_PAGES_BRANCH !== 'main');
                     
    // Only use NODE_ENV for development if we're not in a Cloudflare deployment
    const isDevelopment = !isCloudflareDeployment && this._env?.NODE_ENV === 'development';
    
    logger.debug('Getting Cloudflare environment info', {
      envSetting,
      isCloudflareDeployment,
      branch: this._env?.CF_PAGES_BRANCH,
      isProduction,
      isPreview,
      isDevelopment,
      nodeEnv: this._env?.NODE_ENV
    });
    
    return {
      type: EnvironmentType.CLOUDFLARE,
      isProduction,
      isDevelopment,
      isPreview
    };
  }
  
  /**
   * Get available storage types
   */
  getAvailableStorageTypes(): StorageType[] {
    const types = [StorageType.MEMORY];
    
    // Only add KV if we have a binding
    if (this._kvBinding) {
      types.push(StorageType.CLOUDFLARE_KV);
    }
    
    return types;
  }
  
  /**
   * Check if a specific storage type is available
   */
  isStorageAvailable(type: StorageType): boolean {
    if (type === StorageType.MEMORY) {
      return true;
    }
    
    if (type === StorageType.CLOUDFLARE_KV) {
      return !!this._kvBinding;
    }
    
    return false;
  }
  
  /**
   * Store a value
   */
  async storeValue(storageType: StorageType, key: string, value: any): Promise<void> {
    switch (storageType) {
      case StorageType.CLOUDFLARE_KV:
        if (!this._kvBinding) {
          throw new Error('KV storage not available');
        }
        
        try {
          await this._kvBinding.put(key, JSON.stringify(value));
          logger.debug(`Stored value in KV: ${key}`);
        } catch (error) {
          logger.error(`Error storing value in KV: ${key}`, error);
          throw error;
        }
        break;
        
      case StorageType.MEMORY:
        await super.storeValue(StorageType.MEMORY, key, value);
        break;
        
      default:
        throw new Error(`Storage type not supported: ${storageType}`);
    }
  }
  
  /**
   * Retrieve a value
   */
  async retrieveValue<T = any>(storageType: StorageType, key: string): Promise<T | null> {
    switch (storageType) {
      case StorageType.CLOUDFLARE_KV:
        if (!this._kvBinding) {
          logger.warn('KV storage not available, falling back to memory');
          return super.retrieveValue<T>(StorageType.MEMORY, key);
        }
        
        try {
          const value = await this._kvBinding.get(key);
          
          if (!value) {
            logger.debug(`No value found in KV for key: ${key}`);
            return null;
          }
          
          logger.debug(`Retrieved value from KV: ${key}`);
          return JSON.parse(value) as T;
        } catch (error) {
          logger.error(`Error retrieving value from KV: ${key}`, error);
          return null;
        }
        
      case StorageType.MEMORY:
        return super.retrieveValue<T>(StorageType.MEMORY, key);
        
      default:
        throw new Error(`Storage type not supported: ${storageType}`);
    }
  }
  
  /**
   * Remove a value
   */
  async removeValue(storageType: StorageType, key: string): Promise<void> {
    switch (storageType) {
      case StorageType.CLOUDFLARE_KV:
        if (!this._kvBinding) {
          logger.warn('KV storage not available, falling back to memory');
          await super.removeValue(StorageType.MEMORY, key);
          return;
        }
        
        try {
          await this._kvBinding.delete(key);
          logger.debug(`Removed value from KV: ${key}`);
        } catch (error) {
          logger.error(`Error removing value from KV: ${key}`, error);
          throw error;
        }
        break;
        
      case StorageType.MEMORY:
        await super.removeValue(StorageType.MEMORY, key);
        break;
        
      default:
        throw new Error(`Storage type not supported: ${storageType}`);
    }
  }
  
  /**
   * List all keys with a specific prefix
   */
  async listKeys(storageType: StorageType, prefix: string): Promise<string[]> {
    switch (storageType) {
      case StorageType.CLOUDFLARE_KV:
        if (!this._kvBinding) {
          logger.warn('KV storage not available, falling back to memory');
          return super.listKeys(StorageType.MEMORY, prefix);
        }
        
        try {
          const list = await this._kvBinding.list({ prefix });
          logger.debug(`Listed ${list.keys.length} keys from KV with prefix: ${prefix}`);
          return list.keys.map((key: any) => key.name);
        } catch (error) {
          logger.error(`Error listing keys from KV with prefix: ${prefix}`, error);
          return [];
        }
        
      case StorageType.MEMORY:
        return super.listKeys(StorageType.MEMORY, prefix);
        
      default:
        throw new Error(`Storage type not supported: ${storageType}`);
    }
  }

  /**
   * Check if an environment variable exists
   */
  hasEnvVariable(key: string): boolean {
    return (this._env && this._env[key] !== undefined) || 
           (typeof process !== 'undefined' && process.env && process.env[key] !== undefined);
  }
  
  /**
   * Get an environment variable
   */
  getEnvVariable<T = string>(key: string, defaultValue?: T): T | undefined {
    // For Cloudflare credentials - expanded search with enhanced logging
    if (key === "CLOUDFLARE_ACCOUNT_ID" || key === "CLOUDFLARE_API_TOKEN") {
      logger.debug(`Looking for credential: ${key}`);
      
      // Check all possible sources in order of likelihood
      const possibleSources = [
        // Direct from Cloudflare Pages environment variables (set via dashboard)
        this._env?.[key],
        // From Cloudflare context
        this._env?.cloudflare?.env?.[key],
        // From Node.js process.env
        process.env[key],
        // From alternative paths in context
        this._env?.env?.[key],
        (this._env as any)?.cloudflare?.context?.env?.[key],
        // From bindings section if available
        this._env?.cloudflare?.env?.CLOUDFLARE_ACCOUNT_ID, // For account ID
        this._env?.cloudflare?.env?.CLOUDFLARE_API_TOKEN,  // For API token
        // From direct cloudflare object
        (this._env as any)?.cloudflare?.accountId, // For account ID
        (this._env as any)?.cloudflare?.apiToken   // For API token
      ];
      
      for (let i = 0; i < possibleSources.length; i++) {
        const source = possibleSources[i];
        if (source) {
          logger.debug(`Found ${key} in source #${i}`);
          return source as unknown as T;
        }
      }
      
      logger.warn(`Could not find ${key} in any environment source`);
      return defaultValue;
    }
    
    // Original implementation for other variables
    if (this._env?.[key]) {
      return this._env[key] as unknown as T;
    }
    
    if (this._env?.cloudflare?.env && this._env.cloudflare.env[key]) {
      return this._env.cloudflare.env[key] as unknown as T;
    }
    
    return (process.env[key] as unknown as T) || defaultValue;
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

  async getProjectById(id: string): Promise<Project | null> {
    try {
      // Try to use KV storage if available
      if (this._env.KV) {
        try {
          console.log(`[CloudflareEnvironment] Getting project from KV: ${id}`);
          const rawProject = await this._env.KV.get(id);
          if (rawProject) {
            console.log(`[CloudflareEnvironment] Project found in KV: ${id}`);
            return JSON.parse(rawProject);
          }
          console.log(`[CloudflareEnvironment] Project not found in KV: ${id}`);
          return null;
        } catch (kvError) {
          console.error(`[CloudflareEnvironment] KV error:`, kvError);
        }
      }
      
      // Fallback to in-memory storage
      const inMemoryProject = this._inMemoryStorage.get(id);
      if (inMemoryProject) {
        return inMemoryProject as Project;
      }
      return null;
    } catch (error) {
      console.error('[CloudflareEnvironment] Error getting project:', error);
      return null;
    }
  }
}
