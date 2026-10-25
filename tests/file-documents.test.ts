import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import {
  FILE_DOCUMENT_TAB_ID,
  parseFileDocument,
  publicFileDocument,
} from '../lib/file-documents.ts';
import { applyDocumentItemDraft } from '../lib/document-item-draft.ts';
import { parsePageSource, serializePageItem } from '../lib/page-documents.ts';
import { markdownToRichDocument, richDocumentToMarkdown } from '../lib/rich-document.ts';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import type { LinkItem } from '../lib/profile-types.ts';

const link: LinkItem = {
  slug: 'example',
  label: 'Example',
  platform: 'website',
  url: 'https://example.com/',
  visible: true,
};
const game: LinkItem = {
  slug: 'game',
  label: 'Game',
  kind: 'interest',
  platform: 'website',
  url: '',
  visible: true,
  interest: { type: 'game', note: '', favorite: false },
};
const card = (item: LinkItem) => serializePageItem(item, { preserveIdOmission: true });

test('file Wya cards coexist with unsupported Markdown and exact untouched round trips', () => {
  const opaque = [
    '::unknown[Keep]{data="untouched"}',
    ':::note[Note]\nUnknown container.\n:::',
    '<aside>Never evaluated.</aside>',
    '[Reference][ref]\n\n[ref]: https://example.com',
    '```js filename="example.js"\nconst value = 1;\n```',
  ];
  const source = `${opaque.join('\n\n')}\n\n:::section[Links]{id="links"}\n\n${card(link)}\n\n:::\n\nOriginal prose.\n`;
  const options = { preserveUnknown: true };
  assert.throws(() => parsePageSource(source));
  const parsed = parseFileDocument(source);
  assert.equal(parsed.source, source);
  assert.equal(parsed.data.links[0].id, 'legacy:example');
  assert.equal(parsed.data.links[0].sectionId, 'links');
  assert.equal(parsed.data.tabs![0].id, FILE_DOCUMENT_TAB_ID);
  const document = markdownToRichDocument(source, options);
  const schema = getSchema(createRichDocumentExtensions());
  const instance = schema.nodeFromJSON(document);
  instance.check();
  assert.equal(richDocumentToMarkdown(instance.toJSON(), source, options), source);
  document.content!.at(-1)!.content![0].text = 'Changed prose.';
  const changed = richDocumentToMarkdown(document, source, options);
  for (const block of opaque) assert.ok(changed.includes(block), block);
  assert.equal(parseFileDocument(changed).data.links[0].slug, 'example');
  assert.ok(changed.includes('Changed prose.'));
});

test('file mode retains explicit IDs and normalizes only changed card payloads', () => {
  const prefix = '# Keep   spacing\n\n::unknown[Keep]\n\n';
  const suffix = '\n\nLast   line.\n';
  const source =
    prefix + card({ ...link, id: 'independent-file-id', url: 'https://example.com' }) + suffix;
  const parsed = parseFileDocument(source);
  assert.equal(parsed.data.links[0].id, 'independent-file-id');
  assert.equal(parsed.data.links[0].url, 'https://example.com/');
  assert.ok(parsed.source.startsWith(prefix));
  assert.ok(parsed.source.endsWith(suffix));
  assert.equal(parseFileDocument(parsed.source).source, parsed.source);
  const edited = applyDocumentItemDraft(
    parsed.data,
    parsed.data,
    {
      action: 'upsert_link',
      originalSlug: 'example',
      slug: 'renamed',
      platform: 'website',
      label: 'Changed',
      destination: 'https://example.org',
    },
    FILE_DOCUMENT_TAB_ID,
  );
  assert.equal(edited.id, 'independent-file-id');
  assert.equal(edited.slug, 'renamed');
  assert.equal(parsed.data.links[0].slug, 'example');
});

test('recognized invalid Wya never falls back to generic Markdown in file mode', () => {
  for (const source of [
    '::link[Missing]{slug="missing"}',
    '::link[Open label',
    '::link[X]{slug="x" url="https://example.com" onclick="bad"}',
    ':link[Inline]{slug="inline" url="https://example.com"}',
    '> ::link[Nested]{slug="nested" url="https://example.com"}',
    ':::section[Open]{id="open"}\nText',
    '```wya-item\nnot JSON\n```',
    '```wya-item extra\n{}\n```',
    '::gif{provider="evil" id="bad"}',
    `${card(link)}\n\n${card(link)}`,
  ]) {
    assert.throws(() => parseFileDocument(`::unknown[Keep]\n\n${source}`), source);
    assert.throws(() => markdownToRichDocument(source, { preserveUnknown: true }), source);
  }
  const literal = '```md\n::link[Missing]{slug="missing"}\n```';
  assert.equal(parseFileDocument(literal).source, literal);
  assert.deepEqual(parseFileDocument(literal).data.links, []);
});

test('file cards reuse strict URL, payload, alias, identity and collection validation', () => {
  const collection: LinkItem = {
    ...link,
    slug: 'games',
    kind: 'collection',
    url: '',
    collection: { type: 'game', items: [game] },
  };
  for (const item of [
    { ...link, url: 'javascript:alert(1)' },
    { ...link, url: 'https://user:password@example.com/' },
    { ...game, extra: 'unexpected' },
    { ...game, interest: { ...game.interest, coverUrl: 'http://example.com/image.png' } },
    { ...collection, collection: { type: 'game', items: [collection] } },
    { ...collection, collection: { type: 'game', items: Array(21).fill(game) } },
    { ...collection, collection: { type: 'game', items: [null] } },
    { ...collection, collection: { type: 'game', items: {} } },
    { ...collection, id: 'same', collection: { type: 'game', items: [{ ...game, id: 'same' }] } },
  ]) {
    const source = item.kind
      ? `\`\`\`wya-item\n${JSON.stringify(item)}\n\`\`\``
      : card(item as LinkItem);
    assert.throws(() => parseFileDocument(source));
    assert.throws(() => publicFileDocument(source));
  }
  assert.throws(() =>
    parseFileDocument(`${card(link)}\n\n${card({ ...game, aliases: ['example'] })}`),
  );
  let nested: unknown = game;
  for (let index = 0; index < 30; index++)
    nested = { ...collection, collection: { type: 'game', items: [nested] } };
  assert.throws(
    () => parseFileDocument(`\`\`\`wya-item\n${JSON.stringify(nested)}\n\`\`\``),
    /cannot contain other collections/,
  );
});

test('blank section titles remain editable and publication validates them', () => {
  const source = ':::section{id="section"}\n\nNotes.\n\n:::\n';
  assert.equal(parseFileDocument(source).data.tabs![0].sections[0].title, '');
  assert.throws(() => parseFileDocument(source, { publish: true }), /valid sections/);
  assert.throws(() => publicFileDocument(source), /valid sections/);
  assert.throws(
    () => parseFileDocument(':::section[Title]{id="invalid id"}\n:::'),
    /valid sections/,
  );
});

test('public file source removes hidden payloads and retains surrounding Markdown exactly', () => {
  const hidden = { ...link, slug: 'hidden', label: 'PRIVATE ROOT', visible: false };
  const collection: LinkItem = {
    ...link,
    slug: 'games',
    kind: 'collection',
    url: '',
    collection: {
      type: 'game',
      items: [game, { ...game, slug: 'hidden-game', visible: false, label: 'PRIVATE CHILD' }],
    },
  };
  const prefix = '# Public notes\n\n::unknown[Keep]\n\n';
  const source = `${prefix}${card(hidden)}\n\n:::section[Games]{id="games"}\n\n${card(collection)}\n\n:::\n`;
  const result = publicFileDocument(source);
  assert.ok(result.startsWith(prefix));
  assert.ok(!result.includes('PRIVATE ROOT'));
  assert.ok(!result.includes('PRIVATE CHILD'));
  const parsed = parseFileDocument(result);
  assert.equal(parsed.data.links.length, 1);
  assert.equal(parsed.data.links[0].collection!.items.length, 1);
  const empty = {
    ...collection,
    collection: { type: 'game' as const, items: [{ ...game, visible: false }] },
  };
  assert.deepEqual(parseFileDocument(publicFileDocument(card(empty))).data.links, []);
});
