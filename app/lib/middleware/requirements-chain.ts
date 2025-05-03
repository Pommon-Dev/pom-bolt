import { v4 as uuidv4 } from 'uuid';
// Add type declaration for uuid
// @ts-ignore
declare module 'uuid' {
  export function v4(): string;
}
import { CodegenService } from '~/lib/codegen/service';
import { getDeploymentManager } from '~/lib/deployment';
import { createScopedLogger } from '~/utils/logger';
import { NetlifyTarget } from '~/lib/deployment/targets/netlify';
import { DeploymentManager } from '~/lib/deployment/deployment-manager';
import { ZipPackager } from '~/lib/deployment/packagers/zip';
import { kvPut } from '~/lib/kv/binding';
import { getProjectStateManager } from '~/lib/projects';
import { handleProjectContext } from './project-context';
import type { ProjectRequestContext } from './project-context';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import type { 
  DeploymentResult, 
  ProjectMetadata
} from '~/lib/deployment/types';
import { getCloudflareCredentials, getNetlifyCredentials, getGitHubCredentials } from '~/lib/deployment/credentials';
import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { validateProjectId, isValidProjectId } from '~/lib/projects/project-id';
import { getCredentialService } from '~/lib/services/credential-service';
import type { ProjectFile, RequirementsEntry, GitHubRepositoryInfo } from '~/lib/projects/types';
import { getErrorService, ErrorCategory, AppError } from '~/lib/services/error-service';
import { getDeploymentOrchestrator } from '~/lib/deployment/deployment-orchestrator';
import { getConfigValidator } from '~/lib/services/config-validator';

// Define ChatRequest type locally since we can't import it
interface ChatRequest {
  apiKeys?: Record<string, string>;
  files?: Record<string, string>;
  promptId?: string;
  contextOptimization?: boolean;
}

const logger = createScopedLogger('requirements-middleware');

/**
 * Context object for requirements processing
 */
export interface RequirementsContext {
  content: string;
  userId?: string;
  tenantId?: string;
  projectId: string;
  isNewProject: boolean;
  shouldDeploy: boolean;
  deploymentTarget?: string;
  deploymentOptions?: Record<string, any>;
  files?: Record<string, string>;
  existingFiles?: Record<string, string>;
  existingRequirements?: RequirementsEntry[];
  name?: string;
  generatedFiles?: Record<string, string>;
  deploymentResult?: {
    url: string;
    id: string;
    status: 'success' | 'failed' | 'in-progress';
    provider?: string;
  };
  archiveKey?: string;
  error?: Error;
  env?: Record<string, any>;
  additionalRequirement?: boolean;
  project?: any;
  credentials?: Record<string, any>;
  deploymentError?: unknown;
  // GitHub specific fields
  githubInfo?: GitHubRepositoryInfo;
  githubError?: Error;
  // GitHub options - decoupled from deployment
  githubOptions?: {
    setupGitHub: boolean;
    credentials?: {
      token: string;
      owner?: string;
    };
  };
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
    logger.debug('Parsing requirements request', {
      method: request.method,
      contentType: request.headers.get('content-type')
    });
    
    // Parse request body
    const contentType = request.headers.get('Content-Type') || '';
    let body: any = {};

    if (contentType.includes('application/json')) {
      try {
        const requestBodyText = await request.text();
        try {
          body = JSON.parse(requestBodyText);
          logger.debug('[parseRequest] Successfully parsed JSON body', { 
            keys: Object.keys(body).join(','),
            contentLength: requestBodyText.length,
            shouldDeploy: body.shouldDeploy,
            deploy: body.deploy,
            deployment: body.deployment,
            deployTarget: body.deployTarget,
            deploymentTarget: body.deploymentTarget,
            setupGitHub: body.setupGitHub,
            hasGithubCredentials: !!body.githubCredentials,
            hasNetlifyCredentials: !!body.netlifyCredentials,
            additionalRequirement: body.additionalRequirement,
            projectId: body.projectId,
            tenantId: body.tenantId
          });
        } catch (parseError) {
          logger.error('[parseRequest] Failed to parse request body as JSON:', parseError);
          // Treat as plain text
          body = { content: requestBodyText };
        }
      } catch (bodyError) {
        logger.error('[parseRequest] Failed to read request body:', bodyError);
        throw new Error('Failed to read request body');
      }
    } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      // Handle form data
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
      logger.debug('[parseRequest] Parsed form data body', { keys: Object.keys(body).join(',') });
    } else {
      // Handle plain text or other formats
      const content = await request.text();
      body = { content };
      logger.debug('[parseRequest] Parsed plain text body', { contentLength: content.length });
    }

    // Extract content (requirements)
    const content = body.content || body.requirements || '';
    
    // Extract deployment flags
    const shouldDeploy = Boolean(body.shouldDeploy || body.deploy || body.deployment || body.deployTarget || body.deploymentTarget);
    
    // Extract tenant ID
    const tenantId = body.tenantId || extractTenantIdFromHeaders(request) || '';
    
    logger.info('[parseRequest] Deployment flags in request:', {
      shouldDeploy,
      bodyHasShouldDeploy: !!body.shouldDeploy,
      bodyHasDeploy: !!body.deploy,
      bodyHasDeployment: !!body.deployment, 
      bodyHasDeployTarget: !!body.deployTarget,
      deploymentTarget: body.deploymentTarget || body.deployTarget || 'none',
      tenantId: tenantId || 'none'
    });
    
    // Extract deployment settings if present
    const deploymentTarget = 
      typeof body.deploymentTarget === 'string' ? body.deploymentTarget : 
      typeof body.deployment?.platform === 'string' ? body.deployment.platform :
      undefined;
    
    // Extract deployment options from various sources
    const deploymentOptions = 
      typeof body.deploymentOptions === 'object' ? body.deploymentOptions :
      typeof body.deployment?.settings === 'object' ? body.deployment.settings :
      {};
    
    // Extract GitHub options independent of deployment
    const setupGitHub = body.setupGitHub === true || body.setupGitHub === 'true';
    
    // Set up githubOptions object
    let githubOptions = undefined;
    
    if (setupGitHub) {
      // First check for credentials.github (standard format)
      if (body.credentials?.github?.token) {
        githubOptions = {
          setupGitHub: true,
          credentials: {
            token: body.credentials.github.token,
            owner: body.credentials.github.owner
          }
        };
        logger.debug('[parseRequest] Found GitHub credentials in body.credentials.github');
      }
      // Also try direct githubCredentials for backward compatibility
      else if (body.githubCredentials?.token) {
        githubOptions = {
          setupGitHub: true,
          credentials: {
            token: body.githubCredentials.token,
            owner: body.githubCredentials.owner
          }
        };
        logger.debug('[parseRequest] Found GitHub credentials in body.githubCredentials');
      }
      // Also check for direct token and owner properties
      else if (body.githubToken || body.GITHUB_TOKEN) {
        githubOptions = {
          setupGitHub: true,
          credentials: {
            token: body.githubToken || body.GITHUB_TOKEN,
            owner: body.githubOwner || body.GITHUB_OWNER
          }
        };
        logger.debug('[parseRequest] Found GitHub credentials in direct properties');
      }
      // If no credentials found but setupGitHub is true, still create the options
      else {
        githubOptions = {
          setupGitHub: true
        };
        logger.debug('[parseRequest] No GitHub credentials found, but setupGitHub is true');
      }
    }
    
    logger.debug('[parseRequest] GitHub setup requested:', {
      setupGitHub,
      hasGithubCredentials: !!githubOptions?.credentials,
      hasToken: !!githubOptions?.credentials?.token,
      hasOwner: !!githubOptions?.credentials?.owner,
      credentialSources: body.credentials ? Object.keys(body.credentials) : []
    });
    
    // For backward compatibility, also add setupGitHub to deploymentOptions
    // This can be removed once all code is migrated to use githubOptions
    if (setupGitHub) {
      deploymentOptions.setupGitHub = true;
    }
    
    // Copy credentials from the root of the request to deploymentOptions if present
    if (body.credentials && typeof body.credentials === 'object') {
      deploymentOptions.credentials = body.credentials;
      logger.debug('[parseRequest] Copied credentials from request root to deploymentOptions', {
        credentialTypes: Object.keys(body.credentials),
        hasGithub: !!body.credentials.github,
        hasNetlify: !!body.credentials.netlify,
        hasCloudflare: !!body.credentials.cloudflare
      });
    }

    // Extract additionalRequirement flag and validate project ID if present
    const additionalRequirement = Boolean(body.additionalRequirement);
    
    // Check for project ID from different sources
    let projectId = '';
    
    if (body.projectId) {
      projectId = body.projectId;
    } else if (body.id) {
      projectId = body.id;
    } else {
      // Try to get from URL
      const url = new URL(request.url);
      const urlProjectId = url.searchParams.get('projectId');
      if (urlProjectId) {
        projectId = urlProjectId;
      }
    }
    
    // Validate project ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isValidUuid = projectId ? uuidRegex.test(projectId) : false;
    
    if (projectId && !isValidUuid) {
      logger.warn(`[parseRequest] Invalid project ID format: ${projectId}, must be UUID`);
      
      // If additionalRequirement is true and project ID is not valid UUID, throw an error
      if (additionalRequirement) {
        throw new Error('Additional requirements must include a valid project ID in UUID format');
      }
      // If not additionalRequirement, we'll treat as a new project but log a warning
      projectId = '';
    }
    
    // Validate consistency - additional requirements must have a valid project ID
    if (additionalRequirement && (!projectId || !isValidUuid)) {
      logger.error('[parseRequest] Additional requirement requested but no valid project ID provided', {
        projectId,
        isValidUuid,
        additionalRequirement
      });
      throw new Error('Additional requirements must include a valid project ID');
    }
    
    // Determine if this is a new or existing project
    // If additionalRequirement is true, we must have a valid project ID and isNewProject must be false
    // Otherwise, we check if we have a valid projectId to determine if it's a new project
    const isNewProject = additionalRequirement ? false : !projectId || !isValidUuid;
    
    logger.debug('[parseRequest] Parsed requirements request', { 
      contentLength: content.length,
      shouldDeploy,
      deploymentTarget,
      hasOptions: Object.keys(deploymentOptions).length > 0,
      additionalRequirement,
      projectId: projectId || 'none',
      projectIdValid: isValidUuid,
      isNewProject,
      tenantId: tenantId || 'none',
      setupGitHub: !!githubOptions
    });
    
    return {
      content,
      userId: body.userId,
      tenantId,
      projectId: isValidUuid ? projectId : '', // Only use projectId if valid
      isNewProject,
      shouldDeploy,
      deploymentTarget,
      deploymentOptions,
      additionalRequirement,
      project: {} as any,
      existingFiles: {} as Record<string, string>,
      existingRequirements: [] as RequirementsEntry[],
      generatedFiles: {} as Record<string, string>,
      githubOptions
    };
  } catch (error) {
    logger.error('Failed to parse requirements request:', error);
    throw error;
  }
}

/**
 * Extract tenant ID from request headers
 */
function extractTenantIdFromHeaders(request: Request): string | undefined {
  // Check for tenant ID in custom header
  const tenantId = request.headers.get('x-tenant-id');
  
  // Check for tenant ID in Authorization header (assuming JWT)
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      // This is a simplified example. In a real app, you would validate and decode the JWT
      const token = authHeader.substring(7);
      // Extract tenant ID from token if available
      // In a real implementation, you would use a JWT library to decode and validate the token
    } catch (error) {
      logger.error('Failed to extract tenant ID from JWT:', error);
    }
  }
  
  return tenantId || undefined;
}

/**
 * Load project context middleware
 */
export async function loadProjectContext(
  context: RequirementsContext,
  request: Request
): Promise<RequirementsContext> {
  // Skip if we already have project context
  if (context.project) return context;
  
  try {
    logger.debug('Loading project context', {
      projectId: context.projectId,
      isNewProject: context.isNewProject,
      additionalRequirement: context.additionalRequirement,
      tenantId: context.tenantId
    });

    // If this is an additionalRequirement and we have a projectId, ensure isNewProject is false
    if (context.additionalRequirement && context.projectId) {
      context.isNewProject = false;
      logger.info(`Processing additional requirement for existing project: ${context.projectId}`);
    }
    
    // For new projects, just pass through the context
    if (context.isNewProject) {
      logger.debug('New project, no existing context to load');
      return context;
    }
    
    // Get error service
    const errorService = getErrorService();
    
    // For existing projects, load project data
    if (!context.projectId) {
      const error = errorService.createValidationError(
        'Project ID is required for existing projects',
        { projectId: context.projectId, isNewProject: context.isNewProject }
      );
      
      logger.error('Cannot load project context: No project ID provided');
      errorService.logError(error, { source: 'loadProjectContext' });
      throw error;
    }
    
    // Validate project ID format
    if (!isValidProjectId(context.projectId)) {
      const error = errorService.createValidationError(
        `Invalid project ID format: ${context.projectId}`,
        { projectId: context.projectId, isUUID: false }
      );
      
      logger.error(`Invalid project ID format: ${context.projectId}`);
      errorService.logError(error, { source: 'loadProjectContext' });
      throw error;
    }
    
    // Get project state manager
    const projectManager = getProjectStateManager();
    
    // Check if project exists
    const projectExists = await projectManager.projectExists(context.projectId);
    if (!projectExists) {
      const error = errorService.createProjectNotFoundError(
        context.projectId,
        context.tenantId
      );
      
      logger.error(`Project not found: ${context.projectId}`);
      errorService.logError(error, { source: 'loadProjectContext' });
      throw error;
    }
    
    // Load project
    const project = await projectManager.getProject(context.projectId);
    if (!project) {
      const error = errorService.createProjectNotFoundError(
        context.projectId,
        context.tenantId
      );
      
      logger.error(`Failed to load project: ${context.projectId}`);
      errorService.logError(error, { source: 'loadProjectContext' });
      throw error;
    }
    
    // Validate tenant ownership if tenant ID is provided
    if (context.tenantId && project.tenantId && context.tenantId !== project.tenantId) {
      const error = errorService.createTenantAccessDeniedError(
        context.projectId,
        context.tenantId
      );
      
      logger.error(`Tenant mismatch for project ${context.projectId}`, {
        requestTenantId: context.tenantId,
        projectTenantId: project.tenantId
      });
      
      errorService.logError(error, { source: 'loadProjectContext' });
      throw error;
    }
    
    // Load existing files for context
    const projectFiles = await projectManager.getProjectFiles(context.projectId);
    
    // Convert ProjectFile[] to Record<string, string> for context
    const existingFiles: Record<string, string> = {};
    for (const file of projectFiles) {
      if (!file.isDeleted) {
        existingFiles[file.path] = file.content;
      }
    }
    
    // If this is an additional requirement, load existing requirements
    let existingRequirements: RequirementsEntry[] = [];
    if (context.additionalRequirement) {
      existingRequirements = project.requirements || [];
      logger.info(`Loaded ${existingRequirements.length} existing requirements for context`);
    }
    
    logger.debug(`Successfully loaded project context: ${context.projectId}`, {
      projectName: project.name,
      fileCount: Object.keys(existingFiles).length,
      tenantId: project.tenantId
    });
    
    // Return enhanced context with project data
    return {
      ...context,
      project,
      existingFiles,
      existingRequirements,
      tenantId: project.tenantId || context.tenantId // Ensure tenantId is passed through
    };
  } catch (error) {
    // Get error service
    const errorService = getErrorService();
    
    // Log the error with better context
    const normalizedError = errorService.normalizeError(
      error, 
      `Error loading project context for ${context.projectId || 'unknown project'}`
    );
    
    logger.error('Error loading project context:', error);
    errorService.logError(normalizedError, { 
      projectId: context.projectId,
      tenantId: context.tenantId,
      isNewProject: context.isNewProject,
      source: 'loadProjectContext'
    });
    
    throw error;
  }
}

/**
 * Store a project ZIP archive
 */
export async function storeProjectArchive(
  projectId: string,
  files: Record<string, string>,
  context: RequirementsContext
): Promise<string | null> {
  try {
    logger.info(`Creating archive for project ${projectId} with ${Object.keys(files).length} files`);
    
    // Create ZIP archive
    const zipPackager = new ZipPackager();
    const zipData = await zipPackager.package(files);
    
    // Generate a key for the archive
    const timestamp = Date.now();
    const archiveKey = `project-${projectId}-${timestamp}.zip`;

    // Store in KV with enhanced error handling
    try {
      logger.debug('Attempting to store archive in KV storage', { 
        archiveKey, 
        size: zipData.byteLength,
        hasEnv: !!context.env,
        contextKeys: context.env ? Object.keys(context.env).join(',') : 'none',
        contextType: typeof context,
        zipDataType: typeof zipData,
        isArrayBuffer: zipData instanceof ArrayBuffer,
        isUint8Array: zipData instanceof Uint8Array
      });
    
      // Cloudflare context is expected in a specific format for KV operations
      // Try multiple formats to ensure it can be found
      let success = false;
    
      // First try with the entire context, which should contain the necessary environment
      // Important: Pass the zipData directly as binary data - do NOT convert to string or JSON
      success = await storeProjectZipArchive(context, projectId, zipData, archiveKey);
      
      if (success) {
        logger.info(`Project archive stored successfully in KV with key: ${archiveKey}`);
        
        // Update project metadata with archive reference
        const projectManager = getProjectStateManager();
        await projectManager.updateProject(projectId, {
          metadata: {
            latestArchive: {
              key: archiveKey,
              timestamp,
              size: zipData.byteLength,
              storageType: 'kv'
            }
          }
        });
        
        return archiveKey;
      } else {
        logger.warn(`KV storage operation failed for archive key: ${archiveKey}`);
      }
    } catch (kvError) {
      logger.error('Error storing project archive in KV:', kvError);
    }
    
    // Fallback for local development or if KV storage fails
    logger.info(`Storing archive in project metadata as base64 string`);
    try {
      // Convert buffer to base64 string for metadata storage
      const base64Data = Buffer.from(zipData).toString('base64');
      
      // Store a reference to the base64 data in project metadata
      const projectManager = getProjectStateManager();
      await projectManager.updateProject(projectId, {
        metadata: {
          archiveInline: {
            timestamp,
            size: zipData.byteLength,
            base64: base64Data.substring(0, 100) + '...' // Store truncated version in metadata
          }
        }
      });
      
      // Use a special key for inline storage to reference later
      return `inline-${projectId}-${timestamp}`;
    } catch (inlineError) {
      logger.error('Error storing inline archive in metadata:', inlineError);
    }
    
    return null;
  } catch (error) {
    logger.error('Error creating project archive:', error);
    return null;
  }
}

/**
 * Store a project ZIP archive in KV
 */
export async function storeProjectZipArchive(
  context: unknown,
  projectId: string,
  zipData: ArrayBuffer | Uint8Array,
  zipName?: string
): Promise<boolean> {
  // Generate a unique key for the ZIP file
  const timestamp = Date.now();
  const zipKey = zipName || `project-${projectId}-${timestamp}.zip`;

  console.log(`Storing project archive ${zipKey}, ZIP data type: ${zipData.constructor.name}, size: ${zipData.byteLength} bytes`);
  
  // Make sure we're passing binary data without conversion to string or JSON
  let success = false;
  
  // Try multiple approaches to store the data, with detailed logging
  try {
    // First try with the full context
    console.log(`Attempting to store ZIP data using full context`);
    success = await kvPut(context, zipKey, zipData);
    
    if (!success && context && typeof context === 'object' && 'cloudflare' in (context as any)) {
      // If the first attempt failed, try with context.cloudflare
      console.log(`First attempt failed, trying with context.cloudflare`);
      success = await kvPut((context as any).cloudflare, zipKey, zipData);
    }
    
    if (!success && context && typeof context === 'object' && 'env' in (context as any)) {
      // If still failed, try with context.env
      console.log(`Second attempt failed, trying with context.env`);
      success = await kvPut((context as any).env, zipKey, zipData);
    }
    
    if (!success) {
      // Last resort: try direct global access
      console.log(`All context-based attempts failed, trying with direct global access`);
      success = await kvPut(globalThis, zipKey, zipData);
    }
    
    if (success) {
      console.log(`Successfully stored project archive: ${zipKey}`);
      return true;
    } else {
      console.error(`Failed to store project archive: ${zipKey}`);
      return false;
    }
  } catch (error) {
    console.error(`Error storing project archive: ${error}`);
    return false;
  }
}

/**
 * Configure the deployment manager with credentials from environment and request
 */
async function configureDeploymentManager(context: RequirementsContext): Promise<{
  deploymentManager: DeploymentManager;
  availableTargets: string[];
}> {
  // Use the credential service to get credentials from all sources
  const credentialService = getCredentialService();
  
  // Get all credentials with priority: request > temporary > environment
  const credentials = credentialService.getAllCredentials({
    env: context.env,
    requestData: context.deploymentOptions || {},
    tenantId: context.tenantId
  });
  
  // Prepare Cloudflare config for deployment manager
  const cloudflareConfig = credentials.cloudflare ? {
    accountId: credentials.cloudflare.accountId,
    apiToken: credentials.cloudflare.apiToken,
    projectName: credentials.cloudflare.projectName
  } : undefined;
  
  // Extract Netlify token for deployment manager
  const netlifyToken = credentials.netlify?.apiToken;
  
  // Log credential sources for debugging
  logger.debug('Credentials found for deployment:', {
    hasCloudflare: !!credentials.cloudflare,
    cloudflareSource: credentials.cloudflare?.source,
    hasNetlify: !!credentials.netlify,
    netlifySource: credentials.netlify?.source,
    hasGitHub: !!credentials.github,
    githubSource: credentials.github?.source,
    tenantId: context.tenantId || 'none'
  });
      
  const deploymentManager = await getDeploymentManager({
    cloudflareConfig,
    netlifyToken
  });
  
  // Ensure Netlify is registered as a target if we have credentials
  if (netlifyToken) {
    logger.info('Ensuring Netlify target is registered with valid credentials');
    // Check if Netlify is available in registered targets
    const registeredTargets = deploymentManager.getRegisteredTargets();
    if (!registeredTargets.includes('netlify')) {
      logger.debug('Netlify target not found in registered targets, attempting to register');
      try {
        // Map apiToken to token as expected by NetlifyTarget
        const netlifyTarget = new NetlifyTarget({ token: netlifyToken });
        const isAvailable = await netlifyTarget.isAvailable();
        if (isAvailable) {
          deploymentManager.registerTarget('netlify', netlifyTarget);
          logger.info('Successfully registered Netlify deployment target');
        } else {
          logger.warn('Netlify target API validation failed with provided token');
        }
      } catch (error) {
        logger.warn('Failed to register Netlify target:', error);
      }
    }
  }
  
  // Log available targets
  const availableTargets = await deploymentManager.getAvailableTargets();
  logger.debug('Available deployment targets:', { targets: availableTargets });
  
  return { deploymentManager, availableTargets };
}

/**
 * Process requirements and generate code/project
 */
export async function processRequirements(
  context: RequirementsContext,
  request: Request
): Promise<RequirementsContext> {
  try {
    const { content, isNewProject, projectId, additionalRequirement } = context;
    
    logger.debug('Processing requirements', {
      isNewProject,
      hasProjectId: !!projectId, 
      contentLength: content.length,
      additionalRequirement
    });
    
    // Initialize code generation service
    // const codegenService = new CodegenService(); // This was incorrect
    
    // Get the API keys from cookies or headers
    const apiKeys = await getApiKeysFromCookie(request.headers.get('cookie') || '');
    
    // Result object to hold our generated files
    let result: Record<string, string>;
    
    if (isNewProject) {
      // This is a new project, generate it from scratch
      logger.info('Generating code for new project');
      
      // Get a name for the project - either from context or generate one
      const projectName = context.name || generateProjectName(content);
      logger.debug(`Using project name: ${projectName}`);
      
      // Generate all the files for a new project
      // Merge existing context files if any (from uploadFiles middleware)
      const existingFiles = context.files || {};
      
      try {
        // Generate code using the static method
        const codegenResult = await CodegenService.generateCode({
          requirements: content,
          apiKeys,
          projectId: projectId || 'new-project',
          isNewProject: true,
          existingFiles
        });
        
        result = codegenResult.files;
        logger.info(`Generated ${Object.keys(result).length} files for new project`);
      } catch (error) {
        logger.error('Failed to generate code:', error);
        
        // Fallback to sample project if code generation fails
        logger.info('Using sample project as fallback');
        result = createSampleProject(content);
      }
      
      // Create project in state manager
      const projectManager = getProjectStateManager();
      const newProject = await projectManager.createProject({
        name: projectName,
        initialRequirements: content,
        userId: context.userId,
        tenantId: context.tenantId,
        metadata: {
          source: 'requirements-api',
          timestamp: Date.now()
        }
      });
      
      logger.info(`Created new project: ${newProject.id} (${projectName})`, {
        tenantId: context.tenantId
      });
      
      // Save generated files to the project
      if (Object.keys(result).length > 0) {
        await projectManager.addFiles(newProject.id, result);
        logger.debug(`Saved ${Object.keys(result).length} files to project ${newProject.id}`);
      }
      
      // Store files in a ZIP archive
      await storeProjectArchive(newProject.id, result, context);
      
      // Update context with the new project info and files
      return {
        ...context,
        projectId: newProject.id,
        isNewProject: true,
        name: projectName,
        project: newProject,
        generatedFiles: result
      };
    } else {
      // This is an existing project that's being updated with additional requirements
      logger.info(`Processing additional requirements for existing project: ${projectId}`);
      
      if (!projectId) {
        throw new Error('Cannot update project: No project ID provided');
      }
      
      // Get existing files and requirements if they weren't loaded in context
      const projectManager = getProjectStateManager();
      let existingFiles = context.existingFiles;
      
      // If existingFiles is not already loaded, fetch and convert them
      if (!existingFiles) {
        const projectFiles = await projectManager.getProjectFiles(projectId);
        existingFiles = {};
        for (const file of projectFiles) {
          if (!file.isDeleted) {
            existingFiles[file.path] = file.content;
          }
        }
      }
      
      if (!context.project) {
        throw new Error(`Cannot update project: Failed to load project context for ${projectId}`);
      }
      
      // Get existing requirements if not already provided
      const existingRequirements = context.existingRequirements || 
                                  (context.project?.requirements || []);
      
      try {
        // Generate updated code with context from existing files using the static method
        const codegenResult = await CodegenService.generateCode({
          requirements: content,
          apiKeys,
          projectId,
          isNewProject: false,
          existingFiles,
        });
        
        result = codegenResult.files;
        logger.info(`Generated/updated ${Object.keys(result).length} files for existing project ${projectId}`);
      } catch (error) {
        logger.error(`Failed to generate code for project ${projectId}:`, error);
        
        // Fallback to simple update if code generation fails
        logger.info('Using simple update as fallback');
        result = updateSampleProject(existingFiles, content);
      }
      
      // Add the new requirements to the project history
      await projectManager.addRequirements(projectId, content, context.userId, additionalRequirement);
      
      // Save the updated files to the project
      if (Object.keys(result).length > 0) {
        await projectManager.addFiles(projectId, result);
        logger.debug(`Updated ${Object.keys(result).length} files in project ${projectId}`);
      }
      
      // Store updated files in a ZIP archive
      await storeProjectArchive(projectId, result, context);
      
      // Return context with the updated files
      return {
        ...context,
        isNewProject: false,
        generatedFiles: result
      };
    }
  } catch (error) {
    logger.error('Failed to process requirements:', error);
    throw error;
  }
}

/**
 * Helper to create a sample project for demonstration
 * In a real implementation, this would use an LLM to generate code from requirements
 */
function createSampleProject(requirements: string): Record<string, string> {
  // This is just a placeholder for demonstration
  return {
    'index.html': `
<!DOCTYPE html>
<html>
<head>
  <title>Generated Project</title>
  <link rel="stylesheet" href="style.css">
  <meta name="description" content="Generated from: ${requirements.substring(0, 100)}...">
</head>
<body>
  <h1>Generated Project</h1>
  <p>This project was generated based on the following requirements:</p>
  <pre>${requirements}</pre>
  <script src="script.js"></script>
</body>
</html>
    `,
    'style.css': `
body {
  font-family: Arial, sans-serif;
  margin: 2rem;
  color: #333;
}

pre {
  background: #f5f5f5;
  padding: 1rem;
  border-radius: 4px;
  overflow: auto;
}
    `,
    'script.js': `
// Generated script based on requirements
console.log("Generated project from requirements");
    `
  };
}

/**
 * Helper to update a sample project for demonstration
 * In a real implementation, this would use an LLM to update code from requirements
 */
function updateSampleProject(existingFiles: Record<string, string>, requirements: string): Record<string, string> {
  // This is just a placeholder for demonstration
  // In a real implementation, this would incorporate the existing files
  // and make modifications based on the new requirements
  
  const updatedFiles = { ...existingFiles };
  
  // Add or update a README with the new requirements
  updatedFiles['README.md'] = `
# Updated Project

This project was updated based on the following requirements:

\`\`\`
${requirements}
\`\`\`
  `;
  
  return updatedFiles;
}

/**
 * Helper to generate a project name from requirements
 * In a real implementation, this would use an LLM to generate a project name from requirements
 */
function generateProjectName(requirements: string): string {
  // This is just a placeholder for demonstration
  return `Project from requirements: ${requirements.substring(0, 50)}...`;
}

/**
 * Project context interface for requirements processing
 */
export interface ProjectContext {
  project: any;
  deploymentResult?: {
    id: string;
    url: string;
    status: 'success' | 'failed' | 'in-progress';
  };
  deploymentError?: unknown;
}

/**
 * Extended ProjectRequestContext for requirements processing
 */
export interface RequirementsRequestContext extends ProjectRequestContext {
  shouldDeploy?: boolean;
  deploymentTarget?: string;
  deploymentOptions?: Record<string, any> | false;
  credentials?: Record<string, any>;
  additionalRequirement?: boolean;
}

/**
 * Trigger deployment based on request parameters
 */
export async function triggerDeployment(req: RequirementsRequestContext, context: ProjectContext): Promise<RequirementsRequestContext> {
  logger.debug('Checking if deployment should be triggered');
  
  // Return if no project to deploy or deployment is explicitly disabled
  if (!context.project || req.deploymentOptions === false) {
    logger.debug('Deployment skipped - disabled or no project');
    return req;
  }
  
  // Get deployment orchestrator
  const deploymentOrchestrator = getDeploymentOrchestrator();
  
  // Start validating deployment configuration
  let shouldDeploy = !!req.shouldDeploy;
  
  // Validate and log credentials - important debugging step
  let validatedCredentials: Record<string, any> = {};
  if (req.credentials) {
    logger.debug('Validating credentials for deployment', {
      credentialKeys: Object.keys(req.credentials),
      hasGithub: !!req.credentials.github,
      hasNetlify: !!req.credentials.netlify
    });
    
    const configValidator = getConfigValidator();
    validatedCredentials = configValidator.validateDeploymentCredentials(req.credentials, req.tenantId);
    
    logger.debug('Validated credentials result', {
      validatedKeys: Object.keys(validatedCredentials),
      hasGithub: !!validatedCredentials.github,
      hasNetlify: !!validatedCredentials.netlify
    });
    
    // If we have any valid credentials, consider deployment
    if (Object.keys(validatedCredentials).length > 0) {
      logger.debug('Valid credentials detected, enabling deployment', {
        providers: Object.keys(validatedCredentials)
      });
      shouldDeploy = true;
      req.credentials = validatedCredentials;
    }
  }
  
  // Check if this is an additional requirement with existing deployments
  if (req.additionalRequirement && context.project.deployments?.length > 0) {
    logger.debug('Additional requirement with existing deployments detected');
    
    // Check if there's a deployment target preference
    const targetName = req.deploymentTarget || context.project.deployments[0].provider;
    
    if (targetName) {
      logger.debug('Using existing deployment target', { targetName });
      req.deploymentTarget = targetName;
      shouldDeploy = true;
    }
  }
  
  // If we should deploy, proceed with deployment
  if (shouldDeploy) {
    logger.info('Triggering deployment for project', { 
      projectId: context.project.id,
      additionalRequirement: !!req.additionalRequirement,
      deploymentTarget: req.deploymentTarget,
      hasGithubCredentials: !!validatedCredentials.github,
      hasNetlifyCredentials: !!validatedCredentials.netlify
    });
    
    // Add metadata about the deployment source
    const metadata = {
      source: 'requirements-chain',
      additionalRequirement: !!req.additionalRequirement,
      ...(req.deploymentOptions && typeof req.deploymentOptions === 'object' ? req.deploymentOptions : {})
    };
    
    try {
      // Configure deployment request
      const deploymentRequest = {
        projectId: context.project.id,
        tenantId: req.tenantId,
        targetName: req.deploymentTarget,
        setupGitHub: req.deploymentOptions && typeof req.deploymentOptions === 'object' 
          ? req.deploymentOptions.setupGitHub 
          : undefined,
        credentials: validatedCredentials,
        metadata
      };
      
      // Deploy the project
      const deploymentResult = await deploymentOrchestrator.deployProject(deploymentRequest);
      
      // Store the deployment result in the context
      context.deploymentResult = deploymentResult;
      
      logger.info('Deployment triggered successfully', {
        projectId: context.project.id,
        deploymentId: deploymentResult.id,
        status: deploymentResult.status
      });
    } catch (error) {
      // Log the error but don't fail the requirements request
      logger.error('Deployment failed', {
        projectId: context.project.id,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Store error in context for later use
      context.deploymentError = error instanceof Error ? error : new Error(String(error));
    }
  }
  
  return req;
}

/**
 * Validate tenant access to the project
 */
export async function validateTenantAccess(req: RequirementsRequestContext, context: ProjectContext): Promise<RequirementsRequestContext> {
  logger.debug('Validating tenant access');
  
  // Skip validation if no project or no tenant ID
  if (!req.projectId || !req.tenantId) {
    return req;
  }
  
  // Skip validation for new projects
  if (req.isNewProject) {
    return req;
  }
  
  // Get project state manager to retrieve project details
  const projectStateManager = await getProjectStateManager();
  
  try {
    // Try to retrieve the project
    const project = await projectStateManager.getProject(req.projectId);
    
    if (!project) {
      const errorService = getErrorService();
      throw errorService.createNotFoundError(`Project not found: ${req.projectId}`);
    }
    
    // If the project has a tenant ID, verify it matches the request
    if (project.tenantId && project.tenantId !== req.tenantId) {
      const errorService = getErrorService();
      throw errorService.createAuthorizationError(
        `Access denied: Tenant ${req.tenantId} does not have access to project ${req.projectId}`,
        { projectId: req.projectId, tenantId: req.tenantId }
      );
    }
    
    // Also validate tenant IDs in credentials if they exist
    if (req.credentials && typeof req.credentials === 'object') {
      for (const [provider, config] of Object.entries(req.credentials)) {
        if (config && typeof config === 'object' && 'tenantId' in config) {
          const credentialTenantId = (config as any).tenantId;
          if (credentialTenantId && credentialTenantId !== req.tenantId) {
            const errorService = getErrorService();
            throw errorService.createAuthorizationError(
              `Access denied: Credential tenant ID ${credentialTenantId} does not match request tenant ID ${req.tenantId}`,
              { 
                provider, 
                projectId: req.projectId, 
                tenantId: req.tenantId, 
                credentialTenantId 
              }
            );
          }
        }
      }
    }
    
    logger.debug('Tenant access validated', { projectId: req.projectId, tenantId: req.tenantId });
    return req;
  } catch (error) {
    // If it's already a known error, rethrow it
    if (error instanceof AppError) {
      throw error;
    }
    
    // Otherwise, handle as a not found error
    const errorService = getErrorService();
    throw errorService.createNotFoundError(`Project not found: ${req.projectId}`);
  }
}

/**
 * Enhanced middleware chain setup
 * This adds tenant validation and improves the deployment trigger
 */
export const requirementsMiddleware = [
  parseRequest,
  loadProjectContext,
  validateTenantAccess, // Add tenant validation
  processRequirements,
  triggerDeployment
];

/**
 * Run the complete requirements processing chain
 * This is the main entry point for processing requirements
 */
export async function runRequirementsChain(
  request: Request,
  cloudflareContext?: any
): Promise<RequirementsContext> {
  let context: RequirementsContext | null = null;
  
  try {
    // Phase 1: Parse request and setup
    context = await parseRequest(null, request);
    
    // Log setup information
    logger.info('🏁 [runRequirementsChain] Starting requirements chain', { 
      requestUrl: request.url,
      method: request.method,
      hasContent: !!context?.content,
      shouldDeploy: !!context?.shouldDeploy,
      setupGitHub: !!context?.githubOptions?.setupGitHub,
      hasDeployTarget: !!context?.deploymentTarget,
      projectId: context?.projectId,
      hasCloudflareContext: !!cloudflareContext,
      hasCloudflareEnv: !!cloudflareContext?.cloudflare?.env
    });
    
    if (!context) {
      logger.warn('⚠️ [runRequirementsChain] Context is null after parseRequest');
      throw new Error('Failed to parse requirements request');
    }
    
    // Add Cloudflare context to the requirements context if available
    if (cloudflareContext) {
      // Store the environment in the context for use by other middleware
      context.env = cloudflareContext.cloudflare?.env || cloudflareContext.env || {};
      logger.debug('📝 [runRequirementsChain] Added Cloudflare environment to context', {
        envKeys: context.env ? Object.keys(context.env) : []
      });
    } else {
      logger.warn('⚠️ [runRequirementsChain] No Cloudflare context provided, environment variables may be unavailable');
    }
    
    context = await loadProjectContext(context, request);
    
    // Phase 2: Generate code
    logger.info('⚙️ [runRequirementsChain] Calling processRequirements...');
    context = await processRequirements(context, request);
    
    if (context.error) {
      logger.error('❌ Code generation failed, returning early', { error: context.error.message });
      return context;
    }
    
    // Add buildconfig.json generation
    context = await enhanceGeneratedCode(context);
    
    logger.info('✅ [runRequirementsChain] Returned from processRequirements', { 
      projectId: context.projectId, 
      filesGenerated: Object.keys(context.generatedFiles || {}).length, 
      archiveKey: context.archiveKey || 'not-set'
    });
    
    // Phase 3: Persist project (critical phase)
    context = await persistProject(context);
    if (context.error) {
      logger.error('❌ Project persistence failed, returning early', { error: context.error.message });
      return context;
    }
    
    // Update basic project state
    await updateProjectMetadata(context.projectId, {
      status: 'generated',
      generatedAt: new Date().toISOString(),
      fileCount: Object.keys(context.generatedFiles || {}).length
    });
    
    // Phase 4: GitHub integration (optional)
    if (context.githubOptions?.setupGitHub) {
      try {
        // Use our own setupGitHubRepository function instead of importing one that might not exist
        logger.info('🚀 [runRequirementsChain] Starting GitHub repository setup');
        context = await setupGitHubRepository(context);
        
        logger.info('✅ [runRequirementsChain] GitHub repository setup completed', {
          success: !!context.githubInfo,
          hasError: !!context.githubError
        });
      } catch (error) {
        // Log error but continue
        logger.error('❌ GitHub setup failed but continuing', { error });
        context.githubError = error instanceof Error ? error : new Error(String(error));
        
        // Update metadata with GitHub error - the GitHub middleware should do this,
        // but we add a fallback in case of unexpected errors
        await updateProjectMetadata(context.projectId, {
          github: {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            failedAt: new Date().toISOString()
          }
        });
      }
    }
    
    // Phase 5: Deployment (optional)
    if (context.shouldDeploy) {
      try {
        context = await deployCode(context);
        // Deployment metadata is updated within the deployCode function
      } catch (error) {
        // Log error but continue
        logger.error('❌ Deployment failed', { error });
        context.deploymentError = error instanceof Error ? error : new Error(String(error));
        
        // Update metadata with deployment error
        await updateProjectMetadata(context.projectId, {
          deployment: {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            failedAt: new Date().toISOString()
          }
        });
      }
    }
    
    logger.info('🎉 [runRequirementsChain] Chain execution finished successfully', {
      projectId: context.projectId,
      shouldDeploy: context.shouldDeploy,
      hasError: !!context.error,
      errorMessage: context.error instanceof Error ? context.error.message : undefined,
      hadGitHubSetup: !!context.githubOptions?.setupGitHub,
      githubSuccess: !!context.githubInfo && !context.githubError,
      deploymentSuccess: context.deploymentResult?.status === 'success'
    });
    
    return context;
  } catch (error) {
    // Handle unexpected errors
    logger.error('❌ [runRequirementsChain] Error in requirements chain:', error);
    
    if (context && context.projectId) {
      await updateProjectMetadata(context.projectId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    // Create a minimal context with error information
    return context || {
      content: '',
      projectId: '', 
      shouldDeploy: false,
      isNewProject: false,
      files: {},
      project: null, // Initialize to null for the error case
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

/**
 * Helper to update project metadata
 */
async function updateProjectMetadata(projectId: string, metadata: Record<string, any>): Promise<void> {
  try {
    const projectManager = getProjectStateManager();
    await projectManager.updateProject(projectId, { metadata });
  } catch (error) {
    logger.error('Failed to update project metadata', { 
      projectId, 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
}

/**
 * Enhance generated code with buildconfig.json and other metadata
 */
async function enhanceGeneratedCode(context: RequirementsContext): Promise<RequirementsContext> {
  if (!context.generatedFiles || Object.keys(context.generatedFiles).length === 0) {
    return context;
  }

  try {
    logger.info('🔍 Enhancing generated code with build configuration...');
    
    // Detect project type and framework
    const projectType = detectProjectType(context.generatedFiles);
    
    // Generate buildconfig.json
    const buildConfig = generateBuildConfig(projectType, context.generatedFiles);
    
    // Add buildconfig.json to generated files
    context.generatedFiles['buildconfig.json'] = JSON.stringify(buildConfig, null, 2);
    
    logger.info('✅ Added buildconfig.json to project files', { 
      projectType,
      buildCommands: buildConfig.commands
    });
    
    return context;
  } catch (error) {
    logger.error('❌ Error enhancing generated code:', error);
    // Don't fail the process for this non-critical enhancement
    return context;
  }
}

/**
 * Detect project type based on generated files
 */
function detectProjectType(files: Record<string, string>): string {
  const fileNames = Object.keys(files);
  
  if (fileNames.includes('package.json')) {
    const packageJson = JSON.parse(files['package.json']);
    
    if (packageJson.dependencies?.['react']) {
      if (packageJson.dependencies?.['next']) {
        return 'next';
      }
      return 'react';
    }
    
    if (packageJson.dependencies?.['vue']) {
      return 'vue';
    }
    
    if (packageJson.dependencies?.['svelte']) {
      return 'svelte';
    }
    
    if (packageJson.dependencies?.['express'] || packageJson.dependencies?.['koa']) {
      return 'node';
    }
    
    return 'javascript';
  }
  
  if (fileNames.some(file => file.endsWith('.py'))) {
    if (fileNames.includes('requirements.txt') && fileNames.some(file => file.includes('flask'))) {
      return 'flask';
    }
    if (fileNames.includes('requirements.txt') && fileNames.some(file => file.includes('django'))) {
      return 'django';
    }
    return 'python';
  }
  
  // Default fallback
  return 'generic';
}

/**
 * Generate build configuration based on project type
 */
function generateBuildConfig(projectType: string, files: Record<string, string>): any {
  const config: any = {
    projectType,
    commands: {
      install: '',
      build: '',
      start: ''
    },
    outputDirectory: '',
    framework: projectType
  };
  
  switch (projectType) {
    case 'next':
      config.commands.install = 'npm install';
      config.commands.build = 'npm run build';
      config.commands.start = 'npm start';
      config.outputDirectory = '.next';
      break;
    case 'react':
      config.commands.install = 'npm install';
      config.commands.build = 'npm run build';
      config.commands.start = 'npm start';
      config.outputDirectory = 'build';
      break;
    case 'vue':
      config.commands.install = 'npm install';
      config.commands.build = 'npm run build';
      config.commands.start = 'npm run serve';
      config.outputDirectory = 'dist';
      break;
    case 'svelte':
      config.commands.install = 'npm install';
      config.commands.build = 'npm run build';
      config.commands.start = 'npm start';
      config.outputDirectory = 'public';
      break;
    case 'node':
      config.commands.install = 'npm install';
      config.commands.build = 'npm run build';
      config.commands.start = 'npm start';
      config.outputDirectory = 'dist';
      break;
    case 'flask':
      config.commands.install = 'pip install -r requirements.txt';
      config.commands.start = 'python app.py';
      break;
    case 'django':
      config.commands.install = 'pip install -r requirements.txt';
      config.commands.start = 'python manage.py runserver';
      break;
    default:
      if (files['package.json']) {
        config.commands.install = 'npm install';
        config.commands.build = 'npm run build';
        config.commands.start = 'npm start';
        config.outputDirectory = 'dist';
      }
  }
  
  return config;
}

/**
 * Persist the project to storage
 */
async function persistProject(context: RequirementsContext): Promise<RequirementsContext> {
  if (!context.generatedFiles || Object.keys(context.generatedFiles).length === 0) {
    context.error = new Error('No files to persist');
    return context;
  }
  
  try {
    const projectManager = getProjectStateManager();
    
    // If this is a new project, we need to save all the files
    if (context.isNewProject) {
      logger.info(`Persisting new project with ${Object.keys(context.generatedFiles).length} files`);
      
      // Save the files to the project
      await projectManager.addFiles(context.projectId, context.generatedFiles);
      
      // Store files in a ZIP archive
      const archiveKey = await storeProjectArchive(context.projectId, context.generatedFiles, context);
      if (archiveKey) {
        context.archiveKey = archiveKey;
      }
    } else {
      // For existing projects, update files
      logger.info(`Updating existing project ${context.projectId} with ${Object.keys(context.generatedFiles).length} files`);
      
      // Save the files to the project
      await projectManager.addFiles(context.projectId, context.generatedFiles);
      
      // Store files in a ZIP archive
      const archiveKey = await storeProjectArchive(context.projectId, context.generatedFiles, context);
      if (archiveKey) {
        context.archiveKey = archiveKey;
      }
    }
    
    return context;
  } catch (error) {
    logger.error('Failed to persist project:', error);
    context.error = error instanceof Error ? error : new Error(String(error));
    return context;
  }
}

/**
 * Deploy code using the configured deployment service
 */
export async function deployCode(context: RequirementsContext): Promise<RequirementsContext> {
  if (!context.shouldDeploy || !context.projectId) {
    logger.info('⏭️ [deployCode] Deployment skipped - not requested or missing project ID');
    return context;
  }

  logger.info('🚀 [deployCode] Starting deployment process', {
    projectId: context.projectId,
    hasGitHubInfo: !!context.githubInfo,
    githubRepo: context.githubInfo?.fullName,
    deploymentTarget: context.deploymentTarget || 'auto-detect'
  });
  
  try {
    // Update metadata to show deployment in progress
    await updateProjectMetadata(context.projectId, {
      deployment: {
        status: 'in-progress',
        startedAt: new Date().toISOString()
      }
    });
    
    // Load project files if not already present
    let files = context.generatedFiles;
    if (!files || Object.keys(files).length === 0) {
      const projectManager = getProjectStateManager();
      const project = await projectManager.getProject(context.projectId);
      if (!project) {
        throw new Error(`Project ${context.projectId} not found`);
      }
      
      const projectFiles = await projectManager.getProjectFiles(context.projectId);
      if (!projectFiles || projectFiles.length === 0) {
        throw new Error(`No files found for project ${context.projectId}`);
      }
      
      // Convert files to the expected format
      files = projectFiles.reduce((map, file) => {
        if (!file.isDeleted) {
          map[file.path] = file.content;
        }
        return map;
      }, {} as Record<string, string>);
      
      logger.info('✅ [deployCode] Project files loaded', {
        fileCount: Object.keys(files).length
      });
    }
    
    // Import the DeploymentWorkflowService
    const { getDeploymentWorkflowService } = await import('~/lib/deployment/deployment-workflow');
    const deploymentService = getDeploymentWorkflowService();
    
    // Get credentials for deployment
    const credentialService = getCredentialService();
    const allCredentials = credentialService.getAllCredentials({
      env: context.env || {},
      requestData: context.deploymentOptions || {},
      tenantId: context.tenantId
    });
    
    logger.info('✅ [deployCode] Using DeploymentWorkflowService to deploy project', {
      targetName: context.deploymentTarget || 'auto-detect',
      hasNetlifyCreds: !!allCredentials.netlify?.apiToken,
      hasGithubCreds: !!allCredentials.github?.token,
      hasGithubInfo: !!context.githubInfo
    });
    
    // Deploy project using the workflow service
    const deploymentResult = await deploymentService.deployProject({
      projectId: context.projectId,
      projectName: context.name || 'Generated Project',
      files: files,
      targetName: context.deploymentTarget,
      credentials: allCredentials,
      // Pass GitHub info if available to avoid duplicate GitHub setup
      githubInfo: context.githubInfo,
      metadata: {
        tenantId: context.tenantId,
        source: 'requirements-middleware',
        // Include GitHub info in metadata for the deployment target
        github: context.githubInfo
      }
    });
    
    logger.info('✅ [deployCode] Deployment completed successfully', {
      result: deploymentResult,
      provider: deploymentResult.provider,
      url: deploymentResult.url
    });
    
    // Update project metadata with deployment result
    await updateProjectMetadata(context.projectId, {
      deployment: {
        status: deploymentResult.status,
        completedAt: new Date().toISOString(),
        url: deploymentResult.url,
        provider: deploymentResult.provider,
        logs: deploymentResult.logs
      }
    });
    
    // Update context with deployment result
    context.deploymentResult = deploymentResult;
    
    return context;
  } catch (error) {
    logger.error('❌ [deployCode] Deployment failed', { error });
    const deploymentError = error instanceof Error ? error : new Error(String(error));
    context.deploymentError = deploymentError;
    
    // Update metadata with failure information
    await updateProjectMetadata(context.projectId, {
      deployment: {
        status: 'failed',
        error: deploymentError.message,
        failedAt: new Date().toISOString()
      }
    });
    
    return context;
  }
}

/**
 * Setup GitHub repository for the project
 */
export async function setupGitHubRepository(context: RequirementsContext): Promise<RequirementsContext> {
  if (!context.githubOptions?.setupGitHub) {
    logger.info('⏭️ [setupGitHubRepository] GitHub setup skipped - not requested');
    return context;
  }

  logger.info('🚀 [setupGitHubRepository] Setting up GitHub repository', {
    projectId: context.projectId,
    hasGitHubOptionsCredentials: !!context.githubOptions?.credentials?.token,
    hasDirectCredentials: !!(context.credentials?.github?.token)
  });
  
  try {
    // First try direct credentials from github options
    let githubCredentials = context.githubOptions?.credentials;
    
    // If no direct credentials, try deployment credentials
    if (!githubCredentials?.token && context.credentials?.github?.token) {
      githubCredentials = {
        token: context.credentials.github.token,
        owner: context.credentials.github.owner
      };
    }
    
    // If neither direct nor deployment credentials, try credential service
    if (!githubCredentials?.token) {
      const credentialService = getCredentialService();
      const serviceCredentials = credentialService.getGitHubCredentials({
        env: context.env,
        requestData: context.deploymentOptions || {},
        tenantId: context.tenantId
      });
      
      if (serviceCredentials?.token) {
        githubCredentials = {
          token: serviceCredentials.token,
          owner: serviceCredentials.owner
        };
      }
    }
    
    if (!githubCredentials?.token) {
      throw new Error('GitHub credentials required but not provided');
    }
    
    logger.debug('🔐 [setupGitHubRepository] GitHub credentials found', {
      hasToken: !!githubCredentials.token,
      hasOwner: !!githubCredentials.owner,
      tokenLength: githubCredentials.token.length
    });
    
    // Update metadata to show GitHub setup in progress
    await updateProjectMetadata(context.projectId, {
      github: {
        status: 'in-progress'
      }
    });
    
    // Import GitHub integration service
    const { GitHubIntegrationService } = await import('~/lib/deployment/github-integration');
    const githubService = GitHubIntegrationService.getInstance();
    
    // Create repository with files
    const result = await githubService.setupRepository({
      token: githubCredentials.token,
      owner: githubCredentials.owner,
      projectId: context.projectId,
      projectName: context.name || 'Generated Project',
      files: context.generatedFiles || {},
      metadata: {
        source: 'requirements-chain',
        tenantId: context.tenantId
      }
    });
    
    if (!result.repositoryInfo) {
      throw new Error(result.error || 'Failed to set up GitHub repository');
    }
    
    // Add GitHub info to context
    context.githubInfo = result.repositoryInfo;
    
    logger.info('✅ [setupGitHubRepository] GitHub repository created successfully', {
      repoUrl: result.repositoryInfo.url,
      repoName: result.repositoryInfo.fullName
    });
    
    return context;
  } catch (error) {
    logger.error('❌ [setupGitHubRepository] GitHub repository setup failed', error);
    context.githubError = error instanceof Error ? error : new Error(String(error));
    
    // Update metadata with error information
    await updateProjectMetadata(context.projectId, {
      github: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        failedAt: new Date().toISOString()
      }
    });
    
    return context;
  }
}
