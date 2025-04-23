import { createScopedLogger } from '~/utils/logger';
import { getProjectStateManager } from './state-manager';
import type { ProjectState, ProjectFile, ProjectDeployment } from './types';
import type { 
  EnhancedProjectState, 
  EnhancedProjectFile, 
  EnhancedRequirementsEntry, 
  EnhancedProjectDeployment 
} from './enhanced-types';
import { D1StorageAdapter } from '~/lib/projects/adapters/d1-storage-adapter';
import { KVStorageAdapter } from '~/lib/projects/adapters/kv-storage-adapter';
import { MemoryStorageAdapter } from './adapters/memory-storage-adapter';
import { LocalStorageAdapter } from './adapters/localstorage-adapter';
import type { ProjectStorageAdapter } from './types';

const logger = createScopedLogger('project-storage-service');

/**
 * Error codes for storage service errors
 */
export enum StorageServiceErrorCode {
  INVALID_INPUT = 'INVALID_INPUT',
  GET_PROJECT_ERROR = 'GET_PROJECT_ERROR',
  GET_PROJECT_FILES_ERROR = 'GET_PROJECT_FILES_ERROR',
  PROJECT_EXISTS_ERROR = 'PROJECT_EXISTS_ERROR',
  DELETE_PROJECT_ERROR = 'DELETE_PROJECT_ERROR',
  SAVE_PROJECT_ERROR = 'SAVE_PROJECT_ERROR',
  UPDATE_PROJECT_ERROR = 'UPDATE_PROJECT_ERROR',
  ADD_FILES_ERROR = 'ADD_FILES_ERROR',
  ADD_DEPLOYMENT_ERROR = 'ADD_DEPLOYMENT_ERROR',
  CACHE_FILES_ERROR = 'CACHE_FILES_ERROR',
  STORAGE_UNAVAILABLE = 'STORAGE_UNAVAILABLE',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Custom error class for storage service errors
 */
export class StorageServiceError extends Error {
  constructor(
    message: string, 
    public code: StorageServiceErrorCode, 
    public originalError?: unknown,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'StorageServiceError';
  }

  /**
   * Create a validation error
   */
  static validation(message: string, context?: Record<string, any>): StorageServiceError {
    return new StorageServiceError(
      message,
      StorageServiceErrorCode.VALIDATION_ERROR,
      undefined,
      context
    );
  }

  /**
   * Create an error from another error
   */
  static fromError(
    error: unknown, 
    code: StorageServiceErrorCode, 
    message?: string,
    context?: Record<string, any>
  ): StorageServiceError {
    const errorMessage = message || (error instanceof Error ? error.message : 'Unknown error');
    return new StorageServiceError(
      errorMessage,
      code,
      error,
      context
    );
  }
}

/**
 * ProjectStorageService
 * 
 * A service that coordinates between D1 and KV storage for projects.
 * Provides enhanced persistence and caching capabilities.
 */
export class ProjectStorageService {
  private static instance: ProjectStorageService;
  private projectManager = getProjectStateManager();
  private adapter: ProjectStorageAdapter;
  private cache: Map<string, { data: EnhancedProjectState; timestamp: number }>;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private constructor(adapter: ProjectStorageAdapter) {
    this.adapter = adapter;
    this.cache = new Map();
    logger.info('ProjectStorageService initialized with adapter', { 
      adapterType: adapter.constructor.name
    });
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(
    d1?: D1Database,
    kv?: KVNamespace
  ): ProjectStorageService {
    if (!ProjectStorageService.instance) {
      logger.info('Creating new ProjectStorageService instance', {
        d1Available: !!d1,
        kvAvailable: !!kv,
        environment: typeof window === 'undefined' ? 'server' : 'client'
      });

      // Server-side: Use D1 if available, otherwise KV
      if (typeof window === 'undefined') {
        if (d1) {
          logger.info('Using D1StorageAdapter for server environment');
          ProjectStorageService.instance = new ProjectStorageService(new D1StorageAdapter(d1));
        } else if (kv) {
          logger.info('Using KVStorageAdapter for server environment (D1 not available)');
          ProjectStorageService.instance = new ProjectStorageService(new KVStorageAdapter(kv));
        } else {
          logger.warn('No D1 or KV available, falling back to MemoryStorageAdapter');
          ProjectStorageService.instance = new ProjectStorageService(new MemoryStorageAdapter());
        }
      } 
      // Client-side: Use LocalStorage
      else {
        logger.info('Using LocalStorageAdapter for client environment');
        ProjectStorageService.instance = new ProjectStorageService(new LocalStorageAdapter());
      }
    } else {
      logger.debug('Reusing existing ProjectStorageService instance');
    }

    return ProjectStorageService.instance;
  }

  /**
   * Get a project by ID, with caching
   */
  public async getProject(id: string): Promise<EnhancedProjectState | null> {
    // Check cache first
    const cached = this.cache.get(id);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    // Get from D1
    const project = await this.adapter.getProject(id);
    if (!project) {
      return null;
    }

    // Enhance the project state
    const enhancedProject = await this.enhanceProjectState(project);
    
    // Cache the result
    this.cache.set(id, { data: enhancedProject, timestamp: Date.now() });
    
    return enhancedProject;
  }

  /**
   * Get project files
   */
  public async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    if (!projectId) {
      throw StorageServiceError.validation('Project ID is required');
    }

    try {
      logger.debug(`Getting files for project: ${projectId}`);
      const files = await this.projectManager.getProjectFiles(projectId);
      logger.info(`Retrieved ${files.length} files for project: ${projectId}`);
      return files;
    } catch (error) {
      logger.error(`Failed to get project files for ${projectId}:`, error);
      
      if (error instanceof StorageServiceError) {
        throw error;
      }
      
      throw StorageServiceError.fromError(
        error,
        StorageServiceErrorCode.GET_PROJECT_FILES_ERROR,
        `Failed to get project files: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { projectId }
      );
    }
  }

  /**
   * Check if a project exists
   */
  public async projectExists(projectId: string): Promise<boolean> {
    if (!projectId) {
      throw StorageServiceError.validation('Project ID is required');
    }

    try {
      logger.debug(`Checking if project exists: ${projectId}`);
      const exists = await this.adapter.projectExists(projectId);
      logger.info(`Project ${projectId} exists: ${exists}`);
      return exists;
    } catch (error) {
      logger.error(`Failed to check if project ${projectId} exists:`, error);
      
      if (error instanceof StorageServiceError) {
        throw error;
      }
      
      throw StorageServiceError.fromError(
        error,
        StorageServiceErrorCode.PROJECT_EXISTS_ERROR,
        `Failed to check if project exists: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { projectId }
      );
    }
  }

  /**
   * Delete a project and its associated data
   */
  public async deleteProject(id: string): Promise<boolean> {
    // Delete from D1
    const deleted = await this.adapter.deleteProject(id);
    if (!deleted) {
      return false;
    }

    // Delete file chunks from KV
    await this.adapter.deleteFileChunks(id);

    // Remove from cache
    this.cache.delete(id);

    return true;
  }

  /**
   * Save a project, updating both D1 and KV storage
   */
  public async saveProject(project: EnhancedProjectState): Promise<void> {
    // Save to D1
    await this.adapter.saveProject(project);

    // Save file chunks to KV
    for (const file of project.files) {
      if (file.content) {
        await this.adapter.saveFileChunk(project.id, file.path, file.content);
      }
    }

    // Update cache
    this.cache.set(project.id, { data: project, timestamp: Date.now() });
  }

  /**
   * Update an existing project
   */
  public async updateProject(id: string, options: UpdateProjectOptions): Promise<ProjectUpdateResult> {
    const result = await this.adapter.updateProject(id, options);
    
    // If there are new or updated files, save them to KV
    if (result.newFiles.length > 0 || result.updatedFiles.length > 0) {
      for (const file of [...result.newFiles, ...result.updatedFiles]) {
        if (file.content) {
          await this.adapter.saveFileChunk(id, file.path, file.content);
        }
      }
    }

    // If there are deleted files, remove them from KV
    if (result.deletedFiles.length > 0) {
      for (const file of result.deletedFiles) {
        await this.adapter.deleteFileChunk(id, file.path);
      }
    }

    // Update cache
    this.cache.set(id, { data: result.project as EnhancedProjectState, timestamp: Date.now() });

    return result;
  }

  /**
   * Add files to a project
   */
  public async addFiles(projectId: string, files: Record<string, string>): Promise<void> {
    if (!projectId) {
      throw StorageServiceError.validation('Project ID is required');
    }

    if (!files || Object.keys(files).length === 0) {
      throw StorageServiceError.validation('Files object is required and cannot be empty');
    }

    try {
      logger.debug(`Adding files to project: ${projectId}`, { 
        fileCount: Object.keys(files).length,
        filePaths: Object.keys(files)
      });
      await this.projectManager.addFiles(projectId, files);
      logger.info(`Added ${Object.keys(files).length} files to project: ${projectId}`);
    } catch (error) {
      logger.error(`Failed to add files to project ${projectId}:`, error);
      
      if (error instanceof StorageServiceError) {
        throw error;
      }
      
      throw StorageServiceError.fromError(
        error,
        StorageServiceErrorCode.ADD_FILES_ERROR,
        `Failed to add files: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { projectId, fileCount: Object.keys(files).length }
      );
    }
  }

  /**
   * Add a deployment to a project
   */
  public async addDeployment(projectId: string, deployment: ProjectDeployment): Promise<void> {
    if (!projectId) {
      throw StorageServiceError.validation('Project ID is required');
    }

    if (!deployment || !deployment.id) {
      throw StorageServiceError.validation('Valid deployment with ID is required');
    }

    try {
      logger.debug(`Adding deployment to project: ${projectId}`, { 
        deploymentId: deployment.id,
        provider: deployment.provider
      });
      await this.projectManager.addDeployment(projectId, deployment);
      logger.info(`Added deployment ${deployment.id} to project: ${projectId}`);
    } catch (error) {
      logger.error(`Failed to add deployment to project ${projectId}:`, error);
      
      if (error instanceof StorageServiceError) {
        throw error;
      }
      
      throw StorageServiceError.fromError(
        error,
        StorageServiceErrorCode.ADD_DEPLOYMENT_ERROR,
        `Failed to add deployment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { projectId, deploymentId: deployment.id }
      );
    }
  }

  /**
   * Cache project files for faster access
   */
  public async cacheProjectFiles(projectId: string, files: Record<string, string>): Promise<void> {
    if (!projectId) {
      throw StorageServiceError.validation('Project ID is required');
    }

    if (!files || Object.keys(files).length === 0) {
      throw StorageServiceError.validation('Files object is required and cannot be empty');
    }

    try {
      logger.debug(`Caching files for project: ${projectId}`, { 
        fileCount: Object.keys(files).length
      });
      
      // Convert files object to ProjectFile array
      const projectFiles: ProjectFile[] = Object.entries(files).map(([path, content]) => ({
        path,
        content,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isDeleted: false
      }));

      // Save files to project
      await this.projectManager.saveProjectFiles(projectId, projectFiles);
      
      logger.info(`Cached ${projectFiles.length} files for project ${projectId}`);
    } catch (error) {
      logger.error(`Failed to cache files for project ${projectId}:`, error);
      
      if (error instanceof StorageServiceError) {
        throw error;
      }
      
      throw StorageServiceError.fromError(
        error,
        StorageServiceErrorCode.CACHE_FILES_ERROR,
        `Failed to cache files: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { projectId, fileCount: Object.keys(files).length }
      );
    }
  }

  /**
   * Enhance a base project state with additional features
   */
  private async enhanceProjectState(project: ProjectState): Promise<EnhancedProjectState> {
    // Create enhanced metadata
    const metadata = {
      version: '1.0.0',
      type: 'default',
      description: project.metadata?.description || '',
      tags: project.metadata?.tags || [],
      owner: project.metadata?.owner || '',
      visibility: project.metadata?.visibility || 'private',
      lastModifiedBy: project.metadata?.lastModifiedBy || '',
      customFields: project.metadata?.customFields || {}
    };

    // Enhance files
    const enhancedFiles: EnhancedProjectFile[] = await Promise.all(
      project.files.map(async file => {
        const content = await this.adapter.getFileChunk(project.id, file.path);
        return {
          ...file,
          content: content || file.content,
          size: content?.length || 0,
          mimeType: this.getMimeType(file.path),
          hash: this.hashString(content || file.content),
          version: 1,
          tags: [],
          customFields: {}
        };
      })
    );

    // Enhance requirements
    const enhancedRequirements: EnhancedRequirementsEntry[] = project.requirements.map(req => ({
      ...req,
      status: 'pending',
      priority: 'medium',
      comments: [],
      attachments: [],
      customFields: {}
    }));

    // Enhance deployments
    const enhancedDeployments: EnhancedProjectDeployment[] = project.deployments.map(deploy => ({
      ...deploy,
      environment: 'production',
      branch: 'main',
      buildTime: 0,
      customFields: {}
    }));

    // Create enhanced project state
    return {
      ...project,
      metadata,
      files: enhancedFiles,
      requirements: enhancedRequirements,
      deployments: enhancedDeployments,
      webhooks: project.webhooks || [],
      version: 1,
      status: 'active',
      customFields: {},
      searchIndex: {
        keywords: [],
        features: [],
        technologies: []
      }
    };
  }

  /**
   * Get MIME type for a file based on its extension
   */
  private getMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      'js': 'application/javascript',
      'ts': 'application/typescript',
      'jsx': 'application/javascript',
      'tsx': 'application/typescript',
      'html': 'text/html',
      'css': 'text/css',
      'json': 'application/json',
      'md': 'text/markdown',
      'txt': 'text/plain'
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  /**
   * Simple string hashing function
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

// Export singleton instance for easier imports
export const getProjectStorageService = (d1: D1Database, kv: KVNamespace) => ProjectStorageService.getInstance(d1, kv);

// Define missing types
export interface UpdateProjectOptions {
  name?: string;
  description?: string;
  metadata?: Record<string, any>;
  files?: EnhancedProjectFile[];
  requirements?: EnhancedRequirementsEntry[];
  deployments?: EnhancedProjectDeployment[];
  webhooks?: any[];
}

export interface ProjectUpdateResult {
  project: EnhancedProjectState;
  newFiles: EnhancedProjectFile[];
  updatedFiles: EnhancedProjectFile[];
  deletedFiles: EnhancedProjectFile[];
} 