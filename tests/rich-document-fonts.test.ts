import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '@tiptap/core';
import { history, undo, undoDepth } from '@tiptap/pm/history';
import { AllSelection, EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import { markdownToRichDocument } from '../lib/rich-document.ts';
import {
  getRichFontSelection,
  richFontTransaction,
  setRichFont,
} from '../lib/rich-document-fonts.ts';
import type { ProfileFont } from '../lib/profile-fonts.ts';

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

function textRuns(editor: Editor) {
  const result: { text: string; marks: { type: string; attrs: Record<string, unknown> }[] }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText)
      result.push({
        text: node.text!,
        marks: node.marks.map((mark) => ({ type: mark.type.name, attrs: { ...mark.attrs } })),
      });
  });
  return result;
}

test('font formatting changes only selected text and preserves other marks', () => {
  const editor = createEditor('Before **middle [linked](https://example.com)** after');
  try {
    const originalText = editor.state.doc.textContent;
    select(editor, 'middle', 'linked');
    const selection = editor.state.selection;
    assert.equal(setRichFont(editor, 'geo'), true);
    assert.equal(editor.state.doc.textContent, originalText);
    assert.ok(editor.state.selection.eq(selection));
    const runs = textRuns(editor);
    assert.equal(runs.find((run) => run.text === 'Before ')!.marks.length, 0);
    assert.equal(runs.find((run) => run.text === ' after')!.marks.length, 0);
    assert.deepEqual(
      runs
        .find((run) => run.text === 'middle ')!
        .marks.map((mark) => mark.type)
        .sort(),
      ['bold', 'fontFamily'],
    );
    const linked = runs.find((run) => run.text === 'linked')!;
    assert.equal(
      linked.marks.find((mark) => mark.type === 'link')!.attrs.href,
      'https://example.com',
    );
    assert.equal(linked.marks.find((mark) => mark.type === 'fontFamily')!.attrs.font, 'geo');

    select(editor, 'linked');
    assert.equal(setRichFont(editor, null), true);
    const cleared = textRuns(editor).find((run) => run.text === 'linked')!;
    assert.deepEqual(cleared.marks.map((mark) => mark.type).sort(), ['bold', 'link']);
    assert.equal(
      textRuns(editor)
        .find((run) => run.text === 'middle ')!
        .marks.find((mark) => mark.type === 'fontFamily')!.attrs.font,
      'geo',
    );
  } finally {
    editor.destroy();
  }
});

test('mixed selection checks every text run instead of reporting the first font', () => {
  const editor = createEditor('First second third');
  try {
    select(editor, 'second');
    setRichFont(editor, 'geo');
    select(editor, 'First', 'third');
    assert.deepEqual(getRichFontSelection(editor.state), {
      font: null,
      inherited: false,
      mixed: true,
      enabled: true,
    });
    setRichFont(editor, 'jetbrains-mono');
    assert.deepEqual(getRichFontSelection(editor.state), {
      font: 'jetbrains-mono',
      inherited: false,
      mixed: false,
      enabled: true,
    });
  } finally {
    editor.destroy();
  }
});

test('inherited heading and body faces are compared using the document defaults', () => {
  const editor = createEditor('## Heading\n\nBody');
  try {
    select(editor, 'Heading', 'Body');
    assert.equal(getRichFontSelection(editor.state).mixed, true);
    assert.deepEqual(getRichFontSelection(editor.state, { headingFont: 'geo', bodyFont: 'geo' }), {
      font: 'geo',
      inherited: true,
      mixed: false,
      enabled: true,
    });
    assert.equal(
      getRichFontSelection(editor.state, { headingFont: 'geo', bodyFont: 'jetbrains-mono' }).mixed,
      true,
    );
    setRichFont(editor, 'original');
    assert.equal(getRichFontSelection(editor.state).mixed, true);
  } finally {
    editor.destroy();
  }
});

test('explicit and inherited text with the same face remain uniform', () => {
  const editor = createEditor('First second');
  try {
    select(editor, 'second');
    setRichFont(editor, 'geo');
    select(editor, 'First', 'second');
    assert.deepEqual(getRichFontSelection(editor.state, { bodyFont: 'geo' }), {
      font: 'geo',
      inherited: false,
      mixed: false,
      enabled: true,
    });
    assert.equal(getRichFontSelection(editor.state, { bodyFont: 'serif' }).mixed, true);
  } finally {
    editor.destroy();
  }
});

test('boundary-only text and unselected list siblings do not affect the indicator', () => {
  const editor = createEditor('- Before\n- Selected\n- After');
  try {
    select(editor, 'Before');
    setRichFont(editor, 'geo');
    select(editor, 'Selected');
    setRichFont(editor, 'jetbrains-mono');
    editor.commands.setTextSelection({
      from: textRange(editor, 'Before').to,
      to: textRange(editor, 'After').from,
    });
    assert.equal(getRichFontSelection(editor.state).font, 'jetbrains-mono');
    assert.equal(getRichFontSelection(editor.state).mixed, false);
  } finally {
    editor.destroy();
  }
});

test('code and atomic selections are not fontable and survive neighboring formatting', () => {
  const editor = createEditor('Before `code` after\n\n```\nblock code\n```\n\n---');
  try {
    select(editor, 'Before', 'block code');
    assert.equal(setRichFont(editor, 'geo'), true);
    const runs = textRuns(editor);
    assert.deepEqual(
      runs.find((run) => run.text === 'code')!.marks.map((mark) => mark.type),
      ['code'],
    );
    assert.deepEqual(runs.find((run) => run.text === 'block code')!.marks, []);
    assert.equal(getRichFontSelection(editor.state).mixed, true);
    const codeFrom = textRange(editor, 'code').from;
    editor.commands.setTextSelection({ from: codeFrom, to: codeFrom + 4 });
    assert.equal(getRichFontSelection(editor.state).enabled, false);
    assert.equal(setRichFont(editor, 'geo'), false);
    select(editor, 'block code');
    assert.equal(setRichFont(editor, 'geo'), false);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, editor.state.doc.content.size - 1),
      ),
    );
    assert.equal(getRichFontSelection(editor.state).enabled, false);
    assert.equal(setRichFont(editor, 'geo'), false);
  } finally {
    editor.destroy();
  }
});

test('a font picker restores its captured selection but rejects stale document snapshots', () => {
  const editor = createEditor('Before\n\nSelected');
  try {
    const range = textRange(editor, 'Selected');
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.to, range.from)),
    );
    const snapshot = editor.state;
    select(editor, 'Before');
    assert.equal(setRichFont(editor, 'geo', snapshot), true);
    assert.ok(editor.state.selection.anchor > editor.state.selection.head);
    assert.equal(textRuns(editor)[0].marks.length, 0);
    assert.equal(textRuns(editor)[1].marks[0].attrs.font, 'geo');

    const stale = editor.state;
    editor.view.dispatch(editor.state.tr.insertText('Changed'));
    const changed = editor.state.doc;
    assert.equal(setRichFont(editor, 'serif', stale), false);
    assert.ok(editor.state.doc.eq(changed));
  } finally {
    editor.destroy();
  }
});

test('collapsed-caret font choice updates typing marks without changing existing content', () => {
  const editor = createEditor('Existing');
  try {
    editor.commands.setTextSelection(textRange(editor, 'Existing').to);
    editor.commands.toggleBold();
    const before = editor.state.doc;
    assert.equal(setRichFont(editor, 'geo'), true);
    assert.ok(editor.state.doc.eq(before));
    assert.equal(getRichFontSelection(editor.state).font, 'geo');
    assert.equal(
      editor.state.storedMarks?.some((mark) => mark.type.name === 'bold'),
      true,
    );
    assert.equal(setRichFont(editor, null), true);
    assert.equal(getRichFontSelection(editor.state, { bodyFont: 'serif' }).font, 'serif');
    assert.equal(
      editor.state.storedMarks?.some((mark) => mark.type.name === 'bold'),
      true,
    );
  } finally {
    editor.destroy();
  }
});

test('multi-block font changes are one undo step separate from preceding typing', () => {
  const editor = createEditor('- Parent\n  - Child\n- Sibling');
  try {
    let state = EditorState.create({
      schema: editor.schema,
      doc: editor.state.doc,
      plugins: [history()],
    });
    state = state.apply(state.tr.insertText('New ', 3));
    const before = state.doc;
    state = state.apply(state.tr.setSelection(new AllSelection(state.doc)));
    state = state.apply(richFontTransaction(state, 'geo')!);
    assert.equal(undoDepth(state), 2);
    assert.equal(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
      true,
    );
    assert.ok(state.doc.eq(before));
    assert.equal(undoDepth(state), 1);
    assert.equal(richFontTransaction(state, 'url(https://example.com)' as ProfileFont), null);
  } finally {
    editor.destroy();
  }
});
