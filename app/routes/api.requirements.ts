import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { runRequirementsChain, loadProjectContext, processRequirements, type RequirementsContext } from '~/lib/middleware/requirements-chain';

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
    logger.info('Processing requirements request');
    
    // Debug: Log request information and context
    logger.debug('Request headers:', {
      contentType: request.headers.get('Content-Type'),
      contentLength: request.headers.get('Content-Length'),
      accept: request.headers.get('Accept')
    });
    
    logger.debug('Context information:', {
      hasContext: !!context,
      contextType: typeof context,
      contextKeys: context ? Object.keys(context as any).join(',') : 'none',
      hasEnv: !!(context as any)?.env,
      envType: (context as any)?.env ? typeof (context as any).env : 'undefined'
    });
    
    // Manually parse the request body
    let reqBody;
    try {
      const clonedRequest = request.clone();
      const rawBody = await clonedRequest.text();
      logger.debug('Raw request body:', { 
        length: rawBody.length,
        preview: rawBody.substring(0, 100),
        isJson: rawBody.trim().startsWith('{')
      });
      
      // Try parsing JSON directly
      if (rawBody.trim().startsWith('{')) {
        try {
          reqBody = JSON.parse(rawBody);
          logger.debug('Parsed JSON body directly:', {
            hasContent: Boolean(reqBody.content || reqBody.requirements),
            contentType: reqBody.content ? 'content' : reqBody.requirements ? 'requirements' : 'none',
            keys: Object.keys(reqBody),
            additionalRequirement: Boolean(reqBody.additionalRequirement)
          });
        } catch (jsonError) {
          logger.error('Failed to parse JSON directly:', jsonError);
          // Use the raw body as content if JSON parse fails
          reqBody = { content: rawBody };
        }
      } else {
        // Use the raw body as content
        reqBody = { content: rawBody };
      }
    } catch (bodyError) {
      logger.error('Failed to read raw request body:', bodyError);
      return json({ 
        success: false, 
        error: 'Failed to read request body' 
      }, { status: 400 });
    }
    
    // Create initial requirements context with parsed body
    const reqContext: RequirementsContext = {
      content: reqBody.content || reqBody.requirements || '',
      projectId: reqBody.projectId || reqBody.id || '',
      isNewProject: !reqBody.projectId && !reqBody.id,
      additionalRequirement: Boolean(reqBody.additionalRequirement),
      userId: reqBody.userId,
      shouldDeploy: Boolean(reqBody.deploy || reqBody.deployment || reqBody.deployTarget),
      deploymentTarget: reqBody.deployTarget || reqBody.deploymentTarget,
      deploymentOptions: reqBody.deploymentOptions || {}, // Include deploymentOptions from the request
      files: {},
      env: (context as any) || {} // Pass the entire context to ensure KV bindings work
    };
    
    // If netlifyCredentials was provided at the top level, move it to deploymentOptions
    if (reqBody.netlifyCredentials) {
      reqContext.deploymentOptions = reqContext.deploymentOptions || {};
      reqContext.deploymentOptions.netlifyCredentials = reqBody.netlifyCredentials;
    }
    
    // If cfCredentials was provided at the top level, move it to deploymentOptions
    if (reqBody.cfCredentials) {
      reqContext.deploymentOptions = reqContext.deploymentOptions || {};
      reqContext.deploymentOptions.cfCredentials = reqBody.cfCredentials;
    }
    
    // If Cloudflare context has env, add it to the requirements context
    if ((context as any)?.env) {
      reqContext.env = (context as any).env;
    }
    
    logger.debug('Initial request context:', {
      hasContent: Boolean(reqContext.content),
      contentLength: reqContext.content ? reqContext.content.length : 0,
      projectId: reqContext.projectId || '(none)',
      isNewProject: reqContext.isNewProject,
      additionalRequirement: reqContext.additionalRequirement,
      hasEnv: !!reqContext.env,
      shouldDeploy: reqContext.shouldDeploy,
      deploymentTarget: reqContext.deploymentTarget
    });
    
    // Load project context to handle project identification
    // Pass the manually parsed body to avoid parsing issues
    const projectContext = await loadProjectContext(reqContext, request);
    
    // Ensure we pass the context to the project context
    projectContext.env = reqContext.env;
    
    logger.debug('Project context after loading:', {
      projectId: projectContext.projectId,
      isNewProject: projectContext.isNewProject,
      hasEnv: !!projectContext.env
    });
    
    // Process the requirements and generate code
    const result = await processRequirements(projectContext, request);
    
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
    logger.error('Error processing requirements:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error processing requirements',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}
