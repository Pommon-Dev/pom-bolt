import { json } from '@remix-run/node';
import type { ActionFunction, ActionFunctionArgs } from '@remix-run/node';
import { ProjectStateManager } from '~/lib/projects/state-manager';
import { ProjectStorageService } from '~/lib/projects/storage-service';
import { createScopedLogger } from '~/utils/logger';
import type { D1Database } from '@cloudflare/workers-types';
import { v4 as uuidv4 } from 'uuid';

const logger = createScopedLogger('api-create-project');

interface CloudflareContext {
  cloudflare: {
    env: {
      DB: D1Database;
      POM_BOLT_PROJECTS: KVNamespace;
    };
  };
}

/**
 * API endpoint for creating a new project
 * POST /api/create-project
 */
export const action = async ({ request, context }: ActionFunctionArgs & { context: CloudflareContext }) => {
  try {
    const formData = await request.formData();
    const name = formData.get('name') || 'Untitled Project';
    
    logger.info('Creating new project', { name });
    
    // Initialize storage service
    const storageService = ProjectStorageService.getInstance(
      context.cloudflare.env.DB,
      context.cloudflare.env.POM_BOLT_PROJECTS
    );
    
    // Initialize state manager
    const stateManager = new ProjectStateManager(storageService);
    
    // Create project
    const newProject = await stateManager.createProject({
      name: name.toString(),
      metadata: {
        createdFrom: 'api.create-project',
        createdAt: new Date().toISOString(),
        id: uuidv4() // Extra ID in metadata for verification
      }
    });
    
    logger.info('Project created successfully', { 
      id: newProject.id, 
      name: newProject.name 
    });
    
    return json({
      success: true,
      project: {
        id: newProject.id,
        name: newProject.name,
        createdAt: newProject.createdAt,
        updatedAt: newProject.updatedAt
      }
    });
  } catch (error) {
    logger.error('Failed to create project', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    
    return json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }, { status: 500 });
  }
}; 