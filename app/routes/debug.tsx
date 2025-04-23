import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { useState } from 'react';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { D1StorageAdapter } from '~/lib/projects/adapters/d1-storage-adapter';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('debug-page');

export async function loader({ context }: LoaderFunctionArgs) {
  logger.info('Debug page loader context', { 
    hasContext: !!context,
    hasCf: !!(context as any)?.cloudflare,
    hasCfEnv: !!(context as any)?.cloudflare?.env,
    hasDB: !!(context as any)?.cloudflare?.env?.DB
  });

  try {
    const db = (context as any)?.cloudflare?.env?.DB;
    
    if (!db) {
      return json({
        error: 'No DB in context',
        hasDB: false
      });
    }
    
    // Check database connection directly
    const tablesResult = await db
      .prepare('SELECT name FROM sqlite_master WHERE type="table"')
      .all();
    
    // Try to get the requirements project directly
    const d1Adapter = new D1StorageAdapter(db);
    const requirementsProject = await d1Adapter.getProject('requirements');
    
    return json({
      success: true,
      hasDB: true,
      tables: tablesResult.results,
      requirementsExists: !!requirementsProject,
      requirementsProject,
      d1QueryResult: await db
        .prepare('SELECT * FROM projects WHERE id = ?')
        .bind('requirements')
        .first()
    });
  } catch (error) {
    logger.error('Debug page error', error);
    return json({
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export default function DebugPage() {
  const data = useLoaderData<typeof loader>();
  const [apiResult, setApiResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  const testApi = async () => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('projectId', 'requirements');
      formData.append('requirements', 'Test requirement from debug page');
      
      const response = await fetch('/api/requirements', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      setApiResult(result);
    } catch (error) {
      setApiResult({ error: String(error) });
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Debug Page</h1>
      
      <div className="mb-8 p-4 border rounded bg-slate-50">
        <h2 className="text-xl font-bold mb-2">Database Info</h2>
        <pre className="bg-gray-800 text-white p-4 rounded overflow-auto max-h-60">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
      
      <div className="mb-8">
        <button 
          onClick={testApi}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test API Endpoint'}
        </button>
        
        {apiResult && (
          <div className="mt-4 p-4 border rounded bg-slate-50">
            <h3 className="text-lg font-bold mb-2">API Result</h3>
            <pre className="bg-gray-800 text-white p-4 rounded overflow-auto max-h-60">
              {JSON.stringify(apiResult, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
} 