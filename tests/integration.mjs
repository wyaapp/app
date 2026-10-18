// Run against the local built Worker (npm start), never a hosted Site.
import assert from 'node:assert/strict';
const origin = process.env.WYA_TEST_ORIGIN || 'http://127.0.0.1:8787';
assert.ok(
  ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname),
  'Only run against loopback',
);
const suffix = Date.now().toString(36);
const alice = `qa-a-${suffix}`,
  bob = `qa-b-${suffix}`;
function headers(user) {
  return {
    'Content-Type': 'application/json',
    Origin: origin,
    ...(user
      ? {
          'oai-authenticated-user-id': user,
          'oai-authenticated-user-email': `${user}@example.test`,
        }
      : {}),
  };
}
async function request(path, options = {}) {
  return fetch(origin + path, { redirect: 'manual', ...options });
}
async function update(user, body, status = 200) {
  const r = await request('/api/account', {
    method: 'POST',
    headers: headers(user),
    body: JSON.stringify(body),
  });
  const j = await r.json();
  assert.equal(r.status, status, JSON.stringify(j));
  return j;
}
async function rpc(user, method, params) {
  const r = await request('/mcp', {
    method: 'POST',
    headers: headers(user),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  assert.equal(r.status, 200);
  return r.json();
}
assert.equal((await request('/')).status, 200);
assert.equal((await request('/api/account')).status, 401);
await update(null, { action: 'create_profile', handle: alice, name: 'QA' }, 401);
await update(alice, {
  action: 'create_profile',
  handle: alice,
  name: 'QA Alice',
  bio: '<script>alert(1)</script>',
});
await update(bob, { action: 'create_profile', handle: alice, name: 'QA Bob' }, 409);
await update(bob, { action: 'create_profile', handle: bob, name: 'QA Bob' });
let result = await update(alice, {
  action: 'upsert_link',
  expectedVersion: 1,
  slug: 'github',
  label: 'My code',
  destination: '@alexcastro',
  platform: 'github',
});
assert.equal(result.profile.links[0].url, 'https://github.com/alexcastro');
assert.equal(result.history[0].version, 1);
let redirect = await request(`/${alice}/github`);
assert.equal(redirect.status, 302);
assert.equal(redirect.headers.get('location'), 'https://github.com/alexcastro');
assert.equal(redirect.headers.get('cache-control'), 'no-store');
await update(alice, { action: 'update_profile', expectedVersion: 1, bio: 'stale' }, 409);
await update(
  bob,
  { action: 'update_profile', expectedVersion: 1, userId: alice, bio: 'attack' },
  400,
);
assert.equal(
  (
    await request('/api/account', {
      method: 'POST',
      headers: { ...headers(alice), Origin: 'https://attacker.example' },
      body: '{}',
    })
  ).status,
  403,
);
result = await update(alice, {
  action: 'upsert_link',
  expectedVersion: 2,
  slug: 'github',
  label: 'My code',
  destination: 'alexcastro',
  platform: 'github',
  visible: false,
});
assert.equal((await request(`/${alice}/github`)).status, 404);
const publicHtml = await (await request(`/${alice}`)).text();
assert.ok(!publicHtml.includes('href="/' + alice + '/github"'));
assert.ok(!publicHtml.includes('<script>alert(1)</script>'));
await update(bob, { action: 'restore_revision', expectedVersion: 1, revision: 2 }, 404);
result = await update(alice, { action: 'restore_revision', expectedVersion: 3, revision: 2 });
assert.equal(result.profile.links[0].visible, true);
const concurrent = await Promise.all(
  ['A', 'B'].map((bio) =>
    request('/api/account', {
      method: 'POST',
      headers: headers(alice),
      body: JSON.stringify({ action: 'update_profile', expectedVersion: 4, bio }),
    }),
  ),
);
assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
const discover = await rpc(null, 'server/discover');
assert.deepEqual(discover.result.supportedVersions, ['2026-07-28']);
const list = await rpc(null, 'tools/list');
assert.equal(list.result.tools.length, 9);
const denied = await rpc(null, 'tools/call', { name: 'get_profile', arguments: {} });
assert.equal(denied.result.isError, true);
const read = await rpc(alice, 'tools/call', { name: 'get_profile', arguments: {} });
assert.equal(JSON.parse(read.result.content[0].text).profile.handle, alice);
const edit = await rpc(alice, 'tools/call', {
  name: 'update_profile',
  arguments: { expectedVersion: 5, bio: 'Changed through MCP' },
});
assert.equal(JSON.parse(edit.result.content[0].text).profile.bio, 'Changed through MCP');
const other = await rpc(bob, 'tools/call', { name: 'get_profile', arguments: {} });
assert.equal(JSON.parse(other.result.content[0].text).profile.bio, '');
assert.equal(
  (await rpc(alice, 'tools/call', { name: 'unknown', arguments: {} })).result.isError,
  true,
);
console.log(
  'Integration checks passed: authentication, isolation, unique handles, redirects, hidden links, safe rendering, CSRF, conflicts, atomic concurrency, restore, and MCP.',
);
