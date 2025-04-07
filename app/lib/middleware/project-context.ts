import { v4 as uuidv4 } from 'uuid';
import { createScopedLogger } from '~/utils/logger';
import { getProjectStateManager } from '~/lib/projects';
import type { ProjectState } from '~/lib/projects';

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
}

/**
 * Options for project context middleware
 */
export interface ProjectContextOptions {
  allowNewProjects?: boolean;
  requireExistingProject?: boolean;
  autoCreateProject?: boolean;
  defaultProjectName?: string;
}

/**
 * Middleware to handle project context
 * This identifies the project, loads existing contexts, and prepares for project creation if needed
 */
export async function handleProjectContext(
  request: Request,
  options: ProjectContextOptions = {},
  parsedBody?: RequestBody
): Promise<ProjectRequestContext> {
  // Parse the request body if not provided
  let data: RequestBody;
  
  if (parsedBody) {
    data = parsedBody;
  } else {
    try {
      // First try JSON parsing
      try {
        data = await request.clone().json() as RequestBody;
        logger.debug('Successfully parsed JSON body', { 
          keys: Object.keys(data),
          hasRequirements: Boolean(data.content || data.requirements)
        });
      } catch (jsonError) {
        logger.error('Failed standard JSON parsing:', jsonError);
        
        // Try text fallback
        try {
          const textBody = await request.clone().text();
          logger.debug('Raw request body', {
            length: textBody.length,
            preview: textBody.substring(0, 100)
          });
          
          // Try to manually parse JSON
          try {
            data = JSON.parse(textBody) as RequestBody;
            logger.debug('Manually parsed JSON body', {
              keys: Object.keys(data)
            });
          } catch (parseError) {
            logger.error('Failed to manually parse JSON', parseError);
            // If it's not JSON, use as-is
            data = { content: textBody } as RequestBody;
          }
        } catch (textError) {
          logger.error('Failed to parse request body:', textError);
          throw new Error('Failed to parse request body');
        }
      }
    } catch (error) {
      logger.error('Failed to parse request body:', error);
      throw new Error('Failed to parse request body');
    }
  }
  
  const projectId = data.projectId || data.id;
  const requirements = data.content || data.requirements;
  const userId = data.userId;
  
  logger.debug('Processing project context', { projectId, userId });
  
  // Initialize the context
  const context: ProjectRequestContext = {
    projectId: projectId || '',
    isNewProject: !projectId,
    initialRequirements: undefined,
    updateRequirements: undefined
  };
  
  const projectManager = getProjectStateManager();
  
  // Handle existing project if an ID was provided
  if (projectId) {
    try {
      // Check if the project exists
      const exists = await projectManager.projectExists(projectId);
      
      if (exists) {
        // Load the existing project
        context.project = await projectManager.getProject(projectId);
        context.isNewProject = false;
        
        // If there are requirements, they are for updating the project
        if (requirements) {
          context.updateRequirements = requirements;
        }
        
        logger.debug(`Loaded existing project: ${projectId}`);
        return context;
      } else if (options.requireExistingProject) {
        // Project doesn't exist but was required
        throw new Error(`Project not found: ${projectId}`);
      } else {
        // Project doesn't exist, but we'll create a new one with the provided ID
        context.isNewProject = true;
        context.projectId = projectId;
        
        if (requirements) {
          context.initialRequirements = requirements;
        }
      }
    } catch (error) {
      logger.error(`Error loading project ${projectId}:`, error);
      
      if (options.requireExistingProject) {
        throw error;
      }
      
      // Set up for a new project
      context.isNewProject = true;
      context.projectId = generateProjectId();
      
      if (requirements) {
        context.initialRequirements = requirements;
      }
    }
  } else {
    // No project ID was provided
    if (options.requireExistingProject) {
      throw new Error('Project ID is required');
    }
    
    // Set up for a new project
    context.isNewProject = true;
    context.projectId = generateProjectId();
    
    if (requirements) {
      context.initialRequirements = requirements;
    }
  }
  
  // Auto-create project if needed
  if (context.isNewProject && options.autoCreateProject && context.initialRequirements) {
    try {
      const projectName = options.defaultProjectName || `Project ${new Date().toLocaleString()}`;
      
      context.project = await projectManager.createProject({
        name: projectName,
        initialRequirements: context.initialRequirements,
        userId,
        metadata: { 
          autoCreated: true,
          createdFrom: 'requirements-api'
        }
      });
      
      // Update the project ID to match the newly created project
      context.projectId = context.project.id;
      logger.debug(`Auto-created new project: ${context.projectId}`);
    } catch (error) {
      logger.error('Failed to auto-create project:', error);
      throw new Error('Failed to create project');
    }
  }
  
  return context;
}

/**
 * Generate a new project ID
 */
function generateProjectId(): string {
  return uuidv4();
} 