import { json } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { runRequirementsChain } from '~/lib/middleware/requirements-chain';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api-debug-requirements');

/**
 * API endpoint for debugging the requirements chain
 * This endpoint bypasses the normal requirements API and directly calls
 * the requirements chain for detailed debugging
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    logger.info('Debug requirements chain started');
    
    // Get request body
    const contentType = request.headers.get('Content-Type') || '';
    let body: any;
    
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    }
    
    // Get parameters
    const content = body.content || body.requirements;
    const projectId = body.projectId;
    const shouldDeploy = body.shouldDeploy === true || body.shouldDeploy === 'true';
    const deploymentTarget = body.deploymentTarget || body.targetName || 'auto';
    const setupGitHub = body.setupGitHub === true || body.setupGitHub === 'true';
    const netlifyCredentials = body.netlifyCredentials;
    const githubCredentials = body.githubCredentials;
    
    if (!content) {
      return json({
        success: false,
        error: 'Missing content/requirements'
      }, { status: 400 });
    }
    
    // Log what we're about to do
    logger.info('Running requirements chain with parameters:', {
      contentLength: content.length,
      projectId: projectId || '(new project)',
      shouldDeploy,
      deploymentTarget,
      setupGitHub,
      hasNetlifyCreds: !!netlifyCredentials,
      hasGithubCreds: !!githubCredentials
    });
    
    // Create a new request with the details we need
    const modifiedRequest = new Request(request.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('Cookie') || ''
      },
      body: JSON.stringify({
        content,
        projectId,
        shouldDeploy,
        deploymentTarget,
        deploymentOptions: {
          setupGitHub,
          netlifyCredentials,
          githubCredentials
        }
      })
    });
    
    // Run the requirements chain
    const result = await runRequirementsChain(modifiedRequest);
    
    // Handle errors
    if (result.error) {
      logger.error('Error in requirements chain:', result.error);
      return json({
        success: false,
        error: result.error.message,
        errorStack: result.error.stack,
        context: {
          projectId: result.projectId,
          isNewProject: result.isNewProject,
          filesGenerated: Object.keys(result.files || {}).length
        }
      }, { status: 500 });
    }
    
    // Return the complete result
    return json({
      success: true,
      result: {
        projectId: result.projectId,
        isNewProject: result.isNewProject,
        filesGenerated: Object.keys(result.files || {}).length,
        filesList: Object.keys(result.files || {}),
        deployment: result.deploymentResult,
        shouldDeploy: result.shouldDeploy,
        deploymentTarget: result.deploymentTarget
      }
    });
  } catch (error) {
    logger.error('Unexpected error in debug-requirements:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
} 