import type { ProjectState, RequirementsEntry as BaseRequirementsEntry } from '~/lib/projects/types';

/**
 * Response data for requirements API
 */
export interface RequirementsResponseData {
  success: boolean;
  error?: {
    message: string;
    code: string;
    context?: Record<string, any>;
  };
  data?: {
    requirements: RequirementsEntry[];
    webhooks: WebhookConfig[];
  };
}

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: Record<string, any>;
}

/**
 * Requirements entry
 */
export interface RequirementsEntry extends BaseRequirementsEntry {
  status: 'pending' | 'completed' | 'failed';
  completedAt?: string;
  error?: string;
}

/**
 * Enhanced project state with requirements
 */
export interface EnhancedProjectState extends ProjectState {
  webhooks: WebhookConfig[];
} 