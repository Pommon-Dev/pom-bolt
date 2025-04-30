import { json } from '@remix-run/cloudflare';
import { ErrorCategory, AppError, getErrorService } from '~/lib/services/error-service';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('error-handler-middleware');

/**
 * Standard API response structure
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
    details?: Record<string, any>;
    errorId?: string;
  };
}

/**
 * Options for error handling
 */
export interface ErrorHandlerOptions {
  includeDetails?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  defaultStatusCode?: number;
}

/**
 * Wraps a Remix loader or action function with standardized error handling
 * 
 * @param handlerFn The loader or action function to wrap
 * @param options Options for error handling
 */
export function withErrorHandling<T>(
  handlerFn: (...args: any[]) => Promise<any>,
  options: ErrorHandlerOptions = {}
): (...args: any[]) => Promise<Response> {
  const {
    includeDetails = process.env.NODE_ENV !== 'production',
    logLevel = 'error',
    defaultStatusCode = 500
  } = options;

  return async (...args: any[]): Promise<Response> => {
    try {
      // Call the original function
      const result = await handlerFn(...args);
      
      // If the result is already a Response, return it
      if (result instanceof Response) {
        return result;
      }
      
      // Otherwise, wrap it in a successful API response
      return json<ApiResponse<T>>({
        success: true,
        data: result
      });
    } catch (error) {
      // Get the error service
      const errorService = getErrorService();
      
      // Normalize the error to an AppError
      const appError = errorService.normalizeError(error);
      
      // Log the error
      if (logLevel === 'error') {
        errorService.logError(appError);
      } else if (logLevel === 'warn') {
        logger.warn(`[${appError.category}] ${appError.code}: ${appError.message}`, appError.toJSON());
      } else if (logLevel === 'info') {
        logger.info(`[${appError.category}] ${appError.code}: ${appError.message}`, appError.toJSON());
      } else if (logLevel === 'debug') {
        logger.debug(`[${appError.category}] ${appError.code}: ${appError.message}`, appError.toJSON());
      }
      
      // Create the error response
      const statusCode = appError.statusCode || defaultStatusCode;
      
      // Create the error payload
      const errorPayload: ApiResponse = {
        success: false,
        error: {
          message: appError.message,
          code: appError.code,
          errorId: appError.errorId
        }
      };
      
      // Include details if requested and available
      if (includeDetails && appError.details && errorPayload.error) {
        errorPayload.error.details = appError.details;
      }
      
      return json(errorPayload, { status: statusCode });
    }
  };
}

/**
 * Helper function to create a not found response
 */
export function notFound(message = 'Resource not found', code = 'NOT_FOUND'): Response {
  return json<ApiResponse>({
    success: false,
    error: {
      message,
      code
    }
  }, { status: 404 });
}

/**
 * Helper function to create a bad request response
 */
export function badRequest(message: string, code = 'BAD_REQUEST', details?: Record<string, any>): Response {
  return json<ApiResponse>({
    success: false,
    error: {
      message,
      code,
      details
    }
  }, { status: 400 });
}

/**
 * Helper function to create an unauthorized response
 */
export function unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED'): Response {
  return json<ApiResponse>({
    success: false,
    error: {
      message,
      code
    }
  }, { status: 401 });
}

/**
 * Helper function to create a forbidden response
 */
export function forbidden(message = 'Forbidden', code = 'FORBIDDEN'): Response {
  return json<ApiResponse>({
    success: false,
    error: {
      message,
      code
    }
  }, { status: 403 });
}

/**
 * Helper function to create a successful response
 */
export function success<T>(data?: T): Response {
  return json<ApiResponse<T>>({
    success: true,
    data
  });
} 