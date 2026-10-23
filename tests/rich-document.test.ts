import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, getSchema, type JSONContent } from '@tiptap/core';
import { EditorState, NodeSelection, Selection } from '@tiptap/pm/state';
import { wrapIn } from '@tiptap/pm/commands';
import { wrapInList } from '@tiptap/pm/schema-list';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import { markdownToRichDocument, richDocumentToMarkdown } from '../lib/rich-document.ts';
import { parsePageSource, serializePageItem } from '../lib/page-documents.ts';
import { compilePageDocument } from '../lib/page-document-actions.ts';
import type { LinkItem, ProfileData } from '../lib/profile-types.ts';

const item: LinkItem = {
  id: 'stable-github',
  slug: 'github',
  label: 'GitHub',
  url: 'https://github.com/example',
  platform: 'github',
  icon: 'code',
  aliases: ['code', 'git'],
  visible: false,
};

const source = [
  '# My **links**',
  '',
  'A paragraph with *emphasis*, **bold**, `inline code`, and [a link](https://example.com "Title").',
  '',
  '1. First',
  '2. Second',
  '   - Nested item',
  '',
  '> A quote',
  '>',
  '> With two paragraphs.',
  '',
  '```typescript',
  'const value = "never execute this";',
  '```',
  '',
  '---',
  '',
  ':::section[Socials]{id="socials"}',
  'My social profiles.',
  '',
  serializePageItem(item),
  ':::',
  '',
].join('\n');

function allNodes(node: JSONContent): JSONContent[] {
  return [node, ...(node.content ?? []).flatMap(allNodes)];
}

function schema() {
  return getSchema(createRichDocumentExtensions());
}

test('standard Markdown is editable text with formatting, lists, quotes, code and separators', () => {
  const document = markdownToRichDocument(source);
  const nodes = allNodes(document);
  for (const type of [
    'heading',
    'paragraph',
    'orderedList',
    'bulletList',
    'listItem',
    'blockquote',
    'codeBlock',
    'horizontalRule',
  ])
    assert.ok(
      nodes.some((node) => node.type === type),
      type,
    );
  for (const mark of ['bold', 'italic', 'code', 'link'])
    assert.ok(
      nodes.some((node) => node.marks?.some((entry) => entry.type === mark)),
      mark,
    );
  const link = nodes.flatMap((node) => node.marks ?? []).find((mark) => mark.type === 'link');
  assert.equal(link?.attrs?.title, 'Title');
  const section = nodes.find((node) => node.type === 'wyaSection')!;
  assert.deepEqual(section.attrs, { id: 'socials', title: 'Socials' });
  assert.deepEqual(section.content!.find((node) => node.type === 'wyaItem')!.attrs!.item, item);
});

test('untouched documents keep their exact Markdown after a real ProseMirror schema round trip', () => {
  const editorSchema = schema();
  for (const input of [
    source,
    '',
    '# Heading\r\n\r\nParagraph.\r\n',
    '3. Three\n4. Four\n',
    '- > A quote\n',
  ]) {
    const document = markdownToRichDocument(input);
    const instance = editorSchema.nodeFromJSON(document);
    instance.check();
    assert.equal(richDocumentToMarkdown(instance.toJSON(), input), input);
  }
});

test('selection-only transactions do not append content or dirty heading, card or section documents', () => {
  for (const input of [
    '# Heading\n',
    serializePageItem(item),
    `:::section[Socials]{id="socials"}\n${serializePageItem(item)}\n:::\n`,
  ]) {
    const editor = new Editor({
      element: null,
      extensions: createRichDocumentExtensions(),
      content: markdownToRichDocument(input),
    });
    try {
      const state = EditorState.create({
        schema: editor.schema,
        doc: editor.state.doc,
        plugins: editor.extensionManager.plugins,
      });
      const result = state.applyTransaction(state.tr.setSelection(Selection.atEnd(state.doc)));
      assert.ok(result.transactions.every((transaction) => !transaction.docChanged));
      assert.ok(result.state.doc.eq(state.doc));
      assert.equal(richDocumentToMarkdown(result.state.doc.toJSON(), input), input);
    } finally {
      editor.destroy();
    }
  }
});

test('formatting commands cannot nest Wya cards or sections inside quotes or lists', () => {
  const editorSchema = schema();
  const card = editorSchema.nodeFromJSON({ type: 'wyaItem', attrs: { item } });
  const paragraph = editorSchema.nodes.paragraph.create(null, editorSchema.text('Editable text'));
  const section = editorSchema.nodes.wyaSection.create({ id: 'socials', title: 'Socials' }, [
    paragraph,
    card,
  ]);
  for (const node of [card, section]) {
    const doc = editorSchema.nodes.doc.create(null, [node]);
    const state = EditorState.create({
      schema: editorSchema,
      doc,
      selection: NodeSelection.create(doc, 0),
    });
    assert.equal(wrapIn(editorSchema.nodes.blockquote)(state), false);
    assert.equal(wrapInList(editorSchema.nodes.bulletList)(state), false);
    assert.equal(wrapInList(editorSchema.nodes.orderedList)(state), false);
    assert.ok(editorSchema.nodes.doc.validContent(doc.content));
  }
  const doc = editorSchema.nodes.doc.create(null, [section]);
  const childState = EditorState.create({
    schema: editorSchema,
    doc,
    selection: NodeSelection.create(doc, 1 + paragraph.nodeSize),
  });
  assert.equal(wrapIn(editorSchema.nodes.blockquote)(childState), false);
  assert.equal(wrapInList(editorSchema.nodes.bulletList)(childState), false);
  const proseState = EditorState.create({
    schema: editorSchema,
    doc,
    selection: NodeSelection.create(doc, 1),
  });
  assert.equal(wrapIn(editorSchema.nodes.blockquote)(proseState), true);
  assert.equal(wrapInList(editorSchema.nodes.bulletList)(proseState), true);
});

test('editing prose and formatting keeps Wya IDs, aliases, visibility, section IDs and payloads', () => {
  const document = markdownToRichDocument(source);
  const paragraph = document.content!.find((node) => node.type === 'paragraph')!;
  paragraph.content!.unshift({ type: 'text', text: 'New text. ', marks: [{ type: 'bold' }] });
  const section = document.content!.find((node) => node.type === 'wyaSection')!;
  section.attrs!.title = 'Profiles';
  const result = richDocumentToMarkdown(document, source);
  assert.ok(
    allNodes(markdownToRichDocument(result)).some(
      (node) => node.text === 'New text. ' && node.marks?.some((mark) => mark.type === 'bold'),
    ),
  );
  const parsed = parsePageSource(result);
  assert.deepEqual(parsed.items[0].item, item);
  assert.deepEqual(parsed.sections, [{ id: 'socials', title: 'Profiles', slugs: ['github'] }]);
  assert.ok(result.includes('https://example.com "Title"'));
  assert.ok(result.includes('const value = "never execute this";'));
});

test('adjacent text marks are grouped into valid Markdown rather than broken delimiters', () => {
  const document: JSONContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'italic', marks: [{ type: 'bold' }, { type: 'italic' }] },
          { type: 'text', text: ' bold', marks: [{ type: 'bold' }] },
        ],
      },
    ],
  };
  const result = richDocumentToMarkdown(document);
  const nodes = allNodes(markdownToRichDocument(result));
  assert.ok(
    nodes
      .filter((node) => node.type === 'text')
      .every((node) => node.marks?.some((mark) => mark.type === 'bold')),
  );
  assert.ok(
    nodes.some(
      (node) => node.text === 'italic' && node.marks?.some((mark) => mark.type === 'italic'),
    ),
  );
});

test('opaque block and inline nodes preserve comments, references, images, HTML and code metadata', () => {
  const input = [
    '<!-- Exact comment\n   with spacing -->',
    '',
    'Some [reference][home], ![alt text](https://example.com/a.png "Image title") and <span data-x="one">HTML</span>.',
    '',
    '[home]: https://example.com "Definition title"',
    '',
    '```js title="file.js"',
    'const x = 1;',
    '```',
    '',
    'Editable paragraph.',
    '',
  ].join('\n');
  const document = markdownToRichDocument(input);
  const fallback = allNodes(document).filter((node) => node.type?.startsWith('markdown'));
  assert.ok(fallback.length >= 5);
  const instance = schema().nodeFromJSON(document);
  instance.check();
  assert.equal(richDocumentToMarkdown(instance.toJSON(), input), input);
  document.content!.at(-1)!.content![0].text = 'Changed paragraph.';
  const updated = richDocumentToMarkdown(document, input);
  for (const node of fallback) assert.ok(updated.includes(node.attrs!.source), node.attrs!.source);
  assert.ok(updated.includes('Changed paragraph.'));
});

test('all current rich card payloads survive editing without exposing JSON as editable prose', () => {
  const values: LinkItem[] = [
    {
      ...item,
      kind: 'project',
      project: {
        description: 'A "project".',
        buttons: [{ label: 'Visit', url: 'https://example.com' }],
      },
    },
    { ...item, kind: 'discord', discord: { guildId: '771498135188799500' } },
    {
      ...item,
      kind: 'collection',
      collection: {
        type: 'game',
        items: [{ ...item, id: 'child', slug: 'child', visible: false }],
      },
    },
  ];
  for (const value of values) {
    const input = serializePageItem(value);
    const document = markdownToRichDocument(input);
    assert.equal(document.content![0].type, 'wyaItem');
    document.content!.push({
      type: 'paragraph',
      content: [{ type: 'text', text: 'An extra note.' }],
    });
    const result = richDocumentToMarkdown(document, input);
    assert.deepEqual(parsePageSource(result).items[0].item, value);
  }
});

test('new cards retain omitted IDs until publication and explicit empty aliases can clear aliases', () => {
  const fresh = { ...item, slug: 'new', visible: true, aliases: [] };
  delete fresh.id;
  const document: JSONContent = {
    type: 'doc',
    content: [{ type: 'wyaItem', attrs: { item: fresh } }],
  };
  const source = richDocumentToMarkdown(document);
  const parsed = parsePageSource(source).items[0].item;
  assert.equal(parsed.id, undefined);
  assert.deepEqual(parsed.aliases, []);
  const base: ProfileData = { name: 'Alex', bio: '', theme: 'lilac', links: [] };
  const published = compilePageDocument(base, 'home', source);
  assert.ok(published.links[0].id);
  assert.ok(!published.links[0].id.startsWith('legacy:'));
});

test('a temporarily blank section title stays editable but cannot be published', () => {
  const document = markdownToRichDocument(':::section[Title]{id="section"}\n\nText.\n\n:::\n');
  document.content![0].attrs!.title = '';
  const source = richDocumentToMarkdown(document);
  const restored = markdownToRichDocument(source);
  assert.equal(restored.content![0].attrs!.title, '');
  assert.equal(restored.content![0].attrs!.id, 'section');
  assert.equal(restored.content![0].content![0].content![0].text, 'Text.');
  const base: ProfileData = { name: 'Alex', bio: '', theme: 'lilac', links: [] };
  assert.throws(() => compilePageDocument(base, 'home', source), /valid sections/);
  restored.content![0].attrs!.title = 'New title';
  assert.doesNotThrow(() => compilePageDocument(base, 'home', richDocumentToMarkdown(restored)));
});

test('ordinary Markdown file mode does not interpret Wya syntax or inherit page validation limits', () => {
  const input = `:::section[Example]{id="example"}\n\n::link[Example]{url="https://example.com"}\n\n:::\n\n\`\`\`wya-item\nnot JSON\n\`\`\`\n`;
  const document = markdownToRichDocument(input, { wya: false });
  assert.ok(
    allNodes(document).every((node) => node.type !== 'wyaItem' && node.type !== 'wyaSection'),
  );
  assert.equal(richDocumentToMarkdown(document, input, { wya: false }), input);
  assert.doesNotThrow(() => markdownToRichDocument('a'.repeat(129 * 1024), { wya: false }));
  assert.throws(() => markdownToRichDocument(input));
});

test('unsupported rich node and mark types fail instead of silently losing content', () => {
  assert.throws(
    () =>
      richDocumentToMarkdown({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'https://example.com' } }],
      }),
    /not supported/,
  );
  assert.throws(
    () =>
      richDocumentToMarkdown({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Underlined', marks: [{ type: 'underline' }] }],
          },
        ],
      }),
    /not supported/,
  );
});
