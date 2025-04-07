import { createScopedLogger } from '~/utils/logger';
import { BaseDeploymentTarget } from './base';
import type { 
  ProjectOptions, 
  ProjectMetadata, 
  DeployOptions, 
  UpdateOptions, 
  DeploymentResult, 
  DeploymentStatus,
} from '../types';
import { DeploymentErrorType } from '../types';
import { ZipPackager } from '../packagers/zip';
import { kvPut } from '~/lib/kv/binding';
import { getEnvironment } from '~/lib/environments';
import { StorageType } from '~/lib/environments/base';

const logger = createScopedLogger('local-zip-target');

/**
 * Local ZIP file deployment target
 * Creates a ZIP file of the project and provides a URL to download it
 */
export class LocalZipTarget extends BaseDeploymentTarget {
  private zipPackager: ZipPackager;
  
  constructor() {
    super();
    this.zipPackager = new ZipPackager();
  }
  
  getName(): string {
    return 'local-zip';
  }
  
  getProviderType(): string {
    return 'local';
  }
  
  /**
   * Always available as a fallback
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }
  
  async projectExists(projectName: string): Promise<boolean> {
    // Local projects don't have persistent state
    return false;
  }
  
  async initializeProject(options: ProjectOptions): Promise<ProjectMetadata> {
    const sanitizedName = this.sanitizeProjectName(options.name);
    
    return {
      id: `local-${sanitizedName}-${Date.now()}`,
      name: sanitizedName,
      provider: this.getProviderType(),
      url: '',
      metadata: {
        createdAt: Date.now()
      }
    };
  }
  
  async deploy(options: DeployOptions): Promise<DeploymentResult> {
    try {
      // Package files into a ZIP
      const zipBuffer = await this.zipPackager.package(options.files);
      const deploymentId = `${options.projectId}-${Date.now()}`;
      const zipKey = `zip:${options.projectId}:${deploymentId}`;
      
      logger.info('Creating local ZIP deployment', {
        projectId: options.projectId,
        deploymentId,
        zipSize: zipBuffer.byteLength,
        fileCount: Object.keys(options.files).length,
      });
      
      // Store in KV if available
      let zipUrl: string;
      let kvStorageSuccess = false;
      
      // Get context from environment if available
      // Access metadata.environment which may contain the CloudflareEnvironment
      const environment = options.metadata?.environment;
      
      logger.debug('Environment details for KV storage', {
        hasMetadata: !!options.metadata,
        hasEnvironment: !!environment,
        environmentType: environment ? typeof environment : 'undefined',
        hasEnvProperty: environment && typeof environment === 'object' && '_env' in environment,
      });
      
      if (environment && typeof environment === 'object' && '_env' in environment) {
        try {
          logger.debug('Storing ZIP in KV storage', { 
            zipKey, 
            size: zipBuffer.byteLength,
            contextType: typeof environment._env,
            contextKeys: environment._env ? Object.keys(environment._env).join(',') : 'none'
          });
          
          const success = await kvPut(environment._env, zipKey, zipBuffer);
          
          if (success) {
            logger.info('Successfully stored ZIP in KV storage', { zipKey });
            zipUrl = `/api/download/${zipKey}`;
            kvStorageSuccess = true;
          } else {
            logger.warn('Failed to store ZIP in KV storage', { 
              zipKey,
              success,
            });
            zipUrl = `/api/local-zip/${deploymentId}`;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error('Error storing ZIP in KV', { 
            error: errorMessage, 
            zipKey,
            errorType: typeof error,
            errorDetails: JSON.stringify(error)
          });
          zipUrl = `/api/local-zip/${deploymentId}`;
        }
      } else {
        logger.warn('No environment provided for KV storage', { 
          hasMetadata: !!options.metadata,
          hasEnvironment: !!environment,
          environmentType: environment ? typeof environment : 'undefined'
        });
        zipUrl = `/api/local-zip/${deploymentId}`;
      }
      
      return {
        id: deploymentId,
        url: zipUrl,
        status: 'success',
        logs: [
          `Local ZIP deployment created: ${zipUrl}`,
          `KV storage ${kvStorageSuccess ? 'successful' : 'failed'} with key: ${zipKey}`,
          `ZIP size: ${zipBuffer.byteLength} bytes, file count: ${Object.keys(options.files).length}`
        ],
        provider: this.getProviderType(),
        metadata: {
          projectName: options.projectName,
          createdAt: Date.now(),
          zipKey,
          kvStorageSuccess
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error creating local ZIP deployment', { error: errorMessage });
      
      throw this.createError(
        DeploymentErrorType.DEPLOYMENT_FAILED,
        `Failed to create ZIP: ${errorMessage}`,
        error instanceof Error ? error : undefined
      );
    }
  }
  
  async update(options: UpdateOptions): Promise<DeploymentResult> {
    // For local targets, update is identical to deploy
    return this.deploy(options);
  }
  
  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    // Local deployments are always immediately successful
    return {
      id: deploymentId,
      url: `/api/local-zip/${deploymentId}`,
      status: 'success',
      logs: ['Local deployment completed successfully'],
      createdAt: Date.now()
    };
  }
  
  async removeDeployment(deploymentId: string): Promise<boolean> {
    // No-op for local targets
    return true;
  }
  
  /**
   * Sanitize project name for use in filenames
   */
  protected sanitizeProjectName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 63);
  }
} 