import type { Packager, PackagerOptions } from './base';
import { DeploymentErrorType } from '../types';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('zip-packager');

/**
 * Packager that creates ZIP archives for deployment
 * Uses the JSZip library when available
 */
export class ZipPackager implements Packager {
  private encoder: TextEncoder;
  
  constructor() {
    this.encoder = new TextEncoder();
  }
  
  getName(): string {
    return 'zip';
  }
  
  getContentType(): string {
    return 'application/zip';
  }
  
  async package(files: Record<string, string>, options?: PackagerOptions): Promise<ArrayBuffer> {
    try {
      // Dynamically import JSZip to avoid issues with server-side rendering
      const JSZip = await this.getJSZip();
      
      const zip = new JSZip();
      const rootDir = options?.rootDir || '';
      
      // Process files to include/exclude
      const filesToPackage = this.filterFiles(files, options);
      
      // Add files to the zip
      for (const [path, content] of Object.entries(filesToPackage)) {
        const fullPath = rootDir ? `${rootDir}/${path}` : path;
        zip.file(fullPath, content);
      }
      
      // Generate the zip file
      const zipBlob = await zip.generateAsync({
        type: 'arraybuffer',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 9
        }
      });
      
      logger.debug(`Created ZIP archive with ${Object.keys(filesToPackage).length} files`);
      return zipBlob;
    } catch (error) {
      logger.error('Failed to create ZIP archive:', error);
      throw this.createError(error);
    }
  }
  
  /**
   * Filter files based on include/exclude options
   */
  private filterFiles(files: Record<string, string>, options?: PackagerOptions): Record<string, string> {
    if (!options) {
      return files;
    }
    
    let filteredFiles = { ...files };
    
    // Apply includes if specified
    if (options.includeFiles && options.includeFiles.length > 0) {
      filteredFiles = Object.entries(filteredFiles)
        .filter(([path]) => options.includeFiles!.some(include => path.startsWith(include) || path === include))
        .reduce((acc, [path, content]) => ({ ...acc, [path]: content }), {});
    }
    
    // Apply excludes
    if (options.excludeFiles && options.excludeFiles.length > 0) {
      filteredFiles = Object.entries(filteredFiles)
        .filter(([path]) => !options.excludeFiles!.some(exclude => path.startsWith(exclude) || path === exclude))
        .reduce((acc, [path, content]) => ({ ...acc, [path]: content }), {});
    }
    
    return filteredFiles;
  }
  
  /**
   * Get the JSZip library, dynamically importing it if needed
   */
  private async getJSZip(): Promise<any> {
    try {
      // Try to use the global JSZip if available
      if (typeof window !== 'undefined' && (window as any).JSZip) {
        return (window as any).JSZip;
      }
      
      // Try to dynamic import
      return (await import('jszip')).default;
    } catch (error) {
      throw new Error('JSZip library not available. Include it in your dependencies or globally.');
    }
  }
  
  /**
   * Create a standardized error for packaging failures
   */
  private createError(originalError: any): Error {
    const error = new Error(`ZIP packaging failed: ${originalError.message || 'Unknown error'}`);
    error.name = DeploymentErrorType.PACKAGING_FAILED;
    (error as any).originalError = originalError;
    return error;
  }
} 