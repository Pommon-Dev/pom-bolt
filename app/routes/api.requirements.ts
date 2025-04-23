import { json } from '@remix-run/node';
import type { ActionFunction, LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { ProjectStateManager } from '~/lib/projects/state-manager';
import { D1StorageAdapter } from '~/lib/projects/adapters/d1-storage-adapter';
import type { RequirementsResponseData } from '~/lib/requirements/types';
import type { RequirementsEntry } from '~/lib/requirements/types';
import type { ProjectState } from '~/lib/projects/types';
import { createScopedLogger } from '~/utils/logger';
import type { D1Database } from '@cloudflare/workers-types';
import { v4 as uuidv4 } from 'uuid';
import { runRequirementsChain } from '~/lib/middleware/requirements-chain';
import type { DeploymentResult } from '~/lib/deployment/types';

const logger = createScopedLogger('api-requirements');

interface CloudflareContext {
  cloudflare: {
    env: {
      DB: D1Database;
      POM_BOLT_PROJECTS: KVNamespace;
    };
  };
}

/**
 * Error codes for requirements API errors
 */
export enum RequirementsApiErrorCode {
  INVALID_REQUEST = 'INVALID_REQUEST',
  PROCESSING_ERROR = 'PROCESSING_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Custom error class for requirements API errors
 */
export class RequirementsApiError extends Error {
  constructor(
    message: string,
    public code: RequirementsApiErrorCode,
    public originalError?: unknown,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'RequirementsApiError';
  }

  /**
   * Create a validation error
   */
  static validation(message: string, context?: Record<string, any>): RequirementsApiError {
    return new RequirementsApiError(
      message,
      RequirementsApiErrorCode.VALIDATION_ERROR,
      undefined,
      context
    );
  }

  /**
   * Create an error from another error
   */
  static fromError(
    error: unknown,
    code: RequirementsApiErrorCode,
    message?: string,
    context?: Record<string, any>
  ): RequirementsApiError {
    const errorMessage = message || (error instanceof Error ? error.message : 'Unknown error');
    return new RequirementsApiError(
      errorMessage,
      code,
      error,
      context
    );
  }
}

/**
 * Helper function to enhance requirements with status and priority
 */
function enhanceRequirements(requirementsEntries: any[]): RequirementsEntry[] {
  return requirementsEntries.map(req => ({
    id: req.id,
    content: req.content,
    timestamp: req.timestamp,
    userId: req.userId,
    metadata: req.metadata,
    status: req.status || 'pending',
    completedAt: req.completedAt
  }));
}

/**
 * Get or initialize the requirements project
 */
async function getOrCreateRequirementsProject(db: D1Database): Promise<ProjectState> {
  // Try direct DB approach first for Cloudflare Pages environment
  const d1Adapter = new D1StorageAdapter(db);
  let requirementsProject = await d1Adapter.getProject('requirements');
  
  if (!requirementsProject) {
    logger.info('Requirements project not found, creating it');
    
    // Initialize project
    const now = Date.now();
    requirementsProject = {
      id: 'requirements',
      name: 'Requirements Collection',
      createdAt: now,
      updatedAt: now,
      files: [],
      requirements: [],
      deployments: [],
      webhooks: [],
      metadata: { type: 'requirements' }
    };
    
    // Save to database
    await d1Adapter.saveProject(requirementsProject);
    
    // Initialize project list if needed
    const projectListKey = 'pom_bolt_project_list';
    const projectList = await db
      .prepare(`SELECT id FROM projects WHERE id = ?`)
      .bind(projectListKey)
      .first();
    
    if (!projectList) {
      // Create project list
      await db
        .prepare(`INSERT INTO projects (id, name, metadata, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?)`)
        .bind(
          projectListKey,
          'Project List',
          JSON.stringify([{ id: 'requirements', createdAt: now, updatedAt: now }]),
          now,
          now
        )
        .run();
    } else {
      // Update project list
      const listData = await db
        .prepare(`SELECT metadata FROM projects WHERE id = ?`)
        .bind(projectListKey)
        .first();
      
      try {
        const metadata = listData && listData.metadata ? 
          (typeof listData.metadata === 'string' ? 
            JSON.parse(listData.metadata) : 
            listData.metadata
          ) : [];
        
        const list = Array.isArray(metadata) ? metadata : [];
        
        if (!list.some(entry => entry.id === 'requirements')) {
          list.push({ 
            id: 'requirements', 
            createdAt: now, 
            updatedAt: now 
          });
          
          await db
            .prepare(`UPDATE projects SET metadata = ?, updated_at = ? WHERE id = ?`)
            .bind(
              JSON.stringify(list),
              now,
              projectListKey
            )
            .run();
        }
      } catch (error) {
        logger.error('Error updating project list:', error);
      }
    }
  }
  
  return requirementsProject;
}

/**
 * Update requirements in the database
 */
async function updateRequirements(
  db: D1Database, 
  requirementsProject: ProjectState,
  newRequirements: any[]
): Promise<ProjectState> {
  const d1Adapter = new D1StorageAdapter(db);
  
  // Add new requirements
  const updatedProject: ProjectState = {
    ...requirementsProject,
    requirements: [
      ...(requirementsProject.requirements || []),
      ...newRequirements
    ],
    updatedAt: Date.now()
  };
  
  // Save to database
  await d1Adapter.saveProject(updatedProject);
  
  return updatedProject;
}

/**
 * GET handler for requirements API
 */
export async function loader({ context }: LoaderFunctionArgs & { context: CloudflareContext }) {
  try {
    logger.debug('Loading requirements data');
    
    const d1 = context.cloudflare.env.DB;
    if (!d1) {
      logger.error('D1 database not available');
      throw new Error('Database not available');
    }
    
    // Get or create requirements project
    const requirementsProject = await getOrCreateRequirementsProject(d1);
    
    // Enhance requirements
    const enhancedRequirements = enhanceRequirements(requirementsProject.requirements || []);

    logger.info('Requirements loaded successfully', {
      requirementsCount: enhancedRequirements.length,
      webhooksCount: requirementsProject.webhooks?.length || 0
    });

    return json<RequirementsResponseData>({
      success: true,
      data: {
        requirements: enhancedRequirements,
        webhooks: requirementsProject.webhooks || []
      }
    });
  } catch (error) {
    logger.error('Failed to load requirements:', error);
    return json<RequirementsResponseData>({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        code: RequirementsApiErrorCode.PROCESSING_ERROR
      }
    });
  }
}

/**
 * API endpoint for handling requirements processing
 * POST /api/requirements - Process requirements and generate code/project
 */
export const action = async ({ request, context }: ActionFunctionArgs & { context: CloudflareContext }) => {
  try {
    logger.info('Running requirements processing chain', {
      method: request.method,
      url: request.url,
      hasContext: !!context,
      hasCloudflare: !!context?.cloudflare,
      hasEnv: !!context?.cloudflare?.env,
      envKeys: context?.cloudflare?.env ? Object.keys(context.cloudflare.env) : []
    });

    // Determine request type - form data or JSON
    const contentType = request.headers.get('Content-Type') || '';
    let projectId, requirements, webhooks, shouldDeploy, targetName, netlifyCredentials, githubCredentials, setupGitHub;
    
    if (contentType.includes('application/json')) {
      // Handle JSON request
      const body = await request.json() as {
        projectId?: string;
        requirements?: string;
        content?: string;
        webhooks?: string;
        shouldDeploy?: boolean;
        targetName?: string;
        netlifyCredentials?: Record<string, any>;
        githubCredentials?: Record<string, any>;
        setupGitHub?: boolean;
      };
      
      projectId = body.projectId;
      requirements = body.requirements || body.content;
      webhooks = body.webhooks;
      shouldDeploy = body.shouldDeploy;
      targetName = body.targetName;
      netlifyCredentials = body.netlifyCredentials;
      githubCredentials = body.githubCredentials;
      setupGitHub = body.setupGitHub;
    } else {
      // Handle form data request
      const formData = await request.formData();
      projectId = formData.get('projectId') as string;
      requirements = formData.get('requirements');
      webhooks = formData.get('webhooks');
      shouldDeploy = formData.get('shouldDeploy') === 'true';
      targetName = formData.get('targetName') as string;
      
      // Try to parse credentials if provided as strings
      try {
        const netlifyCredsStr = formData.get('netlifyCredentials');
        if (netlifyCredsStr) {
          netlifyCredentials = JSON.parse(netlifyCredsStr as string);
        }
        
        const githubCredsStr = formData.get('githubCredentials');
        if (githubCredsStr) {
          githubCredentials = JSON.parse(githubCredsStr as string);
        }
      } catch (error) {
        logger.warn('Failed to parse credentials from form data:', error);
      }
      
      setupGitHub = formData.get('setupGitHub') === 'true';
    }

    // Validate inputs
    if (!requirements) {
      throw new Error('Missing requirements content');
    }
    
    // Special case for the requirements collection project
    if (projectId === 'requirements') {
      logger.info('Handling special case for requirements collection project');
      // Just use the existing storage logic for the requirements collection project
      const d1 = context.cloudflare.env.DB;
      if (!d1) {
        logger.error('D1 database not available');
        throw new Error('Database not available');
      }

      // Parse requirements if it's JSON
      let parsedRequirements: any[] = [];
      try {
        const reqData = JSON.parse(requirements as string);
        parsedRequirements = Array.isArray(reqData) ? reqData : [{
          id: `req-${Date.now()}`,
          content: requirements as string,
          timestamp: Date.now(),
          status: 'pending',
          completedAt: undefined,
        }];
      } catch (e) {
        // If not valid JSON, treat as a single requirement text
        parsedRequirements = [{
          id: `req-${Date.now()}`,
          content: requirements as string,
          timestamp: Date.now(),
          status: 'pending',
          completedAt: undefined,
        }];
      }

      // Parse webhooks if provided
      let webhooksList = [];
      if (webhooks) {
        try {
          webhooksList = JSON.parse(webhooks as string);
        } catch (e) {
          logger.warn('Failed to parse webhooks JSON', e);
        }
      }

      // Get or create requirements project
      const requirementsProject = await getOrCreateRequirementsProject(d1);
      
      // Update requirements
      const updatedProject = await updateRequirements(d1, requirementsProject, parsedRequirements);
      
      // Update webhooks if provided
      if (webhooks) {
        const d1Adapter = new D1StorageAdapter(d1);
        await d1Adapter.updateProject('requirements', {
          webhooks: webhooksList
        });
      }
      
      return json<RequirementsResponseData>({
        success: true,
        data: {
          requirements: enhanceRequirements(updatedProject.requirements || []),
          webhooks: updatedProject.webhooks || webhooksList
        }
      });
    }
    
    // For regular project generation, use the requirements chain
    logger.info('Running requirements processing chain', { 
      newProject: !projectId,
      shouldDeploy,
      targetName
    });
    
    // Create a modified request with the necessary data for the requirements chain
    const modifiedRequest = new Request(request.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('Cookie') || ''
      },
      body: JSON.stringify({
        projectId,
        content: requirements,
        shouldDeploy: shouldDeploy || false,
        deploymentTarget: targetName || 'auto',
        deploymentOptions: {
          netlifyCredentials,
          githubCredentials,
          setupGitHub
        }
      })
    });
    
    // Run the requirements chain
    const result = await runRequirementsChain(modifiedRequest, context);
    
    // Handle errors from the chain
    if (result.error) {
      logger.error('Error in requirements chain:', result.error);
      throw result.error;
    }
    
    // Return the result
    return json({
      success: true,
      data: {
        projectId: result.projectId,
        files: Object.keys(result.files || {}).length,
        isNewProject: result.isNewProject,
        deployment: result.deploymentResult as DeploymentResult
      }
    });
  } catch (error) {
    logger.error('Failed to process requirements:', error);
    
    if (error instanceof RequirementsApiError) {
      return json<RequirementsResponseData>({
        success: false,
        error: {
          message: error.message,
          code: error.code,
          context: error.context
        }
      });
    }

    return json<RequirementsResponseData>({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        code: RequirementsApiErrorCode.PROCESSING_ERROR
      }
    });
  }
};
