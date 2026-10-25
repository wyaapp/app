import test from 'node:test';
import assert from 'node:assert/strict';
import { actionSchema } from '../lib/profile-action-schema.ts';
import { applyAction } from '../lib/profile-actions.ts';
import { compilePageDocument } from '../lib/page-document-actions.ts';
import { getPageSource, parsePageSource, serializePageItem } from '../lib/page-documents.ts';
import { AppError } from '../lib/app-error.ts';
import { visibleProfile } from '../lib/public-profile.ts';
import { findVisibleLink } from '../lib/profile-links.ts';
import { resolveLinkDestination } from '../lib/link-redirects.ts';
import type { Profile, ProfileData } from '../lib/profile-types.ts';

const base: ProfileData = {
  name: 'Alex',
  bio: '',
  theme: 'lilac',
  links: [
    {
      slug: 'code',
      aliases: ['repo'],
      label: 'Code',
      platform: 'github',
      url: 'https://github.com/alex',
      visible: true,
    },
    {
      id: 'hidden-link',
      slug: 'secret',
      label: 'Secret',
      platform: 'website',
      url: 'https://secret.example/',
      visible: false,
    },
    {
      id: 'community',
      kind: 'discord',
      slug: 'discord',
      label: 'Community',
      platform: 'discord',
      url: '',
      visible: true,
      discord: { guildId: '771498135188799500' },
    },
    {
      id: 'games',
      kind: 'collection',
      slug: 'games',
      label: 'Games',
      platform: 'website',
      icon: 'gamepad',
      url: '',
      visible: true,
      collection: {
        type: 'game',
        items: [
          {
            id: 'game-one',
            kind: 'interest',
            slug: 'one',
            label: 'Game one',
            platform: 'website',
            url: 'https://game.example/',
            visible: true,
            interest: { type: 'game', note: 'A note', favorite: true, buttons: [] },
          },
          {
            id: 'game-hidden',
            kind: 'interest',
            slug: 'hidden-game',
            label: 'Private game',
            platform: 'website',
            url: 'https://private-game.example/',
            visible: false,
            interest: { type: 'game', note: 'Private note', favorite: false, buttons: [] },
          },
        ],
      },
    },
    {
      id: 'other-id',
      slug: 'other',
      label: 'Other',
      platform: 'website',
      url: 'https://other.example/',
      visible: true,
    },
  ],
  tabs: [
    {
      id: 'home',
      title: 'Links',
      slug: 'links',
      ungrouped: ['secret', 'discord', 'games'],
      sections: [{ id: 'socials', title: 'Socials', slugs: ['code'] }],
    },
    { id: 'other', title: 'Other', slug: 'other', ungrouped: ['other'], sections: [] },
  ],
  defaultTabId: 'home',
};
const profile = (data: ProfileData): Profile => ({
  ...data,
  id: 'space',
  handle: 'alex',
  aliases: [],
  version: 1,
  updatedAt: 'now',
});

test('page appearance publishes with document content without changing identities or redirects', async () => {
  const source = '# Hello\n\n' + getPageSource(base, 'home');
  const original = compilePageDocument(base, 'home', source);
  const appearance = { theme: 'dim', accent: 'ink', headingFont: 'serif' } as const;
  const saved = applyAction(
    base,
    actionSchema.parse({
      action: 'publish_document',
      expectedVersion: 1,
      tabId: 'home',
      source,
      appearance,
    }),
  ).data;
  assert.deepEqual(saved.tabs![0].appearance, appearance);
  assert.deepEqual(saved.links, original.links);
  assert.deepEqual(saved.documents, original.documents);
  assert.equal(
    await resolveLinkDestination(profile(saved), 'repo', async () => null),
    'https://github.com/alex',
  );
  assert.deepEqual(visibleProfile(profile(saved)).tabs![0].appearance, appearance);
  assert.deepEqual(
    compilePageDocument(saved, 'home', source + '\nMore prose').tabs![0].appearance,
    appearance,
  );
  assert.deepEqual(compilePageDocument(saved, 'home', source, {}).tabs![0].appearance, {});
  const hidden = structuredClone(saved);
  hidden.tabs![0].hidden = true;
  assert.equal(
    visibleProfile(profile(hidden)).tabs!.some((tab) => tab.id === 'home'),
    false,
  );
});

test('publishing legacy page source retains stable identity, aliases, hidden cards and rich metadata', async () => {
  const source = getPageSource(base, 'home');
  const next = compilePageDocument(base, 'home', source);
  assert.equal(next.links.find((item) => item.slug === 'code')?.id, 'legacy:code');
  assert.deepEqual(next.links.find((item) => item.slug === 'code')?.aliases, ['repo']);
  for (const slug of ['discord', 'games', 'secret', 'other'])
    assert.deepEqual(
      next.links.find((item) => item.slug === slug),
      base.links.find((item) => item.slug === slug),
    );
  assert.deepEqual(next.tabs, base.tabs);
  assert.equal(
    await resolveLinkDestination(profile(next), 'repo', async () => null),
    'https://github.com/alex',
  );
  assert.equal(base.documents, undefined);
  assert.ok(next.documents?.home);
});

test('publishing GIF blocks does not change card identity, aliases or redirect destinations', async () => {
  const originalSource = getPageSource(base, 'home');
  const original = compilePageDocument(base, 'home', originalSource);
  const source = `${originalSource}\n::gif[Hello]{provider="giphy" id="YsTs5ltWtEhnq" width="480" height="270"}\n`;
  const next = compilePageDocument(base, 'home', source);
  assert.deepEqual(next.links, original.links);
  assert.deepEqual(next.tabs, original.tabs);
  assert.ok(next.documents!.home.includes('::gif[Hello]'));
  assert.equal(
    await resolveLinkDestination(profile(next), 'repo', async () => null),
    'https://github.com/alex',
  );
  assert.equal(
    await resolveLinkDestination(profile(next), 'code', async () => null),
    'https://github.com/alex',
  );
  assert.ok(visibleProfile(profile(next)).documents!.home.includes('::gif[Hello]'));
});

test('readable rich fences retain identities and aliases through publication, edits and public filtering', () => {
  const data = structuredClone(base);
  data.links.find((item) => item.slug === 'discord')!.aliases = ['community'];
  data.links.find((item) => item.slug === 'games')!.collection!.items[0].aliases = [
    'favorite-game',
  ];
  const source = getPageSource(data, 'home');
  assert.match(source, /```wya-item\n\{\n  "/);
  assert.equal(source.includes('::item{'), false);
  assert.equal(source.includes('&#x22;'), false);
  let published = compilePageDocument(data, 'home', source);
  assert.deepEqual(
    published.links.find((item) => item.slug === 'discord'),
    data.links.find((item) => item.slug === 'discord'),
  );
  assert.deepEqual(
    published.links.find((item) => item.slug === 'games'),
    data.links.find((item) => item.slug === 'games'),
  );
  published = applyAction(
    published,
    actionSchema.parse({
      action: 'upsert_discord',
      expectedVersion: 1,
      originalSlug: 'discord',
      slug: 'discord',
      label: 'Updated community',
      guildId: '771498135188799500',
    }),
  ).data;
  const edited = parsePageSource(published.documents!.home).items.find(
    ({ item }) => item.slug === 'discord',
  )!.item;
  assert.equal(edited.id, 'community');
  assert.deepEqual(edited.aliases, ['community']);
  assert.equal(edited.label, 'Updated community');
  const publicDocument = visibleProfile(profile(published)).documents!.home;
  assert.match(publicDocument, /```wya-item/);
  assert.equal(publicDocument.includes('private-game.example'), false);
  assert.equal(publicDocument.includes('Private note'), false);
  const publicCollection = parsePageSource(publicDocument).items.find(
    ({ item }) => item.slug === 'games',
  )!.item;
  assert.equal(publicCollection.collection!.items.length, 1);
  assert.equal(publicCollection.collection!.items[0].id, 'game-one');
  assert.deepEqual(publicCollection.collection!.items[0].aliases, ['favorite-game']);
});

test('legacy attribute payloads normalize to readable fences without changing stored source or card identities', () => {
  const discord = { ...base.links.find((item) => item.slug === 'discord')!, aliases: ['join'] };
  const oldBlock = `::item{data='${JSON.stringify(discord)}'}`;
  const prose = '# Community\n\nKeep this **ordinary Markdown**.\n\n';
  const data: ProfileData = {
    ...base,
    links: [discord],
    tabs: [
      { id: 'home', title: 'Community', slug: 'community', ungrouped: ['discord'], sections: [] },
    ],
    documents: { home: prose + oldBlock + '\n' },
  };
  const before = JSON.stringify(data);
  assert.equal(parsePageSource(data.documents!.home).items[0].item.id, 'community');
  const normalized = getPageSource(data, 'home');
  assert.ok(normalized.startsWith(prose));
  assert.match(normalized, /```wya-item/);
  assert.equal(normalized.includes('::item{'), false);
  assert.deepEqual(parsePageSource(normalized).items[0].item, discord);
  assert.equal(JSON.stringify(data), before);
  const published = compilePageDocument(data, 'home', normalized);
  assert.deepEqual(published.links, [discord]);
  assert.match(published.documents!.home, /```wya-item/);
});

test('visual edits update the published source without dropping ordinary Markdown', () => {
  const prefix = '# Hello\n\nAn ordinary [text link](https://example.com).\n\n---\n\n';
  let next = compilePageDocument(base, 'home', prefix + getPageSource(base, 'home'));
  next = applyAction(
    next,
    actionSchema.parse({
      action: 'upsert_link',
      expectedVersion: 1,
      originalSlug: 'code',
      slug: 'work',
      label: 'My work',
      destination: 'https://github.com/updated',
      platform: 'github',
      aliases: ['repo', 'code'],
    }),
  ).data;
  assert.ok(next.documents!.home.startsWith(prefix));
  const item = parsePageSource(next.documents!.home).items.find(
    ({ item }) => item.slug === 'work',
  )?.item;
  assert.equal(item?.id, 'legacy:code');
  assert.equal(item?.label, 'My work');
  assert.equal(item?.url, 'https://github.com/updated');
  assert.deepEqual(item?.aliases, ['repo', 'code']);
  const renamed = applyAction(
    next,
    actionSchema.parse({
      action: 'set_tabs',
      expectedVersion: 1,
      defaultTabId: 'home',
      tabs: next.tabs!.map((tab) =>
        tab.id === 'home' ? { ...tab, title: 'Renamed document' } : tab,
      ),
    }),
  ).data;
  assert.equal(findVisibleLink(renamed, 'repo')?.id, 'legacy:code');
});

test('new source links receive IDs and normalize social usernames without changing other pages', () => {
  const next = compilePageDocument(
    base,
    'home',
    '::link[New account]{slug="new" url="alex" platform="github"}',
  );
  const item = next.links.find((item) => item.slug === 'new')!;
  assert.match(item.id!, /^[a-f0-9-]{36}$/);
  assert.equal(item.url, 'https://github.com/alex');
  assert.deepEqual(
    next.links.find((item) => item.slug === 'other'),
    base.links.at(-1),
  );
  assert.equal(parsePageSource(next.documents!.home).items[0].item.id, item.id);
});

test('source publication rejects unsafe URLs, stolen IDs, collisions and kind changes', () => {
  for (const source of [
    '::link[Unsafe]{slug="unsafe" url="javascript:alert(1)"}',
    '::link[Unsafe]{slug="unsafe" url="https://user:pass@example.com"}',
    '::link[Stolen]{id="other-id" slug="stolen" url="https://example.com"}',
    '::link[Invented]{id="unknown-id" slug="invented" url="https://example.com"}',
    '::link[Collision]{slug="other" url="https://example.com"}',
    '::link[Wrong kind]{id="community" slug="discord" url="https://example.com"}',
    '::link[One]{id="legacy:code" slug="code" url="https://example.com"}\n\n::link[Two]{id="legacy:code" slug="two" url="https://example.com"}',
  ])
    assert.throws(() => compilePageDocument(base, 'home', source));
  const invalid = {
    action: 'publish_document',
    expectedVersion: 1,
    tabId: 'home',
    source: 'a'.repeat(128 * 1024 + 1),
  };
  assert.equal(actionSchema.safeParse(invalid).success, false);
  assert.equal(actionSchema.safeParse({ ...invalid, source: '\0' }).success, false);
  assert.equal(
    actionSchema.safeParse({ ...invalid, source: 'é'.repeat(100 * 1024) }).success,
    false,
  );
});

test('public source excludes hidden cards, nested collection contents and hidden pages', () => {
  let next = compilePageDocument(base, 'home', getPageSource(base, 'home'));
  next = compilePageDocument(
    next,
    'other',
    '# Hidden page text\n\n' + getPageSource(next, 'other'),
  );
  next.tabs = next.tabs!.map((tab) => (tab.id === 'other' ? { ...tab, hidden: true } : tab));
  const visible = visibleProfile(profile(next));
  const serialized = JSON.stringify(visible);
  for (const privateValue of [
    'secret.example',
    'private-game.example',
    'Private note',
    'Hidden page text',
    'other.example',
  ])
    assert.equal(serialized.includes(privateValue), false, privateValue);
  assert.equal(visible.documents?.other, undefined);
  assert.equal(visible.links.find((item) => item.slug === 'games')?.collection?.items.length, 1);
  assert.equal(findVisibleLink(visible, 'secret'), undefined);
  assert.equal(findVisibleLink(visible, 'hidden-game'), undefined);
});

test('malformed and unsafe nested rich payloads fail as input errors without changing data', () => {
  const original = JSON.stringify(base);
  const collection = base.links.find((item) => item.kind === 'collection')!;
  for (const items of [
    null,
    {},
    [null],
    [{ ...collection.collection!.items[0], id: 'other-id' }],
    [{ ...collection.collection!.items[0], url: 'javascript:alert(1)' }],
  ]) {
    const malformed = { ...collection, collection: { type: 'game', items } } as typeof collection;
    assert.throws(
      () => compilePageDocument(base, 'home', serializePageItem(malformed)),
      (error) => error instanceof AppError && error.status === 400,
    );
  }
  assert.equal(JSON.stringify(base), original);
});

test('collection depth and child limits are rejected before traversing untrusted nested payloads', () => {
  const collection = base.links.find((item) => item.kind === 'collection')!;
  let nested: unknown = collection.collection!.items[0];
  for (let depth = 0; depth < 100; depth++)
    nested = { ...collection, collection: { type: 'game', items: [nested] } };
  assert.throws(
    () => compilePageDocument(base, 'home', `::item{data='${JSON.stringify(nested)}'}`),
    (error) =>
      error instanceof AppError &&
      error.status === 400 &&
      /cannot contain other collections/.test(error.message),
  );
  const overLimit = {
    ...collection,
    collection: { type: 'game' as const, items: Array(21).fill(collection.collection!.items[0]) },
  };
  assert.throws(
    () => compilePageDocument(base, 'home', serializePageItem(overLimit)),
    (error) =>
      error instanceof AppError && error.status === 400 && /up to 20 games/.test(error.message),
  );
});
