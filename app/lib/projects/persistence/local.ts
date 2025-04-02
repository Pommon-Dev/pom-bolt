import { getEnvironment, StorageType } from '~/lib/environments';
import { createScopedLogger } from '~/utils/logger';
import type { ProjectState, ProjectStorageAdapter } from '../types';

const logger = createScopedLogger('local-project-storage');

/**
 * Storage adapter that uses local storage mechanisms
 * Uses the environment system to determine the best available storage
 */
export class LocalProjectStorage implements ProjectStorageAdapter {
  private readonly storagePrefix = 'pom_bolt_project_';
  private readonly projectListKey = 'pom_bolt_project_list';
  private readonly environment = getEnvironment();
  
  constructor() {
    // Check if we have a valid storage mechanism
    if (!this.hasValidStorage()) {
      logger.warn('No suitable storage mechanism available for local project storage');
    }
  }
  
  /**
   * Check if a suitable storage mechanism is available
   */
  private hasValidStorage(): boolean {
    const availableStorageTypes = this.environment.getAvailableStorageTypes();
    return availableStorageTypes.length > 0;
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
      await this.saveToStorage(key, project);
      
      logger.debug(`Saved project ${project.id} to storage`);
    } catch (error) {
      logger.error(`Failed to save project ${project.id}:`, error);
      throw new Error(`Failed to save project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Get a project by ID
   */
  async getProject(id: string): Promise<ProjectState | null> {
    try {
      const key = this.getProjectKey(id);
      const project = await this.retrieveFromStorage<ProjectState>(key);
      
      if (!project) {
        logger.debug(`Project ${id} not found in storage`);
        return null;
      }
      
      return project;
    } catch (error) {
      logger.error(`Failed to get project ${id}:`, error);
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
      await this.removeFromStorage(key);
      
      logger.debug(`Deleted project ${id} from storage`);
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
      const list = await this.retrieveFromStorage<Array<{ id: string; updatedAt: number; createdAt: number; userId?: string }>>(this.projectListKey);
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
      
      await this.saveToStorage(this.projectListKey, projectList);
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
      
      await this.saveToStorage(this.projectListKey, newList);
    } catch (error) {
      logger.error(`Failed to remove project ${id} from project list:`, error);
      throw error;
    }
  }
  
  /**
   * Save data to the best available storage
   */
  private async saveToStorage<T>(key: string, data: T): Promise<void> {
    const storageTypes = this.environment.getAvailableStorageTypes();
    if (storageTypes.length === 0) {
      throw new Error('No storage available');
    }
    
    // Use the first available storage type
    const storageType = storageTypes[0];
    await this.environment.storeValue(storageType, key, data);
  }
  
  /**
   * Retrieve data from the best available storage
   */
  private async retrieveFromStorage<T>(key: string): Promise<T | null> {
    const storageTypes = this.environment.getAvailableStorageTypes();
    if (storageTypes.length === 0) {
      throw new Error('No storage available');
    }
    
    // Try all available storage types in order until we find the data
    for (const storageType of storageTypes) {
      const data = await this.environment.retrieveValue<T>(storageType, key);
      if (data !== null) {
        return data;
      }
    }
    
    return null;
  }
  
  /**
   * Remove data from the best available storage
   */
  private async removeFromStorage(key: string): Promise<void> {
    const storageTypes = this.environment.getAvailableStorageTypes();
    if (storageTypes.length === 0) {
      throw new Error('No storage available');
    }
    
    // Remove from all available storage types to ensure it's completely gone
    for (const storageType of storageTypes) {
      await this.environment.removeValue(storageType, key);
    }
  }
} 