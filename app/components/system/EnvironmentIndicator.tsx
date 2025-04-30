import { useState } from 'react';
import { getEnvironmentInfo } from '~/lib/environment-setup';
import { EnvironmentType } from '~/lib/environments';

/**
 * A component that displays the current environment information
 * Only shown in development and preview environments by default
 */
export function EnvironmentIndicator({ showInProduction = false }: { showInProduction?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const environmentInfo = getEnvironmentInfo();

  // Handle case where environment info is not available yet
  if (!environmentInfo) {
    return null;
  }

  // Hide in production environments unless explicitly enabled
  if (environmentInfo.isProduction && !showInProduction) {
    return null;
  }

  // Choose color based on environment type
  const getEnvColor = () => {
    if (typeof environmentInfo.type === 'string' && environmentInfo.type === 'unknown') {
      return 'bg-gray-600';
    }
    
    switch (environmentInfo.type) {
      case EnvironmentType.LOCAL:
        return 'bg-blue-600';
      case EnvironmentType.CLOUDFLARE:
        return environmentInfo.isDevelopment ? 'bg-amber-600' : 'bg-green-600';
      default:
        return 'bg-gray-600';
    }
  };

  // Get environment label
  const getEnvLabel = () => {
    if (typeof environmentInfo.type === 'string' && environmentInfo.type === 'unknown') {
      return 'Dev Environment';
    }
    
    switch (environmentInfo.type) {
      case EnvironmentType.LOCAL:
        return 'Local Dev';
      case EnvironmentType.CLOUDFLARE:
        return environmentInfo.isDevelopment ? 'CF Preview' : 'CF Production';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="fixed bottom-2 right-2 z-50 text-xs">
      <div
        className={`rounded-md px-2 py-1 text-white cursor-pointer ${getEnvColor()}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {getEnvLabel()}
      </div>

      {isExpanded && (
        <div className="mt-2 bg-gray-800 text-white p-2 rounded-md shadow-lg">
          <div className="font-bold">Environment Info</div>
          <div>Type: {environmentInfo.type || 'Unknown'}</div>
          <div>Production: {environmentInfo.isProduction ? 'Yes' : 'No'}</div>
          <div>Development: {environmentInfo.isDevelopment ? 'Yes' : 'No'}</div>
          <div className="mt-1 text-gray-300">Click to collapse</div>
        </div>
      )}
    </div>
  );
}
