import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('project-key-utils');

/**
 * Utility functions for working with project keys and archive keys
 */

/**
 * Convert a project ID to an archive key
 * @param projectId The project ID
 * @returns The archive key
 */
export function getArchiveKey(projectId: string): string {
  return `project-${projectId}.zip`;
}

/**
 * Extract a project ID from an archive key
 * @param archiveKey The archive key
 * @returns The project ID or null if the key format is invalid
 */
export function getProjectIdFromArchiveKey(archiveKey: string): string | null {
  const match = archiveKey.match(/^project-([a-zA-Z0-9-]+)\.zip$/);
  if (!match) {
    logger.warn(`Invalid archive key format: ${archiveKey}`);
    return null;
  }
  return match[1];
}

/**
 * Validate if a string is a valid project ID
 * @param id The string to validate
 * @returns Whether the string is a valid project ID
 */
export function isValidProjectId(id: string): boolean {
  // Project IDs should be UUIDs
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Generate a standard project key for use in storage
 * @param id The project ID
 * @returns The storage key
 */
export function getProjectKey(id: string): string {
  return `pom_bolt_project_${id}`;
} 