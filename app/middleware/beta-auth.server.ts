import { json } from '@remix-run/cloudflare';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';

const BETA_ACCESS_CODES = process.env.BETA_ACCESS_CODES?.split(',') || [];
const BETA_COOKIE_NAME = 'beta_access';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const accessCode = url.searchParams.get('code');
  const hasAccess = request.headers.get('Cookie')?.includes(BETA_COOKIE_NAME);

  // Allow access if already authenticated
  if (hasAccess) {
    return json({ authorized: true });
  }

  // Check access code
  if (accessCode && BETA_ACCESS_CODES.includes(accessCode)) {
    // Set cookie for future access
    const headers = new Headers();
    headers.append(
      'Set-Cookie',
      `${BETA_COOKIE_NAME}=${accessCode}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`
    );
    return json({ authorized: true }, { headers });
  }

  // Return unauthorized
  return json(
    { 
      authorized: false, 
      message: 'Beta access required. Please contact support for access.',
      error: 'unauthorized'
    },
    { status: 403 }
  );
} 