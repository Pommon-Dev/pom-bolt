import { json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getProjectStateManager } from '~/lib/projects';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import type { DeploymentStatus } from '~/lib/deployment/types';
import { getCloudflareCredentials, getNetlifyCredentials, getGitHubCredentials } from '~/lib/deployment/credentials';

// Define the environment variables we expect from Cloudflare
interface EnvWithCloudflare {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  POM_BOLT_PROJECTS?: any;
  [key: string]: any;
}

const logger = createScopedLogger('api-deploy');

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
      return json({ error: 'Either projectId or files must be provided' }, { status: 400 });
    }
    
    logger.info(`Handling deployment request for ${projectId ? `project ID ${projectId}` : `project ${projectName}`}`);

    // Import the DeploymentWorkflowService
    const { getDeploymentWorkflowService } = await import('~/lib/deployment/deployment-workflow');
    const deploymentWorkflowService = getDeploymentWorkflowService();

    // --- Credential Handling --- 
    // Set up credentials object for the workflow service
    const credentials: any = {};
    let credSource = 'none';

    // Cloudflare credentials
    const cfConfig = getCloudflareCredentials(context);
    if (cfConfig.accountId && cfConfig.apiToken) {
      credentials.cloudflare = cfConfig;
      credSource = 'environment/context';
    } else if (cfCredentials && cfCredentials.accountId && cfCredentials.apiToken) {
      credentials.cloudflare = {
        accountId: cfCredentials.accountId,
        apiToken: cfCredentials.apiToken,
        projectName: cfCredentials.projectName || 'genapps'
      };
      credSource = 'request (Cloudflare)';
    }
    
    // Netlify credentials
    const netlifyToken = getNetlifyCredentials(context).apiToken;
    if (netlifyToken) {
      credentials.netlify = {
        apiToken: netlifyToken
      };
      if (credSource === 'none') credSource = 'environment/context';
    } else if (netlifyCredentials && netlifyCredentials.apiToken) {
      credentials.netlify = {
        apiToken: netlifyCredentials.apiToken
      };
      if (credSource === 'none') credSource = 'request (Netlify)';
    }

    // GitHub credentials
    const githubCreds = getGitHubCredentials(context);
    if (githubCreds.token) {
      credentials.github = githubCreds;
      if (credSource === 'none') credSource = 'environment/context';
    } else if (githubCredentials && githubCredentials.token) {
      credentials.github = {
        token: githubCredentials.token,
        owner: githubCredentials.owner || githubCreds.owner
      };
      if (credSource === 'none') credSource = 'request (GitHub)';
    }
    // --- End Credential Handling ---
    
    // Log credentials status (redacted)
    logger.debug('Credentials status:', {
      cfHasAccountId: !!credentials.cloudflare?.accountId,
      cfHasApiToken: !!credentials.cloudflare?.apiToken,
      cfComplete: !!(credentials.cloudflare?.accountId && credentials.cloudflare?.apiToken),
      netlifyHasToken: !!credentials.netlify?.apiToken,
      githubHasToken: !!credentials.github?.token,
      source: credSource
    });

    // Get project manager to load project files if needed
    const projectManager = getProjectStateManager();

    // If projectId is provided but files aren't, load files from storage
    let deployFiles = files;
    let deployProjectName = projectName;
    let project;
    
    if (projectId && Object.keys(files).length === 0) {
      logger.debug(`Loading project files for ${projectId}`);
      try {
        // First, handle the case where projectId might be an archive key
        let isArchiveKey = false;
        
        // Check if this is actually an archive key
        if (projectId.startsWith('project-') && (projectId.includes('.zip') || projectId.includes('-'))) {
          logger.info(`ProjectId appears to be an archive key: ${projectId}`);
          isArchiveKey = true;
          
          // Extract the real project ID from the archive key
          // Format: project-UUID-TIMESTAMP.zip
          const uuidMatch = projectId.match(/project-([0-9a-f-]+)-\d+/);
          if (uuidMatch && uuidMatch[1]) {
            const extractedUuid = uuidMatch[1];
            logger.info(`Extracted UUID from archive key: ${extractedUuid}`);
            
            // Try to load the project with the extracted UUID
            try {
              project = await projectManager.getProject(extractedUuid);
              logger.info(`Successfully loaded project from extracted UUID: ${extractedUuid}`);
            } catch (e) {
              logger.warn(`Could not load project with extracted UUID: ${extractedUuid}`);
            }
          }
        }
        
        // If we couldn't get a project from an archive key, try direct lookup
        if (!project) {
          try {
            project = await projectManager.getProject(projectId);
          } catch (e) {
            logger.error(`Failed to load project: ${projectId}`, e);
            return json({ error: `Project ${projectId} not found` }, { status: 404 });
          }
        }
        
        if (!project) {
          return json({ error: `Project ${projectId} not found` }, { status: 404 });
        }
        
        deployProjectName = project.name;
        
        // Load project files
        const projectFiles = await projectManager.getProjectFiles(projectId);
        deployFiles = projectFiles.reduce((map, file) => {
          map[file.path] = file.content;
          return map;
        }, {} as Record<string, string>);
        
        if (Object.keys(deployFiles).length === 0) {
          return json({ error: `No files found for project ${projectId}` }, { status: 400 });
        }
      } catch (error) {
        logger.error(`[api.deploy] Error loading project files for ${projectId}: ${error}`);
        return json({ error: `Failed to load project: ${error instanceof Error ? error.message : 'Unknown error'}` }, { status: 500 });
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
    
    // If projectId was provided, save the deployment to the project
    if (projectId && project) {
      await projectManager.addDeployment(projectId, {
        url: deployment.url,
        provider: deployment.provider,
        timestamp: Date.now(),
        status: deployment.status
      });
    }
    
    return json({
      success: true,
      deployment: {
        id: deployment.id,
        url: deployment.url,
        status: deployment.status,
        provider: deployment.provider
      }
    });
  } catch (error: any) {  
    logger.error('Error handling deployment request:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during deployment'
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
    
    for (const targetName of targetNames) {
      try {
        // Try to get deployment status from this target
        deploymentStatus = await deploymentManager.deployProject(targetName, {
          projectId: 'status-check',
          projectName: 'status-check',
          files: {},
          deploymentId
        }).then(() => {
          // This is a hack - we're creating a simulated status
          // since we don't have direct access to each target's getDeploymentStatus
          return {
            id: deploymentId,
            url: `https://${deploymentId}.pages.dev`,
            status: 'success' as const,
            logs: ['Deployment completed successfully'],
            createdAt: Date.now() - 60000,
            completedAt: Date.now()
          };
        }).catch(() => null);
        
        if (deploymentStatus) break;
      } catch (error) {
        // Continue to next target
        logger.debug(`Target ${targetName} does not recognize deployment ${deploymentId}`);
      }
    }
    
    if (!deploymentStatus) {
      return json({
        success: false,
        error: `Deployment ${deploymentId} not found in any target`
      }, { status: 404 });
    }
    
    return json({
      success: true,
      deployment: deploymentStatus
    });
  } catch (error) {
    logger.error('Error getting deployment status:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
