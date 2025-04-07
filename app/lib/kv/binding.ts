import type { KVNamespace } from '@cloudflare/workers-types';

// Define the expected environment interface
export interface Env {
  POM_BOLT_PROJECTS?: KVNamespace;
}

/**
 * Get a KV namespace from the provided context
 */
export function getKvNamespace(context: unknown): KVNamespace | null {
  console.log('Received context for KV access:', typeof context, context ? (Object.keys(context as any).join(',')) : 'null');
  
  try {
    // First try accessing global KV namespace (Cloudflare Workers/Pages)
    if (typeof globalThis !== 'undefined' && 'POM_BOLT_PROJECTS' in globalThis) {
      const globalKv = (globalThis as any).POM_BOLT_PROJECTS;
      if (typeof globalKv?.get === 'function') {
        console.log('Found KV binding via global namespace');
        return globalKv as KVNamespace;
      }
    }
    
    // Direct binding access (Cloudflare Workers direct binding format)
    if (
      typeof context === 'object' && 
      context !== null && 
      'env' in (context as any) && 
      (context as any).env?.POM_BOLT_PROJECTS
    ) {
      const directKv = (context as any).env.POM_BOLT_PROJECTS;
      if (typeof directKv?.get === 'function') {
        console.log('Found KV binding via direct env.POM_BOLT_PROJECTS context access');
        return directKv as KVNamespace;
      }
    }
    
    // For environment in new Cloudflare Workers structure
    if (typeof context === 'object' && context && 'cloudflare' in (context as any)) {
      const cf = (context as any).cloudflare;
      console.log('Found cloudflare context with keys:', cf ? Object.keys(cf).join(',') : 'none');
      
      // Try env in cloudflare object
      if (cf?.env?.POM_BOLT_PROJECTS && typeof cf.env.POM_BOLT_PROJECTS?.get === 'function') {
        console.log('Found KV binding via context.cloudflare.env');
        return cf.env.POM_BOLT_PROJECTS as KVNamespace;
      }
      
      // Try context in cloudflare object (might contain env)
      if (cf?.context?.env?.POM_BOLT_PROJECTS && typeof cf.context.env.POM_BOLT_PROJECTS?.get === 'function') {
        console.log('Found KV binding via context.cloudflare.context.env');
        return cf.context.env.POM_BOLT_PROJECTS as KVNamespace;
      }
    }

    // Check for direct context.env pattern (seen in some CF Pages setups)
    if (
      typeof context === 'object' && 
      context !== null && 
      (context as any).env &&
      typeof (context as any).env === 'object'
    ) {
      const contextEnv = (context as any).env;
      console.log('Found context.env with keys:', Object.keys(contextEnv).join(','));
      
      if (contextEnv.POM_BOLT_PROJECTS && typeof contextEnv.POM_BOLT_PROJECTS?.get === 'function') {
        console.log('Found KV binding via context.env.POM_BOLT_PROJECTS');
        return contextEnv.POM_BOLT_PROJECTS as KVNamespace;
      }
    }
    
    console.warn('KV namespace POM_BOLT_PROJECTS not found in any expected location', {
      contextType: typeof context,
      contextKeys: context && typeof context === 'object' ? Object.keys(context as any).join(',') : 'none',
      hasCloudflare: context && typeof context === 'object' && 'cloudflare' in (context as any),
      hasEnv: context && typeof context === 'object' && 'env' in (context as any),
      envKeys: context && typeof context === 'object' && 'env' in (context as any) ? 
        Object.keys((context as any).env).join(',') : 'none'
    });
    return null;
  } catch (error) {
    console.error('Error accessing KV namespace:', error);
    return null;
  }
}

/**
 * Get a value from KV storage using the provided context
 */
export async function kvGet<T = any>(context: unknown, key: string): Promise<T | null> {
  console.log(`Attempting to get value from KV with key: ${key}`);
  const kv = getKvNamespace(context);
  
  if (!kv) {
    console.warn(`KV namespace not found when trying to get key: ${key}`);
    return null;
  }
  
  try {
    const value = await kv.get(key);
    if (!value) {
      console.log(`No value found in KV for key: ${key}`);
      return null;
    }
    
    console.log(`Successfully retrieved value from KV for key: ${key}`);
    return JSON.parse(value) as T;
  } catch (error) {
    console.error(`Error getting value from KV for key: ${key}:`, error);
    return null;
  }
}

/**
 * Put a value in KV storage using the provided context
 */
export async function kvPut(context: unknown, key: string, value: any): Promise<boolean> {
  console.log(`Attempting to store value in KV with key: ${key}, value type: ${typeof value}`);
  const kv = getKvNamespace(context);
  
  if (!kv) {
    console.warn(`KV namespace not found when trying to put key: ${key}`);
    return false;
  }
  
  try {
    let valueToStore: string;
    
    // Handle binary data specially (don't JSON stringify)
    if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
      console.log(`Storing binary data in KV, size: ${value.byteLength} bytes`);
      await kv.put(key, value);
      console.log(`Successfully stored binary data in KV for key: ${key}`);
      return true;
    } else {
      // For non-binary data, stringify as JSON
      valueToStore = JSON.stringify(value);
      await kv.put(key, valueToStore);
      console.log(`Successfully stored JSON data in KV for key: ${key}`);
      return true;
    }
  } catch (error) {
    console.error(`Error storing value in KV for key: ${key}:`, error);
    return false;
  }
}

export async function kvDelete(context: unknown, key: string): Promise<boolean> {
  const kv = getKvNamespace(context);
  if (!kv) return false;

  try {
    await kv.delete(key);
    return true;
  } catch (error) {
    console.error('Error deleting value from KV:', error);
    return false;
  }
}

export async function kvList(context: unknown, prefix?: string): Promise<string[]> {
  const kv = getKvNamespace(context);
  if (!kv) return [];

  try {
    const listOptions = prefix ? { prefix } : undefined;
    const list = await kv.list(listOptions);
    return list.keys.map(key => key.name);
  } catch (error) {
    console.error('Error listing keys from KV:', error);
    return [];
  }
} 