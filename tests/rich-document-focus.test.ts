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
} from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import {
  activeRichBlock,
  blockFocusKey,
  createBlockFocus,
} from '../app/components/document-editor/block-focus.ts';

const schema = getSchema(createRichDocumentExtensions());
const paragraph = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const section = (id: string) =>
  schema.nodes.wyaSection.create({ id, title: id }, paragraph('Inside'));

function fixture(content: ProseMirrorNode[]) {
  // The plugin's state and decoration paths only read editability; its DOM view
  // hooks are exercised in browser checks, not replaced with a simulated editor.
  const editor = { isEditable: true };
  const plugins = getExtensionField<() => Plugin[]>(createBlockFocus(), 'addProseMirrorPlugins', {
    editor,
  })();
  const plugin = plugins[0];
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, content),
    plugins,
  });
  return { editor, plugin, state };
}

function expectHighlight(plugin: Plugin, state: EditorState, pos: number | null, hovered = false) {
  const decorations = plugin.props.decorations!.call(plugin, state);
  assert.ok(decorations instanceof DecorationSet);
  const block = pos === null ? null : state.doc.nodeAt(pos);
  assert.deepEqual(
    decorations.find(),
    block && pos !== null
      ? [
          Decoration.node(pos, pos + block.nodeSize, {
            class: `rich-block-active${hovered ? ' rich-block-hovered' : ''}`,
          }),
        ]
      : [],
  );
}

test('focus, hover and keyboard caret changes highlight only the current block', () => {
  const first = paragraph('First');
  const second = paragraph('Second');
  const third = paragraph('Third');
  const { plugin, state: initial } = fixture([first, second, third]);
  let state = initial;
  assert.equal(activeRichBlock(state), null);
  expectHighlight(plugin, state, null);

  state = state.apply(state.tr.setMeta(blockFocusKey, { within: true }));
  expectHighlight(plugin, state, 0);
  const thirdPos = first.nodeSize + second.nodeSize;
  state = state.apply(state.tr.setMeta(blockFocusKey, { hover: thirdPos }));
  expectHighlight(plugin, state, thirdPos, true);

  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, first.nodeSize + 1)));
  assert.equal(blockFocusKey.getState(state)?.hover, null);
  assert.equal(activeRichBlock(state)?.pos, first.nodeSize);
  expectHighlight(plugin, state, first.nodeSize);
  assert.ok(state.doc.eq(initial.doc));

  state = state.apply(state.tr.setMeta(blockFocusKey, { within: false, explicit: null }));
  assert.equal(activeRichBlock(state), null);
  expectHighlight(plugin, state, null);
});

test('explicit section focus survives title edits and preceding insertions', () => {
  const group = section('Group');
  const { plugin, state: initial } = fixture([group, paragraph('Outside')]);
  let state = initial.apply(
    initial.tr
      .setSelection(TextSelection.create(initial.doc, group.nodeSize + 1))
      .setMeta(blockFocusKey, { within: true, explicit: 0 }),
  );
  expectHighlight(plugin, state, 0);
  for (const title of ['Edited', 'Edited title']) {
    state = state.apply(state.tr.setNodeMarkup(0, undefined, { id: 'Group', title }));
    assert.equal(blockFocusKey.getState(state)?.explicit, 0);
    assert.equal(activeRichBlock(state)?.node.attrs.title, title);
    expectHighlight(plugin, state, 0);
  }
  const inserted = paragraph('Before the group');
  state = state.apply(state.tr.insert(0, inserted));
  assert.equal(blockFocusKey.getState(state)?.explicit, inserted.nodeSize);
  assert.equal(activeRichBlock(state)?.node.attrs.id, 'Group');
  expectHighlight(plugin, state, inserted.nodeSize);
});

test('deleting an explicitly focused block does not transfer explicit focus to its next sibling', () => {
  const first = section('First');
  const { plugin, state: initial } = fixture([first, section('Second')]);
  let state = initial.apply(initial.tr.setMeta(blockFocusKey, { within: true, explicit: 0 }));
  state = state.apply(state.tr.delete(0, first.nodeSize));
  assert.equal(state.doc.firstChild!.attrs.id, 'Second');
  assert.equal(blockFocusKey.getState(state)?.explicit, null);
  state = state.apply(state.tr.setMeta(blockFocusKey, { within: false }));
  expectHighlight(plugin, state, null);
});

test('node selection highlights an atom, while read-only mode exposes no active block or decoration', () => {
  const gif = schema.nodes.gif.create({ gif: { provider: 'giphy', id: 'hello' } });
  const { editor, plugin, state: initial } = fixture([gif, paragraph('After')]);
  const state = initial.apply(
    initial.tr
      .setSelection(NodeSelection.create(initial.doc, 0))
      .setMeta(blockFocusKey, { within: true }),
  );
  assert.equal(activeRichBlock(state)?.node.type.name, 'gif');
  expectHighlight(plugin, state, 0);
  const all = state.apply(state.tr.setSelection(new AllSelection(state.doc)));
  assert.equal(activeRichBlock(all), null);
  expectHighlight(plugin, all, null);
  editor.isEditable = false;
  assert.equal(activeRichBlock(state, editor.isEditable), null);
  expectHighlight(plugin, state, null);
});
