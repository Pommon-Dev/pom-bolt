// Re-export types
export * from './types';

// Export the project state manager
export { 
  ProjectStateManager,
  getProjectStateManager,
  resetProjectStateManager
} from './state-manager';

// Export storage adapters for advanced usage or testing
export { LocalProjectStorage } from './persistence/local';
export { CloudflareProjectStorage } from './persistence/cloudflare';

// Default export is the singleton state manager
import { getProjectStateManager } from './state-manager';
export default getProjectStateManager; 