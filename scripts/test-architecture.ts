import { getEnvironment } from '~/lib/environments';
import { getProjectStateManager } from '~/lib/projects';
import { getDeploymentManager } from '~/lib/deployment';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('architecture-test');

/**
 * Test the complete architecture locally
 */
async function testArchitecture() {
  logger.info('Starting architecture test...');

  // Test environment system
  const environment = getEnvironment();
  const envInfo = environment.getInfo();
  logger.info('Environment detected:', envInfo);

  // Test project state management
  const projectManager = getProjectStateManager();
  
  // Create a new test project
  const testProjectName = `Test Project ${new Date().toISOString()}`;
  logger.info(`Creating test project: ${testProjectName}`);
  
  const project = await projectManager.createProject({
    name: testProjectName,
    initialRequirements: 'Create a simple HTML page with a button that shows an alert when clicked.'
  });
  
  logger.info(`Created project with ID: ${project.id}`);
  
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
  
  // Get requirements history
  const requirements = await projectManager.getRequirementsHistory(project.id);
  logger.info(`Project has ${requirements.length} requirements entries`);
  
  // Test deployment system if available
  logger.info('Testing deployment system...');
  const deploymentManager = getDeploymentManager();
  const availableTargets = await deploymentManager.getAvailableTargets();
  
  logger.info(`Available deployment targets: ${availableTargets.length > 0 ? availableTargets.join(', ') : 'None'}`);
  
  if (availableTargets.length > 0) {
    try {
      logger.info('Attempting to deploy project...');
      
      // Convert project files to the format needed for deployment
      const fileMap = projectFiles.reduce((map, file) => {
        map[file.path] = file.content;
        return map;
      }, {} as Record<string, string>);
      
      // Deploy with the best available target
      const deployment = await deploymentManager.deployWithBestTarget({
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
    } catch (error) {
      logger.error('Deployment failed:', error);
    }
  }
  
  // Retrieve the project to see all updates
  const updatedProject = await projectManager.getProject(project.id);
  logger.info('Final project state:', {
    id: updatedProject.id,
    name: updatedProject.name, 
    fileCount: updatedProject.files.length,
    requirementsCount: updatedProject.requirements.length,
    deploymentsCount: updatedProject.deployments.length
  });
  
  logger.info('Architecture test completed successfully!');
}

// Run the test
testArchitecture().catch(error => {
  logger.error('Architecture test failed:', error);
  process.exit(1);
}); 