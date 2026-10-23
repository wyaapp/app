import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportTab, parseTabFile, prepareTabImport, TAB_FILE_LIMIT } from '../lib/tab-transfer.ts';
import { actionSchema, applyAction, type ProfileData } from '../lib/model.ts';
import { allItems } from '../lib/collections.ts';
import { applyProfileLayout, getProfileLayout } from '../lib/profile-tabs.ts';
import { compilePageDocument } from '../lib/page-document-actions.ts';
import { getPageSource, parsePageSource } from '../lib/page-documents.ts';
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

test('document-backed tab export/import keeps prose while remapping every copied identity and section', () => {
  const original = sample();
  const prose =
    '# My favorites\n\nText with **emphasis**, a [link](https://example.com), and a divider.\n\n---\n\n';
  const source = compilePageDocument(
    original,
    'favorites',
    prose + getPageSource(original, 'favorites'),
  );
  const file = exportTab(source, 'favorites');
  assert.ok(file.source?.startsWith(prose));
  assert.match(file.source!, /```wya-item/);
  assert.equal(file.source!.includes('::item{'), false);
  const imported = change(source, { action: 'import_tab', file });
  const tab = imported.tabs!.at(-1)!;
  const document = imported.documents![tab.id];
  assert.ok(document.startsWith(prose));
  assert.equal(imported.documents!.favorites, source.documents!.favorites);
  const parsed = parsePageSource(document);
  assert.equal(parsed.sections[0].id, tab.sections[0].id);
  assert.notEqual(parsed.sections[0].id, 'work-section');
  const oldIds = new Set(allItems(source.links).map((item) => item.id));
  for (const item of allItems(parsed.items.map(({ item }) => item))) {
    assert.ok(item.id && !oldIds.has(item.id));
    assert.equal(allItems(imported.links).find((saved) => saved.id === item.id)?.slug, item.slug);
  }
  const again = exportTab(imported, tab.id);
  assert.equal(again.source, document);
  assert.deepEqual(
    again.items.map((item) => item.slug),
    parsed.items.map(({ item }) => item.slug),
  );
});

test('legacy rich attribute imports become readable fences with copied redirects and identities', () => {
  const discord = {
    id: 'old-server-id',
    kind: 'discord' as const,
    slug: 'discord',
    aliases: ['community'],
    label: 'Our server',
    platform: 'discord' as const,
    url: '',
    visible: true,
    discord: { guildId: '771498135188799500' },
  };
  const data: ProfileData = { ...empty, links: [discord] };
  const file = exportTab(data, 'home');
  const prose = '# Our community\n\nJoin us below.\n\n';
  file.source = prose + `::item{data='${JSON.stringify(discord)}'}\n`;
  const imported = prepareTabImport(data, file);
  const source = imported.data.documents![imported.tab.id];
  assert.ok(source.startsWith(prose));
  assert.match(source, /```wya-item/);
  assert.equal(source.includes('::item{'), false);
  const copied = parsePageSource(source).items[0].item;
  assert.notEqual(copied.id, discord.id);
  assert.equal(copied.slug, 'discord-2');
  assert.deepEqual(copied.aliases, ['community-2']);
  assert.deepEqual(
    copied,
    imported.data.links.find((item) => item.slug === 'discord-2'),
  );
  assert.equal(exportTab(imported.data, imported.tab.id).source, source);
});

test('tab imports reject a source that disagrees with exported cards or sections', () => {
  const original = sample();
  const source = compilePageDocument(original, 'favorites', getPageSource(original, 'favorites'));
  const file = exportTab(source, 'favorites');
  assert.throws(() => parseTabFile({ ...file, source: '# Missing every card' }), /match/);
  assert.throws(
    () =>
      parseTabFile({ ...file, source: file.source!.replace('work-section', 'foreign-section') }),
    /match/,
  );
  assert.throws(
    () =>
      parseTabFile({
        ...file,
        source: file.source!.replace('hello@example.com', 'changed@example.com'),
      }),
    /match/,
  );
});

test('exporting a local layout draft synchronizes document structure without saving it', () => {
  const original = sample();
  const prose = '# Favorites\n\nNotes remain in the document.\n\n';
  const source = compilePageDocument(
    original,
    'favorites',
    prose + getPageSource(original, 'favorites'),
  );
  const before = JSON.stringify(source);
  const layout = getProfileLayout(source);
  const reordered = applyProfileLayout(source, {
    ...layout,
    tabs: layout.tabs.map((tab) =>
      tab.id === 'favorites'
        ? {
            ...tab,
            ungroupedPosition: 0,
            ungrouped: [...tab.ungrouped].reverse(),
            sections: tab.sections.map((section) => ({
              ...section,
              slugs: [...section.slugs].reverse(),
            })),
          }
        : tab,
    ),
  });
  const file = exportTab(reordered, 'favorites');
  const parsed = parsePageSource(file.source!);
  assert.ok(file.source!.startsWith(prose));
  assert.deepEqual(parsed.layout.ungrouped, ['solo', 'email']);
  assert.deepEqual(parsed.layout.sections[0].slugs, ['games', 'work']);
  assert.equal(parsed.layout.ungroupedPosition ?? 0, 0);
  assert.equal(JSON.stringify(source), before);
  assert.equal(reordered.documents!.favorites, source.documents!.favorites);
});
