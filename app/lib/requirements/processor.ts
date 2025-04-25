import { createScopedLogger } from '~/utils/logger';
import type { RequirementsEntry, RequirementsProjectState, WebhookConfig } from './types';
import type { ProjectState } from '../projects/types';

const logger = createScopedLogger('requirements-processor');

/**
 * Process requirements for a project
 */
export async function processRequirements(
  projectState: ProjectState,
  requirements: string[]
): Promise<RequirementsEntry[]> {
  logger.info('Processing requirements', { projectId: projectState.id, count: requirements.length });

  const processedRequirements: RequirementsEntry[] = requirements.map((content, index) => ({
    id: `${projectState.id}-req-${index}`,
    content,
    timestamp: Date.now(),
    status: 'pending'
  }));

  // TODO: Implement actual requirements processing logic
  // This is a placeholder that marks all requirements as completed
  return processedRequirements.map(req => ({
    ...req,
    status: 'completed'
  }));
}

/**
 * Validate webhook configuration
 */
export function validateWebhookConfig(config: WebhookConfig): boolean {
  if (!config.url || !config.method) {
    logger.error('Invalid webhook config', { config });
    return false;
  }

  try {
    new URL(config.url);
    return true;
  } catch (error) {
    logger.error('Invalid webhook URL', { url: config.url, error });
    return false;
  }
}

/**
 * Process webhooks for a project
 */
export async function processWebhooks(
  projectState: ProjectState,
  webhooks: WebhookConfig[]
): Promise<WebhookConfig[]> {
  logger.info('Processing webhooks', { 
    projectId: projectState.id, 
    count: webhooks.length,
    tenantId: projectState.tenantId || 'none'
  });

  // Validate tenant information in webhooks if project has a tenant
  const webhooksWithValidTenant = projectState.tenantId 
    ? webhooks.filter(webhook => {
        // If webhook has no tenantId or has matching tenantId
        const isValid = !webhook.tenantId || webhook.tenantId === projectState.tenantId;
        if (!isValid) {
          logger.warn('Webhook tenant mismatch, skipping webhook', {
            webhookTenantId: webhook.tenantId,
            projectTenantId: projectState.tenantId,
            url: webhook.url
          });
        }
        return isValid;
      })
    : webhooks;
  
  // Filter for valid configurations
  const validWebhooks = webhooksWithValidTenant.filter(webhook => {
    const isValidConfig = validateWebhookConfig(webhook);
    if (!isValidConfig) {
      logger.error('Invalid webhook configuration, skipping webhook', {
        url: webhook.url,
        method: webhook.method,
        tenantId: webhook.tenantId || 'none'
      });
    }
    return isValidConfig;
  });
  
  // Add tenant information to webhooks that don't have it and initialize status
  const enhancedWebhooks = validWebhooks.map(webhook => ({
    ...webhook,
    tenantId: webhook.tenantId || projectState.tenantId,
    // Initialize status tracking
    status: 'pending' as 'pending' | 'success' | 'error',
    lastAttempt: null as number | null,
    retries: 0
  }));
  
  logger.debug('Processed webhooks', {
    originalCount: webhooks.length,
    validCount: enhancedWebhooks.length,
    tenantId: projectState.tenantId || 'none'
  });
  
  // Execute webhook calls
  const processedWebhooks = await Promise.all(
    enhancedWebhooks.map(async webhook => {
      try {
        const updatedWebhook = { ...webhook };
        updatedWebhook.lastAttempt = Date.now();
        
        // Prepare request headers
        const headers = new Headers({
          'Content-Type': 'application/json',
          ...webhook.headers
        });
        
        // Add tenant ID header if available
        if (webhook.tenantId) {
          headers.set('x-tenant-id', webhook.tenantId);
        }
        
        // Prepare request body
        const body = JSON.stringify({
          ...(webhook.body || {}),
          projectId: projectState.id,
          timestamp: Date.now(),
          tenantId: webhook.tenantId || projectState.tenantId
        });
        
        // Execute HTTP request with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        logger.info(`Executing webhook to ${webhook.url}`, {
          method: webhook.method,
          bodyLength: body.length,
          tenantId: webhook.tenantId || 'none'
        });
        
        try {
          const response = await fetch(webhook.url, {
            method: webhook.method,
            headers,
            body,
            signal: controller.signal
          });
          
          // Clear timeout
          clearTimeout(timeoutId);
          
          // Check response status
          if (response.ok) {
            logger.info(`Webhook call successful: ${webhook.url}`, {
              status: response.status,
              tenantId: webhook.tenantId || 'none'
            });
            updatedWebhook.status = 'success';
            updatedWebhook.lastResponse = {
              status: response.status,
              timestamp: Date.now()
            };
          } else {
            logger.warn(`Webhook call failed: ${webhook.url}`, {
              status: response.status,
              tenantId: webhook.tenantId || 'none'
            });
            updatedWebhook.status = 'error';
            updatedWebhook.lastResponse = {
              status: response.status,
              error: `HTTP error: ${response.status}`,
              timestamp: Date.now()
            };
          }
        } catch (error) {
          // Clear timeout
          clearTimeout(timeoutId);
          
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error(`Webhook call failed: ${webhook.url}`, {
            error: errorMessage,
            tenantId: webhook.tenantId || 'none'
          });
          
          updatedWebhook.status = 'error';
          updatedWebhook.lastResponse = {
            error: errorMessage,
            timestamp: Date.now()
          };
          
          // Increment retry count for future retries
          updatedWebhook.retries++;
        }
        
        return updatedWebhook;
      } catch (error) {
        // Handle any unexpected errors during processing
        logger.error(`Unexpected error processing webhook: ${webhook.url}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          tenantId: webhook.tenantId || 'none'
        });
        
        return {
          ...webhook,
          status: 'error',
          lastAttempt: Date.now(),
          lastResponse: {
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: Date.now()
          }
        };
      }
    })
  );
  
  return processedWebhooks;
}

/**
 * Update project state with requirements and webhooks
 */
export async function updateProjectWithRequirements(
  projectState: ProjectState,
  requirements: string[],
  webhooks: WebhookConfig[]
): Promise<RequirementsProjectState> {
  const processedRequirements = await processRequirements(projectState, requirements);
  const processedWebhooks = await processWebhooks(projectState, webhooks);

  return {
    ...projectState,
    requirements: processedRequirements,
    webhooks: processedWebhooks
  };
} 