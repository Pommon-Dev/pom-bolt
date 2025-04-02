import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { createScopedLogger } from '~/utils/logger';
import { getProjectStateManager } from '~/lib/projects';
import { runRequirementsChain } from '~/lib/middleware/requirements-chain';
import { handleProjectContext } from '~/lib/middleware/project-context';

const logger = createScopedLogger('api-requirements');

// Define interface for the request body
interface RequirementsRequestBody {
  content?: string;
  requirements?: string;
  projectId?: string;
  userId?: string;
  deploy?: boolean;
  deployment?: {
    platform?: string;
    settings?: Record<string, any>;
  };
  deploymentTarget?: string;
  deploymentOptions?: Record<string, any>;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    // Use the new middleware chain to process the request
    const result = await runRequirementsChain(request);
    
    // Handle any errors that occurred during processing
    if (result.error) {
      logger.error('Error processing requirements:', result.error);
      return json(
        {
          error: 'Failed to process requirements',
          message: result.error.message,
          details: result.error.stack
        },
        { status: 500 }
      );
    }
    
    // Prepare the response
    const response: Record<string, any> = {
      success: true,
      projectId: result.projectId,
      isNewProject: result.isNewProject
    };
    
    // Add deployment information if available
    if (result.deploymentResult) {
      response.deployment = {
        url: result.deploymentResult.url,
        id: result.deploymentResult.id,
        status: result.deploymentResult.status
      };
    }
    
    logger.info('Successfully processed requirements', { 
      projectId: result.projectId,
      deployed: Boolean(result.deploymentResult)
    });
    
    return json(response);
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
  deployments?: Array<{
    url: string;
    provider: string;
    timestamp: number;
    status: 'success' | 'failed' | 'in-progress';
  }>;
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
    
    // Get project deployments if available
    const project = await projectManager.getProject(projectId);
    const deployments = project.deployments && project.deployments.length > 0 
      ? project.deployments.map(d => ({
          url: d.url,
          provider: d.provider,
          timestamp: d.timestamp,
          status: d.status
        }))
      : undefined;
    
    return json({
      hasRequirements: true,
      latestRequirements: {
        content: latestRequirement.content,
        timestamp: latestRequirement.timestamp
      },
      projectId,
      requirementsCount: requirementsHistory.length,
      deployments
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
