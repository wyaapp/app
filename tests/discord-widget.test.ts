import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDiscordWidgetClient,
  parseDiscordWidget,
  publicDiscordGuild,
  DiscordWidgetError,
} from '../lib/discord-widget.ts';
import { parseDiscordSource, DISCORD_CACHE_SECONDS } from '../lib/discord-widget-types.ts';
import { actionSchema, applyAction, type ProfileData, type Profile } from '../lib/model.ts';
import { exportTab, prepareTabImport } from '../lib/tab-transfer.ts';
import { resolveLinkDestination } from '../lib/link-redirects.ts';
import { withoutHiddenTabs } from '../lib/profile-tabs.ts';

const id = '123456789012345678';
const fixture = () => ({
  id,
  name: 'Example community',
  presence_count: 42,
  instant_invite: 'https://discord.gg/example',
  channels: [{ id: '123456789012345679', name: 'Voice', position: 2 }],
  members: [
    {
      id: '0',
      username: 'Example member',
      status: 'idle',
      avatar_url: 'https://cdn.discordapp.com/widget-avatars/example/image',
      channel_id: '123456789012345679',
      game: { name: 'A game' },
    },
    { id: '1', username: 'Another member', status: 'online' },
  ],
});
const base: ProfileData = { name: 'Example', bio: '', theme: 'lilac', links: [] };
const action = {
  action: 'upsert_discord',
  expectedVersion: 1,
  slug: 'community',
  guildId: id,
  label: 'Community',
};
const change = (data: ProfileData, input: object) =>
  applyAction(data, actionSchema.parse(input)).data;
const profile = (data: ProfileData): Profile => ({
  ...data,
  id: 'space',
  handle: 'example',
  aliases: [],
  version: 1,
  updatedAt: '',
});

test('Discord source accepts only numeric IDs and exact HTTPS widget URLs', () => {
  for (const value of [
    id,
    ` https://discord.com/api/guilds/${id}/widget.json `,
    `https://discord.com/api/v10/guilds/${id}/widget.json`,
  ])
    assert.equal(parseDiscordSource(value), id);
  for (const value of [
    '',
    '1',
    '0'.repeat(18),
    '9'.repeat(21),
    `http://discord.com/api/guilds/${id}/widget.json`,
    `https://discord.com.evil.example/api/guilds/${id}/widget.json`,
    `https://user:secret@discord.com/api/guilds/${id}/widget.json`,
    `https://discord.com:8443/api/guilds/${id}/widget.json`,
    `https://discord.com/api/guilds/${id}/widget.json?redirect=evil`,
    'https://discord.gg/example',
    'http://127.0.0.1/',
    `<iframe src="https://discord.com/widget?id=${id}"></iframe>`,
  ])
    assert.equal(parseDiscordSource(value), null, value);
});

test('Discord data keeps the full presence count and strips unwanted fields and unsafe URLs', () => {
  const raw = { ...fixture(), secret: 'not retained' };
  const data = parseDiscordWidget(raw, id);
  assert.equal(data.online, 42);
  assert.equal(data.members.length, 2);
  assert.equal(data.members[0].activity, 'A game');
  assert.equal(data.members[0].avatarUrl, raw.members[0].avatar_url);
  assert.equal('secret' in data, false);
  for (const url of [
    'javascript:alert(1)',
    'https://discord.com.evil.test/invite/yes',
    'https://user:pass@discord.gg/example',
    'https://example.com/',
  ]) {
    raw.instant_invite = url;
    raw.members[0].avatar_url = url;
    const sanitized = parseDiscordWidget(raw, id);
    assert.equal(sanitized.inviteUrl, null);
    assert.equal(sanitized.members[0].avatarUrl, undefined);
  }
  assert.throws(() => parseDiscordWidget({ ...fixture(), id: '123456789012345680' }, id));
  assert.throws(() => parseDiscordWidget({ ...fixture(), presence_count: -1 }, id));
  assert.throws(() =>
    parseDiscordWidget({ ...fixture(), members: Array(101).fill(fixture().members[0]) }, id),
  );
  assert.throws(() => parseDiscordWidget({}, id));
});

test('Discord cache coalesces requests and expires after exactly 15 minutes', async () => {
  let calls = 0,
    time = 0;
  const client = createDiscordWidgetClient({
    now: () => time,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(String(url), `https://discord.com/api/v10/guilds/${id}/widget.json`);
      assert.equal(options?.redirect, 'manual');
      assert.ok(options?.signal);
      assert.equal((options?.headers as Record<string, string>).Authorization, undefined);
      return Response.json(fixture());
    },
  });
  const result = await Promise.all([client.get(id), client.get(id), client.get(id)]);
  assert.equal(calls, 1);
  assert.deepEqual(result[0], result[1]);
  time = DISCORD_CACHE_SECONDS * 1000 - 1;
  await client.get(id);
  assert.equal(calls, 1);
  time++;
  await client.get(id);
  assert.equal(calls, 2);
  await assert.rejects(() => client.get('http://localhost'), /valid Discord/);
  assert.equal(calls, 2);
});

test('shared edge cache reuses data across clients without extending its lifetime', async () => {
  let calls = 0,
    time = 0;
  const entries = new Map<string, Response>();
  const cache = {
    async match(key: string) {
      return entries.get(key)?.clone();
    },
    async put(key: string, response: Response) {
      assert.equal(response.headers.get('cache-control'), 'public, max-age=900');
      entries.set(key, response);
    },
  };
  const options = {
    cache,
    now: () => time,
    fetcher: async () => {
      calls++;
      return Response.json(fixture());
    },
  };
  await createDiscordWidgetClient(options).get(id);
  time = 899_000;
  const second = createDiscordWidgetClient(options);
  await second.get(id);
  assert.equal(calls, 1);
  time = 900_000;
  await second.get(id);
  assert.equal(calls, 2);
});

test('disabled widgets and outages are distinguished, briefly cached, and never shown as zero online', async () => {
  let time = 0,
    calls = 0;
  const client = createDiscordWidgetClient({
    now: () => time,
    fetcher: async () => {
      calls++;
      return calls === 1
        ? Response.json({ code: 50004 }, { status: 403 })
        : Response.json(fixture());
    },
  });
  await assert.rejects(
    client.get(id),
    (error) => error instanceof DiscordWidgetError && error.code === 'disabled',
  );
  await assert.rejects(client.get(id));
  assert.equal(calls, 1);
  time = 30_000;
  assert.equal((await client.get(id)).online, 42);
  const outage = createDiscordWidgetClient({
    fetcher: async () => new Response('<html>Unavailable</html>', { status: 502 }),
  });
  await assert.rejects(
    outage.get(id),
    (error) => error instanceof DiscordWidgetError && error.code === 'unavailable',
  );
});

test('expired member data is not retained through outages or disabling the widget', async () => {
  let time = 0;
  const client = createDiscordWidgetClient({
    now: () => time,
    fetcher: async () =>
      time === 0 ? Response.json(fixture()) : Response.json({ code: 50004 }, { status: 403 }),
  });
  await client.get(id);
  time = 900_000;
  await assert.rejects(
    client.get(id),
    (error) => error instanceof DiscordWidgetError && error.code === 'disabled',
  );
});

test('Discord rate limits suppress other upstream requests for Retry-After', async () => {
  let time = 0,
    calls = 0;
  const client = createDiscordWidgetClient({
    now: () => time,
    fetcher: async () => {
      calls++;
      return calls === 1
        ? new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
        : Response.json(fixture());
    },
  });
  await assert.rejects(client.get(id));
  time = 31_000;
  await assert.rejects(client.get('123456789012345680'));
  assert.equal(calls, 1);
  time = 60_000;
  await client.get(id);
  assert.equal(calls, 2);
});

test('oversized and redirected Discord responses fail closed; cache outages do not block successful data', async () => {
  for (const response of [
    new Response('x'.repeat(256_001)),
    new Response(null, { status: 302, headers: { Location: 'http://localhost' } }),
  ])
    await assert.rejects(createDiscordWidgetClient({ fetcher: async () => response }).get(id));
  const client = createDiscordWidgetClient({
    cache: {
      match: async () => {
        throw new Error('offline');
      },
      put: async () => {
        throw new Error('offline');
      },
    },
    fetcher: async () => Response.json(fixture()),
  });
  assert.equal((await client.get(id)).online, 42);
});

test('Discord items preserve identity, placement, visibility and aliases across edits', async () => {
  let data = change(base, { ...action, aliases: ['chat'] });
  const originalId = data.links[0].id;
  assert.equal(data.links[0].visible, false);
  assert.throws(() => publicDiscordGuild(profile(data), 'chat'), /unavailable/);
  data = change(data, { ...action, originalSlug: 'community', slug: 'server', visible: true });
  assert.equal(data.links[0].id, originalId);
  assert.deepEqual(data.links[0].aliases, ['chat']);
  assert.equal(publicDiscordGuild(profile(data), 'chat'), id);
  assert.equal(
    await resolveLinkDestination(profile(data), 'chat', async () => null),
    `https://wya.im/example#widget-${originalId}`,
  );
  data = change(data, {
    action: 'set_tabs',
    expectedVersion: 1,
    defaultTabId: 'home',
    tabs: [
      { id: 'home', title: 'Home', slug: 'home', ungrouped: [], sections: [] },
      {
        id: 'private',
        title: 'Private',
        slug: 'private',
        hidden: true,
        ungrouped: ['server'],
        sections: [],
      },
    ],
  });
  assert.throws(() => publicDiscordGuild(profile(data), 'server'), /unavailable/);
  assert.throws(() => publicDiscordGuild(profile(data), 'chat'), /unavailable/);
  await assert.rejects(
    resolveLinkDestination(withoutHiddenTabs(profile(data)), 'chat', async () => null),
    /unavailable/,
  );
  data = change(data, { ...action, originalSlug: 'server', slug: 'renamed' });
  assert.deepEqual(data.tabs?.[1].ungrouped, ['renamed']);
});

test('Discord import/export retains configuration only and rejects invalid IDs and type overwrites', () => {
  const data = change(base, action);
  const file = exportTab(data, 'home');
  assert.deepEqual(file.items[0], {
    kind: 'discord',
    discord: { guildId: id },
    slug: 'community',
    label: 'Community',
    platform: 'discord',
    url: '',
    visible: false,
  });
  const imported = prepareTabImport(base, file);
  assert.deepEqual(imported.data.links[0].discord, { guildId: id });
  assert.notEqual(imported.data.links[0].id, data.links[0].id);
  assert.throws(() => change(base, { ...action, guildId: 'http://localhost' }));
  assert.throws(() =>
    prepareTabImport(base, {
      ...file,
      items: [{ ...file.items[0], discord: { guildId: id, members: [] } }],
    }),
  );
  assert.throws(() => change(data, { ...action, createOnly: true }), /already used/);
  assert.throws(
    () => change(data, { ...action, slug: 'new', aliases: ['community'] }),
    /already used/,
  );
  assert.throws(
    () =>
      change(data, {
        action: 'upsert_link',
        expectedVersion: 1,
        slug: 'community',
        label: 'Link',
        platform: 'website',
        destination: 'https://example.com',
      }),
    /matching editor/,
  );
  assert.throws(() => change(base, { ...action, tabId: 'missing' }), /Tab not found/);
  const many = {
    ...base,
    links: Array.from({ length: 100 }, (_, i) => ({ ...data.links[0], slug: `item${i}` })),
  };
  assert.throws(() => change(many, action), /100 items/);
});
