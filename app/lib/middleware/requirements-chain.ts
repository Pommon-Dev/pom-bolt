import { createScopedLogger } from '~/utils/logger';
import { handleProjectContext } from './project-context';
import type { ProjectRequestContext } from './project-context';
import { getDeploymentManager } from '~/lib/deployment';
import { getProjectStateManager } from '~/lib/projects';
import { CodegenService } from '~/lib/codegen/service';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { ZipPackager } from '~/lib/deployment/packagers/zip';
import { kvPut } from '~/lib/kv/binding';

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
    let body: any = {};
    const contentType = request.headers.get('content-type') || '';

    // Try multiple parsing strategies
    if (contentType.includes('application/json')) {
      try {
        // Try to parse as JSON
        body = await request.json();
        logger.debug('Successfully parsed JSON body', { 
          keys: Object.keys(body),
          hasContent: Boolean(body.content || body.requirements)
        });
      } catch (jsonError) {
        logger.error('Error parsing JSON body', jsonError);
        
        // Fallback to text parsing
        try {
          const textBody = await request.clone().text();
          logger.debug('Raw request body', {
            length: textBody.length,
            preview: textBody.substring(0, 100)
          });
          
          // Try to manually parse JSON
          try {
            body = JSON.parse(textBody);
            logger.debug('Manually parsed JSON body', {
              keys: Object.keys(body)
            });
          } catch (parseError) {
            logger.error('Failed to manually parse JSON', parseError);
          }
        } catch (textError) {
          logger.error('Failed to get text body', textError);
        }
      }
    } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      try {
        // Handle form data
        const formData = await request.formData();
        body = Object.fromEntries(formData.entries());
        logger.debug('Successfully parsed form data', {
          keys: Object.keys(body)
        });
      } catch (formError) {
        logger.error('Error parsing form data', formError);
      }
    } else {
      // Try text for unknown content types
      try {
        const textBody = await request.text();
        logger.debug('Raw text body for unknown content type', {
          length: textBody.length,
          preview: textBody.substring(0, 100)
        });
        
        // Try to parse as JSON if it looks like JSON
        if (textBody.trim().startsWith('{')) {
          try {
            body = JSON.parse(textBody);
            logger.debug('Parsed text as JSON', {
              keys: Object.keys(body)
            });
          } catch (parseError) {
            logger.error('Failed to parse text as JSON', parseError);
            // Fallback to treating the whole text as content
            body = { content: textBody };
          }
        } else {
          // Fallback to treating the whole text as content
          body = { content: textBody };
        }
      } catch (textError) {
        logger.error('Failed to get text body', textError);
      }
    }

    // Get the requirements content
    const content = body.content || body.requirements;
    
    if (!content || typeof content !== 'string') {
      logger.error('Requirements content missing or invalid', {
        contentType: typeof content,
        bodyKeys: Object.keys(body)
      });
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
      contentLength: content.length,
      shouldDeploy,
      deploymentTarget,
      hasOptions: Object.keys(deploymentOptions).length > 0
    });
    
    return {
      content,
      userId: body.userId,
      projectId: body.projectId || '',  // Will be set by project context middleware if empty
      isNewProject: body.projectId ? false : true, // Default assumption based on projectId presence
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
 * Load project context middleware
 */
export async function loadProjectContext(
  context: RequirementsContext,
  request: Request
): Promise<RequirementsContext> {
  // Skip if we already have project context
  if (context.project) return context;
  
  try {
    // Use the project context middleware to handle the request
    // This will set isNewProject, projectId, and project on the context
    const projectContext = await handleProjectContext(request);
    
    // Add the project context to the requirements context
    context.isNewProject = projectContext.isNewProject;
    context.projectId = projectContext.projectId;
    context.project = projectContext.project;
    
    // Extract Cloudflare environment if available
    if (request.cf && typeof request.cf === 'object') {
      context.env = { ...request.cf };
    } else if (request instanceof Request && 'context' in request && request.context) {
      // For Cloudflare Workers/Pages specific context
      const cloudflareContext = (request as any).context;
      if (cloudflareContext && cloudflareContext.cloudflare && cloudflareContext.cloudflare.env) {
        context.env = { ...cloudflareContext.cloudflare.env };
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
 * Process requirements and generate code/project
 */
export async function processRequirements(
  context: RequirementsContext,
  request: Request
): Promise<RequirementsContext> {
  if (!context.content || context.content.trim().length === 0) {
    throw new Error('Requirements content is required');
  }
  
  try {
    const projectManager = getProjectStateManager();
    
    // Get cookie headers for API keys and provider settings
    const cookieHeader = request.headers.get('Cookie');
    const apiKeys = getApiKeysFromCookie(cookieHeader);
    const providerSettings = getProviderSettingsFromCookie(cookieHeader);
    
    // Handle existing project or create a new one
    if (!context.isNewProject && context.projectId) {
      // Load existing project
      logger.info(`Loading existing project: ${context.projectId}`);
      context.project = await projectManager.getProject(context.projectId);
      
      if (!context.project) {
        throw new Error(`Project ${context.projectId} not found`);
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
      
      try {
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
        
        // Add/update files in the project
        logger.debug(`Adding/updating ${Object.keys(codegenResult.files).length} files to project`);
        
        // Create updatedFiles array for the updateProject method
        const now = Date.now();
        const updatedFiles = Object.entries(codegenResult.files).map(([path, content]) => ({
          path,
          content,
          createdAt: now,  // These will be overridden for existing files
          updatedAt: now
        }));
        
        // Update the project with new files
        await projectManager.updateProject(context.projectId, {
          updatedFiles
        });
        
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
            const cloudflareConfig = context.env && 
              typeof context.env.CLOUDFLARE_ACCOUNT_ID === 'string' && 
              typeof context.env.CLOUDFLARE_API_TOKEN === 'string' 
                ? {
                    accountId: context.env.CLOUDFLARE_ACCOUNT_ID,
                    apiToken: context.env.CLOUDFLARE_API_TOKEN
                  } 
                : undefined;
            
            // Log environment details for debugging
            logger.debug('Environment variables for deployment:', {
              hasEnv: Boolean(context.env),
              hasAccountId: context.env ? typeof context.env.CLOUDFLARE_ACCOUNT_ID === 'string' : false,
              hasApiToken: context.env ? typeof context.env.CLOUDFLARE_API_TOKEN === 'string' : false,
              cloudflareConfigPresent: Boolean(cloudflareConfig)
            });
            
            const deploymentManager = getDeploymentManager({
              cloudflareConfig
            });
            
            // Log available targets
            const availableTargets = await deploymentManager.getAvailableTargets();
            logger.debug('Available deployment targets:', { targets: availableTargets });
            
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
            
            // Save deployment information
            await projectManager.updateProject(context.projectId, {
              metadata: {
                lastDeployment: deploymentEntry
              }
            });
            
            context.deploymentResult = {
              url: deployment.url,
              id: deployment.id,
              status: deployment.status
            };
            
            logger.info(`Project deployed to ${deployment.url}`);
          } catch (deployError) {
            logger.error('Deployment failed:', deployError);
            context.error = deployError instanceof Error ? deployError : new Error(String(deployError));
          }
        }
      } catch (codegenError) {
        logger.error('Code generation failed for existing project:', codegenError);
        context.error = codegenError instanceof Error ? codegenError : new Error(String(codegenError));
      }
    } else {
      // Handle new project creation
      const projectName = generateProjectName(context.content);
      logger.info(`Creating new project: ${projectName}`);
      
      try {
        // Create a new project
        const newProject = await projectManager.createProject({
          name: projectName,
          initialRequirements: context.content.substring(0, 1000),
          userId: context.userId,
          metadata: {
            createdFrom: 'requirements'
          }
        });
        
        context.project = newProject;
        context.projectId = newProject.id;
        
        // Generate code using the CodegenService
        logger.info('Generating code from requirements for new project');
        
        try {
          const codegenResult = await CodegenService.generateCode({
            requirements: context.content,
            projectId: newProject.id,
            isNewProject: true,
            userId: context.userId,
            serverEnv: context.env,
            apiKeys,
            providerSettings
          });
          
          // Add files to the project
          logger.debug(`Adding ${Object.keys(codegenResult.files).length} files to new project`);
          
          // Create updatedFiles array for the updateProject method
          const now = Date.now();
          const updatedFiles = Object.entries(codegenResult.files).map(([path, content]) => ({
            path,
            content,
            createdAt: now,
            updatedAt: now
          }));
          
          // Update the project with new files
          await projectManager.updateProject(newProject.id, {
            updatedFiles
          });
          
          context.files = codegenResult.files;
          
          // Store project archive if environment context is available
          if (context.env) {
            const archiveKey = await storeProjectArchive(newProject.id, codegenResult.files, context);
            if (archiveKey) {
              context.archiveKey = archiveKey;
              logger.info(`Project archive stored with key: ${archiveKey}`);
            }
          }
          
          // Handle deployment if requested
          if (context.shouldDeploy) {
            logger.info('Deploying new project');
            
            try {
              const cloudflareConfig = context.env && 
                typeof context.env.CLOUDFLARE_ACCOUNT_ID === 'string' && 
                typeof context.env.CLOUDFLARE_API_TOKEN === 'string' 
                  ? {
                      accountId: context.env.CLOUDFLARE_ACCOUNT_ID,
                      apiToken: context.env.CLOUDFLARE_API_TOKEN
                    } 
                  : undefined;
              
              // Log environment details for debugging
              logger.debug('Environment variables for new project deployment:', {
                hasEnv: Boolean(context.env),
                hasAccountId: context.env ? typeof context.env.CLOUDFLARE_ACCOUNT_ID === 'string' : false,
                hasApiToken: context.env ? typeof context.env.CLOUDFLARE_API_TOKEN === 'string' : false,
                cloudflareConfigPresent: Boolean(cloudflareConfig)
              });
              
              const deploymentManager = getDeploymentManager({
                cloudflareConfig
              });
              
              // Log available targets
              const availableTargets = await deploymentManager.getAvailableTargets();
              logger.debug('Available deployment targets for new project:', { targets: availableTargets });
              
              const deployment = await deploymentManager.deployWithBestTarget({
                projectName: newProject.name,
                files: codegenResult.files,
                projectId: newProject.id,
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
              
              // Save deployment information
              await projectManager.updateProject(newProject.id, {
                metadata: {
                  lastDeployment: deploymentEntry
                }
              });
              
              context.deploymentResult = {
                url: deployment.url,
                id: deployment.id,
                status: deployment.status
              };
              
              logger.info(`Project deployed to ${deployment.url}`);
            } catch (deployError) {
              logger.error('Deployment failed:', deployError);
              context.error = deployError instanceof Error ? deployError : new Error(String(deployError));
            }
          }
        } catch (codegenError) {
          logger.error('Code generation failed for new project:', codegenError);
          
          // Fall back to sample project if code generation fails
          logger.info('Falling back to sample project');
          context.error = codegenError instanceof Error ? codegenError : new Error(String(codegenError));
          
          // Add a sample file with error information
          const now = Date.now();
          await projectManager.updateProject(newProject.id, {
            updatedFiles: [{
              path: 'README.md',
              content: `# ${projectName}\n\nThis project was created from the following requirements:\n\n${context.content}\n\nCode generation failed with error: ${context.error.message}`,
              createdAt: now,
              updatedAt: now
            }]
          });
        }
      } catch (projectError) {
        logger.error('Project creation failed:', projectError);
        context.error = projectError instanceof Error ? projectError : new Error(String(projectError));
      }
    }
    
    return context;
  } catch (error) {
    logger.error('Error processing requirements:', error);
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
  request: Request
): Promise<RequirementsContext> {
  logger.debug('Running requirements chain');
  
  try {
    // Parse the request to extract requirements and metadata
    let context = await parseRequest(null, request);
    
    if (!context) {
      throw new Error('Failed to parse request');
    }
    
    // Load project context
    context = await loadProjectContext(context, request);
    
    // Process requirements and generate code/project
    context = await processRequirements(context, request);
    
    logger.debug('Requirements chain completed successfully', {
      projectId: context.projectId,
      hasFiles: context.files ? Object.keys(context.files).length : 0,
      hasDeployment: Boolean(context.deploymentResult)
    });
    
    return context;
  } catch (error) {
    logger.error('Requirements chain failed:', error);
    
    // Return error context
    return {
      content: '',
      shouldDeploy: false,
      error: error instanceof Error ? error : new Error(String(error)),
      projectId: '',
      isNewProject: false
    };
  }
}
