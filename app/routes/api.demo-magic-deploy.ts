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
}

// netlify-demo-flow: Main action function refactored to use the FULL requirements chain
export async function action({ request, context }: ActionFunctionArgs) {
  const logPrefix = '[DEMO-MAGIC]';
  logger.info(`${logPrefix} Received request (Using runRequirementsChain Flow)`);
  
  try {
    // --- Directly call the requirements chain runner --- 
    // It handles parsing, context setup, codegen, persistence, and deployment
    // We need to ensure the request body contains flags for deployment target/options
    // which runRequirementsChain/parseRequest should pick up.
    
    // Note: We previously constructed reqContext manually. 
    // runRequirementsChain does this internally based on the request body.
    // Ensure the curl command sends `deploy: true`, `deploymentTarget: 'netlify'`, 
    // and `deploymentOptions: { netlifyCredentials: {...} }` if needed by the chain's parser.
    // (Or modify parseRequest in requirements-chain.ts if the demo body structure is different)
    
    logger.info(`${logPrefix} Calling runRequirementsChain...`);
    const resultContext = await runRequirementsChain(request); // Call the main chain runner
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