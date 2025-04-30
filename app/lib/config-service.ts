import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('config-service');

/**
 * A service for managing configuration settings and environment variables
 */
export class ConfigService {
  private static instance: ConfigService;
  private cache: Map<string, any> = new Map();
  
  private constructor(private env: Record<string, any> = {}) {
    logger.debug('ConfigService initialized');
  }
  
  /**
   * Get the singleton instance of the ConfigService
   */
  public static getInstance(env?: Record<string, any>): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService(env);
    }
    
    // Update env if provided
    if (env) {
      ConfigService.instance.env = env;
    }
    
    return ConfigService.instance;
  }
  
  /**
   * Set the environment variables
   */
  public setEnvironment(env: Record<string, any>): void {
    this.env = env;
    
    // Clear cache when environment changes
    this.cache.clear();
    
    logger.debug('Environment variables updated');
  }
  
  /**
   * Get a string value from the configuration
   */
  public getValue(key: string, defaultValue: string = ''): string {
    // Check cache first
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    
    // Get the value from environment
    const value = this.env[key] || defaultValue;
    
    // Cache the value
    this.cache.set(key, value);
    
    return value;
  }
  
  /**
   * Get a boolean value from the configuration
   */
  public getBooleanValue(key: string, defaultValue: boolean = false): boolean {
    const value = this.getValue(key, String(defaultValue));
    
    // Convert string to boolean
    return value === 'true' || value === '1';
  }
  
  /**
   * Get a number value from the configuration
   */
  public getNumberValue(key: string, defaultValue: number = 0): number {
    const value = this.getValue(key, String(defaultValue));
    
    // Convert string to number
    const numberValue = Number(value);
    
    // Return default value if conversion fails
    return isNaN(numberValue) ? defaultValue : numberValue;
  }
  
  /**
   * Get a JSON value from the configuration
   */
  public getJsonValue<T>(key: string, defaultValue: T): T {
    const value = this.getValue(key, '');
    
    if (!value) {
      return defaultValue;
    }
    
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      logger.warn(`Failed to parse JSON value for key: ${key}`, { error });
      return defaultValue;
    }
  }
  
  /**
   * Check if a key exists in the configuration
   */
  public hasKey(key: string): boolean {
    return key in this.env;
  }
  
  /**
   * Get all configuration values
   */
  public getAllValues(): Record<string, any> {
    return { ...this.env };
  }
}

/**
 * Get the ConfigService instance
 */
export async function getConfigService(env?: Record<string, any>): Promise<ConfigService> {
  return ConfigService.getInstance(env);
} 