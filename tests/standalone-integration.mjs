// Local-only: creates test identities directly through the real auth library,
// with an in-memory email sink, then exercises the built Worker over HTTP.
import assert from 'node:assert/strict';
import { checkCustomDomains } from './custom-domains-integration.mjs';
import { checkProfileAvatars } from './profile-avatar-integration.mjs';
import { getPlatformProxy } from 'wrangler';
import { readFileSync } from 'node:fs';
import { get as httpGet, request as httpRequest } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createAccountAuth } from '../lib/auth/config.ts';
import { serializePageItem } from '../lib/page-documents.ts';
import { parseFileDocument } from '../lib/file-documents.ts';
const origin = 'http://127.0.0.1:8787';
const variables = parseEnv(readFileSync('.dev.vars', 'utf8'));
const proxy = await getPlatformProxy({
  configPath: '.cloudflare/wrangler.json',
  persist: { path: '.cloudflare/.wrangler/state/v3' },
  envFiles: ['.dev.vars'],
});
try {
  const pending = new Map();
  const auth = createAccountAuth(
    proxy.env.DB,
    variables.BETTER_AUTH_SECRET,
    origin,
    async (email, code) => {
      pending.set(email, code);
    },
  );
  const suffix = Date.now().toString(36);
  async function login(email) {
    const send = await auth.handler(
      new Request(origin + '/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'cf-connecting-ip': `192.0.2.${(Date.now() % 250) + 1}`,
        },
        body: JSON.stringify({ email, type: 'sign-in' }),
      }),
    );
    assert.equal(send.status, 200, await send.text());
    // The Worker consumes the real code from local D1 and creates its own session.
    const result = await fetch(origin + '/api/auth/sign-in/email-otp', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: pending.get(email) }),
    });
    assert.equal(result.status, 200, await result.clone().text());
    return result.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
  }
  const request = (path, options = {}) => fetch(origin + path, { redirect: 'manual', ...options });
  const alice = await login(`alice-${suffix}@example.test`);
  const bob = await login(`bob-${suffix}@example.test`);
  const onboarding = (cookie, body, originHeader = origin) =>
    request('/api/account/onboarding', {
      method: 'POST',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: originHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  assert.equal((await onboarding(null, { action: 'skip' })).status, 401);
  assert.equal((await onboarding(alice, { action: 'skip' }, 'https://example.test')).status, 403);
  assert.equal(
    (await onboarding(alice, { action: 'complete', userId: 'someone-else' })).status,
    400,
  );
  assert.equal(
    (await onboarding(alice, { action: 'complete', discovery: 'unrecognized' })).status,
    400,
  );
  assert.equal(
    (await onboarding(alice, { action: 'complete', occupation: 'x'.repeat(1024) })).status,
    413,
  );
  const survey = await onboarding(alice, {
    action: 'complete',
    occupation: 'developer',
    purpose: 'projects',
    discovery: 'chatgpt',
  });
  assert.equal(survey.status, 200);
  assert.equal(survey.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual((await survey.json()).onboarding, {
    status: 'completed',
    occupation: 'developer',
    purpose: 'projects',
    discovery: 'chatgpt',
  });
  const skippedSurvey = await onboarding(bob, { action: 'skip' });
  assert.deepEqual((await skippedSurvey.json()).onboarding, {
    status: 'skipped',
    occupation: null,
    purpose: null,
    discovery: null,
  });
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/sign-in')).status, 200);
  const signInHeaders = (await request('/sign-in')).headers;
  assert.equal(signInHeaders.get('x-frame-options'), 'DENY');
  assert.ok(signInHeaders.get('content-security-policy').includes("frame-ancestors 'none'"));

  for (const path of ['/dashboard', '/dashboard/files', '/experimental-dashboard'])
    assert.equal((await request(path)).status, 404);

  assert.equal(
    (
      await request('/api/account', {
        headers: {
          'oai-authenticated-user-id': 'victim',
          'oai-authenticated-user-email': 'victim@example.test',
        },
      })
    ).status,
    401,
  );
  const write = (cookie, body) =>
    request('/api/account', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const fileWrite = (cookie, spaceId, body, requestOrigin = origin) =>
    request(`/api/files?spaceId=${encodeURIComponent(spaceId)}`, {
      method: 'POST',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: requestOrigin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  async function publishedFile(cookie, space, content = '', name = 'Socials.md') {
    const created = await fileWrite(cookie, space.id, { action: 'create', name, content });
    assert.equal(created.status, 200, await created.clone().text());
    const draft = (await created.json()).file;
    const published = await fileWrite(cookie, space.id, {
      action: 'publish',
      id: draft.id,
      version: draft.version,
    });
    assert.equal(published.status, 200, await published.clone().text());
    const file = (await published.json()).file;
    const account = await request(`/api/account?spaceId=${encodeURIComponent(space.id)}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(account.status, 200, await account.clone().text());
    return { file, profile: (await account.json()).profile };
  }
  // Retired clients receive an email pointer, without authentication or body processing.
  for (const options of [
    {},
    {
      headers: { Cookie: alice, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'This message must never be delivered.' }),
    },
    {
      headers: { Origin: 'https://example.test', 'Content-Type': 'text/plain' },
      body: '{',
    },
  ]) {
    const retired = await request('/api/contact', { method: 'POST', ...options });
    assert.equal(retired.status, 410);
    assert.equal(retired.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await retired.json(), {
      error: 'Support is now available by email. Please email support@wya.im.',
    });
  }
  // Only rejected Feedback requests run here; delivery is tested with a mock fetcher.
  // This remains safe even if somebody starts the Worker with a real webhook.
  {
    const endpoint = '/api/feedback';
    const reportBody = { topic: 'account', message: 'Please help with my account.' };
    const reportPost = (body, headers = {}) =>
      request(endpoint, {
        method: 'POST',
        headers: {
          Cookie: alice,
          Origin: origin,
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await reportPost(reportBody, {
          Cookie: '',
          'oai-authenticated-user-id': 'victim',
          'oai-authenticated-user-email': 'victim@example.test',
        })
      ).status,
      401,
    );
    assert.equal((await reportPost(reportBody, { Origin: 'https://example.test' })).status, 403);
    assert.equal((await reportPost(reportBody, { Origin: '' })).status, 403);
    assert.equal((await reportPost(reportBody, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await reportPost(reportBody, { 'Content-Type': 'text/plain' })).status, 415);
    for (const extra of [
      { email: 'victim@example.test' },
      { userId: 'victim' },
      { metadata: { accountId: 'victim' } },
      { plan: 'premium' },
      { locale: 'not-a-locale' },
    ]) {
      const invalid = await reportPost({ ...reportBody, ...extra });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.headers.get('cache-control'), 'private, no-store');
    }
    assert.equal(
      (
        await request(endpoint, {
          method: 'POST',
          headers: { Cookie: alice, Origin: origin, 'Content-Type': 'application/json' },
          body: '{',
        })
      ).status,
      400,
    );
  }
  // The billing boundary cannot be reached with forged identity or cross-site writes.
  assert.equal((await request('/api/billing')).status, 401);
  const billingPost = (body, extraHeaders = {}) =>
    request('/api/billing', {
      method: 'POST',
      headers: {
        Cookie: alice,
        Origin: origin,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await billingPost({ action: 'portal' }, { Origin: 'https://example.test' })).status,
    403,
  );
  assert.equal((await billingPost({ action: 'portal', customer: 'cus_someoneelse' })).status, 400);
  assert.equal(
    (
      await billingPost({
        action: 'checkout',
        currency: 'usd',
        interval: 'month',
        price: 'price_cheaper',
      })
    ).status,
    400,
  );
  assert.equal(
    (await billingPost({ action: 'checkout', currency: 'eur', interval: 'month' })).status,
    400,
  );
  const freeBilling = await request('/api/billing', { headers: { Cookie: alice } });
  assert.equal(freeBilling.status, 200);
  assert.equal(freeBilling.headers.get('cache-control'), 'private, no-store');
  const billingBody = await freeBilling.json();
  assert.equal(billingBody.available, false);
  assert.equal(billingBody.plan.hostingMode, 'self-hosted');
  assert.equal(billingBody.plan.spaceLimit, null);
  assert.equal(billingBody.plan.customDomains, true);
  assert.equal((await request('/api/billing/webhook', { method: 'POST', body: '{}' })).status, 400);
  const response = await write(alice, {
    action: 'create_profile',
    handle: `qa-${suffix}`,
    name: 'Local QA',
  });
  assert.equal(response.status, 200, await response.clone().text());
  const initialSpace = (await response.json()).profile;
  assert.deepEqual(initialSpace.files, []);
  assert.equal(
    (await fileWrite(null, initialSpace.id, { action: 'create', name: 'Test.md', content: '' }))
      .status,
    401,
  );
  assert.equal(
    (await fileWrite(bob, initialSpace.id, { action: 'create', name: 'Test.md', content: '' }))
      .status,
    404,
  );
  assert.equal(
    (
      await fileWrite(
        alice,
        initialSpace.id,
        { action: 'create', name: 'Test.md', content: '' },
        'https://evil.example',
      )
    ).status,
    403,
  );
  await publishedFile(
    alice,
    initialSpace,
    serializePageItem({
      id: 'qa-github',
      slug: 'github',
      label: 'Code',
      platform: 'github',
      url: 'https://github.com/alexcastro',
      visible: true,
    }),
  );
  assert.equal(
    (await request(`/qa-${suffix}/github`)).headers.get('location'),
    'https://github.com/alexcastro',
  );
  await checkCustomDomains({ db: proxy.env.DB, origin, request, alice, bob });
  const other = await (await request('/api/account', { headers: { Cookie: bob } })).json();
  assert.equal(other.profile, null);
  assert.equal((await request('/dashboard', { headers: { Cookie: alice } })).status, 404);
  const bootstrap = await request('/api/dashboard', { headers: { Cookie: alice } });
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.headers.get('cache-control'), 'private, no-store');
  const metadata = await request('/.well-known/oauth-protected-resource');
  assert.equal(metadata.status, 200);
  assert.equal((await metadata.json()).resource, origin + '/mcp');
  const discovery = await request('/.well-known/oauth-authorization-server/api/auth');
  assert.equal(discovery.status, 200);
  const denied = await request('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(denied.status, 401, 'MCP requires an OAuth token, never a browser cookie');
  assert.ok(denied.headers.get('www-authenticate'));
  const jsonHeaders = { 'Content-Type': 'application/json', Origin: origin };
  const register = await request('/api/auth/oauth2/register', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      client_name: 'Local ChatGPT test',
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      scope: 'profile:read profile:write offline_access',
    }),
  });
  const client = await register.json();
  assert.equal(register.status, 201, JSON.stringify(client));
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    response_type: 'code',
    scope: 'profile:read profile:write offline_access',
    resource: origin + '/mcp',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'local-test',
  });
  const authorize = await new Promise((resolve, reject) => {
    httpGet(
      origin + '/api/auth/oauth2/authorize?' + query,
      { headers: { Cookie: alice, Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' } },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve(
            new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers }),
          ),
        );
      },
    ).on('error', reject);
  });
  assert.equal(authorize.status, 302, await authorize.clone().text());
  const consentUrl = new URL(authorize.headers.get('location'), origin);
  console.log('OAuth consent path:', consentUrl.pathname);
  const consentHtml = await (
    await request(consentUrl.pathname + consentUrl.search, { headers: { Cookie: alice } })
  ).text();
  assert.ok(
    consentHtml.includes('Local ChatGPT test'),
    consentHtml.match(/<main[\s\S]*?<\/main>/)?.[0] || consentHtml.slice(0, 300),
  );
  assert.ok(consentHtml.includes('Allow access'));
  const consent = await request('/api/auth/oauth2/consent', {
    method: 'POST',
    headers: { ...jsonHeaders, Cookie: alice },
    body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
  });
  const decision = await consent.json();
  assert.equal(consent.status, 200, JSON.stringify(decision));
  const token = await request('/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      redirect_uri: query.get('redirect_uri'),
      code: new URL(decision.url).searchParams.get('code'),
      code_verifier: verifier,
      resource: origin + '/mcp',
    }),
  });
  const tokens = await token.json();
  assert.equal(token.status, 200, JSON.stringify(tokens));
  const rpc = (name, args = {}) =>
    request('/mcp', {
      method: 'POST',
      headers: { ...jsonHeaders, Authorization: 'Bearer ' + tokens.access_token },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
  const toolsResponse = await request('/mcp', {
    method: 'POST',
    headers: { ...jsonHeaders, Authorization: 'Bearer ' + tokens.access_token },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(toolsResponse.status, 200);
  const advertised = (await toolsResponse.json()).result.tools;
  for (const name of [
    'list_files',
    'read_file',
    'create_file',
    'save_file',
    'publish_file',
    'unpublish_file',
    'file_properties',
    'move_file',
    'delete_file',
  ]) {
    assert.ok(
      advertised.some((tool) => tool.name === name),
      `${name} is advertised`,
    );
  }
  assert.ok(
    !advertised.some((tool) => ['set_tabs', 'publish_document', 'import_tab'].includes(tool.name)),
  );
  assert.ok(advertised.find((tool) => tool.name === 'upsert_link').inputSchema.properties.fileId);
  const listedFiles = await (await rpc('list_files')).json();
  assert.equal(listedFiles.result.isError, undefined, JSON.stringify(listedFiles));
  const firstFile = JSON.parse(listedFiles.result.content[0].text).files[0];
  const readFile = await (await rpc('read_file', { id: firstFile.id })).json();
  assert.equal(readFile.result.isError, undefined, JSON.stringify(readFile));
  assert.ok(JSON.parse(readFile.result.content[0].text).file.content.includes('qa-github'));
  const read = await rpc('get_profile');
  const readBody = await read.json();
  assert.equal(read.status, 200, JSON.stringify(readBody));
  assert.equal(JSON.parse(readBody.result.content[0].text).profile.handle, `qa-${suffix}`);
  const canonicalProfile = JSON.parse(readBody.result.content[0].text).profile;
  assert.ok(canonicalProfile.files.some((file) => file.id === firstFile.id));
  for (const field of ['tabs', 'documents', 'sections', 'defaultTabId'])
    assert.ok(!(field in canonicalProfile));
  const edit = await rpc('update_profile', { expectedVersion: 2, bio: 'Edited through local MCP' });
  const editBody = await edit.json();
  assert.equal(edit.status, 200, JSON.stringify(editBody));
  assert.equal(JSON.parse(editBody.result.content[0].text).profile.bio, 'Edited through local MCP');
  // Multiple spaces, reclaimable usernames, and alias routes in the real Worker.
  const original = JSON.parse(editBody.result.content[0].text).profile;
  const secondResponse = await write(alice, {
    action: 'create_profile',
    handle: `work-${suffix}`,
    name: 'Work',
  });
  assert.equal(secondResponse.status, 200, await secondResponse.clone().text());
  const second = (await secondResponse.json()).profile;
  const spaces = JSON.parse(
    (await (await rpc('list_spaces')).json()).result.content[0].text,
  ).spaces;
  assert.equal(spaces.length, 2);
  assert.ok(spaces.some((space) => space.id === original.id));
  assert.equal(
    (await (await rpc('get_profile')).json()).result.isError,
    true,
    'Ambiguous reads require a space',
  );
  assert.equal(
    (await (await rpc('update_profile', { expectedVersion: 3, bio: 'Ambiguous' })).json()).result
      .isError,
    true,
  );
  assert.equal(
    (
      await request(`/api/account?spaceId=${encodeURIComponent(original.id)}`, {
        headers: { Cookie: bob },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await write(bob, {
        action: 'rename_space',
        spaceId: original.id,
        expectedVersion: 3,
        handle: `stolen-${suffix}`,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await write(alice, {
        action: 'restore_revision',
        spaceId: second.id,
        expectedVersion: 1,
        revision: 1,
      })
    ).status,
    404,
  );
  const renamedResponse = await rpc('rename_space', {
    spaceId: original.id,
    expectedVersion: 3,
    handle: `renamed-${suffix}`,
  });
  const renamedBody = await renamedResponse.json();
  assert.equal(renamedBody.result.isError, undefined, JSON.stringify(renamedBody));
  const renamed = JSON.parse(renamedBody.result.content[0].text).profile;
  assert.equal(renamed.id, original.id);
  assert.ok(renamed.aliases.includes(original.handle));
  const oldProfile = await request(`/${original.handle}`);
  assert.equal(oldProfile.status, 307);
  assert.equal(oldProfile.headers.get('location'), `/${renamed.handle}`);
  const oldLink = await request(`/${original.handle}/github`);
  assert.equal(oldLink.status, 302);
  assert.equal(oldLink.headers.get('location'), `/${renamed.handle}/github`);
  assert.equal(
    (await request(`/${renamed.handle}/github`)).headers.get('location'),
    'https://github.com/alexcastro',
  );
  assert.equal(
    (
      await (
        await request(
          `/api/handles?handle=${original.handle}&spaceId=${encodeURIComponent(second.id)}`,
          { headers: { Cookie: alice } },
        )
      ).json()
    ).available,
    true,
  );
  assert.equal(
    (
      await (
        await request(
          `/api/handles?handle=${original.handle}&spaceId=${encodeURIComponent(original.id)}`,
          { headers: { Cookie: alice } },
        )
      ).json()
    ).available,
    true,
  );
  // Self-hosting has no paid plan cap, including beyond the former five-space limit.
  for (let index = 3; index <= 6; index++)
    assert.equal(
      (
        await write(alice, {
          action: 'create_profile',
          handle: `space${index}-${suffix}`,
          name: `Space ${index}`,
        })
      ).status,
      200,
    );
  const uncapped = JSON.parse((await (await rpc('list_spaces')).json()).result.content[0].text);
  assert.equal(uncapped.limit, null);
  assert.equal(uncapped.spaces.length, 6);
  const explicit = await (await rpc('get_profile', { spaceId: second.id })).json();
  assert.equal(JSON.parse(explicit.result.content[0].text).profile.name, 'Work');
  const renamedBack = await (
    await rpc('rename_space', { spaceId: original.id, expectedVersion: 4, handle: original.handle })
  ).json();
  assert.equal(renamedBack.result.isError, undefined, JSON.stringify(renamedBack));
  assert.equal(
    (await request(`/${renamed.handle}`)).headers.get('location'),
    `/${original.handle}`,
  );
  // Claim the fallback as a different account: the page and slug namespace transfer.
  const claimedResponse = await write(bob, {
    action: 'create_profile',
    handle: renamed.handle,
    name: 'New owner',
  });
  assert.equal(claimedResponse.status, 200, await claimedResponse.clone().text());
  const claimed = (await claimedResponse.json()).profile;
  const claimedPage = await request(`/${renamed.handle}`);
  assert.equal(claimedPage.status, 200);
  assert.ok((await claimedPage.text()).includes('New owner'));
  assert.equal(
    (await request(`/${renamed.handle}/github`)).status,
    404,
    'Old links never fall through to the original owner',
  );
  await publishedFile(
    bob,
    claimed,
    serializePageItem({
      slug: 'github',
      label: 'New code',
      platform: 'github',
      url: 'https://github.com/new-owner',
      visible: true,
    }),
  );
  assert.equal(
    (await request(`/${renamed.handle}/github`)).headers.get('location'),
    'https://github.com/new-owner',
  );
  const afterClaim = JSON.parse(
    (await (await rpc('get_profile', { spaceId: original.id })).json()).result.content[0].text,
  ).profile;
  assert.deepEqual(afterClaim.aliases, []);
  assert.equal(
    (
      await (
        await rpc('rename_space', {
          spaceId: original.id,
          expectedVersion: 5,
          handle: renamed.handle,
        })
      ).json()
    ).result.isError,
    true,
  );
  for (const [version, handle] of [
    [5, `last-${suffix}`],
    [6, `latest-${suffix}`],
  ]) {
    const result = await (
      await rpc('rename_space', { spaceId: original.id, expectedVersion: version, handle })
    ).json();
    assert.equal(result.result.isError, undefined, JSON.stringify(result));
  }
  assert.equal(
    (await request(`/${original.handle}`)).status,
    404,
    'A second rename drops the earlier alias',
  );
  assert.equal((await request(`/${original.handle}/github`)).status, 404);
  assert.equal((await request(`/last-${suffix}`)).headers.get('location'), `/latest-${suffix}`);
  assert.equal(
    (await request(`/last-${suffix}/github`)).headers.get('location'),
    `/latest-${suffix}/github`,
  );
  assert.equal(
    (await request(`/${renamed.handle}/github`)).headers.get('location'),
    'https://github.com/new-owner',
  );
  console.log(
    'Spaces checks passed: MCP selection/rename, self-hosted uncapped creation, ownership, independent history, immediate claims, single fallback, and profile/link redirects.',
  );
  // Pictures use actual local R2 and the browser-session API; MCP can copy/remove.
  const pictureBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
    'base64',
  );
  const picturePath = `/api/pictures?spaceId=${encodeURIComponent(second.id)}&expectedVersion=1`;
  const pictureWrite = (cookie, extra = {}) =>
    request(picturePath, {
      method: 'PUT',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'image/png', ...extra },
      body: pictureBytes,
    });
  assert.equal((await pictureWrite('')).status, 401);
  assert.equal((await pictureWrite(bob)).status, 404);
  assert.equal((await pictureWrite(alice, { Origin: 'https://evil.example' })).status, 403);
  const uploaded = await pictureWrite(alice);
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  const pictured = (await uploaded.json()).profile;
  assert.ok(pictured.pictureUrl);
  const imageResponse = await request(pictured.pictureUrl);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), pictureBytes);
  assert.equal(
    (
      await request(pictured.pictureUrl, {
        headers: { 'If-None-Match': imageResponse.headers.get('etag') },
      })
    ).status,
    304,
  );
  assert.ok((await (await request(`/${second.handle}`)).text()).includes(pictured.pictureUrl));
  assert.equal((await pictureWrite(alice)).status, 409);
  const copyTarget = JSON.parse(
    (await (await rpc('get_profile', { spaceId: original.id })).json()).result.content[0].text,
  ).profile;
  const copiedBody = await (
    await rpc('copy_profile_picture', {
      spaceId: original.id,
      sourceSpaceId: second.id,
      expectedVersion: copyTarget.version,
    })
  ).json();
  assert.equal(copiedBody.result.isError, undefined, JSON.stringify(copiedBody));
  const copiedPicture = JSON.parse(copiedBody.result.content[0].text).profile;
  assert.notEqual(copiedPicture.pictureUrl, pictured.pictureUrl);
  const removedBody = await (
    await rpc('remove_profile_picture', {
      spaceId: original.id,
      expectedVersion: copiedPicture.version,
    })
  ).json();
  assert.equal(removedBody.result.isError, undefined, JSON.stringify(removedBody));
  assert.equal((await request(copiedPicture.pictureUrl)).status, 404);
  assert.equal((await request(pictured.pictureUrl)).status, 200);
  await checkProfileAvatars({
    origin,
    request,
    write,
    alice,
    suffix,
    pictured,
    pictureBytes,
    currentHandle: `latest-${suffix}`,
    alias: `last-${suffix}`,
  });
  const removed = await request(
    `/api/pictures?spaceId=${encodeURIComponent(second.id)}&expectedVersion=${pictured.version}`,
    { method: 'DELETE', headers: { Cookie: alice, Origin: origin } },
  );
  assert.equal(removed.status, 200);
  assert.equal((await request(pictured.pictureUrl)).status, 404);
  console.log(
    'Picture checks passed: session/CSRF/ownership checks, R2 upload/serve, public rendering, ETags, conflicts, MCP copy/remove, independent objects, and deletion.',
  );
  // Public widget reads must check item/file visibility before looking in the
  // shared Discord cache. These checks never depend on Discord availability.
  const widgetPreview = '/api/discord-widget?guildId=123456789012345678';
  assert.equal((await request(widgetPreview)).status, 401);
  assert.equal(
    (
      await request(widgetPreview, {
        headers: { Cookie: alice, 'Sec-Fetch-Site': 'cross-site' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request('/api/discord-widget?guildId=invalid', { headers: { Cookie: alice } })).status,
    400,
  );
  const widgetDocument = await publishedFile(alice, second, '', 'Community.md');
  let discordProfile = widgetDocument.profile;
  const widgetInput = {
    action: 'upsert_discord',
    spaceId: second.id,
    expectedVersion: discordProfile.version,
    slug: 'community',
    label: 'Test community',
    guildId: '123456789012345678',
    tabId: widgetDocument.file.id,
  };
  assert.equal((await write(bob, widgetInput)).status, 404);
  const addedWidget = await write(alice, widgetInput);
  assert.equal(addedWidget.status, 200, await addedWidget.clone().text());
  discordProfile = (await addedWidget.json()).profile;
  const publicWidget = `/api/discord-widget?handle=${second.handle}&slug=community`;
  const hiddenWidget = await request(publicWidget);
  assert.equal(hiddenWidget.status, 404);
  assert.equal(hiddenWidget.headers.get('cache-control'), 'private, no-store');
  const madeVisible = await write(alice, {
    ...widgetInput,
    expectedVersion: discordProfile.version,
    visible: true,
  });
  assert.equal(madeVisible.status, 200, await madeVisible.clone().text());
  discordProfile = (await madeVisible.json()).profile;
  const visibleWidgetFile = discordProfile.files.find((file) => file.id === widgetDocument.file.id);
  const hideWidgetFile = await fileWrite(alice, second.id, {
    action: 'unpublish',
    id: visibleWidgetFile.id,
    version: visibleWidgetFile.version,
  });
  assert.equal(hideWidgetFile.status, 200, await hideWidgetFile.clone().text());
  assert.equal((await request(publicWidget)).status, 404);
  assert.equal((await request(`${publicWidget}&fileId=${visibleWidgetFile.id}`)).status, 404);
  assert.equal((await request(`/${second.handle}/community`)).status, 404);
  assert.ok(!(await (await request(`/${second.handle}`)).text()).includes('Test community'));
  console.log(
    'Discord checks passed: preview authentication, origin, ID validation, ownership, private responses, and unpublished file isolation.',
  );
  const clipboardUser = await login(`clipboard-${suffix}@example.test`);
  const clipboardSpaceResponse = await write(clipboardUser, {
    action: 'create_profile',
    handle: `clip-${suffix}`,
    name: 'Clipboard QA',
  });
  assert.equal(clipboardSpaceResponse.status, 200, await clipboardSpaceResponse.clone().text());
  let clipboardSpace = (await clipboardSpaceResponse.json()).profile;
  const clipboardDocument = await publishedFile(clipboardUser, clipboardSpace, '', 'Clipboard.md');
  clipboardSpace = clipboardDocument.profile;
  const paste = (cookie, body, requestOrigin = origin) =>
    request('/api/account/import', {
      method: 'POST',
      headers: { ...jsonHeaders, Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
  const pasteBody = () => ({
    action: 'paste_content',
    spaceId: clipboardSpace.id,
    expectedVersion: clipboardSpace.version,
    tabId: clipboardDocument.file.id,
    content: {
      format: 'wya.im/clipboard',
      version: 1,
      kind: 'section',
      title: 'Copied section',
      items: [
        {
          slug: 'demo',
          label: 'Demo',
          aliases: ['try'],
          platform: 'website',
          url: 'https://example.com/',
          visible: true,
        },
      ],
    },
  });
  assert.equal((await paste(null, pasteBody())).status, 401);
  assert.equal((await paste(clipboardUser, pasteBody(), 'https://evil.example')).status, 403);
  assert.equal((await paste(bob, pasteBody())).status, 404);
  const firstPasteBody = pasteBody();
  const firstPaste = await paste(clipboardUser, firstPasteBody);
  assert.equal(firstPaste.status, 200, await firstPaste.clone().text());
  assert.equal(firstPaste.headers.get('cache-control'), 'private, no-store');
  clipboardSpace = (await firstPaste.json()).profile;
  const pastedFile = clipboardSpace.files.find((file) => file.id === clipboardDocument.file.id);
  assert.equal(
    parseFileDocument(pastedFile.content).data.tabs[0].sections[0].title,
    'Copied section',
  );
  assert.equal(clipboardSpace.tabs, undefined);
  const firstCopy = clipboardSpace.links[0];
  assert.equal((await paste(clipboardUser, firstPasteBody)).status, 409);
  const anotherPaste = await paste(clipboardUser, pasteBody());
  assert.equal(anotherPaste.status, 200, await anotherPaste.clone().text());
  clipboardSpace = (await anotherPaste.json()).profile;
  assert.equal(clipboardSpace.links[1].slug, 'demo-2');
  assert.deepEqual(clipboardSpace.links[1].aliases, ['try-2']);
  assert.notEqual(clipboardSpace.links[1].id, firstCopy.id);
  const beforeRejected = clipboardSpace.version;
  const unsafe = pasteBody();
  unsafe.content.items[0].url = 'javascript:alert(1)';
  assert.equal((await paste(clipboardUser, unsafe)).status, 400);
  const looping = pasteBody();
  looping.content.items[0] = {
    slug: 'loop',
    label: 'Loop',
    platform: 'website',
    url: `https://wya.im/${clipboardSpace.handle}/loop`,
    visible: true,
  };
  assert.equal((await paste(clipboardUser, looping)).status, 400);
  const afterRejected = await request(
    `/api/account?spaceId=${encodeURIComponent(clipboardSpace.id)}`,
    { headers: { Cookie: clipboardUser } },
  );
  const unchanged = (await afterRejected.json()).profile;
  assert.equal(unchanged.version, beforeRejected);
  assert.equal(unchanged.links.length, 2);
  console.log(
    'Clipboard checks passed: authentication, origin, ownership, atomic sections, independent copies, collisions, stale versions, unsafe URLs and redirect loops.',
  );
  // Run cancellation probes after normal mutations. Wrangler's local proxy can
  // lose its next upstream connection after cancellation (#15709). A read-only
  // GET lets its built-in safe retry recover; NEVER retry a mutation blindly.
  // This is a local harness workaround, not evidence about production behavior.
  for (const [path, headers, size] of [
    ['/api/auth/email-otp/send-verification-otp', jsonHeaders, 40_000],
    ['/api/account', { ...jsonHeaders, Cookie: alice }, 20_000],
    ['/api/feedback', { ...jsonHeaders, Cookie: alice }, 12_000],
    ['/api/account/import', { ...jsonHeaders, Cookie: clipboardUser }, 1_010_000],
    ['/mcp', { ...jsonHeaders, Authorization: 'Bearer ' + tokens.access_token }, 20_000],
  ]) {
    // Observe early rejection directly. Undici can report EPIPE instead of the
    // received 413 when the local proxy cancels a large in-flight request body.
    const status = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ padding: 'x'.repeat(size) });
      const probe = httpRequest(
        origin + path,
        {
          method: 'POST',
          agent: false,
          headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      probe.on('error', reject);
      probe.end(body);
    });
    assert.equal(status, 413);
    const warm = await request('/');
    await warm.text();
    assert.equal(warm.status, 200);
  }
  console.log(
    'Body limits returned 413 for auth, account, feedback and MCP. Read-only requests reset the known local proxy cancellation issue (#15709).',
  );
  const grants = await (
    await request('/api/auth/oauth2/get-consents', { headers: { Cookie: alice } })
  ).json();
  const disconnect = await request('/api/auth/oauth2/delete-consent', {
    method: 'POST',
    headers: { ...jsonHeaders, Cookie: alice },
    body: JSON.stringify({ id: grants[0].id }),
  });
  assert.equal(disconnect.status, 200);
  assert.equal(
    (await rpc('get_profile')).status,
    401,
    'Disconnected tokens cannot read the account',
  );
  console.log(
    'Standalone Worker checks passed: D1 email sign-in, dashboard, forged headers, isolation, redirects, OAuth discovery, consent, authenticated MCP read/edit, and disconnect.',
  );
} finally {
  await proxy.dispose();
}
