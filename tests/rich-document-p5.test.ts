import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JSONContent } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import type { Slice as ProseMirrorSlice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { parsePageSource } from '../lib/page-documents.ts';
import {
  Editor,
  NodeSelection,
  Fragment,
  Slice,
  createRichDocumentExtensions,
  createP5Paste,
  p5PasteKey,
  insertRichBlock,
  createBlockClipboard,
  blockClipboardKey,
  markdownToRichDocument,
  richDocumentToMarkdown,
  undo,
  redo,
} from './helpers/rich-editor.ts';

const url = 'https://editor.p5js.org/p5/sketches/4GluUaiHzPj';
const directUrl = 'https://example.com/sketch.js';
const sketch = { url, title: 'Interactive circle' };
const legacySource =
  'function setup() { createCanvas(320, 240); }\nfunction draw() { background(240); circle(mouseX, mouseY, 30); }';
const markdown = `::p5{url="${url}" title="${sketch.title}"}`;
const legacyMarkdown = `\`\`\`p5 ${JSON.stringify(sketch)}\n${legacySource}\n\`\`\``;

function createEditor(
  source: string | JSONContent = '',
  onPaste: (editor: Editor, input: string) => void = () => {},
) {
  const editor = new Editor({
    element: null,
    extensions: [
      ...createRichDocumentExtensions(),
      createP5Paste(onPaste),
      createBlockClipboard({ getContext: () => ({ scope: 'p5-test-document', items: [] }) }),
    ],
    content: typeof source === 'string' ? markdownToRichDocument(source) : source,
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
}

function testView(
  editor: Editor,
  { editable = true, composing = false }: { editable?: boolean; composing?: boolean } = {},
) {
  return {
    get state() {
      return editor.state;
    },
    dispatch(tr: Transaction) {
      editor.view.dispatch(tr);
    },
    editable,
    composing,
  } as EditorView;
}

function paste(
  editor: Editor,
  input: string,
  options: {
    slice?: ProseMirrorSlice;
    editable?: boolean;
    composing?: boolean;
    files?: File[];
  } = {},
) {
  const plugin = p5PasteKey.get(editor.state);
  assert.ok(plugin?.props.handlePaste);
  const slice =
    options.slice ??
    new Slice(
      Fragment.from(editor.schema.nodes.paragraph.create(null, editor.schema.text(input))),
      1,
      1,
    );
  return plugin.props.handlePaste.call(
    plugin,
    testView(editor, options),
    {
      clipboardData: {
        files: options.files ?? [],
        getData: (type: string) => (type === 'text/plain' ? input : ''),
      },
    } as unknown as ClipboardEvent,
    slice,
  );
}

test('p5 hosted links round-trip in pages and Markdown files, migrating legacy snapshots', () => {
  const editor = createEditor();
  try {
    for (const options of [{}, { wya: false }, { preserveUnknown: true }])
      for (const saved of [markdown, legacyMarkdown]) {
        const content = markdownToRichDocument(`Before\n\n${saved}\n\nAfter`, options);
        const doc = editor.schema.nodeFromJSON(content);
        doc.check();
        assert.equal(doc.childCount, 3);
        assert.equal(doc.child(1).type.name, 'p5');
        assert.deepEqual(doc.child(1).attrs.sketch, sketch);
        const output = richDocumentToMarkdown(content, `Before\n\n${saved}\n\nAfter`, options);
        assert.ok(!output.includes('function setup'));
        assert.ok(output.includes('::p5{'));
        const restored = editor.schema.nodeFromJSON(markdownToRichDocument(output, options));
        assert.ok(doc.eq(restored));
        assert.doesNotThrow(() => parsePageSource(output, options));
      }
  } finally {
    editor.destroy();
  }
});

test('ordinary JavaScript fences stay editable code, not running sketches', () => {
  const editor = createEditor(`\`\`\`javascript\n${legacySource}\n\`\`\``);
  try {
    assert.equal(editor.state.doc.firstChild!.type.name, 'codeBlock');
    assert.equal(editor.state.doc.firstChild!.textContent, legacySource);
  } finally {
    editor.destroy();
  }
});

test('p5 clipboard HTML strips legacy source snapshots and preserves the hosted link', () => {
  const editor = createEditor();
  try {
    const value = {
      ...sketch,
      source:
        'const text = "</script><img src=x onerror=alert(1)>";\nfunction setup() { createCanvas(50, 50); }',
    };
    const node = editor.schema.nodes.p5.create({ sketch: value });
    assert.equal(node.isBlock, true);
    assert.equal(node.isAtom, true);
    const spec = node.type.spec.toDOM!(node);
    assert.ok(Array.isArray(spec));
    assert.equal(spec[0], 'div');
    const attributes = spec[1] as Record<string, unknown>;
    assert.deepEqual(JSON.parse(String(attributes['data-p5-embed'])), sketch);
    const rule = node.type.spec.parseDOM!.find(
      (candidate) => 'tag' in candidate && candidate.tag === 'div[data-p5-embed]',
    );
    assert.ok(rule?.getAttrs);
    const attrs = rule.getAttrs({
      getAttribute: (name: string) => attributes[name] ?? null,
    } as unknown as HTMLElement);
    assert.notEqual(attrs, false);
    assert.deepEqual(node.type.create(attrs || null).attrs.sketch, sketch);
    for (const unsafe of [
      { ...value, url: 'javascript:alert(1)' },
      { ...value, title: 'x'.repeat(101) },
      { ...value, url: 'https://example.com/sketch.js' },
    ]) {
      assert.equal(
        rule.getAttrs({ getAttribute: () => JSON.stringify(unsafe) } as unknown as HTMLElement),
        false,
      );
    }
  } finally {
    editor.destroy();
  }
});

test('slash insertion replaces its query and leaves a typing line in one undo step', () => {
  const editor = createEditor('/p5\n\nAfter');
  try {
    editor.commands.setTextSelection(4);
    const before = editor.state.doc;
    const tr = insertRichBlock(editor.state, editor.schema.nodes.p5.create({ sketch }), {
      range: { from: 1, to: 4 },
    });
    assert.ok(tr);
    editor.view.dispatch(tr);
    assert.equal(editor.state.doc.firstChild!.type.name, 'p5');
    assert.equal(editor.state.doc.child(1).type.name, 'paragraph');
    assert.equal(editor.state.doc.child(1).content.size, 0);
    assert.equal(editor.state.doc.lastChild!.textContent, 'After');
    assert.equal(editor.state.selection.$from.parent, editor.state.doc.child(1));
    editor.state.doc.check();
    assert.equal(
      undo(editor.state, (transaction) => editor.view.dispatch(transaction)),
      true,
    );
    assert.ok(editor.state.doc.eq(before));
    assert.equal(
      redo(editor.state, (transaction) => editor.view.dispatch(transaction)),
      true,
    );
    assert.deepEqual(editor.state.doc.firstChild!.attrs.sketch, sketch);
  } finally {
    editor.destroy();
  }
});

test('copying a selected sketch pastes a separate block with the same hosted link and is undoable', () => {
  const editor = createEditor(`${markdown}\n\nAfter`);
  try {
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    const before = editor.state.doc;
    const view = testView(editor);
    const plugin = blockClipboardKey.get(editor.state)!;
    const copied = plugin.props.transformCopied!.call(
      plugin,
      editor.state.selection.content(),
      view,
    );
    const prepared = plugin.props.transformPasted!.call(plugin, copied, view, false);
    assert.equal(
      plugin.props.handlePaste!.call(
        plugin,
        view,
        {
          clipboardData: {
            getData: (type: string) => (type === 'text/html' ? '<div data-p5-embed=""></div>' : ''),
          },
        } as ClipboardEvent,
        prepared,
      ),
      true,
    );
    assert.equal(editor.state.doc.childCount, 3);
    assert.ok(editor.state.doc.child(0).eq(editor.state.doc.child(1)));
    assert.deepEqual(editor.state.doc.child(1).attrs.sketch, sketch);
    assert.equal(editor.state.doc.lastChild!.textContent, 'After');
    assert.equal(
      undo(editor.state, (transaction) => editor.view.dispatch(transaction)),
      true,
    );
    assert.ok(editor.state.doc.eq(before));
  } finally {
    editor.destroy();
  }
});

test('pasting official sketch URLs opens the picker without changing content', () => {
  for (const input of [url]) {
    const calls: { editor: Editor; input: string }[] = [];
    const editor = createEditor('', (editor, input) => calls.push({ editor, input }));
    try {
      const before = editor.state.doc;
      assert.equal(paste(editor, input), true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].editor, editor);
      assert.equal(calls[0].input, input);
      assert.strictEqual(editor.state.doc, before);
    } finally {
      editor.destroy();
    }
  }
});

test('p5 URL paste keeps native behavior in text, headings, lists, code, and selected ranges', () => {
  for (const [source, from, to] of [
    ['Keep this', 3, 3],
    ['Replace me', 1, 11],
    ['# Title', 1, 1],
    ['```\n\n```', 1, 1],
    ['- ', 2, 2],
  ] as const) {
    let calls = 0;
    const editor = createEditor(source, () => calls++);
    try {
      editor.commands.setTextSelection({ from, to });
      const before = editor.state.doc;
      assert.equal(paste(editor, url), false);
      assert.equal(calls, 0);
      assert.strictEqual(editor.state.doc, before);
    } finally {
      editor.destroy();
    }
  }
});

test('p5 paste leaves unrelated links, formatted content, files, and inactive editing to their handlers', () => {
  let calls = 0;
  const editor = createEditor('', () => calls++);
  try {
    for (const input of [
      'Hello',
      'https://example.com/',
      'https://example.com/sketch.js',
      'https://example.com/page?file=sketch.js',
      `See ${url}`,
      `${url}\n${directUrl}`,
      'javascript:alert(1)',
    ])
      assert.equal(paste(editor, input), false);
    for (const options of [{ editable: false }, { composing: true }, { files: [{} as File] }])
      assert.equal(paste(editor, url, options), false);
    const bold = editor.schema.text(url, [editor.schema.marks.bold.create()]);
    assert.equal(paste(editor, url, { slice: new Slice(Fragment.from(bold), 0, 0) }), false);
    const originalLink = editor.schema.text(url, [
      editor.schema.marks.link.create({ href: directUrl }),
    ]);
    assert.equal(
      paste(editor, url, { slice: new Slice(Fragment.from(originalLink), 0, 0) }),
      false,
    );
    editor.view.dispatch(editor.state.tr.setStoredMarks([editor.schema.marks.code.create()]));
    assert.equal(paste(editor, url), false);
    assert.equal(calls, 0);
  } finally {
    editor.destroy();
  }
});

test('legacy migration retains quote/list nesting and surrounding formatting', () => {
  for (const source of [
    `# Keep this\n\n${legacyMarkdown}\n\nExact  spacing\n`,
    legacyMarkdown
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
    `- Entry\n\n${legacyMarkdown
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')}`,
  ]) {
    const document = markdownToRichDocument(source);
    const output = richDocumentToMarkdown(document, source);
    assert.ok(!output.includes('function setup'));
    assert.ok(output.includes('::p5{'));
    assert.deepEqual(markdownToRichDocument(output), document);
    if (source.startsWith('#')) assert.ok(output.endsWith('Exact  spacing\n'));
  }
});

test('unsupported legacy URLs and opaque third-party containers retain their source', () => {
  const source = legacyMarkdown.replace(url, directUrl);
  const document = markdownToRichDocument(source);
  assert.equal(document.content?.[0].type, 'markdownBlock');
  assert.equal(richDocumentToMarkdown(document, source), source);
  const opaque = `:::example\n${legacyMarkdown}\n:::`;
  const options = { preserveUnknown: true };
  assert.equal(
    richDocumentToMarkdown(markdownToRichDocument(opaque, options), opaque, options),
    opaque,
  );
});
