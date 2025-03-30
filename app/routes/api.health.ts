import type { LoaderFunctionArgs } from '@remix-run/node';

export const loader = async ({ request: _request }: LoaderFunctionArgs) => {
  // Return a simple 200 OK response with some basic health information
  let uptime;

  try {
    // Try to get the process uptime, but handle environments where it's not available
    uptime = typeof process.uptime === 'function' ? process.uptime() : 0;
  } catch (_e) {
    // In environments like Cloudflare Pages where process.uptime isn't available
    uptime = 0;
  }

  return new Response(
    JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
};
