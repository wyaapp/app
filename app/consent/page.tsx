import Link from 'next/link';
import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth/server';
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { Brand } from '../components/brand';
import ConsentButtons from './consent-buttons';
export const dynamic = 'force-dynamic';
const descriptions: Record<string, string> = {
  'profile:read': 'Read all your spaces, profiles, links, and revision history',
  'profile:write':
    'Create spaces, change usernames, edit profiles and links, and restore revisions',
  offline_access: 'Stay connected until you disconnect this app',
};
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) for (const item of value) query.append(key, item);
    else if (value !== undefined) query.set(key, value);
  }
  const auth = getAuth();
  const requestHeaders = await headers();
  const valid = await verifyOAuthQueryParams(query.toString(), (await auth.$context).secret);
  const session = valid ? await auth.api.getSession({ headers: requestHeaders }) : null;
  let client = null;
  if (session && query.get('client_id')) {
    try {
      client = await auth.api.getOAuthClientPublic({
        headers: requestHeaders,
        query: { client_id: query.get('client_id')! },
      });
    } catch {
      /* Invalid client gets no consent controls. */
    }
  }
  const scopes = (query.get('scope') || '').split(' ').filter(Boolean);
  let returnHost = '';
  try {
    returnHost = new URL(query.get('redirect_uri') || '').host;
  } catch {
    /* Invalid requests have no consent controls. */
  }
  const ready =
    valid &&
    returnHost &&
    session?.user.emailVerified &&
    client &&
    scopes.length &&
    scopes.every((scope) => scope in descriptions);
  return (
    <main className="auth-shell">
      <Brand />
      <section className="auth-card">
        {ready ? (
          <>
            <div className="eyebrow">YOU&apos;RE IN CONTROL</div>
            <h1>Connect your spaces.</h1>
            <p>
              <strong>{client!.client_name || 'This app'}</strong> is asking to access your wya.im
              account.
            </p>
            <p>
              Signed in as <strong>{session.user.email}</strong>.
            </p>
            <ul>
              {scopes.map((scope) => (
                <li key={scope}>{descriptions[scope]}</li>
              ))}
            </ul>
            <p>
              Returns to <strong>{returnHost}</strong>.
            </p>
            <p>You can disconnect it anytime from your dashboard.</p>
            <ConsentButtons />
          </>
        ) : (
          <>
            <h1>This request expired.</h1>
            <p>Return to the app and start connecting wya.im again.</p>
            <Link href="/dashboard" className="button button-dark">
              Your space
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
