import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { 
  loadProjectContext, 
  processRequirements, 
  deployCode,
  type RequirementsContext 
} from '~/lib/middleware/requirements-chain';

const logger = createScopedLogger('api-requirements');

/**
 * GET handler for requirements API
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Return a simple status message
  return json({
    status: 'Requirements API is available',
    method: 'POST',
    description: 'Submit requirements to generate code and create/update a project',
    schema: {
      content: 'string (required) - Project requirements text',
      deploy: 'boolean (optional) - Whether to deploy the generated code',
      deploymentTarget: 'string (optional) - Deployment target platform',
      projectId: 'string (optional) - Existing project ID to update',
      additionalRequirement: 'boolean (optional) - Set to true to add features to existing project'
    }
  });
}

/**
 * API endpoint for handling requirements processing
 * POST /api/requirements - Process requirements and generate code/project
 */
export async function action({ request, context }: ActionFunctionArgs) {
  try {
    logger.info('🚀 [api.requirements] Processing requirements request');
    
    // Debug request headers
    logger.debug('[api.requirements] Request headers:', {
      contentType: request.headers.get('Content-Type'),
      contentLength: request.headers.get('Content-Length'),
      accept: request.headers.get('Accept')
    });
    
    // Parse the request body once
    let reqBody;
    try {
      const clonedRequest = request.clone();
      const rawBody = await clonedRequest.text();
      
      logger.debug('[api.requirements] Raw request body:', { 
        length: rawBody.length,
        preview: rawBody.substring(0, 100) + (rawBody.length > 100 ? '...' : '')
      });
      
      if (rawBody.trim().startsWith('{')) {
        try {
          reqBody = JSON.parse(rawBody);
          logger.info('[api.requirements] Request body properties:', {
            shouldDeploy: !!reqBody.shouldDeploy,
            deploymentTarget: reqBody.deploymentTarget || 'not specified',
            hasGithubCreds: !!reqBody.githubCredentials,
            hasNetlifyCreds: !!reqBody.netlifyCredentials,
            setupGitHub: !!reqBody.setupGitHub
          });
        } catch (e) {
          logger.warn('[api.requirements] Failed to parse JSON body:', e);
          reqBody = { content: rawBody };
        }
      } else {
        reqBody = { content: rawBody };
      }
    } catch (e) {
      logger.error('[api.requirements] Failed to read request body:', e);
      return json({ 
        success: false, 
        error: 'Failed to read request body' 
      }, { status: 400 });
    }
    
    // Create initial requirements context with safe deploymentOptions
    const deploymentOptions: Record<string, any> = reqBody.deploymentOptions || {};
    
    // Handle direct credential properties by moving them to deploymentOptions
    if (reqBody.githubCredentials) {
      deploymentOptions.githubCredentials = reqBody.githubCredentials;
    }
    
    if (reqBody.setupGitHub) {
      deploymentOptions.setupGitHub = Boolean(reqBody.setupGitHub);
    }
    
    if (reqBody.netlifyCredentials) {
      deploymentOptions.netlifyCredentials = reqBody.netlifyCredentials;
    }
    
    if (reqBody.cfCredentials) {
      deploymentOptions.cfCredentials = reqBody.cfCredentials;
    }
    
    const initialContext: RequirementsContext = {
      content: reqBody.content || reqBody.requirements || '',
      projectId: reqBody.projectId || reqBody.id || '',
      isNewProject: !reqBody.projectId && !reqBody.id,
      shouldDeploy: Boolean(reqBody.shouldDeploy || reqBody.deploy || reqBody.deployment || reqBody.deployTarget),
      deploymentTarget: reqBody.deploymentTarget || reqBody.deployTarget,
      deploymentOptions,
      files: {},
      additionalRequirement: Boolean(reqBody.additionalRequirement),
      userId: reqBody.userId,
      env: (context as any)?.env
    };
    
    logger.info('🔄 [api.requirements] Running requirements chain with context:', {
      hasContent: initialContext.content.length > 0,
      projectId: initialContext.projectId || 'new project',
      shouldDeploy: initialContext.shouldDeploy,
      deploymentTarget: initialContext.deploymentTarget || 'auto',
      hasOptions: Object.keys(deploymentOptions).length > 0
    });
    
    // Load project context
    let projectContext = await loadProjectContext(initialContext, request);
    
    // Process requirements
    let result = await processRequirements(projectContext, request);
    
    // Handle deployment if requested
    if (result.shouldDeploy) {
      logger.info('[api.requirements] Starting deployment process');
      result = await deployCode(result);
    } else {
      logger.info('[api.requirements] Skipping deployment (not requested)');
    }
    
    logger.info('✅ [api.requirements] Processing completed', {
      projectId: result.projectId,
      filesGenerated: result.files ? Object.keys(result.files).length : 0,
      deploymentStatus: result.deploymentResult?.status || 'not requested',
      deploymentUrl: result.deploymentResult?.url || 'N/A'
    });
    
    // Return the result
    return json({
      success: true,
      projectId: result.projectId,
      isNewProject: result.isNewProject,
      filesGenerated: result.files ? Object.keys(result.files).length : 0,
      deployment: result.deploymentResult,
      archive: result.archiveKey ? { key: result.archiveKey } : undefined,
      error: result.error ? result.error.message : undefined
    });
  } catch (error) {
    logger.error('❌ [api.requirements] Error processing requirements:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error processing requirements',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}
