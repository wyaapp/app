import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createDomainService } from '../lib/domain-service.ts';
import {
  DOMAIN_HEADER,
  DOMAIN_STATUS_MAX_AGE,
  domainIsActive,
  domainLookup,
  activeDomainForSpace,
  normalizeCustomDomain,
  type DomainRow,
} from '../lib/custom-domains.ts';
import {
  createDomainProvider,
  verifyDomainTxt,
  verifyDomainRouting,
  type ProviderHostname,
} from '../lib/domain-provider.ts';
import { routeDomainRequest } from '../deployment/domain-routing.ts';
import { spaceAddress, spacePath } from '../lib/public-address.ts';
import { AppError } from '../lib/app-error.ts';
import type { HostingMode } from '../lib/plans.ts';
import { invalidateDomainLookup } from '../lib/domain-cache.ts';

const config = {
  zoneId: 'a'.repeat(32),
  token: 'unit-test-only',
  target: 'domains.wya.im',
  origin: 'https://wya.im',
};
const activeHost: ProviderHostname = {
  id: 'provider-id',
  hostname: 'lecastro.me',
  status: 'active',
  ssl: { status: 'active' },
};
function fixture(hostingMode: HostingMode = 'self-hosted') {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    'PRAGMA foreign_keys=ON; CREATE TABLE spaces (id TEXT PRIMARY KEY, user_id TEXT, handle TEXT);',
  );
  sqlite.exec(
    "INSERT INTO spaces VALUES ('one','alice','on'), ('two','bob','bob'), ('three','alice','other');",
  );
  sqlite.exec(
    'CREATE TABLE space_revisions (id TEXT PRIMARY KEY, space_id TEXT, version INTEGER);',
  );
  sqlite.exec(readFileSync('drizzle/0005_security_limits.sql', 'utf8'));
  sqlite.exec(readFileSync('drizzle/0008_space_domains.sql', 'utf8'));
  sqlite.exec(readFileSync('drizzle/0014_domain_maintenance.sql', 'utf8'));
  sqlite.exec(
    'CREATE TABLE account_plans (user_id TEXT PRIMARY KEY, premium_until INTEGER, updated_at INTEGER);',
  );
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
        async all() {
          return { results: sqlite.prepare(sql).all(...values) };
        },
        async run() {
          return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } };
        },
      };
      return query;
    },
  } as unknown as D1Database;
  let owns = false,
    routes = true,
    host = { ...activeHost },
    creates = 0,
    removals = 0,
    failsRemoval = false;
  let now = 1_800_000_000_000;
  const provider = {
    async find() {
      return host;
    },
    async ensure() {
      creates++;
      return host;
    },
    async get() {
      return host;
    },
    async remove() {
      removals++;
      if (failsRemoval) throw new AppError('Provider unavailable', 503);
    },
  };
  const service = createDomainService(
    db,
    { ...config, hostingMode },
    {
      provider,
      verifyTxt: async () => owns,
      verifyRouting: async () => routes,
      now: () => now,
      random: () => 0.5,
    },
  );
  return {
    sqlite,
    db,
    service,
    provider,
    now: () => now,
    grant: (userId: string, duration = 86_400_000) =>
      sqlite
        .prepare(
          'INSERT INTO account_plans VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET premium_until = excluded.premium_until, updated_at = excluded.updated_at',
        )
        .run(userId, now + duration, now),
    setOwns: (value: boolean) => (owns = value),
    setRoutes: (value: boolean) => (routes = value),
    setHost: (value: ProviderHostname) => (host = value),
    setRemovalFailure: (value: boolean) => (failsRemoval = value),
    advance: (ms: number) => (now += ms),
    counts: () => ({ creates, removals }),
  };
}
const connect = { action: 'connect', hostname: 'lecastro.me' };
const check = { action: 'check', hostname: 'lecastro.me' };
const status = (code: number) => (error: unknown) =>
  error instanceof AppError && error.status === code;

test('custom domains normalize IDNs and reject URLs, IPs, private and Wya hosts', () => {
  assert.equal(normalizeCustomDomain(' LECASTRO.ME. '), 'lecastro.me');
  assert.equal(normalizeCustomDomain('café.com'), 'xn--caf-dma.com');
  for (const value of [
    'https://lecastro.me',
    'me.com/path',
    'a.com:443',
    '127.0.0.1',
    '[::1]',
    '0x7f000001',
    'foo.local',
    'localhost',
    '*.me.com',
    'wya.im',
    'x.wya.im',
    'a..com',
    '-a.com',
    'a.com?x=1',
    'a.com#x',
    'a@b.com',
  ])
    assert.throws(() => normalizeCustomDomain(value), AppError, value);
});

test('ownership and one-domain-per-space are enforced before provider requests', async () => {
  const f = fixture();
  await assert.rejects(f.service.get('bob', 'one'), status(404));
  await assert.rejects(f.service.change('bob', 'one', connect), status(404));
  const initial = await f.service.change('alice', 'one', connect);
  assert.equal(initial.domain?.status, 'ownership');
  assert.equal(initial.domain?.redirect, false);
  assert.deepEqual(initial.domain?.checks, {
    ownership: 'pending',
    certificate: 'pending',
    routing: 'pending',
  });
  await assert.rejects(
    f.service.change('alice', 'one', { ...connect, hostname: 'other.com' }),
    status(409),
  );
  const missingTxt = (await f.service.change('alice', 'one', check)).domain;
  assert.equal(missingTxt?.status, 'ownership');
  assert.equal(missingTxt?.checks?.ownership, 'pending');
  assert.equal(f.counts().creates, 0);
  await assert.rejects(
    f.service.change('alice', 'one', {
      action: 'redirect',
      hostname: 'lecastro.me',
      redirect: true,
    }),
    status(400),
  );
});

test('unverified claims cannot squat a domain and only one verified space can claim it', async () => {
  const f = fixture();
  await f.service.change('bob', 'two', connect);
  await f.service.change('alice', 'one', connect);
  f.setOwns(true);
  assert.equal((await f.service.change('alice', 'one', check)).domain?.status, 'active');
  await assert.rejects(f.service.change('bob', 'two', check), status(409));
  assert.equal(f.counts().creates, 1);
});

test('activation requires both hostname and SSL, status can regress, redirects remain gated', async () => {
  const f = fixture();
  await f.service.change('alice', 'one', connect);
  f.setOwns(true);
  f.setHost({ ...activeHost, ssl: { status: 'pending_validation' } });
  const pending = (await f.service.change('alice', 'one', check)).domain;
  assert.equal(pending?.status, 'pending');
  assert.deepEqual(pending?.checks, {
    ownership: 'verified',
    certificate: 'pending',
    routing: 'pending',
  });
  f.setHost(activeHost);
  const active = (await f.service.change('alice', 'one', check)).domain;
  assert.equal(active?.status, 'active');
  assert.deepEqual(active?.checks, {
    ownership: 'verified',
    certificate: 'active',
    routing: 'verified',
  });
  assert.equal(
    (
      await f.service.change('alice', 'one', {
        action: 'redirect',
        hostname: 'lecastro.me',
        redirect: true,
      })
    ).domain?.redirect,
    true,
  );
  f.setHost({ ...activeHost, status: 'moved' });
  assert.equal((await f.service.change('alice', 'one', check)).domain?.status, 'pending');
  f.advance(DOMAIN_STATUS_MAX_AGE + 1);
  assert.equal((await f.service.get('alice', 'one')).domain?.status, 'pending');
});

test('connection checks distinguish active HTTPS from a domain that does not route to Wya', async () => {
  const f = fixture();
  await f.service.change('alice', 'one', connect);
  f.setOwns(true);
  f.setRoutes(false);
  const pending = (await f.service.change('alice', 'one', check)).domain;
  assert.equal(pending?.status, 'pending');
  assert.deepEqual(pending?.checks, {
    ownership: 'verified',
    certificate: 'active',
    routing: 'pending',
  });
  f.setRoutes(true);
  const active = (await f.service.change('alice', 'one', check)).domain;
  assert.equal(active?.status, 'active');
  assert.equal(active?.checks?.routing, 'verified');
});

test('removal disables routing before provider cleanup and retries safely', async () => {
  const f = fixture();
  await f.service.change('alice', 'one', connect);
  f.setOwns(true);
  await f.service.change('alice', 'one', check);
  f.setRemovalFailure(true);
  await assert.rejects(
    f.service.change('alice', 'one', { action: 'remove', hostname: 'lecastro.me' }),
    status(503),
  );
  const removing = (await f.service.get('alice', 'one')).domain;
  assert.equal(removing?.status, 'removing');
  assert.equal(removing?.checks?.routing, 'pending');
  f.setRemovalFailure(false);
  f.advance(3_600_001);
  await f.service.refreshDue();
  assert.equal((await f.service.get('alice', 'one')).domain, null);
  assert.equal(f.counts().removals, 2);
});

test('leases reject concurrent updates and recover after expiration', async () => {
  const f = fixture();
  await f.service.change('alice', 'one', connect);
  f.sqlite.exec("UPDATE space_domains SET lock_until = 1800000090000, lock_id = 'other-worker'");
  await assert.rejects(f.service.change('alice', 'one', check), status(409));
  f.advance(90_001);
  assert.equal((await f.service.change('alice', 'one', check)).domain?.status, 'ownership');
});

test('verification checks are rate limited and stale UI cannot change another domain', async () => {
  const f = fixture();
  await f.service.change('alice', 'one', connect);
  await assert.rejects(
    f.service.change('alice', 'one', { action: 'remove', hostname: 'wrong.com' }),
    status(409),
  );
  for (let i = 0; i < 4; i++) await f.service.change('alice', 'one', check);
  await assert.rejects(f.service.change('alice', 'one', check), status(429));
});

test('ownership DNS checks use a fixed resolver and exact TXT tokens', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.redirect, 'manual'); // Workerd does not support redirect: 'error'.
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://cloudflare-dns.com');
    assert.equal(url.searchParams.get('name'), '_wya.lecastro.me');
    return Response.json({ Status: 0, Answer: [{ type: 16, data: '"wya-" "token"' }] });
  };
  assert.equal(await verifyDomainTxt('lecastro.me', 'wya-token', fetcher), true);
  assert.equal(await verifyDomainTxt('lecastro.me', 'wrong', fetcher), false);
  await assert.rejects(
    verifyDomainTxt('lecastro.me', 'token', async () => Response.json({ Status: 2 })),
    status(503),
  );
});

test('provider credentials never enter errors; interrupted creation can reuse an exact hostname', async () => {
  const failing = createDomainProvider(
    config,
    async () => new Response('private-token-and-details', { status: 403 }),
  );
  await assert.rejects(
    failing.ensure('lecastro.me'),
    (error: unknown) => error instanceof AppError && !error.message.includes('private-token'),
  );
  let calls = 0;
  const provider = createDomainProvider(config, async (input, init) => {
    calls++;
    assert.equal(init?.redirect, 'manual');
    assert.equal(new URL(String(input)).hostname, 'api.cloudflare.com');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer unit-test-only');
    return Response.json({ success: true, result: [activeHost] });
  });
  assert.equal((await provider.ensure('lecastro.me')).id, activeHost.id);
  assert.equal(calls, 1);
});

function routingFixture(overrides: Partial<DomainRow> = {}) {
  return {
    space_id: 'one',
    hostname: 'lecastro.me',
    handle: 'on',
    verification_token: 'token',
    verified_at: Date.now(),
    provider_id: 'id',
    hostname_status: 'active',
    ssl_status: 'active',
    dns_ready: 1,
    records: '[]',
    redirect: 0,
    removing: 0,
    checked_at: Date.now(),
    ...overrides,
  };
}
test('custom routing serves only its space, preserves query strings and strips identity', async () => {
  const result = await routeDomainRequest(
    new Request('https://lecastro.me/?tab=games', {
      headers: {
        cookie: 'session=secret; wya-locale=pt-BR',
        authorization: 'Bearer secret',
        'oai-authenticated-user-id': 'victim',
        [DOMAIN_HEADER]: 'forged.com',
      },
    }),
    config.origin,
    async () => routingFixture(),
  );
  assert.ok(result instanceof Request);
  assert.equal(result.url, 'https://lecastro.me/on?tab=games');
  assert.equal(result.headers.get(DOMAIN_HEADER), 'lecastro.me');
  assert.equal(result.headers.get('cookie'), 'wya-locale=pt-BR');
  assert.equal(result.headers.get('authorization'), null);
  assert.equal(result.headers.get('oai-authenticated-user-id'), null);
  const link = await routeDomainRequest(
    new Request('https://lecastro.me/discord'),
    config.origin,
    async () => routingFixture(),
  );
  assert.ok(link instanceof Request);
  assert.equal(new URL(link.url).pathname, '/on/discord');
});

test('unknown, unverified, stale and removed domains never serve a profile', async () => {
  for (const record of [
    null,
    routingFixture({ verified_at: null }),
    routingFixture({ dns_ready: 0 }),
    routingFixture({ ssl_status: 'pending' }),
    routingFixture({ removing: 1 }),
    routingFixture({ checked_at: Date.now() - DOMAIN_STATUS_MAX_AGE - 1 }),
  ]) {
    const result = await routeDomainRequest(
      new Request('https://lecastro.me/'),
      config.origin,
      async () => record,
    );
    assert.ok(result instanceof Response);
    assert.equal(result.status, 404);
  }
});

test('custom domains cannot serve private APIs, other spaces, or mutate accounts', async () => {
  for (const path of [
    '/api/account',
    '/api/domains',
    '/api/files?spaceId=one',
    '/api/public-files?handle=someone',
    '/api/discord-widget?guildId=123',
    '/other/discord',
    '/api/discord-widget?handle=someone&slug=discord',
  ]) {
    const response = await routeDomainRequest(
      new Request(`https://lecastro.me${path}`),
      config.origin,
      async () => routingFixture(),
    );
    assert.ok(response instanceof Response);
    assert.equal(response.status, 404, path);
  }
  const dashboard = await routeDomainRequest(
    new Request('https://lecastro.me/dashboard/profile'),
    config.origin,
    async () => routingFixture(),
  );
  assert.ok(dashboard instanceof Response);
  assert.equal(dashboard.headers.get('location'), 'https://wya.im/dashboard/profile');
  const experimental = await routeDomainRequest(
    new Request('https://lecastro.me/experimental-dashboard/links?space=one'),
    config.origin,
    async () => routingFixture(),
  );
  assert.ok(experimental instanceof Response);
  assert.equal(
    experimental.headers.get('location'),
    'https://wya.im/experimental-dashboard/links?space=one',
  );
  const write = await routeDomainRequest(
    new Request('https://lecastro.me/api/account', { method: 'POST' }),
    config.origin,
    async () => routingFixture(),
  );
  assert.ok(write instanceof Response);
  assert.equal(write.status, 405);
  for (const path of [
    '/assets/app.js',
    '/favicon.svg',
    '/api/pictures/key',
    '/api/gifs/config',
    '/giphy/powered-by-giphy.png',
    '/api/discord-widget?handle=on&slug=discord',
    '/api/public-files?handle=on',
    '/api/public-files?handle=on&id=11111111-1111-4111-8111-111111111111',
  ]) {
    const response = await routeDomainRequest(
      new Request(`https://lecastro.me${path}`),
      config.origin,
      async () => routingFixture(),
    );
    assert.ok(response instanceof Request);
    assert.equal(new URL(response.url).pathname, path.split('?')[0]);
  }
});

test('canonical requests cannot forge the internal domain header', async () => {
  const result = await routeDomainRequest(
    new Request('https://wya.im/on', { headers: { [DOMAIN_HEADER]: 'lecastro.me' } }),
    config.origin,
    async () => {
      throw new Error('should not look up');
    },
  );
  assert.ok(result instanceof Request);
  assert.equal(result.headers.get(DOMAIN_HEADER), null);
});

test('space URLs have no handle prefix on custom domains', () => {
  assert.equal(spacePath('on'), '/on');
  assert.equal(spacePath('on', true), '/');
  assert.equal(spacePath('on', true, 'discord'), '/discord');
  assert.equal(
    spaceAddress({ handle: 'on', publicDomain: { hostname: 'lecastro.me', redirect: false } }),
    'https://lecastro.me',
  );
  assert.equal(domainIsActive(routingFixture()), true);
});

test('routing DNS verifies CNAME chains and flattened records without visiting customer URLs', async () => {
  const dns =
    (records: Record<string, { type: number; data: string }[]>): typeof fetch =>
    async (input) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://cloudflare-dns.com');
      return Response.json({
        Status: 0,
        Answer: records[`${url.searchParams.get('name')}:${url.searchParams.get('type')}`] ?? [],
      });
    };
  assert.equal(
    await verifyDomainRouting(
      'lecastro.me',
      config.target,
      dns({
        'lecastro.me:CNAME': [{ type: 5, data: 'middle.net.' }],
        'middle.net:CNAME': [{ type: 5, data: 'DOMAINS.WYA.IM.' }],
      }),
    ),
    true,
  );
  const target = { 'domains.wya.im:A': [{ type: 1, data: '192.0.2.10' }] };
  assert.equal(
    await verifyDomainRouting(
      'lecastro.me',
      config.target,
      dns({
        ...target,
        'lecastro.me:A': [{ type: 1, data: '192.0.2.10' }],
      }),
    ),
    true,
  );
  assert.equal(
    await verifyDomainRouting(
      'lecastro.me',
      config.target,
      dns({
        ...target,
        'lecastro.me:A': [{ type: 1, data: '192.0.2.11' }],
      }),
    ),
    false,
  );
  assert.equal(
    await verifyDomainRouting(
      'lecastro.me',
      config.target,
      dns({
        ...target,
        'lecastro.me:A': [{ type: 1, data: '192.0.2.10' }],
        'lecastro.me:AAAA': [{ type: 28, data: '2001:db8::1' }],
        'domains.wya.im:AAAA': [{ type: 28, data: '2001:db8::2' }],
      }),
    ),
    false,
    'a matching IPv4 address must not hide stale IPv6 routing',
  );
  assert.equal(await verifyDomainRouting('lecastro.me', config.target, dns({})), false);
});

test('removing the ownership TXT disables active routing on the next check', async () => {
  const f = fixture();
  await f.service.change('alice', 'one', connect);
  f.setOwns(true);
  await f.service.change('alice', 'one', check);
  f.setOwns(false);
  const missingTxt = (await f.service.change('alice', 'one', check)).domain;
  assert.equal(missingTxt?.status, 'pending');
  assert.equal(missingTxt?.checks?.ownership, 'pending');
  assert.equal(missingTxt?.checks?.routing, 'pending');
  assert.equal(f.sqlite.prepare('SELECT dns_ready FROM space_domains').get()?.dns_ready, 0);
});

test('failed scheduled checks back off without extending the last successful verification', async () => {
  const f = fixture();
  await f.service.change('alice', 'one', connect);
  f.setOwns(true);
  await f.service.change('alice', 'one', check);
  const lastSuccess = (await f.service.get('alice', 'one')).domain!.checkedAt;
  let calls = 0;
  f.provider.get = async () => {
    calls++;
    throw new AppError('Provider unavailable', 503);
  };
  f.advance(7 * 3_600_000);
  await f.service.refreshDue();
  await f.service.refreshDue();
  assert.equal(calls, 1);
  assert.equal((await f.service.get('alice', 'one')).domain!.checkedAt, lastSuccess);
  f.advance(DOMAIN_STATUS_MAX_AGE);
  const stale = (await f.service.get('alice', 'one')).domain;
  assert.equal(stale?.status, 'pending');
  assert.equal(stale?.checks?.routing, 'pending');
});

test('hosted custom domains enforce account Premium on mutations and preserve Free removal', async () => {
  const f = fixture('hosted');
  assert.equal((await f.service.get('alice', 'one')).entitled, false);
  f.grant('bob');
  await assert.rejects(f.service.change('alice', 'one', connect), status(403));
  assert.equal(f.counts().creates, 0);
  f.grant('alice', 1000);
  await f.service.change('alice', 'one', connect);
  f.setOwns(true);
  assert.equal((await f.service.change('alice', 'one', check)).domain?.status, 'active');
  await f.service.change('alice', 'one', { ...check, action: 'redirect', redirect: true });
  f.advance(1000);
  const expired = await f.service.get('alice', 'one');
  assert.equal(expired.entitled, false);
  assert.equal(expired.domain?.status, 'suspended');
  assert.equal(expired.domain?.redirect, false);
  assert.equal(expired.domain?.checks?.routing, 'pending');
  assert.equal(
    f.sqlite.prepare('SELECT redirect FROM space_domains').get()?.redirect,
    1,
    'saved preference survives suspension',
  );
  await assert.rejects(f.service.change('alice', 'one', check), status(403));
  await assert.rejects(
    f.service.change('alice', 'one', { ...check, action: 'redirect', redirect: true }),
    status(403),
  );
  await f.service.change('alice', 'one', { ...check, action: 'redirect', redirect: false });
  await f.service.change('alice', 'one', { ...check, action: 'remove' });
  assert.equal((await f.service.get('alice', 'one')).domain, null);
});

test('cached hosted routes hard-expire Premium and cannot reuse self-hosted cache entries', async (t) => {
  const f = fixture('hosted');
  t.mock.method(Date, 'now', f.now);
  f.grant('alice', 1000);
  f.setOwns(true);
  await f.service.change('alice', 'one', connect);
  await f.service.change('alice', 'one', check);
  const hosted = domainLookup(f.db, 'hosted');
  const selfHosted = domainLookup(f.db, 'self-hosted');
  assert.equal(domainIsActive((await selfHosted('lecastro.me'))!), true);
  const cached = (await hosted('lecastro.me'))!;
  assert.equal(cached.access_until, f.now() + 1000);
  const route = () =>
    routeDomainRequest(new Request('https://lecastro.me/robots.txt'), config.origin, hosted);
  assert.equal(((await route()) as Response).status, 200);
  f.advance(999);
  assert.equal(((await route()) as Response).status, 200);
  f.advance(1);
  assert.equal(domainIsActive(cached), false, 'the cached row itself carries the hard deadline');
  assert.equal(((await route()) as Response).status, 404);
  assert.equal(
    await activeDomainForSpace(f.db, 'one', 'hosted'),
    null,
    'canonical Wya URLs cannot redirect to a suspended domain',
  );
  assert.ok(await activeDomainForSpace(f.db, 'one', 'self-hosted'));
  assert.equal(domainIsActive((await selfHosted('lecastro.me'))!), true);
  f.sqlite.exec('DELETE FROM space_domains');
  invalidateDomainLookup(f.db, 'lecastro.me');
  assert.equal(await hosted('lecastro.me'), null);
  assert.equal(
    await selfHosted('lecastro.me'),
    null,
    'invalidation reaches every hosting-mode partition',
  );
});

test('expired accounts clean up provider resources with retries and six-hour recovery checks', async () => {
  const f = fixture('hosted');
  f.grant('alice', 1000);
  f.setOwns(true);
  await f.service.change('alice', 'one', connect);
  await f.service.change('alice', 'one', check);
  const original = f.sqlite.prepare('SELECT * FROM space_domains').get()!;
  f.advance(1000);
  f.sqlite.exec('UPDATE space_domains SET next_check_at = 0');
  f.setRemovalFailure(true);
  await f.service.refreshDue();
  let suspended = f.sqlite.prepare('SELECT * FROM space_domains').get()!;
  assert.equal(suspended.dns_ready, 0);
  assert.equal(suspended.provider_id, original.provider_id, 'failed deletion remains retryable');
  assert.equal(
    suspended.checked_at,
    original.checked_at,
    'suspension is not a new DNS verification',
  );
  f.setRemovalFailure(false);
  f.advance(5 * 60_000);
  await f.service.refreshDue();
  suspended = f.sqlite.prepare('SELECT * FROM space_domains').get()!;
  assert.equal(suspended.provider_id, null);
  assert.equal(suspended.hostname_status, 'suspended');
  assert.equal(suspended.verification_token, original.verification_token);
  assert.equal(suspended.verified_at, original.verified_at, 'claim survives provider cleanup');
  assert.equal(suspended.next_check_at, f.now() + 6 * 3_600_000);
  assert.equal(f.counts().creates, 1);
  assert.equal(f.counts().removals, 2);
  f.grant('alice');
  f.setOwns(false);
  assert.equal((await f.service.change('alice', 'one', check)).domain?.status, 'pending');
  assert.equal(f.counts().creates, 1, 'a renewed plan cannot bypass fresh ownership verification');
  f.setOwns(true);
  assert.equal((await f.service.change('alice', 'one', check)).domain?.status, 'active');
  assert.equal(f.counts().creates, 2);
});

test('renewal during suspended provider cleanup never routes to a deleted registration', async () => {
  const f = fixture('hosted');
  f.grant('alice', 1000);
  f.setOwns(true);
  await f.service.change('alice', 'one', connect);
  await f.service.change('alice', 'one', check);
  f.advance(1000);
  f.sqlite.exec('UPDATE space_domains SET next_check_at = 0');
  let started!: () => void;
  let finish!: () => void;
  const removing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const removed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  f.provider.remove = async () => {
    started();
    await removed;
  };
  const maintenance = f.service.refreshDue();
  await removing;
  // Model the billing projection's atomic resume reset while cleanup holds the
  // domain lease but waits on the provider. Billing does not share that lease.
  f.sqlite.exec(
    "UPDATE space_domains SET dns_ready = 0, hostname_status = 'pending', next_check_at = 0",
  );
  f.grant('alice');
  finish();
  await maintenance;
  assert.equal(f.sqlite.prepare('SELECT provider_id FROM space_domains').get()?.provider_id, null);
  assert.equal((await f.service.get('alice', 'one')).domain?.status, 'pending');
  assert.equal((await f.service.change('alice', 'one', check)).domain?.status, 'active');
  assert.equal(f.counts().creates, 2);
});

test('Premium expiration during provider provisioning cleans up before exposing the new registration', async () => {
  const f = fixture('hosted');
  f.grant('alice', 1000);
  f.setOwns(true);
  await f.service.change('alice', 'one', connect);
  f.provider.ensure = async () => {
    f.advance(1000);
    return activeHost;
  };
  assert.equal((await f.service.change('alice', 'one', check)).domain?.status, 'suspended');
  assert.equal(f.counts().removals, 1);
  assert.equal(f.sqlite.prepare('SELECT provider_id FROM space_domains').get()?.provider_id, null);
});
