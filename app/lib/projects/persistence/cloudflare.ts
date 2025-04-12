import { getEnvironment, StorageType, EnvironmentType } from '~/lib/environments';
import { createScopedLogger } from '~/utils/logger';
import type { ProjectState, ProjectStorageAdapter } from '../types';

const logger = createScopedLogger('cloudflare-project-storage');

/**
 * Storage adapter that uses Cloudflare KV or D1 for storage
 * Falls back to memory storage if neither is available
 */
export class CloudflareProjectStorage implements ProjectStorageAdapter {
  private readonly storagePrefix = 'pom_bolt_project_';
  private readonly projectListKey = 'pom_bolt_project_list';
  private readonly environment;
  private readonly storageType: StorageType;
  
  constructor(context?: any) {
    // Pass context to environment if provided, to ensure proper detection
    this.environment = getEnvironment(context);
    this.storageType = this.selectStorageType();
    logger.info(`Using storage type: ${this.storageType}`, { 
      environmentType: this.environment.getInfo().type,
      hasContext: !!context,
      hasCfContext: !!context?.cloudflare
    });
  }
  
  /**
   * Select the best storage type available in Cloudflare environment
   */
  private selectStorageType(): StorageType {
    const availableTypes = this.environment.getAvailableStorageTypes();
    
    // Prefer D1 database if available
    if (availableTypes.includes(StorageType.CLOUDFLARE_D1)) {
      return StorageType.CLOUDFLARE_D1;
    }
    
    // Then KV storage
    if (availableTypes.includes(StorageType.CLOUDFLARE_KV)) {
      return StorageType.CLOUDFLARE_KV;
    }
    
    // Fallback to memory storage
    if (availableTypes.includes(StorageType.MEMORY)) {
      logger.warn('No persistent storage available, using memory storage');
      return StorageType.MEMORY;
    }
    
    // If somehow no storage is available, default to memory
    logger.error('No storage options available, defaulting to memory storage');
    return StorageType.MEMORY;
  }
  
  /**
   * Get project storage key
   */
  private getProjectKey(id: string): string {
    return `${this.storagePrefix}${id}`;
  }
  
  /**
   * Save a project state
   */
  async saveProject(project: ProjectState): Promise<void> {
    try {
      // Update project list first
      await this.updateProjectList(project);
      
      // Then save the project data
      const key = this.getProjectKey(project.id);
      logger.debug(`[saveProject] Attempting to save project with key: ${key}`, { projectId: project.id });
      await this.environment.storeValue(this.storageType, key, project);
      
      logger.info(`[saveProject] Saved project ${project.id} to Cloudflare storage with key: ${key}`);
    } catch (error) {
      logger.error(`[saveProject] Failed to save project ${project.id}:`, error);
      throw new Error(`Failed to save project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Get a project by ID
   */
  async getProject(id: string): Promise<ProjectState | null> {
    try {
      const key = this.getProjectKey(id);
      logger.debug(`[getProject] Attempting to retrieve project with key: ${key}`, { projectId: id });
      const project = await this.environment.retrieveValue<ProjectState>(this.storageType, key);
      
      if (!project) {
        logger.warn(`[getProject] Project ${id} not found in Cloudflare storage using key: ${key}`);
        return null;
      }
      
      logger.info(`[getProject] Successfully retrieved project ${id} using key: ${key}`);
      return project;
    } catch (error) {
      logger.error(`[getProject] Failed to get project ${id}:`, error);
      return null;
    }
  }
  
  /**
   * List all projects, optionally filtered and paginated
   */
  async listProjects(options?: {
    userId?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'createdAt' | 'updatedAt';
    sortDirection?: 'asc' | 'desc';
  }): Promise<{
    projects: ProjectState[];
    total: number;
  }> {
    try {
      const projectList = await this.getProjectList();
      
      // Filter by userId if specified
      let filteredList = projectList;
      if (options?.userId) {
        filteredList = projectList.filter(entry => entry.userId === options.userId);
      }
      
      // Sort the list
      const sortBy = options?.sortBy || 'updatedAt';
      const sortDirection = options?.sortDirection || 'desc';
      
      filteredList.sort((a, b) => {
        const valueA = a[sortBy];
        const valueB = b[sortBy];
        
        if (sortDirection === 'asc') {
          return valueA - valueB;
        } else {
          return valueB - valueA;
        }
      });
      
      // Apply pagination
      const offset = options?.offset || 0;
      const limit = options?.limit || filteredList.length;
      const paginatedList = filteredList.slice(offset, offset + limit);
      
      // Load the full project data for each entry
      const projects: ProjectState[] = [];
      
      for (const entry of paginatedList) {
        const project = await this.getProject(entry.id);
        if (project) {
          projects.push(project);
        }
      }
      
      return {
        projects,
        total: filteredList.length
      };
    } catch (error) {
      logger.error('Failed to list projects:', error);
      return {
        projects: [],
        total: 0
      };
    }
  }
  
  /**
   * Delete a project
   */
  async deleteProject(id: string): Promise<boolean> {
    try {
      // Remove from project list
      await this.removeFromProjectList(id);
      
      // Delete the project data
      const key = this.getProjectKey(id);
      await this.environment.removeValue(this.storageType, key);
      
      logger.debug(`Deleted project ${id} from Cloudflare storage`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete project ${id}:`, error);
      return false;
    }
  }
  
  /**
   * Check if a project exists
   */
  async projectExists(id: string): Promise<boolean> {
    try {
      const projectList = await this.getProjectList();
      return projectList.some(entry => entry.id === id);
    } catch (error) {
      logger.error(`Failed to check if project ${id} exists:`, error);
      return false;
    }
  }
  
  /**
   * Get the list of all projects
   */
  private async getProjectList(): Promise<Array<{ id: string; updatedAt: number; createdAt: number; userId?: string }>> {
    try {
      const list = await this.environment.retrieveValue<Array<{ id: string; updatedAt: number; createdAt: number; userId?: string }>>(
        this.storageType,
        this.projectListKey
      );
      return list || [];
    } catch (error) {
      logger.error('Failed to get project list:', error);
      return [];
    }
  }
  
  /**
   * Update the project list with a project
   */
  private async updateProjectList(project: ProjectState): Promise<void> {
    try {
      const projectList = await this.getProjectList();
      const existingIndex = projectList.findIndex(entry => entry.id === project.id);
      
      if (existingIndex >= 0) {
        // Update existing entry
        projectList[existingIndex] = {
          id: project.id,
          updatedAt: project.updatedAt,
          createdAt: project.createdAt,
          userId: project.metadata?.userId as string | undefined
        };
      } else {
        // Add new entry
        projectList.push({
          id: project.id,
          updatedAt: project.updatedAt,
          createdAt: project.createdAt,
          userId: project.metadata?.userId as string | undefined
        });
      }
      
      await this.environment.storeValue(this.storageType, this.projectListKey, projectList);
    } catch (error) {
      logger.error('Failed to update project list:', error);
      throw error;
    }
  }
  
  /**
   * Remove a project from the project list
   */
  private async removeFromProjectList(id: string): Promise<void> {
    try {
      const projectList = await this.getProjectList();
      const newList = projectList.filter(entry => entry.id !== id);
      
      await this.environment.storeValue(this.storageType, this.projectListKey, newList);
    } catch (error) {
      logger.error(`Failed to remove project ${id} from project list:`, error);
      throw error;
    }
  }
} 