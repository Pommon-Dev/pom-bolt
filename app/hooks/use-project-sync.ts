import { useState, useEffect, useCallback, useRef } from 'react';
import { ProjectSyncService } from '~/lib/services/project-sync';
import { useToast } from '~/components/ui/use-toast';
import type { ProjectState } from '~/lib/projects/types';

// Interface for sync statistics
export interface SyncStats {
  totalProjects: number;
  localOnly: number;
  remoteOnly: number;
  inBoth: number;
  pendingChanges: number;
  lastPulled?: number;
  lastPushed?: number;
}

// Interface for sync result
export interface SyncResult {
  success: boolean;
  error?: string;
  pulled?: number;
  pushed?: number;
}

// Default sync intervals (in milliseconds)
const DEFAULT_SYNC_INTERVAL = 10 * 60 * 1000; // 10 minutes (increased from 5)
const DEFAULT_STATS_INTERVAL = 5 * 60 * 1000; // 5 minutes (increased from 1)
const MIN_SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes minimum (increased from 1)
const MAX_SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes maximum

// Fetch environment-specific intervals from local storage or env vars
const getSyncInterval = () => {
  if (typeof window !== 'undefined') {
    const storedInterval = localStorage.getItem('pom_bolt_sync_interval');
    if (storedInterval) {
      const interval = parseInt(storedInterval, 10);
      return !isNaN(interval) && interval >= MIN_SYNC_INTERVAL ? interval : DEFAULT_SYNC_INTERVAL;
    }
  }
  return DEFAULT_SYNC_INTERVAL;
};

const getStatsInterval = () => {
  if (typeof window !== 'undefined') {
    const storedInterval = localStorage.getItem('pom_bolt_stats_interval');
    if (storedInterval) {
      const interval = parseInt(storedInterval, 10);
      return !isNaN(interval) ? interval : DEFAULT_STATS_INTERVAL;
    }
  }
  return DEFAULT_STATS_INTERVAL;
};

// Queue for limiting sync operations
let isSyncInProgress = false;
const syncQueue: (() => Promise<void>)[] = [];

// Function to process sync queue
const processSyncQueue = async () => {
  if (isSyncInProgress || syncQueue.length === 0) return;
  
  isSyncInProgress = true;
  const nextSync = syncQueue.shift();
  
  try {
    if (nextSync) await nextSync();
  } finally {
    isSyncInProgress = false;
    
    // Process next item in queue after a short delay
    if (syncQueue.length > 0) {
      setTimeout(processSyncQueue, 1000);
    }
  }
};

// Helper to add sync operation to queue
const queueSync = (syncFn: () => Promise<void>) => {
  syncQueue.push(syncFn);
  processSyncQueue();
};

export function useProjectSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [isSyncEnabled, setIsSyncEnabled] = useState(true);
  const { toast } = useToast();
  
  // Use refs to track interval IDs for cleanup
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Check if sync is disabled
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const syncDisabled = localStorage.getItem('pom_bolt_sync_disabled') === 'true';
    setIsSyncEnabled(!syncDisabled);
    
    // Listen for changes to the sync enabled flag
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'pom_bolt_sync_disabled') {
        setIsSyncEnabled(e.newValue !== 'true');
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Function to update sync stats with error handling and rate limiting
  const updateSyncStats = useCallback(async () => {
    if (!isSyncEnabled) return;
    
    try {
      const stats = await ProjectSyncService.getSyncStats();
      setSyncStats(stats);
      // Reset failure counter on success
      if (consecutiveFailures > 0) {
        setConsecutiveFailures(0);
      }
    } catch (error) {
      console.error('Failed to get sync stats:', error);
      // Don't increment failure counter for stats - less critical
    }
  }, [isSyncEnabled, consecutiveFailures]);

  // Function to trigger a full sync with backoff on errors
  const syncProjects = useCallback(async (silent = false) => {
    if (isSyncing || !isSyncEnabled) return;
    
    setIsSyncing(true);
    try {
      const result = await ProjectSyncService.syncBidirectional();
      
      setLastSynced(new Date());
      
      // Reset failure counter on success
      if (consecutiveFailures > 0) {
        setConsecutiveFailures(0);
      }
      
      // Update sync stats after successful sync
      await updateSyncStats();
      
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
      // Increment failure counter for exponential backoff
      setConsecutiveFailures(prev => Math.min(prev + 1, 10));
      
      if (!silent) {
        toast(error instanceof Error ? error.message : 'Unknown error', { 
          type: 'error' 
        });
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, isSyncEnabled, consecutiveFailures, toast, updateSyncStats]);

  // Function to sync a single project
  const syncProject = useCallback(async (project: ProjectState, silent = false) => {
    if (!isSyncEnabled) {
      return { success: false, error: 'Sync is disabled' };
    }
    
    try {
      const result = await ProjectSyncService.syncProject(project);
      
      // Update last synced time
      setLastSynced(new Date());
      
      // Update sync stats after successful project sync
      await updateSyncStats();
      
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
  }, [isSyncEnabled, toast, updateSyncStats]);

  // Calculate next sync interval with exponential backoff
  const getNextSyncInterval = useCallback(() => {
    if (consecutiveFailures === 0) {
      return getSyncInterval();
    }
    
    // Exponential backoff: baseInterval * 2^failures, capped at max interval
    const baseInterval = getSyncInterval();
    const backoffFactor = Math.pow(2, Math.min(consecutiveFailures, 5));
    return Math.min(baseInterval * backoffFactor, MAX_SYNC_INTERVAL);
  }, [consecutiveFailures]);

  // Set up and manage sync intervals
  useEffect(() => {
    // Skip sync during server-side rendering
    if (typeof window === 'undefined') return;
    
    // Clear any existing intervals
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
    }
    
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
    }
    
    // Only set up intervals if sync is enabled
    if (!isSyncEnabled) return;
    
    // Initial sync and stats update
    const initialSync = async () => {
      if (!isSyncEnabled) return;
      
      // Queue the sync operation instead of running it directly
      queueSync(async () => {
        await syncProjects(true);
      });
    };
    
    // Set up periodic sync with adaptive interval
    const setupSyncInterval = () => {
      const interval = getNextSyncInterval();
      
      // Log the interval for debugging
      console.debug(`Setting up sync interval: ${interval / 1000} seconds`);
      
      // Clear any existing interval
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
      
      // Set up new interval
      syncIntervalRef.current = setInterval(() => {
        if (isSyncEnabled && !isSyncing) {
          // Queue the sync operation
          queueSync(async () => {
            await syncProjects(true);
          });
          
          // Update the interval after each sync based on failure state
          setupSyncInterval();
        }
      }, interval);
    };
    
    // Run initial sync after a slight delay to avoid race conditions
    const initialSyncTimer = setTimeout(initialSync, 2000);
    
    // Initial stats update
    updateSyncStats();
    
    // Set up interval for regular stats updates (less frequent than sync)
    statsIntervalRef.current = setInterval(() => {
      if (isSyncEnabled) {
        queueSync(async () => {
          await updateSyncStats();
        });
      }
    }, getStatsInterval());
    
    // Set up adaptive sync interval
    setupSyncInterval();
    
    // Cleanup on unmount
    return () => {
      if (initialSyncTimer) clearTimeout(initialSyncTimer);
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, [isSyncEnabled, isSyncing, syncProjects, updateSyncStats, getNextSyncInterval]);

  // Export functions and state
  return {
    syncProjects,
    syncProject,
    isSyncing,
    lastSynced,
    syncStats,
    isSyncEnabled,
    setIsSyncEnabled: (enabled: boolean) => {
      setIsSyncEnabled(enabled);
      if (typeof window !== 'undefined') {
        localStorage.setItem('pom_bolt_sync_disabled', enabled ? 'false' : 'true');
      }
    }
  };
} 