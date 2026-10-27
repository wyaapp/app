import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionSchema,
  applyAction,
  findVisibleLink,
  type ProfileData,
  type Profile,
} from '../lib/model.ts';
import { allItems, publicItems } from '../lib/collections.ts';
import { getProfileLayout } from '../lib/profile-tabs.ts';
import { resolveLinkDestination } from '../lib/link-redirects.ts';
import { pageForFragment } from '../lib/page-fragments.ts';
const base: ProfileData = { name: 'Alex', bio: '', theme: 'lilac', links: [] };
const game = (id: number) => ({
  game: {
    title: `Game ${id}`,
    source: { provider: 'igdb', id, slug: `game-${id}` },
    coverUrl: 'https://images.igdb.com/game.jpg',
  },
});
const widget = {
  action: 'upsert_collection',
  expectedVersion: 1,
  slug: 'favorites',
  label: 'Games I like',
  visible: true,
  entries: [game(1), game(2)],
};
const change = (data: ProfileData, input: object) =>
  applyAction(data, actionSchema.parse(input)).data;
const profile = (data: ProfileData): Profile => ({
  ...data,
  id: 'space',
  handle: 'alex',
  aliases: [],
  version: 1,
  updatedAt: '',
});

test('collections preserve child identity and URLs through ordering, editing and deletion', async () => {
  let data = change(base, widget);
  const [one, two] = data.links[0].collection!.items;
  assert.equal(data.links.length, 1);
  assert.equal(allItems(data.links).length, 3);
  assert.deepEqual(one.interest?.buttons, []);
  assert.equal(
    await resolveLinkDestination(profile(data), one.slug, async () => null),
    'https://www.igdb.com/games/game-1',
  );
  data = change(data, {
    ...widget,
    entries: [
      { id: two.id },
      { id: one.id, buttons: [{ label: 'Steam', destination: 'https://store.example/1' }] },
    ],
  });
  assert.deepEqual(
    data.links[0].collection!.items.map((item) => item.id),
    [two.id, one.id],
  );
  assert.equal(findVisibleLink(data, one.slug)?.url, 'https://store.example/1');
  assert.deepEqual(findVisibleLink(data, one.slug)?.interest?.catalog, one.interest?.catalog);
  data = change(data, { ...widget, entries: [{ id: one.id, buttons: [] }] });
  assert.equal(findVisibleLink(data, two.slug), undefined);
  assert.equal(
    await resolveLinkDestination(profile(data), one.slug, async () => null),
    `https://wya.im/alex#interest-${one.id}`,
  );
  assert.equal(
    await resolveLinkDestination(profile(data), 'favorites', async () => null),
    `https://wya.im/alex#widget-${data.links[0].id}`,
  );
});

test('hidden widgets and hidden children cannot leak through public data or redirects', async () => {
  let data = change(base, widget);
  const [one, two] = data.links[0].collection!.items;
  data = change(data, { ...widget, entries: [{ id: one.id, visible: false }, { id: two.id }] });
  assert.equal(publicItems(data.links)[0].collection!.items.length, 1);
  assert.equal(findVisibleLink(data, one.slug), undefined);
  await assert.rejects(
    resolveLinkDestination(profile(data), one.slug, async () => null),
    { status: 404 },
  );
  data = change(data, { ...widget, visible: false, entries: [{ id: one.id }, { id: two.id }] });
  assert.deepEqual(publicItems(data.links), []);
  assert.equal(findVisibleLink(data, two.slug), undefined);
});

test('collections reject duplicate catalog games, foreign child IDs, nesting and unsafe URLs', () => {
  const data = change(base, widget),
    child = data.links[0].collection!.items[0];
  for (const entries of [
    [game(1), game(1)],
    [{ id: 'another-widget-child' }],
    [{ id: child.id }, { id: child.id }],
    [{ game: { ...game(3).game, coverUrl: 'http://example.com/image' } }],
    [{ ...game(3), buttons: [{ label: 'bad', destination: 'javascript:alert(1)' }] }],
    [],
    Array.from({ length: 21 }, (_, i) => game(i + 1)),
  ])
    assert.throws(() => change(data, { ...widget, entries }));
  assert.throws(() =>
    change(data, { ...widget, entries: [{ id: child.id, collection: { items: [] } }] }),
  );
  assert.throws(() => change(data, { ...widget, slug: child.slug }));
  assert.throws(() =>
    change(data, {
      action: 'upsert_link',
      expectedVersion: 1,
      slug: child.slug,
      label: 'Collision',
      platform: 'website',
      destination: 'https://example.com',
    }),
  );
});

test('games in widgets count toward the total space limit', () => {
  let data = base;
  for (let index = 0; index < 4; index++)
    data = change(data, {
      ...widget,
      slug: `widget-${index}`,
      entries: Array.from({ length: 20 }, (_, i) => game(i + 1)),
    });
  assert.equal(allItems(data.links).length, 84);
  assert.throws(
    () => change(data, { ...widget, entries: Array.from({ length: 20 }, (_, i) => game(i + 1)) }),
    /100 items/,
  );
  data = change(data, { ...widget, entries: Array.from({ length: 15 }, (_, i) => game(i + 1)) });
  assert.equal(allItems(data.links).length, 100);
  assert.throws(
    () =>
      change(data, {
        action: 'upsert_interest',
        expectedVersion: 1,
        slug: 'extra',
        interestType: 'game',
        label: 'Extra',
      }),
    /100 items/,
  );
});

test('explicit grouping keeps aliases, hidden state, metadata, order and tab/section placement', async () => {
  let data = base;
  for (let i = 1; i <= 3; i++)
    data = change(data, {
      action: 'upsert_interest',
      expectedVersion: 1,
      slug: `game-${i}`,
      interestType: 'game',
      label: `Game ${i}`,
      aliases: [`alias-${i}`],
      visible: i !== 2,
      note: 'Keep this',
      buttons: [{ label: 'Play', destination: `https://example.com/${i}` }],
    });
  data = change(data, {
    action: 'set_tabs',
    expectedVersion: 1,
    defaultTabId: 'home',
    tabs: [
      { id: 'home', title: 'Home', slug: 'home', ungrouped: [], sections: [] },
      {
        id: 'play',
        title: 'Games',
        slug: 'play',
        ungrouped: [],
        sections: [{ id: 'faves', title: 'Favorites', slugs: ['game-1', 'game-2', 'game-3'] }],
      },
    ],
  });
  const before = structuredClone(data.links);
  data = change(data, {
    action: 'group_games',
    expectedVersion: 1,
    slug: 'favorites',
    label: 'Favorites',
    slugs: ['game-2', 'game-1'],
  });
  assert.deepEqual(data.links[0].collection!.items, before.slice(0, 2));
  assert.deepEqual(getProfileLayout(data).tabs[1].sections[0].slugs, ['favorites', 'game-3']);
  assert.equal(
    await resolveLinkDestination(profile(data), 'alias-1', async () => null),
    'https://example.com/1',
  );
  assert.equal(findVisibleLink(data, 'alias-2'), undefined);
  const child = data.links[0].collection!.items[0];
  data = change(data, { ...widget, tabId: 'play', entries: [{ id: child.id, buttons: [] }] });
  assert.deepEqual(getProfileLayout(data).tabs[1].sections[0].slugs, ['favorites', 'game-3']);
  assert.equal(
    await resolveLinkDestination(profile(data), 'alias-1', async () => null),
    `https://wya.im/alex#interest-${child.id}`,
  );
  assert.equal(pageForFragment(data, `interest-${child.id}`)?.id, 'play');
  data = change(data, { action: 'delete_link', expectedVersion: 1, slug: 'favorites' });
  assert.equal(findVisibleLink(data, 'alias-1'), undefined);
});

test('grouping cannot silently move unrelated items or nest widgets', () => {
  const data = change(base, widget);
  assert.throws(() =>
    change(data, {
      action: 'group_games',
      expectedVersion: 1,
      slug: 'group',
      label: 'Group',
      slugs: ['favorites'],
    }),
  );
  let legacy = base;
  for (let i = 1; i <= 2; i++)
    legacy = change(legacy, {
      action: 'upsert_interest',
      expectedVersion: 1,
      slug: `g${i}`,
      interestType: 'game',
      label: 'Game',
      visible: true,
    });
  legacy = change(legacy, {
    action: 'set_layout',
    expectedVersion: 1,
    ungrouped: ['g1'],
    sections: [{ id: 'other', title: 'Other', slugs: ['g2'] }],
  });
  assert.throws(
    () =>
      change(legacy, {
        action: 'group_games',
        expectedVersion: 1,
        slug: 'group',
        label: 'Group',
        slugs: ['g1', 'g2'],
      }),
    /same tab and section/,
  );
});

test('collection headings are optional, preserved when omitted, and removable without changing addresses', async () => {
  const untitled = Object.fromEntries(Object.entries(widget).filter(([key]) => key !== 'label'));
  let data = change(base, untitled);
  assert.equal(data.links[0].label, '');
  const child = data.links[0].collection!.items[0];
  const entries = [{ id: child.id }];
  data = change(data, { ...widget, entries });
  assert.equal(data.links[0].label, 'Games I like');
  data = change(data, { ...untitled, entries });
  assert.equal(data.links[0].label, 'Games I like');
  data = change(data, { ...untitled, entries, label: '   ' });
  assert.equal(data.links[0].label, '');
  assert.equal(data.links[0].slug, widget.slug);
  assert.equal(
    await resolveLinkDestination(profile(data), child.slug, async () => null),
    'https://www.igdb.com/games/game-1',
  );
  assert.throws(() => change(data, { ...untitled, entries, label: 'x'.repeat(61) }));
});

test('renaming a collection preserves children, section position and fragment identity', async () => {
  let data = change(base, widget);
  const original = structuredClone(data.links[0]);
  data = change(data, {
    action: 'set_tabs',
    expectedVersion: 1,
    defaultTabId: 'home',
    tabs: [
      { id: 'home', title: 'Home', slug: 'home', ungrouped: [], sections: [] },
      {
        id: 'games',
        title: 'Games',
        slug: 'games',
        ungrouped: [],
        sections: [{ id: 'favorites', title: 'Favorites', slugs: [original.slug] }],
      },
    ],
  });
  data = change(data, {
    ...widget,
    originalSlug: original.slug,
    slug: 'my.games',
    entries: original.collection!.items.map((item) => ({ id: item.id })),
  });
  assert.equal(data.links[0].id, original.id);
  assert.deepEqual(data.links[0].collection, original.collection);
  assert.deepEqual(getProfileLayout(data).tabs[1].sections[0].slugs, ['my.games']);
  assert.equal(
    await resolveLinkDestination(profile(data), 'my.games', async () => null),
    `https://wya.im/alex#widget-${original.id}`,
  );
  assert.equal(pageForFragment(data, `widget-${original.id}`)?.id, 'games');
  await assert.rejects(
    resolveLinkDestination(profile(data), original.slug, async () => null),
    { status: 404 },
  );
  assert.equal(
    await resolveLinkDestination(
      profile(data),
      original.collection!.items[0].slug,
      async () => null,
    ),
    'https://www.igdb.com/games/game-1',
  );
  assert.throws(
    () =>
      change(data, { ...widget, originalSlug: original.slug, slug: 'missing', entries: [game(5)] }),
    /not found/,
  );
});

test('collection renames cannot take another item or nested child URL or alias', () => {
  let data = change(base, widget);
  data = change(data, {
    action: 'upsert_link',
    expectedVersion: 1,
    slug: 'other',
    aliases: ['other-alias'],
    label: 'Other',
    destination: 'https://example.com',
    platform: 'website',
  });
  const collection = data.links[0];
  collection.collection!.items[0].aliases = ['child-alias'];
  for (const slug of [
    'other',
    'other-alias',
    collection.collection!.items[0].slug,
    'child-alias',
  ]) {
    assert.throws(
      () =>
        change(data, {
          ...widget,
          originalSlug: widget.slug,
          slug,
          entries: collection.collection!.items.map((child) => ({ id: child.id })),
        }),
      /already used/,
    );
  }
  assert.throws(
    () => change(data, { ...widget, originalSlug: 'other', slug: 'new-name' }),
    /already used/,
  );
});
