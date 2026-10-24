import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getExtensionField, getSchema } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  AllSelection,
  EditorState,
  NodeSelection,
  TextSelection,
  type Plugin,
  type Transaction,
} from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import { createBlockSelection } from '../app/components/document-editor/block-selection.ts';

const schema = getSchema(createRichDocumentExtensions());
const paragraph = (text = '') =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);

function fixture(content: ProseMirrorNode[]) {
  const plugins = getExtensionField<() => Plugin[]>(
    createBlockSelection(),
    'addProseMirrorPlugins',
    {},
  )();
  const plugin = plugins[0];
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, content),
    plugins,
  });
  // Exercise the real plugin handlers and transactions without mounting a DOM view.
  const view = {
    get state() {
      return state;
    },
    dom: {},
    editable: true,
    dispatch(tr: Transaction) {
      state = state.apply(tr);
    },
  } as unknown as EditorView;
  const key = (options: Partial<KeyboardEvent> = {}) =>
    plugin.props.handleKeyDown!.call(plugin, view, {
      key: 'a',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      repeat: false,
      target: view.dom,
      ...options,
    } as KeyboardEvent);
  const caret = (from: number, to = from) =>
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  const reset = (event: 'pointerdown' | 'blur') =>
    plugin.props.handleDOMEvents![event]!.call(plugin, view, {} as never);
  return { view, key, caret, reset };
}

function expectText(view: EditorView, from: number, to: number) {
  assert.ok(view.state.selection instanceof TextSelection);
  assert.equal(view.state.selection.from, from);
  assert.equal(view.state.selection.to, to);
}

for (const modifier of ['metaKey', 'ctrlKey'] as const) {
  test(`${modifier} selects the current block, then every block and its contents`, () => {
    const first = paragraph('Before');
    const heading = schema.nodes.heading.create({ level: 2 }, schema.text('Current heading'));
    const { view, key, caret } = fixture([
      schema.nodes.horizontalRule.create(),
      first,
      heading,
      paragraph('After'),
      schema.nodes.gif.create(),
    ]);
    const start = 1 + first.nodeSize + 1;
    caret(start + 3);
    const original = view.state.doc;
    const press = () => key({ metaKey: false, ctrlKey: false, [modifier]: true });
    assert.equal(press(), true);
    expectText(view, start, start + heading.content.size);
    assert.equal(press(), true);
    assert.ok(view.state.selection instanceof AllSelection);
    assert.equal(view.state.selection.from, 0);
    assert.equal(view.state.selection.to, original.content.size);
    press();
    assert.ok(view.state.selection instanceof AllSelection);
    assert.equal(view.state.doc, original);
  });
}

test('a list entry is selected independently of its siblings', () => {
  const one = schema.nodes.listItem.create(null, paragraph('First idea'));
  const two = schema.nodes.listItem.create(null, paragraph('Second idea'));
  const list = schema.nodes.bulletList.create(null, [one, two]);
  const { view, key, caret } = fixture([list, paragraph('Outside')]);
  const start = 3 + one.nodeSize;
  caret(start + 2);
  key();
  assert.ok(view.state.selection instanceof NodeSelection);
  assert.equal(view.state.selection.from, one.nodeSize + 1);
  assert.equal(view.state.selection.node, two);
  key();
  assert.ok(view.state.selection instanceof AllSelection);
});

test('container selection includes trailing media instead of stopping at its last text', () => {
  const gif = schema.nodes.gif.create();
  const entry = schema.nodes.listItem.create(null, [paragraph('Caption'), gif]);
  const list = schema.nodes.bulletList.create(null, [entry]);
  const { view, key, caret } = fixture([list, paragraph('Outside')]);
  caret(4);
  key();
  assert.ok(view.state.selection instanceof NodeSelection);
  assert.equal(view.state.selection.node, entry);
  assert.equal(view.state.selection.content().content.firstChild!.lastChild, gif);
  key();
  assert.ok(view.state.selection instanceof AllSelection);
});

test('an explicitly selected section keeps its leading and trailing cards', () => {
  const first = schema.nodes.wyaItem.create({ item: { id: 'first' } });
  const last = schema.nodes.wyaItem.create({ item: { id: 'last' } });
  const section = schema.nodes.wyaSection.create(null, [first, paragraph('Text'), last]);
  const { view, key } = fixture([section, paragraph('Outside')]);
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
  key();
  assert.ok(view.state.selection instanceof NodeSelection);
  assert.equal(view.state.selection.node, section);
  assert.equal(view.state.selection.node.firstChild, first);
  assert.equal(view.state.selection.node.lastChild, last);
  key();
  assert.ok(view.state.selection instanceof AllSelection);
});

test('quote and section paragraphs select their own content without their container', () => {
  const first = paragraph('First');
  for (const wrapper of ['blockquote', 'wyaSection']) {
    const container = schema.nodes[wrapper].create(null, [first, paragraph('Current')]);
    const { view, key, caret } = fixture([container, paragraph('Outside')]);
    const start = first.nodeSize + 2;
    caret(start + 1);
    key();
    expectText(view, start, start + 'Current'.length);
    key();
    assert.ok(view.state.selection instanceof AllSelection);
  }
});

test('an empty paragraph still requires two separate presses', () => {
  const { view, key, caret } = fixture([paragraph(), paragraph('Other block')]);
  caret(1);
  key();
  expectText(view, 1, 1);
  key();
  assert.ok(view.state.selection instanceof AllSelection);
});

test('atomic blocks remain selected on the first press and expand on the second', () => {
  for (const type of ['gif', 'horizontalRule', 'wyaItem', 'markdownBlock']) {
    const { view, key } = fixture([schema.nodes[type].create(), paragraph('Outside')]);
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
    key();
    assert.ok(view.state.selection instanceof NodeSelection);
    assert.equal(view.state.selection.node.type.name, type);
    key();
    assert.ok(view.state.selection instanceof AllSelection);
  }
});

test('reversed partial selections expand locally; multi-block selections expand to the document', () => {
  const first = paragraph('First block');
  const { view, key, caret } = fixture([first, paragraph('Second block')]);
  caret(6, 2);
  key();
  expectText(view, 1, 1 + first.content.size);
  for (const [anchor, head] of [
    [2, first.nodeSize + 3],
    [first.nodeSize + 3, 2],
  ]) {
    caret(anchor, head);
    key();
    assert.ok(view.state.selection instanceof AllSelection);
  }
});

test('moving the caret or editing content resets the two-stage selection', () => {
  const first = paragraph('First');
  const { view, key, caret } = fixture([first, paragraph('Second')]);
  key();
  caret(first.nodeSize + 2);
  key();
  expectText(view, first.nodeSize + 1, first.nodeSize + 7);
  view.dispatch(view.state.tr.insertText('Replacement'));
  key();
  expectText(view, first.nodeSize + 1, first.nodeSize + 12);
  key();
  assert.ok(view.state.selection instanceof AllSelection);
});

test('pointer and focus changes reset progression even if the selection stays unchanged', () => {
  for (const event of ['pointerdown', 'blur'] as const) {
    const { view, key, reset } = fixture([paragraph('Current'), paragraph('Outside')]);
    key();
    assert.equal(reset(event), false);
    key();
    expectText(view, 1, 8);
    key();
    assert.ok(view.state.selection instanceof AllSelection);
  }
});

test('other keys reset progression; modifier keys and unrelated metadata preserve it', () => {
  const { view, key } = fixture([paragraph('Current'), paragraph('Outside')]);
  key();
  assert.equal(key({ key: 'ArrowLeft', metaKey: false }), false);
  key();
  expectText(view, 1, 8);
  assert.equal(key({ key: 'Meta' }), false);
  view.dispatch(view.state.tr.setMeta('unrelatedHover', true));
  key();
  assert.ok(view.state.selection instanceof AllSelection);
});

test('holding the shortcut does not skip the block stage', () => {
  const { view, key } = fixture([paragraph('Current'), paragraph('Outside')]);
  key();
  assert.equal(key({ repeat: true }), true);
  expectText(view, 1, 8);
  key();
  assert.ok(view.state.selection instanceof AllSelection);
});

test('native input targets and read-only views keep normal keyboard behavior', () => {
  const { view, key } = fixture([paragraph('Current'), paragraph('Outside')]);
  const initial = view.state;
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']) {
    assert.equal(key({ target: { tagName } as unknown as EventTarget }), false);
    assert.equal(view.state, initial);
  }
  for (const options of [
    { metaKey: false },
    { altKey: true },
    { shiftKey: true },
    { isComposing: true },
  ]) {
    assert.equal(key(options), false);
    assert.equal(view.state, initial);
  }
  Object.defineProperty(view, 'editable', { value: false });
  assert.equal(key(), false);
  assert.equal(view.state, initial);
});
