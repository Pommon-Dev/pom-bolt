import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { useToast } from '~/components/ui/use-toast';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const accessCode = url.searchParams.get('code');
  
  if (accessCode) {
    return json({ accessCode });
  }
  
  return json({});
}

export async function action({ request }: LoaderFunctionArgs) {
  const formData = await request.formData();
  const accessCode = formData.get('accessCode');
  
  if (!accessCode) {
    return json({ error: 'Access code is required' }, { status: 400 });
  }
  
  // Redirect with access code
  return json({ redirect: `/?code=${encodeURIComponent(accessCode.toString())}` });
}

export default function BetaAccess() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { toast } = useToast();
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8 space-y-6 bg-card rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold text-center">Beta Access</h1>
        <p className="text-center text-muted-foreground">
          Please enter your beta access code to continue.
        </p>
        
        <Form method="post" className="space-y-4">
          <Input
            type="text"
            name="accessCode"
            placeholder="Enter access code"
            required
            className="w-full"
          />
          
          <Button
            type="submit"
            className="w-full"
            disabled={navigation.state === 'submitting'}
          >
            {navigation.state === 'submitting' ? 'Verifying...' : 'Continue'}
          </Button>
        </Form>
        
        <div className="mt-4">
          {actionData && 'error' in actionData && (
            <p className="text-red-500 text-center">
              {actionData.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
} 