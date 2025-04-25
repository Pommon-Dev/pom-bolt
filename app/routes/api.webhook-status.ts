import { json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getProjectStateManager } from '~/lib/projects';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import type { WebhookConfig } from '~/lib/requirements/types';

const logger = createScopedLogger('api-webhook-status');

/**
 * Extracts tenant ID from request headers
 */
function extractTenantId(request: Request): string | undefined {
  // Check for tenant ID in custom header
  const tenantId = request.headers.get('x-tenant-id');
  
  // Check for tenant ID in Authorization header (assuming JWT)
  const authHeader = request.headers.get('Authorization');
  if (!tenantId && authHeader && authHeader.startsWith('Bearer ')) {
    try {
      // This is a simplified example. In a real app, you would validate and decode the JWT
      const token = authHeader.substring(7);
      // Return token as tenant ID for simple MVP implementation
      return token;
    } catch (error) {
      logger.error('Failed to extract tenant ID from JWT:', error);
    }
  }
  
  return tenantId || undefined;
}

/**
 * GET endpoint for retrieving webhook status for a project
 * /api/webhook-status?projectId=<projectId>&url=<webhookUrl>
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // Extract query parameters
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');
    const webhookUrl = url.searchParams.get('url');
    
    // Extract tenant ID for authorization
    const tenantId = extractTenantId(request);
    
    if (!projectId) {
      return json({ error: 'Project ID is required' }, { status: 400 });
    }
    
    logger.info('Retrieving webhook status', { 
      projectId,
      webhookUrl: webhookUrl || 'all',
      tenantId: tenantId || 'none'
    });
    
    // Get the project state manager
    const projectManager = getProjectStateManager();
    
    // Get the project with tenant validation
    const project = await projectManager.getProject(projectId, tenantId);
    
    // Return 403 if project not found or tenant access denied
    if (!project) {
      logger.warn('Project not found or access denied', {
        projectId,
        tenantId: tenantId || 'none'
      });
      return json({ error: 'Project not found or access denied' }, { status: 403 });
    }
    
    // Extract webhooks from the project
    const webhooks = project.webhooks || [];
    
    // Filter by URL if provided
    const filteredWebhooks = webhookUrl
      ? webhooks.filter(webhook => webhook.url === webhookUrl)
      : webhooks;
    
    // Map to a simpler response format
    const webhookStatuses = filteredWebhooks.map(webhook => ({
      url: webhook.url,
      method: webhook.method,
      status: webhook.status || 'unknown',
      lastAttempt: webhook.lastAttempt,
      retries: webhook.retries || 0,
      lastResponse: webhook.lastResponse,
      tenantId: webhook.tenantId
    }));
    
    logger.info('Webhook status retrieved', {
      projectId,
      count: webhookStatuses.length,
      tenantId: tenantId || 'none'
    });
    
    return json({
      success: true,
      projectId,
      webhooks: webhookStatuses
    });
  } catch (error) {
    logger.error('Error retrieving webhook status:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'An unknown error occurred'
    }, { status: 500 });
  }
}

/**
 * POST endpoint for manually triggering webhooks
 */
export async function action({ request }: LoaderFunctionArgs) {
  try {
    // Extract request data
    const requestData = await request.json() as { 
      projectId: string; 
      webhookUrl: string;
    };
    const { projectId, webhookUrl } = requestData;
    
    // Extract tenant ID for authorization
    const tenantId = extractTenantId(request);
    
    if (!projectId) {
      return json({ error: 'Project ID is required' }, { status: 400 });
    }
    
    if (!webhookUrl) {
      return json({ error: 'Webhook URL is required' }, { status: 400 });
    }
    
    logger.info('Manually triggering webhook', { 
      projectId,
      webhookUrl,
      tenantId: tenantId || 'none'
    });
    
    // Get the project state manager
    const projectManager = getProjectStateManager();
    
    // Get the project with tenant validation
    const project = await projectManager.getProject(projectId, tenantId);
    
    // Return 403 if project not found or tenant access denied
    if (!project) {
      logger.warn('Project not found or access denied', {
        projectId,
        tenantId: tenantId || 'none'
      });
      return json({ error: 'Project not found or access denied' }, { status: 403 });
    }
    
    // Find the webhook
    const webhooks = project.webhooks || [];
    const webhook = webhooks.find(wh => wh.url === webhookUrl);
    
    if (!webhook) {
      return json({ error: 'Webhook not found' }, { status: 404 });
    }
    
    // Import and use the webhook processor to trigger it
    const { processWebhooks } = await import('~/lib/requirements/processor');
    
    // Process just this one webhook
    const processedWebhooks = await processWebhooks(project, [webhook]);
    
    // Extract the processed webhook (should be the first one)
    const processedWebhook = processedWebhooks[0];
    
    // Update the project with the processed webhook
    // Find the webhook index
    const webhookIndex = webhooks.findIndex(wh => wh.url === webhookUrl);
    if (webhookIndex >= 0) {
      webhooks[webhookIndex] = processedWebhook;
      
      // Save the updated webhooks to the project
      await projectManager.updateProject(projectId, {
        webhooks
      }, tenantId);
    }
    
    logger.info('Webhook manually triggered', {
      projectId,
      webhookUrl,
      status: processedWebhook.status,
      tenantId: tenantId || 'none'
    });
    
    return json({
      success: true,
      projectId,
      webhook: {
        url: processedWebhook.url,
        method: processedWebhook.method,
        status: processedWebhook.status || 'unknown',
        lastAttempt: processedWebhook.lastAttempt,
        retries: processedWebhook.retries || 0,
        lastResponse: processedWebhook.lastResponse,
        tenantId: processedWebhook.tenantId
      }
    });
  } catch (error) {
    logger.error('Error manually triggering webhook:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'An unknown error occurred'
    }, { status: 500 });
  }
} 