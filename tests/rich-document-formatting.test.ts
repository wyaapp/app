import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo, undoDepth } from '@tiptap/pm/history';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import { markdownToRichDocument, richDocumentToMarkdown } from '../lib/rich-document.ts';
import {
  richTextStyleTransaction,
  setRichTextStyle,
  type RichTextStyle,
} from '../lib/rich-document-formatting.ts';

function createEditor(source: string) {
  return new Editor({
    element: null,
    extensions: createRichDocumentExtensions(),
    content: markdownToRichDocument(source),
  });
}

function textRange(editor: Editor, first: string, last = first) {
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text!.includes(first) && from === -1)
      from = pos + node.text!.indexOf(first);
    if (node.isText && node.text!.includes(last)) to = pos + node.text!.indexOf(last) + last.length;
  });
  assert.ok(from >= 0 && to >= from);
  return { from, to };
}

function select(editor: Editor, first: string, last = first) {
  editor.commands.setTextSelection(textRange(editor, first, last));
}

function markdown(editor: Editor) {
  editor.state.doc.check();
  return richDocumentToMarkdown(editor.getJSON());
}

test('converts several list items and quote paragraphs without invalid inline nodes', () => {
  for (const source of ['- First\n- Second', '> First\n>\n> Second']) {
    for (const style of ['paragraph', '2'] as const) {
      const editor = createEditor(source);
      try {
        select(editor, 'First', 'Second');
        assert.equal(setRichTextStyle(editor, style), true);
        assert.equal(
          markdown(editor),
          style === '2' ? '## First\n\n## Second\n' : 'First\n\nSecond\n',
        );
        assert.equal(
          editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '|'),
          'First|Second',
        );
      } finally {
        editor.destroy();
      }
    }
  }
});

test('boundary-only selections do not change adjacent paragraphs', () => {
  const editor = createEditor('Before\n\nSelected\n\nAfter');
  try {
    const from = textRange(editor, 'Before').to;
    const to = textRange(editor, 'After').from;
    editor.commands.setTextSelection({ from, to });
    setRichTextStyle(editor, '2');
    assert.equal(markdown(editor), 'Before\n\n## Selected\n\nAfter\n');
    assert.equal(
      editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to),
      'Selected',
    );
  } finally {
    editor.destroy();
  }
});

test('converting one list item preserves its unselected siblings', () => {
  const editor = createEditor('- First\n- Second\n- Third');
  try {
    select(editor, 'Second');
    setRichTextStyle(editor, '2');
    assert.equal(markdown(editor), '- First\n\n## Second\n\n- Third\n');
  } finally {
    editor.destroy();
  }
});

test('formatting preserves Wya sections and inline marks', () => {
  const editor = createEditor(':::section[Socials]{id="socials"}\n- **First**\n- *Second*\n:::');
  try {
    select(editor, 'First', 'Second');
    setRichTextStyle(editor, '2');
    assert.equal(
      markdown(editor),
      ':::section[Socials]{#socials}\n## **First**\n\n## *Second*\n:::\n',
    );
    assert.equal(editor.state.doc.firstChild!.attrs.id, 'socials');
  } finally {
    editor.destroy();
  }
});

test('changing list type retains nested items and choosing it again does not toggle it off', () => {
  const editor = createEditor('- Parent\n  - Child\n- Sibling');
  try {
    select(editor, 'Parent', 'Sibling');
    setRichTextStyle(editor, 'orderedList');
    const converted = markdown(editor);
    assert.equal(converted, '1. Parent\n   - Child\n2. Sibling\n');
    setRichTextStyle(editor, 'orderedList');
    assert.equal(markdown(editor), converted);
  } finally {
    editor.destroy();
  }
});

test('converting a parent list item retains its unselected nested children', () => {
  const editor = createEditor('- Parent\n  - Child\n- Sibling');
  try {
    select(editor, 'Parent');
    assert.equal(setRichTextStyle(editor, '2'), true);
    assert.equal(markdown(editor), '## Parent\n\n- Child\n\n* Sibling\n');
    assert.equal(
      editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to),
      'Parent',
    );
  } finally {
    editor.destroy();
  }
});

test('all menu styles convert plain text and can return to paragraph', () => {
  for (const style of [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    'bulletList',
    'orderedList',
    'blockquote',
    'codeBlock',
  ] as RichTextStyle[]) {
    const editor = createEditor('Selected');
    try {
      select(editor, 'Selected');
      assert.equal(setRichTextStyle(editor, style), true);
      assert.notEqual(markdown(editor), 'Selected\n');
      assert.equal(setRichTextStyle(editor, 'paragraph'), true);
      assert.equal(markdown(editor), 'Selected\n');
    } finally {
      editor.destroy();
    }
  }
});

test('restores the menu selection and preserves its backwards direction', () => {
  const editor = createEditor('Before\n\nSelected');
  try {
    const { from, to } = textRange(editor, 'Selected');
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, to, from)),
    );
    const snapshot = editor.state;
    select(editor, 'Before');
    setRichTextStyle(editor, '2', snapshot);
    assert.equal(markdown(editor), 'Before\n\n## Selected\n');
    assert.ok(editor.state.selection.anchor > editor.state.selection.head);
  } finally {
    editor.destroy();
  }
});

test('multi-item conversion is one undo step', () => {
  const editor = createEditor('- First\n- Second');
  try {
    select(editor, 'First', 'Second');
    let state = EditorState.create({
      schema: editor.schema,
      doc: editor.state.doc,
      selection: editor.state.selection,
      plugins: [history()],
    });
    const before = state.doc;
    state = state.apply(richTextStyleTransaction(state, '2')!);
    assert.equal(undoDepth(state), 1);
    assert.equal(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
      true,
    );
    assert.ok(state.doc.eq(before));
  } finally {
    editor.destroy();
  }
});
