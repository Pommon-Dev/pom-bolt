/**
 * Project store for code generation
 * Provides a simplified interface for triggering code generation
 * Compatible with both browser and Cloudflare environments
 */

import { environment } from '~/config/environment';
import type { LLMManager } from '~/lib/modules/llm/manager';
import type { BaseProvider } from '~/lib/modules/llm/base-provider';

interface GenerationOptions {
  requirements: string[];
  fromRequirementsAPI?: boolean;
}

/**
 * Project store handles code generation requests
 * In Cloudflare, it uses a simplified flow that works without file system
 */
class ProjectStore {
  private llmManager: LLMManager | null = null;
  private defaultProvider: BaseProvider | null = null;
  
  constructor() {
    // Defer initialization to avoid SSR issues
    if (typeof window !== 'undefined' && !import.meta.env.SSR) {
      this.initialize();
    }
  }
  
  /**
   * Initialize LLM manager
   */
  private async initialize() {
    try {
      // Use the singleton pattern to get the LLM manager instance
      const { LLMManager } = await import('~/lib/modules/llm/manager');
      this.llmManager = LLMManager.getInstance();
      console.log('ProjectStore initialized with LLM Manager');
      
      // Get the default provider
      if (this.llmManager) {
        try {
          this.defaultProvider = this.llmManager.getDefaultProvider();
          console.log('Default provider loaded:', this.defaultProvider?.name);
        } catch (error) {
          console.error('Failed to get default provider:', error);
        }
      }
    } catch (error) {
      console.error('Failed to initialize LLM Manager:', error);
    }
  }
  
  /**
   * Trigger code generation based on requirements
   */
  async triggerGeneration({ requirements, fromRequirementsAPI = false }: GenerationOptions): Promise<void> {
    console.log('Triggering generation with requirements:', requirements);
    
    if (!requirements.length) {
      console.warn('No requirements provided for generation');
      return;
    }
    
    // Make sure LLM manager is initialized
    if (!this.llmManager && typeof window !== 'undefined' && !import.meta.env.SSR) {
      await this.initialize();
    }
    
    try {
      if (environment.isCloudflare && !environment.features.fileSystem) {
        console.log('Running in Cloudflare without file system - logging generation intent only');
        console.log('Requirements received:', requirements);
        
        // In Cloudflare without file system, just log the intent
        if (this.defaultProvider) {
          console.log(`Would use provider: ${this.defaultProvider.name}`);
          console.log('Generation logging completed - actual generation disabled in cloud mode');
        } else {
          console.error('No provider available for code generation');
        }
      } else {
        console.log('Running with file system - full generation would be implemented here');
        // In development or with file system enabled, we would use the full generation flow
        // This is just a stub - real implementation would involve creating project files
      }
    } catch (error) {
      console.error('Error during code generation:', error);
    }
  }
}

// Export a singleton instance
export const projectStore = new ProjectStore(); 