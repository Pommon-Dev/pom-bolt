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
 * Setup GitHub repository for the project
 * This is the middleware function for GitHub integration
 */
export async function setupGitHubRepository(context: RequirementsContext): Promise<RequirementsContext> {
  // Check for GitHub setup flag in the dedicated githubOptions property
  if (!context.githubOptions?.setupGitHub) {
    logger.info('⏭️ GitHub setup skipped - not requested');
    return context;
  }

  logger.info('🚀 Setting up GitHub repository');
  
  try {
    // First try to use credentials from githubOptions
    let githubCredentials = context.githubOptions.credentials;
    
    // If not found, fall back to the credential service
    if (!githubCredentials || !githubCredentials.token) {
      const credentialService = getCredentialService();
      const serviceCredentials = credentialService.getGitHubCredentials({
        env: context.env,
        requestData: context.deploymentOptions || {},
        tenantId: context.tenantId
      });
      
      if (serviceCredentials) {
        githubCredentials = {
          token: serviceCredentials.token,
          owner: serviceCredentials.owner
        };
      }
    }
    
    // Debug log credentials info
    logger.debug('GitHub credential check:', {
      hasDirectCredentials: !!context.githubOptions.credentials,
      hasServiceCredentials: !!githubCredentials,
      hasToken: !!githubCredentials?.token,
      hasOwner: !!githubCredentials?.owner
    });
    
    if (!githubCredentials || !githubCredentials.token) {
      throw new Error('GitHub credentials required but not provided');
    }
    
    // Update metadata to show GitHub setup in progress
    await updateProjectMetadata(context.projectId, {
      github: {
        status: 'in-progress',
        startedAt: new Date().toISOString()
      }
    });
    
    // Use existing GitHubIntegrationService
    const { GitHubIntegrationService } = await import('~/lib/deployment/github-integration');
    const githubService = GitHubIntegrationService.getInstance();
    
    // Create repository with files
    const result = await githubService.setupRepository({
      token: githubCredentials.token,
      owner: githubCredentials.owner,
      projectId: context.projectId,
      projectName: context.name || 'Generated Project',
      files: context.generatedFiles || {},
      metadata: {
        source: 'github-integration-middleware',
        tenantId: context.tenantId
      }
    });
    
    if (!result.repositoryInfo) {
      throw new Error(result.error || 'Failed to set up GitHub repository');
    }
    
    // Add GitHub info to context
    context.githubInfo = result.repositoryInfo;
    
    logger.info('✅ GitHub repository created successfully', {
      repoUrl: result.repositoryInfo.url
    });
    
    // Update project metadata with GitHub repository information
    await updateProjectMetadata(context.projectId, {
      github: {
        status: 'success',
        repositoryUrl: result.repositoryInfo.url,
        repositoryInfo: result.repositoryInfo,
        createdAt: new Date().toISOString()
      }
    });
    
    return context;
  } catch (error) {
    logger.error('❌ GitHub repository setup failed', error);
    context.githubError = error instanceof Error ? error : new Error(String(error));
    
    // Update metadata with error information
    await updateProjectMetadata(context.projectId, {
      github: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        failedAt: new Date().toISOString()
      }
    });
    
    return context;
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