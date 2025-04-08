import { DeploymentManager } from './deployment-manager';

// Singleton instance of the DeploymentManager
let deploymentManagerInstance: DeploymentManager | null = null;
let initializationPromise: Promise<DeploymentManager> | null = null;

/**
 * Get or create the deployment manager singleton
 * This now returns a Promise that resolves to DeploymentManager
 */
export async function getDeploymentManager(options?: any): Promise<DeploymentManager> {
  // If there's already an initialized instance, return it
  if (deploymentManagerInstance) {
    return deploymentManagerInstance;
  }
  
  // If we're already initializing, return the existing promise
  if (initializationPromise) {
    return initializationPromise;
  }
  
  // Start the initialization process
  initializationPromise = DeploymentManager.create(options).then(instance => {
    deploymentManagerInstance = instance;
    initializationPromise = null; // Clear the promise once done
    return instance;
  });
  
  return initializationPromise;
}

// For backward compatibility
export default getDeploymentManager; 