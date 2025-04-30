import { createScopedLogger } from '~/utils/logger';
import type { Environment } from '~/lib/environments/base';
import { getEnvironment } from '~/lib/environments/detector';

const logger = createScopedLogger('credential-service');

/**
 * Supported credential types
 */
export type CredentialType = 'netlify' | 'github' | 'cloudflare';

/**
 * Base credential interface
 */
export interface Credential {
  source: 'request' | 'environment' | 'temporary';
  tenantId?: string;
  temporary?: boolean;
}

/**
 * Netlify credentials
 */
export interface NetlifyCredential extends Credential {
  apiToken: string;
}

/**
 * GitHub credentials
 */
export interface GitHubCredential extends Credential {
  token: string;
  owner?: string;
}

/**
 * Cloudflare credentials
 */
export interface CloudflareCredential extends Credential {
  accountId: string;
  apiToken: string;
  projectName?: string;
}

/**
 * All credentials object
 */
export interface AllCredentials {
  netlify?: NetlifyCredential;
  github?: GitHubCredential;
  cloudflare?: CloudflareCredential;
}

/**
 * Credential retrieval options
 */
export interface CredentialOptions {
  env?: Record<string, any>;
  requestData?: Record<string, any>;
  tenantId?: string;
  environment?: Environment;
}

/**
 * Centralized credential service for managing access to various API credentials
 */
export class CredentialService {
  // Temporary storage for credentials, indexed by tenant ID or 'default'
  private temporaryCredentials: Record<string, AllCredentials> = {};
  
  /**
   * Get Netlify credentials from various sources
   */
  public getNetlifyCredentials(options: CredentialOptions = {}): NetlifyCredential | undefined {
    const { env = {}, requestData = {}, tenantId } = options;
    const environment = options.environment || getEnvironment();
    
    // First try credentials.netlify (standard format from API requests)
    if (requestData.credentials?.netlify?.apiToken) {
      logger.debug('Found Netlify credentials in requestData.credentials.netlify');
      return {
        apiToken: requestData.credentials.netlify.apiToken,
        source: 'request',
        tenantId
      };
    }
    
    // Also try direct netlifyCredentials or netlifyToken for backward compatibility
    if (requestData.netlifyCredentials?.token) {
      logger.debug('Found Netlify credentials in requestData.netlifyCredentials');
      return {
        apiToken: requestData.netlifyCredentials.token,
        source: 'request',
        tenantId
      };
    }
    
    // Check for netlifyToken top-level property
    if (requestData.netlifyToken) {
      logger.debug('Found Netlify token in requestData.netlifyToken');
      return {
        apiToken: requestData.netlifyToken,
        source: 'request',
        tenantId
      };
    }
    
    // Try temporary credentials (second priority)
    const tempCreds = this.getTemporaryCredentials('netlify', tenantId)?.netlify;
    if (tempCreds) {
      logger.debug('Found Netlify credentials in temporary storage');
      return {
        ...tempCreds,
        source: 'temporary',
        tenantId
      };
    }
    
    // Try environment variables (lowest priority)
    const netlifyToken = env.NETLIFY_API_TOKEN || env.NETLIFY_AUTH_TOKEN || 
                        environment.getEnvVariable('NETLIFY_API_TOKEN') || 
                        environment.getEnvVariable('NETLIFY_AUTH_TOKEN');
    
    if (netlifyToken) {
      logger.debug('Found Netlify credentials in environment variables');
      return {
        apiToken: netlifyToken,
        source: 'environment',
        tenantId
      };
    }
    
    logger.debug('No Netlify credentials found');
    return undefined;
  }
  
  /**
   * Get GitHub credentials from various sources
   */
  public getGitHubCredentials(options: CredentialOptions = {}): GitHubCredential | undefined {
    const { env = {}, requestData = {}, tenantId } = options;
    const environment = options.environment || getEnvironment();
    
    // First try credentials.github (standard format from API requests)
    if (requestData.credentials?.github?.token) {
      logger.debug('Found GitHub credentials in requestData.credentials.github');
      return {
        token: requestData.credentials.github.token,
        owner: requestData.credentials.github.owner,
        source: 'request',
        tenantId
      };
    }
    
    // Also try direct githubCredentials for backward compatibility
    if (requestData.githubCredentials?.token) {
      logger.debug('Found GitHub credentials in requestData.githubCredentials');
      return {
        token: requestData.githubCredentials.token,
        owner: requestData.githubCredentials.owner,
        source: 'request',
        tenantId
      };
    }
    
    // Try temporary credentials (second priority)
    const tempCreds = this.getTemporaryCredentials('github', tenantId)?.github;
    if (tempCreds) {
      logger.debug('Found GitHub credentials in temporary storage');
      return {
        ...tempCreds,
        source: 'temporary',
        tenantId
      };
    }
    
    // Try environment variables (lowest priority)
    const githubToken = env.GITHUB_TOKEN || environment.getEnvVariable('GITHUB_TOKEN');
    const githubOwner = env.GITHUB_OWNER || environment.getEnvVariable('GITHUB_OWNER');
    
    if (githubToken) {
      logger.debug('Found GitHub credentials in environment variables');
      return {
        token: githubToken,
        owner: githubOwner,
        source: 'environment',
        tenantId
      };
    }
    
    logger.debug('No GitHub credentials found');
    return undefined;
  }
  
  /**
   * Get Cloudflare credentials from various sources
   */
  public getCloudflareCredentials(options: CredentialOptions = {}): CloudflareCredential | undefined {
    const { env = {}, requestData = {}, tenantId } = options;
    const environment = options.environment || getEnvironment();
    
    // Try request data first (highest priority)
    if (requestData.cfCredentials?.accountId && requestData.cfCredentials?.apiToken) {
      logger.debug('Found Cloudflare credentials in request data.cfCredentials');
      return {
        accountId: requestData.cfCredentials.accountId,
        apiToken: requestData.cfCredentials.apiToken,
        projectName: requestData.cfCredentials.projectName || 'genapps',
        source: 'request',
        tenantId
      };
    }
    
    // Try temporary credentials (second priority)
    const tempCreds = this.getTemporaryCredentials('cloudflare', tenantId)?.cloudflare;
    if (tempCreds) {
      logger.debug('Found Cloudflare credentials in temporary storage');
      return {
        ...tempCreds,
        source: 'temporary',
        tenantId
      };
    }
    
    // Try environment variables (lowest priority)
    const cfAccountId = env.CLOUDFLARE_ACCOUNT_ID || environment.getEnvVariable('CLOUDFLARE_ACCOUNT_ID');
    const cfApiToken = env.CLOUDFLARE_API_TOKEN || environment.getEnvVariable('CLOUDFLARE_API_TOKEN');
    
    if (cfAccountId && cfApiToken) {
      logger.debug('Found Cloudflare credentials in environment variables');
      return {
        accountId: cfAccountId,
        apiToken: cfApiToken,
        projectName: env.CLOUDFLARE_PROJECT_NAME || 'genapps',
        source: 'environment',
        tenantId
      };
    }
    
    logger.debug('No Cloudflare credentials found');
    return undefined;
  }
  
  /**
   * Get all credentials from various sources
   */
  public getAllCredentials(options: CredentialOptions = {}): AllCredentials {
    return {
      netlify: this.getNetlifyCredentials(options),
      github: this.getGitHubCredentials(options),
      cloudflare: this.getCloudflareCredentials(options)
    };
  }
  
  /**
   * Store temporary credentials
   * @param credentials The credentials to store
   * @param tenantId Optional tenant ID to scope the credentials
   */
  public storeTemporaryCredentials(
    credentials: AllCredentials,
    tenantId?: string
  ): void {
    const key = tenantId || 'default';
    
    this.temporaryCredentials[key] = {
      ...this.temporaryCredentials[key],
      ...credentials
    };
    
    logger.debug(`Stored temporary credentials for tenant ${key}`, {
      hasNetlify: !!credentials.netlify,
      hasGitHub: !!credentials.github,
      hasCloudflare: !!credentials.cloudflare
    });
  }
  
  /**
   * Get temporary credentials
   * @param type The credential type to get
   * @param tenantId Optional tenant ID to scope the credentials
   * @returns The credentials or undefined if not found
   */
  public getTemporaryCredentials(
    type?: CredentialType,
    tenantId?: string
  ): AllCredentials | undefined {
    const key = tenantId || 'default';
    
    if (!this.temporaryCredentials[key]) {
      return undefined;
    }
    
    // If no type specified, return all credentials for this tenant
    if (!type) {
      return this.temporaryCredentials[key];
    }
    
    // Otherwise, return only the requested credential type if available
    if (this.temporaryCredentials[key][type]) {
      // Create new object with just the requested credential type
      if (type === 'netlify') {
        return { netlify: this.temporaryCredentials[key].netlify };
      } else if (type === 'github') {
        return { github: this.temporaryCredentials[key].github };
      } else if (type === 'cloudflare') {
        return { cloudflare: this.temporaryCredentials[key].cloudflare };
      }
    }
    
    return undefined;
  }
  
  /**
   * Extract credentials from request headers
   */
  public extractCredentialsFromHeaders(request: Request): AllCredentials {
    const credentials: AllCredentials = {};
    
    // Extract tenant ID from headers
    const tenantId = request.headers.get('x-tenant-id') || undefined;
    
    // Extract Netlify credentials
    const netlifyToken = request.headers.get('x-netlify-token');
    if (netlifyToken) {
      credentials.netlify = {
        apiToken: netlifyToken,
        source: 'request',
        tenantId,
        temporary: true
      };
      logger.debug('Found Netlify token in headers');
    }
    
    // Extract GitHub credentials
    const githubToken = request.headers.get('x-github-token');
    if (githubToken) {
      credentials.github = {
        token: githubToken,
        owner: request.headers.get('x-github-owner') || undefined,
        source: 'request',
        tenantId,
        temporary: true
      };
      logger.debug('Found GitHub token in headers');
    }
    
    // Extract Cloudflare credentials
    const cfAccountId = request.headers.get('x-cloudflare-account-id');
    const cfApiToken = request.headers.get('x-cloudflare-api-token');
    if (cfAccountId && cfApiToken) {
      credentials.cloudflare = {
        accountId: cfAccountId,
        apiToken: cfApiToken,
        projectName: request.headers.get('x-cloudflare-project-name') || 'genapps',
        source: 'request',
        tenantId,
        temporary: true
      };
      logger.debug('Found Cloudflare credentials in headers');
    }
    
    return credentials;
  }
  
  /**
   * Validate if tenant has access to credentials
   */
  public validateTenantAccess(credentials: Credential, requestedTenantId?: string): boolean {
    // If no tenant ID on the credentials, they are accessible to all
    if (!credentials.tenantId) {
      return true;
    }
    
    // If no requested tenant ID, don't allow access to tenant-scoped credentials
    if (!requestedTenantId) {
      logger.warn('Tenant-scoped credentials requested without a tenant ID');
      return false;
    }
    
    // Check if the tenant IDs match
    const hasAccess = credentials.tenantId === requestedTenantId;
    
    if (!hasAccess) {
      logger.warn('Tenant access denied', {
        credentialTenant: credentials.tenantId,
        requestTenant: requestedTenantId
      });
    }
    
    return hasAccess;
  }
}

// Singleton instance
let credentialServiceInstance: CredentialService | null = null;

/**
 * Get the credential service instance
 */
export function getCredentialService(): CredentialService {
  if (!credentialServiceInstance) {
    credentialServiceInstance = new CredentialService();
  }
  
  return credentialServiceInstance;
}

/**
 * Reset the credential service instance (for testing)
 */
export function resetCredentialService(): void {
  credentialServiceInstance = null;
} 