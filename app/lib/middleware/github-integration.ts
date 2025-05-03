/**
 * GitHub Integration Middleware
 * Handles GitHub repository creation and code uploading independently of deployment
 */

import { createScopedLogger } from '~/utils/logger';
import type { GitHubRepositoryInfo } from '~/lib/projects/types';
import { getProjectStateManager } from '~/lib/projects';
import { getCredentialService } from '~/lib/services/credential-service';
import type { RequirementsContext } from './requirements-chain';

const logger = createScopedLogger('github-integration-middleware');

/**
 * Update the project metadata with GitHub information
 */
async function updateProjectMetadata(projectId: string, metadata: Record<string, any>): Promise<void> {
  try {
    const projectManager = getProjectStateManager();
    await projectManager.updateProject(projectId, { metadata });
  } catch (error) {
    logger.error('Failed to update project metadata', { 
      projectId, 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
}

/**
 * This is the middleware function for GitHub integration
 * It sets up a GitHub repository for a project and updates the context with GitHub information
 */
export async function setupGitHubRepository(ctx: any = {}): Promise<any> {
  const projectId = ctx.projectId;
  
  try {
    // Skip if setupGitHub is not true
    if (!ctx.setupGitHub) {
      logger.debug('GitHub repository setup skipped - not requested');
      return {
        ...ctx,
        phases: {
          ...(ctx.phases || {}),
          github: {
            status: 'skipped',
            message: 'GitHub repository setup was not requested'
          }
        }
      };
    }

    const { credentials, project, name } = ctx;
    
    logger.debug('Processing GitHub setup request', {
      hasCredentials: !!credentials,
      hasGithubCredentials: !!credentials?.github,
      hasToken: !!credentials?.github?.token, 
      hasOwner: !!credentials?.github?.owner,
      projectId,
      projectName: name || (project?.name || `Project ${projectId}`)
    });
    
    if (!credentials?.github) {
      throw new Error('Missing GitHub credentials');
    }

    if (!projectId) {
      throw new Error('Missing project ID');
    }

    // Get project name
    const projectName = name || (project?.name ? 
      project.name : 
      `Project ${projectId}`);

    logger.info(`Setting up GitHub repository for project: ${projectName}`);
    
    // Use existing GitHubIntegrationService
    const { GitHubIntegrationService } = await import('~/lib/deployment/github-integration');
    const githubService = GitHubIntegrationService.getInstance();
    
    // Extract files from context
    const files = ctx.generatedFiles || {};
    
    // Set up the repository with the proper interface configuration
    const result = await githubService.setupRepository({
      token: credentials.github.token,
      owner: credentials.github.owner,
      projectId,
      projectName,
      files,
      isPrivate: true,
      description: `Generated project: ${projectName}`,
      metadata: {
        source: 'github-integration-middleware',
        ...ctx.metadata
      }
    });
    
    if (!result.repositoryInfo) {
      throw new Error(result.error || 'Failed to set up GitHub repository');
    }
    
    // Add GitHub info to context
    ctx.githubInfo = result.repositoryInfo;
    
    logger.info('✅ GitHub repository created successfully', {
      repo: result.repositoryInfo.fullName,
      url: result.repositoryInfo.url
    });
    
    // Update project metadata with GitHub repository information
    await updateProjectMetadata(projectId, {
      github: {
        status: 'success',
        completedAt: new Date().toISOString(),
        repositoryInfo: result.repositoryInfo
      }
    });
    
    return {
      ...ctx,
      phases: {
        ...(ctx.phases || {}),
        github: {
          status: 'success',
          message: 'GitHub repository setup successful',
          repositoryInfo: result.repositoryInfo
        }
      }
    };
  } catch (error) {
    logger.error('❌ GitHub repository setup failed', error);
    
    // Update metadata with error information
    if (projectId) {
      await updateProjectMetadata(projectId, {
        github: {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          completedAt: new Date().toISOString()
        }
      });
    }
    
    return {
      ...ctx,
      githubError: error instanceof Error ? error : new Error(String(error)),
      phases: {
        ...(ctx.phases || {}),
        github: {
          status: 'failed',
          message: error instanceof Error ? error.message : String(error)
        }
      }
    };
  }
}

/**
 * Update files in an existing GitHub repository
 */
export async function updateGitHubRepository(context: RequirementsContext): Promise<RequirementsContext> {
  if (!context.githubInfo || !context.githubInfo.fullName) {
    logger.info('⏭️ GitHub update skipped - no repository information');
    return context;
  }

  if (!context.generatedFiles || Object.keys(context.generatedFiles).length === 0) {
    logger.info('⏭️ GitHub update skipped - no files to update');
    return context;
  }

  logger.info('🔄 Updating GitHub repository', {
    repository: context.githubInfo.fullName
  });
  
  try {
    // Get GitHub credentials
    const credentialService = getCredentialService();
    const githubCredentials = credentialService.getGitHubCredentials({
      env: context.env,
      requestData: context.deploymentOptions || {},
      tenantId: context.tenantId
    });
    
    if (!githubCredentials) {
      throw new Error('GitHub credentials required but not provided');
    }
    
    // Use existing GitHubIntegrationService
    const { GitHubIntegrationService } = await import('~/lib/deployment/github-integration');
    const githubService = GitHubIntegrationService.getInstance();
    
    // Upload files to repository
    const result = await githubService.uploadFiles({
      token: githubCredentials.token,
      projectId: context.projectId,
      repositoryInfo: context.githubInfo,
      files: context.generatedFiles,
      metadata: {
        source: 'github-integration-middleware',
        tenantId: context.tenantId,
        updateTimestamp: new Date().toISOString()
      }
    });
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to update GitHub repository');
    }
    
    logger.info('✅ GitHub repository updated successfully', {
      repository: context.githubInfo.fullName,
      fileCount: Object.keys(context.generatedFiles).length
    });
    
    // Update project metadata with update information
    await updateProjectMetadata(context.projectId, {
      github: {
        status: 'success',
        lastUpdated: new Date().toISOString(),
        filesUpdated: Object.keys(context.generatedFiles).length
      }
    });
    
    return context;
  } catch (error) {
    logger.error('❌ GitHub repository update failed', error);
    context.githubError = error instanceof Error ? error : new Error(String(error));
    
    // Update project metadata with failure information
    await updateProjectMetadata(context.projectId, {
      github: {
        updateStatus: 'failed',
        updateError: error instanceof Error ? error.message : String(error),
        errorTimestamp: new Date().toISOString()
      }
    });
    
    return context;
  }
} 