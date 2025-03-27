import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { v4 as uuid } from 'uuid';
import { environment } from '~/config/environment';
import { storage } from '~/lib/storage';
import { projectStore } from '~/lib/stores/project';

export interface RequirementData {
  id: string;
  text: string;
  timestamp: number;
  resolved?: boolean;
  processed?: boolean;
}

export interface RequirementsRequestBody {
  requirements: string[] | RequirementData[];
  markAsProcessed?: string[];
  noLLMGeneration?: boolean;
}

// Legacy interface for backwards compatibility
export interface RequirementsResponseData {
  hasRequirements: boolean;
  processed: boolean;
  timestamp: number | null;
  content: string | null;
  projectId: string | null;
}

/**
 * Handles POST requests to /api/requirements endpoint
 * Processes incoming requirements and triggers code generation if needed
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    // Get existing requirements
    const existingRequirements = await storage.getRequirements();
    
    // Parse the request body
    const body: RequirementsRequestBody = await request.json();
    
    // Process incoming requirements
    let updatedRequirements = [...existingRequirements];
    
    // Mark requirements as processed if requested
    if (body.markAsProcessed && body.markAsProcessed.length > 0) {
      updatedRequirements = updatedRequirements.map((requirement) => {
        if (body.markAsProcessed?.includes(requirement.id)) {
          return { ...requirement, processed: true };
        }
        return requirement;
      });
    }
    
    // Process new requirements
    if (body.requirements && body.requirements.length > 0) {
      const newRequirements = body.requirements.map((req) => {
        if (typeof req === 'string') {
          return {
            id: uuid(),
            text: req,
            timestamp: Date.now(),
          };
        }
        return req;
      });
      
      updatedRequirements = [...updatedRequirements, ...newRequirements];
    }
    
    // Save updated requirements
    await storage.setRequirements(updatedRequirements);
    
    // Trigger code generation if needed and environment supports it
    const shouldGenerateCode = !body.noLLMGeneration && 
      (environment.features.fileSystem || environment.isCloudflare);
    
    if (shouldGenerateCode) {
      console.log('Triggering code generation from requirements API');
      try {
        // Only attempt to generate if we have a project store
        if (projectStore) {
          // This will trigger project generation based on the requirements
          await projectStore.triggerGeneration({
            requirements: updatedRequirements
              .filter(r => !r.processed)
              .map(r => r.text),
            fromRequirementsAPI: true
          });
          
          console.log('Successfully initiated code generation');
        } else {
          console.warn('Project store not available - skipping code generation');
        }
      } catch (error) {
        console.error('Error triggering code generation:', error);
        // Continue anyway - don't fail the API request if generation fails
      }
    } else {
      console.log('Skipping code generation - disabled by request or environment');
    }
    
    return json({ success: true, requirements: updatedRequirements });
  } catch (error) {
    console.error('Error processing requirements:', error);
    return json({ error: 'Failed to process requirements', details: String(error) }, { status: 500 });
  }
};

/**
 * Handles GET requests to /api/requirements endpoint
 * Returns the current state of requirements
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const requirements = await storage.getRequirements();
    return json({ requirements });
  } catch (error) {
    console.error('Error fetching requirements:', error);
    return json({ error: 'Failed to fetch requirements', details: String(error) }, { status: 500 });
  }
};
