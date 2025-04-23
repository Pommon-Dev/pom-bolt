import { useEffect } from 'react';
import { useProjectSync } from '~/hooks/use-project-sync';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('background-sync');

/**
 * Background Sync Component
 * 
 * This component doesn't render anything but sets up automatic 
 * synchronization between local storage and backend storage.
 * It should be included once in your app's root layout.
 */
export function BackgroundSync() {
  const { syncProjects } = useProjectSync();
  
  // Set up automatic sync
  useEffect(() => {
    // Skip during server-side rendering
    if (typeof window === 'undefined') return;
    
    logger.debug('Setting up background sync');
    
    // Initial sync
    const initialSync = async () => {
      try {
        logger.debug('Running initial sync');
        await syncProjects(true);
        logger.debug('Initial sync completed');
      } catch (error) {
        logger.error('Initial sync failed:', error);
      }
    };
    
    // Run initial sync
    initialSync();
    
    // Set up periodic sync
    const intervalId = setInterval(() => {
      logger.debug('Running periodic sync');
      syncProjects(true).catch(error => {
        logger.error('Periodic sync failed:', error);
      });
    }, 5 * 60 * 1000); // Every 5 minutes
    
    // Cleanup
    return () => {
      logger.debug('Cleaning up background sync');
      clearInterval(intervalId);
    };
  }, [syncProjects]);
  
  // This component doesn't render anything
  return null;
} 