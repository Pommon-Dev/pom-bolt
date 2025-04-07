import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('google-provider');

export default class GoogleProvider extends BaseProvider {
  name = 'Google';
  getApiKeyLink = 'https://aistudio.google.com/app/apikey';

  config = {
    apiTokenKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
  };

  staticModels: ModelInfo[] = [
    { name: 'gemini-1.5-flash-latest', label: 'Gemini 1.5 Flash', provider: 'Google', maxTokenAllowed: 8192 },
    {
      name: 'gemini-2.0-flash-thinking-exp-01-21',
      label: 'Gemini 2.0 Flash-thinking-exp-01-21',
      provider: 'Google',
      maxTokenAllowed: 65536,
    },
    { name: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash', provider: 'Google', maxTokenAllowed: 8192 },
    { name: 'gemini-1.5-flash-002', label: 'Gemini 1.5 Flash-002', provider: 'Google', maxTokenAllowed: 8192 },
    { name: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash-8b', provider: 'Google', maxTokenAllowed: 8192 },
    { name: 'gemini-1.5-pro-latest', label: 'Gemini 1.5 Pro', provider: 'Google', maxTokenAllowed: 8192 },
    { name: 'gemini-1.5-pro-002', label: 'Gemini 1.5 Pro-002', provider: 'Google', maxTokenAllowed: 8192 },
    { name: 'gemini-exp-1206', label: 'Gemini exp-1206', provider: 'Google', maxTokenAllowed: 8192 },
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
        defaultApiTokenKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
      });

      if (!apiKey) {
        logger.error('Missing API key configuration for Google Gemini provider');
        throw new Error(`Missing API key configuration for ${this.name} provider`);
      }

      logger.debug('Fetching Google Gemini models');

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
        headers: {
          ['Content-Type']: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to fetch Google Gemini models', { status: response.status, error: errorText });
        throw new Error(`Failed to fetch Google Gemini models: ${response.status} ${errorText}`);
      }

      const res = (await response.json()) as any;

      if (!res.models) {
        logger.warn('No models returned from Google Gemini API');
        return [];
      }

      const data = res.models.filter((model: any) => model.outputTokenLimit > 8000);

      logger.debug(`Found ${data.length} Google Gemini models with high token limits`);

      return data.map((m: any) => ({
        name: m.name.replace('models/', ''),
        label: `${m.displayName} - context ${Math.floor((m.inputTokenLimit + m.outputTokenLimit) / 1000) + 'k'}`,
        provider: this.name,
        maxTokenAllowed: m.inputTokenLimit + m.outputTokenLimit || 8000,
      }));
    } catch (error) {
      logger.error('Error in getDynamicModels', { error: error instanceof Error ? error.message : String(error) });
      return []; // Return empty array instead of throwing to prevent UI failures
    }
  }

  getModelInstance(options: {
    model: string;
    serverEnv: any;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    try {
      const { model, serverEnv, apiKeys, providerSettings } = options;

      const { apiKey } = this.getProviderBaseUrlAndKey({
        apiKeys,
        providerSettings: providerSettings?.[this.name],
        serverEnv: serverEnv as any,
        defaultBaseUrlKey: '',
        defaultApiTokenKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
      });

      if (!apiKey) {
        logger.error('Missing API key for Google Gemini provider when creating model instance');
        throw new Error(`Missing API key for ${this.name} provider`);
      }

      // Log API key length and first/last few characters for debugging
      logger.debug('Creating Google Gemini model instance', {
        model,
        apiKeyLength: apiKey.length,
        apiKeyPrefix: apiKey.substring(0, 3) + '...',
        apiKeySuffix: '...' + apiKey.substring(apiKey.length - 3),
      });

      const google = createGoogleGenerativeAI({
        apiKey,
      });

      return google(model);
    } catch (error) {
      logger.error('Error creating Google Gemini model instance', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error; // Re-throw to allow proper error handling
    }
  }
}
