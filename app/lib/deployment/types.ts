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
}

/**
 * Configuration for Cloudflare Pages deployment target
 */
export interface CloudflareConfig {
  accountId: string;                    // Cloudflare account ID
  apiToken: string;                     // Cloudflare API token
}

/**
 * Configuration for Vercel deployment target
 */
export interface VercelConfig {
  token: string;                        // Vercel API token
  teamId?: string;                      // Optional team ID
}

/**
 * Configuration for Netlify deployment target
 */
export interface NetlifyConfig {
  token: string;                        // Netlify API token
}

/**
 * Configuration for Local Tunnel deployment target
 */
export interface LocalTunnelConfig {
  type: 'cloudflare' | 'ngrok';         // Type of tunnel to use
  port: number;                         // Port to expose
  name?: string;                        // Optional name for the tunnel
}

/**
 * Error types for deployment operations
 */
export enum DeploymentErrorType {
  INITIALIZATION_FAILED = 'INITIALIZATION_FAILED',
  DEPLOYMENT_FAILED = 'DEPLOYMENT_FAILED',
  UPDATE_FAILED = 'UPDATE_FAILED',
  NOT_AVAILABLE = 'TARGET_NOT_AVAILABLE',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  PACKAGING_FAILED = 'PACKAGING_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN = 'UNKNOWN_ERROR'
} 