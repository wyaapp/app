import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportTab, parseTabFile, prepareTabImport, TAB_FILE_LIMIT } from '../lib/tab-transfer.ts';
import { actionSchema, applyAction, type ProfileData } from '../lib/model.ts';
import { allItems } from '../lib/collections.ts';
import { getProfileLayout } from '../lib/profile-tabs.ts';
const empty: ProfileData = { name: 'Name', bio: 'Private bio', theme: 'lilac', links: [] };
const change = (data: ProfileData, action: object) =>
  applyAction(data, actionSchema.parse({ expectedVersion: 1, ...action })).data;

test('hidden tabs stay hidden when exported and imported', () => {
  const data = change(empty, {
    action: 'set_tabs',
    defaultTabId: 'home',
    tabs: [
      { id: 'home', title: 'Private', slug: 'private', hidden: true, ungrouped: [], sections: [] },
    ],
  });
  const file = exportTab(data, 'home');
  assert.equal(file.tab.hidden, true);
  assert.equal(prepareTabImport(empty, file).tab.hidden, true);
});
function sample() {
  let data = change(empty, {
    action: 'upsert_link',
    slug: 'email',
    aliases: ['contact'],
    label: 'Email',
    platform: 'email',
    destination: 'hello@example.com',
    emailSubject: 'Hello',
    visible: false,
  });
  data = change(data, {
    action: 'upsert_project',
    slug: 'work',
    label: 'Work',
    description: 'My project',
    icon: 'rocket',
    buttons: [{ label: 'Demo', destination: 'https://example.com/demo' }],
    visible: true,
  });
  data = change(data, {
    action: 'upsert_interest',
    slug: 'solo',
    label: 'Solo',
    interestType: 'game',
    catalog: { provider: 'igdb', id: 1, slug: 'solo' },
    visible: true,
  });
  data = change(data, {
    action: 'upsert_collection',
    slug: 'games',
    label: '',
    visible: true,
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
  return change(data, {
    action: 'set_tabs',
    defaultTabId: 'home',
    tabs: [
      { id: 'home', title: 'Home', slug: 'home', ungrouped: [], sections: [] },
      {
        id: 'favorites',
        title: 'Favorites',
        slug: 'favorites',
        ungrouped: ['email', 'solo'],
        ungroupedPosition: 1,
        sections: [{ id: 'work-section', title: 'Work', slugs: ['work', 'games'] }],
      },
    ],
  });
}
test('tab export round trips mixed entries, sections, collection children and visibility without account metadata', () => {
  const source = sample(),
    file = exportTab(source, 'favorites');
  assert.equal(file.items.length, 4);
  assert.equal(JSON.stringify(file).includes('Private bio'), false);
  for (const item of allItems(file.items)) assert.equal('id' in item, false);
  const imported = prepareTabImport(empty, JSON.parse(JSON.stringify(file)));
  assert.equal(imported.itemCount, 5);
  assert.equal(imported.hiddenCount, 1);
  assert.equal(imported.renames.length, 0);
  assert.equal(imported.data.name, empty.name);
  assert.equal(imported.data.theme, empty.theme);
  const again = exportTab(imported.data, imported.tab.id);
  assert.deepEqual(again.items, file.items);
  assert.deepEqual(
    again.tab.sections.map((section) => ({ ...section, id: 'new' })),
    file.tab.sections.map((section) => ({ ...section, id: 'new' })),
  );
  assert.equal(again.tab.ungroupedPosition, 1);
  assert.notEqual(imported.tab.sections[0].id, file.tab.sections[0].id);
  assert.ok(
    allItems(imported.data.links).every(
      (item) => item.id && !allItems(source.links).some((old) => old.id === item.id),
    ),
  );
});
test('import resolves collisions across aliases, children, tab URLs and long slugs without changing original content', () => {
  const source = sample(),
    file = exportTab(source, 'favorites'),
    before = JSON.stringify(source);
  const imported = prepareTabImport(source, file);
  assert.equal(imported.tab.slug, 'favorites-2');
  assert.equal(imported.renames.length, 6);
  assert.deepEqual(imported.data.links.slice(0, source.links.length), source.links);
  assert.equal(JSON.stringify(source), before);
  const names = allItems(imported.data.links).flatMap((item) => [
    item.slug,
    ...(item.aliases ?? []),
  ]);
  assert.equal(names.length, new Set(names).size);
  const long = 'a'.repeat(40);
  const data = change(empty, {
    action: 'upsert_link',
    slug: long,
    label: 'Long',
    destination: 'https://example.com',
    platform: 'website',
  });
  const result = prepareTabImport(data, exportTab(data, 'home'));
  assert.equal(result.renames[0].to.length, 40);
  assert.ok(result.renames[0].to.endsWith('-2'));
});
test('imports reject malformed files, nesting, duplicate layout, unsafe URLs and mismatched buttons', () => {
  const file = exportTab(sample(), 'favorites');
  const email = file.items.findIndex((item) => item.slug === 'email'),
    project = file.items.findIndex((item) => item.slug === 'work'),
    collection = file.items.findIndex((item) => item.slug === 'games');
  const cases: [(string | number)[], unknown][] = [
    [['version'], 2],
    [['secret'], 'unexpected'],
    [['items', email, 'id'], 'foreign-id'],
    [['items', email, 'url'], 'javascript:alert(1)'],
    [['items', project, 'project', 'coverUrl'], 'http://example.com/image'],
    [['items', project, 'project', 'buttons', 0, 'url'], 'https://evil.example/'],
    [['items', collection, 'collection', 'items', 0, 'collection'], { type: 'game', items: [] }],
    [
      ['items', collection, 'collection', 'items', 0, 'interest', 'buttons', 0, 'url'],
      'javascript:alert(1)',
    ],
    [
      ['tab', 'ungrouped'],
      ['email', 'email'],
    ],
    [['items', email, 'aliases'], ['work']],
    [['tab', 'ungroupedPosition'], 4],
  ];
  for (const [path, value] of cases) {
    const bad = structuredClone(file);
    let target: unknown = bad;
    for (const key of path.slice(0, -1)) target = (target as Record<string, unknown>)[key];
    (target as Record<string, unknown>)[path.at(-1)!] = value;
    assert.throws(() => parseTabFile(bad));
  }
  assert.throws(() => parseTabFile({ padding: 'x'.repeat(TAB_FILE_LIMIT) }), /1 MB/);
});
test('import enforces combined tab, section, project and nested item limits', () => {
  const file = exportTab(sample(), 'favorites');
  const home = getProfileLayout(empty).tabs[0];
  assert.throws(
    () =>
      prepareTabImport(
        {
          ...empty,
          tabs: Array.from({ length: 5 }, (_, i) => ({ ...home, id: `t${i}`, slug: `t${i}` })),
        },
        file,
      ),
    /5 tabs/,
  );
  assert.throws(
    () =>
      prepareTabImport(
        {
          ...empty,
          sections: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, title: 'Section' })),
        },
        file,
      ),
    /20 sections/,
  );
  const many = {
    ...empty,
    links: Array.from({ length: 96 }, (_, i) => ({
      slug: `link${i}`,
      label: 'Link',
      platform: 'website' as const,
      url: 'https://example.com/',
      visible: true,
    })),
  };
  assert.throws(() => prepareTabImport(many, file), /100 items/);
  const project = sample().links.find((item) => item.kind === 'project')!;
  assert.throws(
    () =>
      prepareTabImport(
        { ...empty, links: Array.from({ length: 12 }, (_, i) => ({ ...project, slug: `p${i}` })) },
        file,
      ),
    /12 projects/,
  );
});
test('import action creates a new tab atomically and leaves default tab unchanged', () => {
  const source = sample(),
    file = exportTab(source, 'favorites');
  const result = change(empty, { action: 'import_tab', file });
  assert.equal(result.defaultTabId, 'home');
  assert.equal(result.tabs?.length, 2);
  assert.equal(result.links.length, 4);
  assert.deepEqual(empty.links, []);
});
