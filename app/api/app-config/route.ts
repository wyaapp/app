import { env } from 'cloudflare:workers';
import { isStandalone } from '@/lib/auth/server';
import { chatGPTSignInPath } from '@/app/chatgpt-auth';

/** Only public configuration; never serialize environment bindings. */
export function GET() {
  return Response.json(
    {
      siteKey: env.TURNSTILE_SITE_KEY || '',
      localSignIn: isStandalone() ? null : chatGPTSignInPath('/dashboard/files'),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
