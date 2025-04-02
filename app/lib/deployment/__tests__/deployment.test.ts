import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  DeploymentManager,
  resetDeploymentManager,
  BaseDeploymentTarget,
  ZipPackager
} from '~/lib/deployment';
import type { 
  DeploymentTarget,
  ProjectOptions, 
  ProjectMetadata, 
  DeployOptions, 
  UpdateOptions, 
  DeploymentResult, 
  DeploymentStatus 
} from '~/lib/deployment';

// Mock environment
vi.mock('~/lib/environments', () => ({
  getEnvironment: vi.fn(() => ({
    getInfo: vi.fn(() => ({ type: 'local' }))
  })),
  EnvironmentType: {
    LOCAL: 'local',
    CLOUDFLARE: 'cloudflare'
  }
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

// Mock deployment target for testing
class MockDeploymentTarget extends BaseDeploymentTarget {
  private available = true;
  private projectData: Record<string, ProjectMetadata> = {};
  private deploymentData: Record<string, DeploymentResult> = {};
  
  constructor(available = true) {
    super();
    this.available = available;
  }
  
  getName(): string {
    return 'mock-target';
  }
  
  getProviderType(): string {
    return 'mock';
  }
  
  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  
  setAvailable(available: boolean): void {
    this.available = available;
  }
  
  async projectExists(projectName: string): Promise<boolean> {
    const sanitizedName = this.sanitizeProjectName(projectName);
    return sanitizedName in this.projectData;
  }
  
  async initializeProject(options: ProjectOptions): Promise<ProjectMetadata> {
    const sanitizedName = this.sanitizeProjectName(options.name);
    
    const projectMetadata: ProjectMetadata = {
      id: `mock-project-${sanitizedName}`,
      name: sanitizedName,
      url: `https://${sanitizedName}.example.com`,
      provider: this.getProviderType(),
      metadata: options.metadata
    };
    
    this.projectData[sanitizedName] = projectMetadata;
    
    return projectMetadata;
  }
  
  async deploy(options: DeployOptions): Promise<DeploymentResult> {
    const deploymentId = `deploy-${Date.now()}`;
    
    const result: DeploymentResult = {
      id: deploymentId,
      url: `https://${options.projectName}-${deploymentId}.example.com`,
      status: 'success',
      logs: ['Deployment successful'],
      provider: this.getProviderType(),
      metadata: options.metadata
    };
    
    this.deploymentData[deploymentId] = result;
    
    return result;
  }
  
  async update(options: UpdateOptions): Promise<DeploymentResult> {
    return this.deploy(options);
  }
  
  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    const deployment = this.deploymentData[deploymentId];
    
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }
    
    return {
      id: deployment.id,
      url: deployment.url,
      status: deployment.status,
      logs: deployment.logs,
      createdAt: Date.now() - 1000,
      completedAt: Date.now(),
      metadata: deployment.metadata
    };
  }
  
  async removeDeployment(deploymentId: string): Promise<boolean> {
    if (!(deploymentId in this.deploymentData)) {
      return false;
    }
    
    delete this.deploymentData[deploymentId];
    return true;
  }
}

describe('Deployment System', () => {
  beforeEach(() => {
    resetDeploymentManager();
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });
  
  describe('DeploymentManager', () => {
    it('should register deployment targets', () => {
      const manager = new DeploymentManager();
      
      manager.registerTarget('mock', new MockDeploymentTarget());
      
      expect(manager.getRegisteredTargets()).toContain('mock');
    });
    
    it('should get available targets', async () => {
      const manager = new DeploymentManager();
      
      manager.registerTarget('mock-available', new MockDeploymentTarget(true));
      manager.registerTarget('mock-unavailable', new MockDeploymentTarget(false));
      
      const available = await manager.getAvailableTargets();
      
      expect(available).toContain('mock-available');
      expect(available).not.toContain('mock-unavailable');
    });
    
    it('should initialize a project with a target', async () => {
      const manager = new DeploymentManager();
      const mockTarget = new MockDeploymentTarget();
      manager.registerTarget('mock', mockTarget);
      
      const projectMetadata = await manager.initializeProject('mock', {
        name: 'test-project'
      });
      
      expect(projectMetadata.name).toBe('test-project');
      expect(projectMetadata.provider).toBe('mock');
      expect(projectMetadata.url).toBe('https://test-project.example.com');
    });
    
    it('should deploy a project with a target', async () => {
      const manager = new DeploymentManager();
      const mockTarget = new MockDeploymentTarget();
      manager.registerTarget('mock', mockTarget);
      
      const result = await manager.deployProject('mock', {
        projectId: 'mock-project-test',
        projectName: 'test-project',
        files: {
          'index.html': '<html><body>Hello World</body></html>',
          'style.css': 'body { color: blue; }'
        }
      });
      
      expect(result.status).toBe('success');
      expect(result.provider).toBe('mock');
      expect(result.url).toContain('test-project');
    });
    
    it('should deploy with the best available target', async () => {
      const manager = new DeploymentManager({
        preferredTargets: ['mock-preferred', 'mock-available']
      });
      
      manager.registerTarget('mock-unavailable', new MockDeploymentTarget(false));
      manager.registerTarget('mock-available', new MockDeploymentTarget(true));
      manager.registerTarget('mock-preferred', new MockDeploymentTarget(true));
      
      const result = await manager.deployWithBestTarget({
        projectName: 'test-project',
        files: {
          'index.html': '<html><body>Hello World</body></html>',
          'style.css': 'body { color: blue; }'
        }
      });
      
      expect(result.status).toBe('success');
      expect(result.provider).toBe('mock');
    });
    
    it('should throw an error when no targets are available', async () => {
      const manager = new DeploymentManager();
      manager.registerTarget('mock', new MockDeploymentTarget(false));
      
      await expect(manager.deployWithBestTarget({
        projectName: 'test-project',
        files: {}
      })).rejects.toThrow('No deployment targets available');
    });
  });
  
  describe('ZipPackager', () => {
    it('should package files into a ZIP archive', async () => {
      const packager = new ZipPackager();
      
      const files = {
        'index.html': '<html><body>Hello World</body></html>',
        'style.css': 'body { color: blue; }',
        'js/script.js': 'console.log("Hello");'
      };
      
      const zipBuffer = await packager.package(files);
      
      expect(zipBuffer).toBeDefined();
      expect(zipBuffer instanceof ArrayBuffer).toBe(true);
      expect(zipBuffer.byteLength).toBeGreaterThan(0);
    });
    
    it('should filter files based on include/exclude options', async () => {
      const packager = new ZipPackager();
      
      const files = {
        'index.html': '<html><body>Hello World</body></html>',
        'style.css': 'body { color: blue; }',
        'js/script.js': 'console.log("Hello");',
        'assets/image.png': 'fake-image-data'
      };
      
      // Only include HTML and CSS files
      const zipBuffer1 = await packager.package(files, {
        includeFiles: ['index.html', 'style.css']
      });
      
      // Exclude JS files
      const zipBuffer2 = await packager.package(files, {
        excludeFiles: ['js/']
      });
      
      expect(zipBuffer1).toBeDefined();
      expect(zipBuffer2).toBeDefined();
      
      // We'd need to extract and check the ZIP contents for a more thorough test
      // which would require a separate JSZip instance to read the archive
    });
  });
}); 