// Export the project state manager
export { 
  ProjectStateManager,
  getProjectStateManager,
  resetProjectStateManager
} from './state-manager';

// Export storage adapters for advanced usage or testing
export { LocalProjectStorage } from './persistence/local';
export { CloudflareProjectStorage } from './persistence/cloudflare';
export { ProjectStorageService as PersistenceStorageService } from './persistence/storage-service';
export { D1ProjectStorageAdapter } from './persistence/d1-adapter';
export { KVProjectStorageAdapter } from './persistence/kv-adapter';

// Export the storage service singleton
export { ProjectStorageService, getProjectStorageService } from './storage-service';

// Export types
export * from './types';
export * from './enhanced-types';

// Default export is the singleton state manager
import { getProjectStateManager } from './state-manager';
export default getProjectStateManager; 