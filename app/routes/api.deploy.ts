import { json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getProjectStorageService } from '~/lib/projects';
import { getProjectStateManager } from '~/lib/projects';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import type { DeploymentStatus } from '~/lib/deployment/types';
import { getCloudflareCredentials, getNetlifyCredentials, getGitHubCredentials } from '~/lib/deployment/credentials';
import type { EnvWithCloudflare } from '~/lib/environments';
import type { ProjectFile } from '~/lib/projects/types';
import type { EnhancedProjectState } from '~/lib/projects/enhanced-types';

const logger = createScopedLogger('api-deploy');

interface DeployResponse {
  success: boolean;
  deployment?: {
    id: string;
    url: string;
    status: DeploymentStatus;
    provider: string;
  };
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * Route for deploying projects
 * POST /api/deploy - Deploy a project
 */
export async function action({ request, context }: ActionFunctionArgs) {
  try {
    // Parse the request body
    let body: any;
    const contentType = request.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      // Handle form data
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    }

    // Extract deployment parameters
    const { 
      projectId, 
      projectName = body.name || 'Untitled Project',
      files = {},
      targetName: requestedTargetName,
      metadata = {},
      cfCredentials, // Existing override for Cloudflare
      netlifyCredentials, // Allow directly passing Netlify credentials
      githubCredentials, // New: Allow directly passing GitHub credentials
      setupGitHub = false  // New: Flag to indicate if we should set up GitHub repo first
    } = body;

    if (!projectId && Object.keys(files).length === 0) {
      return json<DeployResponse>({ 
        success: false,
        error: { 
          message: 'Either projectId or files must be provided',
          code: 'INVALID_INPUT'
        }
      }, { status: 400 });
    }
    
    logger.info(`Handling deployment request for ${projectId ? `project ID ${projectId}` : `project ${projectName}`}`);

    // Import the DeploymentWorkflowService
    const { getDeploymentWorkflowService } = await import('~/lib/deployment/deployment-workflow');
    const deploymentWorkflowService = getDeploymentWorkflowService();

    // Get the enhanced storage service
    const storageService = getProjectStorageService();

    // --- Credential Handling --- 
    // Set up credentials object for the workflow service
    const credentials: any = {};
    let credSource = 'none';

    // Cloudflare credentials
    const cfConfig = getCloudflareCredentials(context);
    if (cfConfig.accountId && cfConfig.apiToken) {
      credentials.cloudflare = cfConfig;
      credSource = 'env';
    } else if (cfCredentials) {
      credentials.cloudflare = cfCredentials;
      credSource = 'request';
    }

    // Netlify credentials
    if (netlifyCredentials?.apiToken) {
      credentials.netlify = netlifyCredentials;
      credSource = 'request';
    }

    // GitHub credentials
    if (githubCredentials?.token) {
      credentials.github = githubCredentials;
      credSource = 'request';
    }

    logger.info(`Using credentials from ${credSource}`);

    // --- Project Loading ---
    let project: EnhancedProjectState | null = null;
    let deployFiles = files;
    let deployProjectName = projectName;

    if (projectId) {
      try {
        // Use enhanced storage service to get project
        project = await storageService.getProject(projectId);
        if (!project) {
          return json<DeployResponse>({ 
            success: false,
            error: { 
              message: `Project ${projectId} not found`,
              code: 'PROJECT_NOT_FOUND'
            }
          }, { status: 404 });
        }
        
        deployProjectName = project.name;
        
        // Load project files using enhanced storage
        const projectFiles = await storageService.getProjectFiles(projectId);
        deployFiles = projectFiles.reduce((map: Record<string, string>, file: ProjectFile) => {
          if (!file.isDeleted) {
            map[file.path] = file.content;
          }
          return map;
        }, {} as Record<string, string>);
        
        if (Object.keys(deployFiles).length === 0) {
          return json<DeployResponse>({ 
            success: false,
            error: { 
              message: `No files found for project ${projectId}`,
              code: 'NO_FILES'
            }
          }, { status: 400 });
        }
      } catch (error) {
        logger.error(`[api.deploy] Error loading project files for ${projectId}: ${error}`);
        return json<DeployResponse>({ 
          success: false,
          error: { 
            message: `Failed to load project: ${error instanceof Error ? error.message : 'Unknown error'}`,
            code: 'LOAD_ERROR'
          }
        }, { status: 500 });
      }
    }
    
    // Deploy using the DeploymentWorkflowService
    logger.info(`Deploying project ${deployProjectName} with ${Object.keys(deployFiles).length} files using DeploymentWorkflowService`);
    
    const deployment = await deploymentWorkflowService.deployProject({
      projectId: projectId || `temp-${Date.now()}`,
      projectName: deployProjectName,
      files: deployFiles,
      targetName: requestedTargetName, 
      setupGitHub,
      credentials,
      metadata: { 
        ...metadata, 
        environment: context
      }
    });
    
    logger.info(`Deployment result: ${deployment.status}, URL: ${deployment.url}`);
    
    // If projectId was provided, save the deployment to the project using enhanced storage
    if (projectId && project) {
      await storageService.addDeployment(projectId, {
        id: deployment.id || `deploy-${Date.now()}`,
        url: deployment.url,
        provider: deployment.provider,
        timestamp: Date.now(),
        status: deployment.status
      });

      // Cache the deployment files for future use
      try {
        await storageService.cacheProjectFiles(projectId, deployFiles);
        logger.info(`[api.deploy] Cached ${Object.keys(deployFiles).length} files for project ${projectId}`);
      } catch (cacheError) {
        logger.warn(`[api.deploy] Failed to cache project files: ${cacheError}`);
        // Don't fail the request if caching fails
      }
    }
    
    return json<DeployResponse>({
      success: true,
      deployment: {
        id: deployment.id,
        url: deployment.url,
        status: deployment.status,
        provider: deployment.provider
      }
    });
  } catch (error) {
    logger.error('Error handling deployment request:', error);
    return json<DeployResponse>({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error during deployment',
        code: 'DEPLOYMENT_ERROR'
      }
    }, { status: 500 });
  }
}

/**
 * GET handler to check deployment status
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const deploymentId = url.searchParams.get('id');
  
  if (!deploymentId) {
    return json({ error: 'Deployment ID is required' }, { status: 400 });
  }
  
  try {
    // Get deployment manager to check status
    const { getDeploymentManager } = await import('~/lib/deployment/deployment-manager');
    
    // Get cloudflare environment variables safely
    const env = context?.cloudflare?.env as EnvWithCloudflare || {};
    const cfConfig: any = {};
    
    if (typeof env.CLOUDFLARE_ACCOUNT_ID === 'string') {
      cfConfig.accountId = env.CLOUDFLARE_ACCOUNT_ID;
    }
    
    if (typeof env.CLOUDFLARE_API_TOKEN === 'string') {
      cfConfig.apiToken = env.CLOUDFLARE_API_TOKEN;
    }

    const deploymentManager = await getDeploymentManager({
      cloudflareConfig: cfConfig.accountId && cfConfig.apiToken 
        ? cfConfig 
        : undefined
    });
    
    // Find which target this deployment belongs to
    const targetNames = deploymentManager.getRegisteredTargets();
    
    // Try each target until we find one that recognizes this deployment
    let deploymentStatus: DeploymentStatus | null = null;
    let error: Error | null = null;
    
    for (const targetName of targetNames) {
      try {
        const target = deploymentManager.getTarget(targetName);
        if (target) {
          deploymentStatus = await target.getDeploymentStatus(deploymentId);
          if (deploymentStatus) {
            break;
          }
        }
      } catch (e) {
        error = e instanceof Error ? e : new Error('Unknown error checking deployment status');
        logger.warn(`Target ${targetName} failed to get deployment status:`, error);
      }
    }
    
    if (!deploymentStatus && error) {
      return json({ error: error.message }, { status: 500 });
    }
    
    if (!deploymentStatus) {
      return json({ error: 'Deployment not found' }, { status: 404 });
    }
    
    return json({
      success: true,
      status: deploymentStatus
    });
  } catch (error) {
    logger.error('Error checking deployment status:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error checking deployment status'
    }, { status: 500 });
  }
}
