import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  parseRequest, 
  loadProjectContext, 
  processRequirements, 
  handleDeployment,
  runRequirementsChain 
} from '../requirements-chain';
import type { RequirementsContext } from '../requirements-chain';

// Mock project state manager
vi.mock('~/lib/projects', () => ({
  getProjectStateManager: vi.fn(() => ({
    projectExists: vi.fn().mockResolvedValue(true),
    getProject: vi.fn().mockResolvedValue({
      id: 'test-project',
      name: 'Test Project',
      files: [],
      requirements: [],
      deployments: []
    }),
    createProject: vi.fn().mockImplementation(async (options) => ({
      id: 'new-project-id',
      name: options.name || 'New Project',
      files: [],
      requirements: [
        {
          id: 'req-1',
          content: options.initialRequirements || '',
          timestamp: Date.now()
        }
      ],
      deployments: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    })),
    updateProject: vi.fn().mockResolvedValue(true),
    getProjectFiles: vi.fn().mockResolvedValue([
      { path: 'index.html', content: '<html></html>' },
      { path: 'style.css', content: 'body {}' }
    ]),
    addDeployment: vi.fn().mockResolvedValue(true)
  }))
}));

// Mock deployment manager
vi.mock('~/lib/deployment', () => ({
  getDeploymentManager: vi.fn(() => ({
    deployProject: vi.fn().mockResolvedValue({
      id: 'deployment-1',
      url: 'https://test-deployment.com',
      status: 'success',
      logs: ['Deployment completed'],
      provider: 'mock'
    }),
    deployWithBestTarget: vi.fn().mockResolvedValue({
      id: 'deployment-1',
      url: 'https://test-deployment.com',
      status: 'success',
      logs: ['Deployment completed'],
      provider: 'mock'
    })
  }))
}));

// Mock project context middleware
vi.mock('../project-context', () => ({
  handleProjectContext: vi.fn().mockResolvedValue({
    projectId: 'test-project',
    isNewProject: false,
    project: {
      id: 'test-project',
      name: 'Test Project',
      files: [],
      requirements: [],
      deployments: []
    }
  })
}));

// Mock logger
vi.mock('~/utils/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

// Helper to create mock request
function createMockRequest(body: any, contentType = 'application/json'): Request {
  return {
    headers: {
      get: vi.fn().mockImplementation((key) => {
        if (key.toLowerCase() === 'content-type') {
          return contentType;
        }
        return null;
      })
    },
    json: vi.fn().mockResolvedValue(body),
    formData: vi.fn().mockResolvedValue(
      new Map(Object.entries(body))
    ),
    clone: vi.fn().mockReturnThis()
  } as unknown as Request;
}

describe('Requirements Middleware Chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('parseRequest', () => {
    it('should parse JSON request with content field', async () => {
      const request = createMockRequest({
        content: 'Test requirements',
        projectId: 'test-project',
        userId: 'user-1',
        deploy: true
      });

      const result = await parseRequest(null, request);

      expect(result).toBeDefined();
      expect(result?.content).toBe('Test requirements');
      expect(result?.projectId).toBe('');
      expect(result?.userId).toBe('user-1');
      expect(result?.shouldDeploy).toBe(true);
    });

    it('should parse JSON request with requirements field', async () => {
      const request = createMockRequest({
        requirements: 'Test requirements',
        projectId: 'test-project'
      });

      const result = await parseRequest(null, request);

      expect(result).toBeDefined();
      expect(result?.content).toBe('Test requirements');
    });

    it('should throw error if content is missing', async () => {
      const request = createMockRequest({
        projectId: 'test-project'
      });

      await expect(parseRequest(null, request)).rejects.toThrow();
    });
  });

  describe('loadProjectContext', () => {
    it('should load project context and merge with existing context', async () => {
      const request = createMockRequest({
        content: 'Test requirements',
        projectId: 'test-project'
      });

      const context: RequirementsContext = {
        content: 'Test requirements',
        projectId: '',
        isNewProject: true,
        shouldDeploy: true,
        deploymentTarget: 'mock-target'
      };

      const result = await loadProjectContext(context, request);

      expect(result).toBeDefined();
      expect(result.projectId).toBe('test-project');
      expect(result.isNewProject).toBe(false);
      expect(result.content).toBe('Test requirements');
      expect(result.shouldDeploy).toBe(true);
      expect(result.deploymentTarget).toBe('mock-target');
    });
  });

  describe('processRequirements', () => {
    it('should process requirements for an existing project', async () => {
      const request = createMockRequest({});
      const context: RequirementsContext = {
        content: 'Updated requirements',
        projectId: 'test-project',
        isNewProject: false,
        shouldDeploy: true
      };

      const result = await processRequirements(context, request);

      expect(result).toBeDefined();
      expect(result.files).toBeDefined();
      expect(Object.keys(result.files || {})).toHaveLength(2);
      expect(result.files?.['index.html']).toBe('<html></html>');
    });

    it('should create a new project if needed', async () => {
      const request = createMockRequest({});
      const context: RequirementsContext = {
        content: 'New project requirements',
        projectId: 'new-project',
        isNewProject: true,
        shouldDeploy: true
      };

      const result = await processRequirements(context, request);

      expect(result).toBeDefined();
      expect(result.projectId).toBe('new-project-id');
    });
  });

  describe('handleDeployment', () => {
    it('should deploy project when shouldDeploy is true', async () => {
      const request = createMockRequest({});
      const context: RequirementsContext = {
        content: 'Test requirements',
        projectId: 'test-project',
        isNewProject: false,
        shouldDeploy: true,
        files: {
          'index.html': '<html></html>',
          'style.css': 'body {}'
        },
        project: {
          id: 'test-project',
          name: 'Test Project',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          files: [],
          requirements: [],
          deployments: []
        }
      };

      const result = await handleDeployment(context, request);

      expect(result).toBeDefined();
      expect(result.deploymentResult).toBeDefined();
      expect(result.deploymentResult?.url).toBe('https://test-deployment.com');
      expect(result.deploymentResult?.status).toBe('success');
    });

    it('should skip deployment when shouldDeploy is false', async () => {
      const request = createMockRequest({});
      const context: RequirementsContext = {
        content: 'Test requirements',
        projectId: 'test-project',
        isNewProject: false,
        shouldDeploy: false,
        files: {
          'index.html': '<html></html>',
          'style.css': 'body {}'
        }
      };

      const result = await handleDeployment(context, request);

      expect(result).toBeDefined();
      expect(result.deploymentResult).toBeUndefined();
    });
  });

  describe('runRequirementsChain', () => {
    it('should run the complete middleware chain', async () => {
      const request = createMockRequest({
        content: 'Complete chain test',
        projectId: 'test-project',
        deploy: true
      });

      const result = await runRequirementsChain(request);

      expect(result).toBeDefined();
      expect(result.content).toBe('Complete chain test');
      expect(result.projectId).toBe('test-project');
      expect(result.deploymentResult).toBeDefined();
      expect(result.deploymentResult?.url).toBe('https://test-deployment.com');
    });

    it('should handle errors in the middleware chain', async () => {
      const request = createMockRequest({
        // Missing content field should cause an error
        projectId: 'test-project'
      });

      const result = await runRequirementsChain(request);

      expect(result).toBeDefined();
      expect(result.error).toBeDefined();
    });
  });
}); 