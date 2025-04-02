# Deployment System

The deployment system provides a consistent interface for deploying projects to different platforms across different environments.

## Usage

### Basic Usage

The simplest way to use the deployment system is through the singleton instance:

```typescript
import { getDeploymentManager } from '~/lib/deployment';

// Configure the deployment manager
const deploymentManager = getDeploymentManager({
  cloudflareConfig: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN
  }
});

// Deploy a project using the best available target
const deployment = await deploymentManager.deployWithBestTarget({
  projectName: 'my-project',
  files: {
    'index.html': '<html><body>Hello World</body></html>',
    'style.css': 'body { color: blue; }',
    'js/script.js': 'console.log("Hello World");'
  }
});

console.log(`Deployed to: ${deployment.url}`);
```

### Using with Project State Manager

The deployment system integrates with the project state manager:

```typescript
import { getProjectStateManager } from '~/lib/projects';
import { getDeploymentManager } from '~/lib/deployment';

// Get the project state manager
const projectManager = getProjectStateManager();
const project = await projectManager.getProject(projectId);

// Get project files
const files = await projectManager.getProjectFiles(projectId);
const fileMap = files.reduce((map, file) => {
  map[file.path] = file.content;
  return map;
}, {});

// Deploy the project
const deploymentManager = getDeploymentManager();
const deployment = await deploymentManager.deployWithBestTarget({
  projectName: project.name,
  files: fileMap
});

// Add the deployment to the project
await projectManager.addDeployment(projectId, {
  url: deployment.url,
  provider: deployment.provider,
  timestamp: Date.now(),
  status: deployment.status
});
```

## Architecture

### Core Components

1. **DeploymentManager** - Main entry point for managing deployments
2. **DeploymentTargets** - Platform-specific deployment implementations
   - `CloudflarePagesTarget` - For Cloudflare Pages
   - (More targets to be added)
3. **Packagers** - Utilities for packaging files for deployment
   - `ZipPackager` - Creates ZIP archives for deployment

### Data Model

- **DeploymentTarget** - Interface for all deployment targets
- **Packager** - Interface for packaging files
- **DeploymentResult** - Result of a deployment operation
- **DeploymentStatus** - Status of a deployment

### Deployment Targets

The system supports multiple deployment targets, with Cloudflare Pages as the initial implementation:

1. **Cloudflare Pages** - Uses the Cloudflare Pages API to deploy static sites
   - Supports direct upload deployment
   - Provides preview URLs for each deployment
   - Handles project creation and updates

2. **Future Targets**
   - Vercel
   - Netlify
   - GitHub Pages
   - Local tunneling

## Packagers

Packagers handle the preparation of files for deployment:

1. **ZipPackager** - Creates ZIP archives for deployment
   - Uses JSZip for ZIP creation
   - Supports filtering files based on include/exclude patterns
   - Works in both browser and server environments

## Integration with Environment System

The deployment system leverages the environment system to:

1. Determine the current environment type
2. Access environment-specific configuration
3. Select appropriate deployment targets

This ensures consistent behavior across different deployment environments while utilizing the best available resources in each environment.

## Testing

The system includes tests that verify:

1. Registering and selecting deployment targets
2. Initializing projects and deploying files
3. Packaging files for deployment
4. Handling errors and edge cases

---

When used in combination with the project state management system, the deployment system provides a robust foundation for deploying projects across different platforms and environments. 