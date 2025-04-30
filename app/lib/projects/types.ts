/**
 * Project state management types
 * Defines the core interfaces for project state, storage, and requirements history
 */

/**
 * GitHub repository information for projects
 */
export interface GitHubRepositoryInfo {
  owner: string;            // GitHub username or organization
  repo: string;             // Repository name
  fullName: string;         // Full repository name (owner/repo)
  url: string;              // Repository URL
  defaultBranch: string;    // Default branch (usually 'main' or 'master')
  isPrivate: boolean;       // Whether the repository is private
  commitSha?: string;       // Latest commit SHA
}

/**
 * Represents the state of a project file
 */
export interface ProjectFile {
  path: string;         // Relative path of the file
  content: string;      // Content of the file
  createdAt: number;    // Timestamp when the file was created
  updatedAt: number;    // Timestamp when the file was last updated
  isDeleted?: boolean;  // Whether the file has been deleted
}

/**
 * Represents a requirements entry for a project
 */
export interface RequirementsEntry {
  id: string;           // Unique ID for this requirements entry
  content: string;      // The actual requirements content
  timestamp: number;    // When the requirements were submitted
  userId?: string;      // Optional ID of the user who submitted the requirements
  metadata?: Record<string, any>; // Additional metadata about this requirements entry
}

/**
 * Represents a deployment of a project
 */
export interface ProjectDeployment {
  id: string;           // Unique ID for this deployment
  url: string;          // URL where the deployment can be accessed
  provider: string;     // The provider used for deployment (e.g., 'cloudflare', 'vercel')
  timestamp: number;    // When the deployment was created
  status: 'success' | 'failed' | 'in-progress'; // Current status of the deployment
  errorMessage?: string; // Error message if deployment failed
  metadata?: Record<string, any>; // Additional metadata about this deployment
}

/**
 * Represents the complete state of a project
 */
export interface ProjectState {
  id: string;           // Unique ID for this project
  name: string;         // Human-readable name of the project
  createdAt: number;    // When the project was created
  updatedAt: number;    // When the project was last updated
  files: ProjectFile[]; // Files in the project
  requirements: RequirementsEntry[]; // History of requirements for this project
  deployments: ProjectDeployment[]; // History of deployments
  currentDeploymentId?: string; // ID of the current active deployment
  metadata?: Record<string, any>; // Additional metadata about this project
  webhooks?: any[]; // Webhooks associated with this project
  tenantId?: string; // ID of the tenant that owns this project
}

/**
 * Interface for storage providers that persist project state
 */
export interface ProjectStorageAdapter {
  /**
   * Save a project state
   */
  saveProject(project: ProjectState): Promise<void>;
  
  /**
   * Get a project by ID
   */
  getProject(id: string): Promise<ProjectState | null>;
  
  /**
   * List all projects, optionally filtered and paginated
   */
  listProjects(options?: {
    userId?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'createdAt' | 'updatedAt';
    sortDirection?: 'asc' | 'desc';
  }): Promise<{
    projects: ProjectState[];
    total: number;
  }>;
  
  /**
   * Delete a project
   */
  deleteProject(id: string): Promise<boolean>;
  
  /**
   * Check if a project exists
   */
  projectExists(id: string): Promise<boolean>;
}

/**
 * Options for creating a new project
 */
export interface CreateProjectOptions {
  name: string;         // Human-readable name of the project
  initialRequirements?: string; // Initial requirements for the project
  userId?: string;      // Optional ID of the user creating the project
  metadata?: Record<string, any>; // Additional metadata about the project
  tenantId?: string;    // ID of the tenant that will own the project
}

/**
 * Options for updating an existing project
 */
export interface UpdateProjectOptions {
  name?: string;        // New name for the project
  updatedFiles?: ProjectFile[]; // Files to update or add
  deletedFilePaths?: string[]; // Paths of files to delete
  newRequirements?: string; // New requirements to add
  metadata?: Record<string, any>; // Metadata to merge with existing metadata
  webhooks?: any[]; // Webhooks to add or update
}

/**
 * Result of a project update operation
 */
export interface ProjectUpdateResult {
  success: boolean;
  project: ProjectState;
  newFiles: ProjectFile[];
  updatedFiles: ProjectFile[];
  deletedFiles: ProjectFile[];
}

/**
 * Options for fetching files from a project
 */
export interface GetProjectFilesOptions {
  includePaths?: string[]; // Specific file paths to include
  excludePaths?: string[]; // Specific file paths to exclude
  includeDeleted?: boolean; // Whether to include deleted files
  pattern?: string | RegExp; // Pattern to match file paths
}

/**
 * Error types for project operations
 */
export enum ProjectErrorType {
  NOT_FOUND = 'PROJECT_NOT_FOUND',
  ALREADY_EXISTS = 'PROJECT_ALREADY_EXISTS',
  INVALID_ID = 'INVALID_PROJECT_ID',
  STORAGE_ERROR = 'STORAGE_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  UNKNOWN = 'UNKNOWN_ERROR'
} 