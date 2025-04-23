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
  logger.info('Processing webhooks', { projectId: projectState.id, count: webhooks.length });

  const validWebhooks = webhooks.filter(validateWebhookConfig);
  
  // TODO: Implement actual webhook processing logic
  // This is a placeholder that returns valid webhooks
  return validWebhooks;
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