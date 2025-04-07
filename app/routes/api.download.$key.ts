import { json } from '@remix-run/cloudflare';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getEnvironment } from '~/lib/environments';
import { getKvNamespace } from '~/lib/kv/binding';
import { StorageType } from '~/lib/environments/base';
import { getProjectStateManager } from '~/lib/projects';
import { ZipPackager } from '~/lib/deployment/packagers/zip';

const logger = createScopedLogger('api-download');

/**
 * API endpoint to download files from KV storage
 * Route: /api/download/:key
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { key } = params;

  if (!key) {
    logger.warn('Missing key parameter');
    return json({ error: 'Missing key parameter' }, { status: 400 });
  }

  logger.info(`Download requested for key: ${key}`);
  
  // Check if we have KV access
  const kv = getKvNamespace(context);
  
  // Debug log to check the existence and type of KV namespace
  console.log(`KV namespace check for download: ${kv ? 'found' : 'not found'}`, {
    contextType: typeof context,
    kvType: typeof kv,
    kvHasGet: kv ? typeof kv.get === 'function' : false,
    contextKeys: context ? Object.keys(context as any).join(',') : 'none'
  });
  
  if (!kv) {
    logger.error('KV namespace not available for download');
    return json({ error: 'Storage service unavailable' }, { status: 503 });
  }

  try {
    // Attempt to get the file as binary data
    console.log(`Retrieving binary data from KV for key: ${key}`);
    const file = await kv.get(key, 'arrayBuffer');
    
    // Check if the file was found
    if (!file) {
      logger.warn(`File not found in KV: ${key}`);
      return json({ error: 'File not found' }, { status: 404 });
    }
    
    // Check if we got a valid file (arrayBuffer should have a byteLength)
    const fileBuffer = file as ArrayBuffer;
    if (!fileBuffer || !fileBuffer.byteLength) {
      logger.warn(`Invalid file data for key: ${key}, received: ${typeof file}`);
      return json({ error: 'Invalid file data' }, { status: 500 });
    }
    
    logger.info(`File found, size: ${fileBuffer.byteLength} bytes`);
    
    // Set appropriate headers for file download
    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${key}"`,
        'Content-Length': fileBuffer.byteLength.toString(),
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      }
    });
  } catch (error) {
    logger.error(`Error retrieving file ${key}:`, error);
    return json({ 
      error: 'Error retrieving file',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
} 