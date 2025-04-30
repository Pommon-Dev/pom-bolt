import React, { useState } from 'react';
import { Button } from '~/components/ui/Button';
import { useProjectSync } from '~/hooks/use-project-sync';
import WithTooltip from '~/components/ui/Tooltip';
import { Badge } from '~/components/ui/Badge';

export function ProjectSyncButton() {
  const { isSyncing, lastSynced, syncProjects, syncStats } = useProjectSync();
  const [showDetails, setShowDetails] = useState(false);

  // Format time difference in a human-readable way
  const formatTimeDifference = (date: Date | null) => {
    if (!date) return 'Never';
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec} seconds ago`;
    if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  };

  // Generate tooltip content
  const getTooltipContent = () => {
    let content = '';
    
    if (lastSynced) {
      content = `Last synced: ${lastSynced.toLocaleString()} (${formatTimeDifference(lastSynced)})`;
      
      if (syncStats) {
        content += `\nProjects: ${syncStats.totalProjects} (${syncStats.localOnly} local, ${syncStats.remoteOnly} remote, ${syncStats.inBoth} in both)`;
        
        if (syncStats.lastPulled || syncStats.lastPushed) {
          content += '\nLast sync: ';
          if (syncStats.lastPulled) content += `Pulled ${syncStats.lastPulled} `;
          if (syncStats.lastPushed) content += `Pushed ${syncStats.lastPushed}`;
        }
      }
    } else {
      content = "Sync projects between browser and cloud";
    }
    
    return content;
  };

  // Get status indicator
  const getStatusIndicator = () => {
    if (isSyncing) {
      return <div className="i-ph:sync animate-spin text-lg mr-1" />;
    }
    
    if (!lastSynced) {
      // Never synced
      return <div className="i-ph:cloud-arrow-up text-lg mr-1" />;
    }
    
    // Calculate time since last sync to determine status
    const now = new Date();
    const diffMs = now.getTime() - lastSynced.getTime();
    const diffMin = Math.floor(diffMs / (1000 * 60));
    
    if (diffMin < 15) {
      // Synced in the last 15 minutes - good status
      return <div className="i-ph:cloud-check text-lg mr-1 text-green-600" />;
    } else if (diffMin < 60) {
      // Synced in the last hour - warning status
      return <div className="i-ph:cloud text-lg mr-1 text-yellow-600" />;
    } else {
      // Synced more than an hour ago - warning status
      return <div className="i-ph:cloud-slash text-lg mr-1 text-red-600" />;
    }
  };

  return (
    <div className="relative">
      <WithTooltip tooltip={getTooltipContent()}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncProjects()}
          disabled={isSyncing}
          className="flex items-center gap-1 text-bolt-elements-text-subdued"
        >
          {getStatusIndicator()}
          <span className="sr-only md:not-sr-only md:inline-block">
            {isSyncing ? 'Syncing...' : 'Sync'}
          </span>
          
          {/* Status badge */}
          {syncStats && syncStats.pendingChanges > 0 && (
            <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-[10px]">
              {syncStats.pendingChanges}
            </Badge>
          )}
        </Button>
      </WithTooltip>
      
      {/* Extended details panel - shown only when expanded */}
      {showDetails && (
        <div className="absolute top-full mt-1 right-0 z-10 bg-bolt-elements-background border border-bolt-elements-border rounded-md shadow-md p-2 text-xs min-w-[200px]">
          <h4 className="font-semibold">Sync Status</h4>
          <div className="mt-1">
            <div>Last synced: {formatTimeDifference(lastSynced)}</div>
            {syncStats && (
              <>
                <div className="mt-1">Total projects: {syncStats.totalProjects}</div>
                <div className="flex gap-2 mt-1">
                  <Badge variant="outline" className="text-[10px]">
                    {syncStats.localOnly} local
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {syncStats.remoteOnly} remote
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {syncStats.inBoth} synced
                  </Badge>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
} 