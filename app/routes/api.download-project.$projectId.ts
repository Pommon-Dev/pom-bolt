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

  // Validate projectId
  if (!projectId) {
    logger.warn('Missing projectId parameter');
    return json({ error: 'Missing projectId parameter' }, { status: 400 });
  }

  logger.info(`Project download requested for project: ${projectId}`);
  
  // Enhanced debug context structure logs
  logger.debug('Context structure for project download:', {
    contextType: typeof context,
    hasContext: !!context,
    contextKeys: context ? Object.keys(context as any).join(',') : 'none',
    hasCloudflare: !!(context as any)?.cloudflare,
    hasCfEnv: !!(context as any)?.cloudflare?.env,
    hasRequest: !!request,
    requestUrl: request.url,
    kvBindings: (context as any)?.cloudflare?.env ? 
      Object.keys((context as any).cloudflare.env).filter(k => k.includes('POM_BOLT')) : []
  });

  try {
    // First try to get the ZIP from KV if it exists
    const kv = getKvNamespace(context);
    
    logger.debug('KV namespace availability:', {
      hasKv: !!kv,
      kvType: kv ? typeof kv : 'none',
      kvKeys: kv ? Object.keys(kv as any).join(', ') : 'none',
      kvMethods: kv ? Object.getOwnPropertyNames(Object.getPrototypeOf(kv)).join(', ') : 'none',
      contextType: typeof context,
      cfBindings: (context as any)?.cloudflare?.env ? 
        Object.keys((context as any).cloudflare.env).join(', ') : 'none'
    });
    
    if (kv) {
      // Try different possible keys for this project's ZIP file
      const possibleKeys = [
        `project-${projectId}.zip`,
        `project-${projectId}-archive.zip`,
        `project:${projectId}`,
        `project-${projectId}`
      ];
      
      // Also check for timestamped versions (most recent first)
      const timestamp = Date.now();
      for (let i = 0; i < 20; i++) { // Check more variations
        const ts = timestamp - (i * 10000); 
        possibleKeys.push(`project-${projectId}-${ts}.zip`);
      }
      
      logger.debug('Checking KV for project archive with possible keys', { 
        projectId, 
        keyCount: possibleKeys.length,
        keys: possibleKeys.slice(0, 5).join(', ') + '...' // Log first few keys
      });
      
      // Try each possible key
      for (const key of possibleKeys) {
        try {
          logger.debug(`Attempting to retrieve key: ${key}`);
          const data = await kv.get(key, 'arrayBuffer');
          if (data) {
            logger.info(`Project archive found with key: ${key}`);
            
            // Return the ZIP file
            return new Response(data, {
              headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="project-${projectId}.zip"`,
                'Cache-Control': 'public, max-age=3600'
              }
            });
          } else {
            logger.debug(`No data found for key: ${key}`);
          }
        } catch (error) {
          logger.warn(`Error accessing KV for key ${key}:`, error);
        }
      }
      
      logger.warn('No project archive found in KV storage');
    } else {
      logger.warn('No KV namespace available in this context');
    }
    
    // If no archive in KV, try to get the project from project state and create a ZIP
    logger.debug('Attempting to get project from state manager');

    // Check if this is Cloudflare Pages
    const isCloudflarePages = !!(context as any)?.cloudflare?.env;
    logger.debug('Runtime environment:', {
      isCloudflarePages,
      platform: isCloudflarePages ? 'Cloudflare Pages' : 'Other'
    });
    
    // Pass context to ensure we have access to KV in Cloudflare environment
    const projectStateManager = getProjectStateManager(context);
    
    // Log what we're about to do
    logger.debug('Retrieving project from state manager', {
      projectId,
      managerType: typeof projectStateManager,
      hasStorageAdapter: !!(projectStateManager as any)?.storageAdapter,
      hasStorageService: !!(projectStateManager as any)?.storageService
    });
    
    const project = await projectStateManager.getProject(projectId);
    
    if (!project) {
      logger.warn(`Project not found for ID: ${projectId}`);
      return json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Get project files
    const files = await projectStateManager.getProjectFiles(projectId);
    
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