import { useState, useEffect, useCallback } from 'react';
import { ProjectSyncService } from '~/lib/services/project-sync';
import { useToast } from '~/components/ui/use-toast';
import type { ProjectState } from '~/lib/projects/types';

export function useProjectSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const { toast } = useToast();

  // Function to trigger a full sync
  const syncProjects = useCallback(async (silent = false) => {
    if (isSyncing) return;
    
    setIsSyncing(true);
    try {
      const result = await ProjectSyncService.syncBidirectional();
      
      setLastSynced(new Date());
      
      if (!silent && result.success) {
        toast(`Pulled ${result.pulled} projects, pushed ${result.pushed} projects.`, { 
          type: 'success' 
        });
      } else if (!silent && !result.success) {
        toast(result.error || 'Failed to synchronize projects', { 
          type: 'error' 
        });
      }
      
      return result;
    } catch (error) {
      if (!silent) {
        toast(error instanceof Error ? error.message : 'Unknown error', { 
          type: 'error' 
        });
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, toast]);

  // Function to sync a single project
  const syncProject = useCallback(async (project: ProjectState, silent = false) => {
    try {
      const result = await ProjectSyncService.syncProject(project);
      
      if (!silent && result.success) {
        toast(`Project "${project.name}" has been synced to the cloud.`, {
          type: 'success'
        });
      } else if (!silent && !result.success) {
        toast(result.error || 'Unknown error occurred', {
          type: 'error'
        });
      }
      
      return result;
    } catch (error) {
      if (!silent) {
        toast(error instanceof Error ? error.message : 'Unknown error', {
          type: 'error'
        });
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, [toast]);

  // Set up automatic sync on component mount
  useEffect(() => {
    // Skip sync during server-side rendering
    if (typeof window === 'undefined') return;
    
    // Initial sync when component mounts
    const initialSync = async () => {
      await syncProjects(true);
    };
    
    initialSync();
    
    // Set up periodic sync
    const intervalId = setInterval(() => {
      syncProjects(true);
    }, 5 * 60 * 1000); // Every 5 minutes
    
    return () => clearInterval(intervalId);
  }, [syncProjects]);

  return {
    isSyncing,
    lastSynced,
    syncProjects,
    syncProject
  };
} 