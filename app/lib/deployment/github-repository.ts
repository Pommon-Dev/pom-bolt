import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('github-repository');

export interface GitHubRepoConfig {
  token: string;
  owner?: string; // Username for personal repos, organization name for org repos
}

export interface CreateRepoOptions {
  name: string;
  description?: string;
  isPrivate?: boolean;
  autoInit?: boolean;
}

export interface GitHubRepoMetadata {
  id: number;
  name: string;
  fullName: string;
  url: string;
  apiUrl: string;
  cloneUrl: string;
  defaultBranch: string;
}

export interface FilesToCommit {
  [path: string]: string; // path -> content mapping
}

// GitHub API response interfaces
interface GitHubUserResponse {
  login: string;
  id: number;
  name?: string;
  email?: string;
}

interface GitHubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  url: string;
  clone_url: string;
  default_branch: string;
}

interface GitHubRefResponse {
  ref: string;
  object: {
    sha: string;
    type: string;
    url: string;
  };
}

/**
 * GitHub Repository Manager
 * Provides utilities for creating repositories and uploading files via GitHub API
 */
export class GitHubRepository {
  private token: string;
  private owner: string;
  private repo?: string;
  private apiBase = 'https://api.github.com';
  private metadata?: GitHubRepoMetadata;

  constructor(config: GitHubRepoConfig) {
    this.token = config.token;
    this.owner = config.owner || '';
  }

  /**
   * Get headers for GitHub API requests
   */
  private getHeaders(): Headers {
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${this.token}`);
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', '2022-11-28');
    return headers;
  }

  /**
   * Check if the GitHub token is valid
   */
  async validateToken(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiBase}/user`, {
        headers: this.getHeaders()
      });

      if (response.ok) {
        const user = await response.json() as GitHubUserResponse;
        // Set owner if not provided in config
        if (!this.owner) {
          this.owner = user.login;
        }
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error validating GitHub token:', error);
      return false;
    }
  }

  /**
   * Create a new repository on GitHub
   */
  async createRepository(options: CreateRepoOptions): Promise<GitHubRepoMetadata | null> {
    try {
      // Validate the token first
      const isValid = await this.validateToken();
      if (!isValid) {
        logger.error('Invalid GitHub token, cannot create repository');
        return null;
      }

      logger.info(`Creating GitHub repository: ${options.name}`);

      const response = await fetch(`${this.apiBase}/user/repos`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          name: options.name,
          description: options.description || `Generated application by Pom Bolt`,
          private: options.isPrivate !== undefined ? options.isPrivate : true,
          auto_init: options.autoInit !== undefined ? options.autoInit : true
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        logger.error('Failed to create GitHub repository:', errorData);
        return null;
      }

      const repo = await response.json() as GitHubRepoResponse;
      this.repo = repo.name;

      this.metadata = {
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        apiUrl: repo.url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch || 'main'
      };

      logger.info(`GitHub repository created: ${this.metadata.fullName}`);
      return this.metadata;
    } catch (error) {
      logger.error('Error creating GitHub repository:', error);
      return null;
    }
  }

  /**
   * Get the latest commit SHA for a branch
   */
  private async getLatestCommitSha(branch: string = 'main'): Promise<string | null> {
    if (!this.owner || !this.repo) {
      logger.error('Repository information not set');
      return null;
    }

    try {
      const response = await fetch(
        `${this.apiBase}/repos/${this.owner}/${this.repo}/git/refs/heads/${branch}`, 
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        const errorData = await response.json();
        logger.error(`Failed to get latest commit SHA for ${branch}:`, errorData);
        return null;
      }

      const data = await response.json() as GitHubRefResponse;
      return data.object.sha;
    } catch (error) {
      logger.error(`Error getting latest commit SHA for ${branch}:`, error);
      return null;
    }
  }

  /**
   * Set the active repository and upload files to it
   * This is used when we want to use an existing repository
   */
  async setRepositoryAndUploadFiles(repoName: string, files: Record<string, string>, branch: string = 'main'): Promise<boolean> {
    if (!this.owner) {
      logger.error('Repository owner not set');
      return false;
    }

    this.repo = repoName;
    logger.info(`Setting active repository to ${this.owner}/${this.repo}`);
    return this.uploadFiles(files, branch);
  }

  /**
   * Upload a single file to the repository
   */
  private async uploadFile(path: string, content: string, branch: string = 'main'): Promise<boolean> {
    if (!this.owner || !this.repo) {
      logger.error('Repository information not set');
      return false;
    }

    try {
      const encodedContent = btoa(unescape(encodeURIComponent(content)));

      const response = await fetch(
        `${this.apiBase}/repos/${this.owner}/${this.repo}/contents/${path}`,
        {
          method: 'PUT',
          headers: this.getHeaders(),
          body: JSON.stringify({
            message: `Add ${path}`,
            content: encodedContent,
            branch
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        logger.error(`Failed to upload file ${path}:`, errorData);
        return false;
      }

      return true;
    } catch (error) {
      logger.error(`Error uploading file ${path}:`, error);
      return false;
    }
  }

  /**
   * Upload multiple files to the repository
   */
  async uploadFiles(files: Record<string, string>, branch: string = 'main'): Promise<boolean> {
    if (!this.owner || !this.repo) {
      logger.error('Repository information not set');
      return false;
    }

    // Get all file paths
    const filePaths = Object.keys(files);
    if (filePaths.length === 0) {
      logger.warn('No files to upload');
      return false;
    }

    logger.info(`Uploading ${filePaths.length} files to ${this.owner}/${this.repo}`);

    // Upload files sequentially to avoid API rate limits
    for (const path of filePaths) {
      const content = files[path];
      const success = await this.uploadFile(path, content, branch);
      
      if (!success) {
        logger.error(`Failed to upload file ${path}, stopping upload process`);
        return false;
      }
    }

    logger.info(`Successfully uploaded ${filePaths.length} files to ${this.owner}/${this.repo}`);
    return true;
  }

  /**
   * Get repository metadata
   */
  getRepositoryMetadata(): GitHubRepoMetadata | undefined {
    return this.metadata;
  }

  /**
   * Get GitHub token
   */
  getGitHubToken(): string {
    return this.token;
  }
} 