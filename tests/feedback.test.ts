import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { submitFeedback } from '../lib/feedback.ts';
import { AppError } from '../lib/app-error.ts';

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
  return db;
}
const status = (code: number) => (error: unknown) =>
  error instanceof AppError && error.status === code;

test('feedback sends only the message, disables mentions/previews and waits for confirmation', async () => {
  let calls = 0;
  await submitFeedback({ message: '  @everyone Please fix this.  ' }, 'private-user-id', {
    db: database(),
    webhook,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, `${webhook}?wait=true`);
      assert.equal(options?.method, 'POST');
      assert.equal(options?.redirect, 'error');
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
    db: database(),
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
  ]) {
    await assert.rejects(
      submitFeedback(input, 'alice', { ...config, webhook: value }),
      status(503),
    );
  }
  assert.equal(calls, 0);
});

test('feedback throttles repeated submissions per account before delivery', async () => {
  let calls = 0;
  const config = {
    db: database(),
    webhook,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 204 });
    },
  };
  for (let i = 0; i < 3; i++) await submitFeedback(input, 'alice', config);
  await assert.rejects(submitFeedback(input, 'alice', config), status(429));
  await submitFeedback(input, 'bob', config);
  assert.equal(calls, 4);
});

test('upstream failures never expose webhook credentials or response bodies', async () => {
  for (const code of [400, 401, 404, 500, 429]) {
    await assert.rejects(
      submitFeedback(input, 'alice', {
        db: database(),
        webhook,
        fetcher: async () => new Response(`Secret: ${webhook}`, { status: code }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.status, code === 429 ? 429 : 502);
        assert.ok(!error.message.includes('test-token'));
        return true;
      },
    );
  }
  await assert.rejects(
    submitFeedback(input, 'alice', {
      db: database(),
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
    db: database(),
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
