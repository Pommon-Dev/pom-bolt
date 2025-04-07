import { json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { CodegenService } from '~/lib/codegen/service';

const logger = createScopedLogger('api-test-codegen');

/**
 * Route for testing code generation
 * POST /api/test-codegen - Test code generation functionality
 */
export async function action({ request, context }: ActionFunctionArgs) {
  try {
    // Parse the request body
    let body: any;
    const contentType = request.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      // Handle form data
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    }

    // Extract parameters
    const { 
      requirements = 'Create a simple React app that displays a counter', 
      existingFiles = {},
      projectId = 'test-project-' + Date.now(),
      isNewProject = true
    } = body;

    logger.info(`Testing code generation for project ${projectId}`);

    // Call CodegenService
    const codegenResult = await CodegenService.generateCode({
      requirements,
      existingFiles,
      projectId,
      isNewProject,
      serverEnv: context?.cloudflare?.env || {},
    });

    // Return the generated files
    return json({
      success: true,
      projectId,
      fileCount: Object.keys(codegenResult.files).length,
      files: codegenResult.files,
      metadata: codegenResult.metadata
    });
  } catch (error) {
    logger.error('Error testing code generation:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * GET handler to return test form
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const format = url.searchParams.get('format') || 'json';
  
  // Return HTML form for browser interaction
  if (format === 'html') {
    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Code Generation</title>
          <style>
            body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
            textarea { width: 100%; height: 200px; margin-bottom: 1rem; }
            button { padding: 0.5rem 1rem; background: #0070f3; color: white; border: none; border-radius: 4px; cursor: pointer; }
            pre { background: #f1f1f1; padding: 1rem; overflow: auto; max-height: 400px; }
          </style>
        </head>
        <body>
          <h1>Test Code Generation</h1>
          <form id="testForm">
            <div>
              <label for="requirements">Requirements:</label>
              <textarea id="requirements" name="requirements">Create a simple React app that displays a counter</textarea>
            </div>
            <div>
              <label for="isNewProject">
                <input type="checkbox" id="isNewProject" name="isNewProject" checked>
                New Project
              </label>
            </div>
            <button type="submit">Generate Code</button>
          </form>
          
          <div id="result" style="margin-top: 2rem;">
            <h2>Result</h2>
            <pre id="resultContent">Submit the form to see results here.</pre>
          </div>
          
          <script>
            document.getElementById('testForm').addEventListener('submit', async (e) => {
              e.preventDefault();
              const requirements = document.getElementById('requirements').value;
              const isNewProject = document.getElementById('isNewProject').checked;
              
              const resultEl = document.getElementById('resultContent');
              resultEl.textContent = 'Generating code...';
              
              try {
                const response = await fetch('/api/test-codegen', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ requirements, isNewProject })
                });
                
                const data = await response.json();
                resultEl.textContent = JSON.stringify(data, null, 2);
              } catch (error) {
                resultEl.textContent = 'Error: ' + error.message;
              }
            });
          </script>
        </body>
      </html>
      `,
      {
        headers: {
          'Content-Type': 'text/html',
        },
      }
    );
  }
  
  // Return example JSON response
  return json({
    info: 'This endpoint tests code generation functionality',
    usage: 'POST with requirements, existingFiles (optional), and isNewProject (default: true)',
    example: {
      requirements: 'Create a simple React app that displays a counter',
      isNewProject: true
    }
  });
} 