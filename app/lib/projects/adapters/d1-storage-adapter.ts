import { createScopedLogger } from '~/utils/logger';
import type { ProjectState, ProjectStorageAdapter, CreateProjectOptions } from '../types';
import { v4 as uuidv4 } from 'uuid';

const logger = createScopedLogger('d1-adapter');

export class D1StorageAdapter implements ProjectStorageAdapter {
  private database: D1Database;

  constructor(db: D1Database) {
    this.database = db;
    logger.info('D1StorageAdapter initialized', { 
      dbAvailable: !!db,
      dbType: db ? typeof db : 'undefined'
    });
  }

  async getProject(id: string): Promise<ProjectState | null> {
    try {
      logger.info(`Fetching project ${id} from D1`);
      const result = await this.database
        .prepare('SELECT id, name, metadata, created_at, updated_at, user_id FROM projects WHERE id = ?')
        .bind(id)
        .first();
      
      logger.info(`D1 query result for project ${id}`, { 
        found: !!result,
        resultType: result ? typeof result : 'undefined'
      });
      
      if (!result) {
        return null;
      }
      
      // Parse metadata JSON
      let metadata = {};
      try {
        if (result.metadata) {
          metadata = typeof result.metadata === 'string' 
            ? JSON.parse(result.metadata) 
            : result.metadata;
        }
      } catch (error) {
        logger.warn(`Failed to parse metadata for project ${id}`, error);
      }
      
      // Construct a ProjectState object from the database columns
      const project: ProjectState = {
        id: result.id as string,
        name: result.name as string,
        createdAt: Number(result.created_at),
        updatedAt: Number(result.updated_at),
        files: [],
        requirements: [],
        deployments: [],
        metadata: {
          ...metadata,
          userId: result.user_id as string || null
        },
        webhooks: []
      };
      
      return project;
    } catch (error) {
      logger.error(`Error fetching project ${id} from D1`, error);
      throw error;
    }
  }

  async saveProject(project: ProjectState): Promise<void> {
    try {
      logger.info(`Saving project ${project.id} to D1`);
      
      // Get user ID from metadata (if it exists there) or null
      const userId = project.metadata && 'userId' in project.metadata 
        ? (project.metadata as Record<string, any>)['userId']
        : null;
      
      // Convert the project data for database schema
      const result = await this.database
        .prepare('UPDATE projects SET name = ?, metadata = ?, updated_at = ?, user_id = ? WHERE id = ?')
        .bind(
          project.name,
          JSON.stringify(project.metadata || {}),
          project.updatedAt,
          userId,
          project.id
        )
        .run();
      
      // If no rows were updated, the project doesn't exist yet, so insert it
      if (!result.meta?.changes || result.meta.changes === 0) {
        logger.info(`Project ${project.id} not found in D1, inserting as new`);
        await this.database
          .prepare('INSERT INTO projects (id, name, metadata, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(
            project.id,
            project.name,
            JSON.stringify(project.metadata || {}),
            project.createdAt,
            project.updatedAt,
            userId
          )
          .run();
      }
      
      logger.info(`Project ${project.id} saved successfully`);
    } catch (error) {
      logger.error(`Error saving project ${project.id} to D1`, error);
      throw error;
    }
  }

  async deleteProject(id: string): Promise<boolean> {
    try {
      logger.info(`Deleting project ${id} from D1`);
      
      // Delete the project from the database
      const result = await this.database
        .prepare('DELETE FROM projects WHERE id = ?')
        .bind(id)
        .run();
      
      logger.info(`D1 delete result for project ${id}`, { 
        success: result.success,
        meta: result.meta,
        changes: result.meta?.changes
      });
      
      return result.success;
    } catch (error) {
      logger.error(`Error deleting project ${id} from D1`, error);
      throw error;
    }
  }

  async projectExists(id: string): Promise<boolean> {
    try {
      logger.info(`Checking if project ${id} exists in D1`);
      const result = await this.database
        .prepare('SELECT COUNT(*) as count FROM projects WHERE id = ?')
        .bind(id)
        .first();
      
      const exists = result ? Number(result.count) > 0 : false;
      logger.info(`Project ${id} exists: ${exists}`);
      
      return exists;
    } catch (error) {
      logger.error(`Error checking if project ${id} exists in D1`, error);
      throw error;
    }
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
    try {
      logger.info(`Listing projects from D1 (limit: ${options?.limit}, offset: ${options?.offset})`);
      
      let query = 'SELECT id, name, metadata, created_at, updated_at, user_id FROM projects';
      const params: any[] = [];

      if (options?.userId) {
        query += ' WHERE user_id = ?';
        params.push(options.userId);
      }

      // Map createdAt/updatedAt to created_at/updated_at for SQL query
      let orderBy = options?.sortBy === 'createdAt' ? 'created_at' : 
                   options?.sortBy === 'updatedAt' ? 'updated_at' : 'updated_at';
                   
      query += ` ORDER BY ${orderBy} ${options?.sortDirection || 'desc'}`;

      if (options?.limit) {
        query += ' LIMIT ?';
        params.push(options.limit);
      }

      if (options?.offset) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }

      const results = await this.database
        .prepare(query)
        .bind(...params)
        .all();

      logger.info('D1 list query result', { 
        resultsCount: results.results?.length || 0,
        success: results.success,
        meta: results.meta
      });
      
      if (!results.results || !Array.isArray(results.results)) {
        return { projects: [], total: 0 };
      }
      
      const projects = results.results.map((row: any) => {
        // Parse metadata JSON
        let metadata = {};
        try {
          if (row.metadata) {
            metadata = typeof row.metadata === 'string' 
              ? JSON.parse(row.metadata) 
              : row.metadata;
          }
        } catch (error) {
          logger.warn(`Failed to parse metadata for a project`, error);
        }
        
        // Construct a ProjectState object from the database row
        return {
          id: row.id as string,
          name: row.name as string,
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
          files: [],
          requirements: [],
          deployments: [],
          webhooks: [],
          metadata: {
            ...metadata,
            userId: row.user_id as string || null
          }
        } as ProjectState;
      });
      
      const totalResult = await this.database
        .prepare('SELECT COUNT(*) as total FROM projects')
        .first();

      const total = totalResult ? Number(totalResult.total) : 0;
      
      return { projects, total };
    } catch (error) {
      logger.error('Error listing projects from D1', error);
      throw error;
    }
  }

  async createProject(options: CreateProjectOptions): Promise<ProjectState> {
    try {
      const now = Date.now();
      const id = uuidv4();
      const name = options.name || 'Untitled Project';
      
      logger.info(`Creating project in D1`, { 
        id, 
        name,
        options,
        database: !!this.database,
        databaseType: typeof this.database
      });
      
      const project: ProjectState = {
        id,
        name,
        createdAt: now,
        updatedAt: now,
        files: [],
        requirements: [],
        deployments: [],
        webhooks: [],
        metadata: options.metadata || {}
      };
      
      logger.info(`Project object created, preparing to insert into D1`, { project });
      
      // Store the project in the database using the correct schema columns
      try {
        logger.info(`Executing D1 insert query`, {
          id,
          name,
          metadata: JSON.stringify(project.metadata).substring(0, 100) + '...'
        });
        
        const result = await this.database
          .prepare('INSERT INTO projects (id, name, metadata, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(
            id, 
            name, 
            JSON.stringify(project.metadata), 
            now, 
            now, 
            options.userId || null
          )
          .run();
        
        logger.info(`D1 insert result for project ${id}`, { 
          success: result.success,
          meta: result.meta,
          changes: result.meta?.changes,
          lastRowId: result.meta?.last_row_id
        });
      } catch (dbError) {
        logger.error(`D1 insert failed for project ${id}`, {
          error: dbError,
          message: dbError instanceof Error ? dbError.message : String(dbError),
          stack: dbError instanceof Error ? dbError.stack : 'No stack trace'
        });
        throw dbError; // Rethrow to be caught by outer catch
      }
      
      return project;
    } catch (error) {
      logger.error('Error creating project in D1', {
        error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack trace',
        errorType: typeof error,
        errorJson: JSON.stringify(error, Object.getOwnPropertyNames(error instanceof Error ? error : {}))
      });
      throw error;
    }
  }

  async updateProject(id: string, updates: Partial<ProjectState>): Promise<ProjectState> {
    try {
      const project = await this.getProject(id);
      if (!project) {
        throw new Error(`Project ${id} not found`);
      }

      const updatedProject: ProjectState = {
        ...project,
        ...updates,
        updatedAt: Date.now()
      };

      await this.saveProject(updatedProject);
      return updatedProject;
    } catch (error) {
      logger.error(`Error updating project ${id} in D1`, error);
      throw error;
    }
  }
} 