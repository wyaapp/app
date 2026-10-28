import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JSONContent } from '@tiptap/core';
import {
  Editor,
  getSchema,
  EditorState,
  NodeSelection,
  Selection,
  wrapIn,
  wrapInList,
  history,
  undo,
  createRichDocumentExtensions,
  markdownToRichDocument,
  richDocumentToMarkdown,
} from './helpers/rich-editor.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { remarkStrikethrough } from '../lib/remark-strikethrough.ts';
import { parsePageSource, serializePageItem } from '../lib/page-documents.ts';
import { compilePageDocument } from '../lib/page-document-actions.ts';
import type { LinkItem, ProfileData } from '../lib/profile-types.ts';
import { gifDirectiveNode, type GifEmbed } from '../lib/gif.ts';
import { stringifyPageTree } from '../lib/page-documents.ts';

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

test('file editing migrates legacy sections to headings and preserves their cards and order', () => {
  const options = { sectionsAsHeadings: true };
  const document = markdownToRichDocument(source, options);
  const nodes = allNodes(document);
  assert.ok(!nodes.some((node) => node.type === 'wyaSection'));
  const headingIndex = document.content!.findIndex(
    (node) => node.type === 'heading' && node.content?.[0].text === 'Socials',
  );
  assert.ok(headingIndex >= 0);
  assert.equal(document.content![headingIndex].attrs?.level, 3);
  assert.equal(document.content![headingIndex + 1].content?.[0].text, 'My social profiles.');
  assert.deepEqual(document.content![headingIndex + 2].attrs?.item, item);

  const instance = schema().nodeFromJSON(document);
  instance.check();
  const saved = richDocumentToMarkdown(instance.toJSON(), source, options);
  assert.ok(saved.includes('### Socials'));
  assert.ok(!saved.includes(':::section'));
  assert.deepEqual(
    parsePageSource(saved).items.map((entry) => entry.item),
    [item],
  );
  assert.equal(parsePageSource(saved).sections.length, 0);
  assert.equal(
    richDocumentToMarkdown(markdownToRichDocument(saved, options), saved, options),
    saved,
  );
});

test('section migration does not rewrite ordinary files or plain Markdown code examples', () => {
  for (const input of [
    '# Title\r\n\r\nText with  two spaces.\r\n',
    '```md\n:::section[Example]{id="example"}\n:::\n```\n',
  ]) {
    const options = { sectionsAsHeadings: true };
    assert.equal(
      richDocumentToMarkdown(markdownToRichDocument(input, options), input, options),
      input,
    );
  }
  const plain = ':::section[Example]{id="example"}\nUninterpreted directive\n:::\n';
  const options = { wya: false, sectionsAsHeadings: true };
  assert.equal(
    richDocumentToMarkdown(markdownToRichDocument(plain, options), plain, options),
    plain,
  );
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

test('caret paragraphs before, between and after cards preserve the exact Markdown source', () => {
  const cards = `${serializePageItem(item)}\n\n${serializePageItem({ ...item, id: 'second', slug: 'second' })}\n`;
  for (const input of [
    cards,
    `:::section[Socials]{id="socials"}\n\n${cards}\n:::\n`,
    '> First paragraph.\n>\n> Second paragraph.\n',
  ]) {
    const document = markdownToRichDocument(input);
    const container =
      document.content![0].type === 'wyaSection' || document.content![0].type === 'blockquote'
        ? document.content![0]
        : document;
    container.content = [
      { type: 'paragraph' },
      ...container.content!.flatMap((node) => [node, { type: 'paragraph', content: [] }]),
    ];
    const instance = schema().nodeFromJSON(document);
    instance.check();
    assert.equal(richDocumentToMarkdown(instance.toJSON(), input), input);
  }
});

test('typing between cards and undoing back to an empty caret returns the original Markdown', () => {
  const input = `${serializePageItem(item)}\n\n${serializePageItem({ ...item, id: 'second', slug: 'second' })}\n`;
  const editorSchema = schema();
  let state = EditorState.create({
    schema: editorSchema,
    doc: editorSchema.nodeFromJSON(markdownToRichDocument(input)),
    plugins: [history()],
  });
  const position = state.doc.firstChild!.nodeSize;
  state = state.apply(
    state.tr.insert(position, editorSchema.nodes.paragraph.create()).setMeta('addToHistory', false),
  );
  assert.equal(richDocumentToMarkdown(state.doc.toJSON(), input), input);
  state = state.apply(state.tr.insertText('Text between cards.', position + 1));
  const changed = richDocumentToMarkdown(state.doc.toJSON(), input);
  assert.ok(changed.includes('Text between cards.'));
  assert.deepEqual(
    parsePageSource(changed).items.map(({ item }) => item.slug),
    ['github', 'second'],
  );
  assert.equal(
    undo(state, (transaction) => {
      state = state.apply(transaction);
    }),
    true,
  );
  assert.equal(richDocumentToMarkdown(state.doc.toJSON(), input), input);
});

test('caret normalization preserves empty list items and paragraphs with whitespace or hard breaks', () => {
  for (const input of ['- First\n-\n', '> First\n>\n>\n', '-\n']) {
    const document = markdownToRichDocument(input);
    assert.equal(richDocumentToMarkdown(document, input), input);
  }
  const list: JSONContent = {
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph' }] },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }],
          },
        ],
      },
    ],
  };
  const restored = markdownToRichDocument(richDocumentToMarkdown(list));
  assert.equal(restored.content![0].content!.length, 2);
  assert.equal(restored.content![0].content![0].content![0].type, 'paragraph');
  for (const content of [[{ type: 'text', text: '  ' }], [{ type: 'hardBreak' }]]) {
    const document: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content }] };
    assert.notEqual(richDocumentToMarkdown(document, ''), '');
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

test('strikethrough round trips in files and Wya pages with nested formatting and stable cards', () => {
  const prose = '~~Old **bold** and *italic* with [a link](https://example.com)~~ and ~literal~.';
  for (const wya of [false, true]) {
    const input = wya ? `${prose}\n\n${source}` : prose;
    const document = schema().nodeFromJSON(markdownToRichDocument(input, { wya }));
    document.check();
    assert.equal(richDocumentToMarkdown(document.toJSON(), input, { wya }), input);
    const edited = document.toJSON();
    const text = allNodes(edited).find((node) => node.text === 'bold')!;
    assert.deepEqual(new Set(text.marks!.map((mark) => mark.type)), new Set(['bold', 'strike']));
    text.text = 'updated';
    const result = richDocumentToMarkdown(edited, input, { wya });
    const restored = allNodes(markdownToRichDocument(result, { wya }));
    assert.ok(
      restored.some(
        (node) => node.text === 'updated' && node.marks?.some((mark) => mark.type === 'strike'),
      ),
    );
    const literal = restored.find((node) => node.text?.includes('~literal~'))!;
    assert.ok(!literal.marks?.some((mark) => mark.type === 'strike'));
    if (wya) assert.deepEqual(parsePageSource(result).items[0].item, item);
  }
});

test('native formatting keymaps toggle bold, italic and strike and persist Markdown', () => {
  const editor = new Editor({
    element: null,
    extensions: createRichDocumentExtensions(),
    content: markdownToRichDocument('Selected text'),
  });
  try {
    editor.commands.setTextSelection({ from: 1, to: 9 });
    for (const [key, shiftKey, mark, expected] of [
      ['b', false, 'bold', '**Selected** text\n'],
      ['i', false, 'italic', '*Selected* text\n'],
      ['S', true, 'strike', '~~Selected~~ text\n'],
    ] as const) {
      const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
      const event = {
        key,
        keyCode: key.toUpperCase().charCodeAt(0),
        code: `Key${key.toUpperCase()}`,
        shiftKey,
        metaKey: mac,
        ctrlKey: !mac,
        altKey: false,
      } as KeyboardEvent;
      const press = () =>
        editor.extensionManager.plugins.some((plugin) =>
          plugin.props.handleKeyDown?.call(plugin, editor.view, event),
        );
      assert.equal(press(), true, `${mark} shortcut is handled`);
      assert.equal(editor.isActive(mark), true);
      assert.equal(richDocumentToMarkdown(editor.getJSON()), expected);
      assert.equal(press(), true);
      assert.equal(editor.isActive(mark), false);
      assert.equal(richDocumentToMarkdown(editor.getJSON(), 'Selected text'), 'Selected text');
    }
  } finally {
    editor.destroy();
  }
});

test('Markdown previews render strike without enabling raw HTML or unrelated GFM syntax', () => {
  const output = renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: [remarkStrikethrough], skipHtml: true },
      [
        '~~Old **bold**~~ and ~literal~.',
        '',
        '<script>alert("unsafe")</script>',
        '',
        '| Not | a table |',
        '| --- | --- |',
        '| plain | text |',
        '',
        'https://example.com',
      ].join('\n'),
    ),
  );
  assert.ok(output.includes('<del>Old <strong>bold</strong></del> and ~literal~.'));
  assert.ok(!output.includes('<script') && !output.includes('alert('));
  assert.ok(!output.includes('<table') && !output.includes('<a '));
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
        content: [{ type: 'video', attrs: { src: 'https://example.com' } }],
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

test('GIFs are native atomic blocks in Markdown files and Wya pages with lossless source round trips', () => {
  const gifs: GifEmbed[] = [
    { provider: 'giphy', id: 'YsTs5ltWtEhnq', title: 'A happy cat', width: 480, height: 270 },
    { provider: 'tenor', id: '1174838705394808298' },
    { provider: 'giphy', id: 'cat', width: 480, height: 270, size: 240 },
    { provider: 'tenor', id: '18120762', size: 'full' },
  ];
  for (const wya of [true, false]) {
    const input = `# Notes\n\n${stringifyPageTree({ type: 'root', children: gifs.map(gifDirectiveNode) })}\nEditable paragraph.\n`;
    const document = markdownToRichDocument(input, { wya });
    assert.deepEqual(
      allNodes(document)
        .filter((node) => node.type === 'gif')
        .map((node) => node.attrs!.gif),
      gifs,
    );
    const instance = schema().nodeFromJSON(document);
    instance.check();
    assert.equal(richDocumentToMarkdown(instance.toJSON(), input, { wya }), input);
    document.content!.at(-1)!.content![0].text = 'Changed paragraph.';
    const changed = richDocumentToMarkdown(document, input, { wya });
    assert.deepEqual(
      allNodes(markdownToRichDocument(changed, { wya }))
        .filter((node) => node.type === 'gif')
        .map((node) => node.attrs!.gif),
      gifs,
    );
  }
});

test('resizing GIFs round trips through both Markdown and Wya documents without changing intrinsic dimensions', () => {
  for (const wya of [true, false]) {
    const input = '::gif[Cat]{provider="giphy" id="cat" width="480" height="270"}\n';
    const document = markdownToRichDocument(input, { wya });
    const gif = allNodes(document).find((node) => node.type === 'gif')!;
    for (const size of [640, 'full', undefined]) {
      gif.attrs!.gif = {
        provider: 'giphy',
        id: 'cat',
        title: 'Cat',
        width: 480,
        height: 270,
        ...(size !== undefined ? { size } : {}),
      };
      const output = richDocumentToMarkdown(document, input, { wya });
      const reparsed = allNodes(markdownToRichDocument(output, { wya })).find(
        (node) => node.type === 'gif',
      )!;
      assert.deepEqual(reparsed.attrs!.gif, gif.attrs!.gif);
      if (size === undefined) assert.equal(output, input);
    }
  }
});

test('GIFs remain schema-safe in quotes, lists and Wya sections while unknown file directives stay opaque', () => {
  const gif = '::gif[Hello]{provider="giphy" id="YsTs5ltWtEhnq"}';
  const source = `> ${gif}\n\n- Intro\n\n  ${gif}\n\n:::section[Media]{id="media"}\n${gif}\n:::\n`;
  const instance = schema().nodeFromJSON(markdownToRichDocument(source));
  instance.check();
  assert.equal(allNodes(instance.toJSON()).filter((node) => node.type === 'gif').length, 3);
  assert.equal(richDocumentToMarkdown(instance.toJSON(), source), source);
  const unsupported =
    '::unknown[label]{secret="value"}\n\n::gif{provider="evil" id="12"}\n\n:::section[Example]{id="example"}\nText\n:::\n';
  const file = schema().nodeFromJSON(markdownToRichDocument(unsupported, { wya: false }));
  file.check();
  assert.ok(
    allNodes(file.toJSON()).every(
      (node) => !['gif', 'wyaSection', 'wyaItem'].includes(node.type ?? ''),
    ),
  );
  assert.equal(richDocumentToMarkdown(file.toJSON(), unsupported, { wya: false }), unsupported);
  assert.throws(
    () => markdownToRichDocument('::gif{provider="evil" id="12"}'),
    /valid GIPHY or Tenor/,
  );
});

test('enabling GIF syntax keeps ordinary colon prose editable in Markdown files', () => {
  const input = 'Ratio 1:2. Hello :name. Use :plugin[options] here.\n';
  const document = markdownToRichDocument(input, { wya: false });
  assert.ok(document.content![0].content!.every((node) => node.type === 'text'));
  assert.equal(document.content![0].content!.map((node) => node.text).join(''), input.trim());
  assert.equal(richDocumentToMarkdown(document, input, { wya: false }), input);
});
