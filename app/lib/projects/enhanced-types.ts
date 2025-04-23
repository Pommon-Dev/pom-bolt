import type { ProjectState, ProjectFile, RequirementsEntry, ProjectDeployment } from './types';

/**
 * Enhanced project metadata with additional fields
 */
export interface EnhancedProjectMetadata {
  version: string;
  type: string;
  description?: string;
  tags?: string[];
  owner?: string;
  visibility?: 'public' | 'private';
  lastModifiedBy?: string;
  customFields?: Record<string, any>;
}

/**
 * Enhanced requirements entry with additional fields
 */
export interface EnhancedRequirementsEntry extends RequirementsEntry {
  status: 'pending' | 'approved' | 'rejected';
  priority: 'low' | 'medium' | 'high';
  assignedTo?: string;
  comments?: string[];
  attachments?: string[];
  customFields?: Record<string, any>;
}

/**
 * Enhanced project file with additional metadata
 */
export interface EnhancedProjectFile extends ProjectFile {
  size: number;
  mimeType: string;
  hash: string;
  lastModifiedBy?: string;
  version: number;
  tags?: string[];
  customFields?: Record<string, any>;
}

/**
 * Enhanced deployment with additional tracking
 */
export interface EnhancedProjectDeployment extends ProjectDeployment {
  environment: string;
  branch: string;
  commitMessage?: string;
  buildTime?: number;
  customDomain?: string;
  customFields?: Record<string, any>;
}

/**
 * Enhanced project state with additional features
 */
export interface EnhancedProjectState extends ProjectState {
  metadata: EnhancedProjectMetadata;
  files: EnhancedProjectFile[];
  requirements: EnhancedRequirementsEntry[];
  deployments: EnhancedProjectDeployment[];
  webhooks: any[]; // Webhooks associated with this project
  version: number;
  status: 'active' | 'archived' | 'deleted';
  lastBackup?: number;
  customFields?: Record<string, any>;
  searchIndex: {
    keywords: string[];
    features: string[];
    technologies: string[];
  };
}

/**
 * Enhanced metadata for projects
 */
export interface ProjectMetadata {
  version: number;
  type: 'feature' | 'bugfix' | 'enhancement' | 'new-project';
  description: string;
  tags: string[];
  priority?: 'low' | 'medium' | 'high';
  dependencies?: string[];
  searchIndex: {
    keywords: string[];
    features: string[];
    technologies: string[];
  };
  repository?: {
    url: string;
    branch: string;
    name: string;
  };
  deployment?: {
    provider: string;
    site?: {
      url: string;
      id: string;
    };
  };
  llmContext?: {
    model: string;
    provider: string;
    promptId?: string;
    contextOptimization?: boolean;
  };
}

/**
 * Options for searching projects
 */
export interface SearchProjectsOptions {
  query: string;
  filters?: {
    tags?: string[];
    type?: ProjectMetadata['type'];
    priority?: ProjectMetadata['priority'];
    dateRange?: {
      start: number;
      end: number;
    };
    technologies?: string[];
  };
  pagination?: {
    limit: number;
    offset: number;
  };
  sort?: {
    field: 'createdAt' | 'updatedAt' | 'name' | 'priority';
    direction: 'asc' | 'desc';
  };
}

/**
 * Enhanced storage adapter with new capabilities
 */
export interface EnhancedProjectStorageAdapter {
  // Existing methods from ProjectStorageAdapter
  saveProject(project: EnhancedProjectState): Promise<void>;
  getProject(id: string): Promise<EnhancedProjectState | null>;
  deleteProject(id: string): Promise<boolean>;
  projectExists(id: string): Promise<boolean>;
  
  // Enhanced methods
  searchProjects(options: SearchProjectsOptions): Promise<{
    projects: EnhancedProjectState[];
    total: number;
  }>;
  
  updateProjectMetadata(
    id: string, 
    metadata: Partial<ProjectMetadata>
  ): Promise<void>;
  
  updateSearchIndex(
    id: string,
    searchIndex: EnhancedProjectState['searchIndex']
  ): Promise<void>;
  
  getFileChunk(
    projectId: string,
    filePath: string,
    chunkIndex: number
  ): Promise<string | null>;
  
  saveFileChunk(
    projectId: string,
    filePath: string,
    chunkIndex: number,
    content: string
  ): Promise<void>;
  
  getCacheValue<T>(
    projectId: string,
    key: string
  ): Promise<T | null>;
  
  setCacheValue<T>(
    projectId: string,
    key: string,
    value: T,
    ttl?: number
  ): Promise<void>;
  
  invalidateCache(
    projectId: string,
    keys?: string[]
  ): Promise<void>;
} 