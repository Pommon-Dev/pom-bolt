/**
 * Middleware index file
 * Exports all middleware components for easy imports
 */

// Error handling middleware
export { 
  withErrorHandling, 
  badRequest, 
  notFound, 
  unauthorized, 
  forbidden, 
  success 
} from './error-handler';
export type { ApiResponse, ErrorHandlerOptions } from './error-handler';

// Requirements chain middleware
export { 
  runRequirementsChain, 
  parseRequest, 
  loadProjectContext, 
  processRequirements, 
  deployCode 
} from './requirements-chain';
export type { RequirementsContext, RequirementsMiddleware } from './requirements-chain';

// Project context middleware
export { 
  handleProjectContext 
} from './project-context';
export type { ProjectRequestContext } from './project-context'; 