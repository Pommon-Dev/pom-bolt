import { createScopedLogger } from '~/utils/logger';
import type { DeploymentTarget } from './targets/base';
import { NetlifyTarget } from './targets/netlify';
import { NetlifyGitHubTarget } from './targets/netlify-github';
import { CloudflarePagesTarget } from './targets/cloudflare-pages';
import { LocalZipTarget } from './targets/local-zip';
import type { CloudflareConfig, GitHubConfig, NetlifyConfig } from './types';
import { getConfigValidator } from '~/lib/services/config-validator';

const logger = createScopedLogger('deployment-target-registry');

/**
 * Factory interface for creating deployment targets
 */
export interface DeploymentTargetFactory<TConfig = any> {
  /**
   * Create a new deployment target instance
   */
  create(config: TConfig): DeploymentTarget;
  
  /**
   * Get the name of this deployment target
   */
  getName(): string;
  
  /**
   * Get the provider type of this deployment target
   */
  getProviderType(): string;
  
  /**
   * Validate configuration for this deployment target
   */
  validateConfig(config: TConfig): boolean;
}

/**
 * Registry of deployment targets
 * Provides a centralized way to register and create deployment targets
 */
export class DeploymentTargetRegistry {
  private static targets: Record<string, DeploymentTargetFactory> = {};
  
  /**
   * Register a deployment target factory
   */
  public static register<TConfig>(name: string, factory: DeploymentTargetFactory<TConfig>): void {
    this.targets[name] = factory;
    logger.info(`Registered deployment target: ${name}`);
  }
  
  /**
   * Get all available target names
   */
  public static getAvailableTargets(): string[] {
    return Object.keys(this.targets);
  }
  
  /**
   * Create a deployment target instance
   */
  public static createTarget<TConfig>(name: string, config: TConfig): DeploymentTarget | null {
    if (!this.targets[name]) {
      logger.warn(`Deployment target not found: ${name}`);
      return null;
    }
    
    // Use the ConfigValidator for validation if possible
    const configValidator = getConfigValidator();
    let isValid = true;
    
    // Validate based on target type
    if (name === 'cloudflare-pages' && this.targets[name].validateConfig(config)) {
      const result = configValidator.validateCloudflareConfig(config as any);
      isValid = result.valid;
      if (!isValid) {
        logger.error(`Invalid Cloudflare configuration:`, { errors: result.errors });
      }
    } else if (name === 'netlify' && this.targets[name].validateConfig(config)) {
      const result = configValidator.validateNetlifyConfig(config as any);
      isValid = result.valid;
      if (!isValid) {
        logger.error(`Invalid Netlify configuration:`, { errors: result.errors });
      }
    } else if (name === 'netlify-github' && this.targets[name].validateConfig(config)) {
      // For combined targets, validate each part
      const combined = config as any;
      if (combined.netlify) {
        const netlifyResult = configValidator.validateNetlifyConfig(combined.netlify);
        if (!netlifyResult.valid) {
          isValid = false;
          logger.error(`Invalid Netlify configuration for netlify-github:`, { errors: netlifyResult.errors });
        }
      }
      if (combined.github) {
        const githubResult = configValidator.validateGitHubConfig(combined.github);
        if (!githubResult.valid) {
          isValid = false;
          logger.error(`Invalid GitHub configuration for netlify-github:`, { errors: githubResult.errors });
        }
      }
    } else {
      // Fall back to basic validation for other targets
      isValid = this.targets[name].validateConfig(config);
      if (!isValid) {
        logger.error(`Invalid configuration for deployment target: ${name}`);
      }
    }
    
    if (!isValid) {
      return null;
    }
    
    try {
      logger.debug(`Creating deployment target: ${name}`);
      return this.targets[name].create(config);
    } catch (error) {
      logger.error(`Failed to create deployment target ${name}:`, error);
      return null;
    }
  }
  
  /**
   * Get factory for a deployment target
   */
  public static getFactory(name: string): DeploymentTargetFactory | null {
    return this.targets[name] || null;
  }
}

/**
 * Netlify deployment target factory
 */
export const NetlifyTargetFactory: DeploymentTargetFactory<any> = {
  create(config: any): DeploymentTarget {
    // Support both legacy apiToken and new token format
    const token = config.token || config.apiToken;
    
    if (!token) {
      logger.error('Netlify token is required');
      throw new Error('Netlify API token is required');
    }
    
    // Pass the full config object to NetlifyTarget
    return new NetlifyTarget({
      token,
      githubToken: config.githubToken,
      githubOwner: config.githubOwner,
      githubInfo: config.githubInfo,
      tenantId: config.tenantId
    });
  },
  
  getName(): string {
    return 'netlify';
  },
  
  getProviderType(): string {
    return 'netlify';
  },
  
  validateConfig(config: any): boolean {
    // Support both token formats for backward compatibility
    return !!(config.token || config.apiToken);
  }
};

/**
 * Netlify with GitHub deployment target factory
 * @deprecated Use NetlifyTargetFactory with githubInfo instead
 */
export const NetlifyGitHubTargetFactory: DeploymentTargetFactory<any> = {
  create(config: any): DeploymentTarget {
    // Get Netlify token from various possible locations
    const netlifyToken = config.netlifyToken || 
                         (config.netlify && config.netlify.token) || 
                         (config.netlify && config.netlify.apiToken);
    
    // Get GitHub token from various possible locations
    const githubToken = config.githubToken || 
                        (config.github && config.github.token);
    
    // Get owner from either direct access or github object
    const githubOwner = config.githubOwner || 
                        (config.github && config.github.owner);
    
    if (!netlifyToken) {
      logger.error('Netlify token is required for netlify-github target');
      throw new Error('Netlify API token is required');
    }
    
    if (!githubToken) {
      logger.error('GitHub token is required for netlify-github target');
      throw new Error('GitHub token is required');
    }
    
    // Create with full configuration, including existing GitHub info if present
    return new NetlifyGitHubTarget({
      netlifyToken,
      githubToken,
      githubOwner,
      githubInfo: config.githubInfo || (config.metadata && config.metadata.github),
      tenantId: config.tenantId
    });
  },
  
  getName(): string {
    return 'netlify-github';
  },
  
  getProviderType(): string {
    return 'netlify';
  },
  
  validateConfig(config: any): boolean {
    // Check for all possible token locations
    const hasNetlifyToken = !!(config.netlifyToken || 
                             (config.netlify && config.netlify.token) || 
                             (config.netlify && config.netlify.apiToken));
    
    const hasGithubToken = !!(config.githubToken || 
                            (config.github && config.github.token));
    
    return hasNetlifyToken && hasGithubToken;
  }
};

/**
 * Cloudflare Pages deployment target factory
 */
export const CloudflarePagesTargetFactory: DeploymentTargetFactory<CloudflareConfig> = {
  create(config: CloudflareConfig): DeploymentTarget {
    return new CloudflarePagesTarget({
      accountId: config.accountId,
      apiToken: config.apiToken,
      projectName: config.projectName
    });
  },
  
  getName(): string {
    return 'cloudflare-pages';
  },
  
  getProviderType(): string {
    return 'cloudflare';
  },
  
  validateConfig(config: CloudflareConfig): boolean {
    return !!config.accountId && !!config.apiToken;
  }
};

/**
 * Local Zip deployment target factory
 */
export const LocalZipTargetFactory: DeploymentTargetFactory<{}> = {
  create(_config: {}): DeploymentTarget {
    return new LocalZipTarget();
  },
  
  getName(): string {
    return 'local-zip';
  },
  
  getProviderType(): string {
    return 'local';
  },
  
  validateConfig(_config: {}): boolean {
    return true; // No config needed
  }
};

// Register all built-in deployment targets
DeploymentTargetRegistry.register('netlify', NetlifyTargetFactory);
DeploymentTargetRegistry.register('netlify-github', NetlifyGitHubTargetFactory);
DeploymentTargetRegistry.register('cloudflare-pages', CloudflarePagesTargetFactory);
DeploymentTargetRegistry.register('local-zip', LocalZipTargetFactory); 