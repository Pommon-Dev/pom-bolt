import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { ProjectStateManager } from '~/lib/projects/state-manager';
import { ProjectStorageService } from '~/lib/projects/storage-service';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api-projects');

interface CloudflareContext {
  cloudflare: {
    env: {
      DB: D1Database;
      POM_BOLT_PROJECTS: KVNamespace;
    };
  };
}

export async function loader({ request, context }: LoaderFunctionArgs & { context: CloudflareContext }) {
  // At the top of the loader function
console.log('D1 available:', !!context.cloudflare.env.DB);
console.log('KV available:', !!context.cloudflare.env.POM_BOLT_PROJECTS);
console.log('D1 type:', typeof context.cloudflare.env.DB);

  try {
    const storageService = ProjectStorageService.getInstance(
      context.cloudflare.env.DB,
      context.cloudflare.env.POM_BOLT_PROJECTS
    );
    const stateManager = new ProjectStateManager(storageService);
    
    // Get all projects from backend storage
    const { projects } = await stateManager.listProjects();
    
    logger.info(`Returning ${projects.length} projects from backend`);
    
    return json(projects);
  } catch (error) {
    logger.error('Failed to list projects:', error);
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    }, { status: 500 });
  }
} 