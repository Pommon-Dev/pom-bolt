import { createScopedLogger } from '~/utils/logger';
import type { D1Database } from '@cloudflare/workers-types';
import type { 
  EnhancedProjectState, 
  EnhancedProjectStorageAdapter,
  ProjectMetadata,
  SearchProjectsOptions
} from '../enhanced-types';

const logger = createScopedLogger('d1-project-storage');

/**
 * D1 database adapter for project metadata storage
 */
export class D1ProjectStorageAdapter implements EnhancedProjectStorageAdapter {
  private db: D1Database;
  
  constructor(db: D1Database) {
    this.db = db;
  }
  
  /**
   * Save a project state
   */
  async saveProject(project: EnhancedProjectState): Promise<void> {
    try {
      // Start a transaction
      const stmt = this.db.prepare(`
        INSERT INTO projects (id, name, description, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at
      `);
      
      await stmt.bind(
        project.id,
        project.name,
        project.metadata.description,
        JSON.stringify(project.metadata),
        project.createdAt,
        project.updatedAt
      ).run();
      
      // Update search index
      await this.updateSearchIndex(project.id, project.searchIndex);
      
      logger.info(`Project saved to D1: ${project.id}`);
    } catch (error) {
      logger.error(`Error saving project to D1: ${project.id}`, error);
      throw error;
    }
  }
  
  /**
   * Get a project by ID
   */
  async getProject(id: string): Promise<EnhancedProjectState | null> {
    try {
      const result = await this.db
        .prepare(`
          SELECT p.*, s.keywords, s.features, s.technologies, s.last_indexed
          FROM projects p
          LEFT JOIN search_index s ON p.id = s.project_id
          WHERE p.id = ?
        `)
        .bind(id)
        .first();
      
      if (!result) {
        return null;
      }
      
      // Convert D1 result to EnhancedProjectState
      const metadata = JSON.parse(result.metadata as string) as ProjectMetadata;
      
      return {
        id: result.id as string,
        name: result.name as string,
        createdAt: result.created_at as number,
        updatedAt: result.updated_at as number,
        metadata,
        files: [], // Files are stored in KV
        requirements: [], // Requirements are stored in KV
        deployments: [], // Deployments are stored in KV
        searchIndex: result.keywords ? {
          lastIndexed: result.last_indexed as number,
          keywords: (result.keywords as string).split(','),
          features: (result.features as string).split(','),
          technologies: (result.technologies as string).split(',')
        } : undefined
      };
    } catch (error) {
      logger.error(`Error getting project from D1: ${id}`, error);
      throw error;
    }
  }
  
  /**
   * Delete a project
   */
  async deleteProject(id: string): Promise<boolean> {
    try {
      const result = await this.db
        .prepare('DELETE FROM projects WHERE id = ?')
        .bind(id)
        .run();
      
      return result.success;
    } catch (error) {
      logger.error(`Error deleting project from D1: ${id}`, error);
      throw error;
    }
  }
  
  /**
   * Check if a project exists
   */
  async projectExists(id: string): Promise<boolean> {
    try {
      const result = await this.db
        .prepare('SELECT 1 FROM projects WHERE id = ?')
        .bind(id)
        .first();
      
      return !!result;
    } catch (error) {
      logger.error(`Error checking project existence in D1: ${id}`, error);
      throw error;
    }
  }
  
  /**
   * Search projects
   */
  async searchProjects(options: SearchProjectsOptions): Promise<{
    projects: EnhancedProjectState[];
    total: number;
  }> {
    try {
      let query = `
        SELECT p.*, s.keywords, s.features, s.technologies, s.last_indexed
        FROM projects p
        LEFT JOIN search_index s ON p.id = s.project_id
        WHERE 1=1
      `;
      
      const params: any[] = [];
      
      // Add search conditions
      if (options.query) {
        query += ` AND (
          p.name LIKE ? OR
          p.description LIKE ? OR
          s.keywords LIKE ? OR
          s.features LIKE ? OR
          s.technologies LIKE ?
        )`;
        const searchTerm = `%${options.query}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      }
      
      // Add filters
      if (options.filters?.tags?.length) {
        query += ` AND p.metadata LIKE ?`;
        params.push(`%${options.filters.tags.join('|')}%`);
      }
      
      if (options.filters?.type) {
        query += ` AND p.metadata LIKE ?`;
        params.push(`%"type":"${options.filters.type}"%`);
      }
      
      if (options.filters?.priority) {
        query += ` AND p.metadata LIKE ?`;
        params.push(`%"priority":"${options.filters.priority}"%`);
      }
      
      if (options.filters?.dateRange) {
        query += ` AND p.created_at BETWEEN ? AND ?`;
        params.push(options.filters.dateRange.start, options.filters.dateRange.end);
      }
      
      // Add sorting
      if (options.sort) {
        query += ` ORDER BY ${options.sort.field} ${options.sort.direction}`;
      }
      
      // Add pagination
      if (options.pagination) {
        query += ` LIMIT ? OFFSET ?`;
        params.push(options.pagination.limit, options.pagination.offset);
      }
      
      // Execute query
      const stmt = this.db.prepare(query);
      const results = await stmt.bind(...params).all();
      
      // Get total count
      const countStmt = this.db.prepare(`
        SELECT COUNT(*) as total
        FROM projects p
        LEFT JOIN search_index s ON p.id = s.project_id
        WHERE 1=1
        ${options.query ? 'AND (p.name LIKE ? OR p.description LIKE ? OR s.keywords LIKE ? OR s.features LIKE ? OR s.technologies LIKE ?)' : ''}
        ${options.filters?.tags?.length ? 'AND p.metadata LIKE ?' : ''}
        ${options.filters?.type ? 'AND p.metadata LIKE ?' : ''}
        ${options.filters?.priority ? 'AND p.metadata LIKE ?' : ''}
        ${options.filters?.dateRange ? 'AND p.created_at BETWEEN ? AND ?' : ''}
      `);
      
      const countResult = await countStmt.bind(...params).first();
      const total = countResult?.total as number || 0;
      
      // Convert results to EnhancedProjectState
      const projects = results.results.map((result: any) => {
        const metadata = JSON.parse(result.metadata as string) as ProjectMetadata;
        
        return {
          id: result.id as string,
          name: result.name as string,
          createdAt: result.created_at as number,
          updatedAt: result.updated_at as number,
          metadata,
          files: [], // Files are stored in KV
          requirements: [], // Requirements are stored in KV
          deployments: [], // Deployments are stored in KV
          searchIndex: result.keywords ? {
            lastIndexed: result.last_indexed as number,
            keywords: (result.keywords as string).split(','),
            features: (result.features as string).split(','),
            technologies: (result.technologies as string).split(',')
          } : undefined
        };
      });
      
      return { projects, total };
    } catch (error) {
      logger.error('Error searching projects in D1', error);
      throw error;
    }
  }
  
  /**
   * Update project metadata
   */
  async updateProjectMetadata(
    id: string,
    metadata: Partial<ProjectMetadata>
  ): Promise<void> {
    try {
      // Get current metadata
      const project = await this.getProject(id);
      if (!project) {
        throw new Error(`Project not found: ${id}`);
      }
      
      // Merge metadata
      const updatedMetadata = {
        ...project.metadata,
        ...metadata
      };
      
      // Update in database
      await this.db
        .prepare(`
          UPDATE projects
          SET metadata = ?, updated_at = ?
          WHERE id = ?
        `)
        .bind(
          JSON.stringify(updatedMetadata),
          Date.now(),
          id
        )
        .run();
      
      logger.info(`Project metadata updated in D1: ${id}`);
    } catch (error) {
      logger.error(`Error updating project metadata in D1: ${id}`, error);
      throw error;
    }
  }
  
  /**
   * Update search index
   */
  async updateSearchIndex(
    id: string,
    searchIndex: EnhancedProjectState['searchIndex']
  ): Promise<void> {
    try {
      if (!searchIndex) {
        return;
      }
      
      await this.db
        .prepare(`
          INSERT INTO search_index (project_id, keywords, features, technologies, last_indexed)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(project_id) DO UPDATE SET
            keywords = excluded.keywords,
            features = excluded.features,
            technologies = excluded.technologies,
            last_indexed = excluded.last_indexed
        `)
        .bind(
          id,
          searchIndex.keywords.join(','),
          searchIndex.features.join(','),
          searchIndex.technologies.join(','),
          searchIndex.lastIndexed
        )
        .run();
      
      logger.info(`Search index updated in D1: ${id}`);
    } catch (error) {
      logger.error(`Error updating search index in D1: ${id}`, error);
      throw error;
    }
  }
  
  // These methods are not implemented in D1 adapter as they use KV
  async getFileChunk(): Promise<string | null> {
    throw new Error('Method not implemented in D1 adapter');
  }
  
  async saveFileChunk(): Promise<void> {
    throw new Error('Method not implemented in D1 adapter');
  }
  
  async getCacheValue(): Promise<null> {
    throw new Error('Method not implemented in D1 adapter');
  }
  
  async setCacheValue(): Promise<void> {
    throw new Error('Method not implemented in D1 adapter');
  }
  
  async invalidateCache(): Promise<void> {
    throw new Error('Method not implemented in D1 adapter');
  }
} 