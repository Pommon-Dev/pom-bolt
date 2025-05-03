import type { KVNamespace } from '@cloudflare/workers-types';

// Define the expected environment interface
export interface Env {
  POM_BOLT_PROJECTS?: KVNamespace;
  POM_BOLT_PROJECTS_preview?: KVNamespace;
}

/**
 * Get a KV namespace from the provided context
 */
export function getKvNamespace(context: unknown): KVNamespace | null {
  console.log('Received context for KV access:', typeof context, context ? (Object.keys(context as any).join(',')) : 'null');
  
  try {
    // Determine if we're in preview environment
    let isPreview = false;
    const checkPreview = (ctx: any) => {
      if (!ctx) return false;
      
      // Check for environment indicator
      if (ctx.ENVIRONMENT === 'preview') return true;
      if (ctx.env?.ENVIRONMENT === 'preview') return true;
      if (ctx.cloudflare?.env?.ENVIRONMENT === 'preview') return true;
      
      // Check for CF Pages branch indicator (not main branch)
      if (ctx.CF_PAGES === '1') {
        const branch = ctx.CF_PAGES_BRANCH;
        if (branch && branch !== 'main' && branch !== 'master') return true;
      }
      
      if (ctx.env?.CF_PAGES === '1') {
        const branch = ctx.env.CF_PAGES_BRANCH;
        if (branch && branch !== 'main' && branch !== 'master') return true;
      }
      
      if (ctx.cloudflare?.env?.CF_PAGES === '1') {
        const branch = ctx.cloudflare.env.CF_PAGES_BRANCH;
        if (branch && branch !== 'main' && branch !== 'master') return true;
      }
      
      // Check for tenant ID indicator
      if (ctx.DEFAULT_TENANT_ID === 'preview') return true;
      if (ctx.env?.DEFAULT_TENANT_ID === 'preview') return true;
      if (ctx.cloudflare?.env?.DEFAULT_TENANT_ID === 'preview') return true;
      
      return false;
    };
    
    if (context && typeof context === 'object') {
      isPreview = checkPreview(context as any);
    }
    
    console.log(`Environment detection - isPreview: ${isPreview}`);
    
    // Define binding names to check based on environment
    const bindingNames = ['POM_BOLT_PROJECTS'];
    
    // Add environment-specific binding names for preview
    if (isPreview) {
      bindingNames.push('POM_BOLT_PROJECTS_preview');
    }
    
    // Special check for Cloudflare Pages with CF_PAGES env variable
    if (
      typeof context === 'object' && 
      context !== null && 
      'cloudflare' in (context as any) && 
      (context as any).cloudflare?.env?.CF_PAGES
    ) {
      // We're in Cloudflare Pages - prioritize checking cloudflare.env
      const cf = (context as any).cloudflare;
      console.log('Detected Cloudflare Pages environment with keys:', 
        cf.env ? Object.keys(cf.env).filter(k => k.includes('POM_BOLT')).join(',') : 'none');
      
      // Check each potential binding name
      for (const bindingName of bindingNames) {
        if (cf.env?.[bindingName] && typeof cf.env[bindingName]?.get === 'function') {
          console.log(`Found KV binding via context.cloudflare.env.${bindingName} in Pages environment`);
          return cf.env[bindingName] as KVNamespace;
        }
      }
    }
    
    // Try accessing global KV namespace (Cloudflare Workers/Pages)
    for (const bindingName of bindingNames) {
      if (typeof globalThis !== 'undefined' && bindingName in (globalThis as any)) {
        const globalKv = (globalThis as any)[bindingName];
        if (typeof globalKv?.get === 'function') {
          console.log(`Found KV binding via global namespace: ${bindingName}`);
          return globalKv as KVNamespace;
        }
      }
    }
    
    // Direct binding access (Cloudflare Workers direct binding format)
    if (
      typeof context === 'object' && 
      context !== null && 
      'env' in (context as any)
    ) {
      for (const bindingName of bindingNames) {
        const directKv = (context as any).env[bindingName];
        if (directKv && typeof directKv?.get === 'function') {
          console.log(`Found KV binding via direct env.${bindingName} context access`);
          return directKv as KVNamespace;
        }
      }
    }
    
    // For environment in new Cloudflare Workers structure
    if (typeof context === 'object' && context && 'cloudflare' in (context as any)) {
      const cf = (context as any).cloudflare;
      console.log('Found cloudflare context with keys:', cf ? Object.keys(cf).join(',') : 'none');
      
      // Try env in cloudflare object
      if (cf?.env) {
        for (const bindingName of bindingNames) {
          if (cf.env[bindingName] && typeof cf.env[bindingName]?.get === 'function') {
            console.log(`Found KV binding via context.cloudflare.env.${bindingName}`);
            return cf.env[bindingName] as KVNamespace;
          }
        }
      }
      
      // Try context in cloudflare object (might contain env)
      if (cf?.context?.env) {
        for (const bindingName of bindingNames) {
          if (cf.context.env[bindingName] && typeof cf.context.env[bindingName]?.get === 'function') {
            console.log(`Found KV binding via context.cloudflare.context.env.${bindingName}`);
            return cf.context.env[bindingName] as KVNamespace;
          }
        }
      }
      
      // If we have any environment with KV namespaces, check all of them
      if (cf?.env) {
        // Log all bindings that look like KV namespaces
        const possibleKvBindings = Object.entries(cf.env)
          .filter(([_, value]) => value && typeof (value as any)?.get === 'function')
          .map(([key]) => key);
        
        if (possibleKvBindings.length > 0) {
          console.log('Found possible KV bindings:', possibleKvBindings.join(','));
          
          // First try to find exact matches from our binding names
          for (const bindingName of bindingNames) {
            if (possibleKvBindings.includes(bindingName)) {
              console.log(`Using KV binding: ${bindingName}`);
              return cf.env[bindingName] as KVNamespace;
            }
          }
          
          // If no exact match, try to find any POM_BOLT_ binding
          const projectsKv = possibleKvBindings.find(key => 
            key.startsWith('POM_BOLT_PROJECTS') || 
            key === 'POM_BOLT_FILES' || 
            key === 'POM_BOLT_CACHE');
          
          if (projectsKv) {
            console.log(`Using alternative KV binding: ${projectsKv}`);
            return cf.env[projectsKv] as KVNamespace;
          }
        }
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
      
      for (const bindingName of bindingNames) {
        if (contextEnv[bindingName] && typeof contextEnv[bindingName]?.get === 'function') {
          console.log(`Found KV binding via context.env.${bindingName}`);
          return contextEnv[bindingName] as KVNamespace;
        }
      }
      
      // Check for any KV-like bindings as a last resort
      const possibleKvBindings = Object.entries(contextEnv)
        .filter(([_, value]) => value && typeof (value as any)?.get === 'function')
        .map(([key]) => key);
      
      if (possibleKvBindings.length > 0) {
        console.log('Found possible KV bindings in context.env:', possibleKvBindings.join(','));
        
        // First try to find exact matches from our binding names
        for (const bindingName of bindingNames) {
          if (possibleKvBindings.includes(bindingName)) {
            console.log(`Using KV binding from context.env: ${bindingName}`);
            return contextEnv[bindingName] as KVNamespace;
          }
        }
        
        // If no exact match, try to find any POM_BOLT_ binding
        const projectsKv = possibleKvBindings.find(key => 
          key.startsWith('POM_BOLT_PROJECTS') || 
          key === 'POM_BOLT_FILES' || 
          key === 'POM_BOLT_CACHE');
        
        if (projectsKv) {
          console.log(`Using alternative KV binding from context.env: ${projectsKv}`);
          return contextEnv[projectsKv] as KVNamespace;
        }
      }
    }
    
    console.warn('KV namespace not found in any expected location', {
      contextType: typeof context,
      contextKeys: context && typeof context === 'object' ? Object.keys(context as any).join(',') : 'none',
      hasCloudflare: context && typeof context === 'object' && 'cloudflare' in (context as any),
      hasEnv: context && typeof context === 'object' && 'env' in (context as any),
      envKeys: context && typeof context === 'object' && 'env' in (context as any) ? 
        Object.keys((context as any).env).join(',') : 'none',
      cfEnvKeys: context && typeof context === 'object' && 'cloudflare' in (context as any) && (context as any).cloudflare?.env ?
        Object.keys((context as any).cloudflare.env).join(',') : 'none',
      attemptedBindings: bindingNames.join(','),
      isPreview
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