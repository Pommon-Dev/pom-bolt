/**
 * Environment variable access utility
 * 
 * This file provides a safe way to access environment variables with proper typing
 * and default values.
 */

/**
 * Get an environment variable as a string
 * @param key The environment variable name
 * @param defaultValue Default value if the environment variable is not set
 * @returns The environment variable value or the default
 */
export function getEnvVar(key: string, defaultValue: string = ''): string {
  // Try to get from process.env first (for Node environments)
  if (typeof process !== 'undefined' && process.env && key in process.env) {
    return process.env[key] || defaultValue;
  }
  
  // For Cloudflare Workers environment, access through globalThis
  if (typeof globalThis !== 'undefined' && 'env' in globalThis) {
    // @ts-ignore - Cloudflare Workers environment
    return globalThis.env?.[key] || defaultValue;
  }
  
  return defaultValue;
}

/**
 * Get an environment variable as a boolean
 * @param key The environment variable name
 * @param defaultValue Default value if the environment variable is not set
 * @returns The environment variable as a boolean
 */
export function getBooleanEnvVar(key: string, defaultValue: boolean = false): boolean {
  const value = getEnvVar(key, String(defaultValue));
  return value === 'true' || value === '1';
}

/**
 * Get an environment variable as a number
 * @param key The environment variable name
 * @param defaultValue Default value if the environment variable is not set
 * @returns The environment variable as a number
 */
export function getNumberEnvVar(key: string, defaultValue: number = 0): number {
  const value = getEnvVar(key, String(defaultValue));
  const numberValue = Number(value);
  return isNaN(numberValue) ? defaultValue : numberValue;
}

/**
 * Get an environment variable as a JSON object
 * @param key The environment variable name
 * @param defaultValue Default value if the environment variable is not set or is invalid JSON
 * @returns The parsed JSON object
 */
export function getJsonEnvVar<T>(key: string, defaultValue: T): T {
  const value = getEnvVar(key, '');
  
  if (!value) {
    return defaultValue;
  }
  
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn(`Failed to parse JSON environment variable ${key}`);
    return defaultValue;
  }
}

/**
 * Check if multi-tenancy is enabled
 * @returns True if multi-tenancy is enabled
 */
export function isMultiTenancyEnabled(): boolean {
  return getBooleanEnvVar('MULTI_TENANT_ENABLED', false);
}

/**
 * Get the default tenant ID
 * @returns The default tenant ID
 */
export function getDefaultTenantId(): string {
  return getEnvVar('DEFAULT_TENANT_ID', 'default');
}

/**
 * Check if strict tenant validation is enabled
 * @returns True if strict tenant validation is enabled
 */
export function isStrictTenantValidation(): boolean {
  return getBooleanEnvVar('STRICT_TENANT_VALIDATION', true);
}

/**
 * Check if access from the default tenant is allowed
 * @returns True if default tenant access is allowed
 */
export function isDefaultTenantAllowed(): boolean {
  return getBooleanEnvVar('ALLOW_DEFAULT_TENANT', false);
} 