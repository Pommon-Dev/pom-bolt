import type { LanguageModelV1 } from 'ai';
import type { ProviderInfo, ProviderConfig, ModelInfo } from './types';
import type { IProviderSetting } from '~/types/model';
import { createOpenAI } from '@ai-sdk/openai';
import { LLMManager } from './manager';

export abstract class BaseProvider implements ProviderInfo {
  abstract name: string;
  abstract staticModels: ModelInfo[];
  abstract config: ProviderConfig;
  cachedDynamicModels?: {
    cacheId: string;
    models: ModelInfo[];
  };

  getApiKeyLink?: string;
  labelForGetApiKey?: string;
  icon?: string;

  getProviderBaseUrlAndKey(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: IProviderSetting;
    serverEnv?: Record<string, string>;
    defaultBaseUrlKey: string;
    defaultApiTokenKey: string;
  }) {
    const { apiKeys, providerSettings, serverEnv, defaultBaseUrlKey, defaultApiTokenKey } = options;
    let settingsBaseUrl = providerSettings?.baseUrl;
    const manager = LLMManager.getInstance();

    if (settingsBaseUrl && settingsBaseUrl.length == 0) {
      settingsBaseUrl = undefined;
    }

    const baseUrlKey = this.config.baseUrlKey || defaultBaseUrlKey;
    let baseUrl =
      settingsBaseUrl ||
      serverEnv?.[baseUrlKey] ||
      process?.env?.[baseUrlKey] ||
      manager.env?.[baseUrlKey] ||
      this.config.baseUrl;

    if (baseUrl && baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }

    const apiTokenKey = this.config.apiTokenKey || defaultApiTokenKey;
    
    // Enhanced API key lookup with more direct access attempts for Cloudflare environment
    // First check if API key is directly provided through apiKeys
    let apiKey = apiKeys?.[this.name];
    
    // If not found, try various environment sources
    if (!apiKey) {
      // Check all possible environment variable formats
      apiKey = serverEnv?.[apiTokenKey] || 
               // Try plain environment variable
               serverEnv?.[apiTokenKey.toUpperCase()] ||
               // Try Cloudflare environment structure
               (serverEnv as any)?.env?.[apiTokenKey.toUpperCase()] ||
               // Try process.env
               process?.env?.[apiTokenKey] ||
               process?.env?.[apiTokenKey.toUpperCase()] ||
               // Try manager.env
               manager.env?.[apiTokenKey] ||
               manager.env?.[apiTokenKey.toUpperCase()];
      
      // Debug logging for API key resolution
      console.log(`[BaseProvider] API key resolution for ${this.name}:`, {
        provider: this.name,
        apiTokenKey,
        apiKeyFound: !!apiKey,
        hasServerEnv: !!serverEnv,
        serverEnvType: typeof serverEnv,
        hasTokenInEnv: serverEnv ? apiTokenKey in (serverEnv as any) : false,
        hasUppercaseToken: serverEnv ? apiTokenKey.toUpperCase() in (serverEnv as any) : false,
        hasNestedEnv: serverEnv && typeof serverEnv === 'object' ? 'env' in (serverEnv as any) : false
      });
    }

    return {
      baseUrl,
      apiKey,
    };
  }
  getModelsFromCache(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
    serverEnv?: Record<string, string>;
  }): ModelInfo[] | null {
    if (!this.cachedDynamicModels) {
      // console.log('no dynamic models',this.name);
      return null;
    }

    const cacheKey = this.cachedDynamicModels.cacheId;
    const generatedCacheKey = this.getDynamicModelsCacheKey(options);

    if (cacheKey !== generatedCacheKey) {
      // console.log('cache key mismatch',this.name,cacheKey,generatedCacheKey);
      this.cachedDynamicModels = undefined;
      return null;
    }

    return this.cachedDynamicModels.models;
  }
  getDynamicModelsCacheKey(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
    serverEnv?: Record<string, string>;
  }) {
    return JSON.stringify({
      apiKeys: options.apiKeys?.[this.name],
      providerSettings: options.providerSettings?.[this.name],
      serverEnv: options.serverEnv,
    });
  }
  storeDynamicModels(
    options: {
      apiKeys?: Record<string, string>;
      providerSettings?: Record<string, IProviderSetting>;
      serverEnv?: Record<string, string>;
    },
    models: ModelInfo[],
  ) {
    const cacheId = this.getDynamicModelsCacheKey(options);

    // console.log('caching dynamic models',this.name,cacheId);
    this.cachedDynamicModels = {
      cacheId,
      models,
    };
  }

  // Declare the optional getDynamicModels method
  getDynamicModels?(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]>;

  abstract getModelInstance(options: {
    model: string;
    serverEnv?: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1;
}

type OptionalApiKey = string | undefined;

export function getOpenAILikeModel(baseURL: string, apiKey: OptionalApiKey, model: string) {
  const openai = createOpenAI({
    baseURL,
    apiKey,
  });

  return openai(model);
}
