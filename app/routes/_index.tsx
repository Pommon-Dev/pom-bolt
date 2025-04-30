import { json, type MetaFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('_index');

export const meta: MetaFunction = () => {
  return [
    { title: 'Build Studio by Pommon' },
    { name: 'description', content: 'Build your ideas with Build Studio by Pommon.' },
  ];
};

export async function loader(args: LoaderFunctionArgs) {
  // Extract initialRequirements, fromWebhook flag, and additionalRequirement flag from the URL
  const url = new URL(args.request.url);
  const initialRequirements = url.searchParams.get('initialRequirements');
  const fromWebhook = url.searchParams.get('fromWebhook') === 'true';
  const additionalRequirement = url.searchParams.get('additionalRequirement') === 'true';

  if (initialRequirements) {
    logger.info('Initial requirements detected in URL for new project', {
      requirementsLength: initialRequirements.length,
      fromWebhook,
      isAdditionalRequirement: additionalRequirement
    });
  }

  return json({
    initialRequirements: initialRequirements ? decodeURIComponent(initialRequirements) : null,
    fromWebhook,
    additionalRequirement
  });
}

/**
 * Landing page component for Bolt
 * Note: Settings functionality should ONLY be accessed through the sidebar menu.
 * Do not add settings button/panel to this landing page as it was intentionally removed
 * to keep the UI clean and consistent with the design system.
 */
export default function Index() {
  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <ClientOnly
        fallback={
          <BaseChat
            sendMessage={() => {
              /* Fallback no-op function */
            }}
          />
        }
      >
        {() => <Chat />}
      </ClientOnly>
    </div>
  );
}
