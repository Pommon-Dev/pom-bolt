import { json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getProjectStorageService } from '~/lib/projects';
import { getProjectStateManager } from '~/lib/projects';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import type { DeploymentStatus } from '~/lib/deployment/types';
import { getCloudflareCredentials, getNetlifyCredentials, getGitHubCredentials } from '~/lib/deployment/credentials';
import type { ProjectFile } from '~/lib/projects/types';
import { getDeploymentOrchestrator } from '~/lib/deployment/deployment-orchestrator';
import { CredentialManager } from '~/lib/deployment/credentials';
import type { CloudflareConfig, GitHubConfig, NetlifyConfig } from '~/lib/deployment/types';
import { withErrorHandling, badRequest } from '~/lib/middleware/error-handler';
import type { ApiResponse } from '~/lib/middleware/error-handler';
import { getErrorService, ErrorCategory, AppError } from '~/lib/services/error-service';
import { getDeploymentManager } from '~/lib/deployment/deployment-manager';
import { ConfigValidator, getConfigValidator } from '~/lib/services/config-validator';
import { handleProjectContext } from "~/lib/middleware/project-context";
import { validateTenantAccess } from "~/lib/middleware/requirements-chain";
import { DeploymentManager } from "~/lib/deployment/deployment-manager";
import { ErrorService } from "~/lib/services/error-service";
import { getDeploymentWorkflowService, type DeploymentCredentials } from "~/lib/deployment/deployment-workflow";
import { extractTenantId, validateTenantAccessOrThrow, validateTenantDeploymentAccess } from "~/lib/middleware/tenant-validation";

const logger = createScopedLogger('api-deploy');

// Define the expected request structure
interface DeployRequest {
  projectId: string;
  targetName?: string;
  setupGitHub?: boolean;
  tenantId?: string;
  metadata?: Record<string, any>;
  credentials?: DeploymentCredentials;
  options?: {
    force?: boolean;
    skipBuild?: boolean;
    useWorkflow?: boolean;
  };
}

interface DeployResponse {
  success: boolean;
  deploymentId?: string;
  deploymentUrl?: string;
  targetName?: string;
  logs?: string[];
  github?: {
    repositoryUrl?: string;
    repositoryName?: string;
    branch?: string;
  };
  error?: string | {
    message: string;
    code?: string;
    details?: any;
  };
}

/**
 * Core deployment handler logic
 */
async function handleDeployment({ request, context }: ActionFunctionArgs) {
  try {
    // Extract the request body
    const body = await request.json() as DeployRequest;
    
    // Validate the request
    if (!body.projectId) {
      return json({
        success: false,
        error: "Project ID is required",
      }, { status: 400 });
    }
    
    // Extract tenant ID from request if not provided in the body
    const tenantId = body.tenantId || extractTenantId(request);
    
    // Validate the tenant access for the project using our new middleware
    if (tenantId) {
      logger.debug('Validating tenant access', { 
        projectId: body.projectId, 
        tenantId
      });
      
      // Validate tenant access - will throw an error if validation fails
      await validateTenantAccessOrThrow(body.projectId, tenantId);
    }
    
    // Get the project
    const projectContext = await handleProjectContext(request, { requireExistingProject: true });
    if (!projectContext.project) {
      return json({
        success: false,
        error: "Project not found",
      }, { status: 404 });
    }
    
    // Validate the credentials using ConfigValidator
    if (body.credentials) {
      const configValidator = await getConfigValidator();
      const validationResult = await configValidator.validateDeploymentCredentials(
        body.credentials,
        tenantId
      );
      
      if (Object.keys(validationResult).length === 0) {
        return json({
          success: false,
          error: "Invalid deployment credentials",
        }, { status: 400 });
      }
    }
    
    // Convert files to the format expected by deploy
    const files: Record<string, string> = {};
    projectContext.project.files.forEach(file => {
      if (!file.isDeleted) {
        files[file.path] = file.content;
      }
    });

    let deploymentResult;
    
    // Determine if we should use the workflow service or deployment orchestrator
    const useWorkflow = body.options?.useWorkflow !== false;
    
    if (useWorkflow) {
      logger.info('Using deployment workflow service for deployment', {
        projectId: body.projectId,
        targetName: body.targetName,
        setupGitHub: body.setupGitHub,
        tenantId
      });
      
      // Use the workflow service which handles GitHub setup and deployment
      const workflowService = getDeploymentWorkflowService();
      
      deploymentResult = await workflowService.deployProject({
        projectId: body.projectId,
        projectName: projectContext.project.name,
        files,
        targetName: body.targetName,
        setupGitHub: body.setupGitHub,
        credentials: body.credentials,
        metadata: {
          ...body.metadata,
          tenantId
        }
      });
    } else {
      logger.info('Using deployment orchestrator for deployment', {
        projectId: body.projectId,
        targetName: body.targetName,
        setupGitHub: body.setupGitHub,
        tenantId
      });
      
      // Use the deployment orchestrator directly
      const orchestrator = getDeploymentOrchestrator();
      
      deploymentResult = await orchestrator.deployProject({
        projectId: body.projectId,
        targetName: body.targetName,
        tenantId,
        setupGitHub: body.setupGitHub,
        credentials: body.credentials,
        metadata: body.metadata
      });
    }
    
    // Build the response based on the deployment result
    const response: DeployResponse = {
      success: deploymentResult.status === 'success',
      deploymentId: deploymentResult.id,
      deploymentUrl: deploymentResult.url,
      targetName: deploymentResult.provider,
      logs: deploymentResult.logs
    };
    
    // Add GitHub info if available
    if (deploymentResult.metadata?.github) {
      response.github = {
        repositoryUrl: deploymentResult.metadata.github.url,
        repositoryName: deploymentResult.metadata.github.fullName,
        branch: deploymentResult.metadata.github.defaultBranch
      };
    }
    
    // Add error info if deployment failed
    if (deploymentResult.status === 'failed') {
      response.error = deploymentResult.error || "Deployment failed";
    }
    
    return json(response);
    
  } catch (error) {
    logger.error('Deployment error:', error);
    
    // Handle tenant access denied errors specifically
    if (error instanceof Error && 'category' in error) {
      const appError = error as AppError;
      if (appError.category === ErrorCategory.AUTHORIZATION) {
        return json({
          success: false,
          error: {
            message: appError.message,
            code: appError.code,
            details: appError.details
          }
        }, { status: 403 });
      }
    }
    
    const errorService = getErrorService();
    const appError = errorService.createInternalError("Failed to deploy project", { 
      cause: error instanceof Error ? error.message : String(error) 
    });
    
    return json({
      success: false,
      error: {
        message: appError.message,
        code: appError.code,
        details: appError.details
      }
    }, { status: 500 });
  }
}

/**
 * Core deployment status handler logic
 */
async function handleDeploymentStatus({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const deploymentId = url.searchParams.get('id');
  
  if (!deploymentId) {
    return badRequest('Deployment ID is required');
  }
  
  // Extract tenant ID from request for authorization
  const tenantId = url.searchParams.get('tenantId') || extractTenantId(request);
  
  // Verify tenant access to the deployment
  try {
    const hasAccess = await validateTenantDeploymentAccess(deploymentId, tenantId);
    if (!hasAccess) {
      const errorService = getErrorService();
      throw errorService.createTenantAccessDeniedError(deploymentId, tenantId || 'default');
    }
  } catch (error) {
    if (error instanceof Error && 'category' in error) {
      const appError = error as AppError;
      if (appError.category === ErrorCategory.AUTHORIZATION) {
        return json({ success: false, error: { message: appError.message, code: appError.code } }, { status: 403 });
      }
      if (appError.category === ErrorCategory.NOT_FOUND) {
        return json({ success: false, error: { message: appError.message, code: appError.code } }, { status: 404 });
      }
    }
    return json({ 
      success: false, 
      error: { message: error instanceof Error ? error.message : String(error), code: 'INTERNAL_ERROR' } 
    }, { status: 500 });
  }
  
  // Get deployment manager to check deployment status
  const deploymentManager = await getDeploymentManager();
  
  // Find deployment status
  let deploymentStatus: DeploymentStatus | null = null;
  
  // Try each target to find the deployment
  const targetNames = deploymentManager.getRegisteredTargets();
  for (const targetName of targetNames) {
    try {
      const target = deploymentManager.getTarget(targetName);
      if (!target) continue;
      
      const status = await target.getDeploymentStatus(deploymentId);
      if (status) {
        deploymentStatus = status;
        break;
      }
    } catch (error) {
      logger.debug(`Failed to get deployment status from target ${targetName}`, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  if (!deploymentStatus) {
    return json({ success: false, error: { message: 'Deployment not found', code: 'NOT_FOUND' } }, { status: 404 });
  }
  
  // Format response with standard shape
  return json({ 
    success: true, 
    data: {
      id: deploymentStatus.id,
      url: deploymentStatus.url,
      status: deploymentStatus.status,
      provider: deploymentStatus.metadata?.provider || 'unknown',
      createdAt: deploymentStatus.createdAt,
      completedAt: deploymentStatus.completedAt,
      logs: deploymentStatus.logs,
      tenantId: deploymentStatus.tenantId,
      github: deploymentStatus.metadata?.github 
        ? {
            repositoryUrl: deploymentStatus.metadata.github.url,
            repositoryName: deploymentStatus.metadata.github.fullName,
            branch: deploymentStatus.metadata.github.defaultBranch
          }
        : undefined
    }
  });
}

// Wrap our handlers with the error handling middleware
export const action = withErrorHandling(handleDeployment);
export const loader = withErrorHandling(handleDeploymentStatus);
