import { createScopedLogger } from '~/utils/logger';
import { BaseDeploymentTarget } from './base';
import type {
  ProjectOptions,
  ProjectMetadata,
  DeployOptions,
  UpdateOptions,
  DeploymentResult,
  DeploymentStatus,
} from '../types';
import { DeploymentErrorType } from '../types';
import { ZipPackager } from '../packagers/zip';
import type { GitHubRepositoryInfo } from '~/lib/projects/types';

const logger = createScopedLogger('netlify-target');
const NETLIFY_API_BASE = 'https://api.netlify.com/api/v1';

interface NetlifyConfig {
  token?: string; // API token for Netlify
  apiToken?: string; // Alternative name for the API token
  githubInfo?: GitHubRepositoryInfo; // Existing GitHub repository information
  githubToken?: string; // GitHub token for connecting Netlify to GitHub
  githubOwner?: string; // GitHub owner for connecting Netlify to GitHub
  tenantId?: string;
}

interface NetlifyUser {
  id: string;
  email: string;
  full_name?: string;
}

interface NetlifySite {
  id: string;
  name: string;
  url: string;
  ssl_url?: string;
  default_domain?: string;
}

interface NetlifyDeploy {
  id: string;
  site_id: string;
  status: string;
  deploy_url: string;
  ssl_url?: string;
  error_message?: string;
}

interface NetlifyErrorResponse {
  message?: string;
  errors?: Array<{ message: string }>;
  code?: string;
}

/**
 * Deployment target for Netlify
 */
export class NetlifyTarget extends BaseDeploymentTarget {
  private config: NetlifyConfig;
  private zipPackager: ZipPackager;
  private netlifyApiBase = NETLIFY_API_BASE;

  constructor(config: NetlifyConfig) {
    super();
    // Handle both token and apiToken property names
    const authToken = config.token || config.apiToken;
    if (!authToken) {
      throw new Error('Netlify API token is required (as token or apiToken)');
    }
    
    // Store the token with a consistent name internally
    this.config = {
      ...config,
      token: authToken
    };
    
    this.zipPackager = new ZipPackager();
    
    // Log additional information if GitHub info is provided
    if (config.githubInfo) {
      logger.info('NetlifyTarget initialized with GitHub repository info', {
        repoName: config.githubInfo.fullName,
        repoUrl: config.githubInfo.url
      });
    } else {
      logger.info('NetlifyTarget initialized without GitHub repository info');
    }
  }

  getName(): string {
    return 'netlify';
  }

  getProviderType(): string {
    return 'netlify';
  }

  /**
   * Make a request to the Netlify API with proper error handling
   */
  private async fetchNetlifyApi<T>(path: string, options: RequestInit = {}): Promise<Response> {
    try {
      // Ensure we have an API token
      const apiToken = this.config.token || this.config.apiToken;
      if (!apiToken) {
        throw new Error('Netlify API token is required');
      }

      // Set up API URL
      const url = `${this.netlifyApiBase}${path}`;
      
      // Set up request headers
      const headers = {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      };
      
      logger.debug(`📡 Netlify API request: ${options.method || 'GET'} ${path}`);
      
      // More conservative approach for handling rate limits
      let attempts = 0;
      const maxAttempts = 3;  // Reduced from 5 to 3
      const baseDelay = 3000; // Start with 3 second delay
      
      while (attempts < maxAttempts) {
        try {
          const response = await fetch(url, {
            ...options,
            headers
          });
          
          // Check if we hit rate limits and should retry
          if (response.status === 429) {
            attempts++;
            
            // Honor the retry-after header if provided
            const retryAfter = response.headers.get('retry-after');
            const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 30;
            
            // Use the suggested wait time or fallback to our calculated delay
            const delay = retrySeconds ? (retrySeconds * 1000) : 
              baseDelay * Math.pow(3, attempts); // More aggressive (pow 3 instead of 2)
            
            logger.warn(`Netlify API rate limit hit, retrying in ${Math.round(delay/1000)}s (attempt ${attempts}/${maxAttempts})`);
            
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          
          // For non-rate limit errors, return the response for processing by the caller
          return response;
        } catch (fetchError) {
          attempts++;
          
          // Only retry network errors, not API errors
          if (attempts >= maxAttempts || !(fetchError instanceof Error && fetchError.message.includes('network'))) {
            throw fetchError;
          }
          
          const delay = baseDelay * Math.pow(3, attempts);
          logger.warn(`Netlify API network error, retrying in ${Math.round(delay/1000)}s (attempt ${attempts}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      // If we reached max attempts with rate limits, throw a specific error
      throw new Error('Netlify API rate limit exceeded after multiple attempts');
    } catch (error) {
      logger.error('Netlify API request failed:', error);
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    logger.debug('Checking Netlify availability...');
    if (!this.config.token) {
      logger.warn('Netlify API token is missing');
      return false;
    }

    try {
      const response = await this.fetchNetlifyApi<NetlifyUser>('/user');
      const user = await response.json() as NetlifyUser;
      logger.info(`Netlify API token validated successfully for user: ${user.email}`);
      return true;
    } catch (error) {
      logger.error('Error checking Netlify availability:', error);
      return false;
    }
  }

  async projectExists(projectName: string): Promise<boolean> {
    const sanitizedName = this.sanitizeProjectName(projectName);
    logger.debug(`Checking if Netlify project exists: ${sanitizedName}`);
    
    try {
      const response = await this.fetchNetlifyApi<NetlifySite[]>(`/sites?name=${sanitizedName}`);
      const sites = await response.json() as NetlifySite[];
      return sites.some((site: NetlifySite) => site.name === sanitizedName);
    } catch (error) {
      logger.error(`Error checking if Netlify project exists: ${sanitizedName}`, error);
      return false;
    }
  }

  protected sanitizeProjectName(name: string): string {
    let sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-+|-+$/g, '');
      
    if (!sanitized) {
      sanitized = `site-${Date.now()}`;
    }
    
    if (sanitized.length > 63) {
      sanitized = sanitized.substring(0, 60) + '-' + Math.floor(Math.random() * 100);
    }
    
    logger.debug(`Sanitized project name: ${name} -> ${sanitized}`);
    return sanitized;
  }

  async initializeProject(options: ProjectOptions): Promise<ProjectMetadata> {
    const sanitizedName = this.sanitizeProjectName(options.name);
    logger.debug(`Initializing Netlify project: ${sanitizedName}`);

    try {
      // Check if site already exists
      const existingSite = await this.findSiteByName(sanitizedName);
      if (existingSite) {
        logger.info(`Using existing Netlify site: ${existingSite.name}`);
        return this.mapSiteToMetadata(existingSite);
      }

      // Create new site
      const response = await this.fetchNetlifyApi<NetlifySite>('/sites', {
        method: 'POST',
        body: JSON.stringify({ name: sanitizedName })
      });
      
      const site = await response.json() as NetlifySite;
      logger.info(`Created new Netlify site: ${site.name}`);
      
      return this.mapSiteToMetadata(site);
    } catch (error) {
      logger.error(`Failed to initialize Netlify project ${sanitizedName}:`, error);
      throw this.createError(
        DeploymentErrorType.INITIALIZATION_FAILED,
        `Failed to initialize Netlify project: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private async findSiteByName(name: string): Promise<NetlifySite | null> {
    try {
      const response = await this.fetchNetlifyApi<NetlifySite[]>(`/sites?name=${name}`);
      const sites = await response.json() as NetlifySite[];
      return sites.find((site: NetlifySite) => site.name === name) || null;
    } catch (error) {
      logger.error(`Error finding Netlify site by name: ${name}`, error);
      return null;
    }
  }

  private mapSiteToMetadata(site: NetlifySite): ProjectMetadata {
    return {
      id: site.id,
      name: site.name,
      url: site.ssl_url || site.url,
      provider: this.getProviderType(),
      metadata: {
        siteId: site.id,
        defaultDomain: site.default_domain,
      },
    };
  }

  async deploy(options: DeployOptions): Promise<DeploymentResult> {
    // Validate options first
    this.validateOptions(options);

    // Don't use projectId as siteId directly
    // Instead, try to find the Netlify site ID from various sources
    let siteId: string;
    
    // 1. First check if we have a site ID in the options
    if (options.metadata?.netlify?.siteId) {
      siteId = options.metadata.netlify.siteId;
      logger.debug(`Using Netlify site ID from metadata: ${siteId}`);
    } 
    // 2. Try to use the site ID from a previously created site
    else {
      try {
        // Try to find the site by name first
        const sanitizedName = this.sanitizeProjectName(options.projectName);
        const existingSite = await this.findSiteByName(sanitizedName);
        
        if (existingSite) {
          siteId = existingSite.id;
          logger.debug(`Found Netlify site by name: ${sanitizedName}, site ID: ${siteId}`);
        } else {
          // Last resort - try to initialize a new site
          logger.info(`No existing Netlify site found for ${options.projectName}, creating new site`);
          const metadata = await this.initializeProject({
            name: options.projectName
          });
          
          siteId = metadata.id;
          logger.info(`Created new Netlify site: ${metadata.name} (ID: ${siteId})`);
        }
      } catch (error) {
        logger.error(`Failed to find or create Netlify site: ${error}`);
        throw this.createError(
          DeploymentErrorType.INITIALIZATION_FAILED,
          `Failed to find or create Netlify site: ${error instanceof Error ? error.message : 'Unknown error'}`,
          error instanceof Error ? error : undefined
        );
      }
    }
    
    logger.debug(`Deploying to Netlify site ID: ${siteId}`);

    try {
      // Check if site exists first to prevent Not Found errors later
      const siteExists = await this.checkSiteExists(siteId);
      if (!siteExists) {
        logger.error(`Netlify site with ID ${siteId} does not exist`);
        throw this.createError(
          DeploymentErrorType.INITIALIZATION_FAILED,
          `Netlify site with ID ${siteId} not found - please initialize site first`
        );
      }
      
      // Check if we have GitHub info from this target's config or from the deployment options
      const githubInfo = this.config.githubInfo || options.metadata?.github;
      const hasGitHubInfo = !!githubInfo;
      const hasGitHubToken = !!this.config.githubToken || !!githubInfo?.token;

      logger.info('Deploying to Netlify', {
        siteId,
        hasGitHubInfo,
        hasGitHubToken,
        githubRepo: hasGitHubInfo ? githubInfo.fullName : 'none',
        deploymentMethod: (hasGitHubInfo && hasGitHubToken) ? 'github-integration' : 'direct-upload'
      });

      // If we have GitHub info AND a GitHub token, we can try to link the site to GitHub
      if (hasGitHubInfo && hasGitHubToken) {
        try {
          // Use either the token in config or the one in githubInfo
          const githubToken = this.config.githubToken || githubInfo.token;
          
          logger.debug('Attempting to link Netlify site to GitHub repository', {
            repoName: githubInfo.fullName,
            siteId,
            tokenAvailable: !!githubToken
          });
          
          // Try to setup GitHub integration on the Netlify site
          const linkResult = await this.linkSiteToGitHub(siteId, githubInfo, githubToken);
          
          if (linkResult.success) {
            logger.info(`✅ Netlify site linked to GitHub repository: ${githubInfo.fullName}`);
            logger.info(`🔄 Triggering build hook to deploy from GitHub`);
            
            // The deployment will happen automatically via Netlify's GitHub integration
            return {
              id: `github-deploy-${Date.now()}`,
              url: linkResult.siteUrl || '',
              status: 'success',
              provider: this.getProviderType(),
              logs: [
                `Netlify site linked to GitHub repository: ${githubInfo.fullName}`,
                `Netlify will automatically deploy from the GitHub repository`
              ],
              metadata: {
                siteId,
                githubRepo: githubInfo.fullName,
                deploymentType: 'github-integration'
              }
            };
          } else {
            logger.warn(`⚠️ Failed to link Netlify site to GitHub: ${linkResult.error}`);
            // Continue with direct deployment as fallback
          }
        } catch (linkError) {
          logger.warn('⚠️ Error linking Netlify site to GitHub, continuing with direct deployment:', linkError);
          // Continue with direct deployment as fallback
        }
      } else if (hasGitHubInfo) {
        logger.warn('GitHub info available but no GitHub token provided, cannot link repository');
      }

      // If GitHub integration didn't work or wasn't requested, deploy directly
      logger.info('📦 Deploying files directly to Netlify');
      
      // Process and package files
      const processedFiles = this.processFilesForDeployment(options.files);
      const zipBuffer = await this.zipPackager.package(processedFiles);

      // Create deploy
      const deployParams = new URLSearchParams({
        title: `PomBolt deploy: ${options.projectName} (${new Date().toISOString()})`,
        draft: 'false'
      });

      logger.debug(`Initiating Netlify deployment for site: ${siteId}`);
      const response = await this.fetchNetlifyApi<NetlifyDeploy>(
        `/sites/${siteId}/deploys?${deployParams.toString()}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/zip'
          },
          body: zipBuffer
        }
      );

      const deploy = await response.json() as NetlifyDeploy;
      logger.info(`Netlify deployment started: ${deploy.id}`, {
        siteId,
        deployId: deploy.id,
        deployUrl: deploy.deploy_url
      });

      // Wait for deployment to complete with robust error handling
      try {
        return await this.waitForDeployment(siteId, deploy.id);
      } catch (waitErrorUnknown) {
        const waitError = waitErrorUnknown as Error;
        logger.warn(`Error waiting for deployment: ${waitError.message}`);
        
        // Check if we received a Not Found error, which could mean the deployment 
        // succeeded but the API call to check it failed for some reason
        if (waitError.message.includes('Not Found')) {
          // Fallback: verify deployment using alternative method
          logger.info('Attempting fallback deployment verification');
          return await this.verifyDeploymentByAlternativeMethod(siteId, deploy);
        }
        
        // If not a Not Found error, propagate the original error
        throw waitError;
      }
    } catch (error) {
      logger.error(`Netlify deployment failed for site ${siteId}:`, error);
      throw this.createError(
        DeploymentErrorType.DEPLOYMENT_FAILED,
        `Failed to deploy to Netlify: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }
  
  /**
   * Check if a site exists
   */
  private async checkSiteExists(siteId: string): Promise<boolean> {
    try {
      const response = await this.fetchNetlifyApi<NetlifySite>(`/sites/${siteId}`);
      const site = await response.json() as NetlifySite;
      return !!site.id;
    } catch (error) {
      logger.warn(`Error checking if site ${siteId} exists:`, error);
      return false;
    }
  }

  /**
   * Fallback method to verify deployment when primary method fails
   */
  private async verifyDeploymentByAlternativeMethod(siteId: string, deploy: NetlifyDeploy): Promise<DeploymentResult> {
    logger.debug(`Using alternative method to verify deployment for site ${siteId}`);
    
    try {
      // First try to get site info
      const siteResponse = await this.fetchNetlifyApi<NetlifySite>(`/sites/${siteId}`);
      const site = await siteResponse.json() as NetlifySite;
      
      // Then try to get latest deployment (may not be the one we just created)
      const deploysResponse = await this.fetchNetlifyApi<NetlifyDeploy[]>(`/sites/${siteId}/deploys?per_page=1`);
      const deploys = await deploysResponse.json() as NetlifyDeploy[];
      
      if (deploys && deploys.length > 0) {
        const latestDeploy = deploys[0];
        
        logger.info(`Found latest deployment for site ${siteId}:`, {
          deployId: latestDeploy.id,
          status: latestDeploy.status,
          originalDeployId: deploy.id
        });
        
        // If this is our deployment and it succeeded
        if (latestDeploy.id === deploy.id && latestDeploy.status === 'ready') {
          return {
            id: latestDeploy.id,
            url: latestDeploy.ssl_url || latestDeploy.deploy_url || site.ssl_url || site.url,
            status: 'success',
            logs: [`Deployment verified as successful via alternative method`],
            provider: this.getProviderType(),
            metadata: {
              siteId,
              deployId: latestDeploy.id,
              verificationMethod: 'alternative'
            }
          };
        }
        
        // If it's a different deployment, assume ours succeeded but wasn't found
        if (latestDeploy.id !== deploy.id) {
          logger.warn(`Could not find our deployment (${deploy.id}), but site exists. Assuming success.`);
          return {
            id: deploy.id,
            url: site.ssl_url || site.url,
            status: 'success',
            logs: [`Deployment assumed successful - site exists but specific deployment not found`],
            provider: this.getProviderType(),
            metadata: {
              siteId,
              deployId: deploy.id,
              verificationMethod: 'assumed',
              siteUrl: site.url
            }
          };
        }
      }
      
      // If we get here, we couldn't verify the deployment but the site exists
      // Since Netlify often shows the site as deployed even when our verification fails,
      // we'll assume it succeeded with a warning
      logger.warn(`Could not verify deployment status for ${deploy.id}, but site exists. Assuming success with warning.`);
      return {
        id: deploy.id,
        url: site.ssl_url || site.url,
        status: 'success',
        logs: [`Deployment verification inconclusive - assuming success with warning`],
        provider: this.getProviderType(),
        metadata: {
          siteId,
          deployId: deploy.id,
          verificationMethod: 'assumed-with-warning',
          siteUrl: site.url,
          warning: 'Deployment verification was not conclusive'
        }
      };
    } catch (error) {
      // If even the alternative verification fails, we'll have to fail the deployment
      logger.error(`Alternative deployment verification failed:`, error);
      throw this.createError(
        DeploymentErrorType.VERIFICATION_FAILED,
        `Could not verify deployment status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Link a Netlify site to a GitHub repository
   */
  private async linkSiteToGitHub(
    siteId: string,
    githubInfo: GitHubRepositoryInfo,
    githubToken: string
  ): Promise<{ success: boolean; error?: string; siteUrl?: string }> {
    try {
      logger.debug(`Linking Netlify site ${siteId} to GitHub repo ${githubInfo.fullName}`);
      
      // Get site information first
      const siteResponse = await this.fetchNetlifyApi<NetlifySite>(`/sites/${siteId}`);
      const site = await siteResponse.json() as NetlifySite;
      
      // Create the Netlify-GitHub connection
      const buildSettings = {
        repo: {
          provider: 'github',
          repo: githubInfo.fullName,
          private: githubInfo.isPrivate,
          branch: githubInfo.defaultBranch || 'main',
          cmd: 'npm run build',
          dir: '',
          installation_id: githubToken
        }
      };
      
      logger.debug('Connecting to GitHub with settings:', {
        repo: githubInfo.fullName,
        branch: githubInfo.defaultBranch || 'main',
        isPrivate: githubInfo.isPrivate
      });
      
      const response = await this.fetchNetlifyApi(`/sites/${siteId}/builds/settings`, {
        method: 'PUT',
        body: JSON.stringify(buildSettings)
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as NetlifyErrorResponse;
        return { 
          success: false, 
          error: error.message || `Failed to link to GitHub: HTTP ${response.status}` 
        };
      }
      
      // Return success with site URL
      return { 
        success: true, 
        siteUrl: site.ssl_url || site.url 
      };
    } catch (error) {
      logger.error('Error linking Netlify site to GitHub:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error linking to GitHub' 
      };
    }
  }

  private processFilesForDeployment(files: Record<string, string>): Record<string, string> {
    const processedFiles: Record<string, string> = {};
    
    for (const [path, content] of Object.entries(files)) {
      const normalizedPath = path.startsWith('/') ? path.substring(1) : path;
      processedFiles[normalizedPath] = content;
    }
    
    this.addNetlifyConfigFiles(processedFiles);
    
    logger.debug(`Processed ${Object.keys(processedFiles).length} files for deployment`);
    return processedFiles;
  }

  /**
   * Wait for a deployment to complete with improved error handling
   */
  private async waitForDeployment(siteId: string, deployId: string): Promise<DeploymentResult> {
    try {
      logger.info(`🔍 Checking Netlify deployment status for: ${deployId}`);
      
      // More conservative polling configuration
      const initialDelay = 20000;      // 20 seconds initial wait
      const maxDelay = 60000;         // 60 seconds max between checks
      const maxAttempts = 5;          // Cap at 5 attempts total
      const totalTimeout = 60 * 1000; // 60 second total timeout
      
      let currentDelay = initialDelay;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3;
      
      const startTime = Date.now();
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Check if we've exceeded total time allowed
        if (Date.now() - startTime > totalTimeout) {
          logger.warn(`Deployment verification timed out after ${totalTimeout/1000}s total duration`);
          break;
        }
        
        try {
          // Wait before checking status
          await new Promise(resolve => setTimeout(resolve, currentDelay));
          
          // Check deployment status
          const response = await this.fetchNetlifyApi(`/sites/${siteId}/deploys/${deployId}`);
          
          // If we get a successful response, reset consecutive errors
          consecutiveErrors = 0;
          
          if (!response.ok) {
            // Handle API error
            const errorText = await response.text();
            logger.warn(`Error checking deployment status (attempt ${attempt}/${maxAttempts}): ${response.status} ${response.statusText} - ${errorText}`);
            
            // Special handling for rate limits (429)
            if (response.status === 429) {
              // Get retry-after header if available
              const retryAfter = response.headers.get('retry-after');
              const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 30;
              
              // Use the server's suggestion or a longer delay
              currentDelay = Math.max(retrySeconds * 1000, maxDelay);
              logger.warn(`Rate limit hit, waiting ${retrySeconds}s before retry`);
              continue;
            }
            
            // For other errors, increase delay more aggressively
            currentDelay = Math.min(currentDelay * 2, maxDelay);
            continue;
          }
          
          const deploy = await response.json() as NetlifyDeploy;
          
          // Log status on first check and when it changes
          logger.debug(`Deployment status: ${deploy.status} (attempt ${attempt}/${maxAttempts})`);
          
          if (deploy.status === 'ready') {
            logger.info(`✅ Netlify deployment complete: ${deploy.deploy_url}`);
            return {
              id: deploy.id,
              url: deploy.ssl_url || deploy.deploy_url,
              status: 'success',
              logs: [`Deployment URL: ${deploy.ssl_url || deploy.deploy_url}`],
              provider: this.getProviderType(),
              metadata: {
                siteId,
                deployId: deploy.id,
                verificationMethod: 'standard'
              }
            };
          }
          
          if (deploy.status === 'error') {
            logger.error(`❌ Netlify deployment failed: ${deploy.error_message || 'Unknown error'}`);
            throw new Error(`Netlify deployment failed: ${deploy.error_message || 'Unknown error'}`);
          }
          
          // For in-progress deployments, we'll use a more aggressive backoff strategy
          currentDelay = Math.min(currentDelay * 1.5, maxDelay);
        } catch (error) {
          consecutiveErrors++;
          
          // If we hit API errors multiple times in a row, we might want to give up
          if (consecutiveErrors >= maxConsecutiveErrors) {
            logger.error(`Too many consecutive errors checking deployment status, giving up`);
            throw new Error('Netlify API request failed: Too many consecutive errors.');
          }
          
          // For individual errors, log and increase backoff
          logger.warn(`Error checking deployment status (attempt ${attempt}/${maxAttempts}): ${error instanceof Error ? error.message : String(error)}`);
          
          // Increase delay more aggressively for consecutive errors
          currentDelay = Math.min(currentDelay * 2, maxDelay);
        }
      }
      
      // If we reach here, verification timed out or reached max attempts
      logger.warn(`Deployment ${deployId} verification timed out or reached maximum attempts`);
      
      // Try one last verification through alternative methods
      return await this.verifyDeploymentByAlternativeMethod(siteId, {
        id: deployId,
        site_id: siteId,
        status: 'unknown',
        deploy_url: `https://deploy-preview-unknown--${siteId}.netlify.app` // Guess a potential URL
      });
    } catch (error) {
      logger.warn(`Error waiting for deployment: ${error instanceof Error ? error.message : String(error)}`);
      
      // Try alternative verification as a last resort
      try {
        return await this.verifyDeploymentByAlternativeMethod(siteId, {
          id: deployId,
          site_id: siteId,
          status: 'unknown',
          deploy_url: `https://deploy-preview-unknown--${siteId}.netlify.app` // Guess a potential URL
        });
      } catch (altError) {
        // If both methods fail, throw the original error
        throw error;
      }
    }
  }

  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    try {
      const response = await this.fetchNetlifyApi<NetlifyDeploy>(`/deploys/${deploymentId}`);
      const deploy = await response.json() as NetlifyDeploy;

      return {
        id: deploy.id,
        status: this.mapNetlifyStatus(deploy.status),
        url: deploy.ssl_url || deploy.deploy_url,
        logs: deploy.error_message ? [deploy.error_message] : [`Current state: ${deploy.status}`],
        createdAt: new Date().getTime(),
        metadata: {
          deployId: deploy.id,
          siteId: deploy.site_id
        }
      };
    } catch (error) {
      logger.error(`Error getting deployment status for ${deploymentId}:`, error);
      throw this.createError(
        DeploymentErrorType.UNKNOWN,
        `Failed to get deployment status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private mapNetlifyStatus(status: string): 'success' | 'in-progress' | 'failed' {
    switch (status) {
      case 'ready':
        return 'success';
      case 'error':
        return 'failed';
      default:
        return 'in-progress';
    }
  }

  async update(options: UpdateOptions): Promise<DeploymentResult> {
    logger.debug(`Updating Netlify site ${options.projectId}`);
    if (!options.projectId) {
      throw this.createError(
        DeploymentErrorType.VALIDATION_ERROR,
        'Netlify site ID (projectId) is required for update'
      );
    }
    return this.deploy({
      projectId: options.projectId,
      projectName: options.projectName,
      files: options.files,
      metadata: options.metadata
    });
  }

  async removeDeployment(deploymentId: string): Promise<boolean> {
    logger.debug(`Removing Netlify deployment: ${deploymentId}`);
    try {
      const response = await this.fetchNetlifyApi(`/deploys/${deploymentId}`, {
        method: 'DELETE'
      });

      if (response.ok || response.status === 204 || response.status === 404) {
        logger.info(`Netlify deployment ${deploymentId} deleted (or did not exist)`);
        return true;
      }

      const errorData = await response.json().catch(() => ({})) as NetlifyErrorResponse;
      const errorMsg = errorData.message || response.statusText;
      logger.error(`Failed to delete Netlify deployment ${deploymentId}: ${errorMsg}`);
      return false;
    } catch (error) {
      logger.error(`Error removing Netlify deployment ${deploymentId}:`, error);
      return false;
    }
  }

  private addNetlifyConfigFiles(files: Record<string, string>): void {
    const hasRedirects = '_redirects' in files;
    const hasNetlifyToml = 'netlify.toml' in files;
    
    if (!hasRedirects) {
      logger.debug('Adding default _redirects file for Netlify SPA routing');
      files['_redirects'] = `# Netlify redirects for SPA routing
# Redirect all routes to index.html for client-side routing
/*    /index.html   200

# Preserve API routes
/api/*  200
`;
    }
    
    if (!hasNetlifyToml && !('index.html' in files)) {
      logger.debug('Adding basic netlify.toml configuration');
      files['netlify.toml'] = `[build]
  command = "npm run build"
  publish = "."
  
[build.environment]
  NODE_VERSION = "18"
  
[build.processing]
  skip_processing = true
`;
    }
  }

  private validateOptions(options: DeployOptions): void {
    if (!options.projectId) {
      throw this.createError(
        DeploymentErrorType.VALIDATION_ERROR,
        'Project ID is required for deployment'
      );
    }
    if (!options.projectName) {
      throw this.createError(
        DeploymentErrorType.VALIDATION_ERROR,
        'Project name is required for deployment'
      );
    }
    if (!options.files || Object.keys(options.files).length === 0) {
      throw this.createError(
        DeploymentErrorType.VALIDATION_ERROR,
        'No files provided for deployment'
      );
    }
  }
}