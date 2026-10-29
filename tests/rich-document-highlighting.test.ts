import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { history, undo } from '@tiptap/pm/history';
import { EditorState, TextSelection, type PluginView, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import {
  richCodeHighlightingKey,
  richCodeHighlightingPlugin,
} from '../lib/rich-document-highlighting.ts';
import type { SyntaxToken } from '../lib/syntax-highlighting.ts';

const schema = getSchema(createRichDocumentExtensions());
const code = (value: string, language: string | null = 'javascript') =>
  schema.nodes.codeBlock.create({ language }, value ? schema.text(value) : undefined);
const paragraph = (value: string) => schema.nodes.paragraph.create(null, schema.text(value));
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const afterTyping = () => new Promise((resolve) => setTimeout(resolve, 125));
const token = (from: number, to: number): SyntaxToken => ({
  from,
  to,
  color: 'var(--syntax-token-keyword)',
});

function harness(content: ProseMirrorNode[]) {
  const calls: {
    source: string;
    language: string | null | undefined;
    finish: (tokens: readonly SyntaxToken[] | null) => void;
    fail: (cause: Error) => void;
  }[] = [];
  const plugin = richCodeHighlightingPlugin(
    (source, language) =>
      new Promise((finish, fail) => calls.push({ source, language, finish, fail })),
  );
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, content),
    plugins: [history(), plugin],
  });
  const transactions: Transaction[] = [];
  const view = {
    get state() {
      return state;
    },
    composing: false,
    dispatch(transaction: Transaction) {
      transactions.push(transaction);
      const previous = state;
      state = state.apply(transaction);
      lifecycle?.update?.(view, previous);
    },
  } as EditorView;
  const lifecycle: PluginView = plugin.spec.view!(view);
  return {
    calls,
    transactions,
    view,
    plugin,
    get state() {
      return state;
    },
    spans: () => richCodeHighlightingKey.getState(state)!.decorations.find(),
    destroy: () => lifecycle?.destroy?.(),
  };
}

test('async colors use UTF-16 offsets across emoji and lines without changing content or history', async () => {
  const source = 'const face = "😀";\nreturn face;';
  const prefix = paragraph('Before');
  const h = harness([prefix, code(source)]);
  try {
    const doc = h.state.doc;
    const pos = prefix.nodeSize + 1;
    h.view.dispatch(h.state.tr.setSelection(TextSelection.create(h.state.doc, pos + 2)));
    const selection = h.state.selection.toJSON();
    await tick();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].source, source);
    const returnStart = source.indexOf('return');
    h.calls[0].finish([token(0, 5), token(returnStart, returnStart + 6)]);
    await tick();
    assert.deepEqual(
      h.spans().map(({ from, to }) => [from, to]),
      [
        [pos, pos + 5],
        [pos + returnStart, pos + returnStart + 6],
      ],
    );
    assert.equal(h.state.doc, doc);
    assert.deepEqual(h.state.selection.toJSON(), selection);
    const presentation = h.transactions.at(-1)!;
    assert.equal(presentation.docChanged, false);
    assert.equal(presentation.getMeta('addToHistory'), false);
    assert.equal(presentation.getMeta('preventUpdate'), true);
    assert.equal(undo(h.state), false);
  } finally {
    h.destroy();
  }
});

test('editing discards a stale result and recolors only the changed code block', async () => {
  const first = code('const a = 1;');
  const second = code('const b = 2;');
  const h = harness([first, second]);
  try {
    await tick();
    assert.equal(h.calls.length, 2);
    h.calls[1].finish([token(0, 5)]);
    await tick();
    h.view.dispatch(h.state.tr.insertText('x', 7));
    const count = h.transactions.length;
    h.calls[0].finish([token(0, 5)]);
    await tick();
    assert.equal(h.transactions.length, count, 'the obsolete block must not dispatch colors');
    assert.equal(h.spans().length, 1);
    assert.equal(h.spans()[0].from, first.nodeSize + 2);
    await afterTyping();
    assert.equal(h.calls.length, 3);
    assert.equal(h.calls[2].source, 'const xa = 1;');
    h.calls[2].finish([token(0, 5)]);
    await tick();
    assert.equal(h.spans().length, 2);
    assert.equal(h.calls.filter((call) => call.source === 'const b = 2;').length, 1);
  } finally {
    h.destroy();
  }
});

test('moving an unchanged block and selection-only transactions reuse its colors', async () => {
  const block = code('let stable = true;');
  const h = harness([block]);
  try {
    await tick();
    h.calls[0].finish([token(0, 3)]);
    await tick();
    const prefix = paragraph('Prefix');
    h.view.dispatch(h.state.tr.insert(0, prefix));
    assert.equal(h.spans()[0].from, prefix.nodeSize + 1);
    h.view.dispatch(h.state.tr.setSelection(TextSelection.create(h.state.doc, 2)));
    await afterTyping();
    assert.equal(h.calls.length, 1);
    assert.equal(h.state.doc.child(1), block);
  } finally {
    h.destroy();
  }
});

test('typing preserves mapped colors until new tokens arrive and plain text clears them', async () => {
  const h = harness([code('const a = 1;')]);
  try {
    await tick();
    h.calls[0].finish([token(0, 5)]);
    await tick();
    h.view.dispatch(h.state.tr.insertText('x', 7));
    assert.deepEqual(
      h.spans().map(({ from, to }) => [from, to]),
      [[1, 6]],
    );
    await afterTyping();
    h.calls[1].finish([token(0, 5), token(6, 8)]);
    await tick();
    assert.equal(h.spans().length, 2);
    h.view.dispatch(h.state.tr.setNodeMarkup(0, undefined, { language: null }));
    assert.equal(h.spans().length, 0);
    assert.equal(h.state.doc.firstChild!.textContent, 'const xa = 1;');
    await afterTyping();
    assert.equal(h.calls.length, 2);
  } finally {
    h.destroy();
  }
});

test('deleted blocks and a destroyed editor ignore outstanding asynchronous results', async () => {
  const block = code('const old = true;');
  const h = harness([block, paragraph('Keep')]);
  await tick();
  h.view.dispatch(h.state.tr.delete(0, block.nodeSize));
  const count = h.transactions.length;
  h.calls[0].finish([token(0, 5)]);
  await tick();
  assert.equal(h.transactions.length, count);
  assert.equal(h.spans().length, 0);
  h.destroy();

  const closed = harness([block]);
  await tick();
  closed.destroy();
  closed.calls[0].finish([token(0, 5)]);
  await tick();
  assert.equal(closed.transactions.length, 0);
});

test('composition defers token results until the native edit has settled', async () => {
  const h = harness([code('const text = "a";')]);
  try {
    await tick();
    const start = h.plugin.props.handleDOMEvents!.compositionstart!;
    start.call(h.plugin, h.view, {} as CompositionEvent);
    h.calls[0].finish([token(0, 5)]);
    await tick();
    assert.equal(h.transactions.length, 0);
    const end = h.plugin.props.handleDOMEvents!.compositionend!;
    end.call(h.plugin, h.view, {} as CompositionEvent);
    await afterTyping();
    assert.equal(h.spans().length, 1);
    assert.equal(
      h.transactions.every((transaction) => !transaction.docChanged),
      true,
    );
  } finally {
    h.destroy();
  }
});

test('unknown/plain code and failed highlighting remain ordinary editable text', async () => {
  const h = harness([code('plain', null), code('unknown', 'not-a-language'), code('let valid;')]);
  try {
    await tick();
    assert.equal(h.calls.length, 1);
    const doc = h.state.doc;
    h.calls[0].fail(new Error('grammar unavailable'));
    await tick();
    assert.equal(h.spans().length, 0);
    assert.equal(h.state.doc, doc);
    h.view.dispatch(h.state.tr.setSelection(TextSelection.create(h.state.doc, 1)));
    await afterTyping();
    assert.equal(h.calls.length, 1);
  } finally {
    h.destroy();
  }
});
