import { json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getProjectStateManager } from '~/lib/projects';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';

const logger = createScopedLogger('api-debug-projects');

/**
 * GET /api/debug-projects - Get list of recent projects
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    logger.info('Listing recent projects for debugging');
    
    const projectManager = getProjectStateManager();
    const result = await projectManager.listProjects({
      limit: 10,
      sortBy: 'createdAt',
      sortDirection: 'desc'
    });
    
    // Extract essential info to avoid large response
    const projects = result.projects.map(project => ({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      filesCount: project.files?.length || 0,
      requirementsCount: project.requirements?.length || 0,
      deploymentsCount: project.deployments?.length || 0,
      metadata: project.metadata
    }));
    
    return json({
      success: true,
      total: result.total,
      projects
    });
  } catch (error) {
    logger.error('Error listing projects:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error listing projects'
    }, { status: 500 });
  }
}

/**
 * POST /api/debug-projects/:projectId - Get a single project by ID
 */
export async function action({ request, context }: ActionFunctionArgs) {
  try {
    let projectId = '';
    
    // Parse request to get project ID
    try {
      const body = await request.json() as { projectId?: string };
      projectId = body.projectId || '';
    } catch (e) {
      // Try URL path
      const path = new URL(request.url).pathname;
      const match = path.match(/\/api\/debug-projects\/([^\/]+)/);
      if (match) {
        projectId = match[1];
      }
    }
    
    if (!projectId) {
      return json({ 
        success: false, 
        error: 'Project ID is required' 
      }, { status: 400 });
    }
    
    logger.info(`Getting project details for ${projectId}`);
    
    const projectManager = getProjectStateManager();
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      return json({ 
        success: false, 
        error: 'Project not found' 
      }, { status: 404 });
    }
    
    return json({
      success: true,
      project: {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        files: project.files.map(f => ({ 
          path: f.path, 
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
          isDeleted: f.isDeleted
        })),
        requirements: project.requirements,
        deployments: project.deployments,
        metadata: project.metadata
      }
    });
  } catch (error) {
    logger.error('Error getting project:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error getting project'
    }, { status: 500 });
  }
} 