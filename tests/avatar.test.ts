import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { avatarRequest, AVATAR_CACHE_SECONDS, routeProfileAvatar } from '../lib/avatar.ts';

const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const fallbackBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 4, 5, 6]);
type Options = NonNullable<Parameters<typeof routeProfileAvatar>[3]>;

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE spaces (id TEXT PRIMARY KEY, handle TEXT, picture_key TEXT, data TEXT);
    CREATE TABLE space_handles (handle TEXT PRIMARY KEY, space_id TEXT);
  `);
  const counts = { reads: 0, get: 0, head: 0, render: 0, puts: 0, matches: 0 };
  const failures = { database: false, storage: false, cacheRead: false, cacheWrite: false };
  let clock = 1_800_000_000_000;
  const objects = new Map<string, { bytes: Uint8Array; type: string }>();
  const cached = new Map<string, { response: Response; expires: number }>();
  const cacheRequests: Request[] = [];
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: SQLInputValue[]) {
          return {
            async first() {
              counts.reads++;
              if (failures.database) throw new Error('Private database failure');
              return sqlite.prepare(sql).get(...values) ?? null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  const metadata = (key: string) => {
    if (failures.storage) throw new Error('Private bucket credential');
    const object = objects.get(key);
    return object
      ? {
          size: object.bytes.length,
          httpEtag: `"${key}"`,
          httpMetadata: { contentType: object.type },
        }
      : null;
  };
  const bucket = {
    async head(key: string) {
      counts.head++;
      return metadata(key);
    },
    async get(key: string) {
      counts.get++;
      const info = metadata(key);
      return info
        ? { ...info, body: new Blob([objects.get(key)!.bytes.slice().buffer]).stream() }
        : null;
    },
  } as unknown as R2Bucket;
  const cache = {
    async match(request: Request) {
      counts.matches++;
      if (failures.cacheRead) throw new Error('Cache unavailable');
      const entry = cached.get(request.url);
      if (!entry || entry.expires <= clock) return undefined;
      return entry.response.clone();
    },
    async put(request: Request, response: Response) {
      counts.puts++;
      if (failures.cacheWrite) throw new Error('Cache unavailable');
      cacheRequests.push(request);
      const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1]);
      const bytes = await response.arrayBuffer();
      cached.set(request.url, {
        expires: clock + maxAge * 1000,
        response: new Response(bytes, { status: response.status, headers: response.headers }),
      });
    },
  } as unknown as NonNullable<Options['cache']>;
  const rendered: Array<{ name: string; handle: string }> = [];
  const options: Options = {
    cache,
    now: () => clock,
    renderInitials: async (name, handle) => {
      counts.render++;
      rendered.push({ name, handle });
      return new Response(fallbackBytes.slice(), { headers: { 'Content-Type': 'image/png' } });
    },
  };
  function add(
    handle: string,
    name: string,
    picture: string | null = null,
    aliases: string[] = [],
  ) {
    sqlite
      .prepare('INSERT INTO spaces VALUES (?, ?, ?, ?)')
      .run(handle, handle, picture, JSON.stringify({ name, privateField: 'Never expose me' }));
    for (const alias of [handle, ...aliases])
      sqlite.prepare('INSERT INTO space_handles VALUES (?, ?)').run(alias, handle);
    if (picture) objects.set(picture, { bytes: imageBytes, type: 'image/png' });
  }
  async function request(path: string, init?: RequestInit, overrides?: Options) {
    return routeProfileAvatar(
      new Request(`https://wya.im${path}`, init),
      { DB: db, PICTURES: bucket },
      ctx,
      { ...options, ...overrides },
    );
  }
  return {
    sqlite,
    counts,
    failures,
    objects,
    cacheRequests,
    rendered,
    add,
    request,
    options,
    db,
    bucket,
    ctx,
    advance: (milliseconds: number) => (clock += milliseconds),
    flush: async () => {
      await Promise.all(pending.splice(0));
    },
  };
}

test('avatar URLs normalize case and encoding while excluding nested paths and malformed handles', () => {
  assert.deepEqual(avatarRequest('/ON.PNG'), { handle: 'on', literalHandle: 'on.png' });
  assert.deepEqual(avatarRequest('/%6Fn.png'), { handle: 'on', literalHandle: 'on.png' });
  assert.deepEqual(avatarRequest('/alex.work.png'), {
    handle: 'alex.work',
    literalHandle: 'alex.work.png',
  });
  assert.deepEqual(avatarRequest('/api/avatars/alex.png'), {
    handle: 'alex.png',
    literalHandle: null,
  });
  for (const path of [
    '/',
    '/alice',
    '/alice.jpg',
    '/assets/alice.png',
    '/customer/alice.png',
    '/alice.png/extra',
    '/alice%2fbob.png',
    '/%ZZ.png',
    '/-alice.png',
    '/alice-.png',
    `/${'a'.repeat(40)}.png`,
    '/api/avatars/',
  ])
    assert.equal(avatarRequest(path), null, path);
});

test('an uploaded image needs one public lookup and streams original bytes without rendering', async () => {
  const f = fixture();
  f.add('on', 'Alex Castro', 'photo-one', ['previous']);
  for (const path of ['/on.png', '/PREVIOUS.png']) {
    const response = (await f.request(path))!;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('content-length'), String(imageBytes.length));
    assert.equal(response.headers.get('etag'), '"photo-one"');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), imageBytes);
  }
  await f.flush();
  assert.equal(f.counts.reads, 2);
  assert.equal(f.counts.get, 2);
  assert.equal(f.counts.render, 0);
});

test('warm public cache skips D1/R2, ignores query/cookie input, and preserves its original expiry', async () => {
  const f = fixture();
  f.add('on', 'Alex Castro', 'photo-one');
  await (await f.request('/on.png?download=1', {
    headers: { Cookie: 'session=private' },
  }))!.arrayBuffer();
  await f.flush();
  f.sqlite.prepare('UPDATE spaces SET picture_key = ? WHERE handle = ?').run('photo-two', 'on');
  f.objects.delete('photo-one');
  f.objects.set('photo-two', { bytes: fallbackBytes, type: 'image/webp' });
  f.advance(20_000);
  const response = (await f.request('/ON.PNG?download=2', {
    headers: { Cookie: 'session=another', Authorization: 'Bearer never-forward' },
  }))!;
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), imageBytes);
  assert.equal(response.headers.get('etag'), '"photo-one"');
  assert.equal(response.headers.get('age'), '20');
  assert.equal(response.headers.get('x-wya-avatar-cached-at'), null);
  assert.equal(response.headers.get('vary'), null);
  assert.equal(f.counts.reads, 1);
  assert.equal(f.counts.get, 1);
  assert.equal(f.counts.puts, 1);
  assert.equal(f.cacheRequests.length, 1);
  assert.equal(new URL(f.cacheRequests[0].url).search, '');
  assert.equal(f.cacheRequests[0].headers.get('cookie'), null);
  assert.equal(f.cacheRequests[0].headers.get('authorization'), null);
  f.advance(AVATAR_CACHE_SECONDS * 1000 - 20_000);
  const updated = (await f.request('/on.png'))!;
  assert.equal(updated.headers.get('etag'), '"photo-two"');
  assert.equal(updated.headers.get('content-type'), 'image/webp');
  assert.deepEqual(new Uint8Array(await updated.arrayBuffer()), fallbackBytes);
  await f.flush();
  assert.equal(f.counts.reads, 2);
  assert.equal(f.counts.get, 2);
});

test('HEAD on a cold image uses R2 metadata and never caches an empty GET response', async () => {
  const f = fixture();
  f.add('on', 'Alex Castro', 'photo-one');
  const head = (await f.request('/on.png', { method: 'HEAD' }))!;
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-length'), String(imageBytes.length));
  assert.equal(f.counts.head, 1);
  assert.equal(f.counts.get, 0);
  assert.equal(f.counts.puts, 0);
  const get = (await f.request('/on.png'))!;
  assert.deepEqual(new Uint8Array(await get.arrayBuffer()), imageBytes);
  await f.flush();
  assert.equal(f.counts.get, 1);
  const cachedHead = (await f.request('/on.png', { method: 'HEAD' }))!;
  assert.equal(cachedHead.status, 200);
  assert.equal(await cachedHead.text(), '');
  assert.equal(f.counts.head, 1);
  assert.equal(f.counts.reads, 2);
});

test('conditional image requests accept weak/list ETags and do not transfer a body', async () => {
  const f = fixture();
  f.add('on', 'Alex Castro', 'photo-one');
  await (await f.request('/on.png'))!.arrayBuffer();
  await f.flush();
  for (const etag of ['"photo-one"', 'W/"photo-one"', '"other", W/"photo-one"', '*']) {
    const response = (await f.request('/on.png', { headers: { 'If-None-Match': etag } }))!;
    assert.equal(response.status, 304);
    assert.equal(response.headers.get('etag'), '"photo-one"');
    assert.equal(response.headers.get('content-length'), null);
    assert.equal(await response.text(), '');
  }
  const changed = (await f.request('/on.png', { headers: { 'If-None-Match': '"older"' } }))!;
  assert.equal(changed.status, 200);
  assert.deepEqual(new Uint8Array(await changed.arrayBuffer()), imageBytes);
  assert.equal(f.counts.reads, 1);
  assert.equal(f.counts.get, 1);
});

test('existing profiles without pictures get initials while missing accounts return a brief 404', async () => {
  const f = fixture();
  f.add('on', 'Alex Castro');
  const missing = (await f.request('/missing.png'))!;
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Profile not found.');
  await f.flush();
  assert.equal(f.counts.render, 0);
  assert.equal(f.counts.get, 0);
  const initials = (await f.request('/on.png'))!;
  assert.equal(initials.status, 200);
  assert.equal(initials.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await initials.arrayBuffer()), fallbackBytes);
  assert.deepEqual(f.rendered, [{ name: 'Alex Castro', handle: 'on' }]);
  await f.flush();
  f.add('missing', 'New Account');
  f.advance(5000);
  assert.equal((await f.request('/missing.png'))!.status, 200);
  await f.flush();
});

test('initials HEAD and revalidation avoid the PNG renderer and do not poison GET caching', async () => {
  const f = fixture();
  f.add('on', 'Alex Castro');
  const head = (await f.request('/on.png', { method: 'HEAD' }))!;
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(f.counts.render, 0);
  assert.equal(f.counts.puts, 0);
  const etag = head.headers.get('etag')!;
  const unchanged = (await f.request('/on.png', { headers: { 'If-None-Match': etag } }))!;
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  assert.equal(f.counts.render, 0);
  assert.equal(f.counts.puts, 0);
  const get = (await f.request('/on.png'))!;
  assert.deepEqual(new Uint8Array(await get.arrayBuffer()), fallbackBytes);
  await f.flush();
  assert.equal(f.counts.render, 1);
  assert.equal(f.counts.puts, 1);
});

test('literal .png usernames keep their pages, with an unambiguous API for avatar access', async () => {
  const f = fixture();
  f.add('alex', 'Alex', 'photo-one');
  f.add('alex.png', 'Another Alex');
  assert.equal(await f.request('/alex.png'), null);
  assert.equal(f.counts.puts, 0);
  const direct = (await f.request('/api/avatars/alex'))!;
  assert.equal(direct.headers.get('etag'), '"photo-one"');
  assert.deepEqual(new Uint8Array(await direct.arrayBuffer()), imageBytes);
  const named = (await f.request('/alex.png.png'))!;
  assert.equal(named.status, 200);
  assert.deepEqual(new Uint8Array(await named.arrayBuffer()), fallbackBytes);
  assert.deepEqual(f.rendered, [{ name: 'Another Alex', handle: 'alex.png' }]);
  await f.flush();
});

test('non-image paths and unsupported methods do not touch storage', async () => {
  const f = fixture();
  assert.equal(await f.request('/on'), null);
  assert.equal(await f.request('/space/on.png'), null);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = (await f.request('/on.png', { method }))!;
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(f.counts.reads, 0);
  assert.equal(f.counts.get, 0);
  assert.equal(f.counts.render, 0);
});

test('missing picture objects get initials; failed storage and rendering do not become cached images', async () => {
  const f = fixture();
  f.add('on', 'Alex Castro', 'photo-one');
  f.objects.delete('photo-one');
  const fallback = (await f.request('/on.png', undefined, { cache: null }))!;
  assert.deepEqual(new Uint8Array(await fallback.arrayBuffer()), fallbackBytes);
  assert.equal(f.counts.render, 1);
  for (const failure of ['database', 'storage'] as const) {
    f.failures[failure] = true;
    const response = (await f.request('/on.png'))!;
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await response.text(), /Private|credential|database/);
    f.failures[failure] = false;
  }
  const brokenRenderer = (await f.request('/on.png', undefined, {
    renderInitials: async () => {
      throw new Error('Private renderer failure');
    },
  }))!;
  assert.equal(brokenRenderer.status, 503);
  assert.equal(f.counts.puts, 0);
  f.objects.set('photo-one', { bytes: imageBytes, type: 'text/html' });
  assert.equal((await f.request('/on.png'))!.status, 503);
  assert.equal(f.counts.puts, 0);
});

test('cache service failures do not take available profile pictures offline', async () => {
  const f = fixture();
  f.add('on', 'Alex Castro', 'photo-one');
  f.failures.cacheRead = true;
  f.failures.cacheWrite = true;
  const response = (await f.request('/on.png'))!;
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), imageBytes);
  await f.flush();
  assert.equal(f.counts.reads, 1);
  assert.equal(f.counts.get, 1);
});
