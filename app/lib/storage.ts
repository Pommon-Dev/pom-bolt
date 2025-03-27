/**
 * Storage service for requirements data
 * Compatible with both browser and Cloudflare environments
 */

import { environment } from '~/config/environment';
import type { RequirementData } from '~/routes/api.requirements';

// In-memory fallback when persistent storage is not available
let memoryRequirements: RequirementData[] = [];

/**
 * Storage adapter for requirements
 * Uses localStorage in browser environments and memory in Cloudflare
 */
class RequirementsStorage {
  /**
   * Retrieves all requirements from storage
   */
  async getRequirements(): Promise<RequirementData[]> {
    if (typeof window !== 'undefined' && window.localStorage && !environment.isCloudflare) {
      try {
        const storedRequirements = localStorage.getItem('requirements');
        if (storedRequirements) {
          return JSON.parse(storedRequirements);
        }
      } catch (error) {
        console.error('Failed to retrieve requirements from localStorage:', error);
      }
    }
    
    // Fallback to memory storage
    return memoryRequirements;
  }

  /**
   * Saves requirements to storage
   */
  async setRequirements(requirements: RequirementData[]): Promise<void> {
    if (typeof window !== 'undefined' && window.localStorage && !environment.isCloudflare) {
      try {
        localStorage.setItem('requirements', JSON.stringify(requirements));
      } catch (error) {
        console.error('Failed to store requirements in localStorage:', error);
      }
    }
    
    // Always update memory storage as fallback
    memoryRequirements = requirements;
  }

  /**
   * Clears all requirements from storage
   */
  async clearRequirements(): Promise<void> {
    if (typeof window !== 'undefined' && window.localStorage && !environment.isCloudflare) {
      try {
        localStorage.removeItem('requirements');
      } catch (error) {
        console.error('Failed to clear requirements from localStorage:', error);
      }
    }
    
    memoryRequirements = [];
  }
}

export const storage = new RequirementsStorage(); 