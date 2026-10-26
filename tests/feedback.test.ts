import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { submitFeedback } from '../lib/feedback.ts';
import { AppError } from '../lib/app-error.ts';
import { digestKey, RateLimitError } from '../lib/abuse-limits.ts';

const webhook = 'https://discord.com/api/webhooks/123/test-token';
const input = { message: 'Please add more profile themes.' };
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
  return { db, sqlite };
}
const status = (code: number) => (error: unknown) =>
  error instanceof AppError && error.status === code;

test('feedback sends only the message, disables mentions/previews and waits for confirmation', async () => {
  let calls = 0;
  await submitFeedback({ message: '  @everyone Please fix this.  ' }, 'private-user-id', {
    db: database().db,
    webhook,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, `${webhook}?wait=true`);
      assert.equal(options?.method, 'POST');
      assert.equal(options?.redirect, 'manual');
      assert.ok(options?.signal instanceof AbortSignal);
      const body = JSON.parse(String(options?.body));
      assert.deepEqual(body, {
        username: 'wya.im feedback',
        content: '@everyone Please fix this.',
        allowed_mentions: { parse: [] },
        flags: 4,
      });
      assert.ok(!JSON.stringify(body).includes('private-user-id'));
      return Response.json({ id: 'message-id' });
    },
  });
  assert.equal(calls, 1);
});

test('invalid messages and webhook configuration never reach the network', async () => {
  let calls = 0;
  const config = {
    db: database().db,
    webhook,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 204 });
    },
  };
  for (const message of ['', '    ', 'short', 'a'.repeat(1801), null]) {
    await assert.rejects(submitFeedback({ message }, 'alice', config), status(400));
  }
  await assert.rejects(
    submitFeedback({ ...input, email: 'private@example.com' }, 'alice', config),
    status(400),
  );
  for (const value of [
    undefined,
    'http://discord.com/api/webhooks/123/token',
    'https://evil.test/api/webhooks/123/token',
    `${webhook}?redirect=1`,
    `${webhook}\n`,
    ` ${webhook}`,
  ]) {
    await assert.rejects(
      submitFeedback(input, 'alice', { ...config, webhook: value }),
      status(503),
    );
  }
  assert.equal(calls, 0);
});

test('feedback permits 20 deliveries per hour and rejects the next before delivery', async () => {
  let calls = 0;
  const config = {
    db: database().db,
    webhook,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 204 });
    },
  };
  for (let i = 0; i < 20; i++) {
    await submitFeedback(input, 'alice', { ...config, now: i * 60_000 + 1000 });
  }
  await assert.rejects(
    submitFeedback(input, 'alice', { ...config, now: 20 * 60_000 + 1000 }),
    (error) => error instanceof RateLimitError && error.retryAfter === 2399,
  );
  assert.equal(calls, 20);
  await submitFeedback(input, 'bob', { ...config, now: 20 * 60_000 + 1000 });
  await submitFeedback(input, 'alice', { ...config, now: 3_600_000 });
  assert.equal(calls, 22, 'another account and the next hour each have an allowance');
});

test('feedback permits 100 deliveries per day across hours and rejects the next', async () => {
  let calls = 0;
  const config = {
    db: database().db,
    webhook,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 204 });
    },
  };
  for (let i = 0; i < 100; i++) {
    const now = Math.floor(i / 20) * 3_600_000 + (i % 20) * 60_000 + 1000;
    await submitFeedback(input, 'alice', { ...config, now });
  }
  await assert.rejects(
    submitFeedback(input, 'alice', { ...config, now: 5 * 3_600_000 + 1000 }),
    (error) => error instanceof RateLimitError && error.retryAfter === 68_399,
  );
  assert.equal(calls, 100);
  await submitFeedback(input, 'alice', { ...config, now: 86_400_000 + 1000 });
  assert.equal(calls, 101, 'the next day restores the allowance');
});

test('upstream redirects and failures never expose webhook credentials or response bodies', async () => {
  for (const code of [301, 302, 303, 307, 308, 400, 401, 404, 500, 429]) {
    let calls = 0;
    await assert.rejects(
      submitFeedback(input, 'alice', {
        db: database().db,
        webhook,
        fetcher: async (_url, options) => {
          calls++;
          assert.equal(options?.redirect, 'manual');
          return new Response(`Secret: ${webhook}`, {
            status: code,
            headers: { Location: 'https://untrusted.example/collect' },
          });
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.status, code === 429 ? 429 : 502);
        assert.ok(!error.message.includes('test-token'));
        return true;
      },
    );
    assert.equal(calls, 1, 'redirects must not be followed or retried');
  }
  await assert.rejects(
    submitFeedback(input, 'alice', {
      db: database().db,
      webhook,
      fetcher: async () => {
        throw new Error(`Network failure at ${webhook}`);
      },
    }),
    status(502),
  );
});

test('a shared delivery budget limits bursts across different accounts', async () => {
  let calls = 0;
  const config = {
    db: database().db,
    webhook,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 204 });
    },
  };
  for (let i = 0; i < 30; i++) await submitFeedback(input, `user-${i}`, config);
  await assert.rejects(submitFeedback(input, 'another-user', config), status(429));
  assert.equal(calls, 30);
});

test('failed deliveries release delivery quotas so a corrected service can be retried', async () => {
  const { db, sqlite } = database();
  let calls = 0;
  const config = {
    db,
    webhook,
    now: 123_456,
    fetcher: async () => {
      calls++;
      if (calls <= 3) throw new Error('Network failure');
      return new Response(null, { status: 204 });
    },
  };
  for (let i = 0; i < 3; i++)
    await assert.rejects(submitFeedback(input, 'alice', config), status(502));
  const failedCounts = sqlite
    .prepare(
      "SELECT count FROM security_limits WHERE key LIKE 'feedback-hour:%' OR key LIKE 'feedback-day:%'",
    )
    .all();
  assert.ok(failedCounts.every((row) => row.count === 0));
  assert.equal(
    sqlite.prepare("SELECT count FROM security_limits WHERE key = 'feedback-minute:2'").get()
      ?.count,
    3,
  );
  for (let i = 0; i < 3; i++) await submitFeedback(input, 'alice', config);
  assert.equal(calls, 6);
  assert.equal(
    sqlite.prepare("SELECT count FROM security_limits WHERE key LIKE 'feedback-hour:%'").get()
      ?.count,
    3,
  );
});

test('repeated delivery failures still have a short attempt cooldown', async () => {
  const { db, sqlite } = database();
  let calls = 0;
  const config = {
    db,
    webhook,
    now: 123_456,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 500 });
    },
  };
  for (let i = 0; i < 6; i++)
    await assert.rejects(submitFeedback(input, 'alice', config), status(502));
  await assert.rejects(
    submitFeedback(input, 'alice', config),
    (error) => error instanceof RateLimitError && error.retryAfter === 57,
  );
  assert.equal(calls, 6);
  assert.equal(
    sqlite.prepare("SELECT count FROM security_limits WHERE key LIKE 'feedback-day:%'").get()
      ?.count,
    0,
  );
  await assert.rejects(submitFeedback(input, 'alice', { ...config, now: 180_000 }), status(502));
  assert.equal(calls, 7, 'the minute cooldown expires independently of the delivery allowance');
});

test('a rejected later quota refunds previously reserved windows', async () => {
  for (const exhausted of ['day', 'global']) {
    const { db, sqlite } = database();
    const owner = await digestKey('alice');
    const key = exhausted === 'day' ? `feedback-day:${owner}:0` : 'feedback-minute:2';
    const maximum = exhausted === 'day' ? 100 : 30;
    sqlite.prepare('INSERT INTO security_limits VALUES (?, ?, ?)').run(key, maximum, 86_400_000);
    await assert.rejects(
      submitFeedback(input, 'alice', {
        db,
        webhook,
        now: 123_456,
        fetcher: async () => {
          throw new Error('Must not send');
        },
      }),
      (error) =>
        error instanceof RateLimitError && error.retryAfter === (exhausted === 'day' ? 86_277 : 57),
    );
    assert.equal(
      sqlite.prepare('SELECT count FROM security_limits WHERE key = ?').get(key)?.count,
      maximum,
    );
    assert.equal(
      sqlite.prepare("SELECT count FROM security_limits WHERE key LIKE 'feedback-hour:%'").get()
        ?.count,
      0,
    );
    if (exhausted === 'global') {
      assert.equal(
        sqlite.prepare("SELECT count FROM security_limits WHERE key LIKE 'feedback-day:%'").get()
          ?.count,
        0,
      );
    }
  }
});

test('concurrent submissions cannot overrun the delivery allowance', async () => {
  const { db, sqlite } = database();
  const owner = await digestKey('alice');
  sqlite
    .prepare('INSERT INTO security_limits VALUES (?, ?, ?)')
    .run(`feedback-hour:${owner}:0`, 17, 3_600_000);
  sqlite
    .prepare('INSERT INTO security_limits VALUES (?, ?, ?)')
    .run(`feedback-day:${owner}:0`, 17, 86_400_000);
  let calls = 0;
  const outcomes = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      submitFeedback(input, 'alice', {
        db,
        webhook,
        now: 123_456,
        fetcher: async () => {
          calls++;
          return new Response(null, { status: 204 });
        },
      }),
    ),
  );
  assert.equal(calls, 3);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 3);
  assert.equal(
    sqlite
      .prepare('SELECT count FROM security_limits WHERE key = ?')
      .get(`feedback-hour:${owner}:0`)?.count,
    20,
  );
  for (const result of outcomes) {
    if (result.status === 'rejected') assert.ok(result.reason instanceof RateLimitError);
  }
});

test('the shared attempt cap remains enforced across accounts during delivery failures', async () => {
  const { db, sqlite } = database();
  let calls = 0;
  const config = {
    db,
    webhook,
    now: 123_456,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 500 });
    },
  };
  for (let i = 0; i < 30; i++) {
    await assert.rejects(submitFeedback(input, `user-${i}`, config), status(502));
  }
  await assert.rejects(
    submitFeedback(input, 'another-user', config),
    (error) => error instanceof RateLimitError && error.retryAfter === 57,
  );
  assert.equal(calls, 30);
  const deliveryCounts = sqlite
    .prepare(
      "SELECT count FROM security_limits WHERE key LIKE 'feedback-hour:%' OR key LIKE 'feedback-day:%'",
    )
    .all();
  assert.ok(deliveryCounts.every((row) => row.count === 0));
});

test('Discord rate limits return only a bounded retry delay and refund the allowance', async () => {
  for (const [header, expected] of [
    ['2.5', 3],
    ['0', 60],
    ['invalid', 60],
    ['Infinity', 60],
    ['999999', 86_400],
  ] as const) {
    const { db, sqlite } = database();
    await assert.rejects(
      submitFeedback(input, 'alice', {
        db,
        webhook,
        now: 123_456,
        fetcher: async () =>
          new Response('private upstream detail', {
            status: 429,
            headers: { 'Retry-After': header },
          }),
      }),
      (error) =>
        error instanceof RateLimitError &&
        error.retryAfter === expected &&
        error.message === 'Feedback is busy. Please try again in a few minutes.',
    );
    assert.equal(
      sqlite.prepare("SELECT count FROM security_limits WHERE key LIKE 'feedback-hour:%'").get()
        ?.count,
      0,
    );
  }
});

test('response body cleanup cannot undo an already confirmed delivery', async () => {
  const { db, sqlite } = database();
  await submitFeedback(input, 'alice', {
    db,
    webhook,
    now: 123_456,
    fetcher: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            throw new Error('Cleanup failed');
          },
        }),
      ),
  });
  assert.equal(
    sqlite.prepare("SELECT count FROM security_limits WHERE key LIKE 'feedback-hour:%'").get()
      ?.count,
    1,
  );
});
