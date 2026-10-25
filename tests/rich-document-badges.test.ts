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
  createBadgePaste,
  badgePasteKey,
  insertRichBadge,
  markdownToRichDocument,
  richDocumentToMarkdown,
  undo,
  redo,
} from './helpers/rich-editor.ts';

const shield = 'https://img.shields.io/badge/build-passing-brightgreen?style=flat-square';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz9kAAAAASUVORK5CYII=';
const badge = { src: shield, alt: 'Build passing', href: 'https://example.com/project' };

function createEditor(source: string | JSONContent = '') {
  const editor = new Editor({
    element: null,
    extensions: [...createRichDocumentExtensions(), createBadgePaste()],
    content: typeof source === 'string' ? markdownToRichDocument(source) : source,
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
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
  const plugin = badgePasteKey.get(editor.state);
  assert.ok(plugin?.props.handlePaste);
  const slice =
    options.slice ??
    new Slice(
      Fragment.from(editor.schema.nodes.paragraph.create(null, editor.schema.text(input))),
      1,
      1,
    );
  const view = {
    get state() {
      return editor.state;
    },
    dispatch(tr: Transaction) {
      editor.view.dispatch(tr);
    },
    editable: options.editable ?? true,
    composing: options.composing ?? false,
  } as EditorView;
  const event = {
    clipboardData: {
      files: options.files ?? [],
      getData(type: string) {
        return type === 'text/plain' ? input : '';
      },
    },
  } as unknown as ClipboardEvent;
  return plugin.props.handlePaste.call(plugin, view, event, slice);
}

test('badge insertion keeps adjacent text and places the caret immediately after the inline badge', () => {
  const editor = createEditor('Before after');
  try {
    editor.commands.setTextSelection(8);
    const tr = insertRichBadge(editor.state, badge);
    assert.ok(tr);
    editor.view.dispatch(tr);
    assert.equal(editor.state.doc.childCount, 1);
    assert.equal(editor.state.doc.firstChild!.childCount, 3);
    assert.equal(editor.state.doc.firstChild!.child(0).text, 'Before ');
    assert.equal(editor.state.doc.firstChild!.child(1).type.name, 'badge');
    assert.deepEqual(editor.state.doc.firstChild!.child(1).attrs.badge, badge);
    assert.equal(editor.state.doc.firstChild!.child(2).text, 'after');
    assert.equal(editor.state.selection.from, 9);
    const second = insertRichBadge(editor.state, { ...badge, alt: 'Another badge' });
    assert.ok(second);
    editor.view.dispatch(second);
    assert.equal(editor.state.doc.firstChild!.child(2).type.name, 'badge');
    assert.equal(editor.state.doc.childCount, 1);
    editor.state.doc.check();
  } finally {
    editor.destroy();
  }
});

test('slash replacement removes only its query and gap insertion creates one inline badge paragraph', () => {
  const editor = createEditor('Before /badge after');
  try {
    const tr = insertRichBadge(editor.state, badge, { range: { from: 8, to: 14 } });
    assert.ok(tr);
    assert.equal(tr.doc.textContent, 'Before  after');
    assert.equal(tr.doc.firstChild!.child(1).type.name, 'badge');
    assert.equal(tr.selection.from, 9);
    const gap = insertRichBadge(editor.state, badge, { pos: editor.state.doc.content.size });
    assert.ok(gap);
    assert.equal(gap.doc.childCount, 2);
    assert.equal(gap.doc.lastChild!.type.name, 'paragraph');
    assert.equal(gap.doc.lastChild!.firstChild!.type.name, 'badge');
    assert.equal(gap.selection.$from.parent, gap.doc.lastChild);
    assert.equal(gap.selection.$from.parentOffset, 1);
    gap.doc.check();
  } finally {
    editor.destroy();
  }
});

test('badge insertion works inside list paragraphs and sections without lifting their content', () => {
  for (const source of ['- Before after', ':::section[Links]{id="links"}\nBefore after\n:::']) {
    const editor = createEditor(source);
    try {
      let textPosition = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Before after') textPosition = pos + 7;
      });
      editor.commands.setTextSelection(textPosition);
      const tr = insertRichBadge(editor.state, badge);
      assert.ok(tr);
      assert.equal(tr.doc.firstChild!.type, editor.state.doc.firstChild!.type);
      assert.equal(tr.doc.textContent, 'Before after');
      assert.equal(tr.selection.$from.parent.type.name, 'paragraph');
      tr.doc.check();
    } finally {
      editor.destroy();
    }
  }
});

test('badge insertion refuses code blocks, cross-block ranges, and unsafe content', () => {
  const code = createEditor('```text\ncode\n```');
  const editor = createEditor('First\n\nSecond');
  try {
    code.commands.setTextSelection(2);
    assert.equal(insertRichBadge(code.state, badge), null);
    assert.equal(insertRichBadge(editor.state, badge, { range: { from: 2, to: 10 } }), null);
    assert.equal(insertRichBadge(editor.state, badge, { pos: 2 }), null);
    assert.equal(insertRichBadge(editor.state, { src: 'javascript:alert(1)', alt: '' }), null);
  } finally {
    code.destroy();
    editor.destroy();
  }
});

test('badge insertion leaves inline code literal, including a pending code mark', () => {
  const editor = createEditor('Before `code` after');
  try {
    editor.commands.setTextSelection(10);
    const original = editor.state.doc;
    assert.equal(insertRichBadge(editor.state, badge), null);
    assert.equal(insertRichBadge(editor.state, badge, { range: { from: 9, to: 11 } }), null);
    assert.ok(editor.state.doc.eq(original));
    editor.commands.setTextSelection(1);
    editor.view.dispatch(editor.state.tr.setStoredMarks([editor.schema.marks.code.create()]));
    assert.equal(insertRichBadge(editor.state, badge), null);
    assert.ok(editor.state.doc.eq(original));
  } finally {
    editor.destroy();
  }
});

test('provider URLs and linked Markdown paste inline and keep a separate undo step from following text', () => {
  for (const input of [shield, `[![Build passing](${shield})](https://example.com/project)`, png]) {
    const editor = createEditor('Before ');
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      const original = editor.state.doc;
      assert.equal(paste(editor, input), true);
      const embedded = editor.state.doc;
      const node = embedded.firstChild!.lastChild!;
      assert.equal(node.type.name, 'badge');
      assert.equal(node.attrs.badge.src, input === png ? png : shield);
      if (input.startsWith('[!')) assert.equal(node.attrs.badge.href, badge.href);
      editor.view.dispatch(editor.state.tr.insertText(' after'));
      assert.equal(
        undo(editor.state, (tr) => editor.view.dispatch(tr)),
        true,
      );
      assert.ok(editor.state.doc.eq(embedded));
      assert.equal(
        undo(editor.state, (tr) => editor.view.dispatch(tr)),
        true,
      );
      assert.ok(editor.state.doc.eq(original));
      assert.equal(
        redo(editor.state, (tr) => editor.view.dispatch(tr)),
        true,
      );
      assert.ok(editor.state.doc.eq(embedded));
    } finally {
      editor.destroy();
    }
  }
});

test('ordinary text, photos, formatted slices, selections, and code keep native paste behavior', () => {
  const editor = createEditor('Keep this');
  try {
    for (const input of ['Hello', 'https://example.com/photo.png', `See ${shield}`])
      assert.equal(paste(editor, input), false);
    for (const options of [{ editable: false }, { composing: true }, { files: [{} as File] }])
      assert.equal(paste(editor, shield, options), false);
    const marked = new Slice(
      Fragment.from(
        editor.schema.nodes.paragraph.create(
          null,
          editor.schema.text(shield, [editor.schema.marks.bold.create()]),
        ),
      ),
      1,
      1,
    );
    assert.equal(paste(editor, shield, { slice: marked }), false);
    const rich = new Slice(
      Fragment.from(
        editor.schema.nodes.paragraph.create(null, editor.schema.nodes.badge.create({ badge })),
      ),
      1,
      1,
    );
    assert.equal(paste(editor, shield, { slice: rich }), false);
    editor.commands.setTextSelection({ from: 1, to: 5 });
    assert.equal(paste(editor, shield), false);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    assert.equal(paste(editor, shield), false);
    editor.commands.setTextSelection(2);
    editor.view.dispatch(editor.state.tr.setStoredMarks([editor.schema.marks.code.create()]));
    assert.equal(paste(editor, shield), false);
  } finally {
    editor.destroy();
  }
  const code = createEditor('```\ncode\n```');
  try {
    code.commands.setTextSelection(2);
    assert.equal(paste(code, shield), false);
  } finally {
    code.destroy();
  }
});

test('badge HTML serialization and parsing preserve image, text, and link metadata', () => {
  const editor = createEditor();
  try {
    for (const value of [badge, { src: png, alt: 'Classic badge' }]) {
      const node = editor.schema.nodes.badge.create({ badge: value });
      const spec = node.type.spec.toDOM!(node);
      assert.ok(Array.isArray(spec));
      assert.equal(spec[0], 'span');
      const attributes = spec[1] as Record<string, unknown>;
      const rule = node.type.spec.parseDOM!.find(
        (rule) => 'tag' in rule && rule.tag === 'span[data-wya-badge]',
      );
      assert.ok(rule?.getAttrs);
      const attrs = rule.getAttrs({
        getAttribute: (name: string) => attributes[name] ?? null,
      } as unknown as HTMLElement);
      assert.notEqual(attrs, false);
      assert.ok(node.type.create(attrs || null).eq(node));
      assert.equal(node.isInline, true);
      assert.equal(node.isAtom, true);
      assert.equal(
        rule.getAttrs({
          getAttribute: () => '{"src":"javascript:alert(1)"}',
        } as unknown as HTMLElement),
        false,
      );
    }
  } finally {
    editor.destroy();
  }
});

test('badge Markdown and linked Shields snippets round-trip in pages and plain files', () => {
  const sources = [
    `Before :badge[Build passing]{src="${shield}" href="${badge.href}"} after.`,
    `:badge[Classic badge]{src="${png}"} :badge[Build passing]{src="${shield}"}`,
    `[![Build passing](${shield})](${badge.href})`,
    `![Build passing](${shield})`,
  ];
  const editor = createEditor();
  try {
    for (const source of sources)
      for (const options of [{}, { wya: false }, { preserveUnknown: true }]) {
        const document = markdownToRichDocument(source, options);
        const real = editor.schema.nodeFromJSON(document);
        real.check();
        assert.equal(real.firstChild!.type.name, 'paragraph');
        const badges = [] as unknown[];
        real.descendants((node) => {
          if (node.type.name === 'badge') badges.push(node.attrs.badge);
        });
        assert.ok(badges.length > 0);
        const output = richDocumentToMarkdown(document, source, options);
        const restored = editor.schema.nodeFromJSON(markdownToRichDocument(output, options));
        assert.ok(restored.eq(real));
        assert.doesNotThrow(() => parsePageSource(output, options));
      }
  } finally {
    editor.destroy();
  }
});

test('invalid recognized badge directives cannot be published in pages or plain files', () => {
  for (const source of [
    ':badge[No]{src="javascript:alert(1)"}',
    `:badge[No]{src="${shield}" href="javascript:alert(1)"}`,
    `:badge[No]{src="${shield}" onload="alert(1)"}`,
    `:badge[**No**]{src="${shield}"}`,
  ])
    for (const preserveUnknown of [false, true])
      assert.throws(() => parsePageSource(source, { preserveUnknown }), /valid badge image/);
});
