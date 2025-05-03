import { v4 as uuidv4 } from 'uuid';
import { getEnvironment, EnvironmentType } from '~/lib/environments';
import { createScopedLogger } from '~/utils/logger';
import type {
  ProjectState,
  ProjectFile,
  RequirementsEntry,
  ProjectDeployment,
  ProjectStorageAdapter,
  CreateProjectOptions,
  UpdateProjectOptions,
  ProjectUpdateResult,
  GetProjectFilesOptions
} from './types';
import { ProjectErrorType } from './types';
import { LocalProjectStorage } from './persistence/local';
import { CloudflareProjectStorage } from './persistence/cloudflare';
import { ProjectStorageService } from './persistence/storage-service';
import type { EnhancedProjectState } from './enhanced-types';
import { getErrorService } from '~/lib/services/error-service';

const logger = createScopedLogger('project-state-manager');

/**
 * Project State Manager
 * Manages project state and coordinates with the appropriate storage adapter
 */
export class ProjectStateManager {
  private storageAdapter: ProjectStorageAdapter;
  private storageService: ProjectStorageService | null = null;
  private enhancedStorageEnabled: boolean = false;
  
  // Static instance for singleton pattern
  private static instance: ProjectStateManager;
  
  constructor(context?: any) {
    this.storageAdapter = this.selectStorageAdapter(context);
    this.storageService = this.createEnhancedStorageService(context);
    logger.info('ProjectStateManager initialized with storage adapter');
  }
  
  /**
   * Select the appropriate storage adapter based on the environment
   */
  private selectStorageAdapter(context?: any): ProjectStorageAdapter {
    const environment = getEnvironment(context);
    const envInfo = environment.getInfo();
    
    logger.info(`Selecting storage adapter for environment: ${envInfo.type}`, {
      envType: envInfo.type,
      hasContext: !!context,
      hasCloudflare: !!context?.cloudflare,
      hasEnv: !!context?.env,
      hasCfEnv: !!context?.cloudflare?.env
    });
    
    switch(envInfo.type) {
      case EnvironmentType.CLOUDFLARE:
        return new CloudflareProjectStorage(context);
      case EnvironmentType.LOCAL:
      default:
        return new LocalProjectStorage();
    }
  }
  
  /**
   * Create the enhanced storage service if Cloudflare environment is available
   */
  private createEnhancedStorageService(context?: any): ProjectStorageService | null {
    const environment = getEnvironment(context);
    const envInfo = environment.getInfo();
    
    // Log the context structure for debugging
    logger.debug('Enhanced storage context check:', {
      envType: envInfo.type,
      hasCloudflare: !!context?.cloudflare,
      hasCfEnv: !!context?.cloudflare?.env,
      d1Available: !!context?.cloudflare?.env?.DB,
      kvProjectsAvailable: !!context?.cloudflare?.env?.POM_BOLT_PROJECTS,
      kvFilesAvailable: !!context?.cloudflare?.env?.POM_BOLT_FILES,
      kvCacheAvailable: !!context?.cloudflare?.env?.POM_BOLT_CACHE
    });
    
    // Check for Cloudflare environment (server-side)
    if (typeof window === 'undefined') {
      if (context?.cloudflare?.env) {
        const { DB, POM_BOLT_PROJECTS, POM_BOLT_FILES, POM_BOLT_CACHE } = context.cloudflare.env;
        
        // Create enhanced storage service if DB and at least the main KV namespace is available
        if (DB && POM_BOLT_PROJECTS) {
          logger.info('Creating enhanced storage service with D1 and KV (server-side)');
          
          // Use the correct number of parameters based on the ProjectStorageService constructor
          return new ProjectStorageService(
            DB, 
            POM_BOLT_PROJECTS, 
            POM_BOLT_CACHE || POM_BOLT_PROJECTS // Use cache KV or fallback to main KV
          );
        }
      }
    } 
    // For local development, check if we can still use D1/KV on client side
    // This is only for development, won't be used in production
    else if (envInfo.type === EnvironmentType.LOCAL && process.env.NODE_ENV === 'development') {
      // In development, we can try to use the worker bindings through fetch API
      logger.info('Running in local development mode, using API for storage');
      
      // Return null to use the API through fetch
      return null;
    }
    
    logger.info('Enhanced storage service not available, using legacy storage adapter');
    return null;
  }
  
  /**
   * Create a new project
   */
  async createProject(options: CreateProjectOptions): Promise<ProjectState> {
    logger.debug('Creating new project', { 
      name: options.name,
      metadata: options.metadata,
      tenantId: options.tenantId
    });
    try {
      const now = Date.now();
      const projectId = uuidv4();
      
      logger.info(`Creating new project: ${options.name} (${projectId})`, {
        tenantId: options.tenantId
      });
      
      // Initialize the requirements entry if provided
      const requirements: RequirementsEntry[] = [];
      if (options.initialRequirements) {
        requirements.push({
          id: uuidv4(),
          content: options.initialRequirements,
          timestamp: now,
          userId: options.userId
        });
      }
      
      // Create the initial project state
      const project: ProjectState = {
        id: projectId,
        name: options.name,
        createdAt: now,
        updatedAt: now,
        files: [],
        requirements,
        deployments: [],
        tenantId: options.tenantId,
        metadata: {
          ...options.metadata,
          userId: options.userId
        }
      };
      
      // Save the project using the appropriate storage mechanism
      if (this.storageService) {
        // Convert to enhanced project state
        const enhancedProject = this.convertToEnhancedProject(project);
        await this.storageService.saveProject(enhancedProject);
      } else {
        await this.storageAdapter.saveProject(project);
      }
      
      logger.info('Project created successfully', { 
        id: project.id,
        name: project.name,
        tenantId: project.tenantId
      });
      return project;
    } catch (error) {
      logger.error('Error creating project:', error);
      throw error;
    }
  }
  
  /**
   * Get a project by ID
   * @param id Project ID
   * @param tenantId Optional tenant ID for access validation
   */
  async getProject(id: string, tenantId?: string): Promise<ProjectState | null> {
    logger.debug(`Getting project ${id}`, { tenantId: tenantId || 'none' });
    try {
      let project: ProjectState | null = null;
      
      if (this.storageService) {
        const enhancedProject = await this.storageService.getProject(id);
        if (enhancedProject) {
          project = this.convertFromEnhancedProject(enhancedProject);
        }
      } else {
        project = await this.storageAdapter.getProject(id);
      }
      
      // If project is not found
      if (!project) {
        logger.warn(`Project ${id} not found`, { tenantId: tenantId || 'none' });
        // We return null rather than throwing to allow graceful handling by caller
        return null;
      }
      
      // If project is found and tenant validation is requested
      if (tenantId) {
        // If project has a tenant ID and it doesn't match the requested tenant ID
        if (project.tenantId && project.tenantId !== tenantId) {
          const errorService = getErrorService();
          logger.warn('Tenant access denied', {
            projectId: id,
            projectTenant: project.tenantId,
            requestTenant: tenantId
          });
          
          // We return null rather than throwing to allow graceful handling by caller
          // but we log a more detailed error
          errorService.logError(
            errorService.createTenantAccessDeniedError(id, tenantId),
            { source: 'state-manager.getProject' }
          );
          
          return null; // Return null to indicate project not found or not accessible
        }
      }
      
      logger.debug(`Project ${id} retrieval result:`, { 
        found: !!project,
        projectName: project?.name,
        projectTenant: project?.tenantId,
        tenantValidated: !!tenantId
      });
      return project;
    } catch (error) {
      const errorService = getErrorService();
      logger.error(`Error getting project ${id}:`, error);
      
      // Log a standardized error
      errorService.logError(
        errorService.normalizeError(error, `Failed to retrieve project ${id}`),
        { projectId: id, tenantId, source: 'state-manager.getProject' }
      );
      
      throw error;
    }
  }
  
  /**
   * Check if a project exists
   */
  async projectExists(id: string): Promise<boolean> {
    logger.debug(`Checking if project ${id} exists`);
    try {
      if (this.storageService) {
        return this.storageService.projectExists(id);
      } else {
        const exists = await this.storageAdapter.projectExists(id);
        logger.debug(`Project ${id} exists: ${exists}`);
        return exists;
      }
    } catch (error) {
      const errorService = getErrorService();
      logger.error(`Error checking if project ${id} exists:`, error);
      
      // Log a standardized error
      errorService.logError(
        errorService.normalizeError(error, `Failed to check if project ${id} exists`),
        { projectId: id, source: 'state-manager.projectExists' }
      );
      
      throw error;
    }
  }
  
  /**
   * Update a project
   */
  async updateProject(id: string, options: UpdateProjectOptions, tenantId?: string): Promise<ProjectUpdateResult> {
    logger.debug(`Updating project: ${id}`, { tenantId: tenantId || 'none' });
    
    // Get the current project state with tenant validation if provided
    const project = await this.getProject(id, tenantId);
    
    // If project not found or tenant access denied
    if (!project) {
      const errorMsg = tenantId 
        ? `Project not found or access denied: ${id}` 
        : `Project not found: ${id}`;
      logger.error(errorMsg, { tenantId: tenantId || 'none' });
      throw new Error(errorMsg);
    }
    
    // Track changes for the result
    const newFiles: ProjectFile[] = [];
    const updatedFiles: ProjectFile[] = [];
    const deletedFiles: ProjectFile[] = [];
    
    // Update name if provided
    if (options.name) {
      project.name = options.name;
    }
    
    // Update files if provided
    if (options.updatedFiles) {
      for (const file of options.updatedFiles) {
        const existingFileIndex = project.files.findIndex(f => f.path === file.path && !f.isDeleted);
        const now = Date.now();
        
        if (existingFileIndex >= 0) {
          // Update existing file
          const existingFile = project.files[existingFileIndex];
          project.files[existingFileIndex] = {
            ...file,
            createdAt: existingFile.createdAt,
            updatedAt: now
          };
          updatedFiles.push(project.files[existingFileIndex]);
        } else {
          // Add new file
          const newFile: ProjectFile = {
            ...file,
            createdAt: now,
            updatedAt: now
          };
          project.files.push(newFile);
          newFiles.push(newFile);
        }
      }
    }
    
    // Delete files if paths provided
    if (options.deletedFilePaths) {
      for (const path of options.deletedFilePaths) {
        const fileIndex = project.files.findIndex(f => f.path === path && !f.isDeleted);
        if (fileIndex >= 0) {
          project.files[fileIndex].isDeleted = true;
          project.files[fileIndex].updatedAt = Date.now();
          deletedFiles.push(project.files[fileIndex]);
        }
      }
    }
    
    // Add new requirements if provided
    if (options.newRequirements) {
      project.requirements.push({
        id: uuidv4(),
        content: options.newRequirements,
        timestamp: Date.now(),
        userId: project.metadata?.userId as string | undefined
      });
    }
    
    // Update metadata if provided
    if (options.metadata) {
      project.metadata = {
        ...project.metadata,
        ...options.metadata
      };
    }
    
    // Update webhooks if provided
    if (options.webhooks) {
      // If webhooks property doesn't exist, initialize it
      if (!project.webhooks) {
        project.webhooks = [];
      }
      
      // Add or update webhooks
      project.webhooks = [...options.webhooks];
      logger.debug(`Updated ${options.webhooks.length} webhooks for project ${id}`);
    }
    
    // Update the timestamp
    project.updatedAt = Date.now();
    
    // Save the updated project using the appropriate storage mechanism
    if (this.storageService) {
      // Convert to enhanced project state
      const enhancedProject = this.convertToEnhancedProject(project);
      await this.storageService.saveProject(enhancedProject);
    } else {
      await this.storageAdapter.saveProject(project);
    }
    
    return {
      success: true,
      project,
      newFiles,
      updatedFiles,
      deletedFiles
    };
  }
  
  /**
   * Delete a project
   */
  async deleteProject(id: string): Promise<boolean> {
    logger.debug(`Deleting project ${id}`);
    try {
      if (this.storageService) {
        return this.storageService.deleteProject(id);
      } else {
        const result = await this.storageAdapter.deleteProject(id);
        logger.debug(`Project ${id} deletion result: ${result}`);
        return result;
      }
    } catch (error) {
      logger.error(`Error deleting project ${id}:`, error);
      throw error;
    }
  }
  
  /**
   * List projects
   */
  async listProjects(options?: {
    userId?: string;
    tenantId?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'createdAt' | 'updatedAt';
    sortDirection?: 'asc' | 'desc';
  }): Promise<{
    projects: ProjectState[];
    total: number;
  }> {
    logger.debug('Listing projects', options);
    try {
      if (this.storageService) {
        // Convert options to search options
        const searchOptions = {
          query: '',
          // Cast to any to work around type incompatibility
          filters: {
            // Add tenant filtering if provided
            tenantId: options?.tenantId,
            // Add any relevant filters based on the options
          } as any,
          pagination: options?.limit ? {
            limit: options.limit,
            offset: options?.offset || 0
          } : undefined,
          sort: options?.sortBy ? {
            field: options.sortBy,
            direction: options?.sortDirection || 'desc'
          } : undefined
        };
        
        const result = await this.storageService.searchProjects(searchOptions);
        
        // Convert enhanced projects to regular projects
        const projects = result.projects.map(p => this.convertFromEnhancedProject(p));
        logger.debug('Projects listed successfully', { 
          count: projects.length,
          total: result.total,
          tenantId: options?.tenantId
        });
        return {
          projects,
          total: result.total
        };
      } else {
        const result = await this.storageAdapter.listProjects(options);
        
        // Filter by tenantId if specified
        if (options?.tenantId) {
          const filteredProjects = result.projects.filter(p => p.tenantId === options.tenantId);
          return {
            projects: filteredProjects,
            total: filteredProjects.length
          };
        }
        
        return result;
      }
    } catch (error) {
      logger.error('Error listing projects:', error);
      throw error;
    }
  }
  
  /**
   * Get files from a project with filtering options
   * @param projectId Project ID
   * @param options Filtering options
   * @param tenantId Optional tenant ID for access validation
   */
  async getProjectFiles(projectId: string, options?: GetProjectFilesOptions, tenantId?: string): Promise<ProjectFile[]> {
    logger.debug(`Getting files for project: ${projectId}`, { tenantId: tenantId || 'none' });
    
    const project = await this.getProject(projectId, tenantId);
    
    if (!project) {
      const errorMsg = tenantId 
        ? `Project not found or access denied: ${projectId}` 
        : `Project not found: ${projectId}`;
      logger.error(errorMsg, { tenantId: tenantId || 'none' });
      return [];
    }
    
    let files = project.files;
    
    // Filter out deleted files unless explicitly included
    if (!options?.includeDeleted) {
      files = files.filter(file => !file.isDeleted);
    }
    
    // Filter by include paths if specified
    if (options?.includePaths && options.includePaths.length > 0) {
      files = files.filter(file => options.includePaths!.includes(file.path));
    }
    
    // Filter by exclude paths if specified
    if (options?.excludePaths && options.excludePaths.length > 0) {
      files = files.filter(file => !options.excludePaths!.includes(file.path));
    }
    
    // Filter by pattern if specified
    if (options?.pattern) {
      const regex = options.pattern instanceof RegExp ? options.pattern : new RegExp(options.pattern);
      files = files.filter(file => regex.test(file.path));
    }
    
    return files;
  }
  
  /**
   * Add a deployment to a project
   * @param projectId ID of the project
   * @param deployment Deployment information
   * @param tenantId Optional tenant ID for access validation
   */
  async addDeployment(
    projectId: string, 
    deployment: Omit<ProjectDeployment, 'id'>,
    tenantId?: string
  ): Promise<ProjectDeployment> {
    logger.debug(`Adding deployment for project: ${projectId}`, { tenantId: tenantId || 'none' });
    
    const project = await this.getProject(projectId, tenantId);
    
    if (!project) {
      const errorMsg = tenantId 
        ? `Project not found or access denied: ${projectId}` 
        : `Project not found: ${projectId}`;
      logger.error(errorMsg, { tenantId: tenantId || 'none' });
      throw new Error(errorMsg);
    }
    
    const deploymentId = uuidv4();
    
    const newDeployment: ProjectDeployment = {
      id: deploymentId,
      ...deployment
    };
    
    project.deployments.push(newDeployment);
    project.currentDeploymentId = deploymentId;
    project.updatedAt = Date.now();
    
    // Save the updated project using the appropriate storage mechanism
    if (this.storageService) {
      // Convert to enhanced project state
      const enhancedProject = this.convertToEnhancedProject(project);
      await this.storageService.saveProject(enhancedProject);
    } else {
      await this.storageAdapter.saveProject(project);
    }
    
    return newDeployment;
  }
  
  /**
   * Get a project's deployments
   * @param projectId Project ID
   * @param tenantId Optional tenant ID for access validation
   */
  async getProjectDeployments(projectId: string, tenantId?: string): Promise<ProjectDeployment[]> {
    logger.debug(`Getting deployments for project: ${projectId}`, { tenantId: tenantId || 'none' });
    
    const project = await this.getProject(projectId, tenantId);
    
    if (!project) {
      const errorMsg = tenantId 
        ? `Project not found or access denied: ${projectId}` 
        : `Project not found: ${projectId}`;
      logger.error(errorMsg, { tenantId: tenantId || 'none' });
      return [];
    }
    
    return project.deployments;
  }
  
  /**
   * Get a project's current deployment
   * @param projectId Project ID
   * @param tenantId Optional tenant ID for access validation
   */
  async getCurrentDeployment(projectId: string, tenantId?: string): Promise<ProjectDeployment | null> {
    logger.debug(`Getting current deployment for project: ${projectId}`, { tenantId: tenantId || 'none' });
    
    const project = await this.getProject(projectId, tenantId);
    
    if (!project) {
      const errorMsg = tenantId 
        ? `Project not found or access denied: ${projectId}` 
        : `Project not found: ${projectId}`;
      logger.error(errorMsg, { tenantId: tenantId || 'none' });
      return null;
    }
    
    if (!project.currentDeploymentId) {
      return null;
    }
    
    const deployment = project.deployments.find(d => d.id === project.currentDeploymentId);
    return deployment || null;
  }
  
  /**
   * Get a project's requirements history
   * @param projectId Project ID 
   * @param tenantId Optional tenant ID for access validation
   */
  async getRequirementsHistory(projectId: string, tenantId?: string): Promise<RequirementsEntry[]> {
    logger.debug(`Getting requirements history for project: ${projectId}`, { tenantId: tenantId || 'none' });
    
    const project = await this.getProject(projectId, tenantId);
    
    if (!project) {
      const errorMsg = tenantId 
        ? `Project not found or access denied: ${projectId}` 
        : `Project not found: ${projectId}`;
      logger.error(errorMsg, { tenantId: tenantId || 'none' });
      return [];
    }
    
    return project.requirements;
  }
  
  /**
   * Add files to a project
   */
  async addFiles(projectId: string, files: Record<string, string>): Promise<ProjectFile[]> {
    logger.debug(`Adding ${Object.keys(files).length} files to project: ${projectId}`);
    
    const now = Date.now();
    const projectFiles: ProjectFile[] = Object.entries(files).map(([path, content]) => ({
      path,
      content,
      createdAt: now,
      updatedAt: now
    }));
    
    const result = await this.updateProject(projectId, {
      updatedFiles: projectFiles
    });
    
    return [...result.newFiles, ...result.updatedFiles];
  }
  
  /**
   * Add requirements to an existing project
   */
  async addRequirements(
    projectId: string,
    content: string,
    userId?: string,
    isAdditionalRequirement?: boolean
  ): Promise<RequirementsEntry> {
    logger.debug(`Adding requirements to project: ${projectId}`, {
      isAdditionalRequirement: !!isAdditionalRequirement,
      contentLength: content.length
    });
    
    // Get the project
    const project = await this.getProject(projectId);
    
    if (!project) {
      logger.error(`Project ${projectId} not found when adding requirements`);
      throw new Error(`Project ${projectId} not found`);
    }
    
    // Create a new requirements entry
    const requirementsEntry: RequirementsEntry = {
      id: uuidv4(),
      content,
      timestamp: Date.now(),
      userId,
      metadata: {
        isAdditionalRequirement: !!isAdditionalRequirement
      }
    };
    
    // Add it to the project
    project.requirements.push(requirementsEntry);
    project.updatedAt = Date.now();
    
    // Save the updated project using the appropriate storage mechanism
    if (this.storageService) {
      // Convert to enhanced project state
      const enhancedProject = this.convertToEnhancedProject(project);
      await this.storageService.saveProject(enhancedProject);
    } else {
      await this.storageAdapter.saveProject(project);
    }
    
    logger.info(`Added requirements entry to project ${projectId}`, {
      requirementId: requirementsEntry.id,
      isAdditionalRequirement: !!isAdditionalRequirement
    });
    return requirementsEntry;
  }
  
  /**
   * Helper method to convert a regular project to an enhanced project
   */
  private convertToEnhancedProject(project: ProjectState): EnhancedProjectState {
    // Create a basic enhanced project with the same core properties
    const enhancedProject: EnhancedProjectState = {
      ...project,
      metadata: {
        ...(project.metadata || {}),
        version: '1', // Use string for version
        type: 'new-project',
        description: project.name,
        tags: []
      },
      // Cast files to EnhancedProjectFile[] to work around missing properties
      files: project.files.map(file => ({
        ...file,
        chunks: file.content ? Math.ceil(file.content.length / (1024 * 1024)) : 0,
        hash: '', // This would be calculated in a real implementation
        size: file.content ? file.content.length : 0,
        mimeType: 'text/plain', // Default mime type
        version: '1' // Default version
      })) as any,
      // Add required properties for EnhancedProjectState
      version: 1,
      status: 'active',
      searchIndex: {
        keywords: [],
        features: [],
        technologies: []
      },
      // Ensure requirements and deployments are properly typed
      requirements: project.requirements as any,
      deployments: project.deployments as any,
      // Ensure webhooks array exists
      webhooks: project.webhooks || []
    };
    
    return enhancedProject;
  }
  
  /**
   * Helper method to convert an enhanced project to a regular project
   */
  private convertFromEnhancedProject(enhancedProject: EnhancedProjectState): ProjectState {
    // Create a basic project with the same core properties
    const project: ProjectState = {
      id: enhancedProject.id,
      name: enhancedProject.name,
      createdAt: enhancedProject.createdAt,
      updatedAt: enhancedProject.updatedAt,
      files: enhancedProject.files.map(file => ({
        path: file.path,
        content: file.content || '',
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        isDeleted: file.isDeleted || false
      })),
      requirements: enhancedProject.requirements,
      deployments: enhancedProject.deployments,
      currentDeploymentId: enhancedProject.currentDeploymentId,
      metadata: enhancedProject.metadata
    };
    
    return project;
  }

  /**
   * Save project files
   */
  public async saveProjectFiles(projectId: string, files: ProjectFile[]): Promise<void> {
    try {
      const project = await this.getProject(projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      // Update project files
      project.files = files;
      project.updatedAt = Date.now();

      // Save updated project
      await this.saveProject(project);
    } catch (error) {
      logger.error(`Failed to save project files for ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Save a project
   */
  public async saveProject(project: ProjectState): Promise<void> {
    logger.debug(`Saving project ${project.id}`);
    try {
      if (this.storageService) {
        // Convert to enhanced project state
        const enhancedProject = this.convertToEnhancedProject(project);
        await this.storageService.saveProject(enhancedProject);
      } else {
        await this.storageAdapter.saveProject(project);
      }
      
      logger.debug(`Project ${project.id} saved successfully`);
    } catch (error) {
      logger.error(`Error saving project ${project.id}:`, error);
      throw error;
    }
  }

  /**
   * Gets the singleton instance of ProjectStateManager
   */
  public static getInstance(context?: any): ProjectStateManager {
    if (!ProjectStateManager.instance) {
      // Create a new instance with the context
      ProjectStateManager.instance = new ProjectStateManager(context);
    } else if (context) {
      // If we have an existing instance but are given a new context,
      // update the storage adapter to use the new context
      ProjectStateManager.instance.updateStorageAdapter(context);
    }
    
    return ProjectStateManager.instance;
  }

  /**
   * Update the storage adapter using a new context
   * This is useful when the instance exists but we need to access resources
   * from a different context (like in a Function request)
   */
  private updateStorageAdapter(context: any): void {
    try {
      // Only update if we have a Cloudflare context that might have KV/D1 bindings
      if (context?.cloudflare?.env) {
        logger.debug('Updating storage adapter with new context', {
          contextType: typeof context,
          hasCloudflare: !!context.cloudflare,
          hasCfEnv: !!context.cloudflare.env
        });
        
        // Try to create an enhanced storage service with the new context
        const enhancedService = this.createEnhancedStorageService(context);
        if (enhancedService) {
          this.storageService = enhancedService;
          return;
        }
        
        // If that fails, try to update the existing adapter
        if (this.storageAdapter && 'updateContext' in this.storageAdapter) {
          (this.storageAdapter as any).updateContext(context);
        } else {
          // Last resort - create a new storage adapter
          this.storageAdapter = this.selectStorageAdapter(context);
        }
      }
    } catch (error) {
      logger.warn('Failed to update storage adapter with new context', error);
    }
  }
}

// Export a singleton instance for convenience
let stateManagerInstance: ProjectStateManager | null = null;

/**
 * Singleton factory method for ProjectStateManager
 */
export function getProjectStateManager(context?: any): ProjectStateManager {
  return ProjectStateManager.getInstance(context);
}

export function resetProjectStateManager(): void {
  stateManagerInstance = null;
} 