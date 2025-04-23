import '../test/setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StorageTest } from '../components/storage-test';
import { ProjectStorageService, getProjectStorageService } from '../lib/projects/storage-service';
import { ProjectStateManager } from '../lib/projects/state-manager';
import { ProjectStorageService as PersistenceStorageService } from '../lib/projects/persistence/storage-service';
import type { ProjectFile, ProjectState } from '../lib/projects/types';
import type { EnhancedProjectState } from '../lib/projects/enhanced-types';

// Mock D1 and KV storage
const mockD1Db = {
  prepare: vi.fn(),
  batch: vi.fn(),
  exec: vi.fn()
};

const mockKVStorage = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn()
};

describe('Storage Service Tests', () => {
  let stateManager: ProjectStateManager;
  let storageService: ProjectStorageService;
  let persistenceService: PersistenceStorageService;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Initialize services
    stateManager = new ProjectStateManager();
    storageService = getProjectStorageService();
    persistenceService = new PersistenceStorageService(
      mockD1Db as any,
      mockKVStorage as any,
      mockKVStorage as any
    );
  });

  describe('Project State Operations', () => {
    it('should create and retrieve a project', async () => {
      const projectName = 'test-project';
      const initialRequirements = 'Build a test project';
      
      const createdProject = await stateManager.createProject({
        name: projectName,
        initialRequirements,
        userId: 'test-user'
      });

      expect(createdProject.name).toBe(projectName);
      expect(createdProject.requirements[0].content).toBe(initialRequirements);
      
      const retrievedProject = await stateManager.getProject(createdProject.id);
      expect(retrievedProject).toEqual(createdProject);
    });

    it('should handle file operations correctly', async () => {
      const project = await stateManager.createProject({
        name: 'file-test-project',
        userId: 'test-user'
      });

      const testFiles = {
        'test.txt': 'test content',
        'src/index.ts': 'console.log("Hello World");'
      };

      const addedFiles = await stateManager.addFiles(project.id, testFiles);
      expect(addedFiles.length).toBe(2);
      expect(addedFiles.some(f => f.path === 'test.txt')).toBe(true);
      expect(addedFiles.some(f => f.path === 'src/index.ts')).toBe(true);

      const retrievedFiles = await stateManager.getProjectFiles(project.id);
      expect(retrievedFiles.length).toBe(2);
      expect(retrievedFiles[0].content).toBe('test content');
      expect(retrievedFiles[1].content).toBe('console.log("Hello World");');
    });
  });

  describe('Project Updates', () => {
    it('should update project requirements', async () => {
      const project = await stateManager.createProject({
        name: 'update-test-project',
        initialRequirements: 'Initial requirements',
        userId: 'test-user'
      });

      const newRequirements = 'Updated requirements';
      const updateResult = await stateManager.updateProject(project.id, {
        newRequirements
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.project.requirements.length).toBe(2);
      expect(updateResult.project.requirements[1].content).toBe(newRequirements);
    });

    it('should handle file updates and deletions', async () => {
      const project = await stateManager.createProject({
        name: 'file-update-test',
        userId: 'test-user'
      });

      // Add initial files
      await stateManager.addFiles(project.id, {
        'test.txt': 'initial content',
        'keep.txt': 'keep this file'
      });

      // Update one file and delete another
      const updateResult = await stateManager.updateProject(project.id, {
        updatedFiles: [{
          path: 'test.txt',
          content: 'updated content',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }],
        deletedFilePaths: ['keep.txt']
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.updatedFiles.length).toBe(1);
      expect(updateResult.deletedFiles.length).toBe(1);

      const remainingFiles = await stateManager.getProjectFiles(project.id);
      expect(remainingFiles.length).toBe(1);
      expect(remainingFiles[0].content).toBe('updated content');
    });
  });

  describe('Persistence Layer', () => {
    it('should save and retrieve project with file chunks', async () => {
      const mockProject: EnhancedProjectState = {
        id: 'test-persistence',
        name: 'Test Persistence Project',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        files: [{
          path: 'test.txt',
          content: 'test content',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isDeleted: false,
          chunks: 1,
          hash: 'test-hash',
          size: 12
        }],
        requirements: [],
        deployments: [],
        metadata: {
          version: 1,
          type: 'new-project',
          description: 'Test project',
          tags: [],
          searchIndex: {
            keywords: [],
            features: [],
            technologies: []
          }
        }
      };

      // Mock D1 and KV responses
      mockD1Db.prepare.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ success: true })
      });

      mockKVStorage.put.mockResolvedValue(undefined);
      mockKVStorage.get.mockResolvedValue('test content');

      // Save project
      await persistenceService.saveProject(mockProject);

      // Verify D1 was called
      expect(mockD1Db.prepare).toHaveBeenCalled();

      // Verify KV was called for file chunk
      expect(mockKVStorage.put).toHaveBeenCalled();

      // Retrieve project
      const retrievedProject = await persistenceService.getProject(mockProject.id);
      expect(retrievedProject).toBeDefined();
      expect(retrievedProject?.files[0].content).toBe('test content');
    });

    it('should handle file chunk operations', async () => {
      const projectId = 'test-chunks';
      const filePath = 'large-file.txt';
      const chunkIndex = 0;
      const chunkContent = 'chunk content';

      // Mock KV responses
      mockKVStorage.put.mockResolvedValue(undefined);
      mockKVStorage.get.mockResolvedValue(chunkContent);

      // Save chunk
      await persistenceService.saveFileChunk(projectId, filePath, chunkIndex, chunkContent);
      expect(mockKVStorage.put).toHaveBeenCalled();

      // Get chunk
      const retrievedChunk = await persistenceService.getFileChunk(projectId, filePath, chunkIndex);
      expect(retrievedChunk).toBe(chunkContent);
    });
  });
}); 