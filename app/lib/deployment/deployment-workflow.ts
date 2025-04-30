import { createScopedLogger } from '~/utils/logger';
import { getDeploymentManager } from './deployment-manager';
import { getProjectStateManager } from '~/lib/projects';
import { GitHubIntegrationService } from './github-integration';
import type { DeploymentResult } from './types';
import type { GitHubRepositoryInfo, ProjectDeployment } from '~/lib/projects/types';
import { v4 as uuidv4 } from 'uuid';

// Add message property to DeploymentResult type
interface ExtendedDeploymentResult extends DeploymentResult {
  message?: string;
}

const logger = createScopedLogger('deployment-workflow-service');

/**
 * Credentials for various deployment providers
 */
export interface DeploymentCredentials {
  netlify?: {
    apiToken: string;
  };
  github?: {
    token: string;
    owner?: string;
  };
  cloudflare?: {
    accountId: string;
    apiToken: string;
    projectName?: string;
  };
}

/**
 * Options for deploying a project
 */
export interface DeploymentWorkflowOptions {
  projectId: string;
  projectName: string;
  files: Record<string, string>;
  targetName?: string;
  credentials?: Record<string, any>;
  metadata?: Record<string, any>;
  setupGitHub?: boolean;
  githubInfo?: GitHubRepositoryInfo;
}

/**
 * Deployment workflow process state
 */
export enum DeploymentWorkflowState {
  INITIALIZED = 'initialized',
  PROJECT_LOADED = 'project-loaded',
  GITHUB_REPO_CREATED = 'github-repo-created',
  GITHUB_FILES_UPLOADED = 'github-files-uploaded',
  NETLIFY_SITE_CREATED = 'netlify-site-created',
  NETLIFY_GITHUB_LINKED = 'netlify-github-linked',
  DEPLOYMENT_COMPLETE = 'deployment-complete',
  DEPLOYING = 'deploying',
  FAILED = 'failed'
}

/**
 * Deployment workflow context for tracking state
 */
interface DeploymentWorkflowContext {
  state: DeploymentWorkflowState;
  projectId: string;
  projectName: string;
  targetName?: string;
  setupGitHub: boolean;
  tenantId?: string;
  github?: {
    token: string;
    owner?: string;
    repositoryInfo?: GitHubRepositoryInfo;
    repoCreated: boolean;
    filesUploaded: boolean;
  };
  netlify?: {
    apiToken: string;
    siteId?: string;
    siteName?: string;
    siteUrl?: string;
    linkedToGitHub: boolean;
  };
  cloudflare?: {
    accountId?: string;
    apiToken?: string;
    projectName?: string;
  };
  result?: DeploymentResult;
  error?: string;
  startTime: number;
  lastUpdated: number;
  logs: string[];
  files: Record<string, string>;
}

/**
 * A centralized service for handling the entire deployment workflow.
 * This ensures that GitHub repositories are only created once and that
 * all targets use the same GitHub repository information.
 */
export class DeploymentWorkflowService {
  private static instance: DeploymentWorkflowService;

  private constructor() {
    logger.info('DeploymentWorkflowService initialized');
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): DeploymentWorkflowService {
    if (!DeploymentWorkflowService.instance) {
      DeploymentWorkflowService.instance = new DeploymentWorkflowService();
    }
    return DeploymentWorkflowService.instance;
  }

  /**
   * Creates a new workflow context with initial state
   */
  private createWorkflowContext(options: DeploymentWorkflowOptions): DeploymentWorkflowContext {
    const { projectId, projectName, targetName, setupGitHub, credentials, metadata, files } = options;
    
    const now = Date.now();
    
    // Initialize context with defaults
    const context: DeploymentWorkflowContext = {
      state: DeploymentWorkflowState.INITIALIZED,
      projectId,
      projectName,
      targetName,
      setupGitHub: !!setupGitHub || targetName === 'netlify-github',
      tenantId: metadata?.tenantId,
      startTime: now,
      lastUpdated: now,
      logs: [`Deployment workflow initialized for project: ${projectName} (${projectId})`],
      files
    };
    
    // Add credentials to context
    if (credentials?.github?.token) {
      context.github = {
        token: credentials.github.token,
        owner: credentials.github.owner,
        repoCreated: false,
        filesUploaded: false
      };
      context.logs.push('GitHub credentials provided');
    }
    
    if (credentials?.netlify?.apiToken) {
      context.netlify = {
        apiToken: credentials.netlify.apiToken,
        linkedToGitHub: false
      };
      context.logs.push('Netlify credentials provided');
    }
    
    if (credentials?.cloudflare?.accountId && credentials?.cloudflare?.apiToken) {
      context.cloudflare = {
        accountId: credentials.cloudflare.accountId,
        apiToken: credentials.cloudflare.apiToken,
        projectName: credentials.cloudflare.projectName
      };
      context.logs.push('Cloudflare credentials provided');
    }
    
    return context;
  }

  /**
   * Update workflow context and log the state transition
   */
  private updateWorkflowState(
    context: DeploymentWorkflowContext, 
    state: DeploymentWorkflowState, 
    logMessage: string
  ): DeploymentWorkflowContext {
    logger.info(`[Workflow] ${context.projectId}: ${context.state} -> ${state}: ${logMessage}`);
    
    return {
      ...context,
      state,
      lastUpdated: Date.now(),
      logs: [...context.logs, logMessage]
    };
  }
  
  /**
   * Load project metadata and update the context
   */
  private async loadProjectMetadata(
    context: DeploymentWorkflowContext,
    metadata: Record<string, any> = {}
  ): Promise<{ context: DeploymentWorkflowContext; metadata: Record<string, any> }> {
    try {
      const projectManager = getProjectStateManager();
      let combinedMetadata = { ...metadata };
      
      logger.debug(`Checking if project ${context.projectId} exists`);
      const exists = await projectManager.projectExists(context.projectId);
      
      if (exists) {
        const updatedContext = this.updateWorkflowState(
          context,
          DeploymentWorkflowState.PROJECT_LOADED,
          `Project ${context.projectId} loaded from storage`
        );
        
        // Get project and do a null check
        const project = await projectManager.getProject(context.projectId);
        
        // If project doesn't exist (should never happen since we checked exists)
        if (!project) {
          logger.warn(`Project ${context.projectId} exists but could not be loaded`);
          return { 
            context: updatedContext, 
            metadata: combinedMetadata 
          };
        }
        
        // Project is guaranteed to be non-null here
        
        // Merge existing metadata with provided metadata
        combinedMetadata = {
          ...project.metadata,
          ...metadata
        };
        
        // Check if project already has GitHub info
        if (project.metadata?.github && updatedContext.github) {
          updatedContext.github.repositoryInfo = project.metadata.github;
          updatedContext.github.repoCreated = true;
          
          updatedContext.logs.push(
            `Found existing GitHub repository: ${project.metadata.github.fullName}`
          );
        }
        
        // Check if project already has Netlify info
        if (project.metadata?.netlify && updatedContext.netlify) {
          updatedContext.netlify.siteId = project.metadata.netlify.siteId;
          updatedContext.netlify.siteName = project.metadata.netlify.siteName;
          updatedContext.netlify.siteUrl = project.metadata.netlify.siteUrl;
          
          if (project.metadata.netlify.linkedToGitHub) {
            updatedContext.netlify.linkedToGitHub = true;
          }
          
          updatedContext.logs.push(
            `Found existing Netlify site: ${project.metadata.netlify.siteName || project.metadata.netlify.siteId}`
          );
        }
        
        return { context: updatedContext, metadata: combinedMetadata };
      } else {
        return { 
          context: this.updateWorkflowState(
            context,
            DeploymentWorkflowState.PROJECT_LOADED,
            `Project ${context.projectId} not found in storage, proceeding with provided metadata only`
          ), 
          metadata: combinedMetadata 
        };
      }
    } catch (error) {
      logger.error(`Error loading project metadata for ${context.projectId}:`, error);
      return { 
        context: this.updateWorkflowState(
          context,
          DeploymentWorkflowState.PROJECT_LOADED,
          `Error loading project: ${error instanceof Error ? error.message : 'Unknown error'}`
        ), 
        metadata 
      };
    }
  }
  
  /**
   * Setup GitHub repository if needed
   */
  private async setupGitHubRepository(
    context: DeploymentWorkflowContext,
    metadata: Record<string, any>,
    files: Record<string, string>
  ): Promise<{ context: DeploymentWorkflowContext; metadata: Record<string, any> }> {
    // Skip if no GitHub credentials or if repository already exists
    if (!context.github || !context.setupGitHub) {
      return { context, metadata };
    }
    
    if (context.github.repositoryInfo) {
      return { 
        context: this.updateWorkflowState(
          context,
          DeploymentWorkflowState.GITHUB_REPO_CREATED,
          `Using existing GitHub repository: ${context.github.repositoryInfo.fullName}`
        ), 
        metadata 
      };
    }
    
    try {
      // Create GitHub repository
      const githubService = GitHubIntegrationService.getInstance();
      
      const result = await githubService.setupRepository({
        token: context.github.token,
        owner: context.github.owner,
        projectId: context.projectId,
        projectName: context.projectName,
        files,
        isPrivate: true,
        metadata
      });
      
      if (result.repositoryInfo) {
        const updatedContext = this.updateWorkflowState(
          context,
          DeploymentWorkflowState.GITHUB_REPO_CREATED,
          `GitHub repository created: ${result.repositoryInfo.fullName}`
        );
        
        if (updatedContext.github) { // Ensure github exists
          updatedContext.github.repositoryInfo = result.repositoryInfo;
          updatedContext.github.repoCreated = true;
          updatedContext.github.filesUploaded = true;
        }
        
        // Save GitHub info back to the project
        try {
          const projectManager = getProjectStateManager();
          await projectManager.updateProject(context.projectId, {
            metadata: {
              github: result.repositoryInfo
            }
          });
          
          updatedContext.logs.push(`Project metadata updated with GitHub repository info`);
        } catch (saveError) {
          updatedContext.logs.push(`Warning: Failed to save GitHub info to project: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`);
        }
        
        return { 
          context: this.updateWorkflowState(
            updatedContext,
            DeploymentWorkflowState.GITHUB_FILES_UPLOADED,
            `Files uploaded to GitHub repository: ${result.repositoryInfo.fullName}`
          ), 
          metadata: result.updatedMetadata 
        };
      } else {
        return { 
          context: this.updateWorkflowState(
            context,
            DeploymentWorkflowState.FAILED,
            `Failed to create GitHub repository: ${result.error || 'Unknown error'}`
          ), 
          metadata 
        };
      }
    } catch (error) {
      return { 
        context: this.updateWorkflowState(
          context,
          DeploymentWorkflowState.FAILED,
          `Error creating GitHub repository: ${error instanceof Error ? error.message : 'Unknown error'}`
        ), 
        metadata 
      };
    }
  }

  /**
   * Deploy a project with the workflow:
   * 1. Set up GitHub repository if needed or use existing one
   * 2. Deploy to the selected target
   */
  public async deployProject(options: DeploymentWorkflowOptions): Promise<DeploymentResult> {
    const { 
      projectId, 
      projectName, 
      files, 
      targetName, 
      setupGitHub, 
      credentials, 
      metadata = {},
      githubInfo
    } = options;
    
    logger.info('🚀 Starting deployment workflow', {
      projectId, 
      projectName, 
      targetName,
      setupGitHub,
      hasGithubCreds: !!credentials?.github?.token,
      hasNetlifyCreds: !!credentials?.netlify?.apiToken,
      hasCloudflareCredentials: !!(credentials?.cloudflare?.accountId && credentials?.cloudflare?.apiToken),
      hasExistingGithubInfo: !!metadata?.github || !!githubInfo
    });
    
    // Create workflow context with initial state
    let context = this.createWorkflowContext({
      projectId,
      projectName: projectName || 'Unknown Project',
      targetName,
      setupGitHub,
      credentials,
      metadata,
      files
    });
    
    try {
      // Load project metadata to get existing info
      const result = await this.loadProjectMetadata(context, metadata);
      context = result.context;
      const combinedMetadata = result.metadata;
      
      // Use GitHub info from options if provided (highest priority)
      if (githubInfo && !context.github?.repositoryInfo) {
        logger.info('Using GitHub repository information from options', {
          repoName: githubInfo.fullName,
          repoUrl: githubInfo.url
        });
        
        if (!context.github) {
          context.github = {
            token: credentials?.github?.token,
            owner: credentials?.github?.owner,
            repositoryInfo: githubInfo,
            repoCreated: true,
            filesUploaded: true
          };
        } else {
          context.github.repositoryInfo = githubInfo;
          context.github.repoCreated = true;
          context.github.filesUploaded = true;
        }
        
        // Update workflow state to reflect we're using existing GitHub repo
        context = this.updateWorkflowState(
          context,
          DeploymentWorkflowState.GITHUB_REPO_CREATED,
          `Using existing GitHub repository: ${githubInfo.fullName}`
        );
        
        // Also mark files as uploaded since we'll use the existing repo
        context = this.updateWorkflowState(
          context,
          DeploymentWorkflowState.GITHUB_FILES_UPLOADED,
          'Using existing GitHub repository files'
        );
      }
      // Check if GitHub repository info already exists in metadata
      else if (metadata?.github && !context.github?.repositoryInfo) {
        // Add existing GitHub info from metadata if available
        logger.info('Using existing GitHub repository information from metadata', {
          repoName: metadata.github.fullName,
          repoUrl: metadata.github.url
        });
        
        if (context.github) {
          context.github.repositoryInfo = metadata.github;
          context.github.repoCreated = true;
          context.github.filesUploaded = true;
          
          // Add this info to the log
          context.logs.push(`Using existing GitHub repository: ${metadata.github.fullName}`);
        }
      }
      
      // Skip GitHub repository setup if not needed or already set up
      if (context.github?.repositoryInfo || !context.setupGitHub) {
        logger.info('Skipping GitHub repository setup', {
          hasExistingRepo: !!context.github?.repositoryInfo,
          setupGitHubRequested: context.setupGitHub
        });
        
        if (context.github?.repositoryInfo) {
          context = this.updateWorkflowState(
            context,
            DeploymentWorkflowState.GITHUB_REPO_CREATED,
            `Using existing GitHub repository: ${context.github.repositoryInfo.fullName}`
          );
          
          // Also mark files as uploaded since we'll use the existing repo
          context = this.updateWorkflowState(
            context,
            DeploymentWorkflowState.GITHUB_FILES_UPLOADED,
            'Using existing GitHub repository, skipping file upload'
          );
        }
      } else {
        // Set up GitHub repository if needed and credentials are available
        const isGitHubSetupNeeded = context.setupGitHub && credentials?.github;
        
        if (isGitHubSetupNeeded) {
          const githubSetup = await this.setupGitHubRepository(
            context,
            combinedMetadata,
            files
          );
          
          context = githubSetup.context;
        }
      }
      
      // Deploy with the selected target, preferring netlify over netlify-github
      // to prevent duplicate GitHub repository creation
      if (context.targetName === 'netlify-github' && context.github?.repositoryInfo) {
        logger.info('Switching from netlify-github to netlify target to prevent duplicate GitHub setup');
        context.targetName = 'netlify';
      }
      
      const deploymentResult = await this.deployWithOriginalTarget(
        context,
        combinedMetadata,
        files
      );
      
      // Save deployment information to the project
      if (deploymentResult) {
        await this.saveDeploymentToProject(context, deploymentResult);
      }
      
      return deploymentResult || {
        id: `error-${Date.now()}`,
        url: '',
        status: 'failed' as const,
        provider: 'unknown',
        error: 'Deployment failed - no result returned',
        logs: []
      };
    } catch (error) {
      logger.error(`Deployment workflow error for project ${projectId}:`, error);
      
      // Update workflow state to failed
      context = this.updateWorkflowState(
        context,
        DeploymentWorkflowState.FAILED,
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      
      return {
        id: `error-${Date.now()}`,
        url: '',
        status: 'failed' as const,
        provider: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
        logs: context.logs || []
      };
    }
  }
  
  /**
   * Deploy the project using the original deployment orchestration
   */
  private async deployWithOriginalTarget(
    context: DeploymentWorkflowContext,
    metadata: Record<string, any>,
    files: Record<string, string>
  ): Promise<DeploymentResult> {
    logger.info('🧩 Deploying with target', {
      targetName: context.targetName,
      hasGithubInfo: !!context.github?.repositoryInfo,
      githubRepo: context.github?.repositoryInfo?.fullName || 'none',
      hasNetlifyToken: !!context.netlify?.apiToken,
      tokenLength: context.netlify?.apiToken ? context.netlify.apiToken.length : 0,
      tenantId: context.tenantId || 'default'
    });
    
    // Update workflow state to DEPLOYING
    context = this.updateWorkflowState(
      context,
      DeploymentWorkflowState.DEPLOYING,
      `Starting deployment with target: ${context.targetName || 'default'}`
    );
    
    // Ensure GitHub info is properly structured and complete
    let enhancedGithubInfo = null;
    if (context.github?.repositoryInfo) {
      enhancedGithubInfo = {
        ...context.github.repositoryInfo,
        owner: context.github.owner || context.github.repositoryInfo.fullName?.split('/')[0],
        token: context.github.token  // Add token to GitHub info for authentication
      };
      
      logger.debug('Enhanced GitHub repository info for deployment:', {
        fullName: enhancedGithubInfo.fullName,
        url: enhancedGithubInfo.url,
        owner: enhancedGithubInfo.owner,
        hasToken: !!enhancedGithubInfo.token
      });
    }
    
    logger.debug('Getting deployment manager with credentials...');
    
    // Get deployment manager with necessary credentials
    const deploymentManager = await getDeploymentManager({
      netlifyToken: context.netlify?.apiToken,
      githubToken: context.github?.token,
      githubOwner: context.github?.owner,  // Pass GitHub owner explicitly
      cloudflareConfig: context.cloudflare?.accountId && context.cloudflare?.apiToken 
        ? {
            accountId: context.cloudflare.accountId,
            apiToken: context.cloudflare.apiToken,
            projectName: context.cloudflare.projectName
          }
        : undefined
    });
    
    // Log credentials for debugging
    logger.debug('Deployment credentials being passed to manager:', {
      hasNetlifyToken: !!context.netlify?.apiToken,
      netlifyTokenLength: context.netlify?.apiToken ? context.netlify.apiToken.length : 0,
      hasGithubToken: !!context.github?.token,
      hasCloudflare: !!(context.cloudflare?.accountId && context.cloudflare?.apiToken)
    });
    
    // Determine target options based on GitHub availability
    const targetOptions = {
      preferGitHub: !!enhancedGithubInfo,
      githubRepository: enhancedGithubInfo,
    };
    
    logger.info('Target selection options', {
      requestedTarget: context.targetName,
      preferGitHub: targetOptions.preferGitHub,
      hasGitHubRepo: !!targetOptions.githubRepository,
    });
    
    // Build deployment options with explicit GitHub info if available
    const deployOptions = {
      projectName: context.projectName,
      files,
      projectId: context.projectId,
      targetName: context.targetName,
      metadata: {
        ...metadata,
        github: enhancedGithubInfo,  // Use enhanced GitHub info
        tenantId: context.tenantId,
        hasGithubSetup: true
      }
    };
    
    logger.debug('Calling deployWithBestTarget with options:', {
      projectId: deployOptions.projectId,
      targetName: deployOptions.targetName,
      hasGithubInfo: !!deployOptions.metadata?.github
    });
    
    try {
      // Deploy with orchestrator
      const deploymentResult = await deploymentManager.deployWithBestTarget(deployOptions);
      
      logger.info('Deployment result received:', { 
        status: deploymentResult.status,
        provider: deploymentResult.provider,
        url: deploymentResult.url || 'none'
      });
    
      // Update context with result
      context.result = deploymentResult;
      
      // Update workflow state based on deployment result
      context = this.updateWorkflowState(
        context,
        deploymentResult.status === 'success'
          ? DeploymentWorkflowState.DEPLOYMENT_COMPLETE
          : DeploymentWorkflowState.FAILED,
        `Deployment ${deploymentResult.status} using ${deploymentResult.provider}: ${deploymentResult.url || 'N/A'}`
      );
      
      return deploymentResult;
    } catch (error) {
      logger.error('⚠️ Deployment failed with error:', error);
      
      // Update context with failure state
      context = this.updateWorkflowState(
        context,
        DeploymentWorkflowState.FAILED,
        `Deployment failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      
      throw error;
    }
  }

  /**
   * Save deployment information back to the project metadata
   */
  private async saveDeploymentToProject(context: DeploymentWorkflowContext, deployment: DeploymentResult): Promise<void> {
    try {
      const projectManager = getProjectStateManager();
      
      // Create deployment record with proper type mapping
      const deploymentRecord: ProjectDeployment = {
        id: deployment.id || uuidv4(),
        provider: deployment.provider,
        url: deployment.url || '',
        status: deployment.status === 'success' ? 'success' : 'failed',
        timestamp: Date.now(),
        errorMessage: deployment.error,
        metadata: {
          targetName: context.targetName,
          tenantId: context.tenantId,
          duration: (Date.now() - context.startTime) / 1000,
          message: typeof deployment.metadata?.message === 'string' 
            ? deployment.metadata.message 
            : undefined
        }
      };
      
      // Add deployment to project using the addDeployment method
      await projectManager.addDeployment(context.projectId, deploymentRecord, context.tenantId);
      
      // Get the current project state to update metadata
      const project = await projectManager.getProject(context.projectId);
      
      // Skip if project doesn't exist
      if (!project) {
        logger.warn(`Cannot update metadata - project ${context.projectId} not found`);
        return;
      }
      
      // Update the project metadata
      const lastDeployedUrl = deployment.url || project.metadata?.lastDeployedUrl || '';
      const lastDeploymentId = deployment.id || project.metadata?.lastDeploymentId || '';
      const lastDeploymentTarget = deployment.provider || project.metadata?.lastDeploymentTarget || '';
      
      // Update only the metadata portion
      await projectManager.updateProject(context.projectId, {
        metadata: {
          ...project.metadata,
          lastDeployedUrl,
          lastDeploymentId,
          lastDeploymentTarget,
          lastDeploymentTimestamp: new Date().toISOString()
        }
      });
      
      logger.info(`Updated project ${context.projectId} with deployment info`, {
        deploymentId: deployment.id,
        provider: deployment.provider
      });
    } catch (error) {
      logger.error(`Failed to save deployment info to project: ${error instanceof Error ? error.message : 'Unknown error'}`);
      context.logs.push(`Warning: Failed to update project with deployment info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Export a function to get the singleton instance
export function getDeploymentWorkflowService(): DeploymentWorkflowService {
  return DeploymentWorkflowService.getInstance();
} 