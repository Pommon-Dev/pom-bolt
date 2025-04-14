import { createScopedLogger } from '~/utils/logger';
import { getDeploymentManager } from './deployment-manager';
import { getProjectStateManager } from '~/lib/projects';
import { GitHubIntegrationService } from './github-integration';
import type { DeploymentResult } from './types';
import type { GitHubRepositoryInfo } from '~/lib/projects/types';

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
 * Options for the deployment workflow
 */
export interface DeploymentWorkflowOptions {
  projectId: string;
  projectName: string;
  files: Record<string, string>;
  targetName?: string;
  setupGitHub?: boolean;
  credentials?: DeploymentCredentials;
  metadata?: Record<string, any>;
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
    const { projectId, projectName, targetName, setupGitHub, credentials } = options;
    
    const now = Date.now();
    
    // Initialize context with defaults
    const context: DeploymentWorkflowContext = {
      state: DeploymentWorkflowState.INITIALIZED,
      projectId,
      projectName,
      targetName,
      setupGitHub: !!setupGitHub || targetName === 'netlify-github',
      startTime: now,
      lastUpdated: now,
      logs: [`Deployment workflow initialized for project: ${projectName} (${projectId})`]
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
        
        const project = await projectManager.getProject(context.projectId);
        
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
   * Deploy a project using the unified workflow.
   * This handles GitHub repository setup if needed and ensures
   * that operations only happen once per project.
   */
  public async deployProject(options: DeploymentWorkflowOptions): Promise<DeploymentResult> {
    const {
      projectId,
      projectName,
      files,
      targetName,
      metadata = {}
    } = options;

    // Create initial workflow context
    let context = this.createWorkflowContext(options);
    
    logger.info(`Starting deployment workflow for project: ${projectId} (${projectName})`, {
      target: targetName || 'auto-select',
      setupGitHub: context.setupGitHub,
      hasGithubCredentials: !!context.github?.token,
      hasNetlifyCredentials: !!context.netlify?.apiToken,
      hasCloudflareCredentials: !!(context.cloudflare?.accountId && context.cloudflare?.apiToken)
    });

    try {
      // Step 1: Load project metadata
      let combinedMetadata: Record<string, any>;
      ({ context, metadata: combinedMetadata } = await this.loadProjectMetadata(context, metadata));
      
      // Step 2: Setup GitHub repository if needed
      if (context.setupGitHub && context.github && context.state !== DeploymentWorkflowState.FAILED) {
        ({ context, metadata: combinedMetadata } = await this.setupGitHubRepository(
          context, 
          combinedMetadata, 
          files
        ));
      }
      
      // If any step failed, return an error result
      if (context.state === DeploymentWorkflowState.FAILED) {
        const errorMessage = context.logs[context.logs.length - 1];
        return {
          id: `failed-${Date.now()}`,
          url: '',
          status: 'failed',
          provider: targetName || 'unknown',
          logs: context.logs
        };
      }
      
      // Step 3: Deploy to the target platform
      // For netlify-github, use a direct target instance if we have GitHub info
      const isNetlifyGithubDeployment = 
        targetName === 'netlify-github' && 
        context.github != null && 
        context.github.repositoryInfo != null && 
        context.netlify != null && 
        context.netlify.apiToken != null &&
        context.github.token != null;

      if (isNetlifyGithubDeployment) {
        try {
          // We've already checked these exist above
          const githubInfo = context.github!.repositoryInfo!;
          const githubToken = context.github!.token;
          const netlifyToken = context.netlify!.apiToken;
          const githubOwner = context.github!.owner;

          context = this.updateWorkflowState(
            context,
            DeploymentWorkflowState.NETLIFY_SITE_CREATED,
            `Using Netlify-GitHub deployment with repository: ${githubInfo.fullName}`
          );
          
          const { NetlifyGitHubTarget } = await import('./targets/netlify-github');
          
          // Create a direct instance with all required credentials
          const netlifyGithubTarget = new NetlifyGitHubTarget({ 
            netlifyToken, 
            githubToken,
            githubOwner: githubOwner || githubInfo.owner || ''
          });
          
          // Check if it's available
          const isAvailable = await netlifyGithubTarget.isAvailable();
          if (isAvailable) {
            // Add GitHub info to metadata to ensure it's used
            const deployMetadata = { 
              ...combinedMetadata,
              github: context.github.repositoryInfo
            };
            
            // Initialize the project
            const netlifyProject = await netlifyGithubTarget.initializeProject({
              name: projectName,
              files,
              metadata: deployMetadata
            });
            
            context = this.updateWorkflowState(
              context,
              DeploymentWorkflowState.NETLIFY_GITHUB_LINKED,
              `Netlify site created and linked to GitHub repository: ${netlifyProject.id}`
            );
            
            // Deploy using the initialized project
            const deployment = await netlifyGithubTarget.deploy({
              projectId: netlifyProject.id,
              projectName: netlifyProject.name,
              files,
              metadata: deployMetadata
            });
            
            context = this.updateWorkflowState(
              context,
              DeploymentWorkflowState.DEPLOYMENT_COMPLETE,
              `Netlify-GitHub deployment successful: ${deployment.url}`
            );
            
            context.result = deployment;
            
            // Save netlify site info back to the project
            try {
              const projectManager = getProjectStateManager();
              await projectManager.updateProject(context.projectId, {
                metadata: {
                  netlify: {
                    siteId: netlifyProject.id,
                    siteName: netlifyProject.name,
                    siteUrl: deployment.url,
                    linkedToGitHub: true
                  }
                }
              });
              
              context.logs.push(`Project metadata updated with Netlify site info`);
            } catch (saveError) {
              context.logs.push(`Warning: Failed to save Netlify info to project: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`);
            }
            
            // Save deployment to project
            this.saveDeploymentToProject(context, deployment);
            
            return deployment;
          } else {
            context = this.updateWorkflowState(
              context,
              DeploymentWorkflowState.FAILED,
              `Netlify-GitHub target not available`
            );
          }
        } catch (error) {
          context = this.updateWorkflowState(
            context,
            DeploymentWorkflowState.FAILED,
            `Error in Netlify-GitHub deployment: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
      
      // Fall back to using deployment manager
      context = this.updateWorkflowState(
        context,
        context.state === DeploymentWorkflowState.FAILED 
          ? DeploymentWorkflowState.INITIALIZED 
          : context.state,
        `Using DeploymentManager for deployment${context.state === DeploymentWorkflowState.FAILED ? ' after direct method failed' : ''}`
      );
      
      // Create the deployment manager with credentials
      const deploymentManager = await getDeploymentManager({
        netlifyToken: context.netlify?.apiToken,
        githubToken: context.github?.token,
        cloudflareConfig: context.cloudflare?.accountId && context.cloudflare?.apiToken 
          ? {
              accountId: context.cloudflare.accountId,
              apiToken: context.cloudflare.apiToken,
              projectName: context.cloudflare.projectName
            }
          : undefined
      });
      
      // Deploy using manager
      const deployment = await deploymentManager.deployWithBestTarget({
        projectId,
        projectName,
        files,
        targetName,
        metadata: { 
          ...combinedMetadata,
          github: context.github?.repositoryInfo
        }
      });
      
      context = this.updateWorkflowState(
        context,
        DeploymentWorkflowState.DEPLOYMENT_COMPLETE,
        `Deployment successful using ${deployment.provider}: ${deployment.url}`
      );
      
      context.result = deployment;
      
      // Save deployment to project
      this.saveDeploymentToProject(context, deployment);
      
      logger.info(`Deployment workflow completed for ${projectId}`, {
        url: deployment.url,
        status: deployment.status,
        provider: deployment.provider,
        duration: Date.now() - context.startTime
      });
      
      return deployment;
    } catch (error) {
      logger.error(`Deployment workflow failed for ${projectId}:`, error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      context = this.updateWorkflowState(
        context,
        DeploymentWorkflowState.FAILED,
        `Deployment failed: ${errorMessage}`
      );
      
      return {
        id: `error-${Date.now()}`,
        url: '',
        status: 'failed',
        provider: targetName || 'unknown',
        logs: context.logs
      };
    }
  }
  
  /**
   * Save deployment info to project if needed
   */
  private async saveDeploymentToProject(context: DeploymentWorkflowContext, deployment: DeploymentResult): Promise<void> {
    try {
      const projectManager = getProjectStateManager();
      const exists = await projectManager.projectExists(context.projectId);
      
      if (exists) {
        await projectManager.addDeployment(context.projectId, {
          url: deployment.url,
          provider: deployment.provider,
          timestamp: Date.now(),
          status: deployment.status
        });
        
        logger.info(`Saved deployment information to project: ${context.projectId}`);
      }
    } catch (error) {
      logger.error(`Failed to save deployment to project: ${context.projectId}`, error);
    }
  }
}

// Export a function to get the singleton instance
export function getDeploymentWorkflowService(): DeploymentWorkflowService {
  return DeploymentWorkflowService.getInstance();
} 