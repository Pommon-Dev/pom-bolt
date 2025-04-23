import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StorageTest } from '../storage-test';
import { getProjectStorageService } from '~/lib/projects/storage-service';
import type { ProjectState, ProjectFile } from '~/lib/projects/types';

// Mock the storage service
vi.mock('~/lib/projects/storage-service', () => ({
  getProjectStorageService: vi.fn(),
}));

describe('StorageTest', () => {
  let mockStorageService: any;

  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();

    // Create a mock storage service
    mockStorageService = {
      getProject: vi.fn(),
      getProjectFiles: vi.fn(),
      cacheProjectFiles: vi.fn(),
    };

    // Set up the mock to return our mock storage service
    (getProjectStorageService as any).mockReturnValue(mockStorageService);
  });

  it('renders the component with all inputs and buttons', () => {
    render(<StorageTest />);
    
    expect(screen.getByLabelText(/project id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/file path/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/file content/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cache files/i })).toBeInTheDocument();
  });

  it('loads a project successfully', async () => {
    const mockProject: ProjectState = {
      id: 'test-project',
      name: 'Test Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      files: [],
      requirements: [],
      deployments: [],
    };

    mockStorageService.getProject.mockResolvedValue(mockProject);

    render(<StorageTest />);
    
    const projectIdInput = screen.getByLabelText(/project id/i);
    const loadButton = screen.getByRole('button', { name: /load project/i });

    fireEvent.change(projectIdInput, { target: { value: 'test-project' } });
    fireEvent.click(loadButton);

    await waitFor(() => {
      expect(screen.getByText(/project loaded successfully/i)).toBeInTheDocument();
    });

    expect(mockStorageService.getProject).toHaveBeenCalledWith('test-project');
  });

  it('handles project load errors', async () => {
    mockStorageService.getProject.mockRejectedValue(new Error('Failed to load project'));

    render(<StorageTest />);
    
    const projectIdInput = screen.getByLabelText(/project id/i);
    const loadButton = screen.getByRole('button', { name: /load project/i });

    fireEvent.change(projectIdInput, { target: { value: 'test-project' } });
    fireEvent.click(loadButton);

    await waitFor(() => {
      expect(screen.getByText(/failed to load project/i)).toBeInTheDocument();
    });
  });

  it('caches files successfully', async () => {
    mockStorageService.cacheProjectFiles.mockResolvedValue(undefined);

    render(<StorageTest />);
    
    const projectIdInput = screen.getByLabelText(/project id/i);
    const filePathInput = screen.getByLabelText(/file path/i);
    const fileContentInput = screen.getByLabelText(/file content/i);
    const cacheButton = screen.getByRole('button', { name: /cache files/i });

    fireEvent.change(projectIdInput, { target: { value: 'test-project' } });
    fireEvent.change(filePathInput, { target: { value: 'src/index.ts' } });
    fireEvent.change(fileContentInput, { target: { value: 'console.log("Hello, world!");' } });
    fireEvent.click(cacheButton);

    await waitFor(() => {
      expect(screen.getByText(/files cached successfully/i)).toBeInTheDocument();
    });

    expect(mockStorageService.cacheProjectFiles).toHaveBeenCalledWith(
      'test-project',
      { 'src/index.ts': 'console.log("Hello, world!");' }
    );
  });

  it('handles file cache errors', async () => {
    mockStorageService.cacheProjectFiles.mockRejectedValue(new Error('Failed to cache files'));

    render(<StorageTest />);
    
    const projectIdInput = screen.getByLabelText(/project id/i);
    const filePathInput = screen.getByLabelText(/file path/i);
    const fileContentInput = screen.getByLabelText(/file content/i);
    const cacheButton = screen.getByRole('button', { name: /cache files/i });

    fireEvent.change(projectIdInput, { target: { value: 'test-project' } });
    fireEvent.change(filePathInput, { target: { value: 'src/index.ts' } });
    fireEvent.change(fileContentInput, { target: { value: 'console.log("Hello, world!");' } });
    fireEvent.click(cacheButton);

    await waitFor(() => {
      expect(screen.getByText(/failed to cache files/i)).toBeInTheDocument();
    });
  });

  it('displays project files when loaded', async () => {
    const mockFiles: ProjectFile[] = [
      {
        path: 'src/index.ts',
        content: 'console.log("Hello, world!");',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isDeleted: false,
      },
    ];

    mockStorageService.getProjectFiles.mockResolvedValue(mockFiles);

    render(<StorageTest />);
    
    const projectIdInput = screen.getByLabelText(/project id/i);
    const loadButton = screen.getByRole('button', { name: /load project/i });

    fireEvent.change(projectIdInput, { target: { value: 'test-project' } });
    fireEvent.click(loadButton);

    await waitFor(() => {
      expect(screen.getByText(/src\/index.ts/i)).toBeInTheDocument();
      expect(screen.getByText(/console.log\("Hello, world!"\);/i)).toBeInTheDocument();
    });
  });
}); 