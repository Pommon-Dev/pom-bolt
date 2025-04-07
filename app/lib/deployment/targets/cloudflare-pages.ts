import { createScopedLogger } from '~/utils/logger';
import { BaseDeploymentTarget } from './base';
import type { 
  ProjectOptions, 
  ProjectMetadata, 
  DeployOptions, 
  UpdateOptions, 
  DeploymentResult, 
  DeploymentStatus,
  CloudflareConfig
} from '../types';
import { DeploymentErrorType } from '../types';
import { ZipPackager } from '../packagers/zip';

const logger = createScopedLogger('cloudflare-pages-target');

/**
 * Deployment target for Cloudflare Pages
 * Uses the Cloudflare Pages API for deploying applications
 */
export class CloudflarePagesTarget extends BaseDeploymentTarget {
  private config: CloudflareConfig;
  private zipPackager: ZipPackager;
  private fixedProjectName?: string;
  
  constructor(config: CloudflareConfig) {
    super();
    this.config = config;
    this.zipPackager = new ZipPackager();
    this.fixedProjectName = config.projectName;
    
    if (this.fixedProjectName) {
      logger.info(`CloudflarePagesTarget initialized with fixed project name: ${this.fixedProjectName}`);
    }
  }
  
  getName(): string {
    return 'cloudflare-pages';
  }
  
  getProviderType(): string {
    return 'cloudflare';
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      // Check if we have the necessary credentials
      if (!this.config.accountId || !this.config.apiToken) {
        logger.warn('Cloudflare Pages target missing required credentials');
        return false;
      }
      
      // Test API access by listing projects
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/pages/projects`,
        {
          headers: this.getHeaders()
        }
      );
      
      const data = await response.json();
      
      if (!response.ok) {
        logger.warn('Cloudflare Pages API test failed:', data.errors?.[0]?.message || 'Unknown error');
        return false;
      }
      
      logger.debug('Cloudflare Pages target is available');
      return true;
    } catch (error) {
      logger.warn('Failed to check Cloudflare Pages availability:', error);
      return false;
    }
  }
  
  async projectExists(projectName: string): Promise<boolean> {
    try {
      const sanitizedName = this.sanitizeProjectName(projectName);
      
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/pages/projects/${sanitizedName}`,
        {
          headers: this.getHeaders()
        }
      );
      
      return response.status === 200;
    } catch (error) {
      logger.error(`Failed to check if project ${projectName} exists:`, error);
      return false;
    }
  }
  
  async initializeProject(options: ProjectOptions): Promise<ProjectMetadata> {
    // If we have a fixed project name, use it instead of the provided name
    const projectName = this.fixedProjectName || options.name;
    const sanitizedName = this.sanitizeProjectName(projectName);
    
    logger.debug(`Initializing Cloudflare Pages project: ${sanitizedName} ${this.fixedProjectName ? '(using fixed project name)' : ''}`);
    
    try {
      // Check if project already exists
      const exists = await this.projectExists(sanitizedName);
      
      if (exists) {
        logger.debug(`Project ${sanitizedName} already exists, retrieving details`);
        return this.getExistingProject(sanitizedName);
      }
      
      // Create a new project
      logger.info(`Creating new Cloudflare Pages project: ${sanitizedName}`);
      
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/pages/projects`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            name: sanitizedName,
            production_branch: 'main',
            build_config: {
              build_command: 'npm run build',
              destination_dir: 'build'
            }
          })
        }
      );
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to create project: ${error.errors?.[0]?.message || response.statusText}`);
      }
      
      const data = await response.json();
      const project = data.result;
      
      return {
        id: project.name,
        name: project.name,
        url: `https://${project.name}.pages.dev`,
        provider: this.getProviderType(),
        metadata: {
          subdomain: project.subdomain,
          createdAt: project.created_on
        }
      };
    } catch (error) {
      logger.error(`Failed to initialize project ${sanitizedName}:`, error);
      throw this.createError(
        DeploymentErrorType.INITIALIZATION_FAILED,
        `Failed to initialize Cloudflare Pages project: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }
  
  async deploy(options: DeployOptions): Promise<DeploymentResult> {
    // If we have a fixed project name, use it instead of the provided name
    const projectName = this.fixedProjectName || options.projectName;
    
    try {
      // Package the files
      logger.debug(`Packaging ${Object.keys(options.files).length} files for deployment to ${projectName} ${this.fixedProjectName ? '(using fixed project name)' : ''}`);
      const zipBuffer = await this.zipPackager.package(options.files);
      
      // Get a direct upload URL
      logger.debug(`Getting upload URL for project ${projectName}`);
      const deploymentData = await this.createDeployment(projectName);
      const { id: deploymentId, url: uploadUrl } = deploymentData;
      
      // Upload the files
      logger.debug(`Uploading files to ${uploadUrl}`);
      await this.uploadFiles(uploadUrl, zipBuffer);
      
      // Wait for the deployment to complete
      logger.info(`Deployment ${deploymentId} in progress, waiting for completion`);
      const status = await this.waitForDeployment(projectName, deploymentId);
      
      const deploymentUrl = status.url || `https://${deploymentId}.${projectName}.pages.dev`;
      
      return {
        id: deploymentId,
        url: deploymentUrl,
        status: status.status,
        logs: status.logs,
        provider: this.getProviderType(),
        metadata: {
          projectName: projectName,
          createdAt: Date.now()
        }
      };
    } catch (error) {
      logger.error(`Deployment failed for project ${projectName}:`, error);
      throw this.createError(
        DeploymentErrorType.DEPLOYMENT_FAILED,
        `Failed to deploy to Cloudflare Pages: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }
  
  async update(options: UpdateOptions): Promise<DeploymentResult> {
    // For Cloudflare Pages, update is the same as deploy since each deployment gets a unique URL
    return this.deploy(options);
  }
  
  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    try {
      // Extract project name from deployment ID
      const parts = deploymentId.split('/');
      const projectName = parts.length > 1 ? parts[0] : '';
      const actualDeploymentId = parts.length > 1 ? parts[1] : deploymentId;
      
      if (!projectName) {
        throw new Error('Invalid deployment ID format. Expected "projectName/deploymentId"');
      }
      
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/pages/projects/${projectName}/deployments/${actualDeploymentId}`,
        {
          headers: this.getHeaders()
        }
      );
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to get deployment status: ${error.errors?.[0]?.message || response.statusText}`);
      }
      
      const data = await response.json();
      const deployment = data.result;
      
      // Map Cloudflare status to our status
      let status: 'success' | 'failed' | 'in-progress' = 'in-progress';
      if (deployment.stages.some(s => s.name === 'deploy' && s.status === 'success')) {
        status = 'success';
      } else if (deployment.stages.some(s => s.status === 'failed')) {
        status = 'failed';
      }
      
      return {
        id: actualDeploymentId,
        url: deployment.url || `https://${actualDeploymentId}.${projectName}.pages.dev`,
        status,
        logs: deployment.stages.map(s => `${s.name}: ${s.status}`),
        createdAt: new Date(deployment.created_on).getTime(),
        completedAt: deployment.modified_on ? new Date(deployment.modified_on).getTime() : undefined,
        metadata: deployment
      };
    } catch (error) {
      logger.error(`Failed to get deployment status for ${deploymentId}:`, error);
      throw this.createError(
        DeploymentErrorType.UNKNOWN,
        `Failed to get deployment status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }
  
  async removeDeployment(deploymentId: string): Promise<boolean> {
    try {
      // Extract project name from deployment ID
      const parts = deploymentId.split('/');
      const projectName = parts.length > 1 ? parts[0] : '';
      const actualDeploymentId = parts.length > 1 ? parts[1] : deploymentId;
      
      if (!projectName) {
        throw new Error('Invalid deployment ID format. Expected "projectName/deploymentId"');
      }
      
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/pages/projects/${projectName}/deployments/${actualDeploymentId}`,
        {
          method: 'DELETE',
          headers: this.getHeaders()
        }
      );
      
      return response.ok;
    } catch (error) {
      logger.error(`Failed to remove deployment ${deploymentId}:`, error);
      return false;
    }
  }
  
  /**
   * Get an existing project's metadata
   */
  private async getExistingProject(projectName: string): Promise<ProjectMetadata> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/pages/projects/${projectName}`,
      {
        headers: this.getHeaders()
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to get project details: ${error.errors?.[0]?.message || response.statusText}`);
    }
    
    const data = await response.json();
    const project = data.result;
    
    return {
      id: project.name,
      name: project.name,
      url: project.domains.length > 0 ? `https://${project.domains[0]}` : `https://${project.subdomain}.pages.dev`,
      provider: this.getProviderType(),
      metadata: {
        subdomain: project.subdomain,
        createdAt: project.created_on
      }
    };
  }
  
  /**
   * Create a new deployment and get an upload URL
   */
  private async createDeployment(projectName: string): Promise<{ id: string; url: string }> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/pages/projects/${projectName}/deployments`,
      {
        method: 'POST',
        headers: this.getHeaders()
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create deployment: ${error.errors?.[0]?.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      id: data.result.id,
      url: data.result.upload_url
    };
  }
  
  /**
   * Upload files to the deployment
   */
  private async uploadFiles(uploadUrl: string, zipBuffer: ArrayBuffer): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/zip'
      },
      body: zipBuffer
    });
    
    if (!response.ok) {
      throw new Error(`Failed to upload files: ${response.statusText}`);
    }
  }
  
  /**
   * Wait for a deployment to complete
   */
  private async waitForDeployment(projectName: string, deploymentId: string): Promise<{ 
    status: 'success' | 'failed' | 'in-progress';
    url?: string;
    logs: string[];
  }> {
    // Maximum number of attempts
    const maxAttempts = 30;
    // Delay between attempts in milliseconds
    const delay = 3000;
    
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/pages/projects/${projectName}/deployments/${deploymentId}`,
          {
            headers: this.getHeaders()
          }
        );
        
        if (!response.ok) {
          throw new Error(`Failed to get deployment status: ${response.statusText}`);
        }
        
        const data = await response.json();
        const deployment = data.result;
        
        const logs = deployment.stages.map(s => `${s.name}: ${s.status}`);
        
        // Check if the deployment is complete
        if (deployment.stages.some(s => s.name === 'deploy' && s.status === 'success')) {
          return {
            status: 'success',
            url: deployment.url,
            logs
          };
        }
        
        // Check if the deployment failed
        if (deployment.stages.some(s => s.status === 'failed')) {
          return {
            status: 'failed',
            logs
          };
        }
        
        logger.debug(`Deployment ${deploymentId} still in progress. Attempt ${attempts}/${maxAttempts}`);
        
        // Wait before trying again
        await new Promise(resolve => setTimeout(resolve, delay));
      } catch (error) {
        logger.error(`Failed to check deployment status:`, error);
        
        // Wait before trying again
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    logger.warn(`Deployment ${deploymentId} status check timed out after ${maxAttempts} attempts`);
    
    // Return in-progress after timeout
    return {
      status: 'in-progress',
      logs: [`Status check timed out after ${maxAttempts} attempts`]
    };
  }
  
  /**
   * Get headers for Cloudflare API requests
   */
  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.apiToken}`,
      'Content-Type': 'application/json'
    };
  }
} 