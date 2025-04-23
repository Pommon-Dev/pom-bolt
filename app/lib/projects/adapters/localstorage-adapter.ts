import { v4 as uuidv4 } from 'uuid';
import { createScopedLogger } from '~/utils/logger';
import type { ProjectState, ProjectStorageAdapter, CreateProjectOptions } from '../types';

const logger = createScopedLogger('localstorage-adapter');
const STORAGE_KEY = 'pom-bolt-projects';

export class LocalStorageAdapter implements ProjectStorageAdapter {
  constructor() {
    logger.info('LocalStorageAdapter initialized');
  }

  private getAllProjects(): Record<string, ProjectState> {
    try {
      if (typeof window === 'undefined') {
        logger.warn('localStorage not available during server-side rendering');
        return {};
      }
      
      const projectsJson = localStorage.getItem(STORAGE_KEY);
      if (!projectsJson) {
        return {};
      }
      
      return JSON.parse(projectsJson);
    } catch (error) {
      logger.error('Failed to get projects from localStorage', error);
      return {};
    }
  }

  private saveAllProjects(projects: Record<string, ProjectState>): void {
    try {
      if (typeof window === 'undefined') {
        logger.warn('localStorage not available during server-side rendering');
        return;
      }
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    } catch (error) {
      logger.error('Failed to save projects to localStorage', error);
    }
  }

  async getProject(id: string): Promise<ProjectState | null> {
    try {
      logger.info(`Fetching project ${id} from localStorage`);
      const projects = this.getAllProjects();
      const project = projects[id] || null;
      logger.info(`Project ${id} ${project ? 'found' : 'not found'} in localStorage`);
      return project;
    } catch (error) {
      logger.error(`Error fetching project ${id} from localStorage`, error);
      throw error;
    }
  }

  async saveProject(project: ProjectState): Promise<void> {
    try {
      logger.info(`Saving project ${project.id} to localStorage`);
      const projects = this.getAllProjects();
      projects[project.id] = { ...project, updatedAt: Date.now() };
      this.saveAllProjects(projects);
    } catch (error) {
      logger.error(`Error saving project ${project.id} to localStorage`, error);
      throw error;
    }
  }

  async deleteProject(id: string): Promise<boolean> {
    try {
      logger.info(`Deleting project ${id} from localStorage`);
      const projects = this.getAllProjects();
      
      if (!projects[id]) {
        logger.info(`Project ${id} not found in localStorage, nothing to delete`);
        return false;
      }
      
      delete projects[id];
      this.saveAllProjects(projects);
      
      logger.info(`Project ${id} deleted from localStorage`);
      return true;
    } catch (error) {
      logger.error(`Error deleting project ${id} from localStorage`, error);
      throw error;
    }
  }

  async projectExists(id: string): Promise<boolean> {
    try {
      logger.info(`Checking if project ${id} exists in localStorage`);
      const projects = this.getAllProjects();
      const exists = !!projects[id];
      logger.info(`Project ${id} exists in localStorage: ${exists}`);
      return exists;
    } catch (error) {
      logger.error(`Error checking if project ${id} exists in localStorage`, error);
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
      logger.info(`Listing projects from localStorage`, options);
      const allProjects = this.getAllProjects();
      let projects = Object.values(allProjects);
      
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
      
      logger.info(`Found ${total} projects in localStorage, returning ${projects.length}`);
      
      return {
        projects,
        total
      };
    } catch (error) {
      logger.error('Error listing projects from localStorage', error);
      throw error;
    }
  }

  async createProject(options: CreateProjectOptions): Promise<ProjectState> {
    try {
      const now = Date.now();
      const id = uuidv4();
      
      logger.info(`Creating project in localStorage`, { id, name: options.name });
      
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
      
      // Save to localStorage
      const projects = this.getAllProjects();
      projects[id] = project;
      this.saveAllProjects(projects);
      
      logger.info(`Project ${id} created in localStorage`);
      return project;
    } catch (error) {
      logger.error('Error creating project in localStorage', error);
      throw error;
    }
  }
} 