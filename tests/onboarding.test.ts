import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createOnboardingService } from '../lib/onboarding-service.ts';
import { onboardingSchema } from '../lib/onboarding.ts';
import { AppError } from '../lib/app-error.ts';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('drizzle')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(`drizzle/${file}`, 'utf8'));
  }
  const db = {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      const query = {
        bind(...args: SQLInputValue[]) {
          values = args;
          return query;
        },
        async first() {
          const row = sqlite.prepare(sql).get(...values);
          return row ? { ...row } : null;
        },
        async run() {
          sqlite.prepare(sql).run(...values);
          return { success: true };
        },
      };
      return query;
    },
  } as unknown as D1Database;
  return { sqlite, service: createOnboardingService(db), db };
}

test('onboarding accepts partial or empty answers, rejecting invalid values and owner injection', () => {
  assert.equal(onboardingSchema.safeParse({ action: 'complete' }).success, true);
  assert.equal(
    onboardingSchema.safeParse({ action: 'complete', purpose: 'projects' }).success,
    true,
  );
  for (const input of [
    { action: 'complete', occupation: ['developer', 'student'] },
    { action: 'complete', occupation: 'Developer' },
    { action: 'complete', purpose: 'unknown' },
    { action: 'complete', discovery: 'unknown' },
    { action: 'skip', occupation: 'student' },
    { action: 'complete', userId: 'victim' },
    { action: 'complete', age: 25 },
  ])
    assert.equal(onboardingSchema.safeParse(input).success, false);
});

test('answers persist per account, update in place, and do not modify spaces or revisions', async () => {
  const { sqlite, service, db } = fixture();
  try {
    assert.equal(await service.get('alice'), null);
    const before = sqlite.prepare('SELECT * FROM spaces').all();
    const saved = await service.save('alice', {
      action: 'complete',
      occupation: 'developer',
      discovery: 'chatgpt',
    });
    assert.deepEqual(saved, {
      status: 'completed',
      occupation: 'developer',
      purpose: null,
      discovery: 'chatgpt',
    });
    assert.deepEqual(await createOnboardingService(db).get('alice'), saved);
    assert.equal(await service.get('bob'), null);
    await service.save('alice', { action: 'complete', purpose: 'interests' });
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS count FROM account_onboarding').get()?.count,
      1,
    );
    assert.equal((await service.get('alice'))?.occupation, null);
    assert.deepEqual(sqlite.prepare('SELECT * FROM spaces').all(), before);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM space_revisions').get()?.count, 0);
  } finally {
    sqlite.close();
  }
});

test('skip persists dismissal, clears all answers, and allows answering later', async () => {
  const { sqlite, service, db } = fixture();
  try {
    await service.save('alice', {
      action: 'complete',
      occupation: 'student',
      purpose: 'links',
      discovery: 'friend',
    });
    await service.save('alice', { action: 'skip' });
    assert.deepEqual(await createOnboardingService(db).get('alice'), {
      status: 'skipped',
      occupation: null,
      purpose: null,
      discovery: null,
    });
    const saved = await service.save('alice', { action: 'complete' });
    assert.equal(saved.status, 'completed');
    assert.equal((await service.get('alice'))?.status, 'completed');
  } finally {
    sqlite.close();
  }
});

test('onboarding uses the account write limit and rejects invalid writes before storage', async () => {
  const { sqlite, service } = fixture();
  try {
    await assert.rejects(service.save('alice', { action: 'complete', userId: 'bob' }), AppError);
    assert.equal(await service.get('alice'), null);
    for (let i = 0; i < 30; i++) await service.save('alice', { action: 'skip' });
    await assert.rejects(
      service.save('alice', { action: 'complete' }),
      (error: unknown) => error instanceof AppError && error.status === 429,
    );
    assert.equal((await service.get('alice'))?.status, 'skipped');
    await service.save('bob', { action: 'complete' });
  } finally {
    sqlite.close();
  }
});
