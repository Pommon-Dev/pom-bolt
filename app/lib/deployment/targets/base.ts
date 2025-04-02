import type {
  ProjectOptions,
  ProjectMetadata,
  DeployOptions,
  UpdateOptions,
  DeploymentResult,
  DeploymentStatus
} from '../types';

/**
 * Base interface for all deployment targets
 * Defines the core operations that any deployment platform must support
 */
export interface DeploymentTarget {
  /**
   * Get the name of this deployment target
   */
  getName(): string;
  
  /**
   * Get the provider type of this deployment target
   */
  getProviderType(): string;
  
  /**
   * Check if this deployment target is available in the current environment
   * This checks if the necessary credentials are available and if the service is reachable
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * Initialize a new project or get an existing one
   * @param options Project initialization options
   * @returns Project metadata from the platform
   */
  initializeProject(options: ProjectOptions): Promise<ProjectMetadata>;
  
  /**
   * Deploy application code to the platform
   * @param options Deployment options including files to deploy
   * @returns Deployment result with URLs and status
   */
  deploy(options: DeployOptions): Promise<DeploymentResult>;
  
  /**
   * Update an existing deployment
   * @param options Update options including the deployment ID and files
   * @returns Updated deployment result
   */
  update(options: UpdateOptions): Promise<DeploymentResult>;
  
  /**
   * Get information about a deployment
   * @param deploymentId ID of the deployment to check
   * @returns Current status of the deployment
   */
  getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus>;
  
  /**
   * Remove a deployment
   * @param deploymentId ID of the deployment to remove
   * @returns Whether the removal was successful
   */
  removeDeployment(deploymentId: string): Promise<boolean>;
  
  /**
   * Check if a project exists
   * @param projectName Name of the project to check
   * @returns Whether the project exists
   */
  projectExists(projectName: string): Promise<boolean>;
}

/**
 * Abstract base class for deployment targets
 * Provides common functionality and type safety
 */
export abstract class BaseDeploymentTarget implements DeploymentTarget {
  abstract getName(): string;
  abstract getProviderType(): string;
  abstract isAvailable(): Promise<boolean>;
  abstract initializeProject(options: ProjectOptions): Promise<ProjectMetadata>;
  abstract deploy(options: DeployOptions): Promise<DeploymentResult>;
  abstract update(options: UpdateOptions): Promise<DeploymentResult>;
  abstract getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus>;
  abstract removeDeployment(deploymentId: string): Promise<boolean>;
  abstract projectExists(projectName: string): Promise<boolean>;
  
  /**
   * Sanitize a project name to be valid for the deployment platform
   * @param name Original project name
   * @returns Sanitized project name
   */
  protected sanitizeProjectName(name: string): string {
    // Replace spaces and special characters with dashes
    // Convert to lowercase
    // Remove any leading or trailing dashes
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  
  /**
   * Create a standard deployment error with type information
   * @param type Type of error
   * @param message Error message
   * @param originalError Original error if available
   */
  protected createError(type: string, message: string, originalError?: Error): Error {
    const error = new Error(message);
    error.name = type;
    
    if (originalError) {
      // Attach the original error for debugging
      (error as any).originalError = originalError;
    }
    
    return error;
  }
} 