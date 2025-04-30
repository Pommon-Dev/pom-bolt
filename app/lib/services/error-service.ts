import { createScopedLogger } from '~/utils/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = createScopedLogger('error-service');

/**
 * Error categories
 */
export enum ErrorCategory {
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  NOT_FOUND = 'not_found',
  CONFLICT = 'conflict',
  INTERNAL = 'internal',
  EXTERNAL = 'external',
  DEPLOYMENT = 'deployment',
  PROJECT = 'project',
  CREDENTIALS = 'credentials',
  UNKNOWN = 'unknown'
}

/**
 * Standard error interface with additional context
 */
export interface ErrorContext {
  errorId: string;
  timestamp: number;
  category: ErrorCategory;
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, any>;
  cause?: Error;
}

/**
 * Application error with standardized structure
 */
export class AppError extends Error {
  errorId: string;
  timestamp: number;
  category: ErrorCategory;
  code: string;
  statusCode: number;
  details?: Record<string, any>;
  cause?: Error;

  constructor(params: {
    message: string;
    category: ErrorCategory;
    code: string;
    statusCode: number;
    details?: Record<string, any>;
    cause?: Error;
    errorId?: string;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.errorId = params.errorId || uuidv4();
    this.timestamp = Date.now();
    this.category = params.category;
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.details = params.details;
    this.cause = params.cause;
  }

  /**
   * Convert to a plain object for logging or serialization
   */
  toJSON(): ErrorContext {
    return {
      errorId: this.errorId,
      timestamp: this.timestamp,
      category: this.category,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      cause: this.cause
    };
  }
}

/**
 * Error service for standardized error handling
 */
export class ErrorService {
  /**
   * Create a validation error
   */
  createValidationError(message: string, details?: Record<string, any>, cause?: Error): AppError {
    return new AppError({
      message,
      category: ErrorCategory.VALIDATION,
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details,
      cause
    });
  }

  /**
   * Create a not found error
   */
  createNotFoundError(message: string, details?: Record<string, any>): AppError {
    return new AppError({
      message,
      category: ErrorCategory.NOT_FOUND,
      code: 'NOT_FOUND',
      statusCode: 404,
      details
    });
  }

  /**
   * Create a project not found error
   */
  createProjectNotFoundError(projectId: string, tenantId?: string): AppError {
    const message = tenantId
      ? `Project not found or access denied for tenant: ${tenantId}`
      : `Project not found: ${projectId}`;
      
    return new AppError({
      message,
      category: ErrorCategory.NOT_FOUND,
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
      details: { projectId, tenantId }
    });
  }

  /**
   * Create an authentication error
   */
  createAuthenticationError(message: string, details?: Record<string, any>): AppError {
    return new AppError({
      message,
      category: ErrorCategory.AUTHENTICATION,
      code: 'AUTHENTICATION_ERROR',
      statusCode: 401,
      details
    });
  }

  /**
   * Create an authorization error
   */
  createAuthorizationError(message: string, details?: Record<string, any>): AppError {
    return new AppError({
      message,
      category: ErrorCategory.AUTHORIZATION,
      code: 'AUTHORIZATION_ERROR',
      statusCode: 403,
      details
    });
  }

  /**
   * Create a tenant access denied error
   */
  createTenantAccessDeniedError(resourceId: string, tenantId: string): AppError {
    return new AppError({
      message: `Access denied: Tenant ${tenantId} does not have access to resource ${resourceId}`,
      category: ErrorCategory.AUTHORIZATION,
      code: 'TENANT_ACCESS_DENIED',
      statusCode: 403,
      details: { resourceId, tenantId }
    });
  }

  /**
   * Create a deployment error
   */
  createDeploymentError(message: string, details?: Record<string, any>, cause?: Error): AppError {
    return new AppError({
      message,
      category: ErrorCategory.DEPLOYMENT,
      code: 'DEPLOYMENT_ERROR',
      statusCode: 400,
      details,
      cause
    });
  }

  /**
   * Create a credential error
   */
  createCredentialError(message: string, provider?: string, details?: Record<string, any>): AppError {
    return new AppError({
      message,
      category: ErrorCategory.CREDENTIALS,
      code: 'CREDENTIAL_ERROR',
      statusCode: 400,
      details: { ...details, provider }
    });
  }

  /**
   * Create an internal error
   */
  createInternalError(message: string, details?: Record<string, any>, cause?: Error): AppError {
    return new AppError({
      message,
      category: ErrorCategory.INTERNAL,
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      details,
      cause
    });
  }

  /**
   * Log an error with standardized format
   */
  logError(error: Error | AppError, context?: Record<string, any>): void {
    if (error instanceof AppError) {
      logger.error(`[${error.category}] ${error.code}: ${error.message}`, {
        ...error.details,
        ...context,
        errorId: error.errorId,
        statusCode: error.statusCode
      });
      
      if (error.cause) {
        logger.error('Caused by:', error.cause);
      }
    } else {
      logger.error(`[${ErrorCategory.UNKNOWN}] UNKNOWN_ERROR: ${error.message}`, {
        ...context,
        stack: error.stack
      });
    }
  }

  /**
   * Convert any error to an AppError
   */
  normalizeError(error: any, defaultMessage = 'An unknown error occurred'): AppError {
    if (error instanceof AppError) {
      return error;
    }
    
    if (error instanceof Error) {
      return new AppError({
        message: error.message || defaultMessage,
        category: ErrorCategory.UNKNOWN,
        code: 'UNKNOWN_ERROR',
        statusCode: 500,
        cause: error
      });
    }
    
    // Handle string or other primitive errors
    return new AppError({
      message: String(error) || defaultMessage,
      category: ErrorCategory.UNKNOWN,
      code: 'UNKNOWN_ERROR',
      statusCode: 500
    });
  }

  /**
   * Verify tenant access to a resource
   * This checks if the tenant ID in the request has access to the given resource (project, deployment, etc.)
   * @param resourceId The ID of the resource being accessed
   * @param resourceTenantId The tenant ID associated with the resource
   * @param requestTenantId The tenant ID from the request
   * @returns True if access is allowed, false otherwise
   */
  verifyTenantAccess(resourceId: string, resourceTenantId: string | undefined, requestTenantId: string | undefined): boolean {
    // If the resource has no tenant ID, anyone can access it
    if (!resourceTenantId) {
      return true;
    }
    
    // If no request tenant ID is provided, deny access to tenant-restricted resources
    if (!requestTenantId) {
      logger.debug('Access denied - no tenant ID in request', { resourceId });
      return false;
    }
    
    // Allow access only if tenant IDs match
    const hasAccess = resourceTenantId === requestTenantId;
    
    if (!hasAccess) {
      logger.warn('Tenant access denied', { 
        resourceId, 
        requestTenantId,
        resourceTenantId: `${resourceTenantId.substring(0, 5)}...` // Log partial for security
      });
    }
    
    return hasAccess;
  }
}

// Singleton instance
let errorServiceInstance: ErrorService | null = null;

/**
 * Get the error service instance
 */
export function getErrorService(): ErrorService {
  if (!errorServiceInstance) {
    errorServiceInstance = new ErrorService();
  }
  
  return errorServiceInstance;
}

/**
 * Reset the error service instance (for testing)
 */
export function resetErrorService(): void {
  errorServiceInstance = null;
} 