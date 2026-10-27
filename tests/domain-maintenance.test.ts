import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createDomainService } from '../lib/domain-service.ts';
import { domainIsActive, domainLookup, DOMAIN_STATUS_MAX_AGE } from '../lib/custom-domains.ts';
import {
  DOMAIN_QUEUE_LEASE_MS,
  consumeDomainMaintenance,
  dispatchDomainMaintenance,
  domainCheckDelay,
  type DomainMaintenanceMessage,
  type DomainMaintenanceRow,
} from '../lib/domain-maintenance.ts';

const config = { zoneId: 'a'.repeat(32), token: 'unit-only', target: 'domains.wya.im' };

function pausedProvider() {
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  return {
    async pause() {
      entered.resolve();
      await released.promise;
    },
    async waitUntilCalled(operation: Promise<unknown>) {
      // Mutation rate limits hash asynchronously before reaching the provider.
      // Wait for the actual call, not an arbitrary number of event-loop turns.
      await Promise.race([
        entered.promise,
        operation.then(() => assert.fail('Operation finished without calling the provider')),
      ]);
    },
    release: released.resolve,
  };
}

function fixture(count = 1) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE spaces (id TEXT PRIMARY KEY, user_id TEXT, handle TEXT);');
  sqlite.exec(
    'CREATE TABLE space_revisions (id TEXT PRIMARY KEY, space_id TEXT, version INTEGER);',
  );
  for (const file of ['0005_security_limits', '0008_space_domains', '0014_domain_maintenance'])
    sqlite.exec(readFileSync(`drizzle/${file}.sql`, 'utf8'));
  let clock = 1_800_000_000_000;
  let queries = 0;
  const db = {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      const query = {
        bind(...args: SQLInputValue[]) {
          values = args;
          return query;
        },
        async first() {
          queries++;
          return sqlite.prepare(sql).get(...values) ?? null;
        },
        async all() {
          queries++;
          return { results: sqlite.prepare(sql).all(...values) };
        },
        async run() {
          queries++;
          return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } };
        },
      };
      return query;
    },
  } as unknown as D1Database;
  const insert = sqlite.prepare(`INSERT INTO space_domains
    (space_id, hostname, verification_token, verified_at, provider_id, hostname_status,
      ssl_status, dns_ready, checked_at, created_at, registration_id, next_check_at)
    VALUES (?, ?, 'unit-owner', ?, ?, 'active', 'active', 1, ?, ?, ?, ?)`);
  for (let i = 0; i < count; i++) {
    sqlite.prepare('INSERT INTO spaces VALUES (?, ?, ?)').run(`space-${i}`, 'owner', `handle-${i}`);
    insert.run(
      `space-${i}`,
      `host-${i}.example.com`,
      clock - 6 * 3_600_000,
      `${i}`,
      clock - 6 * 3_600_000,
      clock - 86_400_000,
      crypto.randomUUID(),
      clock - count + i,
    );
  }
  let calls = 0;
  let fail = false;
  const provider = {
    async get(id: string) {
      calls++;
      if (fail) throw new Error('provider secret must not be logged');
      return {
        id,
        hostname: `host-${id}.example.com`,
        status: 'active',
        ssl: { status: 'active' },
      };
    },
    async ensure(hostname: string) {
      calls++;
      return { id: 'fresh', hostname, status: 'active', ssl: { status: 'active' } };
    },
    async find() {
      return null;
    },
    async remove() {
      if (fail) throw new Error('provider unavailable');
    },
  };
  const service = createDomainService(db, config, {
    provider,
    verifyTxt: async () => true,
    verifyRouting: async () => true,
    now: () => clock,
    random: () => 0.5,
  });
  const messages: DomainMaintenanceMessage[] = [];
  const queue = {
    async sendBatch(batch: { body: DomainMaintenanceMessage }[]) {
      assert.ok(batch.length <= 100);
      messages.push(...batch.map((item) => item.body));
    },
  } as unknown as Pick<Queue<DomainMaintenanceMessage>, 'sendBatch'>;
  return {
    sqlite,
    db,
    provider,
    service,
    queue,
    messages,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
    setFailure: (value: boolean) => {
      fail = value;
    },
    calls: () => calls,
    queries: () => queries,
    row: (id = 'space-0') =>
      sqlite
        .prepare('SELECT * FROM space_domains WHERE space_id = ?')
        .get(id) as unknown as DomainMaintenanceRow,
  };
}

test('dispatcher distributes over 1000 due domains fairly without duplicate live leases', async () => {
  const f = fixture(1_205);
  const first = await dispatchDomainMaintenance(f.db, f.queue, { now: f.now });
  assert.equal(first.enqueued, 1_000);
  assert.equal(first.dueSampleCapped, true);
  assert.equal(f.messages[0].spaceId, 'space-0');
  assert.ok(f.queries() <= 12, 'dispatch budget stays independent of domain count');
  assert.equal((await dispatchDomainMaintenance(f.db, f.queue, { now: f.now })).enqueued, 205);
  assert.equal(new Set(f.messages.map((item) => item.spaceId)).size, 1_205);
  assert.equal((await dispatchDomainMaintenance(f.db, f.queue, { now: f.now })).enqueued, 0);
  assert.equal(f.calls(), 0, 'dispatch performs no provider calls');
});

test('concurrent dispatchers atomically claim different jobs', async () => {
  const f = fixture(180);
  await Promise.all([
    dispatchDomainMaintenance(f.db, f.queue, { now: f.now }),
    dispatchDomainMaintenance(f.db, f.queue, { now: f.now }),
  ]);
  assert.equal(f.messages.length, 180);
  assert.equal(new Set(f.messages.map((item) => item.spaceId)).size, 180);
});

test('ambiguous enqueue failure releases claims and duplicate deliveries complete only once', async () => {
  const f = fixture();
  const queue = {
    async sendBatch(batch: { body: DomainMaintenanceMessage }[]) {
      f.messages.push(...batch.map((item) => item.body));
      throw new Error('network failure');
    },
  } as Pick<Queue<DomainMaintenanceMessage>, 'sendBatch'>;
  const result = await dispatchDomainMaintenance(f.db, queue, { now: f.now });
  assert.equal(result.sendFailures, 1);
  assert.equal(f.row().queued_until, 0);
  assert.equal((await dispatchDomainMaintenance(f.db, f.queue, { now: f.now })).enqueued, 1);
  assert.equal((await f.service.processMaintenance(f.messages[0])).status, 'complete');
  assert.equal((await f.service.processMaintenance(f.messages[1])).status, 'obsolete');
  assert.equal(f.calls(), 1);
});

test('expired delivery leases recover lost messages while a delayed original can still finish once', async () => {
  const f = fixture();
  await dispatchDomainMaintenance(f.db, f.queue, { now: f.now });
  const old = f.messages[0];
  f.advance(DOMAIN_QUEUE_LEASE_MS + 1);
  await dispatchDomainMaintenance(f.db, f.queue, { now: f.now });
  assert.equal(f.messages[1].dispatchId, old.dispatchId);
  assert.equal((await f.service.processMaintenance(old)).status, 'complete');
  assert.equal((await f.service.processMaintenance(f.messages[1])).status, 'obsolete');
  assert.equal(f.calls(), 1);
});

test('an outage does not let expired enqueue leases starve untouched due domains', async () => {
  const f = fixture(2_200);
  await dispatchDomainMaintenance(f.db, f.queue, { now: f.now });
  f.advance(DOMAIN_QUEUE_LEASE_MS + 1);
  await dispatchDomainMaintenance(f.db, f.queue, { now: f.now });
  assert.equal(new Set(f.messages.map((item) => item.spaceId)).size, 2_000);
  f.advance(DOMAIN_QUEUE_LEASE_MS + 1);
  await dispatchDomainMaintenance(f.db, f.queue, { now: f.now });
  assert.equal(new Set(f.messages.map((item) => item.spaceId)).size, 2_200);
});

test('consumer failures back off durably without refreshing verification or retrying early', async () => {
  const f = fixture();
  const checked = f.row().checked_at;
  await dispatchDomainMaintenance(f.db, f.queue, { now: f.now });
  f.setFailure(true);
  const first = await f.service.processMaintenance(f.messages[0]);
  assert.deepEqual(first, { status: 'retry', delaySeconds: 300 });
  assert.equal(f.row().check_failures, 1);
  assert.equal(f.row().checked_at, checked);
  assert.equal((await f.service.processMaintenance(f.messages[0])).status, 'retry');
  assert.equal(f.calls(), 1);
  f.advance(300_000);
  assert.deepEqual(await f.service.processMaintenance(f.messages[0]), {
    status: 'retry',
    delaySeconds: 600,
  });
  f.advance(600_000);
  f.setFailure(false);
  assert.equal((await f.service.processMaintenance(f.messages[0])).status, 'complete');
  assert.equal(f.row().check_failures, 0);
  assert.equal(f.row().next_check_at, f.now() + 6 * 3_600_000);
  f.advance(DOMAIN_STATUS_MAX_AGE + 1);
  assert.equal(domainIsActive(f.row(), f.now()), false);
});

test('stale message cannot check a removed and reconnected registration', async () => {
  const f = fixture();
  await dispatchDomainMaintenance(f.db, f.queue, { now: f.now });
  await f.service.change('owner', 'space-0', { action: 'remove', hostname: 'host-0.example.com' });
  await f.service.change('owner', 'space-0', { action: 'connect', hostname: 'host-0.example.com' });
  assert.notEqual(f.row().registration_id, f.messages[0].registrationId);
  assert.equal((await f.service.processMaintenance(f.messages[0])).status, 'obsolete');
  assert.equal(f.calls(), 0);
  assert.equal(f.row().verified_at, null);
});

test('a provider response arriving after lease expiry cannot overwrite a reconnected registration', async () => {
  const f = fixture();
  await dispatchDomainMaintenance(f.db, f.queue, { now: f.now });
  const provider = pausedProvider();
  f.provider.get = async (id: string) => {
    await provider.pause();
    return { id, hostname: 'host-0.example.com', status: 'active', ssl: { status: 'active' } };
  };
  const pending = f.service.processMaintenance(f.messages[0]);
  await provider.waitUntilCalled(pending);
  f.advance(90_001);
  await f.service.change('owner', 'space-0', { action: 'remove', hostname: 'host-0.example.com' });
  await f.service.change('owner', 'space-0', { action: 'connect', hostname: 'new.example.com' });
  const replacement = f.row();
  provider.release();
  assert.equal((await pending).status, 'retry');
  assert.deepEqual(f.row(), replacement);
});

test('a removal completing after lease expiry cannot delete a reconnected registration', async () => {
  const f = fixture();
  const provider = pausedProvider();
  f.provider.remove = provider.pause;
  const pending = f.service.change('owner', 'space-0', {
    action: 'remove',
    hostname: 'host-0.example.com',
  });
  await provider.waitUntilCalled(pending);
  f.advance(90_001);
  f.provider.remove = async () => {};
  await f.service.change('owner', 'space-0', { action: 'remove', hostname: 'host-0.example.com' });
  await f.service.change('owner', 'space-0', { action: 'connect', hostname: 'new.example.com' });
  const replacement = f.row();
  provider.release();
  await assert.rejects(pending, /expired/);
  assert.deepEqual(f.row(), replacement);
});

test('an expired removal lease cannot start a provider mutation after a delayed lookup', async () => {
  const f = fixture();
  f.sqlite.exec('UPDATE space_domains SET provider_id = NULL');
  const provider = pausedProvider();
  let removals = 0;
  const oldFind = async () => {
    await provider.pause();
    return { id: 'old-provider', hostname: 'host-0.example.com' };
  };
  const service = createDomainService(f.db, config, {
    provider: {
      ...f.provider,
      find: oldFind,
      remove: async () => {
        removals++;
      },
    },
    now: f.now,
    random: () => 0.5,
  });
  const pending = service.change('owner', 'space-0', {
    action: 'remove',
    hostname: 'host-0.example.com',
  });
  await provider.waitUntilCalled(pending);
  f.advance(90_001);
  await f.service.change('owner', 'space-0', { action: 'remove', hostname: 'host-0.example.com' });
  await f.service.change('owner', 'space-0', { action: 'connect', hostname: 'new.example.com' });
  const replacement = f.row();
  provider.release();
  await assert.rejects(pending, /expired/);
  assert.equal(removals, 0);
  assert.deepEqual(f.row(), replacement);
});

test('provider mutations do not start when a live lease has insufficient time remaining', async () => {
  const f = fixture();
  f.sqlite.exec('UPDATE space_domains SET provider_id = NULL');
  let removals = 0;
  const service = createDomainService(f.db, config, {
    provider: {
      ...f.provider,
      find: async () => {
        f.advance(89_000);
        return { id: 'old-provider', hostname: 'host-0.example.com' };
      },
      remove: async () => {
        removals++;
      },
    },
    now: f.now,
    random: () => 0.5,
  });
  await assert.rejects(
    service.change('owner', 'space-0', {
      action: 'remove',
      hostname: 'host-0.example.com',
    }),
    /expired/,
  );
  assert.equal(removals, 0);
  assert.equal(f.row().removing, 1);
  assert.ok(f.row().next_check_at > f.now());
});

test('unverified claims and future checks do not consume automatic queue slots', async () => {
  const f = fixture(3);
  f.sqlite.exec("UPDATE space_domains SET verified_at = NULL WHERE space_id = 'space-0'");
  f.sqlite
    .prepare("UPDATE space_domains SET next_check_at = ? WHERE space_id = 'space-1'")
    .run(f.now() + 300_000);
  await dispatchDomainMaintenance(f.db, f.queue, { now: f.now });
  assert.deepEqual(
    f.messages.map((item) => item.spaceId),
    ['space-2'],
  );
});

test('removing domains stop routing before provider cleanup completes and failed removals recover', async () => {
  const f = fixture();
  const lookup = domainLookup(f.db);
  assert.equal(domainIsActive((await lookup('host-0.example.com'))!, f.now()), true);
  const provider = pausedProvider();
  f.provider.remove = provider.pause;
  const removal = f.service.change('owner', 'space-0', {
    action: 'remove',
    hostname: 'host-0.example.com',
  });
  await provider.waitUntilCalled(removal);
  assert.equal(domainIsActive((await lookup('host-0.example.com'))!, f.now()), false);
  provider.release();
  await removal;
  assert.equal(await lookup('host-0.example.com'), null);

  const failed = fixture();
  failed.setFailure(true);
  await assert.rejects(
    failed.service.change('owner', 'space-0', { action: 'remove', hostname: 'host-0.example.com' }),
  );
  assert.equal(failed.row().removing, 1);
  failed.setFailure(false);
  failed.advance(300_001);
  await dispatchDomainMaintenance(failed.db, failed.queue, { now: failed.now });
  assert.equal((await failed.service.processMaintenance(failed.messages[0])).status, 'complete');
  assert.equal(failed.row(), undefined);
});

test('message handler acknowledges poison messages and retries each failed job independently', async () => {
  const f = fixture(3);
  await dispatchDomainMaintenance(f.db, f.queue, { now: f.now });
  const state: { acked: number; retries: number[] }[] = [];
  const batch = {
    messages: [null, ...f.messages].map((body) => {
      const item = { acked: 0, retries: [] as number[] };
      state.push(item);
      return {
        body,
        ack() {
          item.acked++;
        },
        retry(options: { delaySeconds: number }) {
          item.retries.push(options.delaySeconds);
        },
      };
    }),
  } as unknown as MessageBatch<unknown>;
  const result = await consumeDomainMaintenance(batch, async (message) => {
    if (message.spaceId === 'space-1') throw new Error('private provider error');
    if (message.spaceId === 'space-2') return { status: 'retry', delaySeconds: 600 };
    return f.service.processMaintenance(message);
  });
  assert.deepEqual(result, { completed: 1, obsolete: 0, retried: 1, invalid: 1, failed: 1 });
  assert.deepEqual(state, [
    { acked: 1, retries: [] },
    { acked: 1, retries: [] },
    { acked: 0, retries: [300] },
    { acked: 0, retries: [600] },
  ]);
});

test('jittered exponential retry delays remain bounded', () => {
  assert.equal(
    domainCheckDelay(false, 1, () => 0),
    240_000,
  );
  assert.equal(
    domainCheckDelay(false, 1, () => 1),
    360_000,
  );
  assert.equal(
    domainCheckDelay(false, 100, () => 1),
    3_600_000,
  );
});
