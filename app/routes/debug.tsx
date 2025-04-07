import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { getEnvironment, detectEnvironment } from "~/lib/environments";
import { EnvironmentType, StorageType } from "~/lib/environments";
import { initEnvironmentWithContext } from "~/lib/environment-setup";

export async function loader({ request, context }: LoaderFunctionArgs) {
  // Log the raw context object for debugging
  console.log("Debug route - Context object:", context);
  
  // Check detection directly first
  const detectedEnv = detectEnvironment(context);
  console.log("Direct environment detection result:", detectedEnv.getInfo().type);
  
  // Initialize environment with context
  initEnvironmentWithContext(context);
  
  // Get the initialized environment
  const env = getEnvironment();
  console.log("Environment after initialization:", env.getInfo().type);
  
  // Create a safe version of the context for display (to avoid circular references)
  const safeContext: Record<string, any> = {};
  if (context) {
    for (const key of Object.keys(context)) {
      try {
        // Skip functions and complex objects
        const val = (context as Record<string, any>)[key];
        if (typeof val === 'function') {
          safeContext[key] = '[Function]';
        } else if (typeof val === 'object' && val !== null) {
          // Check if it's a KV namespace
          if (val && 
              'get' in val && 
              'put' in val && 
              'delete' in val && 
              typeof val.get === 'function') {
            safeContext[key] = '[KV Namespace]';
          } else {
            // For other objects, try to stringify them safely
            try {
              JSON.stringify(val);
              safeContext[key] = val;
            } catch (err) {
              safeContext[key] = '[Complex Object]';
            }
          }
        } else {
          safeContext[key] = val;
        }
      } catch (err) {
        safeContext[key] = `[Error: ${(err as Error).message}]`;
      }
    }
  }
  
  // Check for global KV namespace
  const hasGlobalKV = typeof (globalThis as any).POM_BOLT_PROJECTS !== 'undefined';
  const hasEnvKV = !!(context && (context as any).env?.POM_BOLT_PROJECTS);
  
  // Direct KV Test without going through our framework
  let directKvTestResult = null;
  try {
    if (hasEnvKV) {
      const testObj = { timestamp: Date.now(), message: "Direct KV test" };
      await (context as any).env.POM_BOLT_PROJECTS.put("direct-test-key", JSON.stringify(testObj));
      const rawValue = await (context as any).env.POM_BOLT_PROJECTS.get("direct-test-key");
      directKvTestResult = rawValue ? JSON.parse(rawValue) : null;
    }
  } catch (err) {
    directKvTestResult = `Error: ${(err as Error).message}`;
  }

  // Standard environment test
  const envInfo = env.getInfo();
  
  // Get KV binding information
  const kvBindingAvailable = !!(globalThis as any).POM_BOLT_PROJECTS;
  const contextKvAvailable = !!((context as any).env?.POM_BOLT_PROJECTS);
  
  const availableStorage = env.getAvailableStorageTypes();
  const kvAvailable = env.isStorageAvailable(StorageType.CLOUDFLARE_KV);
  
  // Write a test value to KV if available
  let testWriteResult = null;
  let testReadResult = null;
  
  try {
    if (kvAvailable) {
      await env.storeValue(StorageType.CLOUDFLARE_KV, "test-key", { timestamp: Date.now() });
      testWriteResult = "success";
      
      // Try to read it back
      const value = await env.retrieveValue(StorageType.CLOUDFLARE_KV, "test-key");
      testReadResult = value;
    }
  } catch (err) {
    testWriteResult = String(err);
  }
  
  return json({
    environmentType: envInfo.type,
    isProduction: envInfo.isProduction,
    isDevelopment: envInfo.isDevelopment,
    isPreview: envInfo.isPreview,
    availableStorage,
    kvAvailable,
    kvBindingAvailable,
    contextKvAvailable,
    testWriteResult,
    testReadResult,
    directKvTestResult,
    nodeEnv: process.env.NODE_ENV,
    contextEnvKeys: (context as any).env ? Object.keys((context as any).env) : [],
    hasGlobalKV,
    hasEnvKV,
    safeContext
  });
}

export default function DebugPage() {
  const data = useLoaderData<typeof loader>();
  
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Environment Debug Information</h1>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Environment</h2>
        <ul className="list-disc pl-6">
          <li>Type: {data.environmentType}</li>
          <li>Production: {String(data.isProduction)}</li>
          <li>Development: {String(data.isDevelopment)}</li>
          <li>Preview: {String(data.isPreview)}</li>
          <li>NODE_ENV: {data.nodeEnv}</li>
        </ul>
      </div>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Storage</h2>
        <ul className="list-disc pl-6">
          <li>Available Storage Types: {data.availableStorage.join(', ')}</li>
          <li>KV Available: {String(data.kvAvailable)}</li>
          <li>KV Binding (global): {String(data.kvBindingAvailable)}</li>
          <li>KV Binding (context): {String(data.contextKvAvailable)}</li>
          <li>Has Global KV: {String(data.hasGlobalKV)}</li>
          <li>Has Env KV: {String(data.hasEnvKV)}</li>
        </ul>
      </div>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Context Environment Keys</h2>
        <ul className="list-disc pl-6">
          {data.contextEnvKeys.map(key => (
            <li key={key}>{key}</li>
          ))}
        </ul>
      </div>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">KV Test</h2>
        <div>
          <p>Write Result: {data.testWriteResult}</p>
          <p>Read Result: {data.testReadResult ? JSON.stringify(data.testReadResult) : 'null'}</p>
          <p>Direct KV Test: {data.directKvTestResult ? JSON.stringify(data.directKvTestResult) : 'null'}</p>
        </div>
      </div>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Context Object</h2>
        <pre className="bg-gray-100 p-4 rounded overflow-auto max-h-96">
          {JSON.stringify(data.safeContext, null, 2)}
        </pre>
      </div>
    </div>
  );
} 