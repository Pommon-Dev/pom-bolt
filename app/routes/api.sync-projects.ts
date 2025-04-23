import { json } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { ProjectStateManager } from '~/lib/projects/state-manager';
import { ProjectStorageService } from '~/lib/projects/storage-service';
import { createScopedLogger } from '~/utils/logger';
import type { ProjectState } from '~/lib/projects/types';

const logger = createScopedLogger('api-sync-projects');

interface CloudflareContext {
  cloudflare: {
    env: {
      DB: D1Database;
      POM_BOLT_PROJECTS: KVNamespace;
    };
  };
}

interface SyncResult {
  id: string;
  action: string;
  error?: string;
}

interface SyncResults {
  success: boolean;
  synced: number;
  updated: number;
  created: number;
  errors: number;
  details: SyncResult[];
}

export async function action({ request, context }: ActionFunctionArgs & { context: CloudflareContext }) {
  try {
    if (request.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, { status: 405 });
    }

    const body = await request.json() as { projects: ProjectState[] };
    const { projects } = body;

    if (!Array.isArray(projects) || projects.length === 0) {
      return json({ success: false, error: 'No projects provided' }, { status: 400 });
    }

    logger.info(`Syncing ${projects.length} projects from client`);

    const storageService = ProjectStorageService.getInstance(
      context.cloudflare.env.DB,
      context.cloudflare.env.POM_BOLT_PROJECTS
    );
    const stateManager = new ProjectStateManager(storageService);

    const results: SyncResults = {
      success: true,
      synced: 0,
      updated: 0,
      created: 0,
      errors: 0,
      details: []
    };

    for (const project of projects) {
      try {
        const exists = await stateManager.projectExists(project.id);
        
        if (exists) {
          // Update existing project
          await stateManager.saveProject(project);
          results.updated++;
          results.details.push({ id: project.id, action: 'updated' });
        } else {
          // Create new project
          await stateManager.saveProject(project);
          results.created++;
          results.details.push({ id: project.id, action: 'created' });
        }
        
        results.synced++;
      } catch (error) {
        logger.error(`Failed to sync project ${project.id}:`, error);
        results.errors++;
        results.details.push({ 
          id: project.id, 
          action: 'failed', 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }

    return json({ 
      success: results.errors === 0,
      results
    });
  } catch (error) {
    logger.error('Failed to sync projects:', error);
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    }, { status: 500 });
  }
} 