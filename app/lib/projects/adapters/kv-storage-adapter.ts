import type { ProjectState, ProjectStorageAdapter, CreateProjectOptions } from '../types';
import type { EnhancedProjectState } from '../enhanced-types';

export class KVStorageAdapter implements ProjectStorageAdapter {
  constructor(private kv: KVNamespace) {}

  async getProject(id: string): Promise<ProjectState | null> {
    const data = await this.kv.get(id);
    return data ? JSON.parse(data) : null;
  }

  async saveProject(project: EnhancedProjectState): Promise<void> {
    await this.kv.put(project.id, JSON.stringify(project));
  }

  async deleteProject(id: string): Promise<boolean> {
    await this.kv.delete(id);
    return true;
  }

  async projectExists(id: string): Promise<boolean> {
    const data = await this.kv.get(id);
    return data !== null;
  }

  async listProjects(options?: {
    userId?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'createdAt' | 'updatedAt';
    sortDirection?: 'asc' | 'desc';
  }): Promise<{
    projects: ProjectState[];
    total: number;
  }> {
    const list = await this.kv.list();
    let projects = await Promise.all(
      list.keys.map(async (key) => {
        const data = await this.kv.get(key.name);
        return data ? JSON.parse(data) : null;
      })
    );

    // Filter out null values and apply filters
    projects = projects.filter((p): p is ProjectState => p !== null);
    
    if (options?.userId) {
      projects = projects.filter(p => p.metadata.userId === options.userId);
    }

    // Apply sorting
    if (options?.sortBy) {
      projects.sort((a, b) => {
        const aVal = a[options.sortBy as keyof ProjectState];
        const bVal = b[options.sortBy as keyof ProjectState];
        const direction = options.sortDirection === 'asc' ? 1 : -1;
        return aVal < bVal ? -1 * direction : aVal > bVal ? 1 * direction : 0;
      });
    }

    // Apply pagination
    const total = projects.length;
    if (options?.offset) {
      projects = projects.slice(options.offset);
    }
    if (options?.limit) {
      projects = projects.slice(0, options.limit);
    }

    return { projects, total };
  }

  async createProject(options: CreateProjectOptions): Promise<ProjectState> {
    const project: ProjectState = {
      id: crypto.randomUUID(),
      name: options.name,
      metadata: options.metadata || {},
      files: [],
      requirements: [],
      deployments: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await this.saveProject(project as EnhancedProjectState);
    return project;
  }

  async updateProject(id: string, options: any): Promise<any> {
    const project = await this.getProject(id);
    if (!project) {
      throw new Error(`Project ${id} not found`);
    }

    const updatedProject = {
      ...project,
      ...options,
      updatedAt: Date.now()
    };

    await this.saveProject(updatedProject as EnhancedProjectState);
    return updatedProject;
  }

  async getFileChunk(projectId: string, filePath: string): Promise<string | null> {
    const key = `${projectId}:${filePath}`;
    return await this.kv.get(key);
  }

  async saveFileChunk(projectId: string, filePath: string, content: string): Promise<void> {
    const key = `${projectId}:${filePath}`;
    await this.kv.put(key, content);
  }

  async deleteFileChunk(projectId: string, filePath: string): Promise<void> {
    const key = `${projectId}:${filePath}`;
    await this.kv.delete(key);
  }

  async deleteFileChunks(projectId: string): Promise<void> {
    const list = await this.kv.list({ prefix: `${projectId}:` });
    await Promise.all(list.keys.map(key => this.kv.delete(key.name)));
  }
} 