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

const logger = createScopedLogger('project-state-manager');

/**
 * Project State Manager
 * Manages project state and coordinates with the appropriate storage adapter
 */
export class ProjectStateManager {
  private storageAdapter: ProjectStorageAdapter;
  
  constructor(context?: any) {
    this.storageAdapter = this.selectStorageAdapter(context);
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
   * Create a new project
   */
  async createProject(options: CreateProjectOptions): Promise<ProjectState> {
    const now = Date.now();
    const projectId = uuidv4();
    
    logger.info(`Creating new project: ${options.name} (${projectId})`);
    
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
      metadata: {
        ...options.metadata,
        userId: options.userId
      }
    };
    
    // Save the project
    await this.storageAdapter.saveProject(project);
    
    return project;
  }
  
  /**
   * Get a project by ID
   */
  async getProject(id: string): Promise<ProjectState> {
    logger.debug(`Getting project: ${id}`);
    
    const project = await this.storageAdapter.getProject(id);
    if (!project) {
      const error = new Error(`Project not found: ${id}`);
      error.name = ProjectErrorType.NOT_FOUND;
      throw error;
    }
    
    return project;
  }
  
  /**
   * Check if a project exists
   */
  async projectExists(id: string): Promise<boolean> {
    try {
      logger.debug(`Checking if project ${id} exists...`);
      const exists = await this.storageAdapter.projectExists(id);
      logger.debug(`Project ${id} exists: ${exists}`);
      return exists;
    } catch (error) {
      logger.error(`Error checking if project ${id} exists:`, error);
      return false;
    }
  }
  
  /**
   * Update a project
   */
  async updateProject(id: string, options: UpdateProjectOptions): Promise<ProjectUpdateResult> {
    logger.debug(`Updating project: ${id}`);
    
    // Get the current project state
    const project = await this.getProject(id);
    
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
    
    // Update the timestamp
    project.updatedAt = Date.now();
    
    // Save the updated project
    await this.storageAdapter.saveProject(project);
    
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
    logger.debug(`Deleting project: ${id}`);
    return this.storageAdapter.deleteProject(id);
  }
  
  /**
   * List projects
   */
  async listProjects(options?: {
    userId?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'createdAt' | 'updatedAt';
    sortDirection?: 'asc' | 'desc';
  }): Promise<{
    projects: ProjectState[];
    total: number;
  }> {
    logger.debug('Listing projects', options);
    return this.storageAdapter.listProjects(options);
  }
  
  /**
   * Get files from a project with filtering options
   */
  async getProjectFiles(projectId: string, options?: GetProjectFilesOptions): Promise<ProjectFile[]> {
    logger.debug(`Getting files for project: ${projectId}`);
    
    const project = await this.getProject(projectId);
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
   */
  async addDeployment(projectId: string, deployment: Omit<ProjectDeployment, 'id'>): Promise<ProjectDeployment> {
    logger.debug(`Adding deployment for project: ${projectId}`);
    
    const project = await this.getProject(projectId);
    const deploymentId = uuidv4();
    
    const newDeployment: ProjectDeployment = {
      id: deploymentId,
      ...deployment
    };
    
    project.deployments.push(newDeployment);
    project.currentDeploymentId = deploymentId;
    project.updatedAt = Date.now();
    
    await this.storageAdapter.saveProject(project);
    
    return newDeployment;
  }
  
  /**
   * Get a project's deployments
   */
  async getProjectDeployments(projectId: string): Promise<ProjectDeployment[]> {
    logger.debug(`Getting deployments for project: ${projectId}`);
    
    const project = await this.getProject(projectId);
    return project.deployments;
  }
  
  /**
   * Get a project's current deployment
   */
  async getCurrentDeployment(projectId: string): Promise<ProjectDeployment | null> {
    logger.debug(`Getting current deployment for project: ${projectId}`);
    
    const project = await this.getProject(projectId);
    
    if (!project.currentDeploymentId) {
      return null;
    }
    
    const deployment = project.deployments.find(d => d.id === project.currentDeploymentId);
    return deployment || null;
  }
  
  /**
   * Get a project's requirements history
   */
  async getRequirementsHistory(projectId: string): Promise<RequirementsEntry[]> {
    logger.debug(`Getting requirements history for project: ${projectId}`);
    
    const project = await this.getProject(projectId);
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
    userId?: string
  ): Promise<RequirementsEntry> {
    logger.debug(`Adding requirements to project: ${projectId}`);
    
    // Get the project
    const project = await this.getProject(projectId);
    
    // Create a new requirements entry
    const requirementsEntry: RequirementsEntry = {
      id: uuidv4(),
      content,
      timestamp: Date.now(),
      userId
    };
    
    // Add it to the project
    project.requirements.push(requirementsEntry);
    project.updatedAt = Date.now();
    
    // Save the updated project
    await this.storageAdapter.saveProject(project);
    
    logger.info(`Added requirements entry to project ${projectId}`);
    return requirementsEntry;
  }
}

// Export a singleton instance for convenience
let stateManagerInstance: ProjectStateManager | null = null;

// Accept optional context
export function getProjectStateManager(context?: any): ProjectStateManager {
  // Pass context to the constructor
  // Simple singleton: If we have an instance, assume it was created with the correct context needed.
  // More robust solution might involve context-keyed singletons or removing singleton.
  if (!stateManagerInstance) {
    stateManagerInstance = new ProjectStateManager(context);
  }
  
  return stateManagerInstance;
}

export function resetProjectStateManager(): void {
  stateManagerInstance = null;
} 