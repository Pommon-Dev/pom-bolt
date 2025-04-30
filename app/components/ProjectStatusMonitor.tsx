import { useEffect, useState } from 'react';
import { useToast } from '~/components/ui/use-toast';
import { createScopedLogger } from '~/utils/logger';
import type { DeploymentStatus } from '~/lib/deployment/types';

const logger = createScopedLogger('project-status-monitor');

interface ProjectStatusMonitorProps {
  projectId?: string;
  deploymentId?: string;
  tenantId?: string;
  onDeploymentStatusChange?: (status: DeploymentStatus) => void;
  pollingInterval?: number;
  silentPolling?: boolean;
  children?: React.ReactNode;
}

/**
 * Component that monitors a project's status changes and updates UI
 * This component doesn't render anything directly, but provides polling
 * functionality and triggers callbacks when status changes
 */
export function ProjectStatusMonitor({
  projectId,
  deploymentId,
  tenantId,
  onDeploymentStatusChange,
  pollingInterval = 5000,
  silentPolling = true,
  children
}: ProjectStatusMonitorProps) {
  const [lastDeploymentStatus, setLastDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const { toast } = useToast();

  // Poll for deployment status if deploymentId is provided
  useEffect(() => {
    if (!deploymentId) return;
    
    // Skip polling if we already have a successful or failed status
    if (
      lastDeploymentStatus && 
      (lastDeploymentStatus.status === 'success' || lastDeploymentStatus.status === 'failed')
    ) {
      return;
    }
    
    setIsPolling(true);
    
    const checkDeploymentStatus = async () => {
      try {
        // Build the URL with optional tenant ID
        let apiUrl = `/api/deploy?id=${encodeURIComponent(deploymentId)}`;
        if (tenantId) {
          apiUrl += `&tenantId=${encodeURIComponent(tenantId)}`;
        }
        
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
          if (!silentPolling) {
            logger.warn(`Failed to fetch deployment status: ${response.statusText}`);
          }
          return null;
        }
        
        const data = await response.json() as { success: boolean; data?: DeploymentStatus; error?: { message: string } };
        
        if (!data.success) {
          if (!silentPolling) {
            logger.warn(`API returned error: ${data.error?.message}`);
          }
          return null;
        }
        
        if (!data.data) {
          return null;
        }
        
        const status = data.data;
        
        // If status has changed, notify parent component
        if (
          !lastDeploymentStatus || 
          lastDeploymentStatus.status !== status.status
        ) {
          setLastDeploymentStatus(status);
          
          // Show toast notification for important status changes
          if (!silentPolling) {
            if (status.status === 'success') {
              toast(`Your deployment was successful. The app is available at ${status.url}`, {
                type: 'success'
              });
            } else if (status.status === 'failed') {
              toast(`Deployment failed: ${status.logs?.[0] || 'Check logs for details'}`, {
                type: 'error'
              });
            }
          }
          
          // Trigger callback with new status
          if (onDeploymentStatusChange) {
            onDeploymentStatusChange(status);
          }
        }
        
        // If deployment is no longer in progress, stop polling
        if (status.status !== 'in-progress') {
          setIsPolling(false);
        }
        
        return status;
      } catch (error) {
        if (!silentPolling) {
          logger.error('Error checking deployment status:', error);
        }
        return null;
      }
    };
    
    // Do initial status check
    checkDeploymentStatus();
    
    // Set up polling
    const intervalId = setInterval(() => {
      if (isPolling) {
        checkDeploymentStatus();
      }
    }, pollingInterval);
    
    // Clean up
    return () => {
      clearInterval(intervalId);
      setIsPolling(false);
    };
  }, [deploymentId, lastDeploymentStatus, onDeploymentStatusChange, tenantId, pollingInterval, silentPolling, isPolling, toast]);

  // If children are provided, render them with status
  if (children) {
    return (
      <div className="relative" data-monitoring-project-id={projectId} data-monitoring-deployment-id={deploymentId}>
        {children}
        
        {/* Optional status indicator overlay when polling */}
        {isPolling && (
          <div className="absolute top-2 right-2">
            <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
          </div>
        )}
      </div>
    );
  }
  
  // If no children, render nothing (just monitor)
  return null;
} 