import { createScopedLogger } from '~/utils/logger';
import { GitHubRepository, type GitHubRepoMetadata } from './github-repository';
import type { GitHubRepositoryInfo } from '~/lib/projects/types';

const logger = createScopedLogger('github-integration');

// Enhanced configuration for GitHub integration with better tracking
export interface GitHubIntegrationConfig {
  token: string;
  owner?: string;
  projectId: string;       // Required project ID to link the repo with
  projectName: string;     // Name for the repository
  files: Record<string, string>;
  isPrivate?: boolean;
  description?: string;
  metadata?: Record<string, any>; // Existing metadata to update
}

// Tracking metadata for GitHub operations
export interface GitHubTrackingMetadata {
  githubRepo?: string;     // Repository full name (owner/repo)
  githubUrl?: string;      // Repository URL
  github?: GitHubRepositoryInfo; // Full repository info
  repoCreated?: boolean;   // Flag indicating if repo was created
  filesUploaded?: boolean; // Flag indicating if files were uploaded
  lastUpdated?: number;    // Timestamp of last operation
}

/**
 * GitHubIntegrationService
 * 
 * A singleton service that centralizes all GitHub operations:
 * - Repository creation
 * - File upload
 * - Status tracking
 * - Metadata management
 * 
 * This service ensures operations are only performed once and
 * properly tracked in project metadata.
 */
export class GitHubIntegrationService {
  private static instance: GitHubIntegrationService;

  private constructor() {
    logger.info('GitHubIntegrationService initialized');
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): GitHubIntegrationService {
    if (!GitHubIntegrationService.instance) {
      GitHubIntegrationService.instance = new GitHubIntegrationService();
    }
    return GitHubIntegrationService.instance;
  }

  /**
   * Unified method to setup a GitHub repository with proper tracking
   * This either creates a new repo or uses an existing one based on metadata
   */
  public async setupRepository(config: GitHubIntegrationConfig): Promise<{
    repositoryInfo: GitHubRepositoryInfo | null;
    updatedMetadata: Record<string, any>;
    error?: string;
  }> {
    try {
      // Initialize metadata from existing data
      const metadata = { ...(config.metadata || {}) };
      const trackingData: GitHubTrackingMetadata = this.extractGitHubMetadata(metadata);
      
      logger.info(`Setting up GitHub repository for project: ${config.projectId} (${config.projectName})`);
      
      // Check if we already have a repository for this project
      if (trackingData.repoCreated && trackingData.github) {
        logger.info(`Repository already exists for project: ${config.projectId}`, { 
          repository: trackingData.github.fullName 
        });
        
        // Update tracking data timestamp
        trackingData.lastUpdated = Date.now();
        
        // Return existing repository info and updated metadata
        return {
          repositoryInfo: trackingData.github,
          updatedMetadata: this.updateMetadataWithGitHubInfo(metadata, trackingData)
        };
      }
      
      // Create GitHub repository manager
      const github = new GitHubRepository({
        token: config.token,
        owner: config.owner
      });
      
      // Validate token first
      const isTokenValid = await github.validateToken();
      if (!isTokenValid) {
        const errorMsg = 'Invalid GitHub token. Please check your credentials.';
        logger.error(errorMsg);
        return {
          repositoryInfo: null,
          updatedMetadata: metadata,
          error: errorMsg
        };
      }
      
      // Create repository
      const repositoryName = this.createUniqueRepositoryName(config.projectName, config.projectId);
      logger.info(`Creating GitHub repository: ${repositoryName}`);
      
      const repoMetadata = await github.createRepository({
        name: repositoryName,
        description: config.description || `Generated application: ${config.projectName}`,
        isPrivate: config.isPrivate !== undefined ? config.isPrivate : true,
        autoInit: false
      });
      
      if (!repoMetadata) {
        const errorMsg = `Failed to create GitHub repository for ${config.projectName}`;
        logger.error(errorMsg);
        return {
          repositoryInfo: null,
          updatedMetadata: metadata,
          error: errorMsg
        };
      }
      
      logger.info(`GitHub repository created: ${repoMetadata.fullName}`);
      
      // Convert to standard GitHubRepositoryInfo format
      const repositoryInfo: GitHubRepositoryInfo = {
        owner: repoMetadata.fullName.split('/')[0],
        repo: repoMetadata.name,
        fullName: repoMetadata.fullName,
        url: repoMetadata.url,
        defaultBranch: repoMetadata.defaultBranch,
        isPrivate: true, // We always create private repos
        commitSha: undefined // We don't know the commit SHA yet
      };
      
      // Update tracking data
      trackingData.githubRepo = repositoryInfo.fullName;
      trackingData.githubUrl = repositoryInfo.url;
      trackingData.github = repositoryInfo;
      trackingData.repoCreated = true;
      trackingData.lastUpdated = Date.now();
      
      // Upload files if we have them
      if (Object.keys(config.files).length > 0 && !trackingData.filesUploaded) {
        await this.uploadFilesToRepository(
          github,
          repositoryInfo,
          config.files,
          trackingData
        );
      }
      
      // Return repository info and updated metadata
      return {
        repositoryInfo,
        updatedMetadata: this.updateMetadataWithGitHubInfo(metadata, trackingData)
      };
    } catch (error) {
      logger.error('Error in GitHub repository setup:', error);
      return {
        repositoryInfo: null,
        updatedMetadata: config.metadata || {},
        error: error instanceof Error ? error.message : 'Unknown error in GitHub setup'
      };
    }
  }
  
  /**
   * Upload files to a GitHub repository with tracking
   */
  public async uploadFiles(
    config: {
      token: string;
      projectId: string;
      repositoryInfo: GitHubRepositoryInfo;
      files: Record<string, string>;
      metadata?: Record<string, any>;
    }
  ): Promise<{
    success: boolean;
    updatedMetadata: Record<string, any>;
    error?: string;
  }> {
    try {
      // Initialize metadata from existing data
      const metadata = { ...(config.metadata || {}) };
      const trackingData: GitHubTrackingMetadata = this.extractGitHubMetadata(metadata);
      
      // If files are already uploaded, return success
      if (trackingData.filesUploaded) {
        logger.info(`Files already uploaded to GitHub repository: ${config.repositoryInfo.fullName}`);
        return { 
          success: true,
          updatedMetadata: metadata
        };
      }
      
      // Create GitHub repository manager with the specific owner
      const github = new GitHubRepository({
        token: config.token,
        owner: config.repositoryInfo.owner
      });
      
      // Upload the files
      return await this.uploadFilesToRepository(
        github,
        config.repositoryInfo,
        config.files,
        trackingData,
        metadata
      );
    } catch (error) {
      logger.error('Error uploading files to GitHub repository:', error);
      return {
        success: false,
        updatedMetadata: config.metadata || {},
        error: error instanceof Error ? error.message : 'Unknown error in file upload'
      };
    }
  }
  
  /**
   * Helper method to upload files to a repository and track the result
   */
  private async uploadFilesToRepository(
    github: GitHubRepository,
    repositoryInfo: GitHubRepositoryInfo,
    files: Record<string, string>,
    trackingData: GitHubTrackingMetadata,
    existingMetadata: Record<string, any> = {}
  ): Promise<{
    success: boolean;
    updatedMetadata: Record<string, any>;
    error?: string;
  }> {
    try {
      logger.info(`Uploading ${Object.keys(files).length} files to GitHub repository: ${repositoryInfo.fullName}`);
      
      // Upload files to the existing repository
      const uploadSuccess = await github.setRepositoryAndUploadFiles(
        repositoryInfo.repo,
        files,
        repositoryInfo.defaultBranch
      );
      
      if (!uploadSuccess) {
        const errorMsg = `Failed to upload files to GitHub repository ${repositoryInfo.fullName}`;
        logger.error(errorMsg);
        return {
          success: false,
          updatedMetadata: existingMetadata,
          error: errorMsg
        };
      }
      
      // Update tracking data
      trackingData.filesUploaded = true;
      trackingData.lastUpdated = Date.now();
      
      logger.info(`Successfully uploaded files to GitHub repository: ${repositoryInfo.fullName}`);
      
      // Return success and updated metadata
      return {
        success: true,
        updatedMetadata: this.updateMetadataWithGitHubInfo(existingMetadata, trackingData)
      };
    } catch (error) {
      logger.error(`Error uploading files to GitHub repository ${repositoryInfo.fullName}:`, error);
      return {
        success: false,
        updatedMetadata: existingMetadata,
        error: error instanceof Error ? error.message : 'Unknown error in file upload'
      };
    }
  }
  
  /**
   * Extract GitHub metadata from project metadata
   */
  public extractGitHubMetadata(metadata: Record<string, any> = {}): GitHubTrackingMetadata {
    const result: GitHubTrackingMetadata = {
      githubRepo: metadata.githubRepo,
      githubUrl: metadata.githubUrl,
      repoCreated: metadata.repoCreated || false,
      filesUploaded: metadata.filesUploaded || false,
      lastUpdated: metadata.lastUpdated || 0
    };
    
    // Extract GitHub repository info
    if (metadata.github && typeof metadata.github === 'object') {
      // Modern format: dedicated github object
      result.github = metadata.github as GitHubRepositoryInfo;
    } else if (result.githubRepo) {
      // Legacy format: construct from githubRepo string
      const parts = result.githubRepo.split('/');
      if (parts.length === 2) {
        result.github = {
          owner: parts[0],
          repo: parts[1],
          fullName: result.githubRepo,
          url: result.githubUrl || `https://github.com/${result.githubRepo}`,
          defaultBranch: 'main',
          isPrivate: true,
          commitSha: undefined
        };
      }
    }
    
    return result;
  }
  
  /**
   * Update metadata with GitHub tracking information
   */
  private updateMetadataWithGitHubInfo(
    metadata: Record<string, any>,
    trackingData: GitHubTrackingMetadata
  ): Record<string, any> {
    const result = { ...metadata };
    
    // Add tracking data to metadata
    result.githubRepo = trackingData.githubRepo;
    result.githubUrl = trackingData.githubUrl;
    result.github = trackingData.github;
    result.repoCreated = trackingData.repoCreated;
    result.filesUploaded = trackingData.filesUploaded;
    result.lastUpdated = trackingData.lastUpdated;
    
    return result;
  }
  
  /**
   * Creates a unique repository name based on project name and ID
   * This ensures uniqueness while maintaining readability
   */
  private createUniqueRepositoryName(projectName: string, projectId: string): string {
    // Generate a short hash from the project ID to ensure uniqueness
    const shortHash = projectId.replace(/-/g, '').substring(0, 10);
    
    // If project name is untitled or generic, use a more descriptive prefix
    let prefix = "pom-app";
    if (projectName && 
        !projectName.toLowerCase().includes('untitled') && 
        !projectName.toLowerCase().includes('project')) {
      // Sanitize the name
      prefix = projectName
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')  // Remove special characters except spaces and hyphens
        .replace(/\s+/g, '-')      // Replace spaces with hyphens
        .replace(/-+/g, '-')       // Replace multiple hyphens with a single one
        .replace(/^-+|-+$/g, '');  // Remove leading/trailing hyphens
    }
    
    // Limit prefix length
    if (prefix.length > 30) {
      prefix = prefix.substring(0, 30);
    }
    
    // For empty prefix, use a more descriptive term
    if (!prefix) {
      prefix = "pom-app";
    }
    
    return `${prefix}-${shortHash}`;
  }

  /**
   * Sanitizes a repository name to be compatible with GitHub requirements
   * @deprecated Use createUniqueRepositoryName instead
   */
  private sanitizeRepositoryName(name: string): string {
    // Replace spaces, special characters with hyphens
    let sanitized = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')  // Remove special characters except spaces and hyphens
      .replace(/\s+/g, '-')      // Replace spaces with hyphens
      .replace(/-+/g, '-');      // Replace multiple hyphens with a single one
    
    // Ensure it doesn't start or end with a hyphen
    sanitized = sanitized.replace(/^-+|-+$/g, '');
    
    // If the name is empty after sanitization, use a generic name
    if (!sanitized) {
      sanitized = 'generated-project';
    }
    
    return sanitized;
  }
}

// Export singleton instance for easier imports
export const githubIntegration = GitHubIntegrationService.getInstance();

// Legacy functions that use the new service (for backward compatibility)
export async function setupGitHubRepository(config: GitHubIntegrationConfig): Promise<GitHubRepositoryInfo | null> {
  const service = GitHubIntegrationService.getInstance();
  const result = await service.setupRepository(config);
  return result.repositoryInfo;
}

export async function updateGitHubRepository(
  info: GitHubRepositoryInfo,
  token: string,
  files: Record<string, string>,
  projectId?: string,
  metadata?: Record<string, any>
): Promise<boolean> {
  const service = GitHubIntegrationService.getInstance();
  const result = await service.uploadFiles({
    token,
    projectId: projectId || 'legacy-project',
    repositoryInfo: info,
    files,
    metadata
  });
  return result.success;
} 