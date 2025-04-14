// netlify-demo-flow: This entire file is for the demo workaround.
import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { v4 as uuidv4 } from 'uuid'; // Keep for potential fallback ID generation?
import { createScopedLogger } from '~/utils/logger';
// netlify-demo-flow: Corrected paths based on project structure
import { CodegenService } from '~/lib/codegen/service'; // Corrected path based on user hint
import { NetlifyTarget } from '~/lib/deployment/targets/netlify'; 
import { getProjectStateManager, ProjectStateManager } from '~/lib/projects/state-manager'; 
import type { ProjectState, ProjectFile, RequirementsEntry, ProjectDeployment, CreateProjectOptions } from '~/lib/projects/types'; 
import { storeProjectArchive } from '~/lib/middleware/requirements-chain'; 
import type { RequirementsContext } from '~/lib/middleware/requirements-chain';

// --- REFACTORED IMPORTS --- 
// Import the main chain runner instead of just the processor
import { runRequirementsChain } from '~/lib/middleware/requirements-chain'; 
// --- END REFACTORED IMPORTS --- 

// netlify-demo-flow: Logger for the demo endpoint
const logger = createScopedLogger('api-demo-magic-deploy');

// netlify-demo-flow: Interface for expected request body
// NOTE: runRequirementsChain parses the body internally, 
// but we keep this for clarity about what the endpoint expects.
interface DemoMagicDeployBody {
  requirements: string;
  projectName?: string;
  netlifyCredentials?: { apiToken?: string };
  githubCredentials?: { token?: string; owner?: string }; // Added GitHub credentials
  deploymentTarget?: 'netlify' | 'netlify-github'; // Added support for netlify-github
}

// netlify-demo-flow: Main action function refactored to use the FULL requirements chain
export async function action({ request, context }: ActionFunctionArgs) {
  const logPrefix = '[DEMO-MAGIC]';
  logger.info(`${logPrefix} Received request (Using runRequirementsChain Flow)`);
  
  try {
    // Parse the request to extract credentials and other options
    const requestData = await request.clone().json() as DemoMagicDeployBody;
    
    // Create a modified request with the appropriate structure for requirements chain
    const chainRequestBody = {
      content: requestData.requirements,
      projectName: requestData.projectName,
      deploy: true, // Always deploy
      deploymentTarget: requestData.deploymentTarget || 'netlify', // Default to netlify
      deploymentOptions: {
        netlifyCredentials: requestData.netlifyCredentials,
        githubCredentials: requestData.githubCredentials,
        // Flag to setup GitHub if netlify-github is selected
        setupGitHub: requestData.deploymentTarget === 'netlify-github'
      }
    };
    
    // Create a new request with the modified body
    const chainRequest = new Request(request.url, {
      method: 'POST',
      headers: new Headers({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(chainRequestBody)
    });
    
    logger.info(`${logPrefix} Calling runRequirementsChain with target: ${chainRequestBody.deploymentTarget}`);
    const resultContext = await runRequirementsChain(chainRequest); // Call the main chain runner
    logger.info(`${logPrefix} runRequirementsChain finished`, { 
        projectId: resultContext.projectId, 
        filesGenerated: !!resultContext.files, 
        deploymentStatus: resultContext.deploymentResult?.status || 'N/A',
        archiveKey: resultContext.archiveKey || 'N/A',
        error: resultContext.error?.message
    });

    // --- Return Formatted Response (same logic as before) --- 
    if (resultContext.error) {
      // If the chain itself caught an error
      logger.error(`${logPrefix} Requirements chain failed:`, resultContext.error);
      return json({
        success: false,
        error: resultContext.error.message,
        projectId: resultContext.projectId,
      }, { status: 500 });
    } else if (!resultContext.deploymentResult || resultContext.deploymentResult?.status === 'failed') {
       // If deployment is missing or specifically failed
       const errorMsg = resultContext.deploymentResult ? "Deployment failed" : "Deployment result missing";
       logger.error(`${logPrefix} ${errorMsg} within requirements chain`);
       return json({
         success: false, // Mark overall success as false if deployment fails or is missing
         error: errorMsg,
         projectId: resultContext.projectId,
         deployment: resultContext.deploymentResult // Include result even if failed
       }, { status: 500 }); // Or 207 if partial success?
    }
    
    // Success case (implies deployment result exists and is not 'failed')
    logger.info(`${logPrefix} Demo flow completed successfully via requirements chain.`);
    return json({
      success: true,
      message: "Demo deployment successful and project persisted via requirements chain.",
      projectId: resultContext.projectId,
      archiveKey: resultContext.archiveKey,
      deployment: resultContext.deploymentResult
    });

  } catch (error) {
    // Catch errors potentially thrown by runRequirementsChain itself
    logger.error(`${logPrefix} Unhandled error calling runRequirementsChain`, error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown server error in demo endpoint'
    }, { status: 500 });
  }
} 