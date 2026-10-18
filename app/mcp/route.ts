import { handleMcpRequest } from '@/lib/mcp-handler';
import { getAuth, isStandalone, authOrigin } from '@/lib/auth/server';
import { requireMcpAuth } from '@better-auth/mcp';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  if (!isStandalone()) return handleMcpRequest(request);
  const auth = getAuth();
  return requireMcpAuth(
    auth,
    async (verifiedRequest, claims) => {
      if (typeof claims.sub !== 'string' || typeof claims.client_id !== 'string')
        return new Response('Invalid account token', { status: 401 });
      const { adapter } = await auth.$context;
      const consent = await adapter.findOne<{ scopes: string[] }>({
        model: 'oauthConsent',
        where: [
          { field: 'userId', value: claims.sub },
          { field: 'clientId', value: claims.client_id },
        ],
      });
      const client = await adapter.findOne<{ disabled: boolean }>({
        model: 'oauthClient',
        where: [{ field: 'clientId', value: claims.client_id }],
      });
      if (!consent || !client || client.disabled)
        return new Response('Connection revoked. Connect your account again.', {
          status: 401,
          headers: {
            'WWW-Authenticate': `Bearer resource_metadata="${authOrigin()}/.well-known/oauth-protected-resource"`,
          },
        });
      return handleMcpRequest(verifiedRequest, {
        userId: claims.sub,
        scopes: new Set(
          typeof claims.scope === 'string'
            ? claims.scope.split(' ').filter((scope) => consent.scopes.includes(scope))
            : [],
        ),
      });
    },
    {
      resource: `${authOrigin()}/mcp`,
      requiredScopes: ['profile:read'],
      challengeScopes: ['profile:read', 'profile:write', 'offline_access'],
    },
  )(request);
}
