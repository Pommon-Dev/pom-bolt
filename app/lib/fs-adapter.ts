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

export class FileSystemAdapter {
  private webcontainer: WebContainer | null = null;
  private isCloudflare: boolean;

  constructor() {
    // Detect if we're running in Cloudflare Pages environment
    this.isCloudflare = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
  }

  /**
   * Initialize the adapter with a WebContainer instance
   * This is required for browser environments
   */
  async initialize(container?: WebContainer) {
    if (container) {
      this.webcontainer = container;
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
        const response = await fetch(`/api/fs/${encodeURIComponent(path)}`);
        if (!response.ok) {
          throw new Error(`Failed to read file: ${path}`);
        }
        return await response.text();
      } catch (error) {
        console.error('Error reading file:', error);
        return '';
      }
    }

    // In browser, use WebContainer's filesystem
    if (this.webcontainer) {
      try {
        const file = await this.webcontainer.fs.readFile(path, 'utf-8');
        return file;
      } catch (error) {
        console.error('Error reading file from WebContainer:', error);
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
        await fetch(`/api/fs/${encodeURIComponent(path)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        });
      } catch (error) {
        console.error('Error writing file:', error);
        throw error;
      }
    } else {
      // In browser, use WebContainer's filesystem
      if (this.webcontainer) {
        try {
          await this.webcontainer.fs.writeFile(path, content, 'utf-8');
        } catch (error) {
          console.error('Error writing file to WebContainer:', error);
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
        const response = await fetch(`/api/fs/${encodeURIComponent(path)}/exists`);
        return response.ok;
      } catch (error) {
        console.error('Error checking file existence:', error);
        return false;
      }
    }

    if (this.webcontainer) {
      try {
        // @ts-ignore WebContainer types are incorrect
        const stats = await this.webcontainer.fs.stat(path);
        return stats !== null;
      } catch (error) {
        return false;
      }
    }

    return false;
  }
} 