import { v4 as uuidv4 } from 'uuid';
import { createScopedLogger } from '~/utils/logger';
import type { ProjectState, ProjectStorageAdapter, CreateProjectOptions } from '../types';

const logger = createScopedLogger('memory-adapter');

// In-memory storage
const projectStore = new Map<string, ProjectState>();

export class MemoryStorageAdapter implements ProjectStorageAdapter {
  constructor() {
    logger.info('MemoryStorageAdapter initialized');
  }

  async getProject(id: string): Promise<ProjectState | null> {
    try {
      logger.info(`Fetching project ${id} from memory`);
      const project = projectStore.get(id) || null;
      logger.info(`Project ${id} ${project ? 'found' : 'not found'} in memory`);
      return project;
    } catch (error) {
      logger.error(`Error fetching project ${id} from memory`, error);
      throw error;
    }
  }

  async saveProject(project: ProjectState): Promise<void> {
    try {
      logger.info(`Saving project ${project.id} to memory`);
      projectStore.set(project.id, { ...project, updatedAt: Date.now() });
    } catch (error) {
      logger.error(`Error saving project ${project.id} to memory`, error);
      throw error;
    }
  }

  async deleteProject(id: string): Promise<boolean> {
    try {
      logger.info(`Deleting project ${id} from memory`);
      const result = projectStore.delete(id);
      logger.info(`Project ${id} deletion result: ${result}`);
      return result;
    } catch (error) {
      logger.error(`Error deleting project ${id} from memory`, error);
      throw error;
    }
  }

  async projectExists(id: string): Promise<boolean> {
    try {
      logger.info(`Checking if project ${id} exists in memory`);
      const exists = projectStore.has(id);
      logger.info(`Project ${id} exists in memory: ${exists}`);
      return exists;
    } catch (error) {
      logger.error(`Error checking if project ${id} exists in memory`, error);
      throw error;
    }
  }

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
      logger.info(`Listing projects from memory`, options);
      let projects = Array.from(projectStore.values());
      
      // Filter by userId if provided
      if (options?.userId) {
        projects = projects.filter(p => p.metadata?.userId === options.userId);
      }
      
      // Sort projects
      const sortBy = options?.sortBy || 'updatedAt';
      const sortDirection = options?.sortDirection || 'desc';
      
      projects.sort((a, b) => {
        const aValue = a[sortBy];
        const bValue = b[sortBy];
        
        return sortDirection === 'asc' 
          ? (aValue - bValue) 
          : (bValue - aValue);
      });
      
      // Apply pagination
      const total = projects.length;
      
      if (options?.limit !== undefined && options?.offset !== undefined) {
        projects = projects.slice(options.offset, options.offset + options.limit);
      }
      
      logger.info(`Found ${total} projects in memory, returning ${projects.length}`);
      
      return {
        projects,
        total
      };
    } catch (error) {
      logger.error('Error listing projects from memory', error);
      throw error;
    }
  }

  async createProject(options: CreateProjectOptions): Promise<ProjectState> {
    try {
      const now = Date.now();
      const id = uuidv4();
      
      logger.info(`Creating project in memory`, { id, name: options.name });
      
      const project: ProjectState = {
        id,
        name: options.name || 'Untitled Project',
        createdAt: now,
        updatedAt: now,
        files: [],
        requirements: [],
        deployments: [],
        metadata: options.metadata || {}
      };
      
      // Save to memory store
      projectStore.set(id, project);
      
      logger.info(`Project ${id} created in memory`);
      return project;
    } catch (error) {
      logger.error('Error creating project in memory', error);
      throw error;
    }
  }
} 