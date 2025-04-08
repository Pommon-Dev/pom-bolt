import { createScopedLogger } from '~/utils/logger';
import { getEnvironment, EnvironmentType } from '~/lib/environments';
import type { DeploymentTarget } from './targets/base';
import { CloudflarePagesTarget } from './targets/cloudflare-pages';
import { NetlifyTarget } from './targets/netlify';
import type { 
  DeploymentResult, 
  DeployOptions,
  ProjectMetadata,
  ProjectOptions,
  CloudflareConfig
} from './types';
import { DeploymentErrorType } from './types';
import { LocalZipTarget } from './targets/local-zip';
import { getCloudflareCredentials, getNetlifyCredentials } from './credentials';

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
      'netlify', // Ensure netlify is first by default
      'cloudflare-pages',
      'vercel',
      'github-pages',
      'local-tunnel',
      'local-zip' // Ensure local-zip is always considered, but last
    ];
    
    // Basic sync initialization can remain here if needed, like setting preferredTargets
    this.initializeBasicTargets(); // Initialize fallback target synchronously
  }

  // Private initialization method that handles async parts
  private async initializeAsync(options?: DeploymentManagerOptions): Promise<void> {
    // Attempt to register and validate cloud targets asynchronously
    await this.registerAvailableTargets(options); // Await the async registration
  }

  // Public static async factory method
  public static async create(options?: DeploymentManagerOptions): Promise<DeploymentManager> {
    const instance = new DeploymentManager(options);
    await instance.initializeAsync(options); // Wait for async initialization
    return instance;
  }
  
  /**
   * Initialize basic targets synchronously
   */
  private initializeBasicTargets(): void {
    // Always register the local-zip target as a fallback
    try {
      const localZipTarget = new LocalZipTarget();
      this.registerTarget('local-zip', localZipTarget);
      logger.debug('Registered local-zip deployment target as fallback');
    } catch (error) {
      logger.error('Failed to register local-zip deployment target:', error);
    }
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
    // --- End Netlify Target Registration ---

    // --- Cloudflare Pages Target Registration ---
    try {
      // Check if credentials are provided in options first
      let accountId = options?.cloudflareConfig?.accountId;
      let apiToken = options?.cloudflareConfig?.apiToken;
      let projectName = options?.cloudflareConfig?.projectName || 'genapps'; // Default to genapps
      
      // If not provided in options, get from environment
      if (!accountId || !apiToken) {
        const cfCreds = getCloudflareCredentials();
        accountId = cfCreds.accountId;
        apiToken = cfCreds.apiToken;
        projectName = cfCreds.projectName || 'genapps';
        logger.debug('Attempting to retrieve Cloudflare credentials from environment/context');
      }
      
      if (accountId && apiToken) {
        logger.info(`Attempting to register Cloudflare Pages target with ${projectName} project`);
        const cloudflareTarget = new CloudflarePagesTarget({
          accountId,
          apiToken,
          projectName // Use the projectName (defaults to genapps)
        });
        
        // Check if the target is actually available before registering
        const isAvailable = await cloudflareTarget.isAvailable();
        
        if (isAvailable) {
          this.registerTarget('cloudflare-pages', cloudflareTarget);
          logger.info(`Successfully registered Cloudflare Pages deployment target with ${projectName} project`);
        } else {
          logger.warn('Cloudflare Pages deployment target configuration found but API validation failed');
        }
      } else {
        logger.warn('Cloudflare Pages deployment target not registered - missing configuration', {
          missingAccountId: !accountId,
          missingApiToken: !apiToken
        });
      }
    } catch (error) {
      logger.error('Failed to register Cloudflare Pages deployment target:', error);
    }
    // --- End Cloudflare Pages Target Registration ---
    
    // Log which targets were registered
    logger.info(`Registered deployment targets: ${this.getRegisteredTargets().join(', ')}`);
    logger.debug('Finished async target registration.'); // Add log
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