import { json } from '@remix-run/cloudflare';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { kvGet, kvPut, getKvNamespace, kvList } from '~/lib/kv/binding';

const logger = createScopedLogger('api:test-kv');

/**
 * Test endpoint to check KV store accessibility
 * Route: /api/test-kv
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  logger.debug('Testing KV store access...');
  
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  const prefix = url.searchParams.get('prefix');
  
  const results: {
    hasKvBinding: boolean;
    getKvNamespaceResult: string | null;
    directBindingTest: Record<string, any> | null;
    writeTest: boolean;
    writeValue: string | null;
    readTest: boolean;
    readValue: any;
    listKeys?: string[];
    requestedKey?: string;
    error: string | null;
  } = {
    hasKvBinding: false,
    getKvNamespaceResult: null,
    directBindingTest: null,
    writeTest: false,
    writeValue: null,
    readTest: false,
    readValue: null,
    error: null
  };

  try {
    // Check if we can get the KV namespace
    const kv = getKvNamespace(context);
    results.hasKvBinding = kv !== null;
    results.getKvNamespaceResult = typeof kv;
    
    // Try to access the binding directly
    if (context) {
      const hasBinding = !!(context as any).POM_BOLT_PROJECTS;
      const bindingType = typeof (context as any).POM_BOLT_PROJECTS;
      const hasPut = typeof (context as any).POM_BOLT_PROJECTS?.put === 'function';
      const hasGet = typeof (context as any).POM_BOLT_PROJECTS?.get === 'function';
      
      results.directBindingTest = {
        hasBinding,
        bindingType,
        hasPut,
        hasGet
      };
    }
    
    // If a specific key is requested, try to get it
    if (key) {
      results.requestedKey = key;
      const keyValue = await kvGet(context, key);
      if (keyValue) {
        results.readTest = true;
        results.readValue = keyValue;
      } else {
        results.readTest = false;
        results.readValue = null;
      }
      
      return json(results);
    }
    
    // If a prefix is provided, list all keys with that prefix
    if (prefix) {
      const keys = await kvList(context, prefix);
      results.listKeys = keys;
      return json(results);
    }
    
    // Otherwise run the standard test
    const testKey = `test-key-${Date.now()}`;
    const testValue = `test-value-${Date.now()}`;
    
    const writeSuccess = await kvPut(context, testKey, testValue);
    results.writeTest = writeSuccess;
    results.writeValue = testValue;
    
    // Try to read from KV
    if (writeSuccess) {
      const readValue = await kvGet(context, testKey);
      results.readTest = readValue !== null;
      results.readValue = readValue;
    }
    
    // Log the environment context structure
    logger.debug('Context structure:', {
      contextType: typeof context,
      hasEnv: !!(context as any).env,
      envType: typeof (context as any).env,
      keys: Object.keys(context || {}).join(', '),
      cloudflarePresent: !!(context as any).cloudflare,
    });
    
    return json(results);
  } catch (error) {
    logger.error('Error testing KV store:', error);
    results.error = error instanceof Error ? error.message : 'Unknown error';
    return json(results, { status: 500 });
  }
} 