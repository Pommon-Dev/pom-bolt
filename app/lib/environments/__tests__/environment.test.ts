import { 
  LocalEnvironment, 
  CloudflareEnvironment,
  EnvironmentType,
  StorageType,
  getEnvironment,
  resetEnvironment,
  setEnvironment
} from '../index';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock logger to prevent console output during tests
vi.mock('~/utils/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

describe('Environment System', () => {
  beforeEach(() => {
    // Reset environment for each test
    resetEnvironment();
    
    // Reset any mocks
    vi.resetModules();
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    // Clean up process.env changes
    delete process.env.CF_PAGES;
    delete process.env.CF_PAGES_BRANCH;
    delete process.env.TEST_ENV_VAR;
  });
  
  describe('LocalEnvironment', () => {
    it('should correctly identify as local environment', () => {
      const localEnv = new LocalEnvironment();
      const info = localEnv.getInfo();
      
      expect(info.type).toBe(EnvironmentType.LOCAL);
      expect(info.isDevelopment).toBe(true);
      expect(info.isProduction).toBe(false);
    });
    
    it('should handle environment variables', () => {
      const localEnv = new LocalEnvironment();
      
      // Test non-existent variable
      expect(localEnv.hasEnvVariable('TEST_ENV_VAR')).toBe(false);
      expect(localEnv.getEnvVariable('TEST_ENV_VAR')).toBeUndefined();
      
      // Set and test variable
      process.env.TEST_ENV_VAR = 'test-value';
      expect(localEnv.hasEnvVariable('TEST_ENV_VAR')).toBe(true);
      expect(localEnv.getEnvVariable('TEST_ENV_VAR')).toBe('test-value');
      
      // Test default value
      expect(localEnv.getEnvVariable('NON_EXISTENT', 'default')).toBe('default');
    });
    
    it('should handle in-memory storage', async () => {
      const localEnv = new LocalEnvironment();
      const testKey = 'test-key';
      const testValue = { data: 'test-value' };
      
      // Store a value
      await localEnv.storeValue(StorageType.MEMORY, testKey, testValue);
      
      // Retrieve the value
      const retrievedValue = await localEnv.retrieveValue(StorageType.MEMORY, testKey);
      expect(retrievedValue).toEqual(testValue);
      
      // Remove the value
      await localEnv.removeValue(StorageType.MEMORY, testKey);
      
      // Value should no longer exist
      const retrievedValueAfterRemoval = await localEnv.retrieveValue(StorageType.MEMORY, testKey);
      expect(retrievedValueAfterRemoval).toBeNull();
    });
    
    it('should report filesystem access as available', () => {
      const localEnv = new LocalEnvironment();
      expect(localEnv.hasFilesystemAccess()).toBe(true);
      expect(localEnv.getTempDirectoryPath()).toBeTruthy();
    });
    
    it('should create unique IDs', () => {
      const localEnv = new LocalEnvironment();
      const id1 = localEnv.createUniqueId();
      const id2 = localEnv.createUniqueId();
      
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(id2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(id1).not.toBe(id2);
    });
  });
  
  describe('CloudflareEnvironment', () => {
    it('should correctly identify as Cloudflare environment', () => {
      // Mock Cloudflare environment
      const mockEnv = {
        CF_PAGES: '1',
        CF_PAGES_BRANCH: 'main'
      };
      
      const cloudflareEnv = new CloudflareEnvironment(mockEnv);
      const info = cloudflareEnv.getInfo();
      
      expect(info.type).toBe(EnvironmentType.CLOUDFLARE);
      expect(info.isProduction).toBe(true);
      expect(info.isDevelopment).toBe(false);
    });
    
    it('should correctly identify preview deployments', () => {
      // Mock Cloudflare preview environment
      const mockEnv = {
        CF_PAGES: '1',
        CF_PAGES_BRANCH: 'feature-branch'
      };
      
      const cloudflareEnv = new CloudflareEnvironment(mockEnv);
      const info = cloudflareEnv.getInfo();
      
      expect(info.type).toBe(EnvironmentType.CLOUDFLARE);
      expect(info.isProduction).toBe(false);
      expect(info.isDevelopment).toBe(true);
      expect(info.isPreview).toBe(true);
    });
    
    it('should handle environment variables', () => {
      const mockEnv = {
        CF_PAGES: '1',
        TEST_ENV_VAR: 'cloudflare-value'
      };
      
      const cloudflareEnv = new CloudflareEnvironment(mockEnv);
      
      expect(cloudflareEnv.hasEnvVariable('TEST_ENV_VAR')).toBe(true);
      expect(cloudflareEnv.getEnvVariable('TEST_ENV_VAR')).toBe('cloudflare-value');
      
      // Test process.env fallback
      process.env.PROCESS_ENV_VAR = 'process-value';
      expect(cloudflareEnv.hasEnvVariable('PROCESS_ENV_VAR')).toBe(true);
      expect(cloudflareEnv.getEnvVariable('PROCESS_ENV_VAR')).toBe('process-value');
      
      // Cleanup
      delete process.env.PROCESS_ENV_VAR;
    });
    
    it('should report filesystem access as unavailable', () => {
      const cloudflareEnv = new CloudflareEnvironment();
      expect(cloudflareEnv.hasFilesystemAccess()).toBe(false);
      expect(cloudflareEnv.getTempDirectoryPath()).toBeNull();
    });
  });
  
  describe('Environment detector', () => {
    it('should detect local environment by default', () => {
      const env = getEnvironment();
      expect(env.getInfo().type).toBe(EnvironmentType.LOCAL);
    });
    
    it('should detect Cloudflare environment when CF_PAGES is set', () => {
      process.env.CF_PAGES = '1';
      
      const env = getEnvironment();
      expect(env.getInfo().type).toBe(EnvironmentType.CLOUDFLARE);
    });
    
    it('should allow overriding the environment', () => {
      // First get default environment
      const defaultEnv = getEnvironment();
      expect(defaultEnv.getInfo().type).toBe(EnvironmentType.LOCAL);
      
      // Then override with a Cloudflare environment
      const cloudflareEnv = new CloudflareEnvironment();
      setEnvironment(cloudflareEnv);
      
      // Get the environment again, should be the overridden one
      const overriddenEnv = getEnvironment();
      expect(overriddenEnv.getInfo().type).toBe(EnvironmentType.CLOUDFLARE);
      
      // Reset for good measure
      resetEnvironment();
    });
  });
}); 