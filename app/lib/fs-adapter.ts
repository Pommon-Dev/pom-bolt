/**
 * FileSystem Adapter
 *
 * This adapter provides a unified interface for filesystem operations across different
 * environments (browser and Cloudflare Pages). It handles the differences between
 * WebContainer's filesystem in the browser and Cloudflare's storage in production.
 *
 * Usage:
 * ```typescript
 * const fs = new FileSystemAdapter();
 * await fs.initialize(webcontainer); // In browser environment
 * const content = await fs.readFile('path/to/file');
 * ```
 */

import { WebContainer } from '@webcontainer/api';
import { environment } from '~/config/environment';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('FileSystemAdapter');

export class FileSystemAdapter {
  private webcontainer: WebContainer | null = null;
  private isCloudflare: boolean;

  constructor() {
    // Detect if we're running in Cloudflare Pages environment
    this.isCloudflare = environment.isCloudflare;

    if (this.isCloudflare) {
      logger.info('Initializing FileSystemAdapter in Cloudflare environment');
    }
  }

  /**
   * Initialize the adapter with a WebContainer instance
   * This is required for browser environments
   */
  async initialize(container?: WebContainer) {
    if (container && !this.isCloudflare) {
      this.webcontainer = container;
      logger.debug('Initialized with WebContainer');
    }
  }

  /**
   * Read a file from either WebContainer or Cloudflare storage
   * @param path - The path to the file
   * @returns The file contents as a string
   */
  async readFile(path: string): Promise<string> {
    if (this.isCloudflare) {
      // In Cloudflare, fetch from our storage API
      try {
        logger.debug(`Reading file from Cloudflare storage: ${path}`);

        const response = await fetch(`/api/fs/${encodeURIComponent(path)}`);

        if (!response.ok) {
          throw new Error(`Failed to read file: ${path}`);
        }

        return await response.text();
      } catch (error) {
        logger.error(`Error reading file from Cloudflare storage: ${path}`, { error });
        return '';
      }
    }

    // In browser, use WebContainer's filesystem
    if (this.webcontainer) {
      try {
        logger.debug(`Reading file from WebContainer: ${path}`);

        const file = await this.webcontainer.fs.readFile(path, 'utf-8');

        return file;
      } catch (error) {
        logger.error(`Error reading file from WebContainer: ${path}`, { error });
        return '';
      }
    }

    throw new Error('No filesystem available');
  }

  /**
   * Write a file to either WebContainer or Cloudflare storage
   * @param path - The path where to write the file
   * @param content - The content to write
   */
  async writeFile(path: string, content: string): Promise<void> {
    if (this.isCloudflare) {
      // In Cloudflare, write to our storage API
      try {
        logger.debug(`Writing file to Cloudflare storage: ${path}`);
        await fetch(`/api/fs/${encodeURIComponent(path)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        });
      } catch (error) {
        logger.error(`Error writing file to Cloudflare storage: ${path}`, { error });
        throw error;
      }
    } else {
      // In browser, use WebContainer's filesystem
      if (this.webcontainer) {
        try {
          logger.debug(`Writing file to WebContainer: ${path}`);
          await this.webcontainer.fs.writeFile(path, content, 'utf-8');
        } catch (error) {
          logger.error(`Error writing file to WebContainer: ${path}`, { error });
          throw error;
        }
      }
    }
  }

  /**
   * Check if a file exists in either WebContainer or Cloudflare storage
   * @param path - The path to check
   * @returns Whether the file exists
   */
  async exists(path: string): Promise<boolean> {
    if (this.isCloudflare) {
      try {
        logger.debug(`Checking if file exists in Cloudflare storage: ${path}`);

        const response = await fetch(`/api/fs/${encodeURIComponent(path)}/exists`);

        return response.ok;
      } catch (error) {
        logger.error(`Error checking file existence in Cloudflare storage: ${path}`, { error });
        return false;
      }
    }

    if (this.webcontainer) {
      try {
        logger.debug(`Checking if file exists in WebContainer: ${path}`);

        // Use try-catch with stat API
        try {
          // Access the internal fs stat method, wrapped in try/catch since it might not be publicly typed
          const stats = await (this.webcontainer.fs as any).stat(path);
          return stats !== null;
        } catch (statError) {
          // Alternatively, try to read the file and see if it errors
          await this.webcontainer.fs.readFile(path);
          return true;
        }
      } catch (error) {
        logger.debug(`File does not exist in WebContainer: ${path}`);
        return false;
      }
    }

    return false;
  }

  /**
   * Watch a directory for changes - only works in browser environments
   * In Cloudflare, this is a no-op that returns a dummy watcher
   * @param path - The path to watch
   * @param options - Watch options
   * @returns A watcher object or null
   */
  async watch(path: string, options: { persistent?: boolean } = {}): Promise<any> {
    // In Cloudflare, return a dummy watcher that does nothing
    if (this.isCloudflare) {
      logger.warn(`File watching not supported in Cloudflare environment: ${path}`);

      // Return a dummy watcher object that does nothing
      return {
        addEventListener: (event: string, callback: () => void) => {
          logger.debug(`Dummy watcher addEventListener called with event: ${event}`);
        },
        close: () => {
          logger.debug('Dummy watcher close called');
        },
      };
    }

    // In browser, use WebContainer's filesystem watcher if available
    if (this.webcontainer) {
      try {
        logger.debug(`Setting up file watcher in WebContainer: ${path}`);
        return await this.webcontainer.fs.watch(path, options);
      } catch (error) {
        logger.error(`Error setting up file watcher in WebContainer: ${path}`, { error });
        return null;
      }
    }

    return null;
  }
}
