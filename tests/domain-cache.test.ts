import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  createDomainLookupCache,
  DOMAIN_LOOKUP_NEGATIVE_TTL,
  DOMAIN_LOOKUP_TTL,
  invalidateDomainLookup,
  type DomainRoutingRow,
} from '../lib/domain-cache.ts';
import { DOMAIN_STATUS_MAX_AGE, domainIsActive, domainLookup } from '../lib/custom-domains.ts';
import { createDomainService } from '../lib/domain-service.ts';

const start = 1_800_000_000_000;
function row(overrides: Partial<DomainRoutingRow> = {}): DomainRoutingRow {
  return {
    space_id: 'space-one',
    hostname: 'one.example.com',
    verification_token: 'test-only',
    verified_at: start,
    provider_id: 'provider-one',
    hostname_status: 'active',
    ssl_status: 'active',
    dns_ready: 1,
    records: '[]',
    redirect: 0,
    removing: 0,
    checked_at: start,
    handle: 'one',
    ...overrides,
  };
}
const expiry = (value: DomainRoutingRow, now: number) =>
  domainIsActive(value, now)
    ? value.checked_at + DOMAIN_STATUS_MAX_AGE
    : now + DOMAIN_LOOKUP_NEGATIVE_TTL;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('routing cache coalesces concurrent reads and returns independent row snapshots', async () => {
  const read = deferred<DomainRoutingRow | null>();
  let calls = 0;
  const cache = createDomainLookupCache(
    () => {
      calls++;
      return read.promise;
    },
    expiry,
    { now: () => start },
  );
  const requests = Array.from({ length: 100 }, () => cache.lookup('one.example.com'));
  assert.equal(calls, 1);
  const source = row();
  read.resolve(source);
  const values = await Promise.all(requests);
  values[0]!.handle = 'changed-by-caller';
  source.handle = 'changed-by-loader';
  assert.equal(values[1]!.handle, 'one');
  assert.equal((await cache.lookup('one.example.com'))!.handle, 'one');
  assert.equal(cache.stats().coalesced, 99);
  assert.equal(cache.stats().pending, 0);
});

test('cache hits never extend the maximum positive TTL', async () => {
  let now = start;
  let calls = 0;
  const cache = createDomainLookupCache(
    async () => {
      calls++;
      return row();
    },
    expiry,
    { now: () => now },
  );
  await cache.lookup('one.example.com');
  now += DOMAIN_LOOKUP_TTL - 1;
  await cache.lookup('one.example.com');
  assert.equal(calls, 1);
  now++;
  await cache.lookup('one.example.com');
  assert.equal(calls, 2);
});

test('verification expiry wins over the cache TTL and stays inactive after a reload', async () => {
  let now = start;
  let calls = 0;
  const almostExpired = row({ checked_at: start - DOMAIN_STATUS_MAX_AGE + 10 });
  const cache = createDomainLookupCache(
    async () => {
      calls++;
      return almostExpired;
    },
    expiry,
    { now: () => now },
  );
  assert.equal(domainIsActive((await cache.lookup('one.example.com'))!, now), true);
  now += 10;
  assert.equal(domainIsActive((await cache.lookup('one.example.com'))!, now), false);
  assert.equal(calls, 2);
});

test('slow database reads do not extend the TTL from their completion time', async () => {
  let now = start;
  const read = deferred<DomainRoutingRow | null>();
  let calls = 0;
  const cache = createDomainLookupCache(
    () => (++calls === 1 ? read.promise : Promise.resolve(null)),
    expiry,
    { now: () => now },
  );
  const loading = cache.lookup('one.example.com');
  now += DOMAIN_LOOKUP_TTL;
  read.resolve(row());
  await loading;
  assert.equal(cache.stats().entries, 0);
  assert.equal(await cache.lookup('one.example.com'), null);
  assert.equal(calls, 2);
});

test('missing and inactive domains are cached only briefly so activation is visible', async () => {
  let now = start;
  let current: DomainRoutingRow | null = null;
  let calls = 0;
  const cache = createDomainLookupCache(
    async () => {
      calls++;
      return current;
    },
    expiry,
    { now: () => now },
  );
  assert.equal(await cache.lookup('one.example.com'), null);
  current = row({ ssl_status: 'pending_validation' });
  now += DOMAIN_LOOKUP_NEGATIVE_TTL - 1;
  assert.equal(await cache.lookup('one.example.com'), null);
  now++;
  assert.equal((await cache.lookup('one.example.com'))!.ssl_status, 'pending_validation');
  current = row();
  now += DOMAIN_LOOKUP_NEGATIVE_TTL;
  assert.equal((await cache.lookup('one.example.com'))!.ssl_status, 'active');
  assert.equal(calls, 3);
});

test('explicit removal invalidation prevents a pending read restoring or returning old routing', async () => {
  const staleRead = deferred<DomainRoutingRow | null>();
  let calls = 0;
  const cache = createDomainLookupCache(
    () => (++calls === 1 ? staleRead.promise : Promise.resolve(null)),
    expiry,
    { now: () => start },
  );
  const first = cache.lookup('one.example.com');
  const second = cache.lookup('one.example.com');
  cache.invalidate('one.example.com');
  staleRead.resolve(row());
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.equal(await cache.lookup('one.example.com'), null);
  assert.equal(calls, 2);
});

test('expired entries are never served when the fresh database read fails', async () => {
  let now = start;
  let calls = 0;
  const cache = createDomainLookupCache(
    async () => {
      if (++calls === 2) throw new Error('Database unavailable');
      return calls === 1 ? row() : null;
    },
    expiry,
    { now: () => now },
  );
  await cache.lookup('one.example.com');
  now += DOMAIN_LOOKUP_TTL;
  await assert.rejects(cache.lookup('one.example.com'), /Database unavailable/);
  assert.equal(cache.stats().entries, 0);
  assert.equal(cache.stats().pending, 0);
  assert.equal(await cache.lookup('one.example.com'), null);
});

test('unknown-host traffic cannot exceed the cache capacity and LRU keeps a hot host', async () => {
  const cache = createDomainLookupCache(async () => null, expiry, {
    now: () => start,
    capacity: 32,
  });
  await cache.lookup('hot.example.com');
  for (let i = 0; i < 2_000; i++) {
    await cache.lookup(`unknown-${i}.example.com`);
    await cache.lookup('hot.example.com');
  }
  assert.equal(cache.stats().entries, 32);
  assert.equal(cache.stats().loads, 2_001);
  assert.equal(cache.stats().hits, 2_000);
});

test('in-flight retention is bounded and overflow reads cannot later repopulate cache', async () => {
  const reads = Array.from({ length: 4 }, () => deferred<DomainRoutingRow | null>());
  let calls = 0;
  const cache = createDomainLookupCache(() => reads[calls++].promise, expiry, {
    now: () => start,
    pendingCapacity: 2,
  });
  const first = cache.lookup('first.example.com');
  const second = cache.lookup('second.example.com');
  const overflow = cache.lookup('overflow.example.com');
  assert.equal(cache.stats().pending, 2);
  cache.invalidate('overflow.example.com');
  reads[2].resolve(row({ hostname: 'overflow.example.com' }));
  await overflow;
  assert.equal(cache.stats().entries, 0);
  reads[0].resolve(null);
  reads[1].resolve(null);
  await Promise.all([first, second]);
  const reloaded = cache.lookup('overflow.example.com');
  assert.equal(calls, 4);
  reads[3].resolve(null);
  assert.equal(await reloaded, null);
});

test('domain lookups share only the same database identity and support explicit invalidation', async () => {
  function database(handle: string) {
    let calls = 0;
    let result: DomainRoutingRow | null = row({ handle, checked_at: Date.now() });
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            calls++;
            return result;
          },
        }),
      }),
    } as unknown as D1Database;
    return { db, calls: () => calls, remove: () => (result = null) };
  }
  const a = database('alice');
  const b = database('bob');
  assert.equal((await domainLookup(a.db)('one.example.com'))!.handle, 'alice');
  assert.equal((await domainLookup(b.db)('one.example.com'))!.handle, 'bob');
  await domainLookup(a.db)('one.example.com');
  assert.equal(a.calls(), 1);
  assert.equal(b.calls(), 1);
  a.remove();
  invalidateDomainLookup(a.db, 'one.example.com');
  assert.equal(await domainLookup(a.db)('one.example.com'), null);
  assert.equal((await domainLookup(b.db)('one.example.com'))!.handle, 'bob');
  assert.equal(b.calls(), 1);
});

test('real SQLite domain mutations invalidate cached activation, ownership and reconnection state', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE spaces (id TEXT PRIMARY KEY, user_id TEXT, handle TEXT);
    INSERT INTO spaces VALUES ('one', 'owner', 'one');
    CREATE TABLE space_revisions (id TEXT PRIMARY KEY, space_id TEXT, version INTEGER);`);
  for (const migration of ['0005_security_limits', '0008_space_domains', '0014_domain_maintenance'])
    sqlite.exec(readFileSync(`drizzle/${migration}.sql`, 'utf8'));
  const db = {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      const query = {
        bind(...args: SQLInputValue[]) {
          values = args;
          return query;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) ?? null;
        },
        async run() {
          return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } };
        },
      };
      return query;
    },
  } as unknown as D1Database;
  const host = {
    id: 'provider-one',
    hostname: 'one.example.com',
    status: 'active',
    ssl: { status: 'active' },
  };
  let owns = true;
  const service = createDomainService(
    db,
    { zoneId: 'a'.repeat(32), token: 'unit-only', target: 'domains.wya.im' },
    {
      provider: {
        get: async () => host,
        find: async () => host,
        ensure: async () => host,
        remove: async () => undefined,
      },
      verifyTxt: async () => owns,
      verifyRouting: async () => true,
    },
  );
  const lookup = domainLookup(db);
  const change = (action: string) =>
    service.change('owner', 'one', { action, hostname: host.hostname });
  try {
    assert.equal(await lookup(host.hostname), null);
    await change('connect');
    assert.equal(await lookup(host.hostname), null, 'unverified claims remain unrouteable');
    await change('check');
    assert.equal(domainIsActive((await lookup(host.hostname))!), true);
    owns = false;
    await change('check');
    assert.equal(domainIsActive((await lookup(host.hostname))!), false);
    await change('remove');
    assert.equal(await lookup(host.hostname), null);
    await change('connect');
    assert.equal(await lookup(host.hostname), null, 'reconnected claims require fresh ownership');
    owns = true;
    await change('check');
    assert.equal(domainIsActive((await lookup(host.hostname))!), true);
  } finally {
    sqlite.close();
  }
});
