import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const accessCode = url.searchParams.get('code');

  if (accessCode) {
    return json({ accessCode });
  }

  return json({});
}

// Define response types for better type safety
type ActionErrorResponse = { error: string; redirect?: never };
type ActionRedirectResponse = { redirect: string; error?: never };

export async function action({ request }: LoaderFunctionArgs) {
  const formData = await request.formData();
  const accessCode = formData.get('accessCode');

  if (!accessCode) {
    return json<ActionErrorResponse>({ error: 'Access code is required' }, { status: 400 });
  }

  // Redirect with access code
  return json<ActionRedirectResponse>({ redirect: `/?code=${encodeURIComponent(accessCode.toString())}` });
}

export default function BetaAccess() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8 space-y-6 bg-card rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold text-center">Beta Access</h1>
        <p className="text-center text-muted-foreground">Please enter your beta access code to continue.</p>

        <Form method="post" className="space-y-4">
          <Input type="text" name="accessCode" placeholder="Enter access code" required className="w-full" />

          <Button type="submit" className="w-full" disabled={navigation.state === 'submitting'}>
            {navigation.state === 'submitting' ? 'Verifying...' : 'Continue'}
          </Button>
        </Form>

        {actionData && 'error' in actionData && (
          <p className="text-sm text-destructive text-center">{actionData.error}</p>
        )}
      </div>
    </div>
  );
}
