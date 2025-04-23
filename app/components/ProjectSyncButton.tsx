import { Button } from '~/components/ui/Button';
import { useProjectSync } from '~/hooks/use-project-sync';
import WithTooltip from '~/components/ui/Tooltip';

export function ProjectSyncButton() {
  const { isSyncing, lastSynced, syncProjects } = useProjectSync();
  
  return (
    <WithTooltip
      tooltip={
        lastSynced 
          ? `Last synced: ${lastSynced.toLocaleString()}`
          : "Sync projects between browser and cloud"
      }
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => syncProjects()}
        disabled={isSyncing}
        className="flex items-center gap-2 text-bolt-elements-text-subdued"
      >
        <div className={`i-ph:cloud-arrow-up text-lg ${isSyncing ? 'animate-pulse' : ''}`} />
        <span className="sr-only md:not-sr-only md:inline-block">
          {isSyncing ? 'Syncing...' : 'Sync Projects'}
        </span>
      </Button>
    </WithTooltip>
  );
} 