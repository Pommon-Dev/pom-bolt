import { createScopedLogger } from '~/utils/logger';
import { DeploymentTargetRegistry } from './target-registry';
import { BuildService } from './build-service';
import { CredentialManager } from './credentials';
import type { DeploymentTarget } from './targets/base';
import type { DeploymentResult } from './types';
import { DeploymentErrorType } from './types';
import { getProjectStateManager } from '~/lib/projects';
import { GitHubIntegrationService } from './github-integration';

const logger = createScopedLogger('deployment-orchestrator');

/**
 * Options for project deployment
 */
export interface DeploymentOptions {
  projectId: string;
  tenantId?: string;
  targetName?: string;
  credentials?: Record<string, any>;
  metadata?: Record<string, any>;
  setupGitHub?: boolean;
}

// Steps in the deployment process
enum DeploymentStep {
  INITIALIZE = 'initialize',
  GITHUB_SETUP = 'github_setup',
  SELECT_TARGET = 'select_target',
  DEPLOY = 'deploy',
  COMPLETE = 'complete',
  FAILED = 'failed'
}

// Context for tracking the deployment process
interface DeploymentContext {
  step: DeploymentStep;
  projectId: string;
  tenantId?: string;
  files: Record<string, string>;
  targetName?: string;
  credentials?: Record<string, any>;
  metadata: Record<string, any>;
  setupGitHub: boolean;
  githubInfo?: any;
  target?: DeploymentTarget;
  result?: DeploymentResult;
  error?: Error;
  logs: string[];
}

/**
 * Deployment Orchestrator
 * Coordinates the entire deployment process from framework detection to deployment
 */
export class DeploymentOrchestrator {
  private buildService: BuildService;
  private credentialManager: CredentialManager;
  
  constructor() {
    this.buildService = new BuildService();
    this.credentialManager = new CredentialManager();
  }
  
  /**
   * Deploy a project
   */
  public async deployProject(options: DeploymentOptions): Promise<DeploymentResult> {
    try {
      logger.info('Starting deployment process', { 
        projectId: options.projectId,
        tenantId: options.tenantId,
        targetName: options.targetName,
        setupGitHub: options.setupGitHub
      });
      
      // Initialize context
      let context = await this.initializeContext(options);
      
      // Proceed with deployment steps
      if (context.step !== DeploymentStep.FAILED) {
        // Set up GitHub if requested
        if (context.setupGitHub) {
          context = await this.setupGitHub(context);
        }
        
        // Select the deployment target
        if (context.step !== DeploymentStep.FAILED) {
          context = await this.selectDeploymentTarget(context);
          
          // Deploy with the selected target
          if (context.step !== DeploymentStep.FAILED && context.target) {
            context = await this.deployWithTarget(context);
          }
        }
      }
      
      // Return result or error
      if (context.step === DeploymentStep.FAILED || !context.result) {
        const errorMessage = context.error?.message || 'Unknown deployment error';
        logger.error('Deployment failed', { error: errorMessage });
        
        return {
          id: `error-${Date.now()}`,
          url: '',
          status: 'failed',
          provider: context.targetName || 'unknown',
          logs: context.logs,
          error: errorMessage
        };
      }
      
      // Deployment was successful
      logger.info('Deployment completed successfully', {
        deploymentId: context.result.id,
        url: context.result.url,
        provider: context.result.provider
      });
      
      return context.result;
    } catch (error) {
      logger.error('Deployment process error:', error);
      throw error;
    }
  }
  
  /**
   * Initialize the deployment context
   */
  private async initializeContext(options: DeploymentOptions): Promise<DeploymentContext> {
    logger.debug('Initializing deployment context');
    try {
      // 1. Validate tenant access if tenant ID is provided
      if (options.tenantId) {
        logger.debug('Validating tenant access', { tenantId: options.tenantId });
        await this.validateTenantAccess(options.projectId, options.tenantId);
      }
      
      // 2. Get project files from project state manager
      const projectManager = getProjectStateManager();
      const project = await projectManager.getProject(options.projectId);
      
      if (!project) {
        logger.error(`Project not found: ${options.projectId}`);
        return {
          step: DeploymentStep.FAILED,
          projectId: options.projectId,
          files: {},
          metadata: options.metadata || {},
          setupGitHub: !!options.setupGitHub,
          targetName: options.targetName,
          credentials: options.credentials,
          tenantId: options.tenantId,
          error: new Error(`Project not found: ${options.projectId}`),
          logs: [`Project not found: ${options.projectId}`]
        };
      }
      
      logger.debug('Project loaded', { 
        name: project.name,
        fileCount: project.files.length,
        tenantId: project.tenantId
      });
      
      // Validate tenant ownership if tenant ID is specified
      if (options.tenantId && project.tenantId && options.tenantId !== project.tenantId) {
        logger.error('Tenant ID mismatch', { 
          requestTenantId: options.tenantId,
          projectTenantId: project.tenantId
        });
        return {
          step: DeploymentStep.FAILED,
          projectId: options.projectId,
          files: {},
          metadata: options.metadata || {},
          setupGitHub: !!options.setupGitHub,
          targetName: options.targetName,
          credentials: options.credentials,
          tenantId: options.tenantId,
          error: new Error('You do not have access to this project'),
          logs: ['Tenant ID mismatch - access denied']
        };
      }
      
      // Convert project files to simple record format
      const files = project.files.reduce((map, file) => {
        if (!file.isDeleted) {
          map[file.path] = file.content;
        }
        return map;
      }, {} as Record<string, string>);
      
      // 3. Build the project
      logger.info('Building project');
      const buildResult = await this.buildService.build(files);
      
      if (!buildResult.success) {
        logger.error('Build failed', { error: buildResult.error });
        return {
          step: DeploymentStep.FAILED,
          projectId: options.projectId,
          files: {},
          metadata: options.metadata || {},
          setupGitHub: !!options.setupGitHub,
          targetName: options.targetName,
          credentials: options.credentials,
          tenantId: options.tenantId,
          error: buildResult.error || new Error('Failed to build project'),
          logs: ['Build failed', buildResult.error?.message || 'Unknown build error']
        };
      }
      
      logger.info('Build completed successfully', { 
        framework: buildResult.frameworkInfo.framework,
        outputFileCount: Object.keys(buildResult.outputFiles).length
      });
      
      // Successfully initialized context
      return {
        step: DeploymentStep.INITIALIZE,
        projectId: options.projectId,
        files: buildResult.outputFiles,
        metadata: {
          ...(options.metadata || {}),
          projectName: project.name,
          framework: buildResult.frameworkInfo.framework,
          buildInfo: {
            outputDir: buildResult.frameworkInfo.outputDirectory,
            buildCommand: buildResult.frameworkInfo.buildCommand
          }
        },
        setupGitHub: !!options.setupGitHub,
        targetName: options.targetName,
        credentials: options.credentials,
        tenantId: options.tenantId,
        logs: [
          `Project loaded: ${project.name} (${options.projectId})`,
          `Build completed successfully with framework: ${buildResult.frameworkInfo.framework}`
        ]
      };
    } catch (error) {
      logger.error('Failed to initialize deployment context:', error);
      return {
        step: DeploymentStep.FAILED,
        projectId: options.projectId,
        files: {},
        metadata: options.metadata || {},
        setupGitHub: !!options.setupGitHub,
        targetName: options.targetName,
        credentials: options.credentials,
        tenantId: options.tenantId,
        error: error instanceof Error ? error : new Error('Failed to initialize deployment context'),
        logs: ['Failed to initialize deployment context', error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }
  
  /**
   * Set up GitHub repository if requested
   */
  private async setupGitHub(context: DeploymentContext): Promise<DeploymentContext> {
    // Skip if no GitHub credentials
    if (!context.credentials?.github?.token) {
      logger.info('Skipping GitHub setup - no GitHub credentials provided');
      return {
        ...context,
        logs: [...context.logs, 'Skipping GitHub setup - no GitHub credentials provided']
      };
    }
    
    try {
      logger.info('Setting up GitHub repository');
      
      // Check if GitHub info already exists in metadata
      if (context.metadata.github) {
        logger.info('Using existing GitHub repository information', { repo: context.metadata.github });
        return {
          ...context,
          githubInfo: context.metadata.github,
          logs: [...context.logs, `Using existing GitHub repository: ${context.metadata.github.fullName}`]
        };
      }
      
      // Create a new GitHub repository
      const githubService = GitHubIntegrationService.getInstance();
      
      const result = await githubService.setupRepository({
        token: context.credentials.github.token,
        owner: context.credentials.github.owner,
        projectId: context.projectId,
        projectName: context.metadata.projectName || `Project-${context.projectId}`,
        files: context.files,
        isPrivate: true,
        metadata: context.metadata
      });
      
      if (result.repositoryInfo) {
        logger.info('GitHub repository created successfully', { repo: result.repositoryInfo.fullName });
        
        // Save GitHub info back to the project
        try {
          const projectManager = getProjectStateManager();
          await projectManager.updateProject(context.projectId, {
            metadata: {
              github: result.repositoryInfo
            }
          });
          
          logger.debug('Project metadata updated with GitHub repository info');
        } catch (saveError) {
          logger.warn('Failed to save GitHub info to project metadata:', saveError);
        }
        
        return {
          ...context,
          step: DeploymentStep.GITHUB_SETUP,
          githubInfo: result.repositoryInfo,
          metadata: {
            ...context.metadata,
            github: result.repositoryInfo
          },
          logs: [...context.logs, `GitHub repository created: ${result.repositoryInfo.fullName}`]
        };
      } else {
        logger.error('Failed to create GitHub repository', { error: result.error });
        
        // Continue without GitHub, but log the error
        return {
          ...context,
          logs: [...context.logs, `Warning: Failed to set up GitHub repository: ${result.error || 'Unknown error'}`]
        };
      }
    } catch (error) {
      logger.error('Error setting up GitHub repository:', error);
      
      // Continue without GitHub, but log the error
      return {
        ...context,
        logs: [...context.logs, `Warning: Error setting up GitHub repository: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }
  
  /**
   * Select the best deployment target based on options and available targets
   */
  private async selectDeploymentTarget(context: DeploymentContext): Promise<DeploymentContext> {
    try {
      let targetName = context.targetName;
      
      // If a specific target is requested, validate and use it
      if (targetName) {
        logger.debug('Using requested deployment target', { targetName });
        const availableTargets = DeploymentTargetRegistry.getAvailableTargets();
        
        if (!availableTargets.includes(targetName)) {
          logger.warn(`Requested deployment target not available: ${targetName}`);
          
          // If netlify-github was requested, use plain netlify instead
          // and pass GitHub info if it's available
          if (targetName === 'netlify-github') {
            logger.info('Using netlify target instead of netlify-github to avoid duplicate GitHub setup');
            targetName = 'netlify';
          } else {
            // Otherwise, use auto-select
            targetName = undefined;
          }
        }
      }
      
      // If target name is still not set, auto-select the best available
      if (!targetName) {
        logger.debug('Selecting best available deployment target');
        
        // Order of preference - always prioritize plain targets over GitHub-specific ones
        // We'll pass GitHub info to these targets if available
        const preferredTargets = ['netlify', 'cloudflare-pages', 'local-zip'];
        
        // Try each target in order of preference
        for (const name of preferredTargets) {
          const factory = DeploymentTargetRegistry.getFactory(name);
          
          if (!factory) {
            continue;
          }
          
          // Check if we have credentials for this target
          const hasCredentials = this.hasCredentialsForTarget(name, context.credentials || {});
          
          if (hasCredentials) {
            targetName = name;
            logger.debug(`Selected deployment target: ${targetName}`);
            break;
          }
        }
        
        // If still no target found, use local-zip as fallback
        if (!targetName) {
          targetName = 'local-zip';
          logger.debug('Using local-zip as fallback deployment target');
        }
      }
      
      // Create the selected target
      const target = await this.createDeploymentTarget(
        targetName, 
        context.credentials || {}, 
        context.tenantId,
        context.githubInfo
      );
      
      if (!target) {
        logger.error(`Failed to create deployment target: ${targetName}`);
        return {
          ...context,
          step: DeploymentStep.FAILED,
          error: new Error(`Failed to create deployment target: ${targetName}`),
          logs: [...context.logs, `Failed to create deployment target: ${targetName}`]
        };
      }
      
      return {
        ...context,
        step: DeploymentStep.SELECT_TARGET,
        targetName,
        target,
        logs: [...context.logs, `Using deployment target: ${targetName}`]
      };
    } catch (error) {
      logger.error('Error selecting deployment target:', error);
      return {
        ...context,
        step: DeploymentStep.FAILED,
        error: error instanceof Error ? error : new Error('Failed to select deployment target'),
        logs: [...context.logs, `Error selecting deployment target: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }
  
  /**
   * Deploy with the selected target
   */
  private async deployWithTarget(context: DeploymentContext): Promise<DeploymentContext> {
    if (!context.target) {
      return {
        ...context,
        step: DeploymentStep.FAILED,
        error: new Error('No deployment target selected'),
        logs: [...context.logs, 'No deployment target selected']
      };
    }
    
    try {
      logger.info('Deploying with target', { targetName: context.targetName });
      
      // Prepare metadata with GitHub info if available
      const metadata = context.githubInfo 
        ? { ...context.metadata, github: context.githubInfo }
        : context.metadata;
      
      // Deploy the project
      const result = await context.target.deploy({
        projectId: context.projectId,
        projectName: metadata.projectName || `Project-${context.projectId}`,
        files: context.files,
        metadata,
        tenantId: context.tenantId
      });
      
      logger.info('Deployment completed successfully', {
        deploymentId: result.id,
        url: result.url,
        provider: result.provider
      });
      
      // Record the deployment in project state
      try {
        const projectManager = getProjectStateManager();
        await projectManager.addDeployment(context.projectId, {
          url: result.url,
          provider: result.provider,
          timestamp: Date.now(),
          status: result.status === 'success' ? 'success' : 'failed',
          errorMessage: result.error,
          metadata: {
            tenantId: context.tenantId
          }
        }, context.tenantId);
        
        logger.debug('Deployment recorded in project state');
      } catch (saveError) {
        logger.warn('Failed to record deployment in project state:', saveError);
      }
      
      return {
        ...context,
        step: DeploymentStep.COMPLETE,
        result,
        logs: [...context.logs, `Deployment successful: ${result.url}`]
      };
    } catch (error) {
      logger.error('Deployment failed:', error);
      return {
        ...context,
        step: DeploymentStep.FAILED,
        error: error instanceof Error ? error : new Error('Deployment failed'),
        logs: [...context.logs, `Deployment failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }
  
  /**
   * Create a deployment target instance
   */
  private async createDeploymentTarget(
    targetName: string, 
    credentials: Record<string, any>,
    tenantId?: string,
    githubInfo?: any
  ): Promise<DeploymentTarget | null> {
    logger.debug('🎯 Creating deployment target', { 
      targetName,
      hasCredentials: Object.keys(credentials).length > 0,
      credentialProviders: Object.keys(credentials),
      hasGithubInfo: !!githubInfo,
      tenantId: tenantId || 'default'
    });

    // Log detailed credential information for debugging
    logger.debug('🔑 Target credentials detail:', {
      github: credentials.github ? {
        hasToken: !!credentials.github.token,
        hasOwner: !!credentials.github.owner,
        tokenLength: credentials.github.token ? credentials.github.token.length : 0
      } : 'not provided',
      netlify: credentials.netlify ? {
        hasToken: !!credentials.netlify.token,
        hasApiToken: !!credentials.netlify.apiToken,
        tokenLength: (credentials.netlify.token || credentials.netlify.apiToken) ? 
                     (credentials.netlify.token || credentials.netlify.apiToken).length : 0
      } : 'not provided'
    });

    // Handle Netlify target
    if (targetName === 'netlify') {
      // Ensure we have a valid Netlify token
      const netlifyToken = credentials.netlify?.token || credentials.netlify?.apiToken;
      if (!netlifyToken) {
        logger.error('❌ Netlify target requires a valid token - none provided');
        return null;
      }
      
      // Create target with Netlify token and GitHub info if available
      const netlifyOptions: Record<string, any> = {
        token: netlifyToken,
        tenantId
      };
      
      // Pass GitHub info to Netlify target if available
      if (githubInfo) {
        logger.info('✅ Passing existing GitHub repository info to Netlify target', {
          repoName: githubInfo.fullName,
          repoUrl: githubInfo.url
        });
        netlifyOptions.githubInfo = githubInfo;
        
        // Also pass GitHub credentials if we need to connect to GitHub
        if (credentials.github?.token) {
          netlifyOptions.githubToken = credentials.github.token;
          if (credentials.github.owner) {
            netlifyOptions.githubOwner = credentials.github.owner;
          }
        }
      }
      
      return DeploymentTargetRegistry.createTarget('netlify', netlifyOptions);
    }
    
    // Handle netlify-github target (deprecated but maintained for backward compatibility)
    else if (targetName === 'netlify-github') {
      logger.warn('⚠️ netlify-github target is deprecated, consider using netlify target with githubInfo');
      
      // Check both token and apiToken for Netlify
      const netlifyToken = credentials.netlify?.token || credentials.netlify?.apiToken;
      if (!netlifyToken) {
        logger.error('❌ Netlify token not provided for netlify-github target');
        return null;
      }
      if (!credentials.github?.token) {
        logger.error('❌ GitHub token not provided for netlify-github target');
        return null;
      }
      
      // Create with existing GitHub info if available
      return DeploymentTargetRegistry.createTarget('netlify-github', {
        netlifyToken,
        githubToken: credentials.github.token,
        githubOwner: credentials.github.owner,
        tenantId,
        githubInfo // Pass existing GitHub info if available
      });
    }
    
    // Handle cloudflare-pages target
    else if (targetName === 'cloudflare-pages') {
      if (!credentials.cloudflare?.accountId || !credentials.cloudflare?.apiToken) {
        logger.error('❌ Cloudflare credentials not provided for cloudflare-pages target');
        return null;
      }
      
      return DeploymentTargetRegistry.createTarget('cloudflare-pages', {
        accountId: credentials.cloudflare.accountId,
        apiToken: credentials.cloudflare.apiToken,
        projectName: credentials.cloudflare.projectName,
        tenantId
      });
    }
    
    // Handle local-zip target
    else if (targetName === 'local-zip') {
      // Local ZIP doesn't require credentials
      return DeploymentTargetRegistry.createTarget('local-zip', {});
    }
    
    // Unknown target
    else {
      logger.error(`❌ Unknown deployment target: ${targetName}`);
      return null;
    }
  }
  
  /**
   * Check if the required credentials are available for a target
   */
  private hasCredentialsForTarget(targetName: string, credentials: Record<string, any>): boolean {
    switch (targetName) {
      case 'netlify':
        return !!credentials.netlify?.token || !!credentials.netlify?.apiToken;
        
      case 'netlify-github':
        // For full netlify-github target, we need both netlify and github tokens
        // But we're now prioritizing 'netlify' with githubInfo, so this is less used
        return (!!credentials.netlify?.token || !!credentials.netlify?.apiToken) && !!credentials.github?.token;
        
      case 'cloudflare-pages':
        return !!credentials.cloudflare?.accountId && !!credentials.cloudflare?.apiToken;
        
      case 'local-zip':
        // Local ZIP doesn't require credentials
        return true;
        
      default:
        return false;
    }
  }
  
  /**
   * Validate tenant access to the project
   */
  private async validateTenantAccess(projectId: string, tenantId: string): Promise<void> {
    const projectManager = getProjectStateManager();
    const project = await projectManager.getProject(projectId, tenantId);
    
    if (!project) {
      logger.error(`Project not found or access denied: ${projectId}`, {
        tenantId
      });
      throw this.createError(
        DeploymentErrorType.TENANT_VALIDATION_FAILED,
        'You do not have access to this project'
      );
    }
    
    logger.debug('Tenant access validated successfully', {
      projectId,
      tenantId
    });
  }
  
  /**
   * Create a properly formatted error
   */
  private createError(type: DeploymentErrorType, message: string, originalError?: Error): Error {
    const error = new Error(message);
    error.name = type;
    
    if (originalError) {
      (error as any).originalError = originalError;
    }
    
    return error;
  }
}

// Singleton instance
let orchestratorInstance: DeploymentOrchestrator | null = null;

/**
 * Get the deployment orchestrator instance
 */
export function getDeploymentOrchestrator(): DeploymentOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new DeploymentOrchestrator();
  }
  
  return orchestratorInstance;
}

/**
 * Reset the deployment orchestrator instance
 * Used for testing
 */
export function resetDeploymentOrchestrator(): void {
  orchestratorInstance = null;
} 