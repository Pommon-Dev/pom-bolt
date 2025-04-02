import { createScopedLogger } from '~/utils/logger';
import { getEnvironment, EnvironmentType } from '~/lib/environments';
import type { DeploymentTarget } from './targets/base';
import { CloudflarePagesTarget } from './targets/cloudflare-pages';
import type { 
  DeploymentResult, 
  DeployOptions,
  ProjectMetadata,
  ProjectOptions,
  CloudflareConfig
} from './types';
import { DeploymentErrorType } from './types';

const logger = createScopedLogger('deployment-manager');

/**
 * Options for deployment manager
 */
export interface DeploymentManagerOptions {
  preferredTargets?: string[];
  cloudflareConfig?: CloudflareConfig;
}

/**
 * Deployment Manager
 * Manages deployment targets and orchestrates deployments
 */
export class DeploymentManager {
  private targets: Map<string, DeploymentTarget> = new Map();
  private preferredTargets: string[] = [];
  
  constructor(options?: DeploymentManagerOptions) {
    this.preferredTargets = options?.preferredTargets || [
      'cloudflare-pages',
      'vercel',
      'netlify',
      'github-pages',
      'local-tunnel'
    ];
    
    this.registerAvailableTargets(options);
  }
  
  /**
   * Register available deployment targets
   */
  private registerAvailableTargets(options?: DeploymentManagerOptions): void {
    const environment = getEnvironment();
    const envInfo = environment.getInfo();
    
    logger.debug(`Registering deployment targets for environment: ${envInfo.type}`);
    
    // Register Cloudflare Pages target if config is provided
    if (options?.cloudflareConfig) {
      this.registerTarget(
        'cloudflare-pages',
        new CloudflarePagesTarget(options.cloudflareConfig)
      );
    }
    
    // TODO: Register other targets as they are implemented
    // this.registerTarget('vercel', new VercelTarget({}));
    // this.registerTarget('netlify', new NetlifyTarget({}));
  }
  
  /**
   * Register a deployment target
   */
  registerTarget(name: string, target: DeploymentTarget): void {
    this.targets.set(name, target);
    logger.debug(`Registered deployment target: ${name}`);
  }
  
  /**
   * Get all registered deployment targets
   */
  getRegisteredTargets(): string[] {
    return Array.from(this.targets.keys());
  }
  
  /**
   * Get available deployment targets
   * These are targets that are properly configured and can be used for deployment
   */
  async getAvailableTargets(): Promise<string[]> {
    const available: string[] = [];
    
    for (const [name, target] of this.targets.entries()) {
      try {
        if (await target.isAvailable()) {
          available.push(name);
        }
      } catch (error) {
        logger.warn(`Error checking availability of target ${name}:`, error);
      }
    }
    
    if (available.length === 0) {
      logger.warn('No deployment targets available');
    } else {
      logger.debug(`Available deployment targets: ${available.join(', ')}`);
    }
    
    return available;
  }
  
  /**
   * Initialize a project with a specific deployment target
   */
  async initializeProject(
    targetName: string,
    options: ProjectOptions
  ): Promise<ProjectMetadata> {
    const target = this.targets.get(targetName);
    
    if (!target) {
      throw this.createError(
        DeploymentErrorType.NOT_AVAILABLE,
        `Deployment target "${targetName}" not found`
      );
    }
    
    // Check if the target is available
    if (!await target.isAvailable()) {
      throw this.createError(
        DeploymentErrorType.NOT_AVAILABLE,
        `Deployment target "${targetName}" is not available`
      );
    }
    
    // Initialize the project
    logger.info(`Initializing project ${options.name} with target ${targetName}`);
    return target.initializeProject(options);
  }
  
  /**
   * Deploy a project using a specific deployment target
   */
  async deployProject(
    targetName: string,
    options: DeployOptions
  ): Promise<DeploymentResult> {
    const target = this.targets.get(targetName);
    
    if (!target) {
      throw this.createError(
        DeploymentErrorType.NOT_AVAILABLE,
        `Deployment target "${targetName}" not found`
      );
    }
    
    // Check if the target is available
    if (!await target.isAvailable()) {
      throw this.createError(
        DeploymentErrorType.NOT_AVAILABLE,
        `Deployment target "${targetName}" is not available`
      );
    }
    
    // Deploy the project
    logger.info(`Deploying project ${options.projectName} with target ${targetName}`);
    return target.deploy(options);
  }
  
  /**
   * Deploy a project using the best available target
   */
  async deployWithBestTarget(options: {
    projectName: string;
    files: Record<string, string>;
    targetName?: string;
    projectId?: string;
    metadata?: Record<string, any>;
  }): Promise<DeploymentResult> {
    // Use specified target or find the best available
    const targetName = options.targetName || await this.selectPreferredTarget();
    
    if (!targetName) {
      throw this.createError(
        DeploymentErrorType.NOT_AVAILABLE,
        'No deployment targets available'
      );
    }
    
    const target = this.targets.get(targetName);
    
    if (!target) {
      throw this.createError(
        DeploymentErrorType.NOT_AVAILABLE,
        `Deployment target "${targetName}" not found`
      );
    }
    
    // Initialize project (creates if it doesn't exist)
    logger.info(`Preparing to deploy ${options.projectName} using ${targetName}`);
    
    const project = await target.initializeProject({
      name: options.projectName,
      files: options.files,
      metadata: options.metadata
    });
    
    // Deploy the project
    logger.info(`Deploying project ${project.name} (${project.id}) via ${targetName}`);
    
    return target.deploy({
      projectId: project.id,
      projectName: project.name,
      files: options.files
    });
  }
  
  /**
   * Select the best available deployment target based on preferences
   */
  private async selectPreferredTarget(): Promise<string | undefined> {
    const available = await this.getAvailableTargets();
    
    if (available.length === 0) {
      return undefined;
    }
    
    // Find the first preferred target that is available
    for (const preferred of this.preferredTargets) {
      if (available.includes(preferred)) {
        return preferred;
      }
    }
    
    // If no preferred target is available, use the first available
    return available[0];
  }
  
  /**
   * Create a standard deployment error
   */
  private createError(type: DeploymentErrorType, message: string, originalError?: Error): Error {
    const error = new Error(message);
    error.name = type;
    
    if (originalError) {
      (error as any).originalError = originalError;
    }
    
    return error;
  }
}

// Singleton instance
let deploymentManagerInstance: DeploymentManager | null = null;

/**
 * Get the deployment manager instance
 */
export function getDeploymentManager(options?: DeploymentManagerOptions): DeploymentManager {
  if (!deploymentManagerInstance) {
    deploymentManagerInstance = new DeploymentManager(options);
  }
  
  return deploymentManagerInstance;
}

/**
 * Reset the deployment manager instance
 * Useful for testing or when the environment changes
 */
export function resetDeploymentManager(): void {
  deploymentManagerInstance = null;
} 