import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionSchema, applyAction, type ProfileData, type Profile } from '../lib/model.ts';
import { suggestInterestSlug } from '../lib/interests.ts';
import { getProfileLayout } from '../lib/profile-tabs.ts';
import { resolveLinkDestination } from '../lib/link-redirects.ts';

const base: ProfileData = { name: 'Alex', bio: '', theme: 'lilac', links: [] };
const game = {
  action: 'upsert_interest',
  expectedVersion: 1,
  interestType: 'game',
  slug: 'hollow-knight',
  label: 'Hollow Knight',
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

test('game snapshots retain personal fields, defaults, IDs and catalog references; explicit null clears optional fields', () => {
  const input = {
    ...game,
    coverUrl: 'https://images.example/game.jpg',
    destination: 'https://example.com/game',
    status: 'active',
    favorite: true,
    note: 'My favorite atmosphere.',
    catalog: { provider: 'igdb', id: 1, slug: 'hollow-knight' },
  };
  let data = change(base, input);
  const id = data.links[0].id;
  assert.equal(data.links[0].visible, false);
  assert.equal(data.links[0].kind, 'interest');
  assert.equal(data.links[0].icon, 'gamepad');
  data = change(data, { ...game, visible: true, label: 'Hollow Knight!' });
  assert.equal(data.links[0].id, id);
  assert.equal(data.links[0].interest?.favorite, true);
  assert.equal(data.links[0].interest?.catalog?.id, 1);
  assert.equal(data.links[0].interest?.status, 'active');
  assert.equal(data.links[0].url, input.destination);
  data = change(data, {
    ...game,
    coverUrl: null,
    destination: null,
    status: null,
    catalog: null,
    note: '',
    favorite: false,
  });
  assert.deepEqual(data.links[0].interest, { type: 'game', note: '', favorite: false });
  assert.equal(data.links[0].url, '');
  assert.equal(data.links[0].visible, true);
});

test('games reuse tabs, sections, aliases, stable rename, and deletion', async () => {
  let data = change(base, game);
  data = change(data, {
    action: 'set_tabs',
    expectedVersion: 1,
    defaultTabId: 'home',
    tabs: [
      { id: 'home', slug: 'home', title: 'Home', ungrouped: [], sections: [] },
      {
        id: 'games',
        slug: 'games',
        title: 'Games',
        ungrouped: [],
        sections: [{ id: 'favorites', title: 'Favorite Game', slugs: ['hollow-knight'] }],
      },
    ],
  });
  const id = data.links[0].id;
  data = change(data, {
    ...game,
    originalSlug: 'hollow-knight',
    slug: 'favorite',
    aliases: ['hollow-knight'],
    visible: true,
  });
  assert.equal(data.links[0].id, id);
  assert.deepEqual(getProfileLayout(data).tabs[1].sections[0].slugs, ['favorite']);
  assert.equal(
    await resolveLinkDestination(profile(data), 'hollow-knight', async () => null),
    `https://wya.im/alex?tab=games#interest-${id}`,
  );
  data = change(data, { ...game, slug: 'favorite', visible: false });
  await assert.rejects(
    resolveLinkDestination(profile(data), 'hollow-knight', async () => null),
    { status: 404 },
  );
  data = change(data, { action: 'delete_link', expectedVersion: 1, slug: 'favorite' });
  assert.equal(data.links.length, 0);
  assert.deepEqual(getProfileLayout(data).tabs[1].sections[0].slugs, []);
});

test('games enforce URL, metadata, namespace, item-type and total count boundaries', () => {
  for (const coverUrl of [
    'javascript:alert(1)',
    'data:image/png,hi',
    'http://example.com/a',
    'https://user:secret@example.com/a',
  ])
    assert.throws(() => change(base, { ...game, coverUrl }));
  for (const destination of [
    'javascript:alert(1)',
    'mailto:a@example.com',
    'https://user:secret@example.com',
  ])
    assert.throws(() => change(base, { ...game, destination }));
  for (const extra of [
    { note: 'x'.repeat(401) },
    { status: 'unknown' },
    { interestType: 'anime' },
    { catalog: { provider: 'other', id: 1, slug: 'game' } },
    { catalog: { provider: 'igdb', id: 1, slug: '../evil' } },
    { catalog: { provider: 'igdb', id: 1, slug: 'game', secret: 'x' } },
  ])
    assert.throws(() => change(base, { ...game, ...extra }));
  const data = change(base, { ...game, aliases: ['hk'] });
  assert.throws(() => change(data, { ...game, slug: 'hk' }), /already used/);
  assert.throws(
    () =>
      change(data, {
        action: 'upsert_link',
        expectedVersion: 1,
        slug: game.slug,
        label: 'Link',
        platform: 'website',
        destination: 'https://example.com',
      }),
    /interest editor/,
  );
  const full = {
    ...base,
    links: Array.from({ length: 100 }, (_, i) => ({
      ...data.links[0],
      slug: `game-${i}`,
      aliases: [],
    })),
  };
  assert.throws(() => change(full, game), /100 items/);
  assert.equal(change(full, { ...game, slug: 'game-1' }).links.length, 100);
});

test('generated slugs work with accented, non-Latin, long and duplicate titles', () => {
  assert.equal(
    suggestInterestSlug('Pokémon: Édition', ['pokemon-edition'], 'game'),
    'pokemon-edition-2',
  );
  assert.equal(suggestInterestSlug('ゲーム', [], 'game'), 'game');
  assert.equal(suggestInterestSlug('A'.repeat(100), [], 'game').length, 35);
  assert.equal(suggestInterestSlug('Game', ['game', 'game-2', 'game-3'], 'game'), 'game-4');
});

test('game buttons share project limits, normalize URLs and drive aliases without losing catalog data', async () => {
  const catalog = { provider: 'igdb', id: 1, slug: 'hollow-knight' };
  let data = change(base, {
    ...game,
    catalog,
    visible: true,
    aliases: ['hk'],
    buttons: [
      { label: 'Steam', destination: 'https://store.example' },
      { label: 'My review', destination: 'https://reviews.example/game' },
    ],
  });
  const id = data.links[0].id;
  assert.equal(data.links[0].url, 'https://store.example/');
  assert.deepEqual(data.links[0].interest?.buttons, [
    { label: 'Steam', url: 'https://store.example/' },
    { label: 'My review', url: 'https://reviews.example/game' },
  ]);
  assert.equal(
    await resolveLinkDestination(profile(data), 'hk', async () => null),
    'https://store.example/',
  );
  data = change(data, { ...game, label: 'New catalog title' });
  assert.equal(data.links[0].interest?.buttons?.length, 2);
  assert.deepEqual(data.links[0].interest?.catalog, catalog);
  assert.equal(data.links[0].url, 'https://store.example/');
  assert.equal(data.links[0].id, id);
  data = change(data, {
    ...game,
    buttons: [],
    destination: 'https://www.igdb.com/games/hollow-knight',
  });
  assert.deepEqual(data.links[0].interest?.buttons, []);
  assert.equal(
    await resolveLinkDestination(profile(data), 'hk', async () => null),
    'https://www.igdb.com/games/hollow-knight',
  );
});

test('removing game buttons clears their destination; unsafe or conflicting destinations are rejected', () => {
  const buttons = [{ label: 'Store', destination: 'https://store.example' }];
  const data = change(base, { ...game, buttons });
  assert.equal(change(data, { ...game, buttons: [] }).links[0].url, '');
  for (const destination of [
    'javascript:alert(1)',
    'data:text/html,hello',
    'https://user:secret@example.com',
    'mailto:a@example.com',
  ]) {
    assert.throws(() => change(base, { ...game, buttons: [{ label: 'Link', destination }] }));
  }
  for (const invalid of [
    Array(4).fill(buttons[0]),
    [{ label: '', destination: 'https://example.com' }],
    [{ label: 'x'.repeat(31), destination: 'https://example.com' }],
  ])
    assert.throws(() => change(base, { ...game, buttons: invalid }));
  assert.throws(
    () => change(data, { ...game, destination: 'https://different.example' }),
    /first button/,
  );
  assert.equal(
    change(base, { ...game, buttons, destination: 'https://store.example/' }).links[0].url,
    'https://store.example/',
  );
});
