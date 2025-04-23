import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { D1StorageAdapter } from '~/lib/projects/adapters/d1-storage-adapter';
import type { D1Database } from '@cloudflare/workers-types';
import { v4 as uuidv4 } from 'uuid';

interface CloudflareContext {
  cloudflare: {
    env: {
      DB: D1Database;
    };
  };
}

/**
 * GET handler for requirements - direct D1 implementation
 */
export async function loader({ request, context }: LoaderFunctionArgs & { context: CloudflareContext }) {
  try {
    console.log('Requirements-direct GET handler called');
    
    const db = context?.cloudflare?.env?.DB;
    if (!db) {
      return json({
        success: false,
        error: 'D1 database not available'
      });
    }
    
    // Use D1 adapter directly
    const d1Adapter = new D1StorageAdapter(db);
    const requirementsProject = await d1Adapter.getProject('requirements');
    
    if (!requirementsProject) {
      return json({
        success: true,
        data: {
          requirements: [],
          webhooks: []
        }
      });
    }
    
    // Process requirements entries
    const requirements = requirementsProject.requirements || [];
    
    // Add status to requirements if not present
    const enhancedRequirements = requirements.map((req: any) => ({
      ...req,
      status: req.status || 'pending'
    }));
    
    return json({
      success: true,
      data: {
        requirements: enhancedRequirements,
        webhooks: requirementsProject.webhooks || []
      }
    });
  } catch (error) {
    console.error('Requirements-direct GET error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * POST handler for requirements - direct D1 implementation
 */
export async function action({ request, context }: ActionFunctionArgs & { context: CloudflareContext }) {
  try {
    console.log('Requirements-direct POST handler called');
    
    const db = context?.cloudflare?.env?.DB;
    if (!db) {
      return json({
        success: false,
        error: 'D1 database not available'
      });
    }
    
    const formData = await request.formData();
    const projectId = formData.get('projectId') as string;
    const requirements = formData.get('requirements');
    
    if (!projectId || projectId !== 'requirements') {
      return json({
        success: false,
        error: 'Invalid project ID. Must be "requirements".'
      });
    }
    
    if (!requirements) {
      return json({
        success: false,
        error: 'Missing requirements'
      });
    }
    
    // Use D1 adapter directly
    const d1Adapter = new D1StorageAdapter(db);
    const requirementsProject = await d1Adapter.getProject('requirements');
    
    // Parse requirements
    let newRequirements;
    try {
      const reqData = JSON.parse(requirements as string);
      newRequirements = Array.isArray(reqData) ? reqData : [{
        id: `req-${Date.now()}`,
        content: requirements as string,
        timestamp: Date.now(),
        status: 'pending'
      }];
    } catch (e) {
      // If not valid JSON, treat as a single requirement text
      newRequirements = [{
        id: `req-${Date.now()}`,
        content: requirements as string,
        timestamp: Date.now(),
        status: 'pending'
      }];
    }
    
    // Add requirement to project
    const currentRequirements = requirementsProject?.requirements || [];
    const updatedRequirements = [...currentRequirements, ...newRequirements];
    
    // Create or update project
    const now = Date.now();
    if (!requirementsProject) {
      // Create new requirements project
      const project = {
        id: 'requirements',
        name: 'Requirements Collection',
        createdAt: now,
        updatedAt: now,
        files: [],
        requirements: updatedRequirements,
        deployments: [],
        webhooks: [],
        metadata: { type: 'requirements' }
      };
      
      await d1Adapter.saveProject(project);
    } else {
      // Update existing project
      const updatedProject = {
        ...requirementsProject,
        updatedAt: now,
        requirements: updatedRequirements
      };
      
      await d1Adapter.saveProject(updatedProject);
    }
    
    // Get the updated project
    const finalProject = await d1Adapter.getProject('requirements');
    
    // Process requirements entries
    const finalRequirements = finalProject?.requirements || [];
    
    // Add status to requirements if not present
    const enhancedRequirements = finalRequirements.map((req: any) => ({
      ...req,
      status: req.status || 'pending'
    }));
    
    return json({
      success: true,
      data: {
        requirements: enhancedRequirements,
        webhooks: finalProject?.webhooks || []
      }
    });
  } catch (error) {
    console.error('Requirements-direct POST error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 