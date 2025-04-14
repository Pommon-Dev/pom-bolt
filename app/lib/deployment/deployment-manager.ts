import { createScopedLogger } from '~/utils/logger';
import { getEnvironment, EnvironmentType } from '~/lib/environments';
import type { DeploymentTarget } from './targets/base';
import { CloudflarePagesTarget } from './targets/cloudflare-pages';
import { NetlifyTarget } from './targets/netlify';
import { NetlifyGitHubTarget } from './targets/netlify-github';
import type { 
  DeploymentResult, 
  DeployOptions,
  ProjectMetadata,
  ProjectOptions,
  CloudflareConfig
} from './types';
import { DeploymentErrorType } from './types';
import { LocalZipTarget } from './targets/local-zip';
import { getCloudflareCredentials, getNetlifyCredentials, getGitHubCredentials } from './credentials';

const logger = createScopedLogger('deployment-manager');

// Keep track of the initialization promise for the singleton
let managerInitializationPromise: Promise<DeploymentManager> | null = null;

/**
 * Options for deployment manager
 */
export interface DeploymentManagerOptions {
  preferredTargets?: string[];
  cloudflareConfig?: CloudflareConfig;
  netlifyToken?: string;
  githubToken?: string;
}

/**
 * Deployment Manager
 * Manages deployment targets and orchestrates deployments
 */
export class DeploymentManager {
  private targets: Map<string, DeploymentTarget> = new Map();
  private preferredTargets: string[] = [];
  
  // Make constructor private to force initialization via static create method
  private constructor(options?: DeploymentManagerOptions) {
    this.preferredTargets = options?.preferredTargets || [
      'netlify-github', // Add netlify-github as the highest priority
      'netlify', // Keep netlify for backward compatibility
      'cloudflare-pages',
      'vercel',
      'github-pages',
      'local-tunnel',
      'local-zip' // Ensure local-zip is always considered, but last
    ];
    
    // Basic sync initialization can remain here if needed, like setting preferredTargets
    this.initializeBasicTargets(); // Initialize fallback target synchronously
  }

  // Static factory method to create and initialize a deployment manager singleton
  public static async create(options?: DeploymentManagerOptions): Promise<DeploymentManager> {
    // If we already have an initialization in progress, return that Promise
    if (managerInitializationPromise) {
      return managerInitializationPromise;
    }
    
    // Create new initialization Promise
    managerInitializationPromise = (async () => {
      const manager = new DeploymentManager(options);
      await manager.registerAvailableTargets(options);
      return manager;
    })();
    
    return managerInitializationPromise;
  }
  
  /**
   * Register all available deployment targets based on the current environment
   */
  private async registerAvailableTargets(options?: DeploymentManagerOptions): Promise<void> {
    const environment = getEnvironment();
    logger.debug('Starting async target registration...'); // Add log
    
    // --- Netlify Target Registration ---
    try {
      let netlifyToken = options?.netlifyToken;
      const credsSource = options?.netlifyToken ? 'options' : 'environment/context';
      if (!netlifyToken) {
        const netlifyCreds = getNetlifyCredentials();
        netlifyToken = netlifyCreds.apiToken;
        logger.debug('Attempting to retrieve Netlify credentials from environment/context');
      }

      logger.debug(`Netlify token check: Present=${!!netlifyToken}, Source=${credsSource}`);

      if (netlifyToken) {
        logger.info('Attempting to register Netlify deployment target (Token found)');
        const netlifyTarget = new NetlifyTarget({ apiToken: netlifyToken });
        logger.debug('NetlifyTarget instantiated. Calling isAvailable()...');
        const isAvailable = await netlifyTarget.isAvailable();
        logger.debug(`NetlifyTarget.isAvailable() returned: ${isAvailable}`);
        if (isAvailable) {
          this.registerTarget('netlify', netlifyTarget);
          logger.info('Successfully registered Netlify deployment target');
        } else {
          logger.warn('Netlify deployment target token found but API validation (isAvailable) failed');
        }
      } else {
        logger.warn('Netlify deployment target not registered - missing API token');
      }
    } catch (error) {
      logger.error('Failed to register Netlify deployment target (error during registration):', error);
    }

    // --- NetlifyGitHub Target Registration ---
    try {
      let netlifyToken = options?.netlifyToken;
      let githubToken = options?.githubToken;
      
      if (!netlifyToken) {
        const netlifyCreds = getNetlifyCredentials();
        netlifyToken = netlifyCreds.apiToken;
      }

      if (!githubToken) {
        const githubCreds = getGitHubCredentials();
        githubToken = githubCreds.token;
      }

      logger.debug(`NetlifyGitHub tokens check: Netlify=${!!netlifyToken}, GitHub=${!!githubToken}`);

      if (netlifyToken && githubToken) {
        logger.info('Attempting to register NetlifyGitHub deployment target (Both tokens found)');
        
        const githubCreds = getGitHubCredentials();
        const netlifyGithubTarget = new NetlifyGitHubTarget({ 
          netlifyToken, 
          githubToken,
          githubOwner: githubCreds.owner 
        });
        
        logger.debug('NetlifyGitHubTarget instantiated. Calling isAvailable()...');
        const isAvailable = await netlifyGithubTarget.isAvailable();
        logger.debug(`NetlifyGitHubTarget.isAvailable() returned: ${isAvailable}`);
        
        if (isAvailable) {
          this.registerTarget('netlify-github', netlifyGithubTarget);
          logger.info('Successfully registered NetlifyGitHub deployment target');
        } else {
          logger.warn('NetlifyGitHub deployment target tokens found but API validation failed');
        }
      } else {
        logger.warn('NetlifyGitHub deployment target not registered - missing tokens');
      }
    } catch (error) {
      logger.error('Failed to register NetlifyGitHub deployment target:', error);
    }
    
    // --- Cloudflare Pages Target Registration ---
    try {
      let cfConfig = options?.cloudflareConfig;
      const credsSource = options?.cloudflareConfig ? 'options' : 'environment';
      
      if (!cfConfig || !cfConfig.accountId || !cfConfig.apiToken) {
        cfConfig = getCloudflareCredentials();
        logger.debug('Attempting to retrieve Cloudflare credentials from environment');
      }
      
      logger.debug(`Cloudflare credentials check: AccountID=${!!cfConfig.accountId}, API Token=${!!cfConfig.apiToken}, Source=${credsSource}`);
      
      if (cfConfig.accountId && cfConfig.apiToken) {
        logger.info('Attempting to register Cloudflare Pages deployment target');
        const cloudflareTarget = new CloudflarePagesTarget(cfConfig);
        logger.debug('CloudflarePagesTarget instantiated. Calling isAvailable()...');
        const isAvailable = await cloudflareTarget.isAvailable();
        logger.debug(`CloudflarePagesTarget.isAvailable() returned: ${isAvailable}`);
        if (isAvailable) {
          this.registerTarget('cloudflare-pages', cloudflareTarget);
          logger.info('Successfully registered Cloudflare Pages deployment target');
        } else {
          logger.warn('Cloudflare Pages deployment target not available despite credentials');
        }
      } else {
        logger.warn('Cloudflare Pages deployment target not registered - missing credentials');
      }
    } catch (error) {
      logger.error('Failed to register Cloudflare Pages deployment target:', error);
    }
    
    logger.info(`Available deployment targets: ${this.getRegisteredTargets().join(', ')}`);
  }
  
  /**
   * Initialize basic targets that should always be available synchronously
   * (like the local-zip target which doesn't require API credentials)
   */
  private initializeBasicTargets(): void {
    // Local-zip target is the basic fallback target
    try {
      const localZipTarget = new LocalZipTarget();
      this.registerTarget('local-zip', localZipTarget);
      logger.debug('Local ZIP deployment target registered');
    } catch (error) {
      logger.error('Failed to register local ZIP deployment target:', error);
    }
  }
  
  /**
   * Register a deployment target
   */
  registerTarget(name: string, target: DeploymentTarget): void {
    logger.debug(`Registering deployment target: ${name}`);
    this.targets.set(name, target);
  }
  
  /**
   * Get a list of all registered targets
   */
  getRegisteredTargets(): string[] {
    return Array.from(this.targets.keys());
  }
  
  /**
   * Get a list of available deployment targets
   */
  async getAvailableTargets(): Promise<string[]> {
    const available: string[] = [];
    
    for (const [name, target] of this.targets.entries()) {
      try {
        if (await target.isAvailable()) {
          available.push(name);
        }
      } catch (error) {
        logger.error(`Error checking availability of target "${name}":`, error);
      }
    }
    
    logger.debug(`Available deployment targets: ${available.join(', ')}`);
    return available;
  }
  
  /**
   * Select the best deployment target based on preferences and availability
   */
  async selectBestTarget(preferredTarget?: string): Promise<string> {
    const availableTargets = await this.getAvailableTargets();
    
    if (availableTargets.length === 0) {
      throw this.createError(
        DeploymentErrorType.NOT_AVAILABLE,
        'No deployment targets available'
      );
    }
    
    // If a preferred target is specified and available, use it
    if (preferredTarget && availableTargets.includes(preferredTarget)) {
      return preferredTarget;
    }
    
    // Find the first available target from the preferred list
    for (const target of this.preferredTargets) {
      if (availableTargets.includes(target)) {
        return target;
      }
    }
    
    // Fall back to the first available target
    return availableTargets[0];
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
    // Select the best target
    const targetName = await this.selectBestTarget(options.targetName);
    const target = this.targets.get(targetName)!;
    
    logger.info(`Selected deployment target: ${targetName}`);
    
    // If a projectId is provided, deploy directly
    if (options.projectId) {
      return this.deployProject(targetName, {
        projectId: options.projectId,
        projectName: options.projectName,
        files: options.files,
        metadata: options.metadata
      });
    }
    
    // Otherwise initialize a new project first
    try {
      // Initialize the project
      const projectMetadata = await target.initializeProject({
        name: options.projectName,
        files: options.files,
        metadata: options.metadata
      });
      
      logger.debug(`Project initialized with ${targetName}:`, {
        id: projectMetadata.id,
        name: projectMetadata.name,
        url: projectMetadata.url
      });
      
      // Deploy the project
      const result = await target.deploy({
        projectId: projectMetadata.id,
        projectName: projectMetadata.name,
        files: options.files,
        metadata: options.metadata
      });
      
      return result;
    } catch (error) {
      logger.error(`Error deploying with ${targetName}:`, error);
      throw this.createError(
        DeploymentErrorType.DEPLOYMENT_FAILED,
        `Deployment with ${targetName} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
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

/**
 * Get the deployment manager instance (now returns a Promise)
 * Handles singleton pattern for the async initialization.
 */
export function getDeploymentManager(options?: DeploymentManagerOptions): Promise<DeploymentManager> {
  // If options are provided, force re-initialization by creating a new promise
  // Otherwise, reuse the existing promise if available
  if (options || !managerInitializationPromise) {
      logger.debug(
          `${managerInitializationPromise ? 'Re-initializing' : 'Initializing'} DeploymentManager asynchronously with options:`,
          {
              hasPreferredTargets: !!options?.preferredTargets,
              hasCloudflareConfig: !!options?.cloudflareConfig,
              hasNetlifyToken: !!options?.netlifyToken
          }
      );
      // Store the promise of the new instance creation
      managerInitializationPromise = DeploymentManager.create(options);
  } else {
      logger.debug('Reusing existing DeploymentManager initialization promise');
  }

  return managerInitializationPromise;
}

/**
 * Reset the deployment manager instance promise
 * Useful for testing or when the environment changes
 */
export function resetDeploymentManager(): void {
  managerInitializationPromise = null;
  logger.debug('DeploymentManager instance promise reset.');
} 