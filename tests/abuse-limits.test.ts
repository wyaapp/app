import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { consumeLimit, RateLimitError, reserveLimits } from '../lib/abuse-limits.ts';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    'CREATE TABLE security_limits (key TEXT PRIMARY KEY, count INTEGER, expires_at INTEGER)',
  );
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: (number | string)[]) {
          return {
            async first() {
              return sqlite.prepare(sql).get(...values) ?? null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  const count = (key: string) =>
    sqlite.prepare('SELECT count FROM security_limits WHERE key = ?').get(key)?.count;
  return { db, count };
}

test('a full window reports its remaining duration rounded up in seconds', async () => {
  const { db } = database();
  await consumeLimit(db, 'example', 1, 60_000, 61_100);
  await assert.rejects(
    consumeLimit(db, 'example', 1, 60_000, 61_100),
    (error) => error instanceof RateLimitError && error.status === 429 && error.retryAfter === 59,
  );
  await consumeLimit(db, 'example', 1, 60_000, 120_000);
});

test('a reservation is refunded once and only in its original window', async () => {
  const { db, count } = database();
  const release = await reserveLimits(
    db,
    [{ key: 'example', maximum: 3, windowMs: 60_000 }],
    59_999,
  );
  await consumeLimit(db, 'example', 3, 60_000, 59_999);
  await consumeLimit(db, 'example', 3, 60_000, 60_000);
  await Promise.all([release(), release(), release()]);
  await release();
  assert.equal(count('example:0'), 1, 'another delivery in the same window is retained');
  assert.equal(count('example:1'), 1, 'the next window is not refunded');
});

test('quota reservation rolls back earlier counters on a later rejection', async () => {
  const { db, count } = database();
  await consumeLimit(db, 'full', 1, 60_000, 1_000);
  await assert.rejects(
    reserveLimits(
      db,
      [
        { key: 'available', maximum: 3, windowMs: 60_000 },
        { key: 'full', maximum: 1, windowMs: 60_000 },
      ],
      1_000,
    ),
    (error) => error instanceof RateLimitError,
  );
  assert.equal(count('available:0'), 0);
  assert.equal(count('full:0'), 1);
});
