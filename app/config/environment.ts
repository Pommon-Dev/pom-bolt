/**
 * Environment Configuration
 * 
 * This file provides environment-specific configuration for the application.
 * It uses runtime checks to determine the current environment and enables/disables
 * features accordingly.
 * 
 * Key points:
 * - Environment detection is done at runtime to work in both browser and server contexts
 * - Features are toggled based on the environment
 * - API baseUrl is empty to use relative URLs, making the app deployment-agnostic
 * - Features can be overridden with environment variables (e.g., ENABLE_WEBHOOK_TESTING)
 */

export const environment = {
  // Environment detection
  isCloudflare: typeof process !== 'undefined' && process.env.NODE_ENV === 'production',
  isDevelopment: typeof process !== 'undefined' && process.env.NODE_ENV === 'development',

  // Feature flags - control which features are available in each environment
  features: {
    // Webhook testing can be enabled with environment variable regardless of environment
    webhookTesting: 
      (typeof process !== 'undefined' && process.env.ENABLE_WEBHOOK_TESTING === 'true') || 
      (typeof process !== 'undefined' && process.env.NODE_ENV === 'development'),
    // File system operations can be enabled with environment variable
    fileSystem: 
      (typeof process !== 'undefined' && process.env.ENABLE_FILESYSTEM === 'true') || 
      (typeof process !== 'undefined' && process.env.NODE_ENV === 'development'),
    // Deployment features are only available in production
    deployment: typeof process !== 'undefined' && process.env.NODE_ENV === 'production',
  },

  // API configuration
  api: {
    // Empty baseUrl means all API calls will be relative to the current domain
    // This makes the app work regardless of deployment URL or custom domain
    baseUrl: '',
  },
}; 