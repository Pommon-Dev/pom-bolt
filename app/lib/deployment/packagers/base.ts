/**
 * Interface for packaging application files for deployment
 */
export interface Packager {
  /**
   * Get the name of this packager
   */
  getName(): string;
  
  /**
   * Get the content type of the packaged output
   */
  getContentType(): string;
  
  /**
   * Package application files for deployment
   * @param files Map of file paths to file contents
   * @param options Optional packaging options
   * @returns Promise resolving to the packaged content
   */
  package(files: Record<string, string>, options?: PackagerOptions): Promise<ArrayBuffer | Buffer | Blob>;
}

/**
 * Options for packaging files
 */
export interface PackagerOptions {
  rootDir?: string;            // Root directory for the files
  includeFiles?: string[];     // List of files to include (if not all)
  excludeFiles?: string[];     // List of files to exclude
  metadata?: Record<string, any>; // Additional metadata to include
} 