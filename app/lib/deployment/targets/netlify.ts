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

const logger = createScopedLogger('netlify-target');
const NETLIFY_API_BASE = 'https://api.netlify.com/api/v1';

interface NetlifyConfig {
  apiToken: string;
}

// Netlify API response types (simplified)
interface NetlifySite {
  id: string;
  name: string;
  account_slug?: string; // Useful for checking ownership if needed
  default_domain?: string;
  url?: string;
  ssl_url?: string;
  build_settings?: {
    repo_url?: string;
  };
  [key: string]: any;
}

interface NetlifyDeploy {
  id: string;
  site_id: string;
  state: 'error' | 'building' | 'ready' | 'current' | 'failed' | 'cancelled';
  name?: string;
  url?: string;
  ssl_url?: string;
  deploy_url?: string;
  deploy_ssl_url?: string;
  created_at?: string;
  updated_at?: string;
  error_message?: string;
  required?: string[]; // Files needed for upload (used in initial response)
  [key: string]: any;
}

interface NetlifyUser {
  id: string;
  email: string;
  full_name?: string;
  [key: string]: any;
}

// Type for error responses from Netlify API
interface NetlifyErrorResponse {
    code?: number;
    message?: string;
    errors?: Record<string, any>;
}

/**
 * Deployment target for Netlify
 */
export class NetlifyTarget extends BaseDeploymentTarget {
  private config: NetlifyConfig;
  private zipPackager: ZipPackager;
  private netlifyApiBase = NETLIFY_API_BASE; // Allow overriding for testing if needed

  constructor(config: NetlifyConfig) {
    super();
    this.config = config;
    this.zipPackager = new ZipPackager();
    logger.info('NetlifyTarget initialized');
  }

  getName(): string {
    return 'netlify';
  }

  getProviderType(): string {
    return 'netlify';
  }

  private async fetchNetlifyApi(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.netlifyApiBase}${endpoint}`;
    // Explicitly type headers for modification
    const headers: Record<string, string> = {
      ...this.getHeaders(),
      ...(options.headers as Record<string, string> || {}),
    };

    // Adjust Content-Type based on method and body type
    const method = options.method?.toUpperCase() || 'GET';
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
       if (!(options.body instanceof FormData || options.body instanceof Blob || options.body instanceof ArrayBuffer || options.body instanceof URLSearchParams)) {
         // Default to JSON if not a specific binary/form type
         if (!headers['Content-Type']) { 
             headers['Content-Type'] = 'application/json';
         }
       } else {
          // Let fetch handle Content-Type for binary/form types
          delete headers['Content-Type'];
       }
    } else {
       // No Content-Type needed for GET, DELETE, HEAD, OPTIONS
       delete headers['Content-Type'];
    }

    logger.debug(`Fetching Netlify API: ${method} ${url}`);
    return fetch(url, {
      ...options,
      method: method,
      headers,
    });
  }

  async isAvailable(): Promise<boolean> {
    logger.debug('Checking Netlify availability...');
    if (!this.config.apiToken) {
      logger.warn('Netlify API token is missing.');
      return false;
    }
    try {
      const response = await this.fetchNetlifyApi('/user');
      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`Netlify API token validation failed: ${response.status} - ${errorText}`);
        return false;
      }
      const user = await response.json() as NetlifyUser;
      logger.info(`Netlify API token validated successfully for user: ${user.email}`);
      return true;
    } catch (error) {
      logger.error('Error checking Netlify availability:', error);
      return false;
    }
  }

  private async findSiteByName(sanitizedName: string): Promise<NetlifySite | null> {
    try {
      // Netlify API filter by name isn't exact, so we fetch and filter manually.
      // Paginate if necessary, though unlikely for typical use case.
      const response = await this.fetchNetlifyApi(`/sites?filter=all&per_page=100`); // Fetch up to 100 sites
      if (!response.ok) {
        logger.warn(`Failed to list Netlify sites: ${response.status}`);
        return null;
      }
      const sites: NetlifySite[] = await response.json();
      const foundSite = sites.find(site => site.name === sanitizedName);
      if (foundSite) {
        logger.debug(`Found matching site: ${foundSite.name} (ID: ${foundSite.id})`);
        return foundSite;
      } else {
        logger.debug(`No site found with name: ${sanitizedName}`);
        return null;
      }
    } catch (error) {
      logger.error('Error listing Netlify sites:', error);
      return null;
    }
  }

  async projectExists(projectName: string): Promise<boolean> {
    const sanitizedName = this.sanitizeProjectName(projectName);
    logger.debug(`Checking if Netlify project exists: ${sanitizedName}`);
    const site = await this.findSiteByName(sanitizedName);
    return !!site;
  }

  async initializeProject(options: ProjectOptions): Promise<ProjectMetadata> {
    // Netlify site names must be unique globally. We use the sanitized pom-bolt project name.
    // If it's taken, we might need a strategy to append a unique identifier.
    const sanitizedName = this.sanitizeProjectName(options.name);
    logger.debug(`Initializing Netlify project: ${sanitizedName}`);

    try {
      let site = await this.findSiteByName(sanitizedName);

      if (site) {
        logger.info(`Using existing Netlify site: ${site.name} (ID: ${site.id})`);
      } else {
        logger.info(`Creating new Netlify site: ${sanitizedName}`);
        const createResponse = await this.fetchNetlifyApi('/sites', {
          method: 'POST',
          body: JSON.stringify({ name: sanitizedName }), // Create site with just a name
        });

        if (!createResponse.ok) {
          let errorMsg = createResponse.statusText;
          try {
            // Use type assertion for error data
            const errorData = await createResponse.json() as NetlifyErrorResponse;
            errorMsg = errorData.message || errorMsg;
             // Handle specific case where name is taken
             if (createResponse.status === 422 && errorMsg.includes("name already exists")) {
                 // TODO: Implement a retry strategy with a modified name (e.g., append random suffix)
                 logger.error(`Netlify site name "${sanitizedName}" is already taken. Implement retry logic.`);
                 throw new Error(`Netlify site name "${sanitizedName}" is already taken.`);
             }
          } catch (parseError) { /* Ignore if response body isn't JSON */ }
          throw new Error(`Failed to create Netlify site: ${errorMsg}`);
        }
        site = await createResponse.json() as NetlifySite;
        logger.info(`Successfully created Netlify site: ${site.name} (ID: ${site.id})`);
      }

      // Use ssl_url if available, otherwise fallback
      const siteUrl = site.ssl_url || site.url || `https://${site.name}.netlify.app`;

      return {
        id: site.id, // Use Netlify's site ID
        name: site.name,
        url: siteUrl,
        provider: this.getProviderType(),
        metadata: {
          siteId: site.id,
          defaultDomain: site.default_domain,
        },
      };
    } catch (error) {
      logger.error(`Failed to initialize Netlify project ${sanitizedName}:`, error);
      throw this.createError(
        DeploymentErrorType.INITIALIZATION_FAILED,
        `Failed to initialize Netlify project: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async deploy(options: DeployOptions): Promise<DeploymentResult> {
    const siteId = options.projectId; // Should be the Netlify site_id
    if (!siteId) {
      // Use UNKNOWN as replacement for INVALID_OPTIONS
      throw this.createError(DeploymentErrorType.UNKNOWN, 'Netlify site ID (projectId) is required for deployment.');
    }
    logger.debug(`Deploying to Netlify site ID: ${siteId}`);

    try {
      logger.debug(`Packaging ${Object.keys(options.files).length} files for Netlify deployment`);
      
      // Ensure we have a proper publish directory structure - Netlify expects this
      const processedFiles: Record<string, string> = {};
      
      // Create a proper file structure for Netlify with files in the publish directory
      for (const [path, content] of Object.entries(options.files)) {
        // Remove leading slashes to avoid absolute paths
        const normalizedPath = path.startsWith('/') ? path.substring(1) : path;
        processedFiles[normalizedPath] = content;
      }
      
      // Add Netlify-specific configuration files if needed
      this.addNetlifyConfigFiles(processedFiles);
      
      // Log the file structure we're sending
      logger.debug(`File structure for Netlify deployment:`, {
        fileCount: Object.keys(processedFiles).length,
        sampleFiles: Object.keys(processedFiles).slice(0, 5)
      });
      
      // Package the files with the ZipPackager
      const zipBuffer = await this.zipPackager.package(processedFiles);
      
      // Create deploy options for Netlify (title, draft mode, etc.)
      const deployParams = new URLSearchParams();
      // Add a title to make the deployment easier to identify
      deployParams.append('title', `PomBolt deploy: ${options.projectName || 'project'} (${new Date().toISOString()})`);
      // Set to production by default
      deployParams.append('draft', 'false');
      
      // Log the URL with parameters for debugging
      const deployUrl = `/sites/${siteId}/deploys?${deployParams.toString()}`;
      logger.debug(`Uploading ${zipBuffer.byteLength} bytes to Netlify: ${this.netlifyApiBase}${deployUrl}`);
      
      // Convert ArrayBuffer to Blob for upload - this is important for browser compatibility
      const zipBlob = new Blob([zipBuffer], { type: 'application/zip' });
      
      const deployResponse = await this.fetchNetlifyApi(deployUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' }, // Important: Set correct content type for ZIP
        body: zipBlob,  // Use the Blob for better compatibility
      });

      if (!deployResponse.ok) {
        let errorMsg = deployResponse.statusText;
        try {
          // Try to get detailed error information
          const errorText = await deployResponse.text();
          logger.error(`Netlify deployment error response: ${errorText}`);
          
          try {
            // Use type assertion for error data if it's JSON
            const errorData = JSON.parse(errorText) as NetlifyErrorResponse;
            errorMsg = errorData.message || errorMsg;
          } catch(e) { 
            // If not JSON, use the text directly
            errorMsg = errorText || errorMsg;
          }
        } catch(e) { /* ignore */ }
        
        throw new Error(`Failed to create Netlify deployment: ${errorMsg}`);
      }

      const deploy: NetlifyDeploy = await deployResponse.json();
      const deployId = deploy.id;
      logger.info(`Netlify deployment created: ${deployId}, initial state: ${deploy.state}`);

      // Don't wait if initial state indicates immediate failure
      if (deploy.state === 'error' || deploy.state === 'failed') {
          logger.error(`Netlify deployment ${deployId} failed immediately: ${deploy.error_message}`);
          return {
              id: deployId,
              url: deploy.deploy_ssl_url || deploy.deploy_url || 'URL N/A',
              status: 'failed',
              logs: [deploy.error_message || 'Deployment failed immediately'],
              provider: this.getProviderType(),
              metadata: { siteId, netlifyDeployId: deployId },
          };
      }

      logger.info(`Waiting for Netlify deployment ${deployId} to complete...`);
      const finalDeploy = await this.waitForDeployment(siteId, deployId);

      const deploymentUrl = finalDeploy.deploy_ssl_url || finalDeploy.deploy_url || `https://${siteId}.netlify.app`;
      const status = this.mapNetlifyStatus(finalDeploy.state);
      const logs = (status === 'failed' && finalDeploy.error_message) ? [finalDeploy.error_message] : [`Deployment state: ${finalDeploy.state}`];

      if (status === 'failed') {
         logger.error(`Netlify deployment ${deployId} failed: ${logs[0]}`);
      } else {
         logger.info(`Netlify deployment ${deployId} finished successfully. URL: ${deploymentUrl}`);
      }

      return {
        id: deployId,
        url: deploymentUrl,
        status: status,
        logs: logs,
        provider: this.getProviderType(),
        metadata: {
          siteId: siteId,
          netlifyDeployId: deployId,
          projectName: options.projectName,
          netlifySiteName: finalDeploy.name,
        },
      };
    } catch (error) {
      logger.error(`Netlify deployment failed for site ${siteId}:`, error);
      throw this.createError(
        DeploymentErrorType.DEPLOYMENT_FAILED,
        `Failed to deploy to Netlify: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private async waitForDeployment(siteId: string, deployId: string): Promise<NetlifyDeploy> {
    const maxAttempts = 60; // Increase to ~3 minutes
    const delay = 10000; // 10 seconds delay (increased from 3000)
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      const pollingUrl = `/sites/${siteId}/deploys/${deployId}`;
      logger.debug(`Polling Netlify deployment ${deployId} (Attempt ${attempts}/${maxAttempts}) - URL: ${this.netlifyApiBase}${pollingUrl}`); // Log full URL
      try {
        const response = await this.fetchNetlifyApi(pollingUrl);

        if (!response.ok) {
          const errorText = await response.text(); // Get text for logging
          if (response.status === 404) {
            logger.warn(`Polling ${deployId}: Target deployment not found (404). Assuming cancelled/deleted. Response: ${errorText}`);
            return { id: deployId, site_id: siteId, state: 'cancelled', error_message: 'Deployment disappeared during polling.' };
          }
          logger.warn(`Polling ${deployId} (attempt ${attempts}): HTTP error ${response.status}. Response: ${errorText}`);
          if (attempts > 5) { 
            logger.error(`Giving up polling for ${deployId} after ${attempts} attempts due to persistent HTTP errors.`);
            throw new Error(`Persistent errors fetching deployment status: ${response.status} ${response.statusText}`);
          }
        } else {
          const deploy: NetlifyDeploy = await response.json();
          logger.debug(`Polling ${deployId} (attempt ${attempts}): State is ${deploy.state}`);
          if (deploy.state === 'ready' || deploy.state === 'current') {
            logger.info(`Netlify deployment ${deployId} finished with state: ${deploy.state}`);
            return deploy;
          }
          if (deploy.state === 'error' || deploy.state === 'failed' || deploy.state === 'cancelled') {
            logger.warn(`Netlify deployment ${deployId} finished with failure state: ${deploy.state}`);
            return deploy;
          }
          // Reset consecutive error count if response is ok but not finished
        }
        // Wait before trying again
        await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error) {
         // Catch fetch/network errors
         logger.error(`Polling ${deployId} (attempt ${attempts}): Network/Fetch error:`, error);
         if (attempts > 5) { 
            logger.error(`Giving up polling for ${deployId} after ${attempts} attempts due to persistent network/fetch errors.`);
            throw new Error(`Persistent network/fetch errors fetching deployment status`);
         }
         // Wait even if there was a network error
         await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    logger.warn(`Netlify deployment ${deployId} status check timed out after ${maxAttempts} attempts.`);
    try {
       const finalResponse = await this.fetchNetlifyApi(`/sites/${siteId}/deploys/${deployId}`);
       if (finalResponse.ok) {
         // Use type assertion here as well
         const finalDeploy = await finalResponse.json() as NetlifyDeploy; 
         logger.warn(`Deployment ${deployId} timed out, returning last known state: ${finalDeploy.state}`);
         return finalDeploy;
       }
    } catch(finalError) {
       logger.error("Error fetching final deployment state after timeout", finalError);
    }
     // Return a synthetic 'failed' state after timeout if last fetch fails
     // Ensure the returned object matches the NetlifyDeploy interface
     return { 
       id: deployId, 
       site_id: siteId, 
       state: 'error', 
       error_message: 'Deployment status check timed out' 
     } as NetlifyDeploy; // Assert type here for the fallback object
  }

   private mapNetlifyStatus(netlifyState: NetlifyDeploy['state']): 'success' | 'failed' | 'in-progress' {
    switch (netlifyState) {
      case 'ready':
      case 'current':
        return 'success';
      case 'error':
      case 'failed':
      case 'cancelled':
        return 'failed';
      case 'building':
      default:
        return 'in-progress';
    }
  }

  async update(options: UpdateOptions): Promise<DeploymentResult> {
    logger.debug(`Updating Netlify site ${options.projectId} via new deployment.`);
    if (!options.projectId) {
       // Use UNKNOWN as replacement for INVALID_OPTIONS
       throw this.createError(DeploymentErrorType.UNKNOWN, 'Netlify site ID (projectId) is required for update.');
    }
    // An update is just a new deployment on Netlify
    return this.deploy({
        projectId: options.projectId,
        projectName: options.projectName, // Pass name for metadata if available
        files: options.files,
        metadata: options.metadata
    });
  }

  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    // This ID should be the Netlify deploy ID
    logger.debug(`Getting Netlify deployment status for: ${deploymentId}`);
    try {
      // This endpoint works with just the deploy_id
      const response = await this.fetchNetlifyApi(`/deploys/${deploymentId}`);

      if (!response.ok) {
         let errorMsg = response.statusText;
         if (response.status === 404) errorMsg = 'Deployment not found';
         // Use type assertion for error data
         try { const errorData = await response.json() as NetlifyErrorResponse; errorMsg = errorData.message || errorMsg; } catch(e) {}
         throw new Error(errorMsg);
      }

      const deploy: NetlifyDeploy = await response.json();
      const status = this.mapNetlifyStatus(deploy.state);
      // Prefer deploy_ssl_url (permalink), fallback to ssl_url (site), then url
      const url = deploy.deploy_ssl_url || deploy.ssl_url || deploy.url || 'URL not available';

      return {
        id: deploy.id,
        url: url,
        status: status,
        logs: deploy.error_message ? [deploy.error_message] : [`Current state: ${deploy.state}`],
        // Provide 0 as fallback if createdAt is undefined
        createdAt: deploy.created_at ? new Date(deploy.created_at).getTime() : 0,
        completedAt: (status === 'success' || status === 'failed') && deploy.updated_at ? new Date(deploy.updated_at).getTime() : undefined,
        metadata: {
          siteId: deploy.site_id,
          netlifyState: deploy.state
        }
      };
    } catch (error) {
      logger.error(`Failed to get Netlify deployment status for ${deploymentId}:`, error);
      throw this.createError(
        // Use UNKNOWN as replacement for STATUS_CHECK_FAILED
        DeploymentErrorType.UNKNOWN, 
        `Failed to get Netlify deployment status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async removeDeployment(deploymentId: string): Promise<boolean> {
    // This ID should be the Netlify deploy ID
    logger.debug(`Removing Netlify deployment: ${deploymentId}`);
    try {
      const response = await this.fetchNetlifyApi(`/deploys/${deploymentId}`, {
        method: 'DELETE',
      });

      // Success is 204 No Content, but we also treat 404 Not Found as success (already deleted)
      if (response.ok || response.status === 204 || response.status === 404) {
           logger.info(`Netlify deployment ${deploymentId} deleted (or did not exist)`);
           return true;
      } else {
          let errorMsg = response.statusText;
          // Use type assertion for error data
          try { const errorData = await response.json() as NetlifyErrorResponse; errorMsg = errorData.message || errorMsg; } catch(e) {}
          logger.error(`Failed to delete Netlify deployment ${deploymentId}: ${errorMsg}`);
          return false;
      }
    } catch (error) {
      logger.error(`Error removing Netlify deployment ${deploymentId}:`, error);
      return false;
    }
  }

  private getHeaders(): Record<string, string> {
    // Base headers, Content-Type might be overridden by fetchNetlifyApi
    return {
      Authorization: `Bearer ${this.config.apiToken}`,
      // Content-Type is handled dynamically in fetchNetlifyApi
    };
  }

  /**
   * Add Netlify-specific configuration files when needed
   * This ensures the deployment will work properly
   */
  private addNetlifyConfigFiles(files: Record<string, string>): void {
    // Check if we already have configuration files
    const hasRedirects = '_redirects' in files;
    const hasNetlifyToml = 'netlify.toml' in files;
    
    // Add _redirects file if it doesn't exist
    // This ensures SPA routing works properly
    if (!hasRedirects) {
      logger.debug('Adding default _redirects file for Netlify SPA routing');
      files['_redirects'] = `# Netlify redirects for SPA routing
# Redirect all routes to index.html for client-side routing
/*    /index.html   200

# Preserve API routes
/api/*  200
`;
    }
    
    // Add netlify.toml if it doesn't exist
    if (!hasNetlifyToml && !('index.html' in files)) {
      // Only add this for non-standard deployments that don't have an index.html
      logger.debug('Adding basic netlify.toml configuration');
      files['netlify.toml'] = `[build]
  # Auto-detect build command
  command = "npm run build"
  publish = "."
  
[build.environment]
  NODE_VERSION = "18"
  
# Prevent Netlify from running the build command for direct deploys
[build.processing]
  skip_processing = true
`;
    }
  }
} 