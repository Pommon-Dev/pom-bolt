import { v4 as uuidv4 } from 'uuid';
import { ProjectSyncService } from './project-sync';
import { createScopedLogger } from '~/utils/logger';
import type { ProjectState } from '~/lib/projects/types';
import type { RequirementsEntry } from '~/lib/projects/types';

const logger = createScopedLogger('project-service');

interface CreateProjectOptions {
  id?: string;
  name?: string;
  requirements?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

interface UpdateProjectOptions {
  name?: string;
  metadata?: Record<string, any>;
}

// Extended project state with isDeleted flag
interface ExtendedProjectState extends ProjectState {
  isDeleted?: boolean;
}

export const ProjectService = {
  /**
   * Get all projects from local storage
   */
  getProjects(): ProjectState[] {
    const projects = ProjectSyncService.getLocalProjects();
    return Object.values(projects).filter(project => !(project as ExtendedProjectState).isDeleted);
  },

  /**
   * Get a project by ID
   */
  getProject(id: string): ProjectState | null {
    const projects = ProjectSyncService.getLocalProjects();
    const project = projects[id] as ExtendedProjectState;
    
    // Don't return deleted projects
    if (project && project.isDeleted) {
      return null;
    }
    
    return project || null;
  },

  /**
   * Create a new project
   */
  async createProject(data: CreateProjectOptions): Promise<ProjectState> {
    const projects = ProjectSyncService.getLocalProjects();
    
    const projectId = data.id || uuidv4();
    const now = Date.now();
    
    let requirements: RequirementsEntry[] = [];
    if (data.requirements) {
      requirements = [{
        id: uuidv4(),
        content: data.requirements,
        timestamp: now,
        userId: data.userId
      }];
    }
    
    const project: ProjectState = {
      id: projectId,
      name: data.name || 'Untitled Project',
      createdAt: now,
      updatedAt: now,
      files: [],
      requirements,
      deployments: [],
      metadata: {
        ...data.metadata,
        createdBy: data.userId
      }
    };
    
    // Save locally
    projects[projectId] = project;
    ProjectSyncService.saveLocalProjects(projects);
    
    // Sync to backend
    try {
      await ProjectSyncService.syncProject(project);
      logger.info(`Created and synced project: ${project.id}`);
    } catch (error) {
      logger.error(`Failed to sync new project ${project.id}:`, error);
      // Continue anyway - it will sync later
    }
    
    return project;
  },

  /**
   * Update a project
   */
  async updateProject(id: string, data: UpdateProjectOptions): Promise<ProjectState> {
    const projects = ProjectSyncService.getLocalProjects();
    
    if (!projects[id]) {
      throw new Error(`Project not found: ${id}`);
    }
    
    const project: ProjectState = {
      ...projects[id],
      ...data,
      updatedAt: Date.now()
    };
    
    // Save locally
    projects[id] = project;
    ProjectSyncService.saveLocalProjects(projects);
    
    // Sync to backend
    try {
      await ProjectSyncService.syncProject(project);
      logger.info(`Updated and synced project: ${id}`);
    } catch (error) {
      logger.error(`Failed to sync updated project ${id}:`, error);
      // Continue anyway - it will sync later
    }
    
    return project;
  },

  /**
   * Add requirements to a project
   */
  async addRequirements(id: string, requirements: string, userId?: string, isAdditionalRequirement?: boolean): Promise<ProjectState> {
    const projects = ProjectSyncService.getLocalProjects();
    
    if (!projects[id]) {
      throw new Error(`Project not found: ${id}`);
    }
    
    const project = { ...projects[id] };
    
    const requirementsEntry: RequirementsEntry = {
      id: uuidv4(),
      content: requirements,
      timestamp: Date.now(),
      userId,
      metadata: {
        isAdditionalRequirement: !!isAdditionalRequirement
      }
    };
    
    project.requirements = [
      ...project.requirements,
      requirementsEntry
    ];
    
    project.updatedAt = Date.now();
    
    // Save locally
    projects[id] = project;
    ProjectSyncService.saveLocalProjects(projects);
    
    // Sync to backend
    try {
      await ProjectSyncService.syncProject(project);
      logger.info(`Added requirements to project ${id} and synced`, {
        isAdditionalRequirement: !!isAdditionalRequirement
      });
    } catch (error) {
      logger.error(`Failed to sync project ${id} after adding requirements:`, error);
      // Continue anyway - it will sync later
    }
    
    return project;
  },

  /**
   * Delete a project
   */
  async deleteProject(id: string): Promise<boolean> {
    const projects = ProjectSyncService.getLocalProjects();
    
    if (!projects[id]) {
      return false;
    }
    
    // Mark as deleted (soft delete)
    const project: ExtendedProjectState = {
      ...projects[id],
      isDeleted: true,
      updatedAt: Date.now()
    };
    
    // Save locally
    projects[id] = project as ProjectState;
    ProjectSyncService.saveLocalProjects(projects);
    
    // Sync deletion to backend
    try {
      await ProjectSyncService.syncProject(project as ProjectState);
      logger.info(`Deleted project ${id} and synced deletion`);
    } catch (error) {
      logger.error(`Failed to sync deletion of project ${id}:`, error);
      // Continue anyway - it will sync later
    }
    
    return true;
  }
}; 