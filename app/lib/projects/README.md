# Project State Management System

The project state management system provides a consistent interface for storing, retrieving, and managing project data across different environments.

## Usage

### Basic Usage

The simplest way to use the project state management system is through the singleton instance:

```typescript
import { getProjectStateManager } from '~/lib/projects';

// Create a new project
const projectManager = getProjectStateManager();
const project = await projectManager.createProject({
  name: 'My Project',
  initialRequirements: 'Build a React app with TypeScript'
});

// Get a project
const existingProject = await projectManager.getProject(projectId);

// Update a project
await projectManager.updateProject(projectId, {
  newRequirements: 'Add dark mode to the React app'
});

// Add files to a project
await projectManager.addFiles(projectId, {
  'src/App.tsx': 'export default function App() { return <div>Hello World</div>; }',
  'src/index.tsx': 'import React from "react"; import ReactDOM from "react-dom"; import App from "./App";'
});

// Get a project's files
const files = await projectManager.getProjectFiles(projectId);

// Add a deployment
await projectManager.addDeployment(projectId, {
  url: 'https://my-project.example.com',
  provider: 'cloudflare',
  timestamp: Date.now(),
  status: 'success'
});
```

### Using in API Routes

The project state management system integrates with API routes through middleware:

```typescript
import { handleProjectContext } from '~/lib/middleware/project-context';
import { getProjectStateManager } from '~/lib/projects';

export async function action({ request }: ActionFunctionArgs) {
  // Handle project context (creates a new project or loads an existing one)
  const projectContext = await handleProjectContext(request, {
    autoCreateProject: true,
    defaultProjectName: 'My Project'
  });
  
  const { projectId, isNewProject, project } = projectContext;
  
  // Work with the project
  const projectManager = getProjectStateManager();
  
  // Update the project
  await projectManager.updateProject(projectId, {
    // ... update options
  });
  
  return json({ success: true, projectId });
}
```

## Architecture

### Core Components

1. **ProjectStateManager** - Main entry point for managing projects
2. **StorageAdapters** - Environment-specific persistence implementations
   - `LocalProjectStorage` - For local development using browser or file storage
   - `CloudflareProjectStorage` - For Cloudflare Pages using KV or D1

### Data Model

- **ProjectState** - Complete project state including files, requirements, and deployments
- **ProjectFile** - Individual file within a project
- **RequirementsEntry** - A single requirements entry in a project's history
- **ProjectDeployment** - Deployment information for a project

### Storage

The system automatically selects the appropriate storage adapter based on the current environment:

- In local development, it uses the environment's best available storage (localStorage, file, or memory)
- In Cloudflare environments, it uses KV or D1 when available, falling back to memory

## Middleware

The project context middleware (`handleProjectContext`) helps with:

1. Identifying if a request is for a new or existing project
2. Loading project context for existing projects
3. Auto-creating new projects
4. Handling requirements in a consistent way

## Testing

The system includes tests that verify:

1. Creating, retrieving, and updating projects
2. Managing project files
3. Tracking requirements history
4. Handling deployments

## Integration with Environment System

The project state management system leverages the environment system to:

1. Determine the current environment type
2. Select the appropriate storage adapter
3. Access environment-specific storage mechanisms

This ensures consistent behavior across different deployment targets while utilizing the best available resources in each environment.

---

When used in combination with the API requirements endpoint, the project state management system provides a robust foundation for managing project state throughout the application lifecycle. 