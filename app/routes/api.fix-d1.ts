import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import type { D1Database } from '@cloudflare/workers-types';

interface CloudflareContext {
  cloudflare: {
    env: {
      DB: D1Database;
    };
  };
}

/**
 * Simple endpoint to fix the D1 database by inserting necessary records
 */
export async function loader({ request, context }: LoaderFunctionArgs & { context: CloudflareContext }) {
  try {
    console.log('Fix D1 endpoint called');
    
    // Check for D1 database
    const db = context?.cloudflare?.env?.DB;
    if (!db) {
      return json({
        success: false,
        error: 'D1 database not available'
      });
    }
    
    const now = Date.now();
    const logs = [];
    
    // Step 1: Create requirements project
    try {
      const result = await db
        .prepare('INSERT INTO projects (id, name, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = ?, metadata = ?, updated_at = ?')
        .bind(
          'requirements',
          'Requirements Collection',
          JSON.stringify({ type: 'requirements' }),
          now,
          now,
          'Requirements Collection',
          JSON.stringify({ type: 'requirements' }),
          now
        )
        .run();
        
      logs.push(`Requirements project upserted: ${JSON.stringify(result)}`);
    } catch (error) {
      logs.push(`Error creating requirements project: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Step 2: Create project list
    try {
      const projectListKey = 'pom_bolt_project_list';
      const result = await db
        .prepare('INSERT INTO projects (id, name, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = ?, metadata = ?, updated_at = ?')
        .bind(
          projectListKey,
          'Project List',
          JSON.stringify([{ id: 'requirements', createdAt: now, updatedAt: now }]),
          now,
          now,
          'Project List',
          JSON.stringify([{ id: 'requirements', createdAt: now, updatedAt: now }]),
          now
        )
        .run();
        
      logs.push(`Project list upserted: ${JSON.stringify(result)}`);
    } catch (error) {
      logs.push(`Error creating project list: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Step 3: Verify requirements project exists
    let requirementsResult;
    try {
      requirementsResult = await db
        .prepare('SELECT id, name, metadata FROM projects WHERE id = ?')
        .bind('requirements')
        .first();
      
      logs.push(`Requirements project verification: ${requirementsResult ? 'SUCCESS' : 'FAILED'}`);
    } catch (error) {
      logs.push(`Error verifying requirements project: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Step 4: Verify project list exists
    let projectListResult;
    try {
      const projectListKey = 'pom_bolt_project_list';
      projectListResult = await db
        .prepare('SELECT id, name, metadata FROM projects WHERE id = ?')
        .bind(projectListKey)
        .first();
      
      logs.push(`Project list verification: ${projectListResult ? 'SUCCESS' : 'FAILED'}`);
    } catch (error) {
      logs.push(`Error verifying project list: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return json({
      success: true,
      logs,
      requirementsResult,
      projectListResult
    });
  } catch (error) {
    console.error('Fix D1 error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
} 