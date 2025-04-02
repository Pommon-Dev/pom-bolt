import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { createScopedLogger } from '~/utils/logger';
import { getProjectStateManager } from '~/lib/projects';
import { handleProjectContext } from '~/lib/middleware/project-context';

const logger = createScopedLogger('api-requirements');

// Define interface for the request body
interface RequirementsRequestBody {
  content?: string;
  requirements?: string;
  projectId?: string;
  userId?: string;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    // Parse request body
    let body: RequirementsRequestBody;
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      body = (await request.json()) as RequirementsRequestBody;
    } else {
      // Handle form data or other formats
      const formData = await request.formData();
      body = {
        content: formData.get('content')?.toString(),
        requirements: formData.get('requirements')?.toString(),
        projectId: formData.get('projectId')?.toString(),
        userId: formData.get('userId')?.toString(),
      };
    }

    logger.info('Received requirements request', { 
      projectId: body.projectId,
      hasContent: Boolean(body.content || body.requirements) 
    });

    // Use either content or requirements field, preferring content if both are provided
    const requirementsContent = body.content || body.requirements;

    // Validate the content
    if (!requirementsContent || typeof requirementsContent !== 'string') {
      logger.error('Invalid content in request:', body);
      return json(
        {
          error: 'Requirements content is required and must be a string (use field name "content" or "requirements")',
          received: body,
        },
        { status: 400 },
      );
    }

    // Process the project context to handle existing and new projects
    const projectContext = await handleProjectContext(request, {
      autoCreateProject: true,
      defaultProjectName: `Project ${new Date().toLocaleDateString()}`,
    });

    const projectManager = getProjectStateManager();
    const { projectId, isNewProject } = projectContext;

    // This is a new project or update to an existing one
    if (isNewProject) {
      if (!projectContext.project) {
        // Create the project if it wasn't auto-created by middleware
        await projectManager.createProject({
          name: `Project ${new Date().toLocaleDateString()}`,
          initialRequirements: requirementsContent,
          userId: body.userId,
        });
        
        logger.info(`Created new project: ${projectId}`);
      } else {
        logger.info(`Using auto-created project: ${projectId}`);
      }
    } else {
      // Update existing project with new requirements
      await projectManager.updateProject(projectId, {
        newRequirements: requirementsContent
      });
      
      logger.info(`Updated existing project: ${projectId}`);
    }

    return json({ 
      success: true, 
      message: 'Requirements received', 
      projectId,
      isNewProject
    });
  } catch (error) {
    logger.error('Error processing requirements:', error);
    return json(
      {
        error: 'Failed to process requirements',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

// Define interface for response data
export interface RequirementsResponseData {
  hasRequirements: boolean;
  latestRequirements: {
    content: string;
    timestamp: number;
  } | null;
  projectId: string | null;
  requirementsCount: number;
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Only allow GET requests
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    // Check if a project ID was provided in the query params
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');
    
    if (!projectId) {
      return json({
        hasRequirements: false,
        latestRequirements: null,
        projectId: null,
        requirementsCount: 0
      } as RequirementsResponseData);
    }
    
    // Get the project state manager
    const projectManager = getProjectStateManager();
    
    // Check if the project exists
    const exists = await projectManager.projectExists(projectId);
    if (!exists) {
      return json({
        hasRequirements: false,
        latestRequirements: null,
        projectId,
        requirementsCount: 0
      } as RequirementsResponseData);
    }
    
    // Get the requirements history
    const requirementsHistory = await projectManager.getRequirementsHistory(projectId);
    
    // No requirements
    if (requirementsHistory.length === 0) {
      return json({
        hasRequirements: false,
        latestRequirements: null,
        projectId,
        requirementsCount: 0
      } as RequirementsResponseData);
    }
    
    // Sort requirements by timestamp (newest first)
    const sortedRequirements = [...requirementsHistory].sort((a, b) => b.timestamp - a.timestamp);
    const latestRequirement = sortedRequirements[0];
    
    return json({
      hasRequirements: true,
      latestRequirements: {
        content: latestRequirement.content,
        timestamp: latestRequirement.timestamp
      },
      projectId,
      requirementsCount: requirementsHistory.length
    } as RequirementsResponseData);
  } catch (error) {
    logger.error('Error retrieving requirements:', error);
    return json(
      {
        error: 'Failed to retrieve requirements',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
