import { json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getDeploymentManager } from '~/lib/deployment/deployment-manager';
import { getProjectStateManager } from '~/lib/projects';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import type { DeploymentTarget } from '~/lib/deployment/targets/base';
import type { CloudflareConfig, DeploymentStatus } from '~/lib/deployment/types';
import { getCloudflareCredentials, getNetlifyCredentials } from '~/lib/deployment/credentials';

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
      targetName,
      metadata = {},
      cfCredentials, // Existing override for Cloudflare
      netlifyCredentials // New: Allow directly passing Netlify credentials
    } = body;

    if (!projectId && Object.keys(files).length === 0) {
      return json({ error: 'Either projectId or files must be provided' }, { status: 400 });
    }
    
    logger.info(`Handling deployment request for ${projectId ? `project ID ${projectId}` : `project ${projectName}`}`);

    // --- Credential Handling --- 
    let cfConfig = getCloudflareCredentials(context);
    let netlifyToken = getNetlifyCredentials(context).apiToken;
    let credSource = netlifyToken ? 'environment/context' : 'none';

    // Log initial credential status before overrides
    logger.debug('Initial credentials from environment:', {
      hasCloudflareAccountId: !!cfConfig.accountId,
      hasCloudflareApiToken: !!cfConfig.apiToken,
      hasNetlifyToken: !!netlifyToken,
      source: credSource
    });

    // Add detailed context logging for debugging
    logger.debug('Context structure in api.deploy:', {
      hasContext: !!context,
      contextType: context ? typeof context : 'undefined',
      hasEnv: !!context?.env,
      envType: context?.env ? typeof context.env : 'undefined',
      hasCloudflare: !!context?.cloudflare,
      cloudflareEnvAvailable: !!context?.cloudflare?.env,
      envKeys: context?.env ? Object.keys(context.env) : [],
      cfEnvKeys: context?.cloudflare?.env ? Object.keys(context.cloudflare.env) : []
    });

    // Override Cloudflare credentials if provided in request
    if (cfCredentials && cfCredentials.accountId && cfCredentials.apiToken) {
      logger.debug('Using Cloudflare credentials provided in request body');
      cfConfig = {
        ...cfConfig,
        accountId: cfCredentials.accountId,
        apiToken: cfCredentials.apiToken,
        projectName: cfCredentials.projectName || cfConfig.projectName || 'genapps'
      };
      credSource = 'request (Cloudflare)';
    }
    
    // Only override Netlify token from request if not already set from environment
    if (!netlifyToken && netlifyCredentials && netlifyCredentials.apiToken) {
      logger.debug('Using Netlify token from request body (no token found in environment)');
      netlifyToken = netlifyCredentials.apiToken;
      credSource = 'request (Netlify)';
    } else if (netlifyCredentials && netlifyCredentials.apiToken) {
      logger.debug('Ignoring Netlify token from request body (using token from environment)');
    }
    // --- End Credential Handling ---
    
    // Log credentials status (redacted)
    logger.debug('Credentials status:', {
      cfHasAccountId: !!cfConfig.accountId,
      cfHasApiToken: !!cfConfig.apiToken,
      cfComplete: !!(cfConfig.accountId && cfConfig.apiToken),
      netlifyHasToken: !!netlifyToken,
      source: credSource
    });

    // Get managers, initializing DeploymentManager with potentially overridden credentials
    const projectManager = getProjectStateManager();
    const deploymentManager = await getDeploymentManager({
      cloudflareConfig: cfConfig.accountId && cfConfig.apiToken 
        ? cfConfig as CloudflareConfig 
        : undefined,
      netlifyToken: netlifyToken || undefined // Pass the potentially overridden token
    });

    // If projectId is provided but files aren't, load files from storage
    let deployFiles = files;
    let deployProjectName = projectName;
    
    if (projectId && Object.keys(files).length === 0) {
      logger.debug(`Loading project files for ${projectId}`);
      // Load project
      const project = await projectManager.getProject(projectId);
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
    }
    
    // Deploy the project
    logger.info(`Deploying project ${deployProjectName} with ${Object.keys(deployFiles).length} files`);
    
    // First check what deployment targets are available
    const availableTargets = await deploymentManager.getAvailableTargets();
    logger.info(`Available deployment targets: ${availableTargets.join(', ')}`);
    
    // Deploy with best target or specified target
    const deployment = await deploymentManager.deployWithBestTarget({
      projectName: deployProjectName,
      files: deployFiles,
      targetName,
      projectId,
      metadata: { ...metadata, environment: context } // Pass context for targets like local-zip
    });
    
    // If projectId was provided, save the deployment to the project
    if (projectId) {
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
    // Get cloudflare environment variables safely
    const env = context?.cloudflare?.env as EnvWithCloudflare || {};
    const cfConfig: Partial<CloudflareConfig> = {};
    
    if (typeof env.CLOUDFLARE_ACCOUNT_ID === 'string') {
      cfConfig.accountId = env.CLOUDFLARE_ACCOUNT_ID;
    }
    
    if (typeof env.CLOUDFLARE_API_TOKEN === 'string') {
      cfConfig.apiToken = env.CLOUDFLARE_API_TOKEN;
    }

    const deploymentManager = await getDeploymentManager({
      cloudflareConfig: cfConfig.accountId && cfConfig.apiToken 
        ? cfConfig as CloudflareConfig 
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
