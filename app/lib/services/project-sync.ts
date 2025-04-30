import { createScopedLogger } from '~/utils/logger';
import type { ProjectState } from '~/lib/projects/types';
import type { SyncStats } from '~/hooks/use-project-sync';

const logger = createScopedLogger('project-sync');
const PROJECTS_STORAGE_KEY = 'projects';
const SYNC_STATS_KEY = 'projectSyncStats';

// Rate limiting and debouncing settings
const MIN_REQUEST_INTERVAL = 3000; // 3 seconds between API calls
let lastRequestTime = 0;
let pendingRequests: Map<string, Promise<any>> = new Map();

// Utility function to throttle API requests
async function throttledFetch(url: string, options?: RequestInit): Promise<Response> {
  const now = Date.now();
  const key = `${url}-${options?.method || 'GET'}`;
  
  // Check if this exact request is already pending
  const pendingRequest = pendingRequests.get(key);
  if (pendingRequest) {
    logger.debug('Reusing in-flight request for:', key);
    return pendingRequest;
  }
  
  // Throttle requests to prevent overwhelming the server
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const delay = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    logger.debug(`Throttling request to ${url}, waiting ${delay}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  // Make the request and track it
  const requestPromise = fetch(url, options).finally(() => {
    // Remove from pending requests when done
    pendingRequests.delete(key);
    lastRequestTime = Date.now();
  });
  
  // Store the pending request
  pendingRequests.set(key, requestPromise);
  
  return requestPromise;
}

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
   * Get all projects from localStorage
   */
  getLocalProjects(tenantId?: string): ProjectMap {
    try {
      if (typeof window === 'undefined') {
        return {};
      }
      
      const projectsJson = localStorage.getItem(PROJECTS_STORAGE_KEY);
      if (!projectsJson) {
        return {};
      }
      
      const projects = JSON.parse(projectsJson) as ProjectMap;
      
      // If tenantId is provided, filter projects by tenant
      if (tenantId) {
        const filteredProjects: ProjectMap = {};
        Object.entries(projects).forEach(([id, project]) => {
          if (project.tenantId === tenantId) {
            filteredProjects[id] = project;
          }
        });
        return filteredProjects;
      }
      
      return projects;
    } catch (error) {
      logger.error('Failed to get projects from localStorage:', error);
      return {};
    }
  },

  /**
   * Save projects to localStorage
   */
  saveLocalProjects(projects: ProjectMap): void {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
      }
    } catch (error) {
      logger.error('Failed to save projects to localStorage:', error);
    }
  },

  /**
   * Update last synced timestamp in stats
   */
  updateSyncTimestamp(type: 'push' | 'pull', tenantId?: string): void {
    try {
      if (typeof window === 'undefined') return;
      
      const statsKey = tenantId ? `${SYNC_STATS_KEY}-${tenantId}` : SYNC_STATS_KEY;
      const statsJson = localStorage.getItem(statsKey);
      
      if (statsJson) {
        const stats = JSON.parse(statsJson) as SyncStats;
        const now = Date.now();
        
        if (type === 'push') {
          stats.lastPushed = now;
        } else {
          stats.lastPulled = now;
        }
        
        localStorage.setItem(statsKey, JSON.stringify(stats));
      }
    } catch (e) {
      logger.warn(`Failed to update ${type} timestamp in sync stats`, e);
    }
  },

  /**
   * Calculate sync stats for display
   */
  async getSyncStats(tenantId?: string): Promise<SyncStats> {
    try {
      // Get local projects
      const localProjects = this.getLocalProjects(tenantId);
      
      // Fetch remote projects
      let remoteProjects: ProjectState[] = [];
      try {
        const url = tenantId ? `/api/projects?tenantId=${encodeURIComponent(tenantId)}` : '/api/projects';
        // Use throttled fetch instead of regular fetch
        const response = await throttledFetch(url);
        if (response.ok) {
          remoteProjects = await response.json();
        } else {
          logger.warn('Failed to fetch remote projects for stats calculation');
        }
      } catch (error) {
        logger.warn('Error fetching remote projects for stats:', error);
      }
      
      // Get previous stats if available
      let stats: SyncStats = {
        totalProjects: 0,
        localOnly: 0,
        remoteOnly: 0,
        inBoth: 0,
        pendingChanges: 0
      };
      
      try {
        if (typeof window !== 'undefined') {
          const statsKey = tenantId ? `${SYNC_STATS_KEY}-${tenantId}` : SYNC_STATS_KEY;
          const statsJson = localStorage.getItem(statsKey);
          if (statsJson) {
            stats = JSON.parse(statsJson);
          }
        }
      } catch (e) {
        logger.warn('Failed to load previous sync stats', e);
      }
      
      // Calculate stats
      const localIds = new Set(Object.keys(localProjects));
      const remoteIds = new Set(remoteProjects.map(p => p.id));
      
      const localOnlyIds = [...localIds].filter(id => !remoteIds.has(id));
      const remoteOnlyIds = [...remoteIds].filter(id => !localIds.has(id));
      const inBothIds = [...localIds].filter(id => remoteIds.has(id));
      
      // Check for pending changes
      let pendingChanges = 0;
      for (const id of inBothIds) {
        const localProject = localProjects[id];
        const remoteProject = remoteProjects.find(p => p.id === id);
        
        if (remoteProject && 
            (localProject.updatedAt > remoteProject.updatedAt ||
             JSON.stringify(localProject) !== JSON.stringify(remoteProject))) {
          pendingChanges++;
        }
      }
      
      const updatedStats = {
        totalProjects: localIds.size + remoteOnlyIds.length,
        localOnly: localOnlyIds.length,
        remoteOnly: remoteOnlyIds.length,
        inBoth: inBothIds.length,
        pendingChanges,
        // Keep previous history data
        lastPulled: stats.lastPulled,
        lastPushed: stats.lastPushed
      };
      
      // Save updated stats to localStorage
      try {
        if (typeof window !== 'undefined') {
          const statsKey = tenantId ? `${SYNC_STATS_KEY}-${tenantId}` : SYNC_STATS_KEY;
          localStorage.setItem(statsKey, JSON.stringify(updatedStats));
        }
      } catch (e) {
        logger.warn('Failed to save sync stats', e);
      }
      
      return updatedStats;
    } catch (error) {
      logger.error('Failed to calculate sync stats:', error);
      // Return default stats on error
      return {
        totalProjects: 0,
        localOnly: 0,
        remoteOnly: 0,
        inBoth: 0,
        pendingChanges: 0
      };
    }
  },

  /**
   * Push local projects to backend
   */
  async pushToBackend(tenantId?: string): Promise<SyncResult> {
    try {
      const localProjects = this.getLocalProjects(tenantId);
      const projectsArray = Object.values(localProjects);
      
      if (projectsArray.length === 0) {
        logger.debug('No local projects to push');
        return { success: true, results: { synced: 0 } };
      }
      
      logger.info(`Pushing ${projectsArray.length} projects to backend...`);
      
      // Filter projects by tenant if needed
      const filteredProjects = tenantId 
        ? projectsArray.filter(project => project.tenantId === tenantId) 
        : projectsArray;
      
      // Use throttledFetch instead of regular fetch
      const response = await throttledFetch('/api/projects/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'x-tenant-id': tenantId } : {})
        },
        body: JSON.stringify(filteredProjects)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Failed to push projects to backend: ${response.status} ${errorText}`);
        return { 
          success: false, 
          error: `Server error: ${response.status}` 
        };
      }
      
      const data = await response.json() as ApiResponse;
      
      if (!data.success) {
        logger.error('API reported error:', data.error);
        return { success: false, error: data.error };
      }
      
      // Update sync timestamp
      this.updateSyncTimestamp('push', tenantId);
      
      logger.info(`Successfully synced ${data.results.synced} projects to backend`);
      
      return {
        success: true,
        pushed: data.results.synced,
        results: { 
          synced: data.results.synced,
          updated: data.results.updated,
          created: data.results.created
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
  async pullFromBackend(tenantId?: string): Promise<SyncResult> {
    logger.info('Pulling projects from backend');
    try {
      // Get local projects for comparison
      const localProjects = this.getLocalProjects(tenantId);
      
      // Request remote projects from the backend
      const url = tenantId 
        ? `/api/projects?tenantId=${encodeURIComponent(tenantId)}` 
        : '/api/projects';
      
      // Use throttledFetch instead of regular fetch
      const response = await throttledFetch(url);
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Failed to fetch projects from backend: ${response.status} ${errorText}`);
        return { success: false, error: `Server error: ${response.status}` };
      }
      
      // Parse remote projects
      const remoteProjects: ProjectState[] = await response.json();
      
      // Update stats with pull time
      this.updateSyncTimestamp('pull', tenantId);
      
      if (remoteProjects.length === 0) {
        logger.info('No remote projects found');
        return { success: true, pulled: 0 };
      }
      
      // Merge remote projects with local
      let updatedCount = 0;
      const mergedProjects = { ...localProjects };
      
      for (const remoteProject of remoteProjects) {
        const localProject = localProjects[remoteProject.id];
        
        if (!localProject || remoteProject.updatedAt > localProject.updatedAt) {
          // Remote project is newer, use it
          mergedProjects[remoteProject.id] = remoteProject;
          updatedCount++;
        }
      }
      
      // Save merged projects to localStorage
      this.saveLocalProjects(mergedProjects);
      logger.info(`Pulled ${updatedCount} new/updated projects from backend`);
      
      return {
        success: true,
        pulled: updatedCount
      };
    } catch (error) {
      logger.error('Failed to pull projects from backend:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },
  
  /**
   * Sync projects bidirectionally (push and pull)
   */
  async syncBidirectional(tenantId?: string): Promise<SyncResult> {
    try {
      logger.info('Starting bidirectional sync...');
      
      // First push local changes to server
      const pushResult = await this.pushToBackend(tenantId);
      
      // Then pull any remote changes
      const pullResult = await this.pullFromBackend(tenantId);
      
      // Combine results
      return {
        success: pushResult.success && pullResult.success,
        error: pushResult.success ? pullResult.error : pushResult.error,
        pushed: pushResult.pushed || 0,
        pulled: pullResult.pulled || 0
      };
    } catch (error) {
      logger.error('Failed in bidirectional sync:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },
  
  /**
   * Sync a single project
   */
  async syncProject(project: ProjectState): Promise<SyncResult> {
    try {
      logger.info(`Syncing project: ${project.id} (${project.name})`);
      
      // Use throttledFetch for syncing a single project
      const response = await throttledFetch(`/api/projects/${project.id}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(project.tenantId ? { 'x-tenant-id': project.tenantId } : {})
        },
        body: JSON.stringify(project)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Failed to sync project: ${response.status} ${errorText}`);
        return { success: false, error: `Server error: ${response.status}` };
      }
      
      logger.info(`Project ${project.id} synchronized successfully`);
      return { success: true, results: { synced: 1 } };
    } catch (error) {
      logger.error(`Failed to sync project ${project.id}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
};