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
import { NetlifyTarget } from './netlify';

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
  githubInfo?: GitHubRepositoryInfo; // Existing GitHub repository info
  tenantId?: string;
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
 * 
 * @deprecated Use NetlifyTarget with githubInfo option instead. This target will be removed in a future version.
 */
export class NetlifyGitHubTarget extends BaseDeploymentTarget {
  private netlifyTarget: NetlifyTarget;

  constructor(config: NetlifyGitHubConfig) {
    super();
    
    // Create internal Netlify target with GitHub information passed directly
    this.netlifyTarget = new NetlifyTarget({
      token: config.netlifyToken,
      githubToken: config.githubToken,
      githubOwner: config.githubOwner,
      githubInfo: config.githubInfo,
      tenantId: config.tenantId
    });
    
    logger.warn('⚠️ DEPRECATED: NetlifyGitHubTarget is deprecated. Use NetlifyTarget with githubInfo option instead.');
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
    return this.netlifyTarget.isAvailable();
  }
  
  async projectExists(projectName: string): Promise<boolean> {
    return this.netlifyTarget.projectExists(projectName);
  }
  
  async initializeProject(options: ProjectOptions): Promise<ProjectMetadata> {
    logger.info(`[DEPRECATED] Initializing project ${options.name} with NetlifyGitHubTarget (delegating to NetlifyTarget)`);
    return this.netlifyTarget.initializeProject(options);
  }
  
  async deploy(options: DeployOptions): Promise<DeploymentResult> {
    logger.info(`[DEPRECATED] Deploying project ${options.projectId} with NetlifyGitHubTarget (delegating to NetlifyTarget)`);
    return this.netlifyTarget.deploy(options);
  }
  
  async update(options: UpdateOptions): Promise<DeploymentResult> {
    logger.info(`[DEPRECATED] Updating project ${options.projectId} with NetlifyGitHubTarget (delegating to NetlifyTarget)`);
    return this.netlifyTarget.update(options);
  }
  
  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    return this.netlifyTarget.getDeploymentStatus(deploymentId);
  }
  
  async removeDeployment(deploymentId: string): Promise<boolean> {
    return this.netlifyTarget.removeDeployment(deploymentId);
  }
}