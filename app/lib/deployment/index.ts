// Export types
export * from './types';

// Export base interfaces
export * from './targets/base';
export * from './packagers/base';

// Export deployment targets
export { CloudflarePagesTarget } from './targets/cloudflare-pages';

// Export packagers
export { ZipPackager } from './packagers/zip';

// Export the deployment manager
export { 
  DeploymentManager,
  getDeploymentManager,
  resetDeploymentManager,
  type DeploymentManagerOptions
} from './deployment-manager';

// Default export is the singleton deployment manager
import { getDeploymentManager } from './deployment-manager';
export default getDeploymentManager; 