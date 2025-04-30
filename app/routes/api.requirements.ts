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
import { withErrorHandling } from '~/lib/middleware/error-handler';
import type { ApiResponse } from '~/lib/middleware/error-handler';
import { getErrorService, ErrorCategory } from '~/lib/services/error-service';

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
 * Core handler logic for loading requirements
 */
async function handleGetRequirements({ context }: LoaderFunctionArgs & { context: CloudflareContext }) {
  logger.debug('Loading requirements data');
  
  const d1 = context.cloudflare.env.DB;
  if (!d1) {
    const errorService = getErrorService();
    throw errorService.createInternalError('Database not available');
  }
  
  // Get or create requirements project
  const requirementsProject = await getOrCreateRequirementsProject(d1);
  
  // Enhance requirements
  const enhancedRequirements = enhanceRequirements(requirementsProject.requirements || []);

  logger.info('Requirements loaded successfully', {
    requirementsCount: enhancedRequirements.length,
    webhooksCount: requirementsProject.webhooks?.length || 0
  });

  return {
    requirements: enhancedRequirements,
    webhooks: requirementsProject.webhooks || []
  };
}

interface RequirementsRequestBody {
  credentials?: {
    github?: { token: string; owner?: string };
    netlify?: { apiToken: string };
    cloudflare?: { accountId: string; apiToken: string; projectName?: string };
  };
  deploymentTarget?: string;
  setupGitHub?: boolean;
  [key: string]: any;
}

/**
 * Core handler logic for processing requirements
 */
export async function handleProcessRequirements({ request, context }: ActionFunctionArgs) {
  const logger = createScopedLogger('api-requirements');
  
  try {
    // Log the incoming request
    const body = await request.clone().json() as RequirementsRequestBody;
    logger.debug('📥 Incoming request:', {
      hasBody: !!body,
      bodyKeys: Object.keys(body),
      hasCredentials: !!body.credentials,
      credentialKeys: body.credentials ? Object.keys(body.credentials) : [],
      deploymentTarget: body.deploymentTarget,
      setupGitHub: body.setupGitHub
    });

    // Extract tenant ID from request
    const tenantId = request.headers.get('x-tenant-id') || undefined;
    logger.debug('🔍 Extracted tenant ID:', { tenantId });

    // Run the requirements chain
    const resultContext = await runRequirementsChain(request, context);
    
    // Log the result context
    logger.debug('📤 Result context:', {
      projectId: resultContext.projectId,
      hasDeploymentResult: !!resultContext.deploymentResult,
      deploymentStatus: resultContext.deploymentResult?.status,
      hasError: !!resultContext.error,
      errorMessage: resultContext.error?.message,
      hasGitHubInfo: !!resultContext.githubInfo,
      githubError: resultContext.githubError?.message,
      hasGitHubOptions: !!resultContext.githubOptions,
      githubSetupRequested: resultContext.githubOptions?.setupGitHub
    });

    // If there was a critical error, return it
    if (resultContext.error && (!resultContext.projectId || !resultContext.generatedFiles)) {
      const errorService = getErrorService();
      throw errorService.normalizeError(
        resultContext.error,
        'Failed to process requirements'
      );
    }
    
    // Determine success status for each phase
    const codeGenerationSuccess = !!resultContext.projectId && !!resultContext.generatedFiles;
    const githubSuccess = resultContext.githubOptions?.setupGitHub 
      ? !!resultContext.githubInfo && !resultContext.githubError 
      : undefined;
    const deploymentSuccess = resultContext.shouldDeploy 
      ? resultContext.deploymentResult?.status === 'success' 
      : undefined;
    
    logger.info('Requirements processed', {
      success: codeGenerationSuccess,
      projectId: resultContext.projectId,
      hasGitHubRepo: !!resultContext.githubInfo,
      hasDeployment: !!resultContext.deploymentResult,
      deploymentUrl: resultContext.deploymentResult?.url || 'none'
    });
    
    // Return comprehensive response with modular phases information
    return {
      success: codeGenerationSuccess,
      projectId: resultContext.projectId,
      isNewProject: resultContext.isNewProject,
      name: resultContext.name || '',
      fileCount: Object.keys(resultContext.generatedFiles || {}).length,
      // Links section with all available links
      links: {
        downloadUrl: resultContext.archiveKey 
          ? `/api/download-project/${resultContext.projectId}` 
          : undefined,
        githubUrl: resultContext.githubInfo?.url,
        deploymentUrl: resultContext.deploymentResult?.url
      },
      // Detailed status for each phase in the modular flow
      phases: {
        codeGeneration: {
          status: codeGenerationSuccess ? 'success' : 'failed',
          error: resultContext.error?.message,
          completedAt: resultContext.isNewProject 
            ? new Date().toISOString() 
            : undefined
        },
        // Only include github phase if it was requested
        github: resultContext.githubOptions?.setupGitHub ? {
          status: githubSuccess ? 'success' : 'failed',
          error: resultContext.githubError?.message,
          repositoryUrl: resultContext.githubInfo?.url,
          repositoryName: resultContext.githubInfo?.fullName,
          branch: resultContext.githubInfo?.defaultBranch
        } : undefined,
        // Only include deployment phase if it was requested
        deployment: resultContext.shouldDeploy ? {
          status: deploymentSuccess ? 'success' : 'failed',
          error: resultContext.deploymentError instanceof Error 
            ? resultContext.deploymentError.message 
            : resultContext.deploymentError 
              ? String(resultContext.deploymentError) 
              : undefined,
          url: resultContext.deploymentResult?.url,
          provider: resultContext.deploymentResult?.provider,
          deploymentId: resultContext.deploymentResult?.id
        } : undefined
      }
    };
  } catch (error) {
    logger.error('Error processing requirements', error);
    throw error;
  }
}

/**
 * Validate authentication from request
 */
async function validateAuthentication(request: Request, context: CloudflareContext): Promise<string | undefined> {
  // Check for API key or token in headers
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    // For now, we'll just use the token as a user ID
    // In a real implementation, this would verify the token
    return token;
  }
  
  // Check for API key in query params
  const url = new URL(request.url);
  const apiKey = url.searchParams.get('apiKey');
  if (apiKey) {
    // For now, we'll just use the API key as a user ID
    // In a real implementation, this would verify the API key
    return apiKey;
  }
  
  // No authentication provided - that's okay, we'll process anonymously
  return undefined;
}

// Wrap the handlers with the error handling middleware
export const loader = withErrorHandling(handleGetRequirements);
export const action = withErrorHandling(handleProcessRequirements);
