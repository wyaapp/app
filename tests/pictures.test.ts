import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createPictureService, readPicture } from '../lib/picture-service.ts';
import { createSpaceService } from '../lib/space-service.ts';
import { MAX_PICTURE_BYTES } from '../lib/picture-limits.ts';
import { AppError } from '../lib/model.ts';
import { cropGeometry } from '../lib/picture-crop.ts';

const status = (n: number) => (error: unknown) => error instanceof AppError && error.status === n;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
function upload(bytes = png, headers: Record<string, string> = {}) {
  return new Request('https://wya.im/api/pictures', {
    method: 'PUT',
    headers: { 'content-type': 'image/png', ...headers },
    body: bytes,
  });
}
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of [
    '0000_dapper_morlocks',
    '0002_spaces',
    '0004_profile_pictures',
    '0005_security_limits',
  ])
    sqlite.exec(readFileSync(`drizzle/${file}.sql`, 'utf8'));
  function prepare(sql: string) {
    let values: SQLInputValue[] = [];
    const statement = {
      bind(...args: SQLInputValue[]) {
        values = args;
        return statement;
      },
      async first() {
        return sqlite.prepare(sql).get(...values) ?? null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
      async run() {
        return statement.execute();
      },
      execute() {
        return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } };
      },
    };
    return statement;
  }
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map((s) => s.execute());
        sqlite.exec('COMMIT');
        return result;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
  const objects = new Map<string, { bytes: Uint8Array; type: string }>();
  const failures = { put: false, delete: false };
  const bucket = {
    async put(key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: string } }) {
      if (failures.put) throw new Error('R2 failed');
      objects.set(key, { bytes: bytes.slice(), type: options.httpMetadata.contentType });
      return {};
    },
    async delete(key: string) {
      if (failures.delete) throw new Error('R2 failed');
      objects.delete(key);
    },
    async get(key: string) {
      const o = objects.get(key);
      return o
        ? {
            size: o.bytes.length,
            httpEtag: `"${key}"`,
            httpMetadata: { contentType: o.type },
            body: new Blob([o.bytes.slice().buffer]).stream(),
            arrayBuffer: async () => o.bytes.slice().buffer,
          }
        : null;
    },
  } as unknown as R2Bucket;
  return {
    sqlite,
    objects,
    failures,
    pictures: createPictureService(db, bucket),
    spaces: createSpaceService(db),
  };
}

test('5 MB is inclusive; unknown or dishonest lengths cannot bypass the streaming cap', async () => {
  const exact = new Uint8Array(MAX_PICTURE_BYTES);
  exact.set(png);
  assert.equal((await readPicture(upload(exact))).bytes.length, MAX_PICTURE_BYTES);
  const large = new Uint8Array(MAX_PICTURE_BYTES + 1);
  large.set(png);
  await assert.rejects(readPicture(upload(large)), status(413));
  await assert.rejects(readPicture(upload(large, { 'content-length': '1' })), status(413));
  await assert.rejects(
    readPicture(upload(png, { 'content-length': String(MAX_PICTURE_BYTES + 1) })),
    status(413),
  );
  let canceled = false;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(exact);
      c.enqueue(new Uint8Array([0]));
    },
    cancel() {
      canceled = true;
    },
  });
  const request = new Request('https://wya.im/api/pictures', {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  await assert.rejects(readPicture(request), status(413));
  assert.equal(canceled, true);
  await assert.rejects(readPicture(upload(new Uint8Array())), status(400));
  await assert.rejects(
    readPicture(upload(new TextEncoder().encode('<svg/>'), { 'content-type': 'image/svg+xml' })),
    status(415),
  );
  await assert.rejects(readPicture(upload(new TextEncoder().encode('<html/>'))), status(415));
});

test('upload, replacement and removal have no photo history; restoring content preserves the current picture', async () => {
  const { spaces, pictures, objects } = fixture();
  let p = await spaces.mutate('alice', {
    action: 'create_profile',
    handle: 'alice',
    name: 'Alice',
  });
  p = await pictures.upload('alice', p.id, 1, upload());
  const first = p.pictureUrl!;
  assert.equal((await spaces.getHistory('alice', p.id)).length, 0);
  p = await spaces.mutate('alice', {
    action: 'update_profile',
    spaceId: p.id,
    expectedVersion: p.version,
    bio: 'New bio',
  });
  assert.equal(p.pictureUrl, first);
  p = await pictures.upload('alice', p.id, p.version, upload());
  const second = p.pictureUrl!;
  assert.notEqual(second, first);
  assert.equal(objects.size, 1);
  assert.equal(
    (await pictures.get(first.split('/').pop()!, new Request('https://wya.im/'))).status,
    404,
  );
  p = await spaces.mutate('alice', {
    action: 'restore_revision',
    spaceId: p.id,
    expectedVersion: p.version,
    revision: 2,
  });
  assert.equal(p.bio, '');
  assert.equal(p.pictureUrl, second);
  assert.equal((await spaces.getPublicProfile('alice'))!.pictureUrl, second);
  const history = await spaces.getHistory('alice', p.id);
  p = await pictures.remove('alice', p.id, p.version);
  assert.equal(p.pictureUrl, null);
  assert.equal(objects.size, 0);
  assert.deepEqual(await spaces.getHistory('alice', p.id), history);
});

test('pictures enforce ownership and optimistic concurrency; copying uses independent objects', async () => {
  const { spaces, pictures, objects } = fixture();
  const a = await spaces.mutate('alice', {
    action: 'create_profile',
    handle: 'alice',
    name: 'Alice',
  });
  const b = await spaces.mutate('alice', {
    action: 'create_profile',
    handle: 'studio',
    name: 'Studio',
  });
  const c = await spaces.mutate('bob', { action: 'create_profile', handle: 'bob', name: 'Bob' });
  await assert.rejects(pictures.upload('bob', a.id, 1, upload()), status(404));
  await assert.rejects(pictures.remove('bob', a.id, 1), status(404));
  const results = await Promise.allSettled([
    pictures.upload('alice', a.id, 1, upload()),
    pictures.upload('alice', a.id, 1, upload()),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && status(409)(r.reason)).length, 1);
  assert.equal(objects.size, 1);
  await assert.rejects(pictures.copy('bob', c.id, 1, a.id), status(404));
  const copied = await pictures.copy('alice', b.id, 1, a.id);
  await pictures.remove('alice', a.id, 2);
  assert.equal(objects.size, 1);
  const response = await pictures.get(
    copied.pictureUrl!.split('/').pop()!,
    new Request('https://wya.im/'),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
});

test('failed uploads preserve the old picture; cleanup retries deletion and keeps referenced objects', async () => {
  const { spaces, pictures, objects, failures, sqlite } = fixture();
  let p = await spaces.mutate('alice', {
    action: 'create_profile',
    handle: 'alice',
    name: 'Alice',
  });
  p = await pictures.upload('alice', p.id, 1, upload());
  failures.put = true;
  await assert.rejects(pictures.upload('alice', p.id, p.version, upload()), /R2 failed/);
  assert.equal((await spaces.getAccount('alice', p.id))!.pictureUrl, p.pictureUrl);
  assert.equal(objects.size, 1);
  failures.put = false;
  failures.delete = true;
  p = await pictures.upload('alice', p.id, p.version, upload());
  assert.equal(objects.size, 2);
  failures.delete = false;
  sqlite.exec("UPDATE picture_objects SET created_at='2020-01-01'");
  await pictures.cleanup();
  assert.equal(objects.size, 1);
  assert.ok(objects.has(p.pictureUrl!.split('/').pop()!));
});

test('crop covers the square at every right-angle rotation and zoom', () => {
  for (const [width, height] of [
    [1600, 900],
    [800, 1200],
    [512, 512],
  ])
    for (const rotation of [0, 90, 180, 270])
      for (const zoom of [1, 2, 3]) {
        const g = cropGeometry(width, height, { rotation, zoom, x: 0, y: 0 }, 512);
        assert.ok((rotation % 180 ? height : width) * g.scale >= 512);
        assert.ok((rotation % 180 ? width : height) * g.scale >= 512);
        assert.ok(g.overflowX >= 0 && g.overflowY >= 0);
      }
});
