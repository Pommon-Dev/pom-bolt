import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { D1StorageAdapter } from '~/lib/projects/adapters/d1-storage-adapter';
import type { D1Database } from '@cloudflare/workers-types';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('d1-test-api');

interface CloudflareContext {
  cloudflare: {
    env: {
      DB: D1Database;
      POM_BOLT_PROJECTS: KVNamespace;
    };
  };
}

/**
 * GET handler for D1 test API
 */
export async function loader({ request, context }: LoaderFunctionArgs & { context: CloudflareContext }) {
  try {
    logger.info('Testing D1 database connection');
    
    // Check for D1 database
    const db = context.cloudflare.env.DB;
    if (!db) {
      return json({
        success: false,
        error: 'D1 database not available'
      });
    }
    
    // List tables
    const tablesResult = await db
      .prepare('SELECT name FROM sqlite_master WHERE type="table"')
      .all();
    
    // Check requirements project
    const requirementsResult = await db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .bind('requirements')
      .first();
    
    // Check project list
    const projectListKey = 'pom_bolt_project_list';
    const projectListResult = await db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .bind(projectListKey)
      .first();
    
    // Try using D1StorageAdapter
    const d1Adapter = new D1StorageAdapter(db);
    const requirementsProject = await d1Adapter.getProject('requirements');
    
    // Create requirements project and project list if needed
    let fixApplied = false;
    if (!requirementsResult || !projectListResult) {
      const now = Date.now();
      
      // Create requirements project if needed
      if (!requirementsResult) {
        await db
          .prepare('INSERT INTO projects (id, name, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .bind(
            'requirements',
            'Requirements Collection',
            JSON.stringify({ type: 'requirements' }),
            now,
            now
          )
          .run();
      }
      
      // Create project list if needed
      if (!projectListResult) {
        await db
          .prepare('INSERT INTO projects (id, name, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .bind(
            projectListKey,
            'Project List',
            JSON.stringify([{ id: 'requirements', createdAt: now, updatedAt: now }]),
            now,
            now
          )
          .run();
      } else {
        // Update project list
        try {
          let metadata = projectListResult.metadata;
          if (typeof metadata === 'string') {
            metadata = JSON.parse(metadata);
          }
          
          const list = Array.isArray(metadata) ? metadata : [];
          
          if (!list.some((item: any) => item.id === 'requirements')) {
            list.push({
              id: 'requirements',
              createdAt: now,
              updatedAt: now
            });
            
            await db
              .prepare('UPDATE projects SET metadata = ?, updated_at = ? WHERE id = ?')
              .bind(
                JSON.stringify(list),
                now,
                projectListKey
              )
              .run();
          }
        } catch (error) {
          logger.error('Error updating project list', error);
        }
      }
      
      fixApplied = true;
    }
    
    return json({
      success: true,
      tablesResult: tablesResult.results,
      requirementsExists: !!requirementsResult,
      requirementsResult,
      projectListExists: !!projectListResult,
      projectListResult,
      adapterResult: requirementsProject,
      fixApplied
    });
  } catch (error) {
    logger.error('D1 test error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
} 