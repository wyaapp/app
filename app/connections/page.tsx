import { SiteFooter } from '../components/site-footer';
import Link from 'next/link';
import { headers } from 'next/headers';
import { requireChatGPTUser } from '../chatgpt-auth';
import { getAuth, isStandalone } from '@/lib/auth/server';
import { Brand } from '../components/brand';
import Connections from './connections';
export const dynamic = 'force-dynamic';
export default async function ConnectionsPage() {
  await requireChatGPTUser('/connections');
  const auth = isStandalone() ? getAuth() : null;
  const requestHeaders = await headers();
  const consents = auth ? await auth.api.getOAuthConsents({ headers: requestHeaders }) : [];
  const connections = await Promise.all(
    consents.map(async (consent) => {
      let name = 'Connected app';
      try {
        name =
          (
            await auth!.api.getOAuthClientPublic({
              headers: requestHeaders,
              query: { client_id: consent.clientId },
            })
          ).client_name || name;
      } catch {}
      return { id: consent.id, name };
    }),
  );
  return (
    <div className="page-with-footer">
      <main className="auth-shell">
        <Brand />
        <section className="auth-card">
          <h1>Your connections.</h1>
          <p>
            Connect wya.im in ChatGPT using <strong>https://wya.im/mcp</strong> and choose OAuth.
            Sign in with your email code and review the requested access.
          </p>
          <Connections initial={connections} />
          <Link className="text-link" href="/dashboard">
            Back to your space
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
