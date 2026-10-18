import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsSpaceKey } from '../lib/analytics-key.ts';
import {
  createMetricsService,
  metricsQuery,
  metricsWindow,
  summarizeMetrics,
} from '../lib/space-metrics.ts';
import { AppError, type Profile } from '../lib/model.ts';

const now = Date.parse('2026-10-18T12:00:00Z');
const profile: Profile = {
  id: 'legacy:private-auth-id',
  aliases: [],
  handle: 'alex',
  name: 'Alex',
  bio: '',
  theme: 'lilac',
  version: 1,
  updatedAt: '',
  links: [
    {
      id: 'item-1',
      slug: 'github',
      label: 'My code',
      url: 'https://example.com',
      platform: 'github',
      visible: true,
    },
  ],
};
const config = {
  token: 'phc_test',
  host: 'https://eu.i.posthog.com',
  projectId: '310788',
  readKey: 'phx_test',
};

test('date windows include today and use UTC across month boundaries', () => {
  assert.deepEqual(metricsWindow(7, Date.parse('2026-11-02T23:59:00Z')), {
    start: '2026-10-27',
    end: '2026-11-03',
  });
  const summary = summarizeMetrics(
    [
      ['2026-10-12', '$pageview', '', 2],
      ['2026-10-18', 'wya_item_click', 'item-1', 3],
      ['2026-10-11', '$pageview', '', 99],
    ],
    profile,
    7,
    now,
  );
  assert.equal(summary.daily.length, 7);
  assert.equal(summary.views, 2);
  assert.equal(summary.clicks, 3);
  assert.equal(summary.daily[1].views, 0);
  assert.equal(summary.topItems[0].label, 'My code');
});

test('analytics keys are stable, scoped, and do not expose legacy authentication IDs', async () => {
  const key = await analyticsSpaceKey(profile.id);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, await analyticsSpaceKey(profile.id));
  assert.notEqual(key, await analyticsSpaceKey('another-space'));
  const query = metricsQuery(key, 30, now);
  assert.ok(query.includes(`properties.wya_space_id = '${key}'`));
  assert.ok(!query.includes('private-auth-id'));
  assert.throws(() => metricsQuery("x' OR 1=1", 7, now), /Invalid/);
});

test('ownership is checked before cached results and missing configuration', async () => {
  let calls = 0,
    checks = 0;
  const service = createMetricsService({
    config: () => config,
    now: () => now,
    beforeQuery: async () => {},
    getOwnedSpace: async (user, id) => {
      checks++;
      if (user !== 'alice' || id !== profile.id) throw new AppError('Space not found.', 404);
      return profile;
    },
    fetcher: async (input, options) => {
      calls++;
      assert.equal(input, 'https://eu.posthog.com/api/projects/310788/query/');
      assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer phx_test');
      return Response.json({ results: [['2026-10-18', '$pageview', '', 4]] });
    },
  });
  const a = await service('alice', profile.id, 7);
  assert.equal(a.configured && a.views, 4);
  await assert.rejects(service('bob', profile.id, 7), /Space not found/);
  await assert.rejects(service('alice', 'another-space', 7), /Space not found/);
  await service('alice', profile.id, 7);
  assert.equal(calls, 1);
  assert.equal(checks, 4);
  const unconfigured = createMetricsService({
    config: () => ({}),
    beforeQuery: async () => {},
    getOwnedSpace: async () => {
      throw new AppError('Space not found.', 404);
    },
  });
  await assert.rejects(unconfigured('bob', profile.id, 7), /Space not found/);
});

test('cache deduplicates concurrent reads, expires, and resolves renamed labels from current data', async () => {
  let calls = 0,
    time = now;
  const current = structuredClone(profile);
  const service = createMetricsService({
    config: () => config,
    now: () => time,
    beforeQuery: async () => {},
    getOwnedSpace: async () => current,
    fetcher: async () => {
      calls++;
      return Response.json({ results: [['2026-10-18', 'wya_item_click', 'item-1', 2]] });
    },
  });
  await Promise.all([service('alice', profile.id, 7), service('alice', profile.id, 7)]);
  assert.equal(calls, 1);
  current.links[0].label = 'Renamed';
  current.links[0].slug = 'new-url';
  const renamed = await service('alice', profile.id, 7);
  assert.equal(renamed.configured && renamed.topItems[0].label, 'Renamed');
  time += 5 * 60_000;
  await service('alice', profile.id, 7);
  assert.equal(calls, 2);
  await service('alice', profile.id, 30);
  assert.equal(calls, 3);
});

test('upstream errors and malformed data never masquerade as zero traffic or expose credentials', async () => {
  for (const response of [
    Response.json({ secret: 'do not show' }, { status: 401 }),
    Response.json({ results: [['2026-10-18', '$pageview', '', -1]] }),
    Response.json({ query_status: { complete: false } }),
  ]) {
    const service = createMetricsService({
      config: () => config,
      beforeQuery: async () => {},
      getOwnedSpace: async () => profile,
      fetcher: async () => response,
    });
    await assert.rejects(
      service('alice', profile.id, 7),
      (error) =>
        error instanceof AppError && error.status === 503 && !error.message.includes('secret'),
    );
  }
  const service = createMetricsService({
    config: () => ({}),
    beforeQuery: async () => {
      assert.fail('must not query');
    },
    getOwnedSpace: async () => profile,
  });
  assert.deepEqual(await service('alice', profile.id, 7), { configured: false });
});

test('deleted items retain counts without guessing a different item from a reused slug', () => {
  const updated = { ...profile, links: [{ ...profile.links[0], id: 'replacement' }] };
  const metrics = summarizeMetrics(
    [['2026-10-18', 'wya_item_click', 'item-1', 5]],
    updated,
    7,
    now,
  );
  assert.equal(metrics.clicks, 5);
  assert.equal(metrics.topItems[0].label, 'Removed item');
});
