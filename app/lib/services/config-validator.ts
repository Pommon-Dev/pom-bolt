import { createScopedLogger } from '~/utils/logger';
import { getErrorService, ErrorCategory } from './error-service';
import type { 
  CloudflareConfig, 
  NetlifyConfig, 
  GitHubConfig, 
  DeploymentCredentials
} from '~/lib/deployment/types';

const logger = createScopedLogger('config-validator');

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Configuration validator service for validating deployment configurations
 */
export class ConfigValidator {
  private static instance: ConfigValidator;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): ConfigValidator {
    if (!ConfigValidator.instance) {
      ConfigValidator.instance = new ConfigValidator();
    }
    return ConfigValidator.instance;
  }

  /**
   * Validate Cloudflare configuration
   */
  validateCloudflareConfig(config: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if required fields are present
    if (!config) {
      errors.push('Cloudflare configuration is missing');
      return { valid: false, errors, warnings };
    }

    // Validate essential fields
    if (!config.accountId) {
      errors.push('Cloudflare account ID is required');
    } else if (typeof config.accountId !== 'string') {
      errors.push('Cloudflare account ID must be a string');
    }

    if (!config.apiToken) {
      errors.push('Cloudflare API token is required');
    } else if (typeof config.apiToken !== 'string') {
      errors.push('Cloudflare API token must be a string');
    }

    // Validate optional fields
    if (config.projectName && typeof config.projectName !== 'string') {
      errors.push('Cloudflare project name must be a string');
    }

    // Check tenant ID
    if (config.tenantId && typeof config.tenantId !== 'string') {
      errors.push('Tenant ID must be a string');
    }

    // Return result
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate Netlify configuration
   */
  validateNetlifyConfig(config: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if config exists
    if (!config) {
      errors.push('Netlify configuration is missing');
      return { valid: false, errors, warnings };
    }

    // Validate essential fields
    if (!config.token && !config.apiToken) {
      errors.push('Netlify API token is required');
    } else if (
      (config.token && typeof config.token !== 'string') ||
      (config.apiToken && typeof config.apiToken !== 'string')
    ) {
      errors.push('Netlify API token must be a string');
    }

    // Ensure API token is properly named
    if (config.token && !config.apiToken) {
      warnings.push('Using "token" property instead of "apiToken" - field name will be normalized');
    }

    // Check tenant ID
    if (config.tenantId && typeof config.tenantId !== 'string') {
      errors.push('Tenant ID must be a string');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate GitHub configuration
   */
  validateGitHubConfig(config: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if config exists
    if (!config) {
      errors.push('GitHub configuration is missing');
      return { valid: false, errors, warnings };
    }

    // Validate essential fields
    if (!config.token) {
      errors.push('GitHub token is required');
    } else if (typeof config.token !== 'string') {
      errors.push('GitHub token must be a string');
    }

    // Validate optional fields
    if (config.owner && typeof config.owner !== 'string') {
      errors.push('GitHub owner must be a string');
    }

    // Check tenant ID
    if (config.tenantId && typeof config.tenantId !== 'string') {
      errors.push('Tenant ID must be a string');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate and normalize deployment credentials
   * This ensures all credentials are properly validated and have normalized field names
   * @param credentials Raw credentials from request or environment
   * @param tenantId Optional tenant ID to associate with credentials
   * @returns Validated and normalized credentials
   */
  validateDeploymentCredentials(credentials: Record<string, any>, tenantId?: string): Record<string, DeploymentCredentials> {
    const errorService = getErrorService();
    const result: Record<string, DeploymentCredentials> = {};

    // If no credentials provided, return empty result
    if (!credentials || typeof credentials !== 'object') {
      return result;
    }

    // Validate Cloudflare config
    if (credentials.cloudflare) {
      const cfResult = this.validateCloudflareConfig(credentials.cloudflare);
      if (cfResult.valid) {
        // Normalize and associate tenant ID if not already present
        result.cloudflare = {
          ...credentials.cloudflare,
          accountId: credentials.cloudflare.accountId?.trim(),
          apiToken: credentials.cloudflare.apiToken?.trim(),
          // Only set tenantId if not already present and one is provided
          tenantId: credentials.cloudflare.tenantId || tenantId
        } as CloudflareConfig;

        // Log warnings if any
        if (cfResult.warnings.length > 0) {
          logger.warn('Cloudflare config warnings', { warnings: cfResult.warnings });
        }
      } else {
        logger.warn('Invalid Cloudflare credentials', { errors: cfResult.errors });
      }
    }

    // Validate Netlify config
    if (credentials.netlify) {
      const netlifyResult = this.validateNetlifyConfig(credentials.netlify);
      if (netlifyResult.valid) {
        // Normalize token field name - Netlify needs 'token' field
        const token = credentials.netlify.apiToken || credentials.netlify.token;
        result.netlify = {
          token: token?.trim(),
          // Only set tenantId if not already present and one is provided
          tenantId: credentials.netlify.tenantId || tenantId
        } as NetlifyConfig;

        // Log warnings if any
        if (netlifyResult.warnings.length > 0) {
          logger.warn('Netlify config warnings', { warnings: netlifyResult.warnings });
        }
      } else {
        logger.warn('Invalid Netlify credentials', { errors: netlifyResult.errors });
      }
    }

    // Validate GitHub config
    if (credentials.github) {
      const githubResult = this.validateGitHubConfig(credentials.github);
      if (githubResult.valid) {
        // Normalize and associate tenant ID if not already present
        result.github = {
          token: credentials.github.token?.trim(),
          owner: credentials.github.owner?.trim(),
          // Only set tenantId if not already present and one is provided
          tenantId: credentials.github.tenantId || tenantId
        } as GitHubConfig;

        // Log warnings if any
        if (githubResult.warnings.length > 0) {
          logger.warn('GitHub config warnings', { warnings: githubResult.warnings });
        }
      } else {
        logger.warn('Invalid GitHub credentials', { errors: githubResult.errors });
      }
    }

    return result;
  }
}

/**
 * Get the configuration validator instance
 */
export function getConfigValidator(): ConfigValidator {
  return ConfigValidator.getInstance();
} 