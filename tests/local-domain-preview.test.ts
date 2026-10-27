import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalDomainPreview, LOCAL_DOMAIN_SCENARIOS } from '../lib/local-domain-preview.ts';

function preview(scenario: Parameters<typeof createLocalDomainPreview>[0] = {}) {
  return createLocalDomainPreview({
    actionDelayMs: 0,
    readDelayMs: 0,
    now: () => 1_800_000_000_000,
    ...scenario,
  });
}

test('connect and checks progress through ownership, HTTPS, routing and active without losing the chosen hostname', async () => {
  const mock = preview({ scenario: 'empty' });
  const connected = await mock.request({ action: 'connect', hostname: ' My-Space.example.com ' });
  assert.equal(connected.domain?.hostname, 'my-space.example.com');
  assert.equal(connected.domain?.status, 'ownership');
  assert.equal(connected.domain?.checkedAt, 0);
  const https = await mock.request({ action: 'check' });
  assert.deepEqual(https.domain?.checks, {
    ownership: 'verified',
    certificate: 'pending',
    routing: 'pending',
  });
  assert.equal(https.domain?.records[1].name, '_acme-challenge.my-space.example.com');
  const routing = await mock.request({ action: 'check' });
  assert.deepEqual(routing.domain?.checks, {
    ownership: 'verified',
    certificate: 'active',
    routing: 'pending',
  });
  const active = await mock.request({ action: 'check' });
  assert.equal(active.domain?.status, 'active');
  assert.equal(active.domain?.hostname, 'my-space.example.com');
  assert.equal(active.domain?.checks?.routing, 'verified');
  assert.equal(active.domain?.records[0].name, '_wya.my-space.example.com');
});

test('unchanged checks record the attempt and failed actions preserve the current settings', async () => {
  const mock = preview();
  mock.setOutcome('unchanged');
  const unchanged = await mock.request({ action: 'check' });
  assert.equal(unchanged.domain?.status, 'ownership');
  assert.equal(unchanged.domain?.checkedAt, 1_800_000_000_000);
  mock.setOutcome('fail');
  await assert.rejects(mock.request({ action: 'check' }), /Could not update/);
  assert.deepEqual(await mock.request(), unchanged);
});

test('redirects require an active connection and disconnect removes only fixture state', async () => {
  const mock = preview();
  await assert.rejects(mock.request({ action: 'redirect', redirect: true }), /must be active/);
  mock.setScenario('active');
  assert.equal((await mock.request({ action: 'redirect', redirect: true })).domain?.redirect, true);
  assert.equal((await mock.request({ action: 'check' })).domain?.redirect, true);
  assert.equal((await mock.request({ action: 'remove' })).domain, null);
  await assert.rejects(mock.request({ action: 'check' }), /Connect a domain/);
});

test('instances and returned snapshots cannot mutate another fixture', async () => {
  const first = preview({ scenario: 'active' });
  const second = preview({ scenario: 'active' });
  const returned = await first.request();
  returned.domain!.hostname = 'changed.example.com';
  returned.domain!.checks!.ownership = 'pending';
  returned.domain!.records[0].value = 'changed';
  const snapshot = first.snapshot();
  snapshot.domain!.hostname = 'changed-again.example.com';
  assert.equal((await first.request()).domain?.hostname, 'example.com');
  assert.equal((await first.request()).domain?.checks?.ownership, 'verified');
  await first.request({ action: 'remove' });
  assert.equal((await second.request()).domain?.hostname, 'example.com');
});

test('all preview scenarios are available without external resources', async () => {
  const mock = preview();
  for (const scenario of LOCAL_DOMAIN_SCENARIOS) {
    mock.setScenario(scenario);
    const result = await mock.request();
    assert.equal(result.available, scenario !== 'unavailable');
    assert.equal(result.entitled, !['free', 'suspended'].includes(scenario));
    if (['empty', 'free', 'unavailable'].includes(scenario)) assert.equal(result.domain, null);
    else assert.ok(result.domain);
  }
});

test('aborted and reset requests cannot change the selected fixture', async () => {
  const mock = preview({ actionDelayMs: 20 });
  const controller = new AbortController();
  const action = mock.request({ action: 'check' }, controller.signal);
  controller.abort();
  await assert.rejects(action, { name: 'AbortError' });
  assert.equal(mock.snapshot().domain?.status, 'ownership');
  const stale = mock.request({ action: 'check' });
  mock.setScenario('empty');
  await assert.rejects(stale, { name: 'AbortError' });
  assert.equal(mock.snapshot().domain, null);
  mock.setScenario('active');
  mock.setOutcome('fail');
  mock.reset();
  assert.equal((await mock.request({ action: 'check' })).domain?.status, 'active');
});

test('connection validates input and unavailable or free modes reject it', async () => {
  const mock = preview({ scenario: 'empty' });
  for (const hostname of ['https://example.com', 'example.com/path', 'x', '-bad.example.com']) {
    await assert.rejects(mock.request({ action: 'connect', hostname }));
    assert.equal(mock.snapshot().domain, null);
  }
  mock.setScenario('free');
  await assert.rejects(mock.request({ action: 'connect', hostname: 'example.com' }), /Premium/);
  mock.setScenario('unavailable');
  await assert.rejects(
    mock.request({ action: 'connect', hostname: 'example.com' }),
    /not available/,
  );
});
