import { createScopedLogger } from '~/utils/logger';
import type { KVNamespace } from '@cloudflare/workers-types';
import type { EnhancedProjectStorageAdapter } from '../enhanced-types';
import { getKvNamespace } from '~/lib/kv/binding';
import type { ProjectState } from '../types';
import type { EnhancedProjectState, SearchProjectsOptions } from '../enhanced-types';

const logger = createScopedLogger('kv-project-storage');

/**
 * KV storage adapter for file chunks and caching
 */
export class KVProjectStorageAdapter implements EnhancedProjectStorageAdapter {
  private kv: KVNamespace | null;
  private context: any;
  private keyPrefix: string;
  private cache = new Map<string, any>();
  
  constructor(options: { 
    kvNamespace?: KVNamespace; 
    context?: any; 
    keyPrefix?: string;
  } = {}) {
    this.kv = options.kvNamespace || null;
    this.context = options.context || {};
    this.keyPrefix = options.keyPrefix || 'project';
    
    // Initialize KV from context if not provided directly
    if (!this.kv) {
      try {
        this.kv = getKvNamespace(this.context);
        logger.debug('KV initialized from context', { hasKv: !!this.kv });
      } catch (error) {
        logger.error('Failed to initialize KV from context', error);
      }
    }
    
    logger.debug('KV storage adapter initialized', { 
      hasKv: !!this.kv,
      keyPrefix: this.keyPrefix,
      hasContext: !!this.context,
      contextType: this.context ? typeof this.context : 'none'
    });
  }
  
  /**
   * Update the context for the KV adapter
   * Useful when the context is available later in the request lifecycle
   */
  public updateContext(context: any): void {
    this.context = context;
    
    // Try to reinitialize KV with the new context
    if (!this.kv) {
      try {
        this.kv = getKvNamespace(this.context);
        logger.debug('KV reinitialized with updated context', { hasKv: !!this.kv });
      } catch (error) {
        logger.error('Failed to reinitialize KV with updated context', error);
      }
    }
  }
  
  /**
   * Get a file chunk from KV storage
   */
  async getFileChunk(key: string): Promise<string | null> {
    try {
      const chunk = await this.kv?.get(key) || null;
      return chunk;
    } catch (error) {
      logger.error(`Error getting file chunk from KV: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Save a file chunk to KV storage
   */
  async saveFileChunk(key: string, value: string): Promise<void> {
    try {
      await this.kv?.put(key, value);
      logger.info(`File chunk saved to KV: ${key}`);
    } catch (error) {
      logger.error(`Error saving file chunk to KV: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Get a cached value from KV storage
   */
  async getCacheValue<T>(projectId: string, key: string): Promise<T | null> {
    try {
      const cacheKey = `${this.keyPrefix}:${projectId}:${key}`;
      if (this.cache.has(cacheKey)) {
        logger.debug(`Cache hit for project ${projectId} and key ${key}`);
        return this.cache.get(cacheKey) as T;
      }
      
      const value = await this.kv?.get(key);
      if (value) {
        this.cache.set(cacheKey, value);
        return value as T;
      }
      return null;
    } catch (error) {
      logger.error(`Error getting cache value from KV: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Set a cached value in KV storage
   */
  async setCacheValue<T>(projectId: string, key: string, value: T, ttl?: number): Promise<void> {
    try {
      const options: KVNamespacePutOptions = {};
      if (ttl) {
        options.expirationTtl = ttl;
      }
      
      const cacheKey = `${this.keyPrefix}:${projectId}:${key}`;
      const serializedValue = JSON.stringify(value);
      await this.kv?.put(key, serializedValue, options);
      this.cache.set(cacheKey, value);
      logger.info(`Cache value set in KV: ${key}`);
    } catch (error) {
      logger.error(`Error setting cache value in KV: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Invalidate a cached value in KV storage
   */
  async invalidateCache(key: string): Promise<void> {
    try {
      await this.kv?.delete(key);
      logger.info(`Cache value invalidated in KV: ${key}`);
    } catch (error) {
      logger.error(`Error invalidating cache value in KV: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Get a project by ID
   */
  async getProject(id: string): Promise<EnhancedProjectState | null> {
    if (!this.kv) {
      await this.maybeInitKv();
      if (!this.kv) {
        logger.error('No KV namespace available for getProject');
        return null;
      }
    }

    // Check cache first
    const cacheKey = `${this.keyPrefix}:${id}`;
    if (this.cache.has(cacheKey)) {
      logger.debug(`Cache hit for project ${id}`);
      return this.cache.get(cacheKey) as EnhancedProjectState;
    }
    
    try {
      logger.debug(`Fetching project ${id} from KV`);
      const key = `${this.keyPrefix}:${id}`;
      const data = await this.kv?.get(key, 'json');
      
      if (!data) {
        logger.warn(`Project ${id} not found in KV storage`, { key });
        return null;
      }
      
      // Store in cache for future use
      this.cache.set(cacheKey, data);
      return data as EnhancedProjectState;
    } catch (error) {
      logger.error(`Error fetching project ${id} from KV`, error);
      return null;
    }
  }
  
  // These methods are not implemented in KV adapter as they use D1
  async saveProject(): Promise<void> {
    throw new Error('Method not implemented in KV adapter');
  }
  
  async deleteProject(): Promise<boolean> {
    throw new Error('Method not implemented in KV adapter');
  }
  
  async projectExists(): Promise<boolean> {
    throw new Error('Method not implemented in KV adapter');
  }
  
  async searchProjects(): Promise<{ projects: EnhancedProjectState[]; total: number }> {
    throw new Error('Method not implemented in KV adapter');
  }
  
  async updateProjectMetadata(): Promise<void> {
    throw new Error('Method not implemented in KV adapter');
  }
  
  async updateSearchIndex(): Promise<void> {
    throw new Error('Method not implemented in KV adapter');
  }
  
  /**
   * Try to initialize KV if not already available
   * This is a fallback method that tries different ways to get KV access
   */
  private async maybeInitKv(): Promise<boolean> {
    if (this.kv) return true;
    
    // Try multiple ways to access KV
    try {
      // Try direct context access first
      this.kv = getKvNamespace(this.context);
      if (this.kv) {
        logger.debug('KV initialized from direct context');
        return true;
      }
      
      // Try accessing via cloudflare.env path if available
      if (this.context?.cloudflare?.env?.POM_BOLT_PROJECTS) {
        this.kv = this.context.cloudflare.env.POM_BOLT_PROJECTS;
        logger.debug('KV initialized from cloudflare.env.POM_BOLT_PROJECTS');
        return true;
      }
      
      // Try env property if available
      if (this.context?.env?.POM_BOLT_PROJECTS) {
        this.kv = this.context.env.POM_BOLT_PROJECTS;
        logger.debug('KV initialized from env.POM_BOLT_PROJECTS');
        return true;
      }
      
      logger.warn('Could not initialize KV from any context source', {
        contextKeys: this.context ? Object.keys(this.context).join(',') : 'none',
        hasCfEnv: !!(this.context?.cloudflare?.env),
        cfEnvKeys: this.context?.cloudflare?.env ? Object.keys(this.context.cloudflare.env).join(',') : 'none'
      });
      
      return false;
    } catch (error) {
      logger.error('Error initializing KV namespace', error);
      return false;
    }
  }
} 