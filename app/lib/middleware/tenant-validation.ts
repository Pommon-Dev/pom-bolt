import { createScopedLogger } from '~/utils/logger';
import { getErrorService } from '~/lib/services/error-service';
import { getProjectStateManager } from '~/lib/projects';
import { 
  isMultiTenancyEnabled, 
  isDefaultTenantAllowed, 
  isStrictTenantValidation, 
  getDefaultTenantId 
} from '~/lib/env-config';

const logger = createScopedLogger('tenant-validation-middleware');

/**
 * Extract tenant ID from request headers and auth token
 * @param request The incoming HTTP request
 * @returns The extracted tenant ID or undefined
 */
export function extractTenantId(request: Request): string | undefined {
  // First check specific tenant header
  const tenantHeader = request.headers.get('x-tenant-id');
  if (tenantHeader) {
    logger.debug('Found tenant ID in x-tenant-id header', { tenantId: tenantHeader });
    return tenantHeader;
  }
  
  // Next check custom tenant header - for backward compatibility
  const customTenantHeader = request.headers.get('x-bolt-tenant-id');
  if (customTenantHeader) {
    logger.debug('Found tenant ID in x-bolt-tenant-id header', { tenantId: customTenantHeader });
    return customTenantHeader;
  }
  
  // Next check Authorization header - assuming Bearer token format
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    // In a real implementation, you would decode and validate the JWT here
    // For now, we're just using the token itself as a tenant identifier
    if (token) {
      logger.debug('Extracted tenant ID from Bearer token', { 
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 8) + '...' // Log just a snippet for security
      });
      return token;
    }
  }
  
  logger.debug('No tenant ID found in request');
  return undefined;
}

/**
 * Validate tenant access to a project
 * @param projectId The project ID
 * @param requestedTenantId The tenant ID from the request
 * @returns True if the tenant has access, false otherwise
 */
export async function validateTenantProjectAccess(
  projectId: string, 
  requestedTenantId?: string
): Promise<boolean> {
  logger.debug('Validating tenant access', { projectId, hasTenantId: !!requestedTenantId });
  
  // Check if multi-tenancy is enabled
  if (!isMultiTenancyEnabled()) {
    logger.debug('Multi-tenancy is disabled, allowing access');
    return true;
  }
  
  // If no tenant ID provided, check if we allow default tenant access
  if (!requestedTenantId) {
    const allowDefaultTenant = isDefaultTenantAllowed();
    logger.debug('No tenant ID provided, checking if default tenant is allowed', { allowDefaultTenant });
    return allowDefaultTenant;
  }
  
  const projectManager = getProjectStateManager();
  const project = await projectManager.getProject(projectId, requestedTenantId);
  
  // If the project isn't found, the tenant doesn't have access
  if (!project) {
    logger.warn('Project not found or tenant access denied', { projectId, tenantId: requestedTenantId });
    return false;
  }
  
  // Projects without a tenant ID are accessible to all tenants if STRICT_TENANT_VALIDATION is false
  if (!project.tenantId) {
    const strictValidation = isStrictTenantValidation();
    logger.debug('Project has no tenant ID, checking strict validation', { strictValidation });
    return !strictValidation;
  }
  
  // Check if the tenant IDs match
  const hasAccess = project.tenantId === requestedTenantId;
  logger.debug('Tenant access validation result', { 
    hasAccess, 
    projectId,
    projectTenantId: project.tenantId,
    requestedTenantId
  });
  
  return hasAccess;
}

/**
 * Validate tenant access and throw an error if validation fails
 * @param projectId The project ID
 * @param requestedTenantId The tenant ID from the request
 * @throws {Error} If tenant validation fails
 */
export async function validateTenantAccessOrThrow(
  projectId: string, 
  requestedTenantId?: string
): Promise<void> {
  const hasAccess = await validateTenantProjectAccess(projectId, requestedTenantId);
  
  if (!hasAccess) {
    const errorService = getErrorService();
    throw errorService.createTenantAccessDeniedError(
      projectId, 
      requestedTenantId || 'default'
    );
  }
}

/**
 * Middleware to validate tenant access to a deployment
 * @param deploymentId The deployment ID
 * @param requestedTenantId The tenant ID from the request
 * @returns True if the tenant has access, throws otherwise
 */
export async function validateTenantDeploymentAccess(
  deploymentId: string, 
  requestedTenantId?: string
): Promise<boolean> {
  logger.debug('Validating deployment access', { deploymentId, hasTenantId: !!requestedTenantId });
  
  // Check if multi-tenancy is enabled
  if (!isMultiTenancyEnabled()) {
    logger.debug('Multi-tenancy is disabled, allowing access');
    return true;
  }
  
  // If no tenant ID provided, check if we allow default tenant access
  if (!requestedTenantId) {
    const allowDefaultTenant = isDefaultTenantAllowed();
    logger.debug('No tenant ID provided, checking if default tenant is allowed', { allowDefaultTenant });
    return allowDefaultTenant;
  }
  
  // Here you would implement the logic to check if the deployment belongs to the tenant
  // This is a simplified implementation - in a real app, you'd check a database
  
  // For now, we'll just use the deployment ID format to check
  // Assuming deployments contain tenant ID in format: 'tenant-id:deployment-id'
  if (deploymentId.includes(':')) {
    const [deploymentTenantId] = deploymentId.split(':');
    const hasAccess = deploymentTenantId === requestedTenantId;
    
    logger.debug('Deployment tenant validation result', {
      hasAccess,
      deploymentId,
      deploymentTenantId,
      requestedTenantId
    });
    
    return hasAccess;
  }
  
  // If the deployment has no tenant ID format, check the strict validation setting
  const strictValidation = isStrictTenantValidation();
  logger.debug('Deployment has no tenant ID format, checking strict validation', { strictValidation });
  
  return !strictValidation;
}

/**
 * Validate that a tenant ID has the correct format
 * @param tenantId The tenant ID to validate
 * @returns True if valid, false otherwise
 */
export function isValidTenantId(tenantId?: string): boolean {
  if (!tenantId) return false;
  
  // Tenant ID should be alphanumeric with optional hyphens
  // Minimum 3 characters, maximum 64 characters
  const tenantIdRegex = /^[a-zA-Z0-9-]{3,64}$/;
  
  return tenantIdRegex.test(tenantId);
}

/**
 * Format a tenant ID to ensure it meets our requirements
 * @param tenantId The tenant ID to format
 * @returns Formatted tenant ID or undefined if invalid
 */
export function formatTenantId(tenantId?: string): string | undefined {
  if (!tenantId) return undefined;
  
  // Normalize to lowercase
  const normalized = tenantId.toLowerCase();
  
  // Remove special characters
  const sanitized = normalized.replace(/[^a-z0-9-]/g, '');
  
  // Ensure it's at least 3 characters
  if (sanitized.length < 3) return undefined;
  
  // Truncate if longer than 64 characters
  return sanitized.substring(0, 64);
} 