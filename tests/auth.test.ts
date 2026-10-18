import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, createLocalJWKSet, type JSONWebKeySet } from 'jose';
import { createAccountAuth } from '../lib/auth/config.ts';
import { safeReturnPath } from '../lib/auth/return-path.ts';

const origin = 'http://localhost:8787';
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('drizzle/0001_auth.sql', 'utf8'));
  const emails: { email: string; code: string }[] = [];
  const auth = createAccountAuth(
    db,
    randomBytes(32).toString('hex'),
    origin,
    async (email, code) => {
      emails.push({ email, code });
    },
  );
  let ip = 1;
  async function request(path: string, body?: unknown, cookie?: string, method?: string) {
    return auth.handler(
      new Request(origin + path, {
        method: method || (body ? 'POST' : 'GET'),
        headers: {
          'Content-Type': path.endsWith('/token')
            ? 'application/x-www-form-urlencoded'
            : 'application/json',
          Origin: origin,
          'cf-connecting-ip': `192.0.2.${ip++}`,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body
          ? {
              body: path.endsWith('/token')
                ? new URLSearchParams(body as Record<string, string>).toString()
                : JSON.stringify(body),
            }
          : {}),
      }),
    );
  }
  async function login(email: string) {
    const sent = await request('/api/auth/email-otp/send-verification-otp', {
      email,
      type: 'sign-in',
    });
    assert.equal(sent.status, 200, await sent.text());
    const response = await request('/api/auth/sign-in/email-otp', {
      email,
      otp: emails.at(-1)!.code,
    });
    assert.equal(response.status, 200);
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    return { cookie, body: (await response.json()) as { user: { id: string } } };
  }
  return { db, auth, emails, request, login };
}

test('email OTP signs in verified users, hashes codes, rejects reuse/expiry/guessing and forged sessions', async () => {
  const f = fixture();
  const email = 'alice@example.test';
  await f.request('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  const otp = f.emails.at(-1)!.code;
  const stored = f.db.prepare('SELECT value FROM verification').all();
  assert.ok(stored.length);
  assert.ok(!JSON.stringify(stored).includes(otp));
  let response = await f.request('/api/auth/sign-in/email-otp', { email, otp });
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some((value) => value.includes('HttpOnly') && value.includes('SameSite=Lax')));
  const user = (await response.json()) as { user: { id: string; emailVerified: boolean } };
  assert.equal(user.user.emailVerified, true);
  assert.notEqual((await f.request('/api/auth/sign-in/email-otp', { email, otp })).status, 200);
  assert.equal(
    await (
      await f.request('/api/auth/get-session', undefined, 'better-auth.session_token=forged')
    ).json(),
    null,
  );
  await f.request('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  const expired = f.emails.at(-1)!.code;
  f.db.prepare("UPDATE verification SET expiresAt = '2000-01-01T00:00:00.000Z'").run();
  assert.notEqual(
    (await f.request('/api/auth/sign-in/email-otp', { email, otp: expired })).status,
    200,
  );
  await f.request('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  const limited = f.emails.at(-1)!.code;
  for (let i = 0; i < 3; i++)
    await f.request('/api/auth/sign-in/email-otp', { email, otp: 'not-a-code' });
  assert.notEqual(
    (await f.request('/api/auth/sign-in/email-otp', { email, otp: limited })).status,
    200,
  );
  response = await f.auth.handler(
    new Request(origin + '/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, type: 'sign-in' }),
    }),
  );
  assert.equal(response.status, 403);
});

test('OAuth discovery, PKCE, consent, audience-bound tokens, refresh and account isolation', async () => {
  const f = fixture();
  const metadata = (await (
    await f.request('/.well-known/oauth-authorization-server/api/auth')
  ).json()) as { code_challenge_methods_supported: string[]; registration_endpoint: string };
  assert.ok(metadata.code_challenge_methods_supported?.includes('S256'));
  assert.ok(metadata.registration_endpoint);
  const resource = (await (
    await f.request('/.well-known/oauth-protected-resource')
  ).json()) as Record<string, string>;
  assert.equal(resource.resource, origin + '/mcp');
  const registration = await f.request('/api/auth/oauth2/register', {
    client_name: 'Test ChatGPT',
    redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    scope: 'profile:read profile:write offline_access',
  });
  const client = (await registration.json()) as Record<string, string>;
  assert.equal(registration.status, 201, JSON.stringify(client));
  const { cookie, body } = await f.login('alice@example.test');
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    response_type: 'code',
    scope: 'profile:read profile:write offline_access',
    resource: origin + '/mcp',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'test-state',
  });
  const unauthorized = await f.request('/api/auth/oauth2/authorize?' + query);
  assert.ok(unauthorized.headers.get('location')?.includes('/sign-in'));
  const loginQuery = new URL(unauthorized.headers.get('location')!, origin).search.slice(1);
  await f.request('/api/auth/email-otp/send-verification-otp', {
    email: 'alice@example.test',
    type: 'sign-in',
  });
  const continued = await f.request('/api/auth/sign-in/email-otp', {
    email: 'alice@example.test',
    otp: f.emails.at(-1)!.code,
    oauth_query: loginQuery,
  });
  assert.equal(continued.status, 200);
  const continuation = (await continued.json()) as { redirect: boolean; url: string };
  assert.equal(continuation.redirect, true);
  assert.equal(new URL(continuation.url, origin).pathname, '/consent');
  const authorize = await f.request('/api/auth/oauth2/authorize?' + query, undefined, cookie);
  const location = authorize.headers.get('location');
  assert.ok(location?.includes('/consent'), await authorize.text());
  const oauthQuery = new URL(location!, origin).search.slice(1);
  const consent = await f.request(
    '/api/auth/oauth2/consent',
    { accept: true, oauth_query: oauthQuery },
    cookie,
  );
  const decision = (await consent.json()) as Record<string, string>;
  assert.equal(consent.status, 200, JSON.stringify(decision));
  const callback = new URL(decision.url);
  assert.equal(callback.searchParams.get('state'), 'test-state');
  assert.equal(callback.searchParams.get('iss'), origin + '/api/auth');
  const tokenBody = {
    grant_type: 'authorization_code',
    client_id: client.client_id,
    redirect_uri: query.get('redirect_uri'),
    code: callback.searchParams.get('code'),
    code_verifier: verifier,
    resource: origin + '/mcp',
  };
  assert.notEqual(
    (
      await f.request('/api/auth/oauth2/token', {
        ...tokenBody,
        code_verifier: 'wrong-verifier-with-at-least-forty-three-characters',
      })
    ).status,
    200,
  );
  const retryAuthorize = await f.request('/api/auth/oauth2/authorize?' + query, undefined, cookie);
  let retryUrl = retryAuthorize.headers.get('location')!;
  if (retryUrl.includes('/consent')) {
    const retryConsent = await f.request(
      '/api/auth/oauth2/consent',
      { accept: true, oauth_query: new URL(retryUrl, origin).search.slice(1) },
      cookie,
    );
    retryUrl = ((await retryConsent.json()) as { url: string }).url;
  }
  tokenBody.code = new URL(retryUrl, origin).searchParams.get('code');
  const tokenResponse = await f.request('/api/auth/oauth2/token', tokenBody);
  const tokens = (await tokenResponse.json()) as Record<string, string>;
  assert.equal(tokenResponse.status, 200, JSON.stringify(tokens));
  assert.ok(tokens.refresh_token);
  const jwks = (await (await f.request('/api/auth/jwks')).json()) as JSONWebKeySet;
  const verify = createLocalJWKSet(jwks);
  const { payload } = await jwtVerify(tokens.access_token, verify, {
    issuer: origin + '/api/auth',
    audience: origin + '/mcp',
  });
  assert.equal(payload.sub, body.user.id);
  await assert.rejects(
    jwtVerify(tokens.access_token, verify, {
      issuer: origin + '/api/auth',
      audience: 'https://other.example/mcp',
    }),
  );
  const refreshedResponse = await f.request('/api/auth/oauth2/token', {
    grant_type: 'refresh_token',
    client_id: client.client_id,
    refresh_token: tokens.refresh_token,
    resource: origin + '/mcp',
  });
  const refreshed = (await refreshedResponse.json()) as Record<string, string>;
  assert.equal(refreshedResponse.status, 200, JSON.stringify(refreshed));
  assert.ok(refreshed.refresh_token);
  const other = await f.login('bob@example.test');
  assert.notEqual(other.body.user.id, payload.sub);
  assert.notEqual(
    (
      await f.request(
        '/api/auth/admin/oauth2/create-client',
        {
          client_name: 'Bypass',
          redirect_uris: ['https://evil.example/callback'],
          skip_consent: true,
        },
        other.cookie,
      )
    ).status,
    200,
  );
  assert.notEqual(
    (
      await f.request(
        '/api/auth/admin/oauth2/resources',
        { identifier: 'https://evil.example', name: 'Other resource' },
        other.cookie,
      )
    ).status,
    200,
  );
  const consents = (await (
    await f.request('/api/auth/oauth2/get-consents', undefined, cookie)
  ).json()) as { id: string }[];
  assert.equal(consents.length, 1);
  assert.notEqual(
    (await f.request('/api/auth/oauth2/delete-consent', { id: consents[0].id }, other.cookie))
      .status,
    200,
  );
  assert.equal(
    (await f.request('/api/auth/oauth2/delete-consent', { id: consents[0].id }, cookie)).status,
    200,
  );
  assert.notEqual(
    (
      await f.request('/api/auth/oauth2/token', {
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: refreshed.refresh_token,
        resource: origin + '/mcp',
      })
    ).status,
    200,
    'disconnect revokes refresh tokens',
  );
  assert.notEqual(
    (await f.request('/api/auth/oauth2/token', tokenBody)).status,
    200,
    'authorization codes are single use',
  );
  const badQuery = new URLSearchParams(query);
  badQuery.set('redirect_uri', 'https://evil.example/callback');
  assert.notEqual(
    (await f.request('/api/auth/oauth2/authorize?' + badQuery, undefined, cookie)).headers
      .get('location')
      ?.split('?')[0],
    'https://evil.example/callback',
  );
});

test('return paths cannot leave the site or enter auth API routes', () => {
  for (const path of [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/api/auth/sign-out',
    '/sign-in',
  ])
    assert.equal(safeReturnPath(path), '/dashboard');
  assert.equal(safeReturnPath('/connections'), '/connections');
});
