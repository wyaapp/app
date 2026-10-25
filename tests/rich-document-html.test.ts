import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { LinkItem } from '../lib/profile-types.ts';
import {
  Editor,
  getSchema,
  createRichDocumentExtensions,
  richDocumentToMarkdown,
} from './helpers/rich-editor.ts';

const schema = getSchema(createRichDocumentExtensions());
const link: LinkItem = {
  id: 'saved-link',
  slug: 'website',
  label: 'My "website" & notes',
  url: 'https://example.com/',
  platform: 'website',
  icon: 'code',
  visible: false,
  aliases: ['site'],
};
const game: LinkItem = {
  id: 'saved-game',
  slug: 'chess',
  kind: 'interest',
  label: 'Chess',
  platform: 'website',
  url: 'https://example.com/chess',
  visible: true,
  interest: {
    type: 'game',
    note: 'My favorite',
    favorite: true,
    coverUrl: 'https://images.example/chess.png',
    catalog: { provider: 'igdb', id: 42, slug: 'chess' },
    buttons: [{ label: 'Play', url: 'https://example.com/chess' }],
  },
};

function output(node: ProseMirrorNode) {
  const spec = node.type.spec.toDOM!(node);
  assert.ok(Array.isArray(spec));
  return spec;
}

function parseAttributes(name: string, attrs: Record<string, unknown>, hasSectionContent = true) {
  const rule = schema.nodes[name].spec.parseDOM?.find((rule) => 'tag' in rule);
  assert.ok(rule?.getAttrs, `${name} has an HTML parser`);
  // Exercise the real schema's injected attribute parsers, including Tiptap's
  // automatic attributes. Native browser tests cover DOM selection/paste events.
  return rule.getAttrs({
    getAttribute: (name: string) => (attrs[name] == null ? null : String(attrs[name])),
    querySelector: () => (hasSectionContent ? {} : null),
  } as unknown as HTMLElement);
}

function roundTrip(node: ProseMirrorNode) {
  const html = output(node);
  const attrs = parseAttributes(node.type.name, html[1] as Record<string, unknown>);
  assert.notEqual(attrs, false);
  return node.type.create(attrs || null, node.content, node.marks);
}

for (const item of [
  link,
  game,
  {
    id: 'saved-project',
    slug: 'portfolio',
    kind: 'project',
    label: 'A project',
    platform: 'portfolio',
    url: 'https://example.com/project',
    visible: true,
    project: {
      description: 'Something I made.',
      coverUrl: 'https://images.example/project.png',
      buttons: [{ label: 'Visit', url: 'https://example.com/project' }],
    },
  },
  {
    id: 'saved-collection',
    slug: 'games',
    kind: 'collection',
    label: 'Games',
    platform: 'website',
    url: '',
    visible: true,
    collection: { type: 'game', items: [game] },
  },
  {
    id: 'saved-discord',
    slug: 'community',
    kind: 'discord',
    label: 'Community',
    platform: 'discord',
    url: '',
    visible: true,
    discord: { guildId: '12345678901234567' },
  },
] satisfies LinkItem[]) {
  test(`HTML preserves complete ${item.kind ?? 'link'} card data for native clipboard parsing`, () => {
    const node = schema.nodes.wyaItem.create({ item, clipboardOrigin: 'file:source' });
    assert.ok(roundTrip(node).eq(node));
    const serialized = output(node);
    assert.equal((serialized[1] as Record<string, unknown>)['data-wya-origin'], 'file:source');
    assert.ok(JSON.stringify(serialized).includes(item.label.replaceAll('"', '\\"')));
    const attrs = parseAttributes('wyaItem', {
      ...(serialized[1] as Record<string, unknown>),
      item: 'An unrelated HTML attribute cannot override the validated payload',
    });
    assert.deepEqual((attrs as { item: LinkItem }).item, item);
  });
}

test('custom card HTML rejects malformed and unsafe payloads', () => {
  for (const item of [
    null,
    [],
    { ...link, url: 'javascript:alert(1)' },
    { ...link, id: { unsafe: true } },
    { ...link, platform: 'made-up-platform' },
    { ...link, collection: { items: [] } },
    { ...game, interest: { ...game.interest, coverUrl: 'data:image/png;base64,AAAA' } },
  ]) {
    assert.equal(parseAttributes('wyaItem', { 'data-wya-card': JSON.stringify(item) }), false);
  }
  for (const payload of ['not JSON', '{', 'x'.repeat(128 * 1024 + 1)])
    assert.equal(parseAttributes('wyaItem', { 'data-wya-card': payload }), false);
});

test('sections preserve title, identity, and structural children without turning the title into a block', () => {
  const section = schema.nodes.wyaSection.create(
    { id: 'social', title: 'My "socials"', clipboardOrigin: 'page:home' },
    [
      schema.nodes.paragraph.create(null, schema.text('Hello')),
      schema.nodes.wyaItem.create({ item: link }),
    ],
  );
  assert.ok(roundTrip(section).eq(section));
  const rule = section.type.spec.parseDOM?.find((rule) => 'tag' in rule);
  assert.equal(
    rule && 'contentElement' in rule ? rule.contentElement : null,
    ':scope > [data-wya-section-content]',
  );
  const html = output(section);
  assert.deepEqual(html[2], ['h2', {}, 'My "socials"']);
  assert.deepEqual(html[3], ['div', { 'data-wya-section-content': '' }, 0]);
});

test('section HTML rejects oversized titles and missing content wrappers', () => {
  const attrs = { 'data-wya-section': 'social', 'data-wya-section-title': 'Social' };
  assert.equal(parseAttributes('wyaSection', attrs, false), false);
  assert.equal(
    parseAttributes('wyaSection', { ...attrs, 'data-wya-section-title': 'x'.repeat(61) }),
    false,
  );
});

test('ephemeral clipboard provenance is never serialized into Markdown', () => {
  const document = schema.nodes.doc.create(null, [
    schema.nodes.wyaSection.create(
      { id: 'social', title: 'Social', clipboardOrigin: 'private-space-id' },
      schema.nodes.wyaItem.create({ item: link, clipboardOrigin: 'private-space-id' }),
    ),
  ]);
  const markdown = richDocumentToMarkdown(document.toJSON(), '');
  assert.doesNotMatch(markdown, /clipboardOrigin|private-space-id|data-wya-origin/);
});

test('GIF HTML preserves provider, dimensions, source URL and display size', () => {
  for (const size of [null, 512, 'full']) {
    const gif = {
      provider: 'giphy',
      id: 'JIX9t2j0ZTN9S',
      title: 'A cat',
      width: 480,
      height: 270,
      sourceUrl: 'https://giphy.com/gifs/cat-JIX9t2j0ZTN9S',
      ...(size == null ? {} : { size }),
    };
    const node = schema.nodes.gif.create({ gif });
    assert.ok(roundTrip(node).eq(node));
    assert.equal(
      parseAttributes('gif', { 'data-gif-embed': JSON.stringify({ ...gif, provider: 'other' }) }),
      false,
    );
    assert.equal(
      parseAttributes('gif', {
        'data-gif-embed': JSON.stringify({ ...gif, sourceUrl: 'https://example.com/' }),
      }),
      false,
    );
  }
});

test('image HTML preserves custom/full width and rejects invalid size or URL', () => {
  for (const size of [null, 512, 'full']) {
    const image = schema.nodes.image.create({
      src: 'https://images.example/cat.png',
      alt: 'Cat',
      title: 'A cat',
      size,
    });
    assert.ok(roundTrip(image).eq(image));
  }
  for (const size of ['0', '119', '1921', '40%', 'Infinity'])
    assert.equal(
      parseAttributes('image', {
        src: 'https://images.example/cat.png',
        'data-wya-image-size': size,
      }),
      false,
    );
  assert.equal(
    parseAttributes('image', { src: 'javascript:alert(1)', 'data-wya-image-size': 'full' }),
    false,
  );
});

test('opaque Markdown blocks and inline nodes retain original source as inert text', () => {
  for (const [name, source] of [
    ['markdownBlock', '```js metadata\nconst value = "<script>";\n```'],
    ['markdownInline', '<script>alert("never execute")</script>'],
  ]) {
    const node = schema.nodes[name].create({ source });
    assert.ok(roundTrip(node).eq(node));
    assert.equal(output(node).at(-1), source);
  }
  const rule = schema.nodes.markdownBlock.spec.parseDOM?.find((rule) => 'tag' in rule);
  assert.ok((rule?.priority ?? 0) > 50, 'preserved source beats the ordinary pre/code parser');
});

test('plain text clipboard fallback includes readable atom content', () => {
  const editor = new Editor({
    element: null,
    extensions: createRichDocumentExtensions(),
    content: {
      type: 'doc',
      content: [
        { type: 'wyaItem', attrs: { item: link } },
        { type: 'gif', attrs: { gif: { provider: 'tenor', id: '123456789', title: 'A GIF' } } },
        { type: 'image', attrs: { src: 'https://images.example/image.png' } },
        { type: 'markdownBlock', attrs: { source: '<details>Original Markdown</details>' } },
      ],
    },
  });
  try {
    const text = editor.getText();
    for (const value of [
      link.label,
      link.url,
      'https://tenor.com/view/gif-123456789',
      'https://images.example/image.png',
      '<details>Original Markdown</details>',
    ])
      assert.ok(text.includes(value), value);
  } finally {
    editor.destroy();
  }
});
