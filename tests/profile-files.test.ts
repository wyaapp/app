import test from 'node:test';
import assert from 'node:assert/strict';
import { publicProfileFiles, profileFileLinks } from '../lib/profile-files.ts';
import { visibleProfile } from '../lib/public-profile.ts';
import { fileForFragment, fileFragmentTarget } from '../lib/page-fragments.ts';
import { documentCardDomId, indexedDocumentCard } from '../lib/document-card-links.ts';
import { parseFileDocument } from '../lib/file-documents.ts';
import { serializePageItem } from '../lib/page-documents.ts';
import type { LinkItem, Profile } from '../lib/profile-types.ts';
import type { SpaceFile } from '../lib/space-files.ts';

const item = (slug: string, extra: Partial<LinkItem> = {}): LinkItem => ({
  id: `id-${slug}`,
  slug,
  label: slug,
  platform: 'website',
  url: `https://example.com/${slug}`,
  visible: true,
  ...extra,
});
const source = (...items: LinkItem[]) =>
  items.map((value) => serializePageItem(value)).join('\n\n');
const file = (id: string, content: string, extra: Partial<SpaceFile> = {}): SpaceFile => ({
  id,
  name: `${id}.md`,
  content,
  size: content.length,
  version: 1,
  published: true,
  hasChanges: false,
  pinned: false,
  folderId: null,
  position: 0,
  updatedAt: '2026-10-27T12:00:00.000Z',
  ...extra,
});
const profile = (files: SpaceFile[], extra: Partial<Profile> = {}): Profile => ({
  id: 'space',
  handle: 'alex',
  name: 'Alex',
  bio: '',
  theme: 'lilac',
  version: 1,
  updatedAt: '',
  aliases: [],
  files,
  links: profileFileLinks(files, true),
  ...extra,
});

test('public file projection exposes the published snapshot and never a pending draft', () => {
  const owner = file('one', '# PRIVATE DRAFT', {
    name: 'private-name.md',
    hasChanges: true,
    appearance: { theme: 'black' },
    publishedName: 'public.md',
    publishedContent: '# Public\n\n' + source(item('public')),
    publishedAppearance: { theme: 'dim' },
    publishedAt: '2026-10-25T12:00:00.000Z',
    legacyTabId: 'home',
  });
  const original = structuredClone(owner);
  const [published] = publicProfileFiles([owner]);
  assert.equal(published.name, 'public.md');
  assert.ok(published.content.includes('# Public'));
  assert.ok(!JSON.stringify(published).includes('PRIVATE'));
  assert.deepEqual(published.appearance, { theme: 'dim' });
  assert.equal(published.legacyTabId, 'home');
  assert.equal(published.version, 0);
  assert.equal(published.hasChanges, false);
  assert.equal(published.updatedAt, '2026-10-25T12:00:00.000Z');
  assert.ok(!Object.hasOwn(published, 'publishedAt'));
  assert.equal(published.size, new TextEncoder().encode(published.content).length);
  assert.ok(!Object.hasOwn(published, 'publishedContent'));
  assert.ok(!Object.hasOwn(published, 'publishedName'));
  assert.deepEqual(publicProfileFiles([published]), [published]);
  assert.deepEqual(owner, original);
});

test('unpublished, malformed, and incomplete owner snapshots fail closed', () => {
  const files = [
    file('private', '# Secret', { published: false }),
    file('missing', '# Unpublished changes', { hasChanges: true }),
    file('broken', '::link[Missing]{slug="missing"}'),
    file('good', '# Good'),
  ];
  assert.deepEqual(
    publicProfileFiles(files).map((value) => value.id),
    ['good'],
  );
  const [noAppearance] = publicProfileFiles([
    file('changed', '# Draft', {
      hasChanges: true,
      appearance: { theme: 'black' },
      publishedName: 'published.md',
      publishedContent: '# Published',
    }),
  ]);
  assert.equal(noAppearance.appearance, undefined);
});

test('public file content and its index both omit private cards and collection children', () => {
  const game = item('game', {
    kind: 'interest',
    url: '',
    interest: { type: 'game', note: '', favorite: false },
  });
  const files = [
    file(
      'games',
      source(
        item('hidden', { label: 'PRIVATE ROOT', visible: false }),
        item('games', {
          kind: 'collection',
          url: '',
          collection: {
            type: 'game',
            items: [
              game,
              {
                ...game,
                id: 'private-game',
                slug: 'private-game',
                label: 'PRIVATE CHILD',
                visible: false,
              },
            ],
          },
        }),
      ),
    ),
  ];
  const [publicFile] = publicProfileFiles(files);
  assert.ok(!publicFile.content.includes('PRIVATE'));
  const links = profileFileLinks(files, true);
  assert.deepEqual(
    links.map((value) => value.slug),
    ['games'],
  );
  assert.equal(links[0].fileId, 'games');
  assert.deepEqual(
    links[0].collection?.items.map((value) => [value.slug, value.fileId]),
    [['game', 'games']],
  );
  assert.equal(parseFileDocument(publicFile.content).data.links[0].collection?.items.length, 1);
});

test('migrated short URLs and aliases retain ownership when ordinary copies collide or reorder', () => {
  const original = file('z-original', source(item('portfolio', { aliases: ['work'] })), {
    legacyTabId: 'home',
    position: 20,
  });
  const copy = file(
    'a-copy',
    source(item('portfolio'), item('another', { aliases: ['work', 'another-old'] })),
    { position: 0 },
  );
  const index = profileFileLinks([copy, original], true);
  assert.deepEqual(
    index.map((value) => [value.slug, value.fileId, value.aliases]),
    [
      ['portfolio', 'z-original', ['work']],
      ['another', 'a-copy', ['another-old']],
    ],
  );
  assert.deepEqual(
    profileFileLinks(
      [
        { ...copy, position: 50 },
        { ...original, position: 0 },
      ],
      true,
    ),
    index,
  );
});

test('ordinary duplicate index ownership uses stable identity, not navigation positions', () => {
  const a = file('a', source(item('same')), { position: 10 });
  const b = file('b', source(item('same')), { position: 0 });
  assert.equal(profileFileLinks([b, a], true)[0].fileId, 'a');
  assert.deepEqual(
    publicProfileFiles([a, b]).map((value) => value.id),
    ['b', 'a'],
  );
});

test('plain text never creates a short-link index and unpublished cards index only for owner adapters', () => {
  const files = [
    file('text', source(item('literal')), { name: 'notes.txt' }),
    file('private', source(item('draft')), { published: false }),
  ];
  assert.deepEqual(profileFileLinks(files, true), []);
  assert.deepEqual(
    profileFileLinks(files, false).map((value) => value.slug),
    ['draft'],
  );
  assert.equal(publicProfileFiles(files)[0].content, files[0].content);
});

test('file-based public profiles drop legacy layouts and derive default file from published files', () => {
  const owner = profile(
    [
      file('hidden', '# Secret', { published: false, position: 0 }),
      file('second', '# Second', { position: 2 }),
      file('first', source(item('first')), { position: 1 }),
    ],
    {
      defaultFileId: 'hidden',
      defaultTabId: 'private',
      documents: { private: '# PRIVATE LEGACY' },
      tabs: [
        {
          id: 'private',
          slug: 'private',
          title: 'Private',
          hidden: true,
          sections: [],
          ungrouped: [],
        },
      ],
      sections: [],
      ungroupedPosition: 0,
      links: [item('stale-index')],
    },
  );
  const before = structuredClone(owner);
  const visible = visibleProfile(owner);
  assert.deepEqual(
    visible.files?.map((value) => value.id),
    ['first', 'second'],
  );
  assert.equal(visible.defaultFileId, 'first');
  assert.deepEqual(
    visible.links.map((value) => value.slug),
    ['first'],
  );
  for (const key of ['tabs', 'documents', 'defaultTabId', 'sections', 'ungroupedPosition']) {
    assert.ok(!Object.hasOwn(visible, key), key);
  }
  assert.deepEqual(visibleProfile(visible), visible);
  assert.deepEqual(owner, before);
  assert.deepEqual(visibleProfile(profile([], { links: [item('old')] })).links, []);
});

test('file bookmarks select actual files and legacy bookmarks prefer the published index owner', () => {
  const game = item('game', {
    kind: 'interest',
    url: '',
    interest: { type: 'game', note: '', favorite: false },
  });
  const original = file(
    'original',
    source(
      item('games', { kind: 'collection', url: '', collection: { type: 'game', items: [game] } }),
    ),
    { legacyTabId: 'games' },
  );
  const copy = { ...original, id: 'copy', legacyTabId: undefined };
  const data = profile([copy, original]);
  assert.equal(fileForFragment(data, 'widget-id-games')?.id, 'original');
  assert.equal(fileForFragment(data, 'interest-id-game')?.id, 'original');
  assert.equal(fileForFragment(data, 'file-copy-widget-id-games')?.id, 'copy');
  assert.equal(fileForFragment(data, 'file-original-interest-id-game')?.id, 'original');
  assert.equal(fileForFragment(data, 'widget-unknown'), undefined);
  assert.equal(fileForFragment(data, ''), undefined);
  assert.equal(fileFragmentTarget('original', 'widget-id-games'), 'file-original-widget-id-games');
  assert.equal(
    fileFragmentTarget('original', 'file-original-widget-id-games'),
    'file-original-widget-id-games',
  );
});

test('card context grants short-link ownership only to the indexed file and card identity', () => {
  const link = { ...item('link'), fileId: 'original' };
  const child = { ...item('child'), fileId: 'original' };
  const links = [
    link,
    { ...item('collection'), collection: { type: 'game' as const, items: [child] } },
  ];
  assert.equal(indexedDocumentCard(links, 'original', link), link);
  assert.equal(indexedDocumentCard(links, 'original', { slug: link.slug }), link);
  assert.equal(indexedDocumentCard(links, 'original', child), child);
  assert.equal(indexedDocumentCard(links, 'copy', link), undefined);
  assert.equal(indexedDocumentCard(links, 'original', { ...link, id: 'changed' }), undefined);
  assert.equal(documentCardDomId('original', 'interest', link), 'file-original-interest-id-link');
  assert.equal(documentCardDomId(null, 'interest', { slug: 'legacy' }), 'interest-legacy');
});

test('malformed stored widgets fail closed while supported published widgets render normally', () => {
  const files = [
    file('code', '```js\nconsole.log(1);\n```', { name: 'Code.widget' }),
    file('bad', '# Unsupported header', { name: 'Bad.widget' }),
    file('empty', '', { name: 'Empty.widget' }),
    file('multiple', '```js\none\n```\n\n```js\ntwo\n```', { name: 'Multiple.widget' }),
    file(
      'hidden',
      source(
        item('secret', {
          kind: 'discord',
          platform: 'discord',
          url: '',
          visible: false,
          discord: { guildId: '771498135188799500' },
        }),
      ),
      { name: 'Secret.widget' },
    ),
  ];
  assert.deepEqual(
    publicProfileFiles(files).map((file) => file.id),
    ['code'],
  );
  assert.deepEqual(profileFileLinks(files, true), []);
});
