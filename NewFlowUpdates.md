# Modular Flow Updates for Requirements to Deployment

## Original Discussion and Analysis

### Problem Statement

The current flow has GitHub integration tightly coupled with deployment targets like `netlify-github`. This creates several issues:

1. GitHub credentials aren't being properly passed through the workflow
2. There's confusion between GitHub as a source control and GitHub as part of deployment
3. Error handling doesn't properly communicate which step failed

### Proposed Enhanced Flow

The proposed new flow is:
1. API requirements → 
2. Code generation (with buildconfig.json) → 
3. Persist project metadata → 
4. Create GitHub repo and upload code → 
5. Deployment flow (optional)

This creates a cleaner separation of concerns with GitHub integration completely independent from deployment.

## Original Implementation Plan

### Phase 1: Middleware Refactoring
- Split into clear phases with each function handling a specific responsibility
- Add configuration flags for each phase
- Enhance the code generation to produce buildconfig.json

### Phase 2: GitHub Integration
- Create dedicated middleware for GitHub repository setup
- Handle all GitHub operations independently of deployment

### Phase 3: Deployment Updates
- Modify Netlify target to optionally use GitHub info
- Remove netlify-github target
- Update deployment orchestrator

### Phase 4: API and Documentation
- Update API schema
- Document the new flow
- Create examples

## Client Feedback on Implementation Plan

### Additional Requirements

1. Update metadata after each phase. As long as we keep moving forward, failure in any phase can be a status update for that phase, and we wrap up with a final response.
2. Maintain status quo on error reporting granularity. Just separate the status and errors for GitHub flow from deployment status/errors. Flow continues if non-critical failures occur.
3. No backward compatibility is needed as we're still in beta testing.
4. Performance considerations can be addressed later.

## Refined Implementation Plan

### Phase 1: Middleware Refactoring

**Key Changes:**
- Split requirements chain into distinct phases with clear responsibilities
- Update metadata after each phase
- Continue flow even after non-critical failures
- Add buildconfig.json generation

**Implementation Details:**
```typescript
// Requirements chain with metadata updates after each phase
export async function runRequirementsChain(request: Request): Promise<RequirementsContext> {
  let context: RequirementsContext | null = null;
  
  try {
    // Phase 1: Parse request and setup
    context = await parseRequest(null, request);
    context = await loadProjectContext(context, request);
    
    // Phase 2: Generate code
    context = await processRequirements(context, request);
    if (context.error) {
      logger.error('❌ Code generation failed, returning early', { error: context.error.message });
      return context;
    }
    
    context = await enhanceGeneratedCode(context);
    
    // Phase 3: Persist project (critical phase)
    context = await persistProject(context);
    if (context.error) {
      logger.error('❌ Project persistence failed, returning early', { error: context.error.message });
      return context;
    }
    
    // Store basic project state
    await updateProjectMetadata(context.projectId, {
      status: 'generated',
      generatedAt: new Date().toISOString(),
      fileCount: Object.keys(context.generatedFiles || {}).length
    });
    
    // Phase 4: GitHub integration (optional)
    if (context.setupGitHub) {
      try {
        context = await setupGitHubRepository(context);
        // Update metadata with GitHub status
        await updateProjectMetadata(context.projectId, {
          github: {
            status: context.githubError ? 'failed' : 'success',
            error: context.githubError?.message,
            repositoryUrl: context.githubInfo?.url,
            repositoryInfo: context.githubInfo
          }
        });
      } catch (error) {
        // Log error but continue
        logger.error('❌ GitHub setup failed but continuing', { error });
        context.githubError = error instanceof Error ? error : new Error(String(error));
      }
    }
    
    // Phase 5: Deployment (optional)
    if (context.shouldDeploy) {
      try {
        context = await deployCode(context);
        // Update metadata with deployment status
        await updateProjectMetadata(context.projectId, {
          deployment: {
            status: context.deploymentResult?.status || 'failed',
            error: context.deploymentError?.message,
            url: context.deploymentResult?.url,
            provider: context.deploymentResult?.provider
          }
        });
      } catch (error) {
        // Log error but continue
        logger.error('❌ Deployment failed', { error });
        context.deploymentError = error instanceof Error ? error : new Error(String(error));
      }
    }
    
    return context;
  } catch (error) {
    // Handle unexpected errors
    logger.error('❌ Unexpected error in requirements chain', { error });
    if (context && context.projectId) {
      await updateProjectMetadata(context.projectId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return context || createErrorContext(error);
  }
}

// Helper to update project metadata
async function updateProjectMetadata(projectId: string, metadata: Record<string, any>): Promise<void> {
  try {
    const projectManager = getProjectStateManager();
    await projectManager.updateProject(projectId, { metadata });
  } catch (error) {
    logger.error('Failed to update project metadata', { projectId, error });
  }
}
```

### Phase 2: GitHub Integration

**Key Changes:**
- Create a standalone GitHub integration middleware
- Update metadata after GitHub operations
- Make GitHub setup completely independent of deployment

**Implementation Details:**
```typescript
// GitHub integration middleware
export async function setupGitHubRepository(context: RequirementsContext): Promise<RequirementsContext> {
  if (!context.setupGitHub) {
    logger.info('⏭️ GitHub setup skipped - not requested');
    return context;
  }

  logger.info('🚀 Setting up GitHub repository');
  
  try {
    // Get GitHub credentials
    const credentialService = getCredentialService();
    const githubCredentials = credentialService.getGitHubCredentials({
      env: context.env,
      requestData: context.deploymentOptions || {},
      tenantId: context.tenantId
    });
    
    if (!githubCredentials) {
      throw new Error('GitHub credentials required but not provided');
    }
    
    // Update metadata to show GitHub setup in progress
    await updateProjectMetadata(context.projectId, {
      github: {
        status: 'in-progress'
      }
    });
    
    // Use existing GitHubIntegrationService
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
    
    logger.info('✅ GitHub repository created successfully', {
      repoUrl: result.repositoryInfo.url
    });
    
    return context;
  } catch (error) {
    logger.error('❌ GitHub repository setup failed', error);
    context.githubError = error instanceof Error ? error : new Error(String(error));
    return context;
  }
}
```

### Phase 3: Deployment Updates

**Key Changes:**
- Decouple Netlify deployment from GitHub
- Optionally leverage GitHub information when available
- Update metadata after deployment operations

**Implementation Details:**
```typescript
// Decoupled deployment handler
export async function deployCode(context: RequirementsContext): Promise<RequirementsContext> {
  if (!context.shouldDeploy || !context.projectId) {
    logger.info('⏭️ Deployment skipped - not requested or missing project ID');
    return context;
  }

  logger.info('🚀 Starting deployment process');
  
  try {
    // Update metadata to show deployment in progress
    await updateProjectMetadata(context.projectId, {
      deployment: {
        status: 'in-progress'
      }
    });
    
    // Load project files
    const projectManager = getProjectStateManager();
    const project = await projectManager.getProject(context.projectId);
    if (!project) {
      throw new Error(`Project ${context.projectId} not found`);
    }
    
    const projectFiles = await projectManager.getProjectFiles(context.projectId);
    if (!projectFiles || projectFiles.length === 0) {
      throw new Error(`No files found for project ${context.projectId}`);
    }
    
    // Get credentials and determine deployment target
    const credentialService = getCredentialService();
    const allCredentials = credentialService.getAllCredentials({
      env: context.env || {},
      requestData: context.deploymentOptions || {},
      tenantId: context.tenantId
    });
    
    // Prepare files for deployment
    const files = context.generatedFiles || projectFiles.reduce((map, file) => {
      if (!file.isDeleted) {
        map[file.path] = file.content;
      }
      return map;
    }, {} as Record<string, string>);
    
    // Determine if we should use GitHub-aware deployment
    const useGitHub = !!context.githubInfo && !context.githubError;
    
    let deploymentResult;
    if (context.deploymentTarget === 'netlify') {
      // Deploy to Netlify
      deploymentResult = await deployToNetlify({
        files,
        projectId: context.projectId,
        projectName: project.name || 'Generated Project',
        netlifyToken: allCredentials.netlify?.apiToken,
        githubInfo: useGitHub ? context.githubInfo : undefined,
        siteId: context.deploymentOptions?.siteId
      });
    } else {
      // Use generic deployment manager for other targets
      const deploymentService = getDeploymentWorkflowService();
      deploymentResult = await deploymentService.deployProject({
        projectId: context.projectId,
        projectName: project.name || 'Generated Project',
        files,
        targetName: context.deploymentTarget,
        credentials: {
          netlify: allCredentials.netlify,
          github: allCredentials.github,
          cloudflare: allCredentials.cloudflare
        },
        metadata: {
          tenantId: context.tenantId,
          source: 'requirements-chain',
          github: useGitHub ? context.githubInfo : undefined
        }
      });
    }
    
    // Update context with deployment result
    context.deploymentResult = deploymentResult;
    
    logger.info('✅ Deployment completed successfully', {
      url: deploymentResult.url,
      provider: deploymentResult.provider
    });
    
    return context;
  } catch (error) {
    logger.error('❌ Deployment failed', { error });
    context.deploymentError = error instanceof Error ? error : new Error(String(error));
    return context;
  }
}

// Netlify-specific deployment using techniques from api.netlify-deploy.ts
async function deployToNetlify(options: {
  files: Record<string, string>;
  projectId: string;
  projectName: string;
  netlifyToken?: string;
  githubInfo?: GitHubRepositoryInfo;
  siteId?: string;
}): Promise<DeploymentResult> {
  const { files, projectId, projectName, netlifyToken, githubInfo, siteId } = options;
  
  if (!netlifyToken) {
    throw new Error('Netlify token is required');
  }
  
  // Create or get site
  let targetSiteId = siteId;
  let siteUrl = '';
  
  // Logic from api.netlify-deploy.ts to create/get site
  // ...
  
  // If we have GitHub info, use Netlify's GitHub integration
  if (githubInfo && githubInfo.fullName) {
    // Connect site to GitHub repository
    // ...
    
    // Trigger deploy from GitHub
    // ...
  } else {
    // Direct file upload logic from api.netlify-deploy.ts
    // ...
  }
  
  return {
    id: deployId,
    url: siteUrl,
    status: 'success',
    provider: 'netlify'
  };
}
```

### Phase 4: Testing and API Updates

**Key Changes:**
- Update test script to handle modular flow
- Enhance API response structure with status of each phase
- No backward compatibility concerns (per your feedback)

**Implementation Details:**
```typescript
// Enhanced API response structure
export async function action({ request, context }: ActionFunctionArgs) {
  try {
    // Run the requirements chain
    const resultContext = await runRequirementsChain(request);
    
    // If there was a critical error, return it
    if (resultContext.error && (!resultContext.projectId || !resultContext.generatedFiles)) {
      const errorService = getErrorService();
      throw errorService.createError(
        'REQUIREMENTS_PROCESSING_ERROR',
        'Failed to process requirements',
        resultContext.error
      );
    }
    
    // Determine success status for each phase
    const codeGenerationSuccess = !!resultContext.projectId && !!resultContext.generatedFiles;
    const githubSuccess = resultContext.setupGitHub ? !!resultContext.githubInfo && !resultContext.githubError : undefined;
    const deploymentSuccess = resultContext.shouldDeploy ? resultContext.deploymentResult?.status === 'success' : undefined;
    
    // Return comprehensive response
    return json({
      success: codeGenerationSuccess,
      projectId: resultContext.projectId,
      isNewProject: resultContext.isNewProject,
      name: resultContext.name || '',
      fileCount: Object.keys(resultContext.generatedFiles || {}).length,
      // Links section
      links: {
        downloadUrl: resultContext.downloadUrl || `/api/download-project/${resultContext.projectId}`,
        githubUrl: resultContext.githubInfo?.url,
        deploymentUrl: resultContext.deploymentResult?.url
      },
      // Detailed status for each phase
      phases: {
        codeGeneration: {
          status: codeGenerationSuccess ? 'success' : 'failed',
          error: resultContext.error?.message
        },
        github: resultContext.setupGitHub ? {
          status: githubSuccess ? 'success' : 'failed',
          error: resultContext.githubError?.message,
          repository: resultContext.githubInfo
        } : undefined,
        deployment: resultContext.shouldDeploy ? {
          status: deploymentSuccess ? 'success' : 'failed',
          error: resultContext.deploymentError?.message,
          result: resultContext.deploymentResult
        } : undefined
      }
    });
  } catch (error) {
    logger.error('Error processing requirements', error);
    throw error;
  }
}
```

**Updated test script approach:**
```bash
# Enhance test-requirements-e2e.sh with modular options

# Add command line options for setup
SETUP_GITHUB=${SETUP_GITHUB:-false}
SHOULD_DEPLOY=${SHOULD_DEPLOY:-false}

# Parse additional arguments
for arg in "$@"; do
  case $arg in
    --github)
      SETUP_GITHUB=true
      shift
      ;;
    --deploy)
      SHOULD_DEPLOY=true
      shift
      ;;
    --full-flow)
      SETUP_GITHUB=true
      SHOULD_DEPLOY=true
      shift
      ;;
  esac
done

# Create payload with appropriate options
DEPLOYMENT_CONFIG=""

if [ "$SETUP_GITHUB" = true ] && [ -n "$GITHUB_TOKEN" ] && [ -n "$GITHUB_OWNER" ]; then
  DEPLOYMENT_CONFIG="${DEPLOYMENT_CONFIG}\"setupGitHub\": true,"
  DEPLOYMENT_CONFIG="${DEPLOYMENT_CONFIG}\"credentials\": {"
  DEPLOYMENT_CONFIG="${DEPLOYMENT_CONFIG}\"github\": {\"token\": \"${GITHUB_TOKEN}\", \"owner\": \"${GITHUB_OWNER}\"},"
else
  SETUP_GITHUB=false
fi

if [ "$SHOULD_DEPLOY" = true ] && [ -n "$NETLIFY_TOKEN" ]; then
  DEPLOYMENT_CONFIG="${DEPLOYMENT_CONFIG}\"shouldDeploy\": true,"
  
  if [ "$SETUP_GITHUB" = true ]; then
    # Already started credentials object above
    DEPLOYMENT_CONFIG="${DEPLOYMENT_CONFIG}\"netlify\": {\"apiToken\": \"${NETLIFY_TOKEN}\"}"
    DEPLOYMENT_CONFIG="${DEPLOYMENT_CONFIG}},"
  else
    DEPLOYMENT_CONFIG="${DEPLOYMENT_CONFIG}\"credentials\": {\"netlify\": {\"apiToken\": \"${NETLIFY_TOKEN}\"}}"
  fi
  
  DEPLOYMENT_CONFIG="${DEPLOYMENT_CONFIG}\"deploymentTarget\": \"netlify\","
else
  SHOULD_DEPLOY=false
fi

# Log configuration
echo -e "${BLUE}Test Configuration:${NC}"
echo -e "Environment: ${ENVIRONMENT}"
echo -e "API Base URL: ${API_BASE_URL}"
echo -e "Tenant ID: ${TENANT_ID}"
echo -e "Setup GitHub: ${SETUP_GITHUB}"
echo -e "Deploy: ${SHOULD_DEPLOY}"
```

## Reusable Components Analysis

### For GitHub Flow

1. **GitHubIntegrationService** (`app/lib/deployment/github-integration.ts`):
   - Already handles repository creation, file upload, and metadata tracking
   - Provides proper error handling and has a well-designed interface

2. **GitHubRepository** (`app/lib/deployment/github-repository.ts`):
   - Handles direct GitHub API interactions
   - Implements token validation, repository creation, and file upload

3. **CredentialService** (`app/lib/services/credential-service.ts`):
   - Already extracts GitHub credentials from various sources
   - Handles credential validation and tenant access checks

### For Netlify Flow

1. **Netlify API Implementation** (`app/routes/api.netlify-deploy.ts`):
   - Contains complete Netlify deployment workflow:
     - Site creation/retrieval
     - File digest generation
     - Deploy initialization
     - File uploading
     - Status checking

2. **DeploymentManager** (`app/lib/deployment/deployment-manager.ts`):
   - Has target registration system
   - Manages deployment credentials

3. **NetlifyTarget** (`app/lib/deployment/targets/netlify.ts`):
   - Implements Netlify deployment logic
   - Could be extended to use GitHub info when available

## Conclusion

This modular flow creates a clean separation between different phases of the process, making the system more maintainable and easier to extend. By updating metadata after each phase and providing a comprehensive response structure, we improve observability and error handling.

The implementation leverages existing components where possible while introducing necessary abstractions to make the system more flexible. Each phase is optional and configurable, allowing for different combinations of features based on user needs.

## Implementation Status

### Implemented Changes

The modular flow for requirements-to-deployment has been successfully implemented with the following changes:

1. **Phase 1 - Middleware Refactoring**
   - The requirements chain has been split into distinct phases with clear responsibilities
   - Each phase updates metadata after completion
   - Non-critical failures in later phases don't prevent the flow from continuing
   - Code generation now produces a buildconfig.json for framework detection

2. **Phase 2 - GitHub Integration**
   - Created dedicated middleware in `app/lib/middleware/github-integration.ts`
   - GitHub repository setup is now completely independent of deployment
   - Added first-class `githubOptions` property to the context, properly decoupling GitHub from deployment
   - GitHub credentials are properly extracted and validated
   - Metadata is updated with GitHub status including success/failure indicators

3. **Phase 3 - Deployment Updates**
   - Modified deployment handlers to optionally leverage GitHub information
   - Removed tight coupling between Netlify deployment and GitHub
   - Added proper error handling and metadata updates for deployment phase
   - Deployment can be executed separately from GitHub setup

4. **Phase 4 - Testing and API Updates**
   - Updated test script to handle modular flow
   - Enhanced API response in `app/routes/api.requirements.ts` with detailed phase status
   - Added comprehensive links section in response with all available resources
   - Implemented debug logging throughout the flow for better observability

### Key Files Modified

1. **Requirements API Route** - `app/routes/api.requirements.ts`
   - Updated to use the modular flow
   - Enhanced response schema with phase information
   - Improved error handling and logging

2. **GitHub Integration Middleware** - `app/lib/middleware/github-integration.ts`
   - New file for dedicated GitHub integration
   - Handles repository creation and file upload
   - Updates project metadata during GitHub operations

3. **Requirements Chain** - `app/lib/middleware/requirements-chain.ts`
   - Refactored to support the modular flow
   - Each middleware function has a clear responsibility
   - Improved error handling and continues flow after non-critical errors

4. **Test Script** - `scripts/test-requirements-e2e.sh`
   - Updated to support testing the modular flow
   - Added detailed status reporting for each phase
   - Improved error diagnostics

### API Response Structure

The new API response structure includes:

```json
{
  "success": true,
  "projectId": "project-id",
  "isNewProject": true,
  "name": "Project Name",
  "fileCount": 42,
  "links": {
    "downloadUrl": "/api/download-project/project-id",
    "githubUrl": "https://github.com/owner/repo",
    "deploymentUrl": "https://deployed-site.netlify.app"
  },
  "phases": {
    "codeGeneration": {
      "status": "success",
      "error": null,
      "completedAt": "2023-06-01T12:00:00Z"
    },
    "github": {
      "status": "success",
      "error": null,
      "repositoryUrl": "https://github.com/owner/repo",
      "repositoryName": "owner/repo",
      "branch": "main"
    },
    "deployment": {
      "status": "success",
      "error": null,
      "url": "https://deployed-site.netlify.app",
      "provider": "netlify",
      "deploymentId": "deployment-id"
    }
  }
}
```

### Testing the Implementation

The implementation can be tested using the updated test script:

```bash
export GITHUB_TOKEN=your_github_token
export GITHUB_OWNER=your_github_username
export NETLIFY_TOKEN=your_netlify_token

# Test just GitHub integration
./scripts/test-requirements-e2e.sh local default --github

# Test just deployment
./scripts/test-requirements-e2e.sh local default --deploy

# Test full flow
./scripts/test-requirements-e2e.sh local default --full
```

### Next Steps

1. **Monitoring and Observability**
   - Add more comprehensive logging for each phase
   - Implement metrics collection for success rates

2. **Frontend Integration**
   - Update frontend components to display phase statuses
   - Add visual indicators for GitHub and deployment status

3. **Performance Optimization**
   - Identify bottlenecks in the flow and optimize
   - Consider caching strategies for frequently accessed resources

4. **Advanced Features**
   - Support for more deployment targets
   - Enhanced GitHub repository configuration options 

## Deployment Refactoring

After implementing the modular flow and decoupling GitHub from the deployment process, we've identified several issues that still need to be addressed to complete the separation:

### Current Issues

1. **Duplicate GitHub Repository Creation**: 
   - First repository is created by the decoupled GitHub flow
   - Second repository is created by the netlify-github target in the deployment flow

2. **Target Selection Problem**:
   - The deployment manager still selects "netlify-github" instead of "netlify" as the target
   - This causes redundant GitHub repository creation

3. **Target Availability Logic**:
   - The system falls back to netlify-github when netlify fails with auth errors
   - This defeats the purpose of decoupling GitHub from deployment

### Refactoring Plan

1. **Modify the DeploymentManager**:
   - Update target selection to prioritize 'netlify' over 'netlify-github'
   - Add logic to use existing GitHub info (context.githubInfo) instead of creating new repos

2. **Refactor or Remove netlify-github Target**:
   - Enhance the Netlify target to optionally use GitHub information if available
   - Deprecate the netlify-github target or make it a thin wrapper around Netlify target

3. **Update Deployment Workflow**:
   - Modify the workflow to check if GitHub setup has already happened
   - Pass existing GitHub repository info to deployment targets

4. **Fix Credential Handling**:
   - Ensure Netlify credentials are correctly passed to prevent authorization errors
   - Improve error messaging for credential-related issues

### Specific Code Changes Needed:
1. In app/lib/deployment/deployment-manager.ts:
Update the target selection logic to prioritize 'netlify' over 'netlify-github'
Check for context.githubInfo and use it if available

2. In app/lib/deployment/targets/netlify.ts:
Enhance to accept optional GitHub repository info
Add logic to connect to GitHub if info is provided

3. In app/lib/deployment/deployment-workflow.ts:
Update to pass GitHub info from context to deployment targets
Skip GitHub repository creation if already done

4. In app/lib/middleware/requirements-chain.ts:
Ensure GitHub info is properly passed to the deployment step
Add clearer logging about which path is being taken

5. Deprecate app/lib/deployment/targets/netlify-github.ts eventually

### Additional Observations
The Netlify site creation seems to succeed, but the verification fails:
This could be an API rate limit issue or a timing problem
The error handling in the deployment workflow doesn't provide enough detail about the root cause of failures.

This refactoring will require careful coordination between several components, but the main focus should be on making the netlify target capable of working with an existing GitHub repository, removing the need for the netlify-github target entirely.


### Expected Outcome

After this refactoring:
- GitHub repository creation will only happen in the GitHub integration phase 
- Deployment will use the existing GitHub repository if available
- The netlify-github target will be deprecated in favor of an enhanced netlify target
- Clearer error messages will indicate what went wrong during deployment

This will complete the decoupling of GitHub from deployment while maintaining the ability to deploy to Netlify sites that are connected to GitHub repositories. 

### Summary of Changes
1. deployment-orchestrator.ts:
Enhanced logging for better debugging
Improved error handling for credential issues
Prioritized 'netlify' target over 'netlify-github'
Improved passing of GitHub repository information to deployment targets

2. netlify-github.ts:
Deprecated this class by making it a thin wrapper around the NetlifyTarget
Added clear deprecation notices in both class and factory definitions
Simplified implementation to delegate all calls to NetlifyTarget

3. netlify.ts:
Enhanced to properly use GitHub repository information when available
Improved GitHub integration for connecting Netlify sites to GitHub repositories
Added fallback to direct deployment when GitHub integration fails

4. target-registry.ts:
Added better error handling for missing credentials
Added deprecation notice to NetlifyGitHubTargetFactory
Improved token validation

5. deployment-workflow.ts:
Updated DeploymentWorkflowOptions to include githubInfo parameter
Enhanced deployProject method to use existing GitHub repository information
Added logic to switch from 'netlify-github' to 'netlify' when GitHub info is available

6. requirements-chain.ts:
Updated deployCode function to properly pass GitHub information to deployment workflow
Deprecated Code and Files

### The following can be deprecated or removed in future updates:
Files to Remove/Deprecate:
1. app/lib/deployment/targets/netlify-github.ts - Replace with netlify.ts with githubInfo
2. Any direct imports of NetlifyGitHubTarget should be updated to use NetlifyTarget

Code Patterns to Remove:
1. Hardcoded target names: 'netlify-github' should be replaced with 'netlify'
2. Direct GitHub repository creation in deployment targets
3. Direct use of GitHub credentials in deployment targets when GitHub info already exists

Config Changes:
1. Remove any config references to 'netlify-github' target
2. Update deployment scripts to use 'netlify' with githubInfo instead