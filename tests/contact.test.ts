import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { submitContact } from '../lib/contact.ts';
import { AppError } from '../lib/app-error.ts';

const webhook = 'https://discord.com/api/webhooks/123/contact-test-token';
const origin = 'https://hosted.example';
const time = Date.UTC(2026, 9, 26, 12);
const sender = {
  userId: 'account-alice',
  email: 'alice@example.com',
  fullName: 'Alice Castro',
  displayName: 'Alice',
};
const input = {
  topic: 'domain',
  message: 'Please help me connect my domain.',
  spaceId: 'alice-space',
  locale: 'pt-BR',
};
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE security_limits (key TEXT PRIMARY KEY, count INTEGER, expires_at INTEGER);
    CREATE TABLE spaces (id TEXT PRIMARY KEY, user_id TEXT, handle TEXT, data TEXT);
    CREATE TABLE account_plans (user_id TEXT PRIMARY KEY, premium_until INTEGER);
    INSERT INTO spaces VALUES ('alice-space', 'account-alice', 'alice', '{"name":"Alice home"}');
    INSERT INTO spaces VALUES ('alice-other-space', 'account-alice', 'alice.work', '{"name":"Alice work"}');
    INSERT INTO spaces VALUES ('bob-space', 'account-bob', 'bob', '{"name":"Bob private space"}');
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

test('contact sends verified identity, owned space and stored plan in bounded metadata', async () => {
  const { db, sqlite } = database();
  sqlite.prepare('INSERT INTO account_plans VALUES (?, ?)').run(sender.userId, time + 60_000);
  let calls = 0;
  const result = await submitContact(input, sender, {
    db,
    webhook,
    origin,
    hostingMode: 'hosted',
    now: () => time,
    newReference: () => 'a8c7a994-7a5e-4ca0-a4f3-706d2c27b098',
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, `${webhook}?wait=true`);
      assert.equal(options?.method, 'POST');
      assert.equal(options?.redirect, 'manual');
      assert.ok(options?.signal instanceof AbortSignal);
      const body = JSON.parse(String(options?.body));
      assert.deepEqual(body.allowed_mentions, { parse: [] });
      assert.equal(body.content, undefined);
      assert.equal(
        body.flags,
        undefined,
        'SUPPRESS_EMBEDS would hide the deliberate metadata embeds',
      );
      assert.equal(body.embeds.length, 1);
      const embed = body.embeds[0];
      const fields = Object.fromEntries(
        embed.fields.map((field: { name: string; value: string }) => [field.name, field.value]),
      );
      assert.equal(embed.title, 'Support: Custom domain setup');
      assert.equal(embed.description, 'Please help me connect my domain\\.');
      assert.equal(embed.timestamp, new Date(time).toISOString());
      assert.equal(fields['Account ID'], 'account\\-alice');
      assert.equal(fields.Name, 'Alice Castro');
      assert.equal(fields['Display name'], 'Alice');
      assert.equal(fields.Email, 'alice@example\\.com');
      assert.equal(fields['Space ID'], 'alice\\-space');
      assert.equal(fields['Space name'], 'Alice home');
      assert.equal(fields.Handle, '@alice');
      assert.equal(fields.Plan, 'premium');
      assert.equal(fields.Hosting, 'hosted');
      assert.equal(fields.Language, 'pt-BR');
      assert.equal(fields.Site, 'https://hosted\\.example');
      assert.match(embed.footer.text, /a8c7a994-7a5e-4ca0-a4f3-706d2c27b098/);
      assert.equal(embed.url, undefined);
      assert.equal(embed.image, undefined);
      assert.equal(embed.thumbnail, undefined);
      assert.deepEqual(Object.keys(options?.headers ?? {}), ['Content-Type']);
      return Response.json({ id: '1234' });
    },
  });
  assert.deepEqual(result, { sent: true, reference: 'a8c7a994-7a5e-4ca0-a4f3-706d2c27b098' });
  assert.equal(calls, 1);
});

test('contact rejects forged metadata, malformed input and invalid configuration before delivery', async () => {
  let calls = 0;
  const config = {
    db: database().db,
    webhook,
    origin,
    fetcher: async () => {
      calls++;
      return Response.json({ id: '123' });
    },
  };
  for (const forged of [
    'email',
    'userId',
    'name',
    'fullName',
    'metadata',
    'plan',
    'hostingMode',
    'reference',
    'timestamp',
    'webhook',
    'headers',
  ])
    await assert.rejects(
      submitContact({ ...input, [forged]: 'forged' }, sender, config),
      status(400),
    );
  for (const malformed of [
    null,
    [],
    { ...input, topic: 'unknown' },
    { ...input, locale: 'fr' },
    { ...input, message: 'short' },
    { ...input, message: 'a'.repeat(1801) },
    { ...input, spaceId: '' },
    { ...input, spaceId: 'x'.repeat(201) },
  ])
    await assert.rejects(submitContact(malformed, sender, config), status(400));
  for (const invalid of [
    undefined,
    'http://discord.com/api/webhooks/123/token',
    'https://discord.com.evil.test/api/webhooks/123/token',
    `${webhook}?other=1`,
    `${webhook}\n`,
    ` ${webhook}`,
  ])
    await assert.rejects(
      submitContact(input, sender, { ...config, webhook: invalid }),
      status(503),
    );
  for (const invalid of ['file:///private/path', 'https://secret@hosted.example', 'invalid'])
    await assert.rejects(submitContact(input, sender, { ...config, origin: invalid }), status(503));
  assert.equal(calls, 0);
});

test('foreign and nonexistent spaces both return 404 without delivery or disclosure', async () => {
  let calls = 0;
  for (const spaceId of ['bob-space', 'nonexistent']) {
    await assert.rejects(
      submitContact({ ...input, spaceId }, sender, {
        db: database().db,
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
});

test('account-level contact does not choose a space and an expired plan is reported as Free', async () => {
  const { db, sqlite } = database();
  sqlite.prepare('INSERT INTO account_plans VALUES (?, ?)').run(sender.userId, time);
  await submitContact({ topic: 'account', message: 'Please help with my account.' }, sender, {
    db,
    webhook,
    origin,
    hostingMode: 'hosted',
    now: () => time,
    fetcher: async (_url, options) => {
      const fields = JSON.parse(String(options?.body)).embeds[0].fields;
      assert.ok(!fields.some((field: { name: string }) => field.name.startsWith('Space')));
      assert.equal(fields.find((field: { name: string }) => field.name === 'Plan').value, 'free');
      assert.equal(
        fields.find((field: { name: string }) => field.name === 'Language').value,
        'Not provided',
      );
      return Response.json({ id: '123' });
    },
  });
});

test('Markdown, mentions and pathological UTF-16 metadata remain within Discord embed limits', async () => {
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
  await submitContact(
    { ...input, topic: 'billing', spaceId, message: '*'.repeat(1800) },
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
        assert.equal(embed.description.length, 3600);
        assert.ok(embed.description.startsWith('\\*\\*'));
        assert.deepEqual(body.allowed_mentions, { parse: [] });
        assert.ok(embed.title.length <= 256);
        assert.ok(embed.description.length <= 4096);
        assert.ok(embed.fields.length <= 25);
        let count = embed.title.length + embed.description.length + embed.footer.text.length;
        for (const field of embed.fields) {
          assert.ok(field.name.length <= 256);
          assert.ok(field.value.length <= 1024);
          assert.ok(!/[\uD800-\uDBFF]$/.test(field.value));
          count += field.name.length + field.value.length;
        }
        assert.ok(count <= 6000, `Embed length ${count}`);
        return Response.json({ id: '123' });
      },
    },
  );
});

test('contact limits hourly, daily and cross-account delivery budgets', async () => {
  let calls = 0;
  const config = {
    db: database().db,
    webhook,
    origin,
    now: () => time,
    fetcher: async () => {
      calls++;
      return Response.json({ id: '123' });
    },
  };
  const accountInput = { topic: 'other', message: 'Please help with this issue.' };
  for (let i = 0; i < 3; i++) await submitContact(accountInput, sender, config);
  await assert.rejects(submitContact(accountInput, sender, config), status(429));
  assert.equal(calls, 3);

  const daily = database().db;
  for (let i = 0; i < 10; i++)
    await submitContact(accountInput, sender, {
      ...config,
      db: daily,
      now: () => time + Math.floor(i / 3) * 3_600_000,
    });
  await assert.rejects(
    submitContact(accountInput, sender, { ...config, db: daily, now: () => time + 4 * 3_600_000 }),
    status(429),
  );

  const shared = database().db;
  for (let i = 0; i < 30; i++)
    await submitContact(
      accountInput,
      { ...sender, userId: `account-${i}` },
      { ...config, db: shared },
    );
  await assert.rejects(
    submitContact(
      accountInput,
      { ...sender, userId: 'another-account' },
      { ...config, db: shared },
    ),
    status(429),
  );
});

test('upstream redirects, failures and timeout errors never reveal credentials or private response bodies', async () => {
  for (const code of [301, 302, 303, 307, 308, 400, 401, 403, 404, 429, 500]) {
    let calls = 0;
    await assert.rejects(
      submitContact(input, sender, {
        db: database().db,
        webhook,
        origin,
        fetcher: async (_url, options) => {
          calls++;
          assert.equal(options?.redirect, 'manual');
          return new Response(`Private body ${webhook} ${sender.email}`, {
            status: code,
            headers: { Location: 'https://untrusted.example/collect' },
          });
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.status, code === 429 ? 429 : 502);
        assert.ok(!error.message.includes('contact-test-token'));
        assert.ok(!error.message.includes(sender.email));
        return true;
      },
    );
    assert.equal(calls, 1, 'redirects must not be followed or retried');
  }
  await assert.rejects(
    submitContact(input, sender, {
      db: database().db,
      webhook,
      origin,
      fetcher: async () => {
        throw new Error(`Timed out at ${webhook}`);
      },
    }),
    status(502),
  );
});
