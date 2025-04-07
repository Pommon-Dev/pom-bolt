import { DeploymentManager } from './deployment-manager';

// Singleton instance of the DeploymentManager
let deploymentManagerInstance: DeploymentManager | null = null;

/**
 * Get or create the deployment manager singleton
 */
export function getDeploymentManager(options?: any) {
  if (!deploymentManagerInstance) {
    deploymentManagerInstance = new DeploymentManager(options);
  }
  return deploymentManagerInstance;
}

// For backward compatibility
export default getDeploymentManager; 