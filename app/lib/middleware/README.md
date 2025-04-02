# Middleware System

This directory contains middleware components that handle common tasks for API endpoints and other server-side operations.

## Project Context Middleware

The `project-context.ts` middleware handles identifying and loading project contexts for requests. It:

- Identifies if a request is for a new or existing project
- Loads project state for existing projects
- Auto-creates new projects when needed
- Provides consistent project context for downstream handlers

### Usage

```typescript
import { handleProjectContext } from '~/lib/middleware/project-context';

// In a Remix loader or action
export async function action({ request }: ActionFunctionArgs) {
  const projectContext = await handleProjectContext(request, {
    autoCreateProject: true,
    defaultProjectName: 'My Project'
  });
  
  // Use the project context
  const { projectId, isNewProject, project } = projectContext;
  
  // Continue processing...
}
```

## Requirements Middleware Chain

The `requirements-chain.ts` middleware provides a composable chain of middleware functions for processing requirements. It:

- Parses requirements from requests
- Loads project context
- Processes requirements and saves them to projects
- Handles deployments if requested

### Middleware Chain Components

1. **parseRequest**: Extracts requirements content and metadata from the request
2. **loadProjectContext**: Loads or creates project context using the project-context middleware
3. **processRequirements**: Saves requirements to the project and prepares files for deployment
4. **handleDeployment**: Deploys the project if requested and saves deployment information

### Usage

```typescript
import { runRequirementsChain } from '~/lib/middleware/requirements-chain';

// In a Remix action
export async function action({ request }: ActionFunctionArgs) {
  try {
    // Run the complete middleware chain
    const result = await runRequirementsChain(request);
    
    // Check for errors
    if (result.error) {
      return json({ error: result.error.message }, { status: 500 });
    }
    
    // Return the result
    return json({
      projectId: result.projectId,
      deployment: result.deploymentResult
    });
  } catch (error) {
    return json({ error: 'Processing failed' }, { status: 500 });
  }
}
```

### Extending the Middleware Chain

You can add new middleware functions to the chain by creating functions that match the `RequirementsMiddleware` type:

```typescript
import type { RequirementsMiddleware } from '~/lib/middleware/requirements-chain';

// Create a custom middleware function
export const myCustomMiddleware: RequirementsMiddleware = async (context, request) => {
  // Process the context
  // ...
  
  // Return the modified context
  return {
    ...context,
    customData: 'something'
  };
};

// Add it to the chain
const customChain = [
  parseRequest,
  loadProjectContext,
  myCustomMiddleware, // Your custom middleware
  processRequirements,
  handleDeployment
];
```

## Integration with Other Systems

The middleware system is designed to work seamlessly with:

1. **Environment System**: Uses environment-specific functionality
2. **Project State Manager**: For persisting project data
3. **Deployment Manager**: For handling deployments

This ensures consistent behavior across different environments and provides a uniform API for client applications. 