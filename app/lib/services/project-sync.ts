import { createScopedLogger } from '~/utils/logger';
import type { ProjectState } from '~/lib/projects/types';

const logger = createScopedLogger('project-sync');
const LOCAL_STORAGE_KEY = 'pom-bolt-projects';

interface ProjectMap {
  [id: string]: ProjectState;
}

interface SyncResult {
  success: boolean;
  error?: string;
  results?: {
    synced: number;
    updated?: number;
    created?: number;
  };
  pulled?: number;
  pushed?: number;
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

interface ApiSuccessResponse {
  success: true;
  results: {
    synced: number;
    updated: number;
    created: number;
    errors: number;
  };
}

type ApiResponse = ApiSuccessResponse | ApiErrorResponse;

export const ProjectSyncService = {
  /**
   * Get all projects from local storage
   */
  getLocalProjects(): ProjectMap {
    try {
      if (typeof window === 'undefined') return {}; // Server-side rendering check
      
      const projectsJson = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!projectsJson) return {};
      
      return JSON.parse(projectsJson);
    } catch (error) {
      logger.error('Failed to get local projects:', error);
      return {};
    }
  },

  /**
   * Save projects to local storage
   */
  saveLocalProjects(projects: ProjectMap): void {
    try {
      if (typeof window === 'undefined') return; // Server-side rendering check
      
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(projects));
    } catch (error) {
      logger.error('Failed to save local projects:', error);
    }
  },

  /**
   * Push local projects to backend
   */
  async pushToBackend(): Promise<SyncResult> {
    try {
      const localProjects = this.getLocalProjects();
      const projectsArray = Object.values(localProjects);
      
      if (projectsArray.length === 0) {
        logger.debug('No local projects to push');
        return { success: true, results: { synced: 0 } };
      }
      
      logger.info(`Pushing ${projectsArray.length} projects to backend`);
      
      const response = await fetch('/api/sync-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects: projectsArray })
      });
      
      if (!response.ok) {
        const errorData = await response.json() as ApiErrorResponse;
        throw new Error(errorData.error || `API error: ${response.status}`);
      }
      
      const result = await response.json() as ApiSuccessResponse;
      logger.info(`Successfully pushed ${result.results.synced} projects to backend`);
      
      return {
        success: true,
        results: {
          synced: result.results.synced,
          updated: result.results.updated,
          created: result.results.created
        }
      };
    } catch (error) {
      logger.error('Failed to push projects to backend:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  },

  /**
   * Pull projects from backend
   */
  async pullFromBackend(): Promise<SyncResult> {
    try {
      logger.info('Pulling projects from backend');
      
      const response = await fetch('/api/projects');
      if (!response.ok) {
        const errorData = await response.json() as ApiErrorResponse;
        throw new Error(errorData.error || `API error: ${response.status}`);
      }
      
      const backendProjects = await response.json() as ProjectState[];
      logger.info(`Retrieved ${backendProjects.length} projects from backend`);
      
      // Get local projects
      const localProjects = this.getLocalProjects();
      
      // Merge projects (prefer backend versions)
      const mergedProjects: ProjectMap = { ...localProjects };
      
      backendProjects.forEach(project => {
        mergedProjects[project.id] = project;
      });
      
      // Save merged projects back to localStorage
      this.saveLocalProjects(mergedProjects);
      
      return { 
        success: true, 
        pulled: backendProjects.length,
        results: { synced: backendProjects.length }
      };
    } catch (error) {
      logger.error('Failed to pull projects from backend:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  },

  /**
   * Perform a full bidirectional sync
   */
  async syncBidirectional(): Promise<SyncResult> {
    try {
      // First pull from backend
      const pullResult = await this.pullFromBackend();
      
      // Then push any local changes to backend
      const pushResult = await this.pushToBackend();
      
      return {
        success: pullResult.success && pushResult.success,
        pulled: pullResult.pulled || 0,
        pushed: pushResult.results?.synced || 0
      };
    } catch (error) {
      logger.error('Bidirectional sync failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  },

  /**
   * Sync a single project to backend
   */
  async syncProject(project: ProjectState): Promise<SyncResult> {
    try {
      logger.info(`Syncing project ${project.id} to backend`);
      
      const response = await fetch('/api/sync-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects: [project] })
      });
      
      if (!response.ok) {
        const errorData = await response.json() as ApiErrorResponse;
        throw new Error(errorData.error || `API error: ${response.status}`);
      }
      
      logger.info(`Project ${project.id} synced successfully`);
      return { success: true, results: { synced: 1 } };
    } catch (error) {
      logger.error(`Failed to sync project ${project.id}:`, error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}; 