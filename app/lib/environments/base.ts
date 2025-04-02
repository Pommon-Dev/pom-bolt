/**
 * Base environment interface that defines common operations 
 * that should work consistently across different environments
 * (local, Cloudflare Pages, containers, etc.)
 */

export interface EnvironmentInfo {
  type: EnvironmentType;
  isProduction: boolean;
  isDevelopment: boolean;
  isPreview: boolean;
}

export enum EnvironmentType {
  LOCAL = 'local',
  CLOUDFLARE = 'cloudflare',
  CONTAINER = 'container',
  NETLIFY = 'netlify',
  UNKNOWN = 'unknown'
}

export enum StorageType {
  LOCAL_STORAGE = 'local_storage',
  SESSION_STORAGE = 'session_storage',
  CLOUDFLARE_KV = 'cloudflare_kv',
  CLOUDFLARE_D1 = 'cloudflare_d1',
  MEMORY = 'memory'
}

/**
 * Base environment interface that all specific environment implementations
 * must extend. This provides a uniform interface for environment-specific operations.
 */
export interface Environment {
  /**
   * Get information about the current environment
   */
  getInfo(): EnvironmentInfo;

  /**
   * Get an environment variable with consistent behavior across environments
   * @param key The environment variable key
   * @param defaultValue Optional default value if the key is not found
   */
  getEnvVariable<T = string>(key: string, defaultValue?: T): T | undefined;

  /**
   * Check if an environment variable exists
   * @param key The environment variable key
   */
  hasEnvVariable(key: string): boolean;

  /**
   * Get the available storage types for this environment
   */
  getAvailableStorageTypes(): StorageType[];

  /**
   * Check if a specific storage type is available in this environment
   * @param storageType The storage type to check
   */
  isStorageAvailable(storageType: StorageType): boolean;

  /**
   * Store a value in the specified storage type
   * @param storageType The storage type to use
   * @param key The key to store the value under
   * @param value The value to store
   */
  storeValue<T>(storageType: StorageType, key: string, value: T): Promise<void>;

  /**
   * Retrieve a value from the specified storage type
   * @param storageType The storage type to use
   * @param key The key to retrieve
   */
  retrieveValue<T>(storageType: StorageType, key: string): Promise<T | null>;

  /**
   * Remove a value from the specified storage type
   * @param storageType The storage type to use
   * @param key The key to remove
   */
  removeValue(storageType: StorageType, key: string): Promise<void>;

  /**
   * Check if the environment can execute commands
   */
  canExecuteCommands(): boolean;

  /**
   * Check if the environment has filesystem access
   */
  hasFilesystemAccess(): boolean;

  /**
   * Get the temporary directory path for this environment
   * Returns null if not applicable
   */
  getTempDirectoryPath(): string | null;

  /**
   * Create a unique identifier for this environment
   * (useful for tracking deployments, projects, etc.)
   */
  createUniqueId(): string;
} 