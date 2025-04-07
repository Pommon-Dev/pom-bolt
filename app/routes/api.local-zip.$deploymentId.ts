import { json } from '@remix-run/cloudflare';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getProjectStateManager } from '~/lib/projects';
import { ZipPackager } from '~/lib/deployment/packagers/zip';

const logger = createScopedLogger('api:local-zip');

/**
 * Endpoint to download locally generated ZIP files when KV storage is unavailable
 * Route: /api/local-zip/:deploymentId
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { deploymentId } = params;

  if (!deploymentId) {
    logger.warn('Missing deploymentId parameter');
    return json({ error: 'Missing deploymentId parameter' }, { status: 400 });
  }

  logger.debug(`Local ZIP download requested for deployment: ${deploymentId}`);

  try {
    // Extract the project ID from the deployment ID
    // Format is typically: local-project-from-requirements-create-a-simple-react-app-with-a-navi-1743737747740-1743737747754
    const idParts = deploymentId.split('-');
    logger.debug('Deployment ID parts:', { parts: idParts, count: idParts.length });

    // Try several extraction methods
    let projectId = '';

    // Method 1: Direct extraction of the newest project ID from our API response
    if (request.headers.get('Referer')) {
      const referer = request.headers.get('Referer') || '';
      const match = referer.match(/projectId":\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
      if (match) {
        projectId = match[1];
        logger.debug(`Extracted project ID from referer: ${projectId}`);
      }
    }

    // Method 2: Extract from the URL query parameters if available
    if (!projectId) {
      const url = new URL(request.url);
      const urlProjectId = url.searchParams.get('projectId');
      if (urlProjectId) {
        projectId = urlProjectId;
        logger.debug(`Using project ID from query parameter: ${projectId}`);
      }
    }

    // Method 3: Check for UUID in the deployment ID
    if (!projectId) {
      // The UUID might be anywhere in the string
      const uuidMatches = deploymentId.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi);
      if (uuidMatches && uuidMatches.length > 0) {
        projectId = uuidMatches[0];
        logger.debug(`Extracted UUID from deployment ID: ${projectId}`);
      }
    }

    // Method 4: Use the second-to-last part from our timestamp-based IDs
    if (!projectId && idParts.length >= 2) {
      // The IDs typically end with two timestamps, and sometimes the project ID is in between
      // Try to find the parts that look like Unix timestamps (13-digit numbers)
      const timestampRegex = /^\d{13}$/;
      const possibleTimestampIndices = idParts
        .map((part, index) => timestampRegex.test(part) ? index : -1)
        .filter(index => index !== -1);
        
      if (possibleTimestampIndices.length >= 2) {
        // If we have at least two timestamp parts, try to extract project ID
        const projectIdIdx = possibleTimestampIndices[0] - 1;
        if (projectIdIdx >= 0) {
          // Get the project manager and list all projects
          const projectManager = getProjectStateManager();
          const projectsList = await projectManager.listProjects();
          
          // Try to find a project with a matching name
          for (const project of projectsList.projects) {
            logger.debug(`Checking project: ${project.id}, name: ${project.name}`);
            if (deploymentId.includes(project.name)) {
              projectId = project.id;
              logger.debug(`Found matching project by name: ${projectId}`);
              break;
            }
          }
        }
      }
    }

    // Method 5: Just use the most recently created project as fallback
    if (!projectId) {
      const projectManager = getProjectStateManager();
      const projectsList = await projectManager.listProjects();
      
      if (projectsList.projects.length > 0) {
        // Sort by creation date, descending
        const sortedProjects = [...projectsList.projects].sort((a, b) => {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bTime - aTime;
        });
        
        projectId = sortedProjects[0].id;
        logger.debug(`Using most recent project as fallback: ${projectId}`);
      }
    }
    
    logger.debug(`Extracted project ID: ${projectId || '(none)'} from deployment ID: ${deploymentId}`);
    
    if (!projectId) {
      logger.warn(`Could not extract project ID from deployment ID: ${deploymentId}`);
      return json({ 
        error: 'Invalid deployment ID format',
        detail: 'Could not extract project ID from the deployment ID'
      }, { status: 400 });
    }
    
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
    logger.error(`Error generating local ZIP for deployment ${deploymentId}:`, error);
    return json({ 
      error: 'Failed to generate ZIP file',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 