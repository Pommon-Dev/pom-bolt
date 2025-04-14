import { createScopedLogger } from '~/utils/logger';
import { BaseDeploymentTarget } from './base';
import { DeploymentErrorType } from '../types';
import type { 
  DeploymentResult,
  DeployOptions,
  DeploymentStatus,
  ProjectMetadata,
  ProjectOptions,
  UpdateOptions
} from '../types';
import { 
  GitHubRepository, 
  type GitHubRepoMetadata
} from '../github-repository';
import {
  GitHubIntegrationService,
  githubIntegration
} from '../github-integration';
import type { GitHubRepositoryInfo } from '~/lib/projects/types';

// Constants
const NETLIFY_API_BASE = 'https://api.netlify.com/api/v1';

const logger = createScopedLogger('netlify-github-target');

// Netlify API response interface
interface NetlifyErrorResponse {
  message?: string;
  errors?: Array<{ message: string }>;
  code?: string;
}

export interface NetlifyGitHubConfig {
  netlifyToken: string;
  githubToken: string;
  githubOwner?: string;
}

interface BuildConfig {
  framework?: string;
  buildCommand?: string;
  outputDir?: string;
  siteName?: string;
}

// GitHub repository info stored in metadata
interface GitHubRepoInfo {
  fullName: string;
  url?: string;
  defaultBranch?: string;
}

// Extended metadata for tracking GitHub repository creation status
interface NetlifyGitHubMetadata {
  githubRepo?: string;
  githubUrl?: string;
  github?: GitHubRepositoryInfo;
  framework?: string;
  buildCommand?: string;
  outputDir?: string;
  // Tracking flags for repository creation and file upload status
  repoCreated?: boolean;
  filesUploaded?: boolean;
  projectId?: string; // Link to a unique project ID
}

// Extended project options with projectId
interface ExtendedProjectOptions extends ProjectOptions {
  projectId?: string;
}

/**
 * Deployment target for Netlify using GitHub as the source
 * This target creates a GitHub repository, pushes code to it,
 * and connects it to Netlify for automatic builds and deploys.
 */
export class NetlifyGitHubTarget extends BaseDeploymentTarget {
  private netlifyToken: string;
  private githubToken: string;
  private githubOwner?: string;
  private buildConfig: BuildConfig = {};

  constructor(config: NetlifyGitHubConfig) {
    super();
    this.netlifyToken = config.netlifyToken;
    this.githubToken = config.githubToken;
    this.githubOwner = config.githubOwner;
    logger.info('NetlifyGitHubTarget initialized');
  }

  getName(): string {
    return 'netlify-github';
  }

  getProviderType(): string {
    return 'netlify';
  }

  /**
   * Check if the Netlify and GitHub tokens are valid
   */
  async isAvailable(): Promise<boolean> {
    try {
      // First validate GitHub token using the GitHub integration service
      const tempRepo = new GitHubRepository({
        token: this.githubToken,
        owner: this.githubOwner
      });
      
      const githubValid = await tempRepo.validateToken();
      if (!githubValid) {
        logger.warn('GitHub token is invalid or has insufficient permissions');
        return false;
      }

      // Then validate Netlify token
      const response = await fetch(`${NETLIFY_API_BASE}/sites`, {
        headers: this.getNetlifyHeaders()
      });

      if (!response.ok) {
        logger.warn(`Netlify token validation failed: ${response.statusText}`);
        return false;
      }

      logger.info('Netlify GitHub deployment target is available');
      return true;
    } catch (error) {
      logger.error('Error checking Netlify GitHub deployment target availability:', error);
      return false;
    }
  }

  /**
   * Helper method to extract GitHub info from metadata
   * This normalizes different formats of GitHub info into a consistent structure
   */
  private extractGitHubInfo(metadata: Record<string, any> | undefined): GitHubRepoInfo | undefined {
    // We now delegate this to the GitHub integration service
    const gitHubMetadata = githubIntegration.extractGitHubMetadata(metadata);
    
    if (gitHubMetadata.github) {
      return {
        fullName: gitHubMetadata.github.fullName,
        url: gitHubMetadata.github.url,
        defaultBranch: gitHubMetadata.github.defaultBranch
      };
    }
    
    if (gitHubMetadata.githubRepo) {
      return {
        fullName: gitHubMetadata.githubRepo,
        url: gitHubMetadata.githubUrl,
        defaultBranch: 'main'
      };
    }
    
    return undefined;
  }

  /**
   * Helper method to update metadata with normalized GitHub info
   * This ensures both the modern format (github object) and legacy format
   * (githubRepo string) are present in the metadata
   */
  private updateMetadataWithGitHubInfo(
    metadata: Record<string, any> | undefined, 
    githubInfo: GitHubRepoInfo
  ): Record<string, any> {
    // We now delegate this to the GitHub integration service
    const trackingData = githubIntegration.extractGitHubMetadata(metadata);
    
    // Convert GitHubRepoInfo to GitHubRepositoryInfo if needed
    let repositoryInfo: GitHubRepositoryInfo;
    
    if (trackingData.github) {
      repositoryInfo = trackingData.github;
    } else {
      const parts = githubInfo.fullName.split('/');
      if (parts.length === 2) {
        repositoryInfo = {
          owner: parts[0],
          repo: parts[1],
          fullName: githubInfo.fullName,
          url: githubInfo.url || `https://github.com/${githubInfo.fullName}`,
          defaultBranch: githubInfo.defaultBranch || 'main',
          isPrivate: true,
          commitSha: undefined
        };
      } else {
        // In case the fullName is not properly formatted
        repositoryInfo = {
          owner: this.githubOwner || 'unknown',
          repo: githubInfo.fullName,
          fullName: `${this.githubOwner || 'unknown'}/${githubInfo.fullName}`,
          url: githubInfo.url || '',
          defaultBranch: githubInfo.defaultBranch || 'main',
          isPrivate: true,
          commitSha: undefined
        };
      }
    }
    
    // Update with GitHub info
    trackingData.github = repositoryInfo;
    trackingData.githubRepo = repositoryInfo.fullName;
    trackingData.githubUrl = repositoryInfo.url;
    
    // Return updated metadata from the integration service
    return {
      ...(metadata || {}),
      github: trackingData.github,
      githubRepo: trackingData.githubRepo,
      githubUrl: trackingData.githubUrl,
      repoCreated: trackingData.repoCreated,
      filesUploaded: trackingData.filesUploaded
    };
  }

  /**
   * Detect the framework and build settings from project files
   */
  private detectBuildConfig(files: Record<string, string>): BuildConfig {
    const config: BuildConfig = {
      framework: 'static',
      buildCommand: '',
      outputDir: ''
    };

    // Check for package.json to detect framework and build commands
    if (files['package.json']) {
      try {
        const packageJson = JSON.parse(files['package.json']);
        
        // Check dependencies to determine framework
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        if (deps.react) {
          if (deps['@remix-run/react']) {
            config.framework = 'remix';
            config.buildCommand = 'npm install && npm run build';
            config.outputDir = 'public';
          } else if (deps['next']) {
            config.framework = 'nextjs';
            config.buildCommand = 'npm install && npm run build';
            config.outputDir = '.next';
          } else if (deps['gatsby']) {
            config.framework = 'gatsby';
            config.buildCommand = 'npm install && npm run build';
            config.outputDir = 'public';
          } else {
            // Generic React (Create React App, Vite, etc.)
            config.framework = 'react';
            config.buildCommand = 'npm install && npm run build';
            config.outputDir = 'build';
            
            // Check for Vite specifically
            if (deps.vite || files['vite.config.js'] || files['vite.config.ts']) {
              config.outputDir = 'dist';
            }
          }
        } else if (deps.vue) {
          config.framework = 'vue';
          config.buildCommand = 'npm install && npm run build';
          config.outputDir = 'dist';
        } else if (deps.svelte) {
          config.framework = 'svelte';
          config.buildCommand = 'npm install && npm run build';
          config.outputDir = 'public';
        } else if (deps.angular) {
          config.framework = 'angular';
          config.buildCommand = 'npm install && npm run build';
          config.outputDir = 'dist';
        } else {
          // Generic Node.js project
          config.framework = 'javascript';
          config.buildCommand = 'npm install && npm run build';
          config.outputDir = 'dist';
        }
        
        // Override with scripts from package.json if available
        if (packageJson.scripts && packageJson.scripts.build) {
          config.buildCommand = 'npm install && npm run build';
        }
      } catch (error) {
        logger.warn('Error parsing package.json:', error);
      }
    } else if (files['index.html']) {
      // Static HTML site
      config.framework = 'static';
      config.buildCommand = '';
      config.outputDir = '';
    }

    // Look for netlify.toml for overrides
    if (files['netlify.toml']) {
      try {
        // Simple parsing of netlify.toml - not perfect but sufficient for most cases
        const netlifyToml = files['netlify.toml'];
        const commandMatch = netlifyToml.match(/command\s*=\s*"([^"]+)"/);
        const publishMatch = netlifyToml.match(/publish\s*=\s*"([^"]+)"/);
        
        if (commandMatch && commandMatch[1]) {
          config.buildCommand = commandMatch[1];
        }
        
        if (publishMatch && publishMatch[1]) {
          config.outputDir = publishMatch[1];
        }
      } catch (error) {
        logger.warn('Error parsing netlify.toml:', error);
      }
    }

    return config;
  }

  /**
   * Create a netlify.toml file if it doesn't exist
   */
  private createNetlifyTomlIfNeeded(files: Record<string, string>, config: BuildConfig): Record<string, string> {
    // If netlify.toml already exists, don't modify it
    if (files['netlify.toml']) {
      return files;
    }

    // Otherwise create a new netlify.toml with the detected build settings
    const netlifyToml = `[build]
  command = "${config.buildCommand}"
  publish = "${config.outputDir}"

[build.environment]
  NODE_VERSION = "18"

[dev]
  command = "npm run dev"
  port = 3000
  framework = "#auto"
`;

    return {
      ...files,
      'netlify.toml': netlifyToml
    };
  }

  /**
   * Get Netlify API headers
   */
  private getNetlifyHeaders(): Headers {
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${this.netlifyToken}`);
    headers.set('Content-Type', 'application/json');
    return headers;
  }

  /**
   * Create a new Netlify site
   */
  private async createNetlifySite(name: string): Promise<{ id: string; url: string; name: string } | null> {
    try {
      const response = await fetch(`${NETLIFY_API_BASE}/sites`, {
        method: 'POST',
        headers: this.getNetlifyHeaders(),
        body: JSON.stringify({
          name: name.toLowerCase(),
          build_settings: {
            cmd: this.buildConfig.buildCommand,
            dir: this.buildConfig.outputDir
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json() as NetlifyErrorResponse;
        logger.error(`Failed to create Netlify site ${name}:`, errorData);
        return null;
      }

      const data = await response.json() as { id: string; name: string; ssl_url: string; url: string };
      logger.info(`Created Netlify site: ${data.name} (${data.id})`);
      
      return {
        id: data.id,
        name: data.name,
        url: data.ssl_url || data.url
      };
    } catch (error) {
      logger.error(`Error creating Netlify site ${name}:`, error);
      return null;
    }
  }

  /**
   * Link a GitHub repository to a Netlify site
   */
  private async linkGitHubRepo(
    siteId: string, 
    repoData: { fullName: string; defaultBranch?: string }
  ): Promise<boolean> {
    try {
      const response = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}/builds`, {
        method: 'POST',
        headers: this.getNetlifyHeaders(),
        body: JSON.stringify({
          repo: {
            provider: 'github',
            repo: repoData.fullName,
            private: true,
            branch: repoData.defaultBranch || 'main'
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json() as NetlifyErrorResponse;
        logger.error(`Failed to link GitHub repo to Netlify site ${siteId}:`, errorData);
        return false;
      }

      const data = await response.json();
      logger.info(`Linked GitHub repo ${repoData.fullName} to Netlify site ${siteId}`);
      return true;
    } catch (error) {
      logger.error(`Error linking GitHub repo to Netlify site ${siteId}:`, error);
      return false;
    }
  }

  /**
   * Check if a project exists on Netlify
   */
  async projectExists(projectName: string): Promise<boolean> {
    const sanitizedName = this.sanitizeProjectName(projectName);
    
    try {
      const response = await fetch(`${NETLIFY_API_BASE}/sites?name=${sanitizedName}`, {
        headers: this.getNetlifyHeaders()
      });
      
      if (!response.ok) {
        logger.warn(`Failed to check if Netlify site ${sanitizedName} exists: ${response.statusText}`);
        return false;
      }
      
      const sites = await response.json() as Array<{ name: string }>;
      return sites.some(site => site.name === sanitizedName);
    } catch (error) {
      logger.error(`Error checking if Netlify site ${sanitizedName} exists:`, error);
      return false;
    }
  }

  /**
   * Initialize a project by creating a GitHub repo and Netlify site
   */
  async initializeProject(options: ExtendedProjectOptions): Promise<ProjectMetadata> {
    const sanitizedName = this.sanitizeProjectName(options.name);
    logger.info(`Initializing Netlify project with GitHub repo: ${sanitizedName}`);

    try {
      // Detect build configuration from files
      this.buildConfig = this.detectBuildConfig(options.files || {});
      // Use the siteName from metadata if provided
      if (options.metadata && options.metadata.siteName) {
        this.buildConfig.siteName = options.metadata.siteName;
      }

      // Add netlify.toml if needed
      const filesToUpload = this.createNetlifyTomlIfNeeded(options.files || {}, this.buildConfig);

      // Use the GitHubIntegrationService to handle repository creation and file upload
      const githubResult = await githubIntegration.setupRepository({
        token: this.githubToken,
        owner: this.githubOwner,
        projectId: options.projectId || sanitizedName,
        projectName: sanitizedName,
        files: filesToUpload,
        description: `Generated application for ${options.name}`,
        metadata: options.metadata
      });

      if (!githubResult.repositoryInfo) {
        throw this.createError(
          DeploymentErrorType.INITIALIZATION_FAILED,
          `Failed to set up GitHub repository: ${githubResult.error || 'Unknown error'}`
        );
      }

      logger.info(`GitHub repository set up: ${githubResult.repositoryInfo.fullName}`);

      // Create a Netlify site
      const netlifyName = this.buildConfig.siteName || sanitizedName;
      const netlifyData = await this.createNetlifySite(netlifyName);
      if (!netlifyData) {
        throw this.createError(
          DeploymentErrorType.INITIALIZATION_FAILED,
          `Failed to create Netlify site for ${netlifyName}`
        );
      }
      logger.info(`Netlify site created: ${netlifyData.name} (${netlifyData.id})`);

      // Link the GitHub repo to the Netlify site
      const linkSuccess = await this.linkGitHubRepo(netlifyData.id, {
        fullName: githubResult.repositoryInfo.fullName,
        defaultBranch: githubResult.repositoryInfo.defaultBranch
      });
      
      if (!linkSuccess) {
        throw this.createError(
          DeploymentErrorType.INITIALIZATION_FAILED,
          `Failed to link GitHub repo ${githubResult.repositoryInfo.fullName} to Netlify site ${netlifyData.id}`
        );
      }
      logger.info(`GitHub repo linked to Netlify site: ${netlifyData.name} (${netlifyData.id})`);
      
      // Update metadata with GitHub info and Netlify info
      const updatedMetadata = {
        ...githubResult.updatedMetadata,
        framework: this.buildConfig.framework,
        buildCommand: this.buildConfig.buildCommand,
        outputDir: this.buildConfig.outputDir,
        projectId: options.projectId || netlifyData.id
      };
      
      // Return the project metadata
      return {
        id: netlifyData.id,
        name: netlifyData.name,
        provider: this.getProviderType(),
        url: netlifyData.url,
        metadata: updatedMetadata
      };
    } catch (error) {
      logger.error(`Error initializing Netlify project with GitHub:`, error);
      
      // If we got this far, we may have created a GitHub repo but failed to create a Netlify site
      // Return whatever metadata we have
      if (error instanceof Error && 
          error.message.includes('Failed to create Netlify site') && 
          options.metadata?.github) {
        
        return {
          id: options.projectId || '',
          name: sanitizedName,
          provider: this.getProviderType(),
          url: '',
          metadata: {
            ...(options.metadata as Record<string, any>),
            repoCreated: true,
            filesUploaded: true
          }
        };
      }
      
      throw this.createError(
        DeploymentErrorType.INITIALIZATION_FAILED,
        `Failed to initialize Netlify project: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Deploy to Netlify via GitHub
   */
  async deploy(options: DeployOptions): Promise<DeploymentResult> {
    try {
      logger.info(`Starting Netlify-GitHub deployment: ${options.projectName || options.projectId}`);
      
      if (!options.projectId) {
        throw this.createError(
          DeploymentErrorType.UNKNOWN,
          'Project ID is required for Netlify-GitHub deployments'
        );
      }
      
      if (!options.files || Object.keys(options.files).length === 0) {
        throw this.createError(
          DeploymentErrorType.UNKNOWN,
          'No files provided for deployment'
        );
      }
      
      const projectId = options.projectId;
      
      // Set up GitHubIntegrationService
      const githubService = GitHubIntegrationService.getInstance();
      const projectName = this.getValidProjectName(projectId);
      const filteredFiles = this.filterFiles(options.files);
      
      // Check if we have a site ID in metadata
      const siteId = options.metadata?.netlify?.siteId || projectId;
      
      // If we have a site ID, check if it exists and is linked to GitHub
      let site: any = null;
      if (siteId) {
        site = await this.getSite(siteId);
      }
      
      // First, check if we already have GitHub info in the metadata
      const githubInfo = githubIntegration.extractGitHubMetadata(options.metadata).github;
      
      if (githubInfo) {
        logger.info(`Using existing GitHub repository: ${githubInfo.fullName}`);
        
        // Check if the files need to be updated
        if (Object.keys(filteredFiles).length > 0) {
          logger.info(`Updating GitHub repository ${githubInfo.fullName} with ${Object.keys(filteredFiles).length} files`);
          
          try {
            // Update the files in the GitHub repository
            const updateResult = await githubIntegration.uploadFiles({
              token: this.githubToken,
              projectId,
              repositoryInfo: githubInfo,
              files: filteredFiles,
              metadata: options.metadata
            });
            
            if (!updateResult.success) {
              logger.error(`Failed to update GitHub repository: ${updateResult.error || 'Unknown error'}`);
            } else {
              logger.info(`Successfully updated GitHub repository ${githubInfo.fullName}`);
            }
          } catch (error) {
            logger.error(`Error updating GitHub repository: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        
        // Check if the Netlify site already exists
        logger.info(`Checking if Netlify site ${siteId} exists...`);
        
        if (site) {
          logger.info(`Found existing Netlify site: ${site.name} (${siteId})`);
          
          // Check if already linked to GitHub
          if (site.build_settings?.repo_url) {
            logger.info(`Netlify site is already linked to GitHub repository: ${site.build_settings.repo_url}`);
          } else {
            // Link the GitHub repo to the Netlify site
            logger.info(`Linking GitHub repository ${githubInfo.fullName} to Netlify site ${siteId}`);
            
            const linkSuccess = await this.linkGitHubRepo(siteId, {
              fullName: githubInfo.fullName,
              defaultBranch: githubInfo.defaultBranch || 'main'
            });
            
            if (linkSuccess) {
              logger.info(`Successfully linked GitHub repo ${githubInfo.fullName} to Netlify site ${siteId}`);
            } else {
              logger.error(`Failed to link GitHub repo ${githubInfo.fullName} to Netlify site ${siteId}`);
            }
          }
          
          // Return a successful deployment result
          return {
            id: `github-${Date.now()}`,
            url: site.ssl_url || site.url,
            status: 'in-progress',
            provider: this.getProviderType(),
            logs: [`GitHub repository updated. Netlify will automatically rebuild.`]
          };
        } else {
          // Need to create a new Netlify site linked to the existing GitHub repo
          logger.info(`Creating new Netlify site linked to GitHub repository ${githubInfo.fullName}`);
          
          const newSite = await this.createSite({
            name: projectName,
            githubRepo: githubInfo.fullName,
            githubBranch: githubInfo.defaultBranch || 'main',
            buildSettings: this.detectBuildSettings(filteredFiles)
          });
          
          if (!newSite) {
            throw this.createError(
              DeploymentErrorType.DEPLOYMENT_FAILED,
              `Failed to create Netlify site`
            );
          }
          
          logger.info(`Netlify site created: ${newSite.name} (${newSite.id})`);
          
          // Return deployment result
          return {
            id: `github-${Date.now()}`,
            url: newSite.ssl_url || newSite.url,
            status: 'in-progress',
            provider: this.getProviderType(),
            logs: [`Netlify site created and connected to GitHub repository. Waiting for build to complete.`]
          };
        }
      } else {
        // No GitHub info in metadata, need to create GitHub repo first
        logger.info(`No GitHub repository info found. Creating a new GitHub repository for project ${siteId}`);
        
        // Use the github integration service to setup a new repository
        const githubResult = await githubIntegration.setupRepository({
          token: this.githubToken,
          owner: this.githubOwner,
          projectId,
          projectName,
          files: filteredFiles,
          description: `Generated application for ${projectName}`,
          metadata: options.metadata
        });
        
        if (!githubResult.repositoryInfo) {
          throw this.createError(
            DeploymentErrorType.DEPLOYMENT_FAILED,
            `Failed to set up GitHub repository: ${githubResult.error || 'Unknown error'}`
          );
        }
        
        const newGithubInfo = githubResult.repositoryInfo;
        logger.info(`GitHub repository created: ${newGithubInfo.fullName}`);
        
        // Check if Netlify site exists
        const siteData = await this.getSite(siteId);
        
        if (siteData) {
          // Link the GitHub repo to the existing Netlify site
          logger.info(`Linking GitHub repository ${newGithubInfo.fullName} to existing Netlify site ${siteId}`);
          
          const linkSuccess = await this.linkGitHubRepo(siteId, {
            fullName: newGithubInfo.fullName,
            defaultBranch: newGithubInfo.defaultBranch
          });
          
          if (!linkSuccess) {
            throw this.createError(
              DeploymentErrorType.DEPLOYMENT_FAILED,
              `Failed to link GitHub repo ${newGithubInfo.fullName} to Netlify site ${siteId}`
            );
          }
          
          logger.info(`Successfully linked GitHub repo ${newGithubInfo.fullName} to Netlify site ${siteId}`);
          
          // Return a successful deployment result
          return {
            id: `github-${Date.now()}`,
            url: siteData.ssl_url || siteData.url,
            status: 'in-progress',
            provider: this.getProviderType(),
            logs: [`GitHub repository created and linked to Netlify site. Waiting for build to complete.`]
          };
        } else {
          // Create a new Netlify site
          logger.info(`Creating new Netlify site linked to GitHub repository ${newGithubInfo.fullName}`);
          
          const newSite = await this.createSite({
            name: projectName,
            githubRepo: newGithubInfo.fullName,
            githubBranch: newGithubInfo.defaultBranch,
            buildSettings: this.detectBuildSettings(filteredFiles)
          });
          
          if (!newSite) {
            throw this.createError(
              DeploymentErrorType.DEPLOYMENT_FAILED,
              `Failed to create Netlify site`
            );
          }
          
          logger.info(`Netlify site created: ${newSite.name} (${newSite.id})`);
          
          // Return deployment result
          return {
            id: `github-${Date.now()}`,
            url: newSite.ssl_url || newSite.url,
            status: 'in-progress',
            provider: this.getProviderType(),
            logs: [`Netlify site created and connected to GitHub repository. Waiting for build to complete.`]
          };
        }
      }
    } catch (error) {
      logger.error(`Netlify GitHub deployment failed:`, error);
      throw this.createError(
        DeploymentErrorType.DEPLOYMENT_FAILED,
        `Failed to deploy to Netlify via GitHub: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Map Netlify deployment state to our standard status
   */
  private mapNetlifyStateToStatus(netlifyState: string): 'success' | 'in-progress' | 'failed' {
    switch (netlifyState) {
      case 'ready':
        return 'success';
      case 'error':
        return 'failed';
      case 'building':
      case 'enqueued':
      case 'processing':
      case 'new':
      default:
        return 'in-progress';
    }
  }

  /**
   * Update a project by pushing code to GitHub, which will trigger a Netlify build
   */
  async update(options: UpdateOptions): Promise<DeploymentResult> {
    // For Netlify with GitHub, update is the same as deploy
    return this.deploy({
      projectId: options.projectId,
      projectName: options.projectName,
      files: options.files,
      metadata: options.metadata
    });
  }

  /**
   * Get the status of a deployment
   */
  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    try {
      const response = await fetch(`${NETLIFY_API_BASE}/deploys/${deploymentId}`, {
        headers: this.getNetlifyHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to get deployment status: ${response.statusText}`);
      }

      const data = await response.json() as {
        id: string;
        state: string;
        error_message?: string;
        deploy_url: string;
        ssl_url: string;
        created_at: string;
        updated_at: string;
      };

      return {
        id: data.id,
        status: this.mapNetlifyStateToStatus(data.state),
        url: data.ssl_url || data.deploy_url,
        logs: data.error_message ? [data.error_message] : [],
        createdAt: new Date(data.created_at).getTime(),
        completedAt: data.state === 'ready' || data.state === 'error' 
          ? new Date(data.updated_at).getTime() 
          : undefined
      };
    } catch (error) {
      logger.error(`Error getting Netlify deployment status for ${deploymentId}:`, error);
      throw this.createError(
        DeploymentErrorType.UNKNOWN,
        `Failed to get deployment status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Remove a deployment
   */
  async removeDeployment(deploymentId: string): Promise<boolean> {
    try {
      const response = await fetch(`${NETLIFY_API_BASE}/deploys/${deploymentId}`, {
        method: 'DELETE',
        headers: this.getNetlifyHeaders()
      });

      return response.ok || response.status === 204 || response.status === 404;
    } catch (error) {
      logger.error(`Error removing Netlify deployment ${deploymentId}:`, error);
      return false;
    }
  }

  /**
   * Get a valid project name for Netlify
   */
  private getValidProjectName(projectId: string): string {
    return `pom-app-${projectId.substring(0, 8)}`;
  }

  /**
   * Filter out files that shouldn't be sent to GitHub
   */
  private filterFiles(files: Record<string, string>): Record<string, string> {
    // Filter out any files that shouldn't be in the repo
    return Object.entries(files).reduce((acc, [path, content]) => {
      // Skip node_modules, .git, etc.
      if (path.startsWith('node_modules/') || 
          path.startsWith('.git/') ||
          path.includes('.DS_Store')) {
        return acc;
      }
      acc[path] = content;
      return acc;
    }, {} as Record<string, string>);
  }

  /**
   * Get a Netlify site by ID
   */
  private async getSite(siteId: string): Promise<any> {
    try {
      logger.debug(`Checking if ${siteId} is a valid Netlify site ID...`);
      const siteResponse = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}`, {
        headers: this.getNetlifyHeaders()
      });

      if (!siteResponse.ok) {
        logger.warn(`Site with ID ${siteId} not found on Netlify.`);
        return null;
      }

      return await siteResponse.json() as { 
        id: string; 
        name: string; 
        ssl_url: string;
        build_settings?: {
          repo_url?: string;
          repo_branch?: string;
        }
      };
    } catch (error) {
      logger.error(`Error getting Netlify site ${siteId}:`, error);
      return null;
    }
  }

  /**
   * Create a new Netlify site linked to a GitHub repository
   */
  private async createSite(options: {
    name: string;
    githubRepo: string;
    githubBranch: string;
    buildSettings?: {
      cmd?: string;
      dir?: string;
      env?: Record<string, string>;
    };
  }): Promise<any> {
    try {
      logger.info(`Creating new Netlify site for ${options.name} linked to GitHub repo ${options.githubRepo}`);
      
      const sanitizedName = options.name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      
      // Create the site
      const response = await fetch(`${NETLIFY_API_BASE}/sites`, {
        method: 'POST',
        headers: this.getNetlifyHeaders(),
        body: JSON.stringify({
          name: sanitizedName,
          build_settings: {
            repo_url: `https://github.com/${options.githubRepo}`,
            repo_branch: options.githubBranch,
            cmd: options.buildSettings?.cmd || 'npm run build',
            dir: options.buildSettings?.dir || 'build',
            env: options.buildSettings?.env || {}
          }
        })
      });
      
      if (!response.ok) {
        logger.error(`Failed to create Netlify site: ${response.statusText}`);
        return null;
      }
      
      return await response.json();
    } catch (error) {
      logger.error('Error creating Netlify site:', error);
      return null;
    }
  }
  
  /**
   * Detect build settings based on the files in the repository
   */
  private detectBuildSettings(files: Record<string, string>): {
    cmd: string;
    dir: string;
    env: Record<string, string>;
  } {
    // Default build settings
    const settings = {
      cmd: 'npm run build',
      dir: 'build',
      env: {} as Record<string, string>
    };
    
    // Check for package.json to detect build command and output directory
    if (files['package.json']) {
      try {
        const pkg = JSON.parse(files['package.json']);
        
        // Check for build script
        if (pkg.scripts?.build) {
          // Use npm or yarn based on lockfile
          if (files['yarn.lock']) {
            settings.cmd = 'yarn build';
          } else if (files['pnpm-lock.yaml']) {
            settings.cmd = 'pnpm build';
          } else {
            settings.cmd = 'npm run build';
          }
        }
        
        // Special handling for common frameworks
        if (pkg.dependencies?.['next'] || pkg.devDependencies?.['next']) {
          settings.dir = '.next';
          settings.env['NETLIFY_NEXT_PLUGIN_SKIP'] = 'true';
        } else if (pkg.dependencies?.['@remix-run/react'] || pkg.devDependencies?.['@remix-run/react']) {
          settings.dir = 'public';
        } else if (pkg.dependencies?.['vue'] || pkg.devDependencies?.['vue']) {
          settings.dir = 'dist';
        } else if (pkg.dependencies?.['react'] || pkg.devDependencies?.['react']) {
          // Look for common React output dirs
          if (files['vite.config.js'] || files['vite.config.ts']) {
            settings.dir = 'dist';
          } else {
            settings.dir = 'build';
          }
        }
      } catch (error) {
        logger.error('Error parsing package.json:', error);
      }
    }
    
    return settings;
  }
}