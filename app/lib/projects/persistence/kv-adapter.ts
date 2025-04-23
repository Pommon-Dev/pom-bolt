import { createScopedLogger } from '~/utils/logger';
import type { KVNamespace } from '@cloudflare/workers-types';
import type { EnhancedProjectStorageAdapter } from '../enhanced-types';

const logger = createScopedLogger('kv-project-storage');

/**
 * KV storage adapter for file chunks and caching
 */
export class KVProjectStorageAdapter implements EnhancedProjectStorageAdapter {
  private fileStorage: KVNamespace;
  private cacheStorage: KVNamespace;
  
  constructor(fileStorage: KVNamespace, cacheStorage: KVNamespace) {
    this.fileStorage = fileStorage;
    this.cacheStorage = cacheStorage;
  }
  
  /**
   * Get a file chunk from KV storage
   */
  async getFileChunk(key: string): Promise<string | null> {
    try {
      const chunk = await this.fileStorage.get(key);
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
      await this.fileStorage.put(key, value);
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
      const value = await this.cacheStorage.get(key);
      return value ? JSON.parse(value) as T : null;
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
      
      const serializedValue = JSON.stringify(value);
      await this.cacheStorage.put(key, serializedValue, options);
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
      await this.cacheStorage.delete(key);
      logger.info(`Cache value invalidated in KV: ${key}`);
    } catch (error) {
      logger.error(`Error invalidating cache value in KV: ${key}`, error);
      throw error;
    }
  }
  
  // These methods are not implemented in KV adapter as they use D1
  async saveProject(): Promise<void> {
    throw new Error('Method not implemented in KV adapter');
  }
  
  async getProject(): Promise<null> {
    throw new Error('Method not implemented in KV adapter');
  }
  
  async deleteProject(): Promise<boolean> {
    throw new Error('Method not implemented in KV adapter');
  }
  
  async projectExists(): Promise<boolean> {
    throw new Error('Method not implemented in KV adapter');
  }
  
  async searchProjects(): Promise<{ projects: []; total: number }> {
    throw new Error('Method not implemented in KV adapter');
  }
  
  async updateProjectMetadata(): Promise<void> {
    throw new Error('Method not implemented in KV adapter');
  }
  
  async updateSearchIndex(): Promise<void> {
    throw new Error('Method not implemented in KV adapter');
  }
} 