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
    if (!config.apiToken) {
      throw new Error('Netlify API token is required');
    }
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

  /**
   * Make a request to the Netlify API with proper error handling
   */
  private async fetchNetlifyApi<T>(path: string, options: RequestInit = {}): Promise<Response> {
    try {
      const response = await fetch(`${NETLIFY_API_BASE}${path}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { message?: string };
        throw this.createError(
          DeploymentErrorType.API_ERROR,
          `Netlify API error: ${errorData.message || response.statusText}`
        );
      }

      return response;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === DeploymentErrorType.API_ERROR) {
        throw error;
      }
      throw this.createError(
        DeploymentErrorType.API_ERROR,
        `Netlify API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    logger.debug('Checking Netlify availability...');
    if (!this.config.apiToken) {
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

    const siteId = options.projectId;
    logger.debug(`Deploying to Netlify site ID: ${siteId}`);

    try {
      // Process and package files
      const processedFiles = this.processFilesForDeployment(options.files);
      const zipBuffer = await this.zipPackager.package(processedFiles);

      // Create deploy
      const deployParams = new URLSearchParams({
        title: `PomBolt deploy: ${options.projectName} (${new Date().toISOString()})`,
        draft: 'false'
      });

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
      logger.info(`Netlify deployment started: ${deploy.id}`);

      // Wait for deployment to complete
      return this.waitForDeployment(siteId, deploy.id);
    } catch (error) {
      logger.error(`Netlify deployment failed for site ${siteId}:`, error);
      throw this.createError(
        DeploymentErrorType.DEPLOYMENT_FAILED,
        `Failed to deploy to Netlify: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
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

  private async waitForDeployment(siteId: string, deployId: string): Promise<DeploymentResult> {
    const maxAttempts = 30;
    const delayMs = 2000;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const response = await this.fetchNetlifyApi<NetlifyDeploy>(`/sites/${siteId}/deploys/${deployId}`);
      const deploy = await response.json() as NetlifyDeploy;

      if (deploy.status === 'ready') {
        return {
          id: deploy.id,
          url: deploy.ssl_url || deploy.deploy_url,
          status: 'success',
          logs: [`Deployment completed successfully`],
          provider: this.getProviderType(),
          metadata: {
            siteId,
            deployId: deploy.id
          }
        };
      }

      if (deploy.status === 'error') {
        throw new Error(`Deployment failed: ${deploy.error_message || 'Unknown error'}`);
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
      attempts++;
    }

    throw new Error('Deployment timed out');
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