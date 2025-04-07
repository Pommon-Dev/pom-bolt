import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import React from 'react';
import { getEnvironment } from '../lib/environments';
import { getProjectStateManager } from '../lib/projects';
import { getDeploymentManager } from '../lib/deployment';
import { createScopedLogger } from '../utils/logger';
import { runRequirementsChain } from '../lib/middleware/requirements-chain';

const logger = createScopedLogger('architecture-test-route');

/**
 * This route tests the complete architecture in the current environment
 * It can be used to test both local and Cloudflare environments
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const results: Record<string, any> = {
    success: true,
    steps: [],
    errors: []
  };

  try {
    // Step 1: Test environment system
    const environment = getEnvironment();
    const envInfo = environment.getInfo();
    logger.info('Environment detected:', envInfo);
    
    results.steps.push({
      name: 'Environment Detection',
      data: {
        type: envInfo.type,
        isProduction: envInfo.isProduction,
        isDevelopment: envInfo.isDevelopment
      }
    });
    results.environment = envInfo;
    
    // Step 2: Test project state management
    const projectManager = getProjectStateManager();
    
    // Create a new test project
    const testProjectName = `Test Project ${new Date().toISOString()}`;
    logger.info(`Creating test project: ${testProjectName}`);
    
    const project = await projectManager.createProject({
      name: testProjectName,
      initialRequirements: 'Create a simple HTML page with a button that shows an alert when clicked.'
    });
    
    logger.info(`Created project with ID: ${project.id}`);
    results.steps.push({
      name: 'Project Creation',
      data: {
        id: project.id,
        name: project.name
      }
    });
    
    // Add files to the project
    logger.info('Adding files to the project...');
    const files = {
      'index.html': `
<!DOCTYPE html>
<html>
<head>
  <title>Test Project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Hello World</h1>
  <button id="alert-button">Click Me</button>
  <script src="script.js"></script>
</body>
</html>
      `,
      'style.css': `
body {
  font-family: Arial, sans-serif;
  margin: 2rem;
}

button {
  padding: 0.5rem 1rem;
  background-color: #0070f3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
      `,
      'script.js': `
document.getElementById('alert-button').addEventListener('click', function() {
  alert('Button clicked!');
});
      `
    };
    
    // Add the files using addFiles method
    await projectManager.addFiles(project.id, files);
    logger.info(`Added ${Object.keys(files).length} files to the project`);
    
    // Retrieve project files
    const projectFiles = await projectManager.getProjectFiles(project.id);
    logger.info(`Retrieved ${projectFiles.length} files from project`);
    
    results.steps.push({
      name: 'File Management',
      data: {
        addedFiles: Object.keys(files),
        retrievedFiles: projectFiles.length
      }
    });
    
    // Get requirements history
    const requirements = await projectManager.getRequirementsHistory(project.id);
    logger.info(`Project has ${requirements.length} requirements entries`);
    
    results.steps.push({
      name: 'Requirements Management',
      data: {
        requirementsCount: requirements.length
      }
    });
    
    // Test the requirements middleware chain for updating an existing project
    logger.info('Testing requirements middleware chain...');
    
    // Create a mock request for testing the middleware
    const mockRequest = new Request('http://localhost/api/requirements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        projectId: project.id,
        content: 'Add a contact form to the page with name, email, and message fields.',
        shouldDeploy: false
      })
    });
    
    // Run the middleware chain
    const requirementsResult = await runRequirementsChain(mockRequest);
    
    logger.info(`Requirements chain result: ${JSON.stringify({
      success: !requirementsResult.error,
      updatedProjectId: requirementsResult.projectId,
      filesUpdated: requirementsResult.files ? Object.keys(requirementsResult.files).length : 0
    })}`);
    
    // Check if the requirements were added
    const updatedRequirements = await projectManager.getRequirementsHistory(project.id);
    
    results.steps.push({
      name: 'Requirements API',
      data: {
        success: !requirementsResult.error,
        initialRequirementsCount: requirements.length,
        updatedRequirementsCount: updatedRequirements.length,
        filesUpdated: requirementsResult.files ? Object.keys(requirementsResult.files).length : 0
      }
    });
    
    // Now test creating a new project using the requirements chain
    logger.info('Testing new project creation via requirements chain...');
    
    // Create a mock request for a new project
    const newProjectRequest = new Request('http://localhost/api/requirements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Create a landing page for a coffee shop with a menu and contact info.',
        shouldDeploy: false
      })
    });
    
    // Run the middleware chain
    const newProjectResult = await runRequirementsChain(newProjectRequest);
    
    logger.info(`New project requirements chain result: ${JSON.stringify({
      success: !newProjectResult.error,
      newProjectId: newProjectResult.projectId,
      filesCreated: newProjectResult.files ? Object.keys(newProjectResult.files).length : 0
    })}`);
    
    results.steps.push({
      name: 'New Project via Requirements API',
      data: {
        success: !newProjectResult.error,
        newProjectId: newProjectResult.projectId,
        isNewProject: newProjectResult.isNewProject,
        filesCreated: newProjectResult.files ? Object.keys(newProjectResult.files).length : 0
      }
    });
    
    // Step 3: Test deployment system if available
    logger.info('Testing deployment system...');
    const deploymentManager = getDeploymentManager();
    
    try {
      const cloudflareConfig = {
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
        apiToken: process.env.CLOUDFLARE_API_TOKEN || ''
      };
      
      // Try to initialize with Cloudflare config if available
      if (cloudflareConfig.accountId && cloudflareConfig.apiToken) {
        const configuredDeploymentManager = getDeploymentManager({ cloudflareConfig });
        const availableTargets = await configuredDeploymentManager.getAvailableTargets();
        
        logger.info(`Available deployment targets: ${availableTargets.length > 0 ? availableTargets.join(', ') : 'None'}`);
        
        results.steps.push({
          name: 'Deployment System',
          data: {
            availableTargets,
            hasCredentials: true
          }
        });
        
        if (availableTargets.length > 0) {
          logger.info('Attempting to deploy project...');
          
          // Convert project files to the format needed for deployment
          const fileMap = projectFiles.reduce((map, file) => {
            map[file.path] = file.content;
            return map;
          }, {} as Record<string, string>);
          
          // Deploy with the best available target
          const deployment = await configuredDeploymentManager.deployWithBestTarget({
            projectName: project.name,
            files: fileMap,
            projectId: project.id
          });
          
          logger.info(`Deployment successful! URL: ${deployment.url}`);
          
          // Save the deployment to the project
          await projectManager.addDeployment(project.id, {
            url: deployment.url,
            provider: deployment.provider,
            timestamp: Date.now(),
            status: deployment.status
          });
          
          logger.info('Deployment saved to project state');
          
          results.steps.push({
            name: 'Project Deployment',
            data: {
              url: deployment.url,
              provider: deployment.provider,
              status: deployment.status
            }
          });
        }
      } else {
        results.steps.push({
          name: 'Deployment System',
          data: {
            availableTargets: [],
            hasCredentials: false
          }
        });
      }
    } catch (error) {
      logger.error('Deployment failed:', error);
      results.errors.push({
        step: 'Project Deployment',
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    // Retrieve the final project state
    const updatedProject = await projectManager.getProject(project.id);
    
    results.steps.push({
      name: 'Final Project State',
      data: {
        id: updatedProject.id,
        name: updatedProject.name,
        fileCount: updatedProject.files.length,
        requirementsCount: updatedProject.requirements.length,
        deploymentsCount: updatedProject.deployments.length
      }
    });
    
    logger.info('Architecture test completed successfully!');
  } catch (error) {
    logger.error('Architecture test failed:', error);
    results.success = false;
    results.errors.push({
      step: 'Overall Test',
      error: error instanceof Error ? error.message : String(error)
    });
  }
  
  return json(results);
}

/**
 * A simple component that renders the test results
 */
export default function ArchitectureTest() {
  const data = useLoaderData<typeof loader>();
  
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <h1>Architecture Test</h1>
      <p>This page is testing the complete architecture of the application.</p>
      <p>Check the server logs and network response for detailed test results.</p>
      
      {data && (
        <div>
          <h2>Test Results</h2>
          <pre style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '4px', overflow: 'auto' }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
} 