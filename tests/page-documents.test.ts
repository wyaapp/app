import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPageSource,
  MAX_PAGE_DOCUMENT_BYTES,
  normalizePageSource,
  parsePageSource,
  publicPageDocuments,
  serializePageItem,
  syncPageDocuments,
} from '../lib/page-documents.ts';
import { applyProfileLayout, getProfileLayout, removeProfileTab } from '../lib/profile-tabs.ts';
import type { LinkItem, ProfileData } from '../lib/profile-types.ts';

const link = (slug: string, extra: Partial<LinkItem> = {}): LinkItem => ({
  id: `id-${slug}`,
  slug,
  label: slug,
  url: `https://example.com/${slug}`,
  platform: 'website',
  visible: true,
  ...extra,
});

const base: ProfileData = {
  name: 'Alex',
  bio: '',
  theme: 'lilac',
  links: [link('code'), link('social'), link('hidden', { visible: false })],
  tabs: [
    {
      id: 'home',
      title: 'Links',
      slug: 'home',
      ungrouped: ['code'],
      sections: [{ id: 'socials', title: 'Socials', slugs: ['social', 'hidden'] }],
    },
    { id: 'work', title: 'Work', slug: 'work', ungrouped: [], sections: [] },
  ],
  defaultTabId: 'home',
};

const source = [
  '# My links',
  '',
  '<!-- Keep this exact comment. -->',
  '',
  '- List with   spacing',
  '- [Ordinary link][ref]',
  '',
  serializePageItem(base.links[0]),
  '',
  '> A note between blocks.',
  '',
  ':::section[Socials]{id="socials"}',
  'Some **section prose**.',
  '',
  serializePageItem(base.links[1]),
  '',
  '---',
  '',
  serializePageItem(base.links[2]),
  '',
  'Keep the final paragraph.',
  ':::',
  '',
  '[ref]: https://example.com "Original title"',
  '',
].join('\n');

const withSource: ProfileData = {
  ...base,
  documents: { home: source, work: '## Work notes\n\nKeep this paragraph.\n' },
};

test('legacy tab conversion preserves IDs, aliases, hidden cards and section order', () => {
  const original = structuredClone(base);
  original.links[0] = { ...original.links[0], aliases: ['old-code', 'github'] };
  delete original.links[0].id;
  const parsed = parsePageSource(getPageSource(original, 'home'));
  assert.deepEqual(
    parsed.layout,
    original.tabs![0] && {
      ungrouped: ['code'],
      sections: [{ id: 'socials', title: 'Socials', slugs: ['social', 'hidden'] }],
    },
  );
  assert.equal(parsed.items[0].item.id, 'legacy:code');
  assert.deepEqual(parsed.items[0].item.aliases, ['old-code', 'github']);
  assert.equal(parsed.items[2].item.visible, false);
  assert.equal(parsed.items[2].sectionId, 'socials');
  assert.equal(original.documents, undefined);
});

test('plain Markdown remains plain, including literal directives inside code fences', () => {
  const value =
    '# Heading\n\n[Link](https://example.com)\n\n---\n\n```md\n::unknown{secret="a"}\n```\n';
  const parsed = parsePageSource(value);
  assert.equal(parsed.items.length, 0);
  assert.deepEqual(
    parsed.tree.children.map((node) => node.type),
    ['heading', 'paragraph', 'thematicBreak', 'code'],
  );
});

test('ordinary colons and unknown inline syntax remain literal Markdown text', () => {
  for (const value of ['Ratio 1:2', 'Hello :name', 'Use :plugin[options] here.']) {
    const parsed = parsePageSource(value);
    const paragraph = parsed.tree.children[0];
    assert.equal(paragraph.type, 'paragraph');
    if (paragraph.type === 'paragraph')
      assert.equal(
        paragraph.children.map((child) => (child.type === 'text' ? child.value : '')).join(''),
        value,
      );
  }
});

test('serializer escapes titles and complete rich payloads without losing punctuation', () => {
  const values = [
    link('quoted', {
      label: 'A [link] "quoted" & bold *literal*',
      url: 'https://example.com/?a="quoted"&b=1',
    }),
    link('project', {
      kind: 'project',
      project: {
        description: 'A "project" with \'quotes\', [brackets] & lines\nsecond.',
        buttons: [],
      },
    }),
    link('discord', { kind: 'discord', discord: { guildId: '771498135188799500' } }),
    link('games', {
      kind: 'collection',
      collection: { type: 'game', items: [link('game', { visible: false })] },
    }),
  ];
  for (const value of values) {
    const actual = parsePageSource(serializePageItem(value)).items[0].item;
    assert.deepEqual(actual, value);
  }
});

test('rich cards serialize as readable JSON blocks without HTML entity escapes', () => {
  const item = link('games', {
    kind: 'collection',
    label: 'Games I still play',
    aliases: ['favorites'],
    collection: {
      type: 'game',
      items: [
        link('game', {
          kind: 'interest',
          interest: {
            type: 'game',
            favorite: true,
            note: 'Quotes "stay", & entities like &#x22; are literal.\n```\n::item',
            buttons: [],
          },
        }),
      ],
    },
  });
  const source = serializePageItem(item);
  assert.match(source, /^`{3,}wya-item\n\{\n  "id": "id-games",/);
  assert.ok(source.includes('"label": "Games I still play"'));
  assert.ok(!source.includes('&#x22;id&#x22;'));
  assert.deepEqual(parsePageSource(source).items[0].item, item);
  const section = `:::section[Games]{id="games-section"}\n\n${source}\n\n:::\n`;
  assert.equal(parsePageSource(section).items[0].sectionId, 'games-section');
});

test('existing escaped rich blocks upgrade without rewriting Markdown or inventing IDs', () => {
  const item = link('project', {
    kind: 'project',
    project: { description: 'A "project" & a literal &#x22;', buttons: [] },
  });
  delete item.id;
  const legacy = `::item{data="${JSON.stringify(item).replaceAll('&', '&amp;').replaceAll('"', '&#x22;')}"}`;
  const before = '# Notes\n\nKeep   these *spaces*.\n\n:::section[Work]{id="work"}\n\n';
  const after = '\n\nMore notes.\n:::\n\n```md\n::item{data="example"}\n```\n';
  const original = before + legacy + after;
  const normalized = normalizePageSource(original);
  assert.ok(normalized.startsWith(before));
  assert.ok(normalized.endsWith(after));
  assert.ok(normalized.includes('```wya-item\n{'));
  assert.deepEqual(parsePageSource(normalized).items[0].item, item);
  assert.equal(normalizePageSource(normalized), normalized);
  const data = {
    ...base,
    links: [item],
    tabs: [
      {
        ...base.tabs![0],
        ungrouped: [],
        sections: [{ id: 'work', title: 'Work', slugs: ['project'] }],
      },
    ],
    documents: { home: original },
  };
  assert.equal(getPageSource(data, 'home'), normalized);
  assert.equal(data.documents.home, original);
  assert.throws(() => normalizePageSource(original.replace(legacy, '::item{data="unfinished')));
});

test('rich code blocks reject incomplete fences, invalid payloads and nested placement', () => {
  const item = link('discord', { kind: 'discord', discord: { guildId: '771498135188799500' } });
  const source = serializePageItem(item);
  for (const invalid of [
    source.replace(/\n`+$/, ''),
    '```wya-item\n{}\n```',
    '```wya-item\nnot JSON\n```',
    '```wya-item\n[]\n```',
    source.replace('wya-item', 'wya-item extra'),
    source
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
  ])
    assert.throws(() => parsePageSource(invalid), invalid);
  assert.deepEqual(parsePageSource(source.replaceAll('```', '~~~')).items[0].item, item);
  const ordinary = source.replace('wya-item', 'json');
  assert.equal(parsePageSource(ordinary).items.length, 0);
  assert.equal(normalizePageSource(ordinary), ordinary);
});

test('invalid extension forms, duplicate identities, attributes and oversized sources fail clearly', () => {
  for (const value of [
    '::unknown[No]',
    ':link[Inline]{slug="x" url="https://example.com"}',
    '::link[Missing URL]{slug="x"}',
    '::link[Unclosed label',
    '::link[X]{slug="x" url="https://example.com" onclick="unsafe"}',
    '::link[X]{slug="x" url="https://example.com" visible="maybe"}',
    ':::section[No ID]\ntext\n:::',
    ':::section[Open]{id="x"}\ntext',
    ':::section[Outer]{id="outer"}\n:::section[Inner]{id="inner"}\n:::\n:::',
    '> ::link[Quoted]{slug="x" url="https://example.com"}',
    '::item{data="not JSON"}',
    '::item{data=\'{"kind":"script"}\'}',
    `${serializePageItem(link('a'))}\n\n${serializePageItem(link('a'))}`,
    `${serializePageItem(link('a'))}\n\n${serializePageItem(link('b', { id: 'id-a' }))}`,
    ':::section[A]{id="a"}\n:::\n\n:::section[B]{id="a"}\n:::',
  ])
    assert.throws(() => parsePageSource(value), value);
  assert.throws(() => parsePageSource('a'.repeat(MAX_PAGE_DOCUMENT_BYTES + 1)), /128 KB/);
  assert.throws(() => parsePageSource('é'.repeat(MAX_PAGE_DOCUMENT_BYTES / 2 + 1)), /128 KB/);
  assert.throws(() => parsePageSource('Before\0after'), /null characters/);
});

test('unchanged visual edits preserve the full source byte-for-byte', () => {
  const next = syncPageDocuments(withSource, structuredClone(withSource));
  assert.equal(next.documents!.home, source);
  assert.deepEqual(next.documents, withSource.documents);
  assert.equal(withSource.documents!.home, source);
});

test('editing card fields and renaming sections replaces only their directive spans', () => {
  const next = structuredClone(withSource);
  next.links[0].label = 'New code label';
  next.links[0].url = 'https://example.net/new';
  next.tabs![0].sections[0].title = 'New section';
  const actual = syncPageDocuments(withSource, next).documents!.home;
  const expected = source
    .replace(serializePageItem(base.links[0]), serializePageItem(next.links[0]))
    .replace(':::section[Socials]{id="socials"}', ':::section[New section]{#socials}');
  assert.equal(actual, expected);
  assert.equal(parsePageSource(actual).items[0].item.url, next.links[0].url);
});

test('renaming a card slug uses stable identity and preserves authored surrounding content', () => {
  const next = structuredClone(withSource);
  next.links[0].slug = 'github';
  next.links[0].aliases = ['code'];
  next.tabs![0].ungrouped = ['github'];
  const actual = syncPageDocuments(withSource, next).documents!.home;
  assert.equal(
    actual,
    source.replace(serializePageItem(base.links[0]), serializePageItem(next.links[0])),
  );
  assert.deepEqual(parsePageSource(actual).items[0].item.aliases, ['code']);
});

test('reordering cards and moving a section across documents preserves all ordinary Markdown', () => {
  const next = structuredClone(withSource);
  next.tabs![0].sections = [];
  next.tabs![1].sections = [{ id: 'socials', title: 'Socials', slugs: ['hidden', 'social'] }];
  const actual = syncPageDocuments(withSource, next);
  assert.ok(actual.documents!.home.includes('<!-- Keep this exact comment. -->'));
  assert.ok(actual.documents!.home.includes('- List with   spacing'));
  assert.ok(actual.documents!.home.includes('> A note between blocks.'));
  assert.ok(actual.documents!.home.includes('[ref]: https://example.com "Original title"'));
  assert.ok(!actual.documents!.home.includes('Some **section prose**.'));
  assert.ok(actual.documents!.work.includes('Some **section prose**.'));
  assert.ok(actual.documents!.work.includes('Keep the final paragraph.'));
  assert.ok(actual.documents!.work.includes('## Work notes\n\nKeep this paragraph.'));
  assert.deepEqual(
    parsePageSource(actual.documents!.work).items.map(({ item }) => item.slug),
    ['hidden', 'social'],
  );
});

test('moving cards to another document removes only the old directive and keeps notes', () => {
  const next = structuredClone(withSource);
  next.tabs![0].ungrouped = [];
  next.tabs![1].ungrouped = ['code'];
  const actual = syncPageDocuments(withSource, next);
  assert.ok(!actual.documents!.home.includes('slug="code"'));
  assert.ok(actual.documents!.home.includes('> A note between blocks.'));
  assert.equal(parsePageSource(actual.documents!.work).items[0].item.id, 'id-code');
  assert.ok(actual.documents!.work.startsWith('## Work notes\n\nKeep this paragraph.'));
});

test('deleting a section unwraps its authored prose instead of deleting it', () => {
  const next = structuredClone(withSource);
  next.tabs![0].sections = [];
  next.tabs![0].ungrouped = ['code', 'social', 'hidden'];
  const actual = syncPageDocuments(withSource, next).documents!.home;
  assert.equal(parsePageSource(actual).sections.length, 0);
  assert.ok(actual.includes('Some **section prose**.'));
  assert.ok(actual.includes('Keep the final paragraph.'));
  assert.ok(actual.includes('---'));
  assert.deepEqual(
    parsePageSource(actual).items.map(({ item }) => item.slug),
    ['code', 'social', 'hidden'],
  );
});

test('publishing normalized items inserts explicit IDs without touching ordinary Markdown', () => {
  const original =
    'Intro text.\n\n::link[Code]{slug="code" url="https://example.com/code"}\n\nFooter.\n';
  const normalized = {
    ...base,
    documents: { home: original },
    links: [link('code')],
    tabs: [{ ...base.tabs![0], sections: [] }],
  };
  const result = syncPageDocuments(normalized, normalized).documents!.home;
  assert.ok(result.startsWith('Intro text.\n\n'));
  assert.ok(result.endsWith('\n\nFooter.\n'));
  assert.equal(parsePageSource(result).items[0].item.id, 'id-code');
});

test('public sources remove private cards, hidden tabs and filtered collection members', () => {
  const collection = link('games', {
    kind: 'collection',
    collection: {
      type: 'game',
      items: [link('public-game'), link('secret-game', { visible: false })],
    },
  });
  const original: ProfileData = {
    ...withSource,
    links: [...withSource.links, collection],
    tabs: [
      { ...withSource.tabs![0], ungrouped: ['code', 'games'] },
      { ...withSource.tabs![1], hidden: true },
    ],
    documents: {
      ...withSource.documents,
      home: `${source}\n${serializePageItem(collection)}\n`,
      work: 'Private text',
    },
  };
  const safe: ProfileData = {
    ...original,
    links: original.links
      .filter((item) => item.visible)
      .map((item) =>
        item.collection
          ? {
              ...item,
              collection: {
                ...item.collection,
                items: item.collection.items.filter((entry) => entry.visible),
              },
            }
          : item,
      ),
  };
  const published = publicPageDocuments(safe);
  assert.equal(published.work, undefined);
  assert.ok(!published.home.includes('secret-game'));
  assert.ok(!published.home.includes('id-hidden'));
  assert.ok(published.home.includes('public-game'));
  assert.ok(published.home.includes('<!-- Keep this exact comment. -->'));
  assert.equal(parsePageSource(published.home).items.length, 3);
  assert.deepEqual(publicPageDocuments({ ...original, tabs: [], links: [] }), {});
});

test('new tabs get document content while existing document sources stay intact', () => {
  const next = structuredClone(withSource);
  next.tabs!.push({ id: 'new', title: 'New', slug: 'new', ungrouped: [], sections: [] });
  const actual = syncPageDocuments(withSource, next);
  assert.equal(actual.documents!.home, source);
  assert.equal(actual.documents!.work, withSource.documents!.work);
  assert.equal(actual.documents!.new, '');
  assert.equal(getProfileLayout(actual).tabs.length, 3);
});

test('explicit empty aliases remain distinguishable from an omitted aliases attribute', () => {
  const original = '::link[Code]{slug="code" url="https://example.com"}';
  assert.equal(parsePageSource(original).items[0].item.aliases, undefined);
  assert.deepEqual(
    parsePageSource(original.replace('}', ' aliases=""}')).items[0].item.aliases,
    [],
  );
});

test('prototype-named tab IDs behave as ordinary document keys', () => {
  const original: ProfileData = {
    ...base,
    links: [],
    tabs: [{ id: '__proto__', title: 'Notes', slug: 'notes', sections: [], ungrouped: [] }],
    defaultTabId: '__proto__',
    documents: Object.fromEntries([['__proto__', '# My notes\n']]),
  };
  const synced = syncPageDocuments(original, original);
  assert.ok(Object.hasOwn(synced.documents!, '__proto__'));
  assert.equal(synced.documents!.__proto__, '# My notes\n');
  const published = publicPageDocuments(original);
  assert.ok(Object.hasOwn(published, '__proto__'));
  assert.equal(published.__proto__, '# My notes\n');
  assert.equal(Object.getPrototypeOf(published), Object.prototype);
});

test('removing a tab moves source-only notes with its cards and sections', () => {
  const layout = removeProfileTab(getProfileLayout(withSource), 'home', 'work');
  const next = applyProfileLayout(withSource, layout);
  const actual = syncPageDocuments(withSource, next);
  assert.equal(actual.documents!.home, undefined);
  const value = actual.documents!.work;
  assert.ok(value.includes('<!-- Keep this exact comment. -->'));
  assert.ok(value.includes('> A note between blocks.'));
  assert.ok(value.includes('Some **section prose**.'));
  assert.ok(value.includes('Keep the final paragraph.'));
  assert.ok(value.includes('[ref]: https://example.com "Original title"'));
  assert.equal(parsePageSource(value).items.length, 3);
});
