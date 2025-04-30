import React, { useState, useEffect } from 'react';
import { Badge } from './Badge';
import type { DeploymentStatus } from '~/lib/deployment/types';

// Define API response interface
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
  };
}

interface DeploymentStatusIndicatorProps {
  deploymentId?: string;
  initialStatus?: 'success' | 'failed' | 'in-progress';
  url?: string;
  autoRefresh?: boolean;
  className?: string;
  onStatusChange?: (status: DeploymentStatus) => void;
  tenantId?: string;
}

export function DeploymentStatusIndicator({
  deploymentId,
  initialStatus,
  url,
  autoRefresh = true,
  className = '',
  onStatusChange,
  tenantId
}: DeploymentStatusIndicatorProps) {
  const [status, setStatus] = useState<'success' | 'failed' | 'in-progress' | 'unknown'>(
    initialStatus || 'unknown'
  );
  const [isLoading, setIsLoading] = useState(false);
  const [deploymentUrl, setDeploymentUrl] = useState<string | undefined>(url);
  const [error, setError] = useState<string | null>(null);

  // Fetch the deployment status
  const fetchStatus = async () => {
    if (!deploymentId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Build the URL with optional tenant ID
      let apiUrl = `/api/deploy?id=${encodeURIComponent(deploymentId)}`;
      if (tenantId) {
        apiUrl += `&tenantId=${encodeURIComponent(tenantId)}`;
      }
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        const errorData = await response.json() as ApiResponse<unknown>;
        throw new Error(errorData.error?.message || 'Failed to fetch deployment status');
      }
      
      const data = await response.json() as ApiResponse<DeploymentStatus>;
      
      // If the request was successful but the API returned an error
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to fetch deployment status');
      }
      
      if (data.data) {
        // Update local state with the deployment status
        setStatus(data.data.status);
        setDeploymentUrl(data.data.url);
        
        // Notify parent component of status change
        if (onStatusChange) {
          onStatusChange(data.data);
        }
        
        return data.data;
      }
      
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('unknown');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Set up polling for deployment status
  useEffect(() => {
    if (!deploymentId || !autoRefresh) return;
    
    // Do initial fetch
    fetchStatus();
    
    // For in-progress deployments, poll every 5 seconds
    // Continue polling until status is no longer in-progress
    const intervalId = setInterval(() => {
      if (status === 'in-progress' || status === 'unknown') {
        fetchStatus().then(result => {
          // If deployment is complete, stop polling
          if (result && (result.status === 'success' || result.status === 'failed')) {
            clearInterval(intervalId);
          }
        });
      } else {
        // If not in progress, clear the interval
        clearInterval(intervalId);
      }
    }, 5000);
    
    // Clean up interval on unmount
    return () => clearInterval(intervalId);
  }, [deploymentId, status, autoRefresh]);

  // Helper to get styles based on status
  const getStatusStyles = () => {
    switch (status) {
      case 'success':
        return {
          variant: 'default' as const,
          textClass: 'text-green-600',
          icon: 'i-ph:check-circle',
          text: 'Deployed'
        };
      case 'failed':
        return {
          variant: 'destructive' as const,
          textClass: 'text-red-600',
          icon: 'i-ph:x-circle',
          text: 'Failed'
        };
      case 'in-progress':
        return {
          variant: 'secondary' as const,
          textClass: 'text-yellow-600',
          icon: 'i-ph:spinner animate-spin',
          text: 'Deploying'
        };
      default:
        return {
          variant: 'secondary' as const,
          textClass: 'text-gray-600',
          icon: 'i-ph:question-circle',
          text: 'Unknown'
        };
    }
  };

  const statusStyles = getStatusStyles();

  // Display the status indicator
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Badge variant={statusStyles.variant} className={`flex items-center gap-1 ${statusStyles.textClass}`}>
        <div className={`${statusStyles.icon} text-lg`} />
        <span>{statusStyles.text}</span>
      </Badge>
      
      {deploymentUrl && status === 'success' && (
        <a 
          href={deploymentUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-sm text-bolt-link hover:underline"
        >
          View <span className="i-ph:arrow-square-out text-sm ml-1" />
        </a>
      )}
      
      {error && (
        <span className="text-xs text-bolt-error" title={error}>
          Error fetching status
        </span>
      )}
    </div>
  );
} 