import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyItem,
  copySection,
  parseClipboard,
  prepareContentPaste,
  CLIPBOARD_LIMIT,
} from '../lib/content-clipboard.ts';
import { actionSchema, applyAction, type ProfileData } from '../lib/model.ts';
import { allItems } from '../lib/collections.ts';
import { getProfileLayout } from '../lib/profile-tabs.ts';

const empty: ProfileData = { name: 'Owner', bio: 'Private bio', theme: 'lilac', links: [] };
function change(data: ProfileData, action: object) {
  return applyAction(data, actionSchema.parse({ expectedVersion: 1, ...action })).data;
}
function fixture() {
  let data = change(empty, {
    action: 'upsert_link',
    slug: 'mail',
    aliases: ['contact'],
    label: 'Email me',
    platform: 'email',
    destination: 'hi@example.com',
    visible: false,
  });
  data = change(data, {
    action: 'upsert_project',
    slug: 'work',
    label: 'Project',
    description: 'Description',
    icon: 'rocket',
    buttons: [{ label: 'Demo', destination: 'https://example.com/demo' }],
  });
  data = change(data, {
    action: 'upsert_collection',
    slug: 'games',
    label: '',
    entries: [
      {
        game: {
          title: 'Game',
          source: { provider: 'igdb', id: 2, slug: 'game' },
          coverUrl: 'https://images.igdb.com/game.jpg',
        },
        buttons: [{ label: 'Play', destination: 'https://example.com/play' }],
      },
    ],
  });
  data = change(data, {
    action: 'upsert_discord',
    slug: 'discord',
    label: 'Community',
    guildId: '771498135188799500',
  });
  return change(data, {
    action: 'set_tabs',
    defaultTabId: 'home',
    tabs: [
      {
        id: 'home',
        title: 'Home',
        slug: 'home',
        ungrouped: ['mail'],
        sections: [{ id: 'source', title: 'Favorites', slugs: ['discord', 'games', 'work'] }],
      },
      {
        id: 'other',
        title: 'Other',
        slug: 'other',
        hidden: true,
        ungrouped: [],
        sections: [{ id: 'target', title: 'Target', slugs: [] }],
      },
    ],
  });
}

test('copy keeps only content and a section uses its current layout order', () => {
  const source = fixture(),
    before = JSON.stringify(source);
  const copied = copySection(source, 'source');
  assert.equal(copied.kind, 'section');
  assert.deepEqual(
    copied.items.map((item) => item.slug),
    ['discord', 'games', 'work'],
  );
  for (const item of allItems(copied.items)) {
    assert.equal('id' in item, false);
    assert.equal('sectionId' in item, false);
  }
  assert.equal(JSON.stringify(copied).includes('Private bio'), false);
  assert.equal(JSON.stringify(source), before);
  assert.throws(() => copyItem(source, 'missing'));
  assert.throws(() => copySection(source, 'missing'));
});

test('paste section across spaces preserves nested content and creates independent IDs', () => {
  const source = fixture(),
    clipboard = copySection(source, 'source');
  const result = prepareContentPaste(empty, JSON.parse(JSON.stringify(clipboard)), 'home');
  assert.equal(result.itemCount, 4);
  assert.equal(result.data.name, empty.name);
  assert.equal(result.data.tabs?.length, 1);
  assert.equal(result.data.defaultTabId, 'home');
  const section = result.data.tabs![0].sections[0];
  assert.notEqual(section.id, 'source');
  assert.deepEqual(section.slugs, ['discord', 'games', 'work']);
  assert.deepEqual(copySection(result.data, section.id), clipboard);
  const oldIds = new Set(allItems(source.links).map((item) => item.id));
  assert.ok(allItems(result.data.links).every((item) => item.id && !oldIds.has(item.id)));
  assert.deepEqual(empty.links, []);
});

test('repeated paste keeps original content, avoids alias/child collisions and respects target section', () => {
  const source = fixture(),
    before = JSON.stringify(source);
  const mail = copyItem(source, 'mail');
  const first = prepareContentPaste(source, mail, 'other', 'target');
  const second = prepareContentPaste(first.data, mail, 'other', 'target');
  assert.equal(first.hiddenCount, 1);
  assert.deepEqual(second.data.tabs![1].sections[0].slugs, ['mail-2', 'mail-3']);
  assert.equal(second.data.tabs![1].hidden, true);
  assert.deepEqual(second.data.links.find((item) => item.slug === 'mail-3')?.aliases, [
    'contact-3',
  ]);
  assert.equal(JSON.stringify(source), before);
  const games = prepareContentPaste(source, copyItem(source, 'games'), 'other');
  const originals = allItems(source.links);
  const copies = allItems(games.data.links).filter(
    (item) => !originals.some((old) => old.id === item.id),
  );
  assert.equal(copies.length, 2);
  for (const item of copies) assert.ok(item.slug.endsWith('-2'));
  const names = allItems(games.data.links).flatMap((item) => [item.slug, ...(item.aliases ?? [])]);
  assert.equal(names.length, new Set(names).size);
  assert.equal(
    copies[1].url,
    originals.find((item) => item.slug === copies[1].slug.slice(0, -2))?.url,
  );
});

test('paste accepts empty sections and a full set of tabs but rejects invalid or nested targets', () => {
  const source = fixture(),
    copied = copySection(source, 'target');
  const home = getProfileLayout(empty).tabs[0];
  const full = {
    ...empty,
    tabs: Array.from({ length: 5 }, (_, i) => ({ ...home, id: `tab${i}`, slug: `tab${i}` })),
    defaultTabId: 'tab0',
  };
  const result = prepareContentPaste(full, copied, 'tab4');
  assert.equal(result.data.tabs?.length, 5);
  assert.equal(result.data.tabs![4].sections.length, 1);
  assert.equal(result.itemCount, 0);
  assert.throws(() => prepareContentPaste(source, copied, 'missing'), /Tab not found/);
  assert.throws(
    () => prepareContentPaste(source, copyItem(source, 'mail'), 'home', 'target'),
    /Section not found/,
  );
  assert.throws(
    () => prepareContentPaste(source, copied, 'other', 'target'),
    /inside another section/,
  );
});

test('untrusted clipboard rejects executable URLs, extra metadata, invalid games and overlarge payloads', () => {
  const copied = copyItem(fixture(), 'games');
  assert.throws(() => parseClipboard({ ...copied, ownerId: 'foreign' }));
  assert.throws(() => parseClipboard({ ...copied, version: 2 }));
  assert.throws(() => parseClipboard({ ...copied, items: [] }));
  const cases = [
    { ...copied, items: [{ ...copied.items[0], id: 'foreign' }] },
    { ...copied, items: [{ ...copied.items[0], sectionId: 'foreign' }] },
    {
      ...copyItem(fixture(), 'mail'),
      items: [
        {
          slug: 'unsafe',
          label: 'Unsafe',
          platform: 'website',
          url: 'javascript:alert(1)',
          visible: true,
        },
      ],
    },
  ];
  for (const value of cases) assert.throws(() => parseClipboard(value));
  const bad = structuredClone(copied);
  assert.ok('collection' in bad.items[0]);
  bad.items[0].collection.items[0].interest.buttons![0].url = 'https://mismatch.example/';
  assert.throws(() => parseClipboard(bad));
  assert.throws(() => parseClipboard({ padding: 'x'.repeat(CLIPBOARD_LIMIT) }), /1 MB/);
});

test('paste uses combined space limits and the versioned action boundary', () => {
  const source = fixture(),
    content = copySection(source, 'source');
  const many: ProfileData = {
    ...empty,
    links: Array.from({ length: 97 }, (_, i) => ({
      slug: `item-${i}`,
      label: 'Item',
      platform: 'website',
      url: 'https://example.com/',
      visible: true,
    })),
  };
  assert.throws(() => prepareContentPaste(many, content, 'home'), /100 items/);
  assert.throws(
    () =>
      prepareContentPaste(
        {
          ...empty,
          sections: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, title: 'Section' })),
        },
        content,
        'home',
      ),
    /20 sections/,
  );
  const project = source.links.find((item) => item.kind === 'project')!;
  assert.throws(
    () =>
      prepareContentPaste(
        { ...empty, links: Array.from({ length: 12 }, (_, i) => ({ ...project, slug: `p${i}` })) },
        copyItem(source, 'work'),
        'home',
      ),
    /12 projects/,
  );
  const request = { action: 'paste_content', tabId: 'home', content };
  assert.equal(actionSchema.safeParse(request).success, false);
  const result = change(empty, request);
  assert.equal(result.links.length, 3);
  assert.deepEqual(empty.links, []);
});
