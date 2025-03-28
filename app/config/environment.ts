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
 * - Supports multiple production environments (Cloudflare Pages and Google Cloud Run)
 */

export const environment = {
  // Environment detection
  isCloudflare: typeof process !== 'undefined' && process.env.NODE_ENV === 'production' && !process.env.RUNNING_IN_CLOUD_RUN,
  isCloudRun: typeof process !== 'undefined' && process.env.RUNNING_IN_CLOUD_RUN === 'true',
  isDevelopment: typeof process !== 'undefined' && process.env.NODE_ENV === 'development',
  isProduction: typeof process !== 'undefined' && process.env.NODE_ENV === 'production',

  // Feature flags - control which features are available in each environment
  features: {
    // Webhook testing is only available in development and Cloud Run
    webhookTesting: (typeof process !== 'undefined' && 
                    (process.env.NODE_ENV === 'development' ||
                     process.env.RUNNING_IN_CLOUD_RUN === 'true')),
    
    // File system operations are limited in production
    fileSystem: typeof process !== 'undefined' && 
               (process.env.NODE_ENV === 'development' || 
                process.env.ALLOW_FILE_SYSTEM === 'true'),
                
    // Deployment features are only available in production
    deployment: typeof process !== 'undefined' && process.env.NODE_ENV === 'production',
  },

  // API configuration
  api: {
    // Empty baseUrl means all API calls will be relative to the current domain
    // This makes the app work regardless of deployment URL or custom domain
    baseUrl: '',
  },
  
  // Environment names for logging and debugging
  current: () => {
    if (typeof process === 'undefined') return 'browser';
    if (process.env.RUNNING_IN_CLOUD_RUN === 'true') return 'cloud-run';
    if (process.env.NODE_ENV === 'production') return 'cloudflare';
    return 'development';
  }
}; 