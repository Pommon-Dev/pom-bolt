import { useStore } from '@nanostores/react';
import type { LinksFunction } from '@remix-run/cloudflare';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react';
import tailwindReset from '@unocss/reset/tailwind-compat.css?url';
import { themeStore } from './lib/stores/theme';
import { stripIndents } from './utils/stripIndent';
import { createHead } from 'remix-island';
import { useEffect } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { json } from '@remix-run/cloudflare';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { loader as betaAuthLoader } from './middleware/beta-auth.server';
import { environment, getEnvironmentInfo, initEnvironmentWithContext } from './lib/environment-setup';
import type { EnvironmentInfo } from './lib/environments';
import { EnvironmentIndicator } from './components/system/EnvironmentIndicator';
import { BackgroundSync } from './components/BackgroundSync';

import reactToastifyStyles from 'react-toastify/dist/ReactToastify.css?url';
import globalStyles from './styles/index.scss?url';
import xtermStyles from '@xterm/xterm/css/xterm.css?url';

import 'virtual:uno.css';

export const links: LinksFunction = () => [
  {
    rel: 'icon',
    href: '/faviconpommon.svg',
    type: 'image/svg+xml',
  },
  { rel: 'stylesheet', href: reactToastifyStyles },
  { rel: 'stylesheet', href: tailwindReset },
  { rel: 'stylesheet', href: globalStyles },
  { rel: 'stylesheet', href: xtermStyles },
  {
    rel: 'preconnect',
    href: 'https://fonts.googleapis.com',
  },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
];

const inlineThemeCode = stripIndents`
  setTutorialKitTheme();

  function setTutorialKitTheme() {
    let theme = localStorage.getItem('bolt_theme');

    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.querySelector('html')?.setAttribute('data-theme', theme);
  }
`;

export const Head = createHead(() => (
  <>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <Meta />
    <Links />
    <script dangerouslySetInnerHTML={{ __html: inlineThemeCode }} />
  </>
));

export function Layout({ children }: { children: React.ReactNode }) {
  const theme = useStore(themeStore);

  useEffect(() => {
    document.querySelector('html')?.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <DndProvider backend={HTML5Backend}>
      <BackgroundSync />
      {children}
      <EnvironmentIndicator />
      <ScrollRestoration />
      <Scripts />
    </DndProvider>
  );
}

import { logStore } from './lib/stores/logs';

interface BetaAuthResponse {
  authorized: boolean;
  message?: string;
  error?: string;
}

interface LoaderData {
  environmentInfo?: EnvironmentInfo;
  authorized?: boolean;
  message?: string;
  error?: string;
}

export async function loader(args: LoaderFunctionArgs) {
  // Initialize environment with context (important to do this first)
  initEnvironmentWithContext(args.context);

  // Check beta access first
  const betaAuthResponse = await betaAuthLoader(args);

  // Clone the response before reading it to avoid "Body already read" error
  const betaAuthClone = betaAuthResponse.clone();
  const betaAuth = (await betaAuthClone.json()) as BetaAuthResponse;

  if (!betaAuth.authorized) {
    return betaAuthResponse;
  }

  // Return environment info alongside empty data
  return json<LoaderData>({
    environmentInfo: getEnvironmentInfo(),
  });
}

export default function App() {
  const theme = useStore(themeStore);
  const data = useLoaderData<typeof loader>();

  // Safely access environmentInfo
  const environmentInfo = (data as LoaderData).environmentInfo;

  useEffect(() => {
    logStore.logSystem('Application initialized', {
      theme,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      environment: environmentInfo?.type,
      isProduction: environmentInfo?.isProduction,
    });
  }, [environmentInfo]);

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
