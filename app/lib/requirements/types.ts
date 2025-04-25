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
  tenantId?: string;     // ID of the tenant that owns this webhook
  status?: 'pending' | 'success' | 'error'; // Current status of the webhook
  lastAttempt?: number | null;  // Timestamp of the last attempt
  retries?: number;      // Number of retries attempted
  lastResponse?: {      // Information about the last response
    status?: number;     // HTTP status code
    error?: string;      // Error message if any
    timestamp: number;   // When the response was received
  };
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
 * Enhanced project state with requirements and webhooks
 */
export interface RequirementsProjectState extends ProjectState {
  webhooks: WebhookConfig[];
}

/**
 * Alias for backwards compatibility
 * @deprecated Use RequirementsProjectState instead
 */
export type EnhancedProjectState = RequirementsProjectState; 