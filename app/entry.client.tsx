import { RemixBrowser } from '@remix-run/react';
import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { initEnvironmentWithContext } from './lib/environment-setup';

// Initialize environment before hydration
initEnvironmentWithContext({
  isClient: true,
  env: {
    NODE_ENV: process.env.NODE_ENV || 'development'
  }
});

startTransition(() => {
  hydrateRoot(document.getElementById('root')!, <RemixBrowser />);
});
