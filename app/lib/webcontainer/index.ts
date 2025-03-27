import { WebContainer } from '@webcontainer/api';
import { WORK_DIR_NAME } from '~/utils/constants';
import { cleanStackTrace } from '~/utils/stacktrace';
import { environment } from '~/config/environment';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

// Create a mock WebContainer for environments where it's not available
const createMockWebContainer = () => {
  console.warn('Using mock WebContainer because real WebContainer is not available in this environment');
  
  // Minimal implementation with the most commonly used methods
  return {
    workdir: '',
    on: (event: string, callback: any) => {
      console.log(`[MockWebContainer] Registered listener for ${event}`);
      // Return unsubscribe function
      return () => {};
    },
    fs: {
      readFile: async (path: string) => {
        console.log(`[MockWebContainer] Attempted to read file: ${path}`);
        return '';
      },
      writeFile: async (path: string, content: string) => {
        console.log(`[MockWebContainer] Attempted to write file: ${path}`);
      },
      mkdir: async (path: string) => {
        console.log(`[MockWebContainer] Attempted to create directory: ${path}`);
      },
      stat: async (path: string) => {
        console.log(`[MockWebContainer] Attempted to stat: ${path}`);
        return null;
      },
      watch: async () => {
        console.log(`[MockWebContainer] Attempted to watch files`);
        return { addEventListener: () => {} };
      }
    },
    spawn: async (command: string, args?: string[]) => {
      console.log(`[MockWebContainer] Attempted to spawn: ${command} ${args?.join(' ') || ''}`);
      return {
        output: { pipeTo: () => {} },
        input: { write: () => {}, end: () => {} },
        exit: Promise.resolve(0)
      };
    }
  } as unknown as WebContainer;
};

export let webcontainer: Promise<WebContainer> = new Promise(() => {
  // noop for ssr
});

if (!import.meta.env.SSR) {
  // If we're in Cloudflare environment and filesystem is not enabled, use mock
  const shouldUseMock = environment.isCloudflare && !environment.features.fileSystem;
  
  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve()
      .then(async () => {
        if (shouldUseMock) {
          console.log('Using mock WebContainer in Cloudflare environment');
          return createMockWebContainer();
        }
        
        try {
          console.log('Booting real WebContainer');
          return await WebContainer.boot({
            coep: 'credentialless',
            workdirName: WORK_DIR_NAME,
            forwardPreviewErrors: true, // Enable error forwarding from iframes
          });
        } catch (error) {
          console.error('Failed to boot WebContainer, falling back to mock:', error);
          return createMockWebContainer();
        }
      })
      .then(async (webcontainer) => {
        webcontainerContext.loaded = true;

        // Only set up event listeners for real WebContainer
        if (!shouldUseMock) {
          const { workbenchStore } = await import('~/lib/stores/workbench');

          // Listen for preview errors
          webcontainer.on('preview-message', (message) => {
            console.log('WebContainer preview message:', message);

            // Handle both uncaught exceptions and unhandled promise rejections
            if (message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' || message.type === 'PREVIEW_UNHANDLED_REJECTION') {
              const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';
              workbenchStore.actionAlert.set({
                type: 'preview',
                title: isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception',
                description: message.message,
                content: `Error occurred at ${message.pathname}${message.search}${message.hash}\nPort: ${message.port}\n\nStack trace:\n${cleanStackTrace(message.stack || '')}`,
                source: 'preview',
              });
            }
          });
        }

        return webcontainer;
      });

  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }
}
