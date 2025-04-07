import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('debug-request');

/**
 * Simple endpoint to debug request parsing
 */
export async function action({ request, context }: ActionFunctionArgs) {
  try {
    logger.info('Received debug request');
    
    // Log request information
    const method = request.method;
    const url = request.url;
    const headers = Object.fromEntries(
      Array.from(request.headers.entries())
        .map(([key, value]) => [key, value])
    );
    
    // Try to read the body in different ways
    let jsonBody = null;
    let textBody = null;
    let formData = null;
    let error = null;
    
    try {
      // Clone the request multiple times to read it in different ways
      const jsonRequest = request.clone();
      const textRequest = request.clone();
      const formRequest = request.clone();
      
      // Try to parse as JSON
      try {
        jsonBody = await jsonRequest.json();
      } catch (jsonError) {
        logger.error('Failed to parse as JSON:', jsonError);
      }
      
      // Try to get as text
      try {
        textBody = await textRequest.text();
      } catch (textError) {
        logger.error('Failed to get as text:', textError);
      }
      
      // Try to parse as form data
      try {
        const formDataObj = await formRequest.formData();
        formData = Object.fromEntries(formDataObj.entries());
      } catch (formError) {
        logger.error('Failed to parse as form data:', formError);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      logger.error('Error processing request:', e);
    }
    
    return json({
      success: true,
      request: {
        method,
        url,
        headers
      },
      body: {
        json: jsonBody,
        text: textBody ? {
          length: textBody.length,
          preview: textBody.substring(0, 100),
          isJson: textBody.startsWith('{')
        } : null,
        form: formData
      },
      error
    });
  } catch (error) {
    logger.error('Unexpected error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error processing request',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}

/**
 * GET endpoint to provide instructions
 */
export async function loader({ request }: LoaderFunctionArgs) {
  return json({
    instructions: "Send a POST request to this endpoint to debug request parsing",
    example: {
      curl: "curl -X POST http://localhost:8788/api/debug-request -H 'Content-Type: application/json' -d '{\"content\":\"test content\"}'"
    }
  });
} 