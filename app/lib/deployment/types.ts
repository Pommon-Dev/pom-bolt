/**
 * Deployment types and interfaces
 * Defines the core types for the deployment system
 */

/**
 * Options for initializing a project with a deployment target
 */
export interface ProjectOptions {
  name: string;                        // Name of the project
  files?: Record<string, string>;      // Optional initial files
  metadata?: Record<string, any>;      // Additional metadata
  tenantId?: string;                   // ID of the tenant that owns this project
}

/**
 * Metadata returned after project initialization
 */
export interface ProjectMetadata {
  id: string;                           // Project ID on the deployment platform
  name: string;                         // Project name
  url?: string;                         // Base URL for the project
  provider: string;                     // Provider name (e.g., 'cloudflare', 'vercel')
  metadata?: Record<string, any>;       // Additional platform-specific metadata
  tenantId?: string;                    // ID of the tenant that owns this project
}

/**
 * Options for deploying a project
 */
export interface DeployOptions {
  projectId: string;                    // Project ID on the deployment platform
  projectName: string;                  // Project name
  files: Record<string, string>;        // Files to deploy
  environmentVariables?: Record<string, string>; // Environment variables to set
  deploymentId?: string;                // Optional ID for the deployment
  metadata?: Record<string, any>;       // Additional metadata
  tenantId?: string;                    // ID of the tenant that owns this project
}

/**
 * Options for updating an existing deployment
 */
export interface UpdateOptions extends DeployOptions {
  deploymentId: string;                 // The deployment ID to update
}

/**
 * Result of a deployment operation
 */
export interface DeploymentResult {
  id: string;                           // Deployment ID
  url: string;                          // URL where the deployment can be accessed
  status: 'success' | 'failed' | 'in-progress'; // Status of the deployment
  logs: string[];                       // Deployment logs
  provider: string;                     // The provider used (e.g., 'cloudflare', 'vercel')
  metadata?: Record<string, any>;       // Additional metadata about the deployment
  error?: string;                       // Optional error message if the deployment failed
  tenantId?: string;                    // ID of the tenant that owns this deployment
}

/**
 * Status of a deployment
 */
export interface DeploymentStatus {
  id: string;                           // Deployment ID
  url: string;                          // URL where the deployment can be accessed
  status: 'success' | 'failed' | 'in-progress'; // Status of the deployment
  logs: string[];                       // Deployment logs
  createdAt: number;                    // When the deployment was created
  completedAt?: number;                 // When the deployment was completed
  metadata?: Record<string, any>;       // Additional metadata about the deployment
  tenantId?: string;                    // ID of the tenant that owns this deployment
}

/**
 * Base configuration interface for all deployment targets
 */
export interface DeploymentCredentials {
  tenantId?: string;                     // ID of the tenant that owns these credentials
  temporary?: boolean;                   // Whether these credentials should be stored temporarily
}

/**
 * Configuration for Cloudflare Pages deployment target
 */
export interface CloudflareConfig extends DeploymentCredentials {
  accountId: string;                    // Cloudflare account ID
  apiToken: string;                     // Cloudflare API token
  projectName?: string;                 // Optional fixed project name to deploy to
}

/**
 * Configuration for Vercel deployment target
 */
export interface VercelConfig extends DeploymentCredentials {
  token: string;                        // Vercel API token
  teamId?: string;                      // Optional team ID
}

/**
 * Configuration for Netlify deployment target
 */
export interface NetlifyConfig extends DeploymentCredentials {
  token: string;                        // Netlify API token
}

/**
 * Configuration for GitHub source repository
 */
export interface GitHubConfig extends DeploymentCredentials {
  token: string;                        // GitHub personal access token
  owner?: string;                       // GitHub owner (user or organization)
}

/**
 * Configuration for Local Tunnel deployment target
 */
export interface LocalTunnelConfig extends DeploymentCredentials {
  type: 'cloudflare' | 'ngrok';         // Type of tunnel to use
  port: number;                         // Port to expose
  name?: string;                        // Optional name for the tunnel
}

/**
 * Framework type recognized by the framework detector
 */
export type FrameworkType = 
  'react' | 'vue' | 'angular' | 'next' | 'nuxt' | 'svelte' | 
  'express' | 'fastify' | 'koa' | 'nest' |
  'flask' | 'django' | 'fastapi' |
  'static' | 'unknown';

/**
 * Package manager type
 */
export type PackageManagerType = 'npm' | 'yarn' | 'pnpm' | 'pip' | 'poetry' | 'unknown';

/**
 * Result of framework detection
 */
export interface FrameworkDetectionResult {
  framework: FrameworkType;             // Detected framework
  buildCommand: string;                 // Command to build the project
  outputDirectory: string;              // Directory where build output will be located
  packageManager: PackageManagerType;   // Detected package manager
  staticSite: boolean;                  // Whether this is a static site
  hasBuildStep: boolean;                // Whether a build step is required
  dependencies: string[];               // List of main dependencies
  runtime?: 'node' | 'python' | 'static'; // Runtime environment
}

/**
 * Result of a build operation
 */
export interface BuildResult {
  success: boolean;                     // Whether the build was successful
  outputFiles: Record<string, string>;  // Files generated by the build
  logs: string[];                       // Build logs
  error?: Error;                        // Error if the build failed
  frameworkInfo: FrameworkDetectionResult; // Framework detection information
}

/**
 * Error types for deployment operations
 */
export enum DeploymentErrorType {
  API_ERROR = 'API_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INITIALIZATION_FAILED = 'INITIALIZATION_FAILED',
  DEPLOYMENT_FAILED = 'DEPLOYMENT_FAILED',
  NOT_AVAILABLE = 'NOT_AVAILABLE',
  PROJECT_EXISTS = 'PROJECT_EXISTS',
  UNKNOWN = 'UNKNOWN',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED'
} 