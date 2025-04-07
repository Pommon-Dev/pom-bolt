import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { getKvNamespace, kvGet, kvPut, kvDelete } from "~/lib/kv/binding";

export async function loader({ request, context }: LoaderFunctionArgs) {
  console.log("KV Test Route - Raw context:", context);
  
  // Get KV namespace using our helper function
  const kvNamespace = getKvNamespace(context);
  
  // Create a safe version of the KV binding for display
  const safeKvBinding = {
    exists: !!kvNamespace,
    type: typeof kvNamespace,
    isObject: typeof kvNamespace === 'object',
    hasPut: typeof kvNamespace?.put === 'function',
    hasGet: typeof kvNamespace?.get === 'function',
    hasDelete: typeof kvNamespace?.delete === 'function',
    hasList: typeof kvNamespace?.list === 'function',
    methodNames: typeof kvNamespace === 'object' && kvNamespace ? Object.getOwnPropertyNames(Object.getPrototypeOf(kvNamespace)) : []
  };

  // Try different methods of context access
  const contextAccessMethods = {
    directAccess: !!(context as any)?.POM_BOLT_PROJECTS,
    envAccess: !!(context as any)?.env?.POM_BOLT_PROJECTS,
    getBindingHelper: !!getKvNamespace(context)
  };

  // Try a basic KV operation if it exists
  let testWriteResult = null;
  let testReadResult = null;
  let staticTestResult = null;
  
  try {
    // First, try to read a static key we created earlier with wrangler
    staticTestResult = await kvGet(context, "test-key");
    
    // Then try a dynamic write/read test
    if (safeKvBinding.exists) {
      const testKey = `kv-test-${Date.now()}`;
      const testValue = { timestamp: Date.now(), message: "KV test successful" };
      
      // Write test
      const writeSuccess = await kvPut(context, testKey, testValue);
      testWriteResult = writeSuccess ? "success" : "failed";
      
      // Read test
      testReadResult = await kvGet(context, testKey);
      
      // Clean up
      await kvDelete(context, testKey);
    }
  } catch (error) {
    console.error("KV test error:", error);
    testWriteResult = `error: ${error instanceof Error ? error.message : String(error)}`;
  }
  
  // Also check request context for CF-specific headers
  const requestInfo = {
    url: request.url,
    headers: Object.fromEntries(Array.from(request.headers.entries())),
    cf: request.cf
  };
  
  return json({
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      CF_PAGES: process.env.CF_PAGES,
      ENVIRONMENT: process.env.ENVIRONMENT
    },
    context: {
      accessMethods: contextAccessMethods
    },
    request: requestInfo,
    kvBindingInfo: safeKvBinding,
    staticTestResult,
    testWriteResult,
    testReadResult,
    wranglerToml: {
      hasGlobalBinding: true, // Based on your wrangler.toml
      hasPreviewBinding: true, // Based on your wrangler.toml
      globalBindingId: "dfe2d0d711d8469298b9ebe3c4d5f596", // From your wrangler.toml
      previewBindingId: "dfe2d0d711d8469298b9ebe3c4d5f596"  // From your wrangler.toml
    }
  });
}

export default function KvTestRoute() {
  const data = useLoaderData<typeof loader>();
  
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">KV Namespace Binding Test</h1>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Environment Variables</h2>
        <pre className="bg-gray-100 p-4 rounded overflow-auto">{JSON.stringify(data.environment, null, 2)}</pre>
      </div>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">KV Access Methods</h2>
        <pre className="bg-gray-100 p-4 rounded overflow-auto">{JSON.stringify(data.context.accessMethods, null, 2)}</pre>
      </div>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">KV Binding Information</h2>
        <pre className="bg-gray-100 p-4 rounded overflow-auto">{JSON.stringify(data.kvBindingInfo, null, 2)}</pre>
      </div>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">KV Test Results</h2>
        <p>Static Test: {JSON.stringify(data.staticTestResult) || "Failed"}</p>
        <p>Write Test: {data.testWriteResult || "Not attempted"}</p>
        <p>Read Test: {data.testReadResult ? "Success" : "Failed"}</p>
        {data.testReadResult && (
          <pre className="bg-gray-100 p-4 rounded mt-2 overflow-auto">{JSON.stringify(data.testReadResult, null, 2)}</pre>
        )}
      </div>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Request Information</h2>
        <pre className="bg-gray-100 p-4 rounded overflow-auto">{JSON.stringify(data.request, null, 2)}</pre>
      </div>
      
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Wrangler.toml Configuration</h2>
        <pre className="bg-gray-100 p-4 rounded overflow-auto">{JSON.stringify(data.wranglerToml, null, 2)}</pre>
      </div>
    </div>
  );
} 