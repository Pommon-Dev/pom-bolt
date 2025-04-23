import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectStorageService, StorageServiceError, getProjectStorageService } from '../storage-service';
import { getProjectStateManager } from '../state-manager';
import type { ProjectState, ProjectFile } from '../types';

// Mock the project state manager
vi.mock('../state-manager', () => ({
  getProjectStateManager: vi.fn(),
}));

describe('ProjectStorageService', () => {
  let storageService: ProjectStorageService;
  let mockProjectManager: any;

  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();

    // Create a mock project manager
    mockProjectManager = {
      getProject: vi.fn(),
      getProjectFiles: vi.fn(),
      projectExists: vi.fn(),
      deleteProject: vi.fn(),
      saveProjectFiles: vi.fn(),
    };

    // Set up the mock to return our mock project manager
    (getProjectStateManager as any).mockReturnValue(mockProjectManager);

    // Get a fresh instance of the storage service
    storageService = getProjectStorageService();
  });

  describe('getProject', () => {
    it('should throw an error if projectId is not provided', async () => {
      await expect(storageService.getProject('')).rejects.toThrow(StorageServiceError);
      await expect(storageService.getProject('')).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('should return the project from the project manager', async () => {
      const mockProject: ProjectState = {
        id: 'test-project',
        name: 'Test Project',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        files: [],
        requirements: [],
        deployments: [],
      };

      mockProjectManager.getProject.mockResolvedValue(mockProject);

      const result = await storageService.getProject('test-project');
      expect(result).toEqual(mockProject);
      expect(mockProjectManager.getProject).toHaveBeenCalledWith('test-project');
    });

    it('should throw a StorageServiceError if the project manager throws an error', async () => {
      const error = new Error('Test error');
      mockProjectManager.getProject.mockRejectedValue(error);

      await expect(storageService.getProject('test-project')).rejects.toThrow(StorageServiceError);
      await expect(storageService.getProject('test-project')).rejects.toMatchObject({
        code: 'GET_PROJECT_ERROR',
      });
    });
  });

  describe('getProjectFiles', () => {
    it('should throw an error if projectId is not provided', async () => {
      await expect(storageService.getProjectFiles('')).rejects.toThrow(StorageServiceError);
      await expect(storageService.getProjectFiles('')).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('should return the project files from the project manager', async () => {
      const mockFiles: ProjectFile[] = [
        {
          path: 'src/index.ts',
          content: 'console.log("Hello, world!");',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isDeleted: false,
        },
      ];

      mockProjectManager.getProjectFiles.mockResolvedValue(mockFiles);

      const result = await storageService.getProjectFiles('test-project');
      expect(result).toEqual(mockFiles);
      expect(mockProjectManager.getProjectFiles).toHaveBeenCalledWith('test-project');
    });

    it('should throw a StorageServiceError if the project manager throws an error', async () => {
      const error = new Error('Test error');
      mockProjectManager.getProjectFiles.mockRejectedValue(error);

      await expect(storageService.getProjectFiles('test-project')).rejects.toThrow(StorageServiceError);
      await expect(storageService.getProjectFiles('test-project')).rejects.toMatchObject({
        code: 'GET_PROJECT_FILES_ERROR',
      });
    });
  });

  describe('cacheProjectFiles', () => {
    it('should throw an error if projectId is not provided', async () => {
      await expect(storageService.cacheProjectFiles('', {})).rejects.toThrow(StorageServiceError);
      await expect(storageService.cacheProjectFiles('', {})).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('should throw an error if files is empty', async () => {
      await expect(storageService.cacheProjectFiles('test-project', {})).rejects.toThrow(StorageServiceError);
      await expect(storageService.cacheProjectFiles('test-project', {})).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('should call saveProjectFiles on the project manager', async () => {
      const files = {
        'src/index.ts': 'console.log("Hello, world!");',
      };

      mockProjectManager.saveProjectFiles.mockResolvedValue(undefined);

      await storageService.cacheProjectFiles('test-project', files);
      expect(mockProjectManager.saveProjectFiles).toHaveBeenCalledWith('test-project', expect.any(Array));
      expect(mockProjectManager.saveProjectFiles.mock.calls[0][1][0]).toMatchObject({
        path: 'src/index.ts',
        content: 'console.log("Hello, world!");',
      });
    });

    it('should throw a StorageServiceError if the project manager throws an error', async () => {
      const error = new Error('Test error');
      mockProjectManager.saveProjectFiles.mockRejectedValue(error);

      await expect(storageService.cacheProjectFiles('test-project', { 'src/index.ts': 'content' })).rejects.toThrow(
        StorageServiceError
      );
      await expect(storageService.cacheProjectFiles('test-project', { 'src/index.ts': 'content' })).rejects.toMatchObject({
        code: 'CACHE_FILES_ERROR',
      });
    });
  });
}); 