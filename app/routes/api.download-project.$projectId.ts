import { json } from '@remix-run/cloudflare';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getProjectStateManager } from '~/lib/projects';
import { ZipPackager } from '~/lib/deployment/packagers/zip';
import { getKvNamespace } from '~/lib/kv/binding';

const logger = createScopedLogger('api:download-project');

/**
 * Endpoint to download project ZIP files
 * Route: /api/download-project/:projectId
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { projectId } = params;

  if (!projectId) {
    logger.warn('Missing projectId parameter');
    return json({ error: 'Missing projectId parameter' }, { status: 400 });
  }

  logger.info(`Project download requested for project: ${projectId}`);

  try {
    // First try to get the ZIP from KV if it exists
    const kv = getKvNamespace(context);
    
    logger.debug('KV namespace availability:', {
      hasKv: !!kv,
      contextType: typeof context,
      contextKeys: context ? Object.keys(context as any).join(', ') : 'none',
      hasCloudflare: !!(context as any).cloudflare,
      hasBindings: !!(context as any).cloudflare?.env
    });
    
    if (kv) {
      // Try different possible keys for this project's ZIP file
      const possibleKeys = [
        `project-${projectId}.zip`,
        `project-${projectId}-archive.zip`
      ];
      
      // Also check for timestamped versions (most recent first)
      const timestamp = Date.now();
      for (let i = 0; i < 10; i++) {
        const ts = timestamp - (i * 1000);
        possibleKeys.push(`project-${projectId}-${ts}.zip`);
      }
      
      logger.debug('Checking KV for project archive with possible keys', { 
        projectId, 
        keyCount: possibleKeys.length 
      });
      
      // Try each key until we find one
      for (const key of possibleKeys) {
        try {
          const file = await kv.get(key, 'arrayBuffer');
          if (file) {
            const fileBuffer = file as ArrayBuffer;
            if (fileBuffer && fileBuffer.byteLength) {
              logger.info(`Found project archive in KV: ${key}, size: ${fileBuffer.byteLength} bytes`);
              
              // Return the ZIP file
              return new Response(fileBuffer, {
                status: 200,
                headers: {
                  'Content-Type': 'application/zip',
                  'Content-Disposition': `attachment; filename="project-${projectId}.zip"`,
                  'Content-Length': fileBuffer.byteLength.toString(),
                  'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
                }
              });
            }
          }
        } catch (kvError) {
          logger.debug(`Error checking KV for key ${key}:`, kvError);
          // Continue to try other keys
        }
      }
      
      logger.debug('No archive found in KV, falling back to generating ZIP from project files');
    }
    
    // If we get here, either there's no KV access or the ZIP wasn't found
    // Get the project from the project state manager
    const projectManager = getProjectStateManager();
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      logger.warn(`Project not found for ID: ${projectId}`);
      return json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Get project files
    const files = await projectManager.getProjectFiles(projectId);
    
    if (!files || files.length === 0) {
      logger.warn(`No files found for project: ${projectId}`);
      return json({ error: 'No files found for project' }, { status: 404 });
    }
    
    // Convert ProjectFile[] to Record<string, string> expected by ZipPackager
    const filesMap: Record<string, string> = {};
    for (const file of files) {
      if (!file.isDeleted) {
        filesMap[file.path] = file.content;
      }
    }

    if (Object.keys(filesMap).length === 0) {
      logger.warn(`No active files found for project: ${projectId}`);
      return json({ error: 'No active files found for project' }, { status: 404 });
    }
    
    // Create a ZIP file from the project files
    const zipPackager = new ZipPackager();
    const zipBuffer = await zipPackager.package(filesMap);
    
    logger.info(`Generated ZIP file for project ${projectId}, size: ${zipBuffer.byteLength} bytes`);
    
    // If KV is available, store the generated ZIP for future use
    if (kv) {
      try {
        const zipKey = `project-${projectId}-${Date.now()}.zip`;
        await kv.put(zipKey, zipBuffer);
        logger.info(`Stored generated ZIP in KV with key: ${zipKey}`);
      } catch (kvError) {
        logger.warn('Failed to store ZIP in KV:', kvError);
        // Continue anyway - we'll just return the generated ZIP
      }
    }
    
    // Set appropriate headers for a downloadable ZIP file
    return new Response(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="project-${projectId}.zip"`,
        'Content-Length': zipBuffer.byteLength.toString(),
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    logger.error(`Error generating ZIP for project ${projectId}:`, error);
    return json({ 
      error: 'Failed to generate ZIP file',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 