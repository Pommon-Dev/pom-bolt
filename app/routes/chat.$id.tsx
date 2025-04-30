import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { default as IndexRoute } from './_index';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('chat.$id');

export async function loader(args: LoaderFunctionArgs) {
  // Extract initialRequirements, additionalRequirement flag, and tenantId from the URL
  const url = new URL(args.request.url);
  const initialRequirements = url.searchParams.get('initialRequirements');
  const additionalRequirement = url.searchParams.get('additionalRequirement') === 'true';
  const tenantId = url.searchParams.get('tenantId');

  if (initialRequirements) {
    logger.info('Initial requirements detected in URL', {
      projectId: args.params.id,
      requirementsLength: initialRequirements.length,
      isAdditionalRequirement: additionalRequirement,
      tenantId: tenantId || 'none'
    });
  }

  return json({
    id: args.params.id,
    initialRequirements: initialRequirements ? decodeURIComponent(initialRequirements) : null,
    additionalRequirement,
    tenantId
  });
}

export default IndexRoute;
