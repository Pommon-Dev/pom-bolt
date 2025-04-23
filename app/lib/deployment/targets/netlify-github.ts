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
      logger.info('Checking if Netlify-GitHub target is available...');
      
      // Validate tokens first
      if (!this.netlifyToken) {
        logger.warn('Netlify token is missing for NetlifyGitHubTarget');
        return false;
      }
      
      if (!this.githubToken) {
        logger.warn('GitHub token is missing for NetlifyGitHubTarget');
        return false;
      }
      
      // First validate GitHub token using the GitHub integration service
      logger.debug('Validating GitHub token for NetlifyGitHubTarget...');
      const tempRepo = new GitHubRepository({
        token: this.githubToken,
        owner: this.githubOwner
      });
      
      try {
        const githubValid = await tempRepo.validateToken();
        if (!githubValid) {
          logger.warn('GitHub token is invalid or has insufficient permissions');
          return false;
        }
        logger.debug('GitHub token validated successfully');
      } catch (error) {
        logger.error('Error validating GitHub token:', error);
        return false;
      }

      // Then validate Netlify token
      logger.debug('Validating Netlify token for NetlifyGitHubTarget...');
      try {
        const response = await fetch(`${NETLIFY_API_BASE}/sites`, {
          headers: this.getNetlifyHeaders()
        });

        if (!response.ok) {
          logger.warn(`Netlify token validation failed: ${response.statusText}`);
          return false;
        }
        logger.debug('Netlify token validated successfully');
      } catch (error) {
        logger.error('Error validating Netlify token:', error);
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
  private async createSite(options: {
    name: string;
    githubRepo?: string;
    githubBranch?: string;
    buildSettings?: {
      cmd?: string;
      dir?: string;
      env?: Record<string, string>;
    };
  }): Promise<any> {
    try {
      logger.info(`Creating new Netlify site with name: ${options.name}`);
      
      const sanitizedName = options.name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      
      // Create the site without linking GitHub
      const response = await fetch(`${NETLIFY_API_BASE}/sites`, {
        method: 'POST',
        headers: this.getNetlifyHeaders(),
        body: JSON.stringify({
          name: sanitizedName
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json() as NetlifyErrorResponse;
        logger.error(`Failed to create Netlify site: ${response.statusText}`, errorData);
        return null;
      }
      
      const siteData = await response.json() as { id: string; name: string; ssl_url: string; url: string };
      logger.info(`Successfully created Netlify site: ${siteData.name} (${siteData.id})`);
      return siteData;
    } catch (error) {
      logger.error('Error creating Netlify site:', error);
      return null;
    }
  }

  /**
   * Link a GitHub repository to a Netlify site
   */
  private async linkGitHubRepo(
    siteId: string, 
    repoData: { fullName: string; defaultBranch?: string },
    buildSettings?: { cmd?: string; dir?: string; env?: Record<string, string> }
  ): Promise<boolean> {
    try {
      logger.info(`Attempting to link GitHub repo ${repoData.fullName} to Netlify site ${siteId}`);
      
      // Include build settings in the request payload
      const requestBody: any = {
        build_settings: {
          provider: 'github',
          repo_url: `https://github.com/${repoData.fullName}`,
          repo_branch: repoData.defaultBranch || 'main'
        }
      };
      
      // Add build command and publish directory if provided
      if (buildSettings) {
        logger.info(`Including build settings in GitHub linking request:`, {
          cmd: buildSettings.cmd,
          dir: buildSettings.dir
        });
        
        if (buildSettings.cmd) {
          requestBody.build_settings.cmd = buildSettings.cmd;
        }
        
        if (buildSettings.dir) {
          requestBody.build_settings.dir = buildSettings.dir;
        }
        
        // Add environment variables if provided
        if (buildSettings.env && Object.keys(buildSettings.env).length > 0) {
          requestBody.build_settings.env = buildSettings.env;
        }
      }
      
      // Log the full request for debugging
      logger.debug(`Netlify API request payload:`, JSON.stringify(requestBody, null, 2));
      
      // Try the direct build settings approach first
      const response = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}`, {
        method: 'PATCH',
        headers: this.getNetlifyHeaders(),
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        let errorData: NetlifyErrorResponse | string = '';
        try {
          errorData = await response.json() as NetlifyErrorResponse;
        } catch (jsonError) {
          // Handle case where response is not JSON
          const textResponse = await response.text();
          logger.error(`Non-JSON error response from Netlify API: ${textResponse}`);
          errorData = textResponse;
        }
        
        logger.error(`Failed to link GitHub repo to Netlify site ${siteId} using direct method:`, errorData);
        
        // Try alternative approach with service instances
        logger.info(`Trying alternative method to link GitHub repo ${repoData.fullName}`);
        const altResponse = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}/service-instances`, {
          method: 'POST',
          headers: this.getNetlifyHeaders(),
          body: JSON.stringify({
            service: 'github',
            repo: repoData.fullName,
            branch: repoData.defaultBranch || 'main'
          })
        });
        
        if (!altResponse.ok) {
          let altErrorData: NetlifyErrorResponse | string = '';
          try {
            altErrorData = await altResponse.json() as NetlifyErrorResponse;
          } catch (jsonError) {
            // Handle case where response is not JSON
            const textResponse = await altResponse.text();
            logger.error(`Non-JSON error response from Netlify API: ${textResponse}`);
            altErrorData = textResponse;
          }
          
          logger.error(`Alternative method also failed:`, altErrorData);
          return false;
        }
        
        logger.info(`Successfully linked GitHub repo ${repoData.fullName} to Netlify site ${siteId} using alternative method`);
        
        // Since we used the alternative method, we need to update build settings separately
        if (buildSettings) {
          logger.info(`Setting build configuration after GitHub linking...`);
          const configResponse = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}`, {
            method: 'PATCH',
            headers: this.getNetlifyHeaders(),
            body: JSON.stringify({
              build_settings: {
                cmd: buildSettings.cmd,
                dir: buildSettings.dir,
                env: buildSettings.env
              }
            })
          });
          
          if (!configResponse.ok) {
            try {
              const configErrorData = await configResponse.json();
              logger.warn(`Failed to update build settings after GitHub linking:`, configErrorData);
            } catch (jsonError) {
              const textResponse = await configResponse.text();
              logger.warn(`Failed to update build settings, non-JSON response: ${textResponse}`);
            }
          } else {
            logger.info(`Successfully updated build settings for Netlify site ${siteId}`);
          }
        }
        
        // Verify the linking
        const linkingVerification = await this.verifyGitHubLinking(siteId);
        if (linkingVerification.isLinked) {
          logger.info(`Verified GitHub repository linking with build settings:`, {
            repoUrl: linkingVerification.repoUrl,
            buildCommand: linkingVerification.buildCommand,
            publishDir: linkingVerification.publishDir
          });
        } else {
          logger.warn(`GitHub repository appears to be linked but verification failed`);
        }
        
        return true;
      }

      logger.info(`Successfully linked GitHub repo ${repoData.fullName} to Netlify site ${siteId}`);
      
      // Verify the linking
      const linkingVerification = await this.verifyGitHubLinking(siteId);
      if (linkingVerification.isLinked) {
        logger.info(`Verified GitHub repository linking with build settings:`, {
          repoUrl: linkingVerification.repoUrl,
          buildCommand: linkingVerification.buildCommand,
          publishDir: linkingVerification.publishDir
        });
      } else {
        logger.warn(`GitHub repository appears to be linked but verification failed`);
      }
      
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
      const netlifyData = await this.createSite({
        name: netlifyName,
        githubRepo: githubResult.repositoryInfo.fullName,
        githubBranch: githubResult.repositoryInfo.defaultBranch
      });
      if (!netlifyData) {
        throw this.createError(
          DeploymentErrorType.INITIALIZATION_FAILED,
          `Failed to create Netlify site for ${netlifyName}`
        );
      }
      logger.info(`Netlify site created: ${netlifyData.name} (${netlifyData.id})`);

      // Link the GitHub repo to the Netlify site
      logger.info(`Step 3: Linking GitHub repository to Netlify site`);
      
      // Detect build settings from the files
      const buildSettings = this.detectBuildSettings(options.files || {});
      logger.info(`Detected build settings for ${sanitizedName}:`, {
        buildCommand: buildSettings.cmd,
        publishDir: buildSettings.dir,
        envVars: Object.keys(buildSettings.env)
      });
      
      const linkSuccess = await this.linkGitHubRepo(netlifyData.id, {
        fullName: githubResult.repositoryInfo.fullName,
        defaultBranch: githubResult.repositoryInfo.defaultBranch
      }, buildSettings);
      
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
        url: netlifyData.ssl_url || netlifyData.url,
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
      logger.info(`Starting Netlify-GitHub deployment with sequential flow: ${options.projectName || options.projectId}`, {
        projectId: options.projectId,
        hasMetadata: !!options.metadata
      });
      
      if (!options.projectId) {
        throw this.createError(
          DeploymentErrorType.UNKNOWN,
          'Project ID is required for Netlify-GitHub deployments'
        );
      }
      
      // 1. Set up or update GitHub repository
      let githubInfo: GitHubRepositoryInfo | undefined;
      const projectName = this.getValidProjectName(options.projectId);
      const filteredFiles = this.filterFiles(options.files || {});
      
      logger.info(`Step 1: Setting up GitHub repository for ${projectName}`);
      // Check if we already have GitHub info in the metadata
      const trackingData = githubIntegration.extractGitHubMetadata(options.metadata);
      githubInfo = trackingData.github;
      
      if (githubInfo && trackingData.repoCreated) {
        // Update existing GitHub repository if we have files
        logger.info(`Updating existing GitHub repository: ${githubInfo.fullName}`);
        if (Object.keys(filteredFiles).length > 0) {
          const updateResult = await githubIntegration.uploadFiles({
            token: this.githubToken,
            projectId: options.projectId,
            repositoryInfo: githubInfo,
            files: filteredFiles,
            metadata: options.metadata
          });
          
          if (!updateResult.success) {
            logger.error(`Failed to update GitHub repository: ${updateResult.error || 'Unknown error'}`);
          }
        }
      } else {
        // Create new GitHub repository
        logger.info(`Creating new GitHub repository for ${projectName}`);
        const githubResult = await githubIntegration.setupRepository({
          token: this.githubToken,
          owner: this.githubOwner,
          projectId: options.projectId,
          projectName,
          files: filteredFiles,
          description: `Generated application for ${options.projectName || projectName}`,
          metadata: options.metadata
        });
        
        if (!githubResult.repositoryInfo) {
          throw this.createError(
            DeploymentErrorType.DEPLOYMENT_FAILED,
            `Failed to set up GitHub repository: ${githubResult.error || 'Unknown error'}`
          );
        }
        
        githubInfo = githubResult.repositoryInfo;
        logger.info(`Created GitHub repository: ${githubInfo.fullName}`);
      }
      
      // 2. Create Netlify site
      logger.info(`Step 2: Creating Netlify site for ${projectName}`);
      const netlifyData = await this.createSite({
        name: projectName,
        buildSettings: this.detectBuildSettings(filteredFiles)
      });
      
      if (!netlifyData) {
        throw this.createError(
          DeploymentErrorType.DEPLOYMENT_FAILED,
          `Failed to create Netlify site for ${projectName}`
        );
      }
      
      logger.info(`Created Netlify site: ${netlifyData.name} (${netlifyData.id})`);
      
      // 3. Link GitHub repository to Netlify site
      logger.info(`Step 3: Linking GitHub repository to Netlify site`);
      
      // Detect build settings from the files
      const buildSettings = this.detectBuildSettings(filteredFiles);
      logger.info(`Detected build settings for ${projectName}:`, {
        buildCommand: buildSettings.cmd,
        publishDir: buildSettings.dir,
        envVars: Object.keys(buildSettings.env)
      });
      
      const linkSuccess = await this.linkGitHubRepo(netlifyData.id, {
        fullName: githubInfo.fullName,
        defaultBranch: githubInfo.defaultBranch || 'main'
      }, buildSettings);
      
      if (!linkSuccess) {
        throw this.createError(
          DeploymentErrorType.DEPLOYMENT_FAILED,
          `Failed to link GitHub repo ${githubInfo.fullName} to Netlify site ${netlifyData.id}`
        );
      }
      
      logger.info(`Successfully linked GitHub repo ${githubInfo.fullName} to Netlify site ${netlifyData.id}`);
      
      // 4. Return deployment result
      return {
        id: `github-${Date.now()}`,
        url: netlifyData.ssl_url || netlifyData.url,
        status: 'in-progress',
        provider: this.getProviderType(),
        logs: [`GitHub repository linked to Netlify site. Waiting for build to complete.`],
        metadata: {
          netlify: {
            siteId: netlifyData.id,
            siteName: netlifyData.name,
            siteUrl: netlifyData.ssl_url || netlifyData.url
          },
          github: githubInfo
        }
      };
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
        url: string;
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

  /**
   * Log debug information about the target configuration
   */
  logDebugInfo(): void {
    logger.info('NetlifyGitHubTarget configuration:', {
      hasNetlifyToken: !!this.netlifyToken,
      netlifyTokenLength: this.netlifyToken ? this.netlifyToken.length : 0,
      hasGithubToken: !!this.githubToken,
      githubTokenLength: this.githubToken ? this.githubToken.length : 0,
      hasGithubOwner: !!this.githubOwner
    });
  }

  /**
   * Verify if a Netlify site is properly linked to GitHub and has correct build settings
   */
  private async verifyGitHubLinking(siteId: string): Promise<{ 
    isLinked: boolean; 
    repoUrl?: string; 
    buildCommand?: string; 
    publishDir?: string; 
  }> {
    try {
      logger.info(`Verifying GitHub linking for Netlify site ${siteId}...`);
      
      // Get site details including build settings
      const siteData = await this.getSite(siteId);
      if (!siteData) {
        logger.warn(`Cannot verify GitHub linking - site ${siteId} not found`);
        return { isLinked: false };
      }
      
      // Log the complete site data for debugging
      logger.debug(`Netlify site data:`, JSON.stringify(siteData, null, 2));
      
      // Check if the site has build settings with GitHub provider
      const buildSettings = siteData.build_settings || {};
      const isLinked = buildSettings.provider === 'github' && !!buildSettings.repo_url;
      
      if (isLinked) {
        logger.info(`Netlify site ${siteId} is linked to GitHub repository: ${buildSettings.repo_url}`);
        return {
          isLinked: true,
          repoUrl: buildSettings.repo_url,
          buildCommand: buildSettings.cmd || 'No build command specified',
          publishDir: buildSettings.dir || 'No publish directory specified'
        };
      } else {
        logger.warn(`Netlify site ${siteId} is not linked to any GitHub repository`);
        return { isLinked: false };
      }
    } catch (error) {
      logger.error(`Error verifying GitHub linking for Netlify site ${siteId}:`, error);
      return { isLinked: false };
    }
  }
}