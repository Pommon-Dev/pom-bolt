import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('openai-provider');

export default class OpenAIProvider extends BaseProvider {
  name = 'OpenAI';
  getApiKeyLink = 'https://platform.openai.com/api-keys';

  config = {
    apiTokenKey: 'OPENAI_API_KEY',
  };

  staticModels: ModelInfo[] = [
    { name: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI', maxTokenAllowed: 8000 },
    { name: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI', maxTokenAllowed: 8000 },
    { name: 'gpt-4-turbo', label: 'GPT-4 Turbo', provider: 'OpenAI', maxTokenAllowed: 8000 },
    { name: 'gpt-4', label: 'GPT-4', provider: 'OpenAI', maxTokenAllowed: 8000 },
    { name: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', provider: 'OpenAI', maxTokenAllowed: 8000 },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    try {
      const { apiKey } = this.getProviderBaseUrlAndKey({
        apiKeys,
        providerSettings: settings,
        serverEnv: serverEnv as any,
        defaultBaseUrlKey: '',
        defaultApiTokenKey: 'OPENAI_API_KEY',
      });

      if (!apiKey) {
        logger.error('Missing API key configuration for OpenAI provider');
        throw new Error(`Missing API key configuration for ${this.name} provider`);
      }

      logger.debug('Fetching OpenAI models');

      const response = await fetch(`https://api.openai.com/v1/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to fetch OpenAI models', { status: response.status, error: errorText });
        throw new Error(`Failed to fetch OpenAI models: ${response.status} ${errorText}`);
      }

      const res = (await response.json()) as any;
      const staticModelIds = this.staticModels.map((m) => m.name);

      const data = res.data.filter(
        (model: any) =>
          model.object === 'model' &&
          (model.id.startsWith('gpt-') || model.id.startsWith('o') || model.id.startsWith('chatgpt-')) &&
          !staticModelIds.includes(model.id),
      );

      return data.map((m: any) => ({
        name: m.id,
        label: `${m.id}`,
        provider: this.name,
        maxTokenAllowed: m.context_window || 32000,
      }));
    } catch (error) {
      logger.error('Error in getDynamicModels', { error: error instanceof Error ? error.message : String(error) });
      return []; // Return empty array instead of throwing to prevent UI failures
    }
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    try {
      const { model, serverEnv, apiKeys, providerSettings } = options;

      // Log environment details for debugging
      logger.debug('OpenAI provider environment details:', {
        hasServerEnv: !!serverEnv,
        serverEnvType: typeof serverEnv,
        envKeys: serverEnv ? Object.keys(serverEnv as any).filter(k => !k.includes('key') && !k.includes('Key') && !k.includes('KEY')).join(',') : 'none',
        hasApiKeys: !!apiKeys,
        apiKeysProviders: apiKeys ? Object.keys(apiKeys).join(',') : 'none',
        hasProviderSettings: !!providerSettings?.[this.name]
      });

      const { apiKey } = this.getProviderBaseUrlAndKey({
        apiKeys,
        providerSettings: providerSettings?.[this.name],
        serverEnv: serverEnv as any,
        defaultBaseUrlKey: '',
        defaultApiTokenKey: 'OPENAI_API_KEY',
      });

      if (!apiKey) {
        // Try one more direct access attempt for Cloudflare environment
        const directKey = 
          serverEnv?.OPENAI_API_KEY || 
          (serverEnv as any)?.env?.OPENAI_API_KEY || 
          (serverEnv as any)?.cloudflare?.env?.OPENAI_API_KEY;
        
        if (directKey) {
          logger.info('Retrieved OpenAI API key through direct access');
          
          // Create OpenAI instance with the direct key
          const openai = createOpenAI({
            apiKey: directKey,
          });
          
          return openai(model);
        }
        
        logger.error('Missing API key for OpenAI provider when creating model instance', {
          keyVarChecked: 'OPENAI_API_KEY',
          directAccessAttempted: true
        });
        throw new Error(`Missing API key for ${this.name} provider`);
      }

      // Log API key length and first/last few characters for debugging
      logger.debug('Creating OpenAI model instance', {
        model,
        apiKeyLength: apiKey.length,
        apiKeyPrefix: apiKey.substring(0, 3) + '...',
        apiKeySuffix: '...' + apiKey.substring(apiKey.length - 3),
      });

      const openai = createOpenAI({
        apiKey,
      });

      return openai(model);
    } catch (error) {
      logger.error('Error creating OpenAI model instance', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      throw error; // Re-throw to allow proper error handling
    }
  }
}
