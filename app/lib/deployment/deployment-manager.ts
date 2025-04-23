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
import { getProjectStorageService } from '~/lib/projects/storage-service';

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
  private storageService = getProjectStorageService();
  
  // Make constructor private to force initialization via static create method
  private constructor(options?: DeploymentManagerOptions) {
    this.preferredTargets = options?.preferredTargets || [
      'netlify-github', // Keep netlify-github as highest priority
      'netlify',
      'cloudflare-pages',
      'vercel',
      'github-pages',
      'local-tunnel',
      'local-zip' // Ensure local-zip is always considered, but last
    ];
    
    // Basic sync initialization can remain here if needed, like setting preferredTargets
    this.initializeBasicTargets(); // Initialize fallback target synchronously
    
    // Debug log the preferred targets
    logger.info(`DeploymentManager initialized with preferred targets: ${this.preferredTargets.join(', ')}`);
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

      logger.debug(`Netlify token check: Present=${!!netlifyToken}, Source=${credsSource}, Length=${netlifyToken ? netlifyToken.length : 0}`);

      if (netlifyToken) {
        logger.info('Attempting to register Netlify deployment target (Token found)');
        const netlifyTarget = new NetlifyTarget({ apiToken: netlifyToken });
        logger.debug('NetlifyTarget instantiated. Calling isAvailable()...');
        try {
          const isAvailable = await netlifyTarget.isAvailable();
          logger.debug(`NetlifyTarget.isAvailable() returned: ${isAvailable}`);
          if (isAvailable) {
            this.registerTarget('netlify', netlifyTarget);
            logger.info('Successfully registered Netlify deployment target');
          } else {
            logger.warn('Netlify deployment target token found but API validation (isAvailable) failed');
            logger.debug('Netlify token details for debugging:', {
              tokenLength: netlifyToken.length,
              tokenPrefix: netlifyToken.substring(0, 4),
              tokenSuffix: netlifyToken.substring(netlifyToken.length - 4)
            });
          }
        } catch (error) {
          logger.error('Error checking if Netlify target is available:', error);
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

      logger.debug(`NetlifyGitHub tokens check: Netlify=${!!netlifyToken} (${netlifyToken ? netlifyToken.length : 0}), GitHub=${!!githubToken} (${githubToken ? githubToken.length : 0})`);

      if (netlifyToken && githubToken) {
        logger.info('Attempting to register NetlifyGitHub deployment target (Both tokens found)');
        
        const githubCreds = getGitHubCredentials();
        const netlifyGithubTarget = new NetlifyGitHubTarget({ 
          netlifyToken, 
          githubToken,
          githubOwner: githubCreds.owner 
        });
        
        logger.debug('NetlifyGitHubTarget instantiated with configuration:');
        netlifyGithubTarget.logDebugInfo();
        
        logger.debug('NetlifyGitHubTarget instantiated. Calling isAvailable()...');
        try {
          const isAvailable = await netlifyGithubTarget.isAvailable();
          logger.debug(`NetlifyGitHubTarget.isAvailable() returned: ${isAvailable}`);
          
          if (isAvailable) {
            this.registerTarget('netlify-github', netlifyGithubTarget);
            logger.info('Successfully registered NetlifyGitHub deployment target');
          } else {
            logger.warn('NetlifyGitHub deployment target tokens found but API validation failed');
            logger.debug('Token details for debugging:', {
              netlifyLength: netlifyToken.length,
              netlifyPrefix: netlifyToken.substring(0, 4),
              githubLength: githubToken.length,
              githubPrefix: githubToken.substring(0, 4)
            });
          }
        } catch (error) {
          logger.error('Error checking if NetlifyGitHub target is available:', error);
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
      
      // Get credentials from environment if not provided in options
      const envCredentials = getCloudflareCredentials();
      
      // Combine credentials, prioritizing options over environment
      const cloudflareConfig: CloudflareConfig = {
        accountId: cfConfig?.accountId || envCredentials.accountId || '',
        apiToken: cfConfig?.apiToken || envCredentials.apiToken || '',
        projectName: cfConfig?.projectName || envCredentials.projectName
      };
      
      logger.debug(`Cloudflare credentials check: AccountID=${!!cloudflareConfig.accountId}, API Token=${!!cloudflareConfig.apiToken}, Source=${credsSource}`);
      
      if (cloudflareConfig.accountId && cloudflareConfig.apiToken) {
        logger.info('Attempting to register Cloudflare Pages deployment target');
        const cloudflareTarget = new CloudflarePagesTarget(cloudflareConfig);
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
   * Deploy a project
   * Deploy files to a provider service
   */
  async deployProject(options: {
    targetName?: string;
    projectId: string;
    projectName?: string;
    files: Record<string, string>;
    metadata?: Record<string, any>;
  }): Promise<DeploymentResult> {
    logger.info(`Deploying project ${options.projectName || options.projectId} with target ${options.targetName || 'auto'}`);
    
    // If a specific target is requested, first check if it's available
    if (options.targetName && options.targetName !== 'auto') {
      logger.info(`Explicit target requested: ${options.targetName}`);
      const requestedTarget = this.targets.get(options.targetName);
      
      if (requestedTarget) {
        try {
          const isAvailable = await requestedTarget.isAvailable();
          if (isAvailable) {
            logger.info(`Using explicitly requested target: ${options.targetName}`);
            
            // Initialize project if needed
            const project = await this.initializeProject(requestedTarget, options);
            
            // Deploy
            return await requestedTarget.deploy({
              projectId: project.id,
              projectName: project.name,
              files: options.files,
              metadata: {
                ...options.metadata,
                ...project.metadata
              }
            });
          } else {
            logger.warn(`Requested target ${options.targetName} is not available`);
          }
        } catch (error) {
          logger.error(`Error with requested target ${options.targetName}:`, error);
        }
      } else {
        logger.warn(`Requested target ${options.targetName} is not registered`);
      }
    }
    
    // Use auto-select logic if the specific target fails or 'auto' is specified
    const targetName = await this.selectBestTarget(options.targetName);
    logger.info(`Selected deployment target: ${targetName}`);
    
    const target = this.targets.get(targetName);
    if (!target) {
      throw new Error(`Deployment target ${targetName} not available`);
    }
    
    // Deploy the project
    return target.deploy({
      projectId: options.projectId,
      projectName: options.projectName || options.projectId,
      files: options.files,
      metadata: options.metadata
    });
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
      return this.deployProject({
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

  /**
   * Get a specific deployment target by name
   */
  public getTarget(targetName: string): DeploymentTarget | null {
    return this.targets.get(targetName) || null;
  }

  private async initializeTargets(options: DeploymentManagerOptions): Promise<void> {
    try {
      // Initialize Cloudflare Pages target if credentials are available
      const cfConfig = options?.cloudflareConfig;
      const credsSource = options?.cloudflareConfig ? 'options' : 'environment';
      
      // Get credentials from environment if not provided in options
      const envCredentials = getCloudflareCredentials();
      
      // Combine credentials, prioritizing options over environment
      const cloudflareConfig: CloudflareConfig = {
        accountId: cfConfig?.accountId || envCredentials.accountId || '',
        apiToken: cfConfig?.apiToken || envCredentials.apiToken || '',
        projectName: cfConfig?.projectName || envCredentials.projectName
      };
      
      logger.debug(`Cloudflare credentials check: AccountID=${!!cloudflareConfig.accountId}, API Token=${!!cloudflareConfig.apiToken}, Source=${credsSource}`);
      
      if (cloudflareConfig.accountId && cloudflareConfig.apiToken) {
        logger.info('Attempting to register Cloudflare Pages deployment target');
        const cloudflareTarget = new CloudflarePagesTarget(cloudflareConfig);
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

    // Initialize Netlify target if token is available
    if (options.netlifyToken) {
      const netlifyTarget = new NetlifyTarget({
        apiToken: options.netlifyToken
      });
      this.targets.set('netlify', netlifyTarget);
    }

    // Initialize Netlify GitHub target if both tokens are available
    if (options.netlifyToken && options.githubToken) {
      const netlifyGitHubTarget = new NetlifyGitHubTarget({
        netlifyToken: options.netlifyToken,
        githubToken: options.githubToken
      });
      this.targets.set('netlify-github', netlifyGitHubTarget);
    }

    // Initialize Local Zip target (always available)
    const localZipTarget = new LocalZipTarget();
    this.targets.set('local-zip', localZipTarget);

    // Set preferred targets
    this.preferredTargets = options.preferredTargets || ['cloudflare-pages', 'netlify', 'local-zip'];

    logger.info('Deployment targets initialized', {
      targets: Array.from(this.targets.keys()),
      preferredTargets: this.preferredTargets
    });
  }
}

/**
 * Get a deployment manager instance
 * This function is a singleton factory that returns the same instance
 * or creates a new one if it doesn't exist yet
 */
export async function getDeploymentManager(options?: DeploymentManagerOptions): Promise<DeploymentManager> {
  // Log the options to help with debugging
  logger.info('Getting DeploymentManager with options:', { 
    hasNetlifyToken: !!options?.netlifyToken,
    hasGithubToken: !!options?.githubToken,
    hasCloudflareConfig: !!(options?.cloudflareConfig?.accountId && options?.cloudflareConfig?.apiToken)
  });

  // Initialize if needed
  if (managerInitializationPromise === null) {
    managerInitializationPromise = DeploymentManager.create(options);
  } else if (options) {
    // If this is a re-initialization with new options, create a new promise
    logger.info('Re-initializing DeploymentManager with new options');
    managerInitializationPromise = DeploymentManager.create(options);
  }

  // Return the manager
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