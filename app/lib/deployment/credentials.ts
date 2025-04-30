import { createScopedLogger } from '~/utils/logger';
import type { CloudflareConfig, DeploymentCredentials, GitHubConfig, NetlifyConfig } from './types';
import { DeploymentErrorType } from './types';

const logger = createScopedLogger('deployment-credentials');

/**
 * Interface for environment variables with Cloudflare settings
 */
interface EnvWithCloudflare {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
}

/**
 * Interface for environment variables with Netlify settings
 */
interface EnvWithNetlify {
  NETLIFY_AUTH_TOKEN?: string;
  NETLIFY_API_TOKEN?: string;
}

/**
 * Interface for environment variables with GitHub settings
 */
interface EnvWithGitHub {
  GITHUB_TOKEN?: string;
  GITHUB_OWNER?: string;
}

/**
 * Credential Manager for secure handling of deployment credentials
 */
export class CredentialManager {
  // Temporary storage for credentials, indexed by tenant ID or 'default'
  private temporaryCredentials: Record<string, Record<string, any>> = {};
  
  /**
   * Extract deployment credentials from a request
   * Note: This is a synchronous method that doesn't parse the request body
   * It only extracts credentials from headers and URL parameters
   * @param request The HTTP request
   * @returns Object containing deployment credentials info
   */
  public extractCredentialsFromRequest(request: Request): {
    netlify?: NetlifyConfig;
    github?: GitHubConfig;
    cloudflare?: CloudflareConfig;
    tenantId?: string;
  } {
    try {
      logger.debug('Extracting credentials from request headers');
      
      // Extract tenant ID from headers
      const tenantId = request.headers.get('x-tenant-id') || undefined;
      
      // Extract tokens from headers if present
      const netlifyToken = request.headers.get('x-netlify-token');
      const githubToken = request.headers.get('x-github-token');
      const githubOwner = request.headers.get('x-github-owner');
      const cloudflareAccountId = request.headers.get('x-cloudflare-account-id');
      const cloudflareApiToken = request.headers.get('x-cloudflare-api-token');
      
      const credentials: {
        netlify?: NetlifyConfig;
        github?: GitHubConfig;
        cloudflare?: CloudflareConfig;
        tenantId?: string;
      } = { tenantId };
      
      // Set credentials based on headers
      if (netlifyToken) {
        credentials.netlify = {
          token: netlifyToken,
          tenantId,
          temporary: true
        };
        logger.debug('Found Netlify token in headers', { 
          tokenLength: netlifyToken.length 
        });
      }
      
      if (githubToken) {
        credentials.github = {
          token: githubToken,
          owner: githubOwner || undefined,
          tenantId,
          temporary: true
        };
        logger.debug('Found GitHub token in headers', { 
          tokenLength: githubToken.length,
          hasOwner: !!githubOwner
        });
      }
      
      if (cloudflareAccountId && cloudflareApiToken) {
        credentials.cloudflare = {
          accountId: cloudflareAccountId,
          apiToken: cloudflareApiToken,
          tenantId,
          temporary: true
        };
        logger.debug('Found Cloudflare credentials in headers');
      }
      
      return credentials;
    } catch (error) {
      logger.error('Error extracting credentials from request:', error);
      return {};
    }
  }
  
  /**
   * Extract deployment credentials from request body
   * This is an async method that parses the request body as JSON
   * @param request The HTTP request
   * @returns Promise resolving to object containing deployment credentials
   */
  public async extractCredentialsFromBody(request: Request): Promise<{
    netlify?: NetlifyConfig;
    github?: GitHubConfig;
    cloudflare?: CloudflareConfig;
    tenantId?: string;
  }> {
    try {
      logger.debug('Extracting credentials from request body');
      
      // Extract tenant ID from headers
      const tenantId = request.headers.get('x-tenant-id') || undefined;
      
      // Try to parse the request body as JSON
      const contentType = request.headers.get('Content-Type') || '';
      if (!contentType.includes('application/json')) {
        logger.debug('Request content type is not JSON, skipping body extraction');
        return { tenantId };
      }
      
      // Clone the request to avoid consuming the body
      const clonedRequest = request.clone();
      
      try {
        const body = await clonedRequest.json();
        const credentials: {
          netlify?: NetlifyConfig;
          github?: GitHubConfig;
          cloudflare?: CloudflareConfig;
          tenantId?: string;
        } = { tenantId };
        
        // Extract credentials from the body
        if (body.credentials) {
          logger.debug('Found credentials object in request body');
          
          // Netlify credentials
          if (body.credentials.netlify) {
            credentials.netlify = {
              token: body.credentials.netlify.token || body.credentials.netlify.apiToken,
              tenantId,
              temporary: body.credentials.temporary || false
            };
            logger.debug('Extracted Netlify credentials', { 
              hasToken: !!credentials.netlify.token,
              tokenLength: credentials.netlify.token ? credentials.netlify.token.length : 0
            });
          }
          
          // GitHub credentials
          if (body.credentials.github) {
            credentials.github = {
              token: body.credentials.github.token,
              owner: body.credentials.github.owner,
              tenantId,
              temporary: body.credentials.temporary || false
            };
            logger.debug('Extracted GitHub credentials', { 
              hasToken: !!credentials.github.token,
              hasOwner: !!credentials.github.owner
            });
          }
          
          // Cloudflare credentials
          if (body.credentials.cloudflare) {
            credentials.cloudflare = {
              accountId: body.credentials.cloudflare.accountId,
              apiToken: body.credentials.cloudflare.apiToken,
              projectName: body.credentials.cloudflare.projectName,
              tenantId,
              temporary: body.credentials.temporary || false
            };
            logger.debug('Extracted Cloudflare credentials', { 
              hasAccountId: !!credentials.cloudflare.accountId,
              hasApiToken: !!credentials.cloudflare.apiToken
            });
          }
        } else {
          logger.debug('No credentials object found in request body');
          
          // Look for top-level credential properties
          // Netlify
          if (body.netlifyCredentials || body.netlifyToken) {
            credentials.netlify = {
              token: body.netlifyCredentials?.token || body.netlifyToken,
              tenantId,
              temporary: body.temporary || false
            };
            logger.debug('Extracted Netlify credentials from top level', { 
              hasToken: !!credentials.netlify.token,
              tokenLength: credentials.netlify.token ? credentials.netlify.token.length : 0
            });
          }
          
          // GitHub
          if (body.githubCredentials || body.githubToken) {
            credentials.github = {
              token: body.githubCredentials?.token || body.githubToken,
              owner: body.githubCredentials?.owner || body.githubOwner,
              tenantId,
              temporary: body.temporary || false
            };
            logger.debug('Extracted GitHub credentials from top level', { 
              hasToken: !!credentials.github.token,
              hasOwner: !!credentials.github.owner
            });
          }
          
          // Cloudflare
          if (body.cloudflareCredentials) {
            credentials.cloudflare = {
              accountId: body.cloudflareCredentials.accountId,
              apiToken: body.cloudflareCredentials.apiToken,
              projectName: body.cloudflareCredentials.projectName,
              tenantId,
              temporary: body.temporary || false
            };
            logger.debug('Extracted Cloudflare credentials from top level', { 
              hasAccountId: !!credentials.cloudflare.accountId,
              hasApiToken: !!credentials.cloudflare.apiToken
            });
          }
        }
        
        return credentials;
      } catch (error) {
        logger.error('Failed to parse request body as JSON:', error);
        return { tenantId };
      }
    } catch (error) {
      logger.error('Error extracting credentials from request body:', error);
      return {};
    }
  }
  
  /**
   * Store temporary credentials
   * @param credentials The credentials to store
   * @param tenantId Optional tenant ID to scope the credentials
   */
  public storeTemporaryCredentials(
    credentials: DeploymentCredentials,
    provider: string,
    tenantId?: string
  ): void {
    const key = tenantId || 'default';
    
    if (!this.temporaryCredentials[key]) {
      this.temporaryCredentials[key] = {};
    }
    
    this.temporaryCredentials[key][provider] = credentials;
    logger.debug(`Stored temporary ${provider} credentials for tenant ${key}`);
  }
  
  /**
   * Get temporary credentials
   * @param provider The provider to get credentials for
   * @param tenantId Optional tenant ID to scope the credentials
   * @returns The credentials or undefined if not found
   */
  public getTemporaryCredentials(
    provider: string,
    tenantId?: string
  ): DeploymentCredentials | undefined {
    const key = tenantId || 'default';
    
    if (!this.temporaryCredentials[key] || !this.temporaryCredentials[key][provider]) {
      return undefined;
    }
    
    return this.temporaryCredentials[key][provider];
  }
  
  /**
   * Clear temporary credentials
   * @param tenantId Optional tenant ID to scope the credentials to clear
   */
  public clearTemporaryCredentials(tenantId?: string): void {
    if (tenantId) {
      delete this.temporaryCredentials[tenantId];
      logger.debug(`Cleared temporary credentials for tenant ${tenantId}`);
    } else {
      this.temporaryCredentials = {};
      logger.debug('Cleared all temporary credentials');
    }
  }
  
  /**
   * Validate if the tenant has access to the provided credentials
   * @param credentials The credentials to validate
   * @param tenantId The tenant ID to validate against
   * @returns Whether the tenant has access to the credentials
   */
  public validateTenantAccess(
    credentials: DeploymentCredentials,
    tenantId?: string
  ): boolean {
    if (!tenantId) {
      return true; // No tenant ID provided, allow access
    }
    
    if (!credentials.tenantId) {
      return true; // Credentials not scoped to a tenant, allow access
    }
    
    return credentials.tenantId === tenantId;
  }

  public getAllCredentials(options: {
    env?: Record<string, any>;
    requestData?: {
      credentials?: {
        github?: { token: string; owner?: string };
        netlify?: { apiToken: string };
        cloudflare?: { accountId: string; apiToken: string; projectName?: string };
      };
      [key: string]: any;
    };
    tenantId?: string;
  }): Record<string, any> {
    const { env = {}, requestData = {}, tenantId } = options;
    
    logger.debug('🔑 [CredentialManager] Getting all credentials:', {
      hasEnv: Object.keys(env).length > 0,
      hasRequestData: Object.keys(requestData).length > 0,
      tenantId: tenantId || 'default',
      requestDataKeys: Object.keys(requestData)
    });

    const credentials: Record<string, any> = {};

    // Check request data first
    if (requestData.credentials) {
      logger.debug('🔑 [CredentialManager] Found credentials in request data:', {
        providers: Object.keys(requestData.credentials)
      });
      Object.assign(credentials, requestData.credentials);
    }

    // Check environment variables
    if (env.GITHUB_TOKEN) {
      logger.debug('🔑 [CredentialManager] Found GitHub token in environment');
      credentials.github = {
        token: env.GITHUB_TOKEN,
        source: 'environment'
      };
    }

    if (env.NETLIFY_API_TOKEN || env.NETLIFY_AUTH_TOKEN) {
      logger.debug('🔑 [CredentialManager] Found Netlify token in environment');
      credentials.netlify = {
        apiToken: env.NETLIFY_API_TOKEN || env.NETLIFY_AUTH_TOKEN,
        source: 'environment'
      };
    }

    // Check temporary storage
    const tempCreds = this.getTemporaryCredentials(tenantId);
    if (tempCreds) {
      logger.debug('🔑 [CredentialManager] Found temporary credentials:', {
        providers: Object.keys(tempCreds)
      });
      Object.assign(credentials, tempCreds);
    }

    logger.debug('🔑 [CredentialManager] Final credentials:', {
      providers: Object.keys(credentials),
      github: !!credentials.github,
      netlify: !!credentials.netlify,
      cloudflare: !!credentials.cloudflare
    });

    return credentials;
  }
}

/**
 * Singleton instance of the credential manager
 */
let credentialManagerInstance: CredentialManager | null = null;

/**
 * Get the credential manager instance
 */
export function getCredentialManager(): CredentialManager {
  if (!credentialManagerInstance) {
    credentialManagerInstance = new CredentialManager();
  }
  
  return credentialManagerInstance;
}

/**
 * Load Cloudflare credentials from environment variables
 */
export function loadCloudflareCredentials(): Partial<CloudflareConfig> {
  const credentials: Partial<CloudflareConfig> = {
    projectName: 'genapps', // Always use genapps project
  };

  // First check environment variables
  try {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.CLOUDFLARE_ACCOUNT_ID) {
        credentials.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        logger.debug('Found CLOUDFLARE_ACCOUNT_ID in process.env');
      }

      if (process.env.CLOUDFLARE_API_TOKEN) {
        credentials.apiToken = process.env.CLOUDFLARE_API_TOKEN;
        logger.debug('Found CLOUDFLARE_API_TOKEN in process.env');
      }

      // If we have all credentials from env vars, return them
      if (credentials.accountId && credentials.apiToken) {
        logger.info('Using Cloudflare credentials from environment variables');
        return credentials;
      }
    }
  } catch (error) {
    logger.warn('Error accessing process.env:', error);
  }
  
  // In browser context, we don't attempt to load from .env.deploy
  logger.debug('Running in browser/Cloudflare context, cannot load from .env.deploy file');
  return credentials;
}

/**
 * Extract Cloudflare credentials from context or environment
 */
export function getCloudflareCredentials(context: any = {}): { accountId?: string; apiToken?: string; projectName?: string } {
  // Log the context structure for debugging
  logger.debug('Cloudflare credentials context structure:', {
    contextType: typeof context,
    hasCloudflare: !!context.cloudflare,
    hasCloudflarEnv: !!context.cloudflare?.env,
    hasDirectEnv: !!context.env
  });
  
  // Try multiple paths to find the environment variables
  const env = context.cloudflare?.env || context.env || {};
  
  const accountId = typeof env.CLOUDFLARE_ACCOUNT_ID === 'string' ? env.CLOUDFLARE_ACCOUNT_ID : undefined;
  const apiToken = typeof env.CLOUDFLARE_API_TOKEN === 'string' ? env.CLOUDFLARE_API_TOKEN : undefined;
  
  logger.debug('Cloudflare credentials status:', { 
    hasAccountId: !!accountId,
    hasApiToken: !!apiToken
  });
  
  if (!accountId || !apiToken) {
    logger.warn('Missing Cloudflare credentials. Check that CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are set in environment variables.');
  }
  
  return {
    accountId,
    apiToken,
    projectName: 'genapps' // Default project name for Cloudflare Pages
  };
}

/**
 * Extract Netlify credentials from context or environment
 */
export function getNetlifyCredentials(context: any = {}): { apiToken?: string } {
  // Log the context structure for debugging
  logger.debug('Netlify credentials context structure:', {
    contextType: typeof context,
    hasCloudflare: !!context.cloudflare,
    hasEnv: !!context.env
  });
  
  // Try multiple paths to find the environment variables
  const env = context.cloudflare?.env || context.env || {};
  
  // Check for both possible environment variable names
  const apiToken = typeof env.NETLIFY_API_TOKEN === 'string' ? env.NETLIFY_API_TOKEN : 
                  typeof env.NETLIFY_AUTH_TOKEN === 'string' ? env.NETLIFY_AUTH_TOKEN : 
                  undefined;
  
  logger.debug('Netlify credentials status:', { 
    hasApiToken: !!apiToken
  });
  
  if (!apiToken) {
    logger.warn('Missing Netlify credentials. Check that NETLIFY_API_TOKEN or NETLIFY_AUTH_TOKEN is set in environment variables.');
  }
  
  return {
    apiToken
  };
}

/**
 * Extract GitHub credentials from context or environment
 */
export function getGitHubCredentials(context: any = {}): { token?: string; owner?: string } {
  // Log the context structure for debugging
  logger.debug('GitHub credentials context structure:', {
    contextType: typeof context,
    hasCloudflare: !!context.cloudflare,
    hasEnv: !!context.env
  });
  
  // Try multiple paths to find the environment variables
  const env = context.cloudflare?.env || context.env || {};
  
  const token = typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN : undefined;
  const owner = typeof env.GITHUB_OWNER === 'string' ? env.GITHUB_OWNER : undefined;
  
  logger.debug('GitHub credentials status:', { 
    hasToken: !!token,
    hasOwner: !!owner
  });
  
  if (!token) {
    logger.warn('Missing GitHub credentials. Check that GITHUB_TOKEN is set in environment variables.');
  }
  
  return {
    token,
    owner
  };
}

/**
 * Extract API keys from cookies or request
 */
export function getApiKeysFromCookie(request: Request): { netlifyToken?: string; githubToken?: string } {
  const cookies = request.headers.get('cookie') || '';
  const netlifyMatch = cookies.match(/netlifyToken=([^;]+)/);
  const githubMatch = cookies.match(/githubToken=([^;]+)/);
  
  return {
    netlifyToken: netlifyMatch ? netlifyMatch[1] : undefined,
    githubToken: githubMatch ? githubMatch[1] : undefined
  };
}

/**
 * Extract provider settings from cookies
 */
export function getProviderSettingsFromCookie(request: Request): { 
  preferredProvider?: string;
  githubOwner?: string; 
} {
  const cookies = request.headers.get('cookie') || '';
  const providerMatch = cookies.match(/preferredProvider=([^;]+)/);
  const ownerMatch = cookies.match(/githubOwner=([^;]+)/);
  
  return {
    preferredProvider: providerMatch ? providerMatch[1] : undefined,
    githubOwner: ownerMatch ? ownerMatch[1] : undefined
  };
} 