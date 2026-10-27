import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { submitReport } from '../lib/discord-report.ts';
import { AppError } from '../lib/app-error.ts';
import { digestKey, RateLimitError } from '../lib/abuse-limits.ts';

const webhook = 'https://discord.com/api/webhooks/123/test-token';
const quotaPrefix = `report:${await digestKey(webhook)}`;
const otherWebhook = 'https://discord.com/api/webhooks/456/other-test-token';
const input = { message: 'Please add more profile themes.' };
const origin = 'https://hosted.example';
const time = Date.UTC(2026, 9, 26, 12);
const reporter = (userId = 'alice') => ({
  userId,
  displayName: 'Alice',
  fullName: 'Alice Castro',
  email: 'alice@example.com',
});
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE security_limits (key TEXT PRIMARY KEY, count INTEGER, expires_at INTEGER);
    CREATE TABLE spaces (id TEXT PRIMARY KEY, user_id TEXT, handle TEXT, data TEXT);
    CREATE TABLE account_plans (user_id TEXT PRIMARY KEY, premium_until INTEGER);
    INSERT INTO spaces VALUES ('alice-space', 'alice', 'alice', '{"name":"Alice home"}');
    INSERT INTO spaces VALUES ('alice-other-space', 'alice', 'alice.work', '{"name":"Alice work"}');
    INSERT INTO spaces VALUES ('bob-space', 'bob', 'bob', '{"name":"Bob private space"}');
  `);
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

test('report formats verified reporter, owned space and plan with a timestamp and reference', async () => {
  const { db, sqlite } = database();
  sqlite.prepare('INSERT INTO account_plans VALUES (?, ?)').run('alice', time + 60_000);
  const sender = {
    ...reporter(),
    accessToken: 'private-session-token',
    headers: 'private-cookies',
  };
  const reference = 'a8c7a994-7a5e-4ca0-a4f3-706d2c27b098';
  let calls = 0;
  const result = await submitReport(
    { message: '  @everyone Please fix this.  ', spaceId: 'alice-space', locale: 'pt-BR' },
    sender,
    {
      db,
      webhook,
      origin: `${origin}/dashboard?private=never-forward`,
      hostingMode: 'hosted',
      now: time,
      newReference: () => reference,
      fetcher: async (url, options) => {
        calls++;
        assert.equal(url, `${webhook}?wait=true`);
        assert.equal(options?.method, 'POST');
        assert.equal(options?.redirect, 'manual');
        assert.ok(options?.signal instanceof AbortSignal);
        assert.deepEqual(Object.keys(options?.headers ?? {}), ['Content-Type']);
        const body = JSON.parse(String(options?.body));
        assert.equal(body.username, 'wya.im');
        assert.deepEqual(body.allowed_mentions, { parse: [] });
        assert.equal(body.content, undefined);
        assert.equal(body.flags, undefined, 'SUPPRESS_EMBEDS would hide the metadata');
        assert.equal(body.embeds.length, 1);
        const embed = body.embeds[0];
        const fields = Object.fromEntries(
          embed.fields.map((field: { name: string; value: string }) => [field.name, field.value]),
        );
        assert.equal(embed.title, 'New message');
        assert.equal(embed.description, '@everyone Please fix this\\.');
        assert.equal(embed.timestamp, new Date(time).toISOString());
        assert.equal(embed.footer.text, `Reference ${reference}`);
        assert.deepEqual(fields, {
          Reporter: 'Alice Castro',
          'Display name': 'Alice',
          Email: 'alice@example\\.com',
          'Account ID': 'alice',
          Hosting: 'hosted',
          Plan: 'premium',
          Language: 'pt-BR',
          Site: 'https://hosted\\.example',
          'Space name': 'Alice home',
          Handle: '@alice',
          'Space ID': 'alice\\-space',
        });
        for (const secret of [
          'private-session-token',
          'private-cookies',
          'never-forward',
          'test-token',
        ]) {
          assert.ok(!String(options?.body).includes(secret));
        }
        assert.equal(embed.image, undefined);
        assert.equal(embed.thumbnail, undefined);
        return Response.json({ id: 'message-id' });
      },
    },
  );
  assert.deepEqual(result, { sent: true, reference });
  assert.equal(calls, 1);
});

test('changing the destination changes only the webhook URL, with optional topic treated as report data', async () => {
  const { db } = database();
  const reference = 'a8c7a994-7a5e-4ca0-a4f3-706d2c27b098';
  for (const [topic, label] of [
    [undefined, undefined],
    ['account', 'Account access'],
    ['billing', 'Billing and payments'],
    ['domain', 'Custom domain setup'],
    ['other', 'Something else'],
  ]) {
    const bodies: unknown[] = [];
    const destinations: string[] = [];
    for (const destination of [webhook, otherWebhook]) {
      const result = await submitReport(
        { ...input, spaceId: 'alice-space', locale: 'pt-BR', ...(topic ? { topic } : {}) },
        reporter(),
        {
          db,
          webhook: destination,
          origin,
          now: time,
          newReference: () => reference,
          fetcher: async (url, options) => {
            destinations.push(String(url));
            const body = JSON.parse(String(options?.body));
            bodies.push(body);
            assert.equal(body.username, 'wya.im');
            assert.equal(body.embeds[0].title, 'New message');
            const topicField = body.embeds[0].fields.find(
              (field: { name: string }) => field.name === 'Topic',
            );
            assert.equal(topicField?.value, label);
            return Response.json({ id: 'mock-message' });
          },
        },
      );
      assert.deepEqual(result, { sent: true, reference });
    }
    assert.deepEqual(destinations, [`${webhook}?wait=true`, `${otherWebhook}?wait=true`]);
    assert.deepEqual(bodies[0], bodies[1]);
  }
});

test('per-account cooldown follows the destination, and a topic cannot bypass it', async () => {
  const { db, sqlite } = database();
  let calls = 0;
  const config = {
    db,
    webhook,
    origin,
    now: time,
    fetcher: async () => {
      calls++;
      return Response.json({ id: 'mock-message' });
    },
  };
  for (let i = 0; i < 6; i++) await submitReport(input, reporter(), config);
  await assert.rejects(
    submitReport({ ...input, topic: 'domain' }, reporter(), { ...config }),
    status(429),
  );
  await submitReport(input, reporter(), { ...config, webhook: otherWebhook });
  assert.equal(calls, 7);
  const keys = sqlite.prepare('SELECT key FROM security_limits').all();
  assert.ok(keys.every((row) => !String(row.key).includes('test-token')));
});

test('the global burst budget is isolated between destination webhooks', async () => {
  let calls = 0;
  const config = {
    db: database().db,
    webhook,
    origin,
    now: time,
    fetcher: async () => {
      calls++;
      return Response.json({ id: 'mock-message' });
    },
  };
  for (let i = 0; i < 30; i++) await submitReport(input, reporter(`user-${i}`), config);
  await assert.rejects(submitReport(input, reporter('another-user'), config), status(429));
  await submitReport(input, reporter('another-user'), { ...config, webhook: otherWebhook });
  assert.equal(calls, 31);
});

test('forged metadata, malformed input and invalid configuration use no quota or network', async () => {
  const { db, sqlite } = database();
  let calls = 0;
  const config = {
    db,
    webhook,
    origin,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 204 });
    },
  };
  for (const message of ['', '    ', 'short', 'a'.repeat(1801), null]) {
    await assert.rejects(submitReport({ message }, reporter(), config), status(400));
  }
  for (const field of [
    'email',
    'userId',
    'name',
    'displayName',
    'fullName',
    'metadata',
    'plan',
    'hostingMode',
    'reference',
    'timestamp',
    'webhook',
    'headers',
  ]) {
    await assert.rejects(
      submitReport({ ...input, [field]: 'forged' }, reporter(), config),
      status(400),
    );
  }
  for (const malformed of [
    null,
    [],
    { ...input, locale: 'fr' },
    { ...input, topic: 'unknown' },
    { ...input, topic: '' },
    { ...input, topic: null },
    { ...input, spaceId: '' },
    { ...input, spaceId: ' ' },
    { ...input, spaceId: 'x'.repeat(201) },
  ]) {
    await assert.rejects(submitReport(malformed, reporter(), config), status(400));
  }
  for (const value of [
    undefined,
    'http://discord.com/api/webhooks/123/token',
    'https://evil.test/api/webhooks/123/token',
    'https://discord.com.evil.test/api/webhooks/123/token',
    `${webhook}?redirect=1`,
    `${webhook}\n`,
    ` ${webhook}`,
  ]) {
    await assert.rejects(
      submitReport(input, reporter(), { ...config, webhook: value }),
      (error: unknown) =>
        error instanceof AppError &&
        error.status === 503 &&
        error.message === 'Messaging is unavailable. Please email support@wya.im.',
    );
  }
  for (const value of ['file:///private/path', 'https://secret@hosted.example', 'invalid']) {
    await assert.rejects(
      submitReport(input, reporter(), { ...config, origin: value }),
      status(503),
    );
  }
  assert.equal(calls, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM security_limits').get()?.count, 0);
});

test('foreign and nonexistent report spaces both return 404 before quota or delivery', async () => {
  const { db, sqlite } = database();
  let calls = 0;
  for (const spaceId of ['bob-space', 'nonexistent']) {
    await assert.rejects(
      submitReport({ ...input, spaceId }, reporter(), {
        db,
        webhook,
        origin,
        fetcher: async () => {
          calls++;
          return Response.json({ id: '123' });
        },
      }),
      (error: unknown) =>
        error instanceof AppError && error.status === 404 && error.message === 'Space not found.',
    );
  }
  assert.equal(calls, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM security_limits').get()?.count, 0);
});

test('account report does not pick an arbitrary space and uses the current stored entitlement', async () => {
  const { db, sqlite } = database();
  sqlite.prepare('INSERT INTO account_plans VALUES (?, ?)').run('alice', time);
  await submitReport(
    input,
    { ...reporter(), fullName: null },
    {
      db,
      webhook,
      origin,
      hostingMode: 'hosted',
      now: time,
      fetcher: async (_url, options) => {
        const fields = JSON.parse(String(options?.body)).embeds[0].fields;
        assert.ok(
          !fields.some(
            (field: { name: string }) => field.name.startsWith('Space') || field.name === 'Handle',
          ),
        );
        const values = Object.fromEntries(
          fields.map((field: { name: string; value: string }) => [field.name, field.value]),
        );
        assert.equal(values.Reporter, 'Alice');
        assert.equal(values.Plan, 'free');
        assert.equal(values.Language, 'Not provided');
        return Response.json({ id: '123' });
      },
    },
  );
});

test('report includes self-hosted access without requiring a billing table', async () => {
  const { db, sqlite } = database();
  sqlite.exec('DROP TABLE account_plans');
  await submitReport({ ...input, spaceId: ' alice-other-space ' }, reporter(), {
    db,
    webhook,
    origin,
    hostingMode: 'self-hosted',
    fetcher: async (_url, options) => {
      const fields = JSON.parse(String(options?.body)).embeds[0].fields;
      const values = Object.fromEntries(
        fields.map((field: { name: string; value: string }) => [field.name, field.value]),
      );
      assert.equal(values.Hosting, 'self-hosted');
      assert.equal(values.Plan, 'All features included');
      assert.equal(values['Space name'], 'Alice work');
      assert.equal(values.Handle, '@alice\\.work');
      assert.equal(values['Space ID'], 'alice\\-other\\-space');
      return Response.json({ id: '123' });
    },
  });
});

test('report Markdown and pathological UTF-16 metadata stay inside Discord limits', async () => {
  const { db, sqlite } = database();
  const pathological = '😀\\`*_[]@everyone'.repeat(500);
  const spaceId = '*'.repeat(200);
  sqlite
    .prepare('UPDATE spaces SET id=?,user_id=?,handle=?,data=? WHERE id=?')
    .run(
      spaceId,
      pathological,
      pathological,
      JSON.stringify({ name: pathological }),
      'alice-space',
    );
  await submitReport(
    { message: '*'.repeat(1800), spaceId, locale: 'pt-BR', topic: 'billing' },
    {
      userId: pathological,
      fullName: pathological,
      displayName: pathological,
      email: pathological,
    },
    {
      db,
      webhook,
      origin: `https://${'a'.repeat(220)}.example`,
      fetcher: async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        const embed = body.embeds[0];
        assert.deepEqual(body.allowed_mentions, { parse: [] });
        assert.equal(embed.description.length, 3600);
        assert.ok(embed.description.startsWith('\\*\\*'));
        assert.ok(embed.title.length <= 256);
        assert.ok(embed.description.length <= 4096);
        assert.ok(embed.fields.length <= 25);
        let size = embed.title.length + embed.description.length + embed.footer.text.length;
        for (const field of embed.fields) {
          assert.ok(field.name.length <= 256);
          assert.ok(field.value.length > 0 && field.value.length <= 1024);
          assert.ok(!/[\uD800-\uDBFF]$/.test(field.value));
          size += field.name.length + field.value.length;
        }
        assert.ok(size <= 6000, `Embed length ${size}`);
        return Response.json({ id: '123' });
      },
    },
  );
});

test('report permits 20 deliveries per hour and rejects the next before delivery', async () => {
  let calls = 0;
  const config = {
    db: database().db,
    webhook,
    origin,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 204 });
    },
  };
  for (let i = 0; i < 20; i++) {
    await submitReport(input, reporter(), { ...config, now: i * 60_000 + 1000 });
  }
  await assert.rejects(
    submitReport(input, reporter(), { ...config, now: 20 * 60_000 + 1000 }),
    (error) => error instanceof RateLimitError && error.retryAfter === 2399,
  );
  assert.equal(calls, 20);
  await submitReport(input, reporter('bob'), { ...config, now: 20 * 60_000 + 1000 });
  await submitReport(input, reporter(), { ...config, now: 3_600_000 });
  assert.equal(calls, 22, 'another account and the next hour each have an allowance');
});

test('report permits 100 deliveries per day across hours and rejects the next', async () => {
  let calls = 0;
  const config = {
    db: database().db,
    webhook,
    origin,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 204 });
    },
  };
  for (let i = 0; i < 100; i++) {
    const now = Math.floor(i / 20) * 3_600_000 + (i % 20) * 60_000 + 1000;
    await submitReport(input, reporter(), { ...config, now });
  }
  await assert.rejects(
    submitReport(input, reporter(), { ...config, now: 5 * 3_600_000 + 1000 }),
    (error) => error instanceof RateLimitError && error.retryAfter === 68_399,
  );
  assert.equal(calls, 100);
  await submitReport(input, reporter(), { ...config, now: 86_400_000 + 1000 });
  assert.equal(calls, 101, 'the next day restores the allowance');
});

test('upstream redirects and failures never expose webhook credentials or response bodies', async () => {
  for (const code of [301, 302, 303, 307, 308, 400, 401, 403, 404, 500, 429]) {
    let calls = 0;
    await assert.rejects(
      submitReport(input, reporter(), {
        db: database().db,
        webhook,
        origin,
        fetcher: async (_url, options) => {
          calls++;
          assert.equal(options?.redirect, 'manual');
          return new Response(`Secret: ${webhook} ${reporter().email}`, {
            status: code,
            headers: { Location: 'https://untrusted.example/collect' },
          });
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.status, code === 429 ? 429 : 502);
        assert.ok(!error.message.includes('test-token'));
        assert.ok(!error.message.includes(reporter().email));
        return true;
      },
    );
    assert.equal(calls, 1, 'redirects must not be followed or retried');
  }
  await assert.rejects(
    submitReport(input, reporter(), {
      db: database().db,
      webhook,
      origin,
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
    origin,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 204 });
    },
  };
  for (let i = 0; i < 30; i++) await submitReport(input, reporter(`user-${i}`), config);
  await assert.rejects(submitReport(input, reporter('another-user'), config), status(429));
  assert.equal(calls, 30);
});

test('failed deliveries release delivery quotas so a corrected service can be retried', async () => {
  const { db, sqlite } = database();
  let calls = 0;
  const config = {
    db,
    webhook,
    origin,
    now: 123_456,
    fetcher: async () => {
      calls++;
      if (calls <= 3) throw new Error('Network failure');
      return new Response(null, { status: 204 });
    },
  };
  for (let i = 0; i < 3; i++)
    await assert.rejects(submitReport(input, reporter(), config), status(502));
  const failedCounts = sqlite
    .prepare(
      "SELECT count FROM security_limits WHERE key LIKE 'report:%:hour:%' OR key LIKE 'report:%:day:%'",
    )
    .all();
  assert.ok(failedCounts.every((row) => row.count === 0));
  assert.equal(
    sqlite.prepare('SELECT count FROM security_limits WHERE key = ?').get(`${quotaPrefix}:minute:2`)
      ?.count,
    3,
  );
  for (let i = 0; i < 3; i++) await submitReport(input, reporter(), config);
  assert.equal(calls, 6);
  assert.equal(
    sqlite.prepare("SELECT count FROM security_limits WHERE key LIKE 'report:%:hour:%'").get()
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
    origin,
    now: 123_456,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 500 });
    },
  };
  for (let i = 0; i < 6; i++)
    await assert.rejects(submitReport(input, reporter(), config), status(502));
  await assert.rejects(
    submitReport(input, reporter(), config),
    (error) => error instanceof RateLimitError && error.retryAfter === 57,
  );
  assert.equal(calls, 6);
  assert.equal(
    sqlite.prepare("SELECT count FROM security_limits WHERE key LIKE 'report:%:day:%'").get()
      ?.count,
    0,
  );
  await assert.rejects(submitReport(input, reporter(), { ...config, now: 180_000 }), status(502));
  assert.equal(calls, 7, 'the minute cooldown expires independently of the delivery allowance');
});

test('a rejected later quota refunds previously reserved windows', async () => {
  for (const exhausted of ['day', 'global']) {
    const { db, sqlite } = database();
    const owner = await digestKey('alice');
    const key = exhausted === 'day' ? `${quotaPrefix}:day:${owner}:0` : `${quotaPrefix}:minute:2`;
    const maximum = exhausted === 'day' ? 100 : 30;
    sqlite.prepare('INSERT INTO security_limits VALUES (?, ?, ?)').run(key, maximum, 86_400_000);
    await assert.rejects(
      submitReport(input, reporter(), {
        db,
        webhook,
        origin,
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
      sqlite.prepare("SELECT count FROM security_limits WHERE key LIKE 'report:%:hour:%'").get()
        ?.count,
      0,
    );
    if (exhausted === 'global') {
      assert.equal(
        sqlite.prepare("SELECT count FROM security_limits WHERE key LIKE 'report:%:day:%'").get()
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
    .run(`${quotaPrefix}:hour:${owner}:0`, 17, 3_600_000);
  sqlite
    .prepare('INSERT INTO security_limits VALUES (?, ?, ?)')
    .run(`${quotaPrefix}:day:${owner}:0`, 17, 86_400_000);
  let calls = 0;
  const outcomes = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      submitReport(input, reporter(), {
        db,
        webhook,
        origin,
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
      .get(`${quotaPrefix}:hour:${owner}:0`)?.count,
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
    origin,
    now: 123_456,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 500 });
    },
  };
  for (let i = 0; i < 30; i++) {
    await assert.rejects(submitReport(input, reporter(`user-${i}`), config), status(502));
  }
  await assert.rejects(
    submitReport(input, reporter('another-user'), config),
    (error) => error instanceof RateLimitError && error.retryAfter === 57,
  );
  assert.equal(calls, 30);
  const deliveryCounts = sqlite
    .prepare(
      "SELECT count FROM security_limits WHERE key LIKE 'report:%:hour:%' OR key LIKE 'report:%:day:%'",
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
      submitReport(input, reporter(), {
        db,
        webhook,
        origin,
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
        error.message === 'Messaging is busy. Please try again in a few minutes.',
    );
    assert.equal(
      sqlite.prepare("SELECT count FROM security_limits WHERE key LIKE 'report:%:hour:%'").get()
        ?.count,
      0,
    );
  }
});

test('response body cleanup cannot undo an already confirmed delivery', async () => {
  const { db, sqlite } = database();
  await submitReport(input, reporter(), {
    db,
    webhook,
    origin,
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
    sqlite.prepare("SELECT count FROM security_limits WHERE key LIKE 'report:%:hour:%'").get()
      ?.count,
    1,
  );
});
