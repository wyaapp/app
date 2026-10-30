import test from 'node:test';
import assert from 'node:assert/strict';
import { routeAppRequest } from '../deployment/app-routing.ts';
import { routeDomainRequest } from '../deployment/domain-routing.ts';

const appOrigin = 'https://app.wya.im';
const assets = {
  async fetch(request: Request | string | URL) {
    const url = new URL(request instanceof Request ? request.url : String(request));
    assert.equal(url.pathname, '/_app/index.html');
    return new Response('<html>static app</html>', { headers: { 'Content-Type': 'text/html' } });
  },
};
test('app pages use the same static entry without authentication or public-space lookup', async () => {
  for (const path of [
    '/',
    '/dashboard',
    '/dashboard/files?space=one',
    '/dashboard/billing?checkout=success',
    '/sign-in',
    '/sign-out',
  ]) {
    const response = await routeAppRequest(new Request(appOrigin + path), appOrigin, assets);
    assert.equal(response?.status, 200);
    assert.equal(await response?.text(), '<html>static app</html>');
    assert.equal(response?.headers.get('x-frame-options'), 'DENY');
    assert.equal(response?.headers.get('cache-control'), 'no-cache');
  }
});
test('APIs bypass SPA fallback, unknown app paths return 404, writes cannot receive HTML', async () => {
  for (const path of ['/api', '/api/files', '/api/not-a-route'])
    assert.equal(await routeAppRequest(new Request(appOrigin + path), appOrigin, assets), null);
  for (const path of [
    '/on',
    '/on/github',
    '/dashboard/not-a-section',
    '/experimental-dashboard/files',
  ])
    assert.equal(
      (await routeAppRequest(new Request(appOrigin + path), appOrigin, assets))?.status,
      404,
    );
  assert.equal(
    (await routeAppRequest(new Request(appOrigin + '/', { method: 'POST' }), appOrigin, assets))
      ?.status,
    405,
  );
  assert.equal(
    (await routeAppRequest(new Request(appOrigin + '/'), appOrigin, undefined))?.status,
    503,
  );
});
test('public and custom hosts never get the private app entry', async () => {
  for (const origin of [
    'https://wya.im',
    'https://lecastro.me',
    'https://app.wya.im.attacker.test',
  ])
    assert.equal(await routeAppRequest(new Request(origin + '/'), appOrigin, assets), null);
});
test('only the explicitly configured app origin bypasses customer domain lookup', async () => {
  let lookups = 0;
  const lookup = async () => {
    lookups++;
    return null;
  };
  const request = new Request(appOrigin + '/api/files', {
    headers: { 'x-wya-custom-domain': 'forged' },
  });
  assert.ok(
    (await routeDomainRequest(request, 'https://wya.im', lookup, appOrigin)) instanceof Request,
  );
  assert.equal(lookups, 0);
  const rejected = await routeDomainRequest(
    new Request('https://unknown.wya.im/api/files'),
    'https://wya.im',
    lookup,
    appOrigin,
  );
  assert.ok(rejected instanceof Response);
  assert.equal(rejected.status, 404);
  assert.equal(lookups, 1);
});

test('API response boundary normalizes HTML and empty failures but preserves binary assets and OAuth redirects', async () => {
  const { apiResponse } = await import('../deployment/request-boundary.ts');
  const request = new Request(appOrigin + '/api/files');
  for (const response of [
    new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response(null, { status: 500 }),
  ]) {
    const result = apiResponse(request, response);
    assert.ok(result.status >= 500);
    assert.equal(result.headers.get('content-type'), 'application/json');
    assert.deepEqual(await result.json(), { error: 'Request failed. Please try again.' });
  }
  const picture = new Response('image bytes', { headers: { 'Content-Type': 'image/png' } });
  assert.equal(apiResponse(request, picture), picture);
  const redirect = Response.redirect('https://wya.im/consent');
  assert.equal(apiResponse(request, redirect), redirect);
  const { GET } = await import('../app/api/[...missing]/route.ts');
  const missing = GET();
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Not found.' });
});
