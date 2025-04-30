import { v4 as uuidv4 } from 'uuid';
import { createScopedLogger } from '~/utils/logger';
import { getProjectStateManager } from '~/lib/projects';
import type { ProjectState } from '~/lib/projects';
import { extractProjectIdFromRequest } from '~/lib/projects/project-id';

const logger = createScopedLogger('project-context-middleware');

/**
 * Expected request body structure
 */
interface RequestBody {
  projectId?: string;
  id?: string;
  content?: string;
  requirements?: string;
  userId?: string;
  [key: string]: unknown;
}

/**
 * Request context with project information
 */
export interface ProjectRequestContext {
  projectId: string;
  isNewProject: boolean;
  project?: ProjectState;
  initialRequirements?: string;
  updateRequirements?: string;
  tenantId?: string;
}

/**
 * Options for project context middleware
 */
export interface ProjectContextOptions {
  allowNewProjects?: boolean;
  requireExistingProject?: boolean;
  autoCreateProject?: boolean;
  defaultProjectName?: string;
  requirements?: string;
  userId?: string;
}

/**
 * Middleware to handle project context
 * This identifies the project, loads existing contexts, and prepares for project creation if needed
 */
export async function handleProjectContext(
  request: Request,
  options: ProjectContextOptions = {}
): Promise<ProjectRequestContext> {
  try {
    // Extract project ID from request
    const projectId = extractProjectIdFromRequest(request);
    const userId = extractUserId(request);
    
    // Extract tenant ID from request or authentication
    const tenantId = extractTenantId(request);
    
    logger.debug('[handleProjectContext] Processing project context', { 
      projectId, 
      userId,
      tenantId 
    });
    
    // Initialize the context
    const context: ProjectRequestContext = {
      projectId: projectId || '',
      isNewProject: !projectId,
      initialRequirements: undefined,
      updateRequirements: undefined,
      tenantId
    };
    
    const projectManager = getProjectStateManager();
    
    // Handle existing project if an ID was provided
    if (projectId) {
      try {
        logger.debug(`[handleProjectContext] Project ID provided: ${projectId}. Checking existence...`);
        // Check if the project exists
        const exists = await projectManager.projectExists(projectId);
        logger.debug(`[handleProjectContext] Project ${projectId} exists: ${exists}`);
        
        if (exists) {
          // Load the existing project
          logger.debug(`[handleProjectContext] Loading existing project: ${projectId}`);
          const project = await projectManager.getProject(projectId);
          if (project) {
            context.project = project;
            context.isNewProject = false;
            
            // If there are requirements, they are for updating the project
            if (options.requirements) {
              logger.debug(`[handleProjectContext] Setting update requirements for project ${projectId}`);
              context.updateRequirements = options.requirements;
            }
            
            logger.info(`[handleProjectContext] Loaded existing project: ${projectId}`);
            return context;
          } else {
            logger.warn(`[handleProjectContext] Project exists but couldn't be loaded: ${projectId}`);
          }
        } else if (options.requireExistingProject) {
          // Project doesn't exist but was required
          logger.error(`[handleProjectContext] Required project not found: ${projectId}`);
          throw new Error(`Project not found: ${projectId}`);
        } else {
          // Project doesn't exist, but we'll create a new one with the provided ID
          logger.warn(`[handleProjectContext] Project ${projectId} not found. Setting up for creation with this ID.`);
          context.isNewProject = true;
          context.projectId = projectId;
          
          if (options.requirements) {
            logger.debug(`[handleProjectContext] Setting initial requirements for new project ${projectId}`);
            context.initialRequirements = options.requirements;
          }
        }
      } catch (error) {
        logger.error(`[handleProjectContext] Error loading project ${projectId}:`, error);
        
        if (options.requireExistingProject) {
          throw error;
        }
        
        // Set up for a new project
        logger.warn(`[handleProjectContext] Error occurred, setting up for new project generation.`);
        context.isNewProject = true;
        context.projectId = generateProjectId();
        
        if (options.requirements) {
          logger.debug(`[handleProjectContext] Setting initial requirements for newly generated project ID ${context.projectId}`);
          context.initialRequirements = options.requirements;
        }
      }
    } else {
      // No project ID was provided
      logger.debug('[handleProjectContext] No project ID provided.');
      if (options.requireExistingProject) {
        logger.error('[handleProjectContext] Project ID is required but was not provided.');
        throw new Error('Project ID is required');
      }
      
      // Set up for a new project
      context.isNewProject = true;
      context.projectId = generateProjectId();
      logger.info(`[handleProjectContext] Generated new project ID: ${context.projectId}`);
      
      if (options.requirements) {
        logger.debug(`[handleProjectContext] Setting initial requirements for new project ${context.projectId}`);
        context.initialRequirements = options.requirements;
      }
    }
    
    // Auto-create project if needed
    if (context.isNewProject && options.autoCreateProject && options.requirements) {
      try {
        const projectName = options.defaultProjectName || `Project ${new Date().toLocaleString()}`;
        logger.info(`[handleProjectContext] Auto-creating new project: ${projectName}`, { userId });
        
        context.project = await projectManager.createProject({
          name: projectName,
          initialRequirements: options.requirements,
          userId,
          metadata: { 
            autoCreated: true,
            createdFrom: 'requirements-api'
          }
        });
        
        // Update the project ID to match the newly created project
        context.projectId = context.project.id;
        logger.info(`[handleProjectContext] Auto-created new project with ID: ${context.projectId}`);
      } catch (error) {
        logger.error('[handleProjectContext] Failed to auto-create project:', error);
        throw new Error('Failed to create project');
      }
    }
    
    logger.info('[handleProjectContext] Finished processing', { projectId: context.projectId, isNew: context.isNewProject });
    return context;
  } catch (error) {
    logger.error('[handleProjectContext] Error processing project context:', error);
    throw error;
  }
}

/**
 * Generate a new project ID
 */
function generateProjectId(): string {
  return uuidv4();
}

function extractUserId(request: Request): string | undefined {
  // Check for user ID in headers
  const userId = request.headers.get('x-user-id');
  if (userId) {
    return userId;
  }
  
  // Placeholder for more complex extraction logic if needed
  return undefined;
}

function extractTenantId(request: Request): string | undefined {
  // Check for tenant ID in headers
  const tenantId = request.headers.get('x-tenant-id');
  if (tenantId) {
    return tenantId;
  }
  
  // Placeholder for more complex extraction logic if needed
  return undefined;
} 