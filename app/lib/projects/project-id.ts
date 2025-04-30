// NOTE: We're using simple validation without external dependencies
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('project-id');

/**
 * UUID regex pattern for consistent validation across the application
 */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates if the provided string is a valid UUID
 * Simple validation checking for UUID format (8-4-4-4-12)
 */
export function validateProjectId(id: string | undefined): { 
  valid: boolean; 
  errors?: string[];
} {
  if (!id) {
    return { valid: false, errors: ['Project ID is required'] };
  }
  
  // Basic UUID format validation using regex
  const isValid = UUID_REGEX.test(id);
  
  logger.debug(`Validated project ID ${id}: ${isValid ? 'valid' : 'invalid'}`);
  
  return {
    valid: isValid,
    errors: isValid ? undefined : ['Invalid project ID format - must be UUID']
  };
}

/**
 * Checks if a project ID exists and is valid
 * Used for quick validation in request handlers
 */
export function isValidProjectId(id: string | undefined | null): boolean {
  if (!id) return false;
  
  // Basic UUID format validation using regex
  return UUID_REGEX.test(id);
}

/**
 * Extracts a valid project ID from various sources
 * @param sources Array of potential project ID sources
 * @returns Valid project ID or undefined
 */
export function extractValidProjectId(...sources: (string | undefined | null)[]): string | undefined {
  for (const source of sources) {
    if (source && isValidProjectId(source)) {
      return source;
    }
  }
  return undefined;
}

/**
 * Extracts and validates a project ID from a request using multiple strategies
 * @param request The request to extract the project ID from
 * @returns Valid project ID or undefined
 */
export function extractProjectIdFromRequest(request: Request): string | undefined {
  try {
    // Check URL parameters first
    const url = new URL(request.url);
    const urlProjectId = url.searchParams.get('projectId');
    
    // Check path patterns
    const pathMatch = url.pathname.match(/\/projects?\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const pathProjectId = pathMatch ? pathMatch[1] : undefined;
    
    // Check headers
    const headerProjectId = request.headers.get('x-project-id');
    
    // Try to find a valid project ID from multiple sources
    const projectId = extractValidProjectId(urlProjectId, pathProjectId, headerProjectId);
    
    if (projectId) {
      logger.debug(`Found valid project ID: ${projectId} from request`);
    }
    
    return projectId;
  } catch (error) {
    logger.error('Error extracting project ID from request:', error);
    return undefined;
  }
} 