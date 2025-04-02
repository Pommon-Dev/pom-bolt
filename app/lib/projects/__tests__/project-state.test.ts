import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProjectStateManager, LocalProjectStorage, resetProjectStateManager } from '~/lib/projects';
import type { ProjectState, ProjectFile } from '~/lib/projects';
import { getEnvironment, resetEnvironment, setEnvironment, LocalEnvironment } from '~/lib/environments';

// Mock logger
vi.mock('~/utils/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

describe('Project State Management', () => {
  // Set up a clean environment before each test
  beforeEach(() => {
    resetEnvironment();
    setEnvironment(new LocalEnvironment());
    resetProjectStateManager();
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });
  
  describe('ProjectStateManager', () => {
    it('should create a new project', async () => {
      const manager = new ProjectStateManager();
      const project = await manager.createProject({
        name: 'Test Project',
        initialRequirements: 'Build a React app with TypeScript'
      });
      
      expect(project).toBeDefined();
      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.requirements.length).toBe(1);
      expect(project.requirements[0].content).toBe('Build a React app with TypeScript');
      expect(project.files).toEqual([]);
    });
    
    it('should retrieve an existing project', async () => {
      const manager = new ProjectStateManager();
      const created = await manager.createProject({
        name: 'Test Project',
        initialRequirements: 'Build a React app with TypeScript'
      });
      
      const retrieved = await manager.getProject(created.id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe(created.name);
      expect(retrieved.requirements.length).toBe(created.requirements.length);
    });
    
    it('should update a project with new files', async () => {
      const manager = new ProjectStateManager();
      const created = await manager.createProject({
        name: 'Test Project',
        initialRequirements: 'Build a React app with TypeScript'
      });
      
      const files: ProjectFile[] = [
        {
          path: 'src/App.tsx',
          content: 'export default function App() { return <div>Hello World</div>; }',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          path: 'src/index.tsx',
          content: 'import React from "react"; import ReactDOM from "react-dom"; import App from "./App";',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];
      
      const updateResult = await manager.updateProject(created.id, {
        updatedFiles: files
      });
      
      expect(updateResult.success).toBe(true);
      expect(updateResult.newFiles.length).toBe(2);
      
      const retrieved = await manager.getProject(created.id);
      expect(retrieved.files.length).toBe(2);
      expect(retrieved.files.some(f => f.path === 'src/App.tsx')).toBe(true);
      expect(retrieved.files.some(f => f.path === 'src/index.tsx')).toBe(true);
    });
    
    it('should update a project with new requirements', async () => {
      const manager = new ProjectStateManager();
      const created = await manager.createProject({
        name: 'Test Project',
        initialRequirements: 'Build a React app with TypeScript'
      });
      
      await manager.updateProject(created.id, {
        newRequirements: 'Add a dark mode to the React app'
      });
      
      const retrieved = await manager.getProject(created.id);
      expect(retrieved.requirements.length).toBe(2);
      expect(retrieved.requirements[1].content).toBe('Add a dark mode to the React app');
    });
    
    it('should delete files from a project', async () => {
      const manager = new ProjectStateManager();
      const created = await manager.createProject({
        name: 'Test Project'
      });
      
      // Add files
      const files: ProjectFile[] = [
        {
          path: 'src/App.tsx',
          content: 'export default function App() { return <div>Hello World</div>; }',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          path: 'src/index.tsx',
          content: 'import React from "react"; import ReactDOM from "react-dom"; import App from "./App";',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];
      
      await manager.updateProject(created.id, {
        updatedFiles: files
      });
      
      // Delete one file
      const updateResult = await manager.updateProject(created.id, {
        deletedFilePaths: ['src/App.tsx']
      });
      
      expect(updateResult.deletedFiles.length).toBe(1);
      expect(updateResult.deletedFiles[0].path).toBe('src/App.tsx');
      
      // Get files with default options (excludes deleted files)
      const projectFiles = await manager.getProjectFiles(created.id);
      expect(projectFiles.length).toBe(1);
      expect(projectFiles[0].path).toBe('src/index.tsx');
      
      // Get all files including deleted
      const allFiles = await manager.getProjectFiles(created.id, { includeDeleted: true });
      expect(allFiles.length).toBe(2);
      
      // Verify deleted flag
      const deletedFile = allFiles.find(f => f.path === 'src/App.tsx');
      expect(deletedFile?.isDeleted).toBe(true);
    });
    
    it('should add a deployment to a project', async () => {
      const manager = new ProjectStateManager();
      const created = await manager.createProject({
        name: 'Test Project'
      });
      
      const deployment = await manager.addDeployment(created.id, {
        url: 'https://test-project.example.com',
        provider: 'cloudflare',
        timestamp: Date.now(),
        status: 'success'
      });
      
      expect(deployment).toBeDefined();
      expect(deployment.id).toBeDefined();
      expect(deployment.url).toBe('https://test-project.example.com');
      
      const retrieved = await manager.getProject(created.id);
      expect(retrieved.deployments.length).toBe(1);
      expect(retrieved.currentDeploymentId).toBe(deployment.id);
      
      // Get current deployment
      const currentDeployment = await manager.getCurrentDeployment(created.id);
      expect(currentDeployment).toBeDefined();
      expect(currentDeployment?.id).toBe(deployment.id);
    });
    
    it('should handle non-existent projects', async () => {
      const manager = new ProjectStateManager();
      
      await expect(manager.getProject('nonexistent-id')).rejects.toThrow();
      
      const exists = await manager.projectExists('nonexistent-id');
      expect(exists).toBe(false);
    });
  });
}); 