import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { runRequirementsChain } from '../requirements-chain';
import { getProjectStateManager, resetProjectStateManager } from '~/lib/projects';
import { getDeploymentManager } from '~/lib/deployment';

// Mock the deployment manager
vi.mock('~/lib/deployment', () => ({
  getDeploymentManager: vi.fn(() => ({
    getAvailableTargets: vi.fn().mockResolvedValue(['test-target']),
    deployProject: vi.fn().mockResolvedValue({
      id: 'test-deployment-id',
      url: 'https://test-deployment.example.com',
      status: 'success',
      provider: 'test-target'
    }),
    deployWithBestTarget: vi.fn().mockResolvedValue({
      id: 'test-deployment-id',
      url: 'https://test-deployment.example.com',
      status: 'success',
      provider: 'test-target'
    })
  }))
}));

describe('Requirements API Integration', () => {
  beforeEach(() => {
    // Reset the project state manager before each test
    resetProjectStateManager();
  });

  afterEach(() => {
    // Clear mocks after each test
    vi.clearAllMocks();
  });

  test('should create a new project from requirements', async () => {
    // Create a mock request for a new project
    const request = new Request('http://localhost/api/requirements', {
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
    const result = await runRequirementsChain(request);

    // Verify the result
    expect(result.error).toBeUndefined();
    expect(result.projectId).toBeDefined();
    expect(result.isNewProject).toBe(true);
    expect(result.files).toBeDefined();
    expect(Object.keys(result.files || {})).toHaveLength(3); // Sample project has 3 files

    // Check that the project was actually created
    const projectManager = getProjectStateManager();
    const project = await projectManager.getProject(result.projectId);
    expect(project).toBeDefined();
    expect(project.requirements).toHaveLength(1);
    expect(project.files).toHaveLength(3);
  });

  test('should update an existing project from requirements', async () => {
    // First create a project
    const projectManager = getProjectStateManager();
    const project = await projectManager.createProject({
      name: 'Test Project',
      initialRequirements: 'Create a simple website.'
    });

    // Add some files to the project
    await projectManager.addFiles(project.id, {
      'index.html': '<html><body>Hello</body></html>',
      'style.css': 'body { color: blue; }'
    });

    // Now create a request to update it
    const request = new Request('http://localhost/api/requirements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        projectId: project.id,
        content: 'Add a contact form to the website.',
        shouldDeploy: false
      })
    });

    // Run the middleware chain
    const result = await runRequirementsChain(request);

    // Verify the result
    expect(result.error).toBeUndefined();
    expect(result.projectId).toBe(project.id);
    expect(result.isNewProject).toBe(false);
    expect(result.files).toBeDefined();

    // Check that the project was actually updated
    const updatedProject = await projectManager.getProject(project.id);
    expect(updatedProject.requirements).toHaveLength(2);
    expect(updatedProject.files.length).toBeGreaterThan(2); // Should have added or updated files
  });

  test('should deploy a project when requested', async () => {
    // Create a mock request for a new project with deployment
    const request = new Request('http://localhost/api/requirements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Create a landing page for a coffee shop.',
        shouldDeploy: true
      })
    });

    // Run the middleware chain
    const result = await runRequirementsChain(request);

    // Verify the result includes deployment information
    expect(result.error).toBeUndefined();
    expect(result.deploymentResult).toBeDefined();
    expect(result.deploymentResult?.url).toBe('https://test-deployment.example.com');
    expect(result.deploymentResult?.status).toBe('success');

    // Verify the deployment was saved to the project
    const projectManager = getProjectStateManager();
    const project = await projectManager.getProject(result.projectId);
    expect(project.deployments).toHaveLength(1);
    expect(project.deployments[0].url).toBe('https://test-deployment.example.com');
  });

  test('should handle deployment errors gracefully', async () => {
    // Mock a deployment failure
    const deploymentManager = getDeploymentManager();
    (deploymentManager.deployProject as any).mockRejectedValueOnce(
      new Error('Deployment failed')
    );

    // Create a mock request with deployment
    const request = new Request('http://localhost/api/requirements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Create a landing page.',
        shouldDeploy: true
      })
    });

    // Run the middleware chain
    const result = await runRequirementsChain(request);

    // Verify the result - should have error but still created the project
    expect(result.error).toBeDefined();
    expect(result.error?.message).toBe('Deployment failed');
    expect(result.projectId).toBeDefined();
    expect(result.files).toBeDefined();

    // Project should still be created despite deployment failure
    const projectManager = getProjectStateManager();
    const project = await projectManager.getProject(result.projectId);
    expect(project).toBeDefined();
    expect(project.deployments).toHaveLength(0); // No deployment should be saved
  });
}); 