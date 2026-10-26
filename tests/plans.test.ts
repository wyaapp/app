import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolveAccountPlan, resolveHostingMode } from '../lib/plans.ts';
import { createAccountPlanService } from '../lib/account-plan-service.ts';

test('hosting defaults to self-hosted and rejects misspelled deployment modes', () => {
  assert.equal(resolveHostingMode(), 'self-hosted');
  assert.equal(resolveHostingMode(''), 'self-hosted');
  assert.equal(resolveHostingMode('hosted'), 'hosted');
  assert.equal(resolveHostingMode('self-hosted'), 'self-hosted');
  assert.throws(() => resolveHostingMode('hostd'), /WYA_HOSTING_MODE/);
});

test('self-hosted includes all features without a space cap or license expiry', async () => {
  const expected = {
    hostingMode: 'self-hosted',
    plan: 'free',
    spaceLimit: null,
    customDomains: true,
    premiumUntil: null,
  };
  assert.deepEqual(resolveAccountPlan('self-hosted', 1, 500), expected);
  const db = {
    prepare() {
      throw new Error('Self-hosting must not query billing.');
    },
  } as unknown as D1Database;
  assert.deepEqual(await createAccountPlanService(db).get('owner'), expected);
});

test('only a future valid Premium expiry grants the hosted allowance', () => {
  const free = {
    hostingMode: 'hosted',
    plan: 'free',
    spaceLimit: 2,
    customDomains: false,
    premiumUntil: null,
  };
  for (const value of [null, 0, 999, 1000, NaN, Infinity, 1001.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(resolveAccountPlan('hosted', value, 1000), free);
  }
  assert.deepEqual(resolveAccountPlan('hosted', 1001, 1000), {
    ...free,
    plan: 'premium',
    spaceLimit: 10,
    customDomains: true,
    premiumUntil: 1001,
  });
});

test('account plan lookup is owner-scoped, reads fresh state and expires without a webhook', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const migration of [
      '0000_dapper_morlocks',
      '0002_spaces',
      '0003_reclaimable_handles',
      '0015_hosted_plans',
    ]) {
      sqlite.exec(readFileSync(`drizzle/${migration}.sql`, 'utf8'));
    }
    const db = {
      prepare(sql: string) {
        return {
          bind(userId: string) {
            return {
              async first() {
                return sqlite.prepare(sql).get(userId) ?? null;
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    let now = 1000;
    const plans = createAccountPlanService(db, 'hosted', () => now);
    assert.equal((await plans.get('alice')).plan, 'free');
    sqlite.prepare('INSERT INTO account_plans VALUES (?, ?, ?)').run('alice', 2000, now);
    assert.equal((await plans.get('alice')).plan, 'premium');
    assert.equal((await plans.get('bob')).plan, 'free');
    now = 2000;
    assert.equal((await plans.get('alice')).plan, 'free');
    sqlite.prepare('UPDATE account_plans SET premium_until = ?').run(3000);
    assert.equal((await plans.get('alice')).plan, 'premium');
    sqlite.prepare('DELETE FROM account_plans').run();
    assert.equal((await plans.get('alice')).plan, 'free');
  } finally {
    sqlite.close();
  }
});
