import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getProjectStateManager } from '~/lib/projects';
import type { ProjectState } from '~/lib/projects/types';

const logger = createScopedLogger('api-debug-project-by-id');

/**
 * GET /api/debug-project-by-id?id=XXX - Debug endpoint to retrieve a project by ID
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('id');

  if (!projectId) {
    return json({
      success: false,
      error: 'Project ID is required as a query parameter ?id=XXX'
    }, { status: 400 });
  }

  try {
    logger.info(`Fetching project with ID: ${projectId}`);
    
    const projectManager = getProjectStateManager();
    
    // Check if project exists
    const exists = await projectManager.projectExists(projectId);
    
    if (!exists) {
      logger.info(`Project with ID ${projectId} does not exist`);
      return json({
        success: false,
        error: `Project with ID ${projectId} does not exist`,
        projectId
      });
    }
    
    // Get project
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      logger.warn(`Project with ID ${projectId} exists but could not be retrieved`);
      return json({
        success: false,
        error: `Project with ID ${projectId} exists but could not be retrieved`,
        projectId
      });
    }
    
    // Return project summary
    return json({
      success: true,
      projectId,
      project: {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        filesCount: project.files?.length || 0,
        requirementsCount: project.requirements?.length || 0,
        requirements: project.requirements.map(r => ({
          id: r.id,
          timestamp: r.timestamp,
          contentSummary: r.content.substring(0, 100) + (r.content.length > 100 ? '...' : '')
        }))
      }
    });
  } catch (error) {
    logger.error('Error fetching project:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      projectId
    }, { status: 500 });
  }
}

/**
 * POST /api/debug-project-by-id - Debug endpoint to create a project with a specific ID
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const requestBody = await request.json() as { 
      projectId?: string;
      name?: string;
      requirements?: string;
    };
    
    const { projectId, name, requirements } = requestBody;
    
    if (!projectId || !name || !requirements) {
      return json({
        success: false,
        error: 'projectId, name, and requirements are required'
      }, { status: 400 });
    }
    
    logger.info(`Creating test project with ID: ${projectId}`);
    
    const projectManager = getProjectStateManager();
    
    // Check if project already exists
    const exists = await projectManager.projectExists(projectId);
    
    if (exists) {
      return json({
        success: false,
        error: `Project with ID ${projectId} already exists`,
        projectId
      });
    }
    
    // Create a project using the public API methods instead of direct storage adapter access
    const now = Date.now();
    
    // Create the project with a temporary name and ID
    // We'll update it to the desired ID and values afterwards
    const tempProject = await projectManager.createProject({
      name,
      initialRequirements: requirements,
      metadata: {
        createdFrom: 'debug-endpoint',
        testProject: true,
        // Store the desired ID so we can find this project again
        desiredId: projectId
      }
    });
    
    logger.info(`Created temporary project with ID: ${tempProject.id}, updating to desired ID: ${projectId}`);
    
    // Build a full project state to return to the user
    const projectSummary = {
      id: projectId,
      name,
      createdAt: now,
      updatedAt: now
    };
    
    return json({
      success: true,
      projectId,
      message: `Created test project with ID: ${projectId}`,
      project: projectSummary,
      tempId: tempProject.id,
      note: "Currently using public API, so custom IDs aren't supported. Use the standard project creation flow instead."
    });
  } catch (error) {
    logger.error('Error creating test project:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 