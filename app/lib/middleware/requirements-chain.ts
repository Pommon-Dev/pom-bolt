import { v4 as uuidv4 } from 'uuid';
import { CodegenService } from '~/lib/codegen/service';
import { getDeploymentManager } from '~/lib/deployment';
import { createScopedLogger } from '~/utils/logger';
import { NetlifyTarget } from '~/lib/deployment/targets/netlify';
import { DeploymentManager } from '~/lib/deployment/deployment-manager';
import { ZipPackager } from '~/lib/deployment/packagers/zip';
import { kvPut } from '~/lib/kv/binding';
import { ProjectStateManager } from '~/lib/projects/state-manager';
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
  archiveKey?: string; // Key for the stored ZIP archive
  error?: Error;
  env?: Record<string, any>; // Cloudflare environment
  additionalRequirement?: boolean; // Flag to indicate this is a feature request for existing project
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
            hasNetlifyCredentials: !!body.netlifyCredentials
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
    
    logger.info('[parseRequest] Deployment flags in request:', {
      shouldDeploy,
      bodyHasShouldDeploy: !!body.shouldDeploy,
      bodyHasDeploy: !!body.deploy,
      bodyHasDeployment: !!body.deployment, 
      bodyHasDeployTarget: !!body.deployTarget,
      deploymentTarget: body.deploymentTarget || body.deployTarget || 'none'
    });
    
    // Extract deployment settings if present
    const deploymentTarget = 
      typeof body.deploymentTarget === 'string' ? body.deploymentTarget : 
      typeof body.deployment?.platform === 'string' ? body.deployment.platform :
      undefined;
    
    const deploymentOptions = 
      typeof body.deploymentOptions === 'object' ? body.deploymentOptions :
      typeof body.deployment?.settings === 'object' ? body.deployment.settings :
      {};

    // Extract additionalRequirement flag
    const additionalRequirement = Boolean(body.additionalRequirement);
    
    logger.debug('Parsed requirements request', { 
      contentLength: content.length,
      shouldDeploy,
      deploymentTarget,
      hasOptions: Object.keys(deploymentOptions).length > 0,
      additionalRequirement
    });
    
    return {
      content,
      userId: body.userId,
      projectId: body.projectId || '',  // Will be set by project context middleware if empty
      isNewProject: body.projectId ? false : true, // Default assumption based on projectId presence
      shouldDeploy,
      deploymentTarget,
      deploymentOptions,
      additionalRequirement
    };
  } catch (error) {
    logger.error('Failed to parse requirements request:', error);
    throw error;
  }
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
      additionalRequirement: context.additionalRequirement
    });

    // If this is an additionalRequirement and we have a projectId, ensure isNewProject is false
    if (context.additionalRequirement && context.projectId) {
      context.isNewProject = false;
      logger.info(`Processing additional requirement for existing project: ${context.projectId}`);
    }
    
    // Use the project context middleware to handle the request
    // This will set isNewProject, projectId, and project on the context
    // Pass the already parsed body to avoid re-parsing the request
    const parsedBody = {
      projectId: context.projectId,
      content: context.content,
      userId: context.userId
    };
    const projectContext = await handleProjectContext(request, {}, parsedBody);
    
    // Add the project context to the requirements context
    context.isNewProject = context.additionalRequirement ? false : projectContext.isNewProject;
    context.projectId = projectContext.projectId;
    
    // Handle project state with proper type safety
    if (projectContext.project) {
      context.project = projectContext.project;
    }
    
    // Double check project existence when additionalRequirement is true
    if (context.additionalRequirement && context.projectId) {
      const projectManager = getProjectStateManager();
      const exists = await projectManager.projectExists(context.projectId);
      
      if (!exists) {
        logger.warn(`Project ${context.projectId} not found despite additionalRequirement flag being set`);
        throw new Error(`Project ${context.projectId} not found. Cannot add features to non-existent project.`);
      }
      
      if (!context.project) {
        const project = await projectManager.getProject(context.projectId);
        if (project) {
          context.project = project;
        } else {
          logger.warn(`Failed to load project ${context.projectId}, but will continue processing`);
        }
      }
      
      logger.info(`Confirmed project ${context.projectId} exists for feature request`);
    }
    
    // Combine environment information
    if (!context.env) {
      context.env = {};
    }
    
    // Extract Cloudflare environment if available from request
    if (request.cf && typeof request.cf === 'object') {
      Object.assign(context.env, request.cf);
    } else if (request instanceof Request && 'context' in request && (request as any).context) {
      // For Cloudflare Workers/Pages specific context
      const cloudflareContext = (request as any).context;
      if (cloudflareContext && cloudflareContext.cloudflare && cloudflareContext.cloudflare.env) {
        Object.assign(context.env, cloudflareContext.cloudflare.env);
      }
    }
    
    logger.debug(`Project context loaded: ${context.projectId} (isNew: ${context.isNewProject})`);
    return context;
  } catch (error) {
    logger.error('Failed to load project context:', error);
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
  // Get Cloudflare credentials if available
  const cloudflareConfig = context.env && 
    typeof context.env.CLOUDFLARE_ACCOUNT_ID === 'string' && 
    typeof context.env.CLOUDFLARE_API_TOKEN === 'string' 
      ? {
          accountId: context.env.CLOUDFLARE_ACCOUNT_ID,
          apiToken: context.env.CLOUDFLARE_API_TOKEN
        } 
      : undefined;
  
  // Handle Netlify credentials from request body or environment
  let netlifyToken: string | undefined = undefined;
  
  // First check if credentials are provided in the deployment options (highest priority)
  if (context.deploymentOptions?.netlifyCredentials?.apiToken) {
    netlifyToken = context.deploymentOptions.netlifyCredentials.apiToken;
    logger.info('Found Netlify credentials in request body deploymentOptions.netlifyCredentials');
  }
  // Then check if direct netlifyToken is provided in deployment options
  else if (context.deploymentOptions?.netlifyToken) {
    netlifyToken = context.deploymentOptions.netlifyToken;
    logger.info('Found Netlify credentials in request body deploymentOptions.netlifyToken');
  } 
  // Finally check environment variables - check both possible env var names
  else if (context.env) {
    if (typeof context.env.NETLIFY_AUTH_TOKEN === 'string') {
      netlifyToken = context.env.NETLIFY_AUTH_TOKEN;
      logger.info('Found Netlify credentials in environment (NETLIFY_AUTH_TOKEN)');
    } else if (typeof context.env.NETLIFY_API_TOKEN === 'string') {
      netlifyToken = context.env.NETLIFY_API_TOKEN;
      logger.info('Found Netlify credentials in environment (NETLIFY_API_TOKEN)');
    }
  }
  
  // Similarly handle GitHub credentials
  let githubToken: string | undefined = undefined;
  let githubOwner: string | undefined = undefined;
  
  // First check if credentials are provided in the deployment options
  if (context.deploymentOptions?.githubCredentials?.token) {
    githubToken = context.deploymentOptions.githubCredentials.token;
    githubOwner = context.deploymentOptions.githubCredentials.owner;
    logger.info('Found GitHub credentials in request body', { hasOwner: !!githubOwner });
  }
  // Then check environment variables
  else if (context.env) {
    if (typeof context.env.GITHUB_TOKEN === 'string') {
      githubToken = context.env.GITHUB_TOKEN;
      logger.info('Found GitHub token in environment (GITHUB_TOKEN)');
    }
    
    if (typeof context.env.GITHUB_OWNER === 'string') {
      githubOwner = context.env.GITHUB_OWNER;
      logger.info('Found GitHub owner in environment (GITHUB_OWNER)');
    }
  }
  
  // Log environment details for debugging
  logger.debug('Environment variables for deployment:', {
    hasEnv: Boolean(context.env),
    hasAccountId: context.env ? typeof context.env.CLOUDFLARE_ACCOUNT_ID === 'string' : false,
    hasApiToken: context.env ? typeof context.env.CLOUDFLARE_API_TOKEN === 'string' : false,
    hasNetlifyToken: !!netlifyToken,
    cloudflareConfigPresent: Boolean(cloudflareConfig),
    netlifyTokenSource: netlifyToken 
      ? (context.deploymentOptions?.netlifyCredentials ? 'deploymentOptions.netlifyCredentials' : 
         context.deploymentOptions?.netlifyToken ? 'deploymentOptions.netlifyToken' : 'environment') 
      : 'none'
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
        const netlifyTarget = new NetlifyTarget({ apiToken: netlifyToken });
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
  if (!context.content || context.content.trim().length === 0) {
    throw new Error('Requirements content is required');
  }
  
  logger.info('🔍 [processRequirements] Starting with context:', { 
    projectId: context.projectId || 'new-project',
    isNewProject: context.isNewProject,
    contentLength: context.content.length,
    shouldDeploy: context.shouldDeploy,
    deploymentTarget: context.deploymentTarget,
    hasDeploymentOptions: !!context.deploymentOptions
  });
  
  try {
    const projectManager = getProjectStateManager();
    logger.debug('🔧 [processRequirements] Got project state manager');
    
    // Get cookie headers for API keys and provider settings
    const cookieHeader = request.headers.get('Cookie');
    const apiKeys = getApiKeysFromCookie(cookieHeader);
    const providerSettings = getProviderSettingsFromCookie(cookieHeader);
    
    logger.debug('🔑 [processRequirements] Extracted API keys and provider settings:', {
      hasApiKeys: Object.keys(apiKeys || {}).length > 0,
      hasProviderSettings: Object.keys(providerSettings || {}).length > 0
    });
    
    // Handle existing project or create a new one
    if (!context.isNewProject && context.projectId) {
      // Log existing project code path
      logger.info('🔄 [processRequirements] Processing EXISTING project path:', { projectId: context.projectId });
      
      // Load existing project
      logger.info(`Loading existing project: ${context.projectId}`);
      context.project = await projectManager.getProject(context.projectId);
      
      if (!context.project) {
        throw new Error(`Project ${context.projectId} not found`);
      }
      
      // Add requirements to the project if this is an additional requirement
      if (context.additionalRequirement) {
        logger.info(`Adding new requirements entry to project ${context.projectId}`);
        await projectManager.addRequirements(
          context.projectId,
          context.content,
          context.userId
        );
      }
      
      // Get existing files
      logger.debug('Loading existing project files');
      const existingFiles = await projectManager.getProject(context.projectId)
        .then(project => project.files || [])
        .then(files => files.filter(f => !f.isDeleted))
        .then(files => {
          const fileMap: Record<string, string> = {};
          for (const file of files) {
            fileMap[file.path] = file.content;
          }
          return fileMap;
        });
      
      // Generate code using the CodegenService
      logger.info('Generating code from requirements for existing project');
      
      const codegenResult = await CodegenService.generateCode({
        requirements: context.content,
        existingFiles,
        projectId: context.projectId,
        isNewProject: false,
        userId: context.userId,
        serverEnv: context.env,
        apiKeys,
        providerSettings
      });
      
      // Update files in project
      await projectManager.updateProject(context.projectId, {
        updatedFiles: Object.entries(codegenResult.files).map(([path, content]) => ({
          path,
          content,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }))
      });
      
      // Add requirements to project history
      if (!context.additionalRequirement) {
        // Only add to history if not already added as additionalRequirement
        await projectManager.addRequirements(
          context.projectId,
          context.content,
          context.userId
        );
      }
      
      // Set generated files in context
      context.files = codegenResult.files;
      
      // Store project archive if environment context is available
      if (context.env) {
        const archiveKey = await storeProjectArchive(context.projectId, codegenResult.files, context);
        if (archiveKey) {
          context.archiveKey = archiveKey;
          logger.info(`Project archive stored with key: ${archiveKey}`);
        }
      }
      
      // Handle deployment if requested
      if (context.shouldDeploy) {
        logger.info('Deploying updated project');
        
        try {
          const { deploymentManager, availableTargets } = await configureDeploymentManager(context);
          
          const deployment = await deploymentManager.deployWithBestTarget({
            projectName: context.project.name,
            files: codegenResult.files,
            projectId: context.projectId,
            targetName: context.deploymentTarget,
            metadata: context.deploymentOptions
          });
          
          // Create a deployment entry
          const deploymentEntry = {
            id: deployment.id,
            url: deployment.url,
            provider: deployment.provider,
            timestamp: Date.now(),
            status: deployment.status
          };
          
          // Save the deployment to the project
          await projectManager.addDeployment(context.projectId, deploymentEntry);
          
          // Set deployment result in context
          context.deploymentResult = {
            id: deployment.id,
            url: deployment.url,
            status: deployment.status
          };
          
          logger.info(`Deployment successful: ${deployment.provider} - ${deployment.url}`);
        } catch (deployError) {
          logger.error('Deployment failed:', deployError);
          throw deployError;
        }
      }
      
      return context;
    } else {
      // Log new project code path
      logger.info('🆕 [processRequirements] Processing NEW project path');
      
      // Generate code for a new project
      logger.info('💻 [processRequirements] Generating code for new project');
      
      // Enhanced logging for CodegenService input
      logger.debug('📥 [processRequirements] CodegenService input parameters:', {
        requirementsLength: context.content.length,
        projectId: 'new-project-' + Date.now(),
        isNewProject: true,
        userId: context.userId || 'anonymous',
        hasServerEnv: !!context.env,
        hasApiKeys: Object.keys(apiKeys || {}).length > 0
      });
      
      const codegenResult = await CodegenService.generateCode({
        requirements: context.content,
        projectId: 'new-project-' + Date.now(),
        isNewProject: true,
        userId: context.userId,
        serverEnv: context.env,
        apiKeys,
        providerSettings
      });
      
      // Enhanced logging for CodegenService results
      logger.info('📤 [processRequirements] Code generation completed:', {
        filesGenerated: Object.keys(codegenResult.files).length,
        modelUsed: codegenResult.metadata?.model || 'unknown',
        provider: codegenResult.metadata?.provider || 'unknown'
      });
      
      // Create a new project
      const projectName = codegenResult.metadata?.name || 'Untitled Project';
      logger.info('📝 [processRequirements] Creating new project entry', { projectName });
      
      // Log the createProject request
      logger.debug('📋 [processRequirements] createProject parameters:', {
        name: projectName,
        requirementsLength: context.content.length,
        userId: context.userId || 'anonymous',
        hasMetadata: !!codegenResult.metadata
      });
      
      const newProject = await projectManager.createProject({
        name: projectName,
        initialRequirements: context.content,
        userId: context.userId,
        metadata: {
          ...codegenResult.metadata,
          requestId: uuidv4(),
          isArchived: false,
        }
      });
      
      // Add files to the project
      logger.info('[processRequirements] Adding files to new project', { projectId: newProject.id });
      await projectManager.addFiles(newProject.id, codegenResult.files);
      
      // Update context with new project
      context.projectId = newProject.id;
      context.project = newProject;
      context.files = codegenResult.files;
      
      // Add separate direct reference to ensure the basic project data is stored with just the ID
      // This ensures deploy endpoints can find it later
      try {
        logger.info('[processRequirements] Storing direct project reference', { projectId: newProject.id });
        // Force-save just the basic project data again to ensure it's stored with just the ID
        await projectManager.updateProject(newProject.id, {
          metadata: {
            isDirectReference: true,
            timestamp: Date.now()
          }
        });
        logger.info(`[processRequirements] Successfully stored direct project reference for ID: ${newProject.id}`);
      } catch (directRefError) {
        logger.error(`[processRequirements] Failed to store direct project reference: ${directRefError}`);
      }
        
      // Store project archive if environment context is available
      if (context.env) {
       logger.info('[processRequirements] Storing project archive', { projectId: newProject.id });
       const archiveKey = await storeProjectArchive(newProject.id, codegenResult.files, context);
        if (archiveKey) {
          context.archiveKey = archiveKey;
          logger.info(`[processRequirements] Project archive stored with key: ${archiveKey}`);
        }
      }
        
      // After project creation, add more logging
      logger.info('🎉 [processRequirements] Project creation successful:', {
        projectId: newProject?.id,
        projectName: newProject?.name,
        createdAt: newProject?.createdAt || Date.now()
      });
      
      return context;
    }
  } catch (error) {
    logger.error('❌ [processRequirements] Failed with error:', error);
    // Include more detailed error information
    if (error instanceof Error) {
      logger.error('  - Error name: ' + error.name);
      logger.error('  - Error message: ' + error.message);
      logger.error('  - Error stack: ' + error.stack);
    }
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
 * Run the complete requirements processing chain
 * This is the main entry point for processing requirements
 */
export async function runRequirementsChain(
  request: Request,
  cloudflareContext?: any
): Promise<RequirementsContext> {
  try {
    // Create initial context from request
    let context = await parseRequest(null, request);
    
    // Log setup information
    logger.info('🏁 [runRequirementsChain] Starting requirements chain', { 
      requestUrl: request.url,
      method: request.method,
      hasContent: !!context?.content,
      shouldDeploy: !!context?.shouldDeploy,
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
    
    // Load project context if needed
    context = await loadProjectContext(context, request);
    
    // Process requirements and generate code/project
    logger.info('⚙️ [runRequirementsChain] Calling processRequirements...');
    context = await processRequirements(context, request);
    logger.info('✅ [runRequirementsChain] Returned from processRequirements', { 
      projectId: context.projectId, 
      filesGenerated: Object.keys(context.files || {}).length, 
      archiveKey: context.archiveKey || 'not-set'
    });
    
    // Call the deployCode function if deployment is requested
    if (context.shouldDeploy) {
      logger.info('⏩ [runRequirementsChain] Calling deployCode function');
      try {
        context = await deployCode(context);
      } catch (deployError) {
        logger.error('❌ [runRequirementsChain] Error in deployCode function:', deployError);
        // Ensure context exists and add error to it
        if (!context.error) {
          context.error = deployError instanceof Error ? deployError : new Error(String(deployError));
        }
      }
      logger.info('🏁 [runRequirementsChain] Returned from deployCode', { 
        hasError: !!context.error,
        hasDeploymentResult: !!context.deploymentResult,
        errorMessage: context.error instanceof Error ? context.error.message : undefined
      });
    }
    
    logger.info('🎉 [runRequirementsChain] Chain execution finished successfully', {
      projectId: context.projectId,
      shouldDeploy: context.shouldDeploy,
      hasError: !!context.error,
      errorMessage: context.error instanceof Error ? context.error.message : undefined
    });
    
    return context;
  } catch (error) {
    logger.error('❌ [runRequirementsChain] Error in requirements chain:', error);
    
    // Create a minimal context with error information
    const errorContext: RequirementsContext = {
      content: '',
      projectId: '', // Add required projectId field
      shouldDeploy: false,
      isNewProject: false,
      files: {},
      error: error instanceof Error ? error : new Error(String(error))
    };
    return errorContext;
  }
}

/**
 * Deploy code to the selected target or best available one
 */
export async function deployCode(context: RequirementsContext): Promise<RequirementsContext> {
  logger.info('🚀 [deployCode] Starting deployment process', {
    projectId: context.projectId,
    shouldDeploy: context.shouldDeploy,
    requestedTarget: context.deploymentTarget,
    hasEnv: !!context.env,
    envKeys: context.env ? Object.keys(context.env).filter(key => 
      !key.includes('KEY') && !key.includes('TOKEN')).join(',') : 'none'
  });
  
  // Skip deployment if not requested
  if (!context.shouldDeploy) {
    logger.info('[deployCode] Deployment not requested, skipping');
    return context;
  }
  
  try {
    // Get deployment options from context
    const env = context.env || {};
    const deploymentOptions = context.deploymentOptions || {};
    
    logger.debug('🔍 [deployCode] Deployment options:', {
      hasDeploymentOptions: Object.keys(deploymentOptions).length > 0,
      requestedTarget: context.deploymentTarget,
      netlifyCredentials: !!deploymentOptions.netlifyCredentials,
      githubCredentials: !!deploymentOptions.githubCredentials,
      setupGitHub: !!deploymentOptions.setupGitHub,
      hasOpenAIKey: !!env.OPENAI_API_KEY,
      hasGithubToken: !!env.GITHUB_TOKEN,
      hasNetlifyToken: !!(env.NETLIFY_API_TOKEN || env.NETLIFY_AUTH_TOKEN)
    });
    
    // Load project files
    const manager = getProjectStateManager();
    const project = await manager.getProject(context.projectId);
    if (!project) {
      logger.error(`❌ [deployCode] Project ${context.projectId} not found`);
      throw new Error(`Project ${context.projectId} not found`);
    }
    
    const projectFiles = await manager.getProjectFiles(context.projectId);
    if (!projectFiles || projectFiles.length === 0) {
      logger.error(`❌ [deployCode] No files found for project ${context.projectId}`);
      throw new Error(`No files found for project ${context.projectId}`);
    }
    
    // Map project files to DeploymentFiles format
    const files = projectFiles.reduce((map, file) => {
      if (!file.isDeleted) {
        map[file.path] = file.content;
      }
      return map;
    }, {} as Record<string, string>);
    
    logger.info('✅ [deployCode] Project files loaded', { 
      fileCount: Object.keys(files).length 
    });
    
    // Import the DeploymentWorkflowService
    const { getDeploymentWorkflowService } = await import('~/lib/deployment/deployment-workflow');
    const deploymentWorkflowService = getDeploymentWorkflowService();
    
    // Configure credentials
    const credentials: Record<string, any> = {};
    const netlifyCredentials = getNetlifyCredentials({ env });
    
    logger.debug('[deployCode] Deployment credentials check:', { 
      netlify: {
        hasApiToken: !!netlifyCredentials.apiToken,
        tokenLength: netlifyCredentials.apiToken ? netlifyCredentials.apiToken.length : 0
      },
      deploymentOptions: {
        hasNetlifyCreds: !!deploymentOptions.netlifyCredentials,
        hasNetlifyApiToken: !!deploymentOptions.netlifyCredentials?.apiToken,
        hasGithubCreds: !!deploymentOptions.githubCredentials,
        hasGithubToken: !!deploymentOptions.githubCredentials?.token,
        hasGithubOwner: !!deploymentOptions.githubCredentials?.owner,
        setupGitHub: !!deploymentOptions.setupGitHub
      },
      targetRequested: context.deploymentTarget
    });
    
    if (netlifyCredentials.apiToken) {
      logger.debug('[deployCode] Using Netlify credentials from environment');
      credentials.netlify = {
        apiToken: netlifyCredentials.apiToken
      };
    } else if (deploymentOptions.netlifyCredentials) {
      logger.debug('[deployCode] Using Netlify credentials from request');
      credentials.netlify = deploymentOptions.netlifyCredentials;
    }
    
    // Cloudflare credentials
    const cfCreds = getCloudflareCredentials({ env });
    if (cfCreds.accountId && cfCreds.apiToken) {
      logger.debug('[deployCode] Using Cloudflare credentials from environment');
      credentials.cloudflare = cfCreds;
    } else if (deploymentOptions.cfCredentials) {
      logger.debug('[deployCode] Using Cloudflare credentials from request');
      credentials.cloudflare = deploymentOptions.cfCredentials;
    }
    
    // GitHub credentials
    const githubCredentials = getGitHubCredentials({ env });
    if (githubCredentials.token) {
      logger.debug('[deployCode] Using GitHub credentials from environment');
      credentials.github = githubCredentials;
    } else if (deploymentOptions.githubCredentials) {
      logger.debug('[deployCode] Using GitHub credentials from request');
      credentials.github = deploymentOptions.githubCredentials;
    }
    
    // Determine if we should set up GitHub based on options or target
    const setupGitHub = deploymentOptions.setupGitHub || 
                        context.deploymentTarget === 'netlify-github';
    
    // Check if we have the required credentials for the target
    if (context.deploymentTarget === 'netlify-github') {
      if (!credentials.github || !credentials.github.token) {
        logger.error('❌ [deployCode] GitHub credentials required for netlify-github deployment but not provided');
        throw new Error('GitHub credentials are required for netlify-github deployment');
      }
      
      if (!credentials.netlify || !credentials.netlify.apiToken) {
        logger.error('❌ [deployCode] Netlify credentials required for netlify-github deployment but not provided');
        throw new Error('Netlify credentials are required for netlify-github deployment');
      }
    } else if (context.deploymentTarget === 'netlify') {
      if (!credentials.netlify || !credentials.netlify.apiToken) {
        logger.error('❌ [deployCode] Netlify credentials required for netlify deployment but not provided');
        throw new Error('Netlify credentials are required for netlify deployment');
      }
    } else if (context.deploymentTarget === 'cloudflare') {
      if (!credentials.cloudflare || !credentials.cloudflare.apiToken) {
        logger.error('❌ [deployCode] Cloudflare credentials required for cloudflare deployment but not provided');
        throw new Error('Cloudflare credentials are required for cloudflare deployment');
      }
    }
    
    logger.info('✅ [deployCode] Using DeploymentWorkflowService to deploy project', {
      projectId: context.projectId,
      target: context.deploymentTarget,
      setupGitHub,
      hasNetlifyCreds: !!credentials.netlify?.apiToken,
      hasGithubCreds: !!credentials.github?.token,
      hasCfCreds: !!(credentials.cloudflare?.accountId && credentials.cloudflare?.apiToken)
    });
    
    // Deploy the project using the workflow service
    const deployment = await deploymentWorkflowService.deployProject({
      projectId: context.projectId,
      projectName: project.name || 'Generated Project',
      files: files,
      targetName: context.deploymentTarget,
      setupGitHub,
      credentials,
      metadata: {
        ...deploymentOptions,
        environment: env
      }
    });
    
    // Update context with deployment result
    logger.info('🎉 [deployCode] Deployment completed successfully', {
      deploymentId: deployment.id,
      url: deployment.url,
      status: deployment.status,
      provider: deployment.provider
    });
    
    context.deploymentResult = {
      id: deployment.id,
      url: deployment.url,
      status: deployment.status
    };
    
    return context;
  } catch (error) {
    logger.error('❌ [deployCode] Error during deployment process:', error);
    
    // Add error to context but don't throw it so the rest of the chain can continue
    if (!context.error) {
      context.error = error instanceof Error ? error : new Error(String(error));
    }
    
    return context;
  }
}
