import { createScopedLogger } from '~/utils/logger';
import { handleProjectContext } from './project-context';
import type { ProjectRequestContext } from './project-context';
import { getDeploymentManager } from '~/lib/deployment';
import { getProjectStateManager } from '~/lib/projects';

const logger = createScopedLogger('requirements-middleware');

/**
 * Context object for requirements processing
 */
export interface RequirementsContext extends ProjectRequestContext {
  content: string;
  userId?: string;
  shouldDeploy: boolean;
  deploymentTarget?: string;
  deploymentOptions?: Record<string, any>;
  files?: Record<string, string>;
  deploymentResult?: {
    url: string;
    id: string;
    status: 'success' | 'failed' | 'in-progress';
  };
  error?: Error;
}

/**
 * Type for middleware functions in the requirements chain
 */
export type RequirementsMiddleware = (
  context: RequirementsContext,
  request: Request
) => Promise<RequirementsContext | null>;

/**
 * Parse request body to extract requirements content and metadata
 */
export async function parseRequest(
  context: RequirementsContext | null,
  request: Request
): Promise<RequirementsContext | null> {
  if (context) return context; // Already processed
  
  try {
    // Parse request body
    let body: any;
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      // Handle form data
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    }

    // Get the requirements content
    const content = body.content || body.requirements;
    
    if (!content || typeof content !== 'string') {
      throw new Error('Requirements content is required and must be a string');
    }
    
    // Extract deployment settings if present
    const shouldDeploy = Boolean(body.deploy || body.deployment);
    const deploymentTarget = 
      typeof body.deploymentTarget === 'string' ? body.deploymentTarget : 
      typeof body.deployment?.platform === 'string' ? body.deployment.platform :
      undefined;
    
    const deploymentOptions = 
      typeof body.deploymentOptions === 'object' ? body.deploymentOptions :
      typeof body.deployment?.settings === 'object' ? body.deployment.settings :
      {};
    
    logger.debug('Parsed requirements request', { 
      hasContent: true,
      shouldDeploy,
      deploymentTarget,
      hasOptions: Object.keys(deploymentOptions).length > 0
    });
    
    return {
      content,
      userId: body.userId,
      projectId: '',  // Will be set by project context middleware
      isNewProject: true, // Default assumption
      shouldDeploy,
      deploymentTarget,
      deploymentOptions
    };
  } catch (error) {
    logger.error('Failed to parse requirements request:', error);
    throw error;
  }
}

/**
 * Load project context and handle project identification
 */
export async function loadProjectContext(
  context: RequirementsContext,
  request: Request
): Promise<RequirementsContext> {
  logger.debug('Loading project context');
  
  try {
    // Use the existing project context middleware
    const projectContext = await handleProjectContext(request, {
      autoCreateProject: true,
      defaultProjectName: `Project ${new Date().toLocaleDateString()}`
    });
    
    // Merge the contexts
    return {
      ...context,
      ...projectContext,
      // Keep the content from the parsed request
      content: context.content,
      // Make sure we're not overriding deployment settings
      shouldDeploy: context.shouldDeploy,
      deploymentTarget: context.deploymentTarget,
      deploymentOptions: context.deploymentOptions
    };
  } catch (error) {
    logger.error('Failed to load project context:', error);
    throw error;
  }
}

/**
 * Process the requirements and save them to the project
 */
export async function processRequirements(
  context: RequirementsContext,
  request: Request
): Promise<RequirementsContext> {
  const projectManager = getProjectStateManager();
  
  try {
    if (context.isNewProject) {
      if (!context.project) {
        // Create project if it wasn't auto-created
        context.project = await projectManager.createProject({
          name: `Project ${new Date().toLocaleDateString()}`,
          initialRequirements: context.content,
          userId: context.userId
        });
        
        // Ensure projectId matches the created project
        context.projectId = context.project.id;
        logger.info(`Created new project: ${context.projectId}`);
      } else {
        logger.info(`Using auto-created project: ${context.projectId}`);
      }
    } else {
      // Update existing project with new requirements
      await projectManager.updateProject(context.projectId, {
        newRequirements: context.content
      });
      
      logger.info(`Updated existing project: ${context.projectId}`);
    }
    
    // Get current project files
    const files = await projectManager.getProjectFiles(context.projectId);
    
    // Convert to the format needed for deployment
    context.files = files.reduce((map, file) => {
      map[file.path] = file.content;
      return map;
    }, {} as Record<string, string>);
    
    logger.debug(`Processed ${files.length} files for project ${context.projectId}`);
    
    return context;
  } catch (error) {
    logger.error('Failed to process requirements:', error);
    context.error = error instanceof Error ? error : new Error(String(error));
    return context;
  }
}

/**
 * Handle deployment if requested
 */
export async function handleDeployment(
  context: RequirementsContext,
  request: Request
): Promise<RequirementsContext> {
  // Skip if deployment not requested or if there was an error
  if (!context.shouldDeploy || context.error || !context.files) {
    return context;
  }
  
  logger.info(`Deploying project ${context.projectId}`);
  
  try {
    const deploymentManager = getDeploymentManager();
    const projectName = context.project?.name || `project-${context.projectId}`;
    
    // Deploy with best target or specified target
    const result = await (context.deploymentTarget ? 
      deploymentManager.deployProject(
        context.deploymentTarget, 
        {
          projectId: context.projectId,
          projectName,
          files: context.files,
          ...context.deploymentOptions
        }
      ) : 
      deploymentManager.deployWithBestTarget({
        projectName,
        files: context.files,
        projectId: context.projectId,
        ...context.deploymentOptions
      })
    );
    
    // Save deployment to project state
    if (context.project) {
      const projectManager = getProjectStateManager();
      await projectManager.addDeployment(context.projectId, {
        url: result.url,
        provider: result.provider,
        timestamp: Date.now(),
        status: result.status,
        errorMessage: result.status === 'failed' ? result.logs.join('\n') : undefined
      });
    }
    
    // Add deployment result to context
    context.deploymentResult = {
      url: result.url,
      id: result.id,
      status: result.status
    };
    
    logger.info(`Deployment completed: ${result.url}`);
    
    return context;
  } catch (error) {
    logger.error('Deployment failed:', error);
    context.error = error instanceof Error ? error : new Error(String(error));
    return context;
  }
}

/**
 * Run the complete middleware chain
 */
export async function runRequirementsChain(request: Request): Promise<RequirementsContext> {
  // Define the middleware chain
  const middlewareChain: RequirementsMiddleware[] = [
    parseRequest as any, // Type casting due to first function having different signature
    loadProjectContext,
    processRequirements,
    handleDeployment
  ];
  
  // Run each middleware in sequence
  let context: RequirementsContext | null = null;
  
  for (const middleware of middlewareChain) {
    try {
      context = await middleware(context as any, request);
      
      if (!context) {
        throw new Error('Middleware returned null context');
      }
      
      // Stop processing if there's an error
      if (context.error) {
        logger.warn('Stopping middleware chain due to error:', context.error);
        break;
      }
    } catch (error) {
      logger.error('Middleware error:', error);
      
      if (!context) {
        context = {
          projectId: '',
          isNewProject: true,
          content: '',
          shouldDeploy: false,
          error: error instanceof Error ? error : new Error(String(error))
        };
      } else {
        context.error = error instanceof Error ? error : new Error(String(error));
      }
      
      break;
    }
  }
  
  if (!context) {
    throw new Error('Failed to process requirements');
  }
  
  return context;
} 