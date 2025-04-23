import { createScopedLogger } from '~/utils/logger';
import type { 
  EnhancedProjectState, 
  EnhancedProjectStorageAdapter,
  ProjectMetadata,
  SearchProjectsOptions
} from '../enhanced-types';
import { D1ProjectStorageAdapter } from './d1-adapter';
import { KVProjectStorageAdapter } from './kv-adapter';
import type { D1Database } from '@cloudflare/workers-types';
import type { KVNamespace } from '@cloudflare/workers-types';

const logger = createScopedLogger('project-storage-service');

/**
 * Service that coordinates between D1 and KV storage adapters
 * Provides a unified interface for all project operations
 */
export class ProjectStorageService {
  private d1Adapter: D1ProjectStorageAdapter;
  private kvAdapter: KVProjectStorageAdapter;
  
  constructor(
    d1Db: D1Database,
    fileStorage: KVNamespace,
    cacheStorage: KVNamespace
  ) {
    this.d1Adapter = new D1ProjectStorageAdapter(d1Db);
    this.kvAdapter = new KVProjectStorageAdapter(fileStorage, cacheStorage);
  }
  
  /**
   * Save a project state
   * Metadata is stored in D1, files and cache in KV
   */
  async saveProject(project: EnhancedProjectState): Promise<void> {
    try {
      // Save metadata to D1
      await this.d1Adapter.saveProject(project);
      
      // Save files to KV
      for (const file of project.files) {
        if (file.chunks) {
          for (let i = 0; i < file.chunks; i++) {
            const chunkKey = this.getFileChunkKey(project.id, file.path, i);
            const chunkContent = file.content ? file.content.substring(i * 1024 * 1024, (i + 1) * 1024 * 1024) : '';
            await this.kvAdapter.saveFileChunk(chunkKey, chunkContent);
          }
        }
      }
      
      logger.info(`Project saved: ${project.id}`);
    } catch (error) {
      logger.error(`Error saving project: ${project.id}`, error);
      throw error;
    }
  }
  
  /**
   * Get a project by ID
   * Retrieves metadata from D1 and files from KV
   */
  async getProject(id: string): Promise<EnhancedProjectState | null> {
    try {
      // Get metadata from D1
      const project = await this.d1Adapter.getProject(id);
      if (!project) {
        return null;
      }
      
      // Get files from KV
      const files = await this.getProjectFiles(id);
      project.files = files;
      
      return project;
    } catch (error) {
      logger.error(`Error getting project: ${id}`, error);
      throw error;
    }
  }
  
  /**
   * Delete a project
   * Removes metadata from D1 and files/cache from KV
   */
  async deleteProject(id: string): Promise<boolean> {
    try {
      // Delete metadata from D1
      const success = await this.d1Adapter.deleteProject(id);
      if (!success) {
        return false;
      }
      
      // Delete files from KV
      // Note: This is a simplified approach. In a production environment,
      // you would need a more robust way to track and delete all file chunks
      const project = await this.getProject(id);
      if (project) {
        for (const file of project.files) {
          if (file.chunks) {
            for (let i = 0; i < file.chunks; i++) {
              const chunkKey = this.getFileChunkKey(id, file.path, i);
              await this.kvAdapter.saveFileChunk(chunkKey, ''); // Clear the chunk
            }
          }
        }
      }
      
      // Invalidate all cache entries for this project
      await this.invalidateProjectCache(id);
      
      logger.info(`Project deleted: ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error deleting project: ${id}`, error);
      throw error;
    }
  }
  
  /**
   * Check if a project exists
   */
  async projectExists(id: string): Promise<boolean> {
    return this.d1Adapter.projectExists(id);
  }
  
  /**
   * Search projects
   */
  async searchProjects(options: SearchProjectsOptions): Promise<{
    projects: EnhancedProjectState[];
    total: number;
  }> {
    return this.d1Adapter.searchProjects(options);
  }
  
  /**
   * Update project metadata
   */
  async updateProjectMetadata(
    id: string,
    metadata: Partial<ProjectMetadata>
  ): Promise<void> {
    return this.d1Adapter.updateProjectMetadata(id, metadata);
  }
  
  /**
   * Update search index
   */
  async updateSearchIndex(
    id: string,
    searchIndex: EnhancedProjectState['searchIndex']
  ): Promise<void> {
    return this.d1Adapter.updateSearchIndex(id, searchIndex);
  }
  
  /**
   * Get a file chunk
   */
  async getFileChunk(
    projectId: string,
    filePath: string,
    chunkIndex: number
  ): Promise<string | null> {
    const key = this.getFileChunkKey(projectId, filePath, chunkIndex);
    return this.kvAdapter.getFileChunk(key);
  }
  
  /**
   * Save a file chunk
   */
  async saveFileChunk(
    projectId: string,
    filePath: string,
    chunkIndex: number,
    content: string
  ): Promise<void> {
    const key = this.getFileChunkKey(projectId, filePath, chunkIndex);
    return this.kvAdapter.saveFileChunk(key, content);
  }
  
  /**
   * Get a cached value
   */
  async getCacheValue<T>(
    projectId: string,
    key: string
  ): Promise<T | null> {
    return this.kvAdapter.getCacheValue<T>(projectId, key);
  }
  
  /**
   * Set a cached value
   */
  async setCacheValue<T>(
    projectId: string,
    key: string,
    value: T,
    ttl?: number
  ): Promise<void> {
    return this.kvAdapter.setCacheValue<T>(projectId, key, value, ttl);
  }
  
  /**
   * Invalidate cache entries
   */
  async invalidateCache(
    projectId: string,
    keys?: string[]
  ): Promise<void> {
    if (keys) {
      for (const key of keys) {
        await this.kvAdapter.invalidateCache(key);
      }
    } else {
      // If no keys provided, invalidate all cache entries for this project
      await this.invalidateProjectCache(projectId);
    }
  }
  
  /**
   * Helper method to get all files for a project
   */
  private async getProjectFiles(projectId: string): Promise<EnhancedProjectState['files']> {
    // This is a simplified approach. In a production environment,
    // you would need a more robust way to track all files for a project
    const project = await this.d1Adapter.getProject(projectId);
    if (!project || !project.files) {
      return [];
    }
    
    const files = [];
    for (const file of project.files) {
      if (file.chunks) {
        let content = '';
        for (let i = 0; i < file.chunks; i++) {
          const chunkKey = this.getFileChunkKey(projectId, file.path, i);
          const chunk = await this.kvAdapter.getFileChunk(chunkKey);
          if (chunk) {
            content += chunk;
          }
        }
        
        files.push({
          ...file,
          content
        });
      } else {
        files.push(file);
      }
    }
    
    return files;
  }
  
  /**
   * Helper method to invalidate all cache entries for a project
   */
  private async invalidateProjectCache(projectId: string): Promise<void> {
    // This is a simplified approach. In a production environment,
    // you would need a more robust way to track all cache keys for a project
    const cachePrefix = `cache:${projectId}:`;
    // Note: KV doesn't support listing keys, so this is a limitation
    // In a real implementation, you would need to track cache keys separately
    logger.info(`Cache invalidation requested for project: ${projectId}`);
  }
  
  /**
   * Helper method to generate a file chunk key
   */
  private getFileChunkKey(projectId: string, filePath: string, chunkIndex: number): string {
    return `file:${projectId}:${filePath}:${chunkIndex}`;
  }
} 