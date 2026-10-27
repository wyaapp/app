import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { closeHistory, history, redo, undo } from '@tiptap/pm/history';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import { unwrapRichSection } from '../lib/rich-document-sections.ts';

const schema = getSchema(createRichDocumentExtensions());
const paragraph = (text = '') =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
const stateFor = (...content: ProseMirrorNode[]) =>
  EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, content),
    plugins: [history()],
  });

test('unwrapping keeps card identity, prose, media and adjacent blocks exactly in order', () => {
  const item = schema.nodes.wyaItem.create({
    item: {
      id: 'item-one',
      slug: 'portfolio',
      aliases: ['work'],
      label: 'Portfolio',
      visible: true,
    },
  });
  const prose = schema.nodes.paragraph.create(
    null,
    schema.text('Details', [schema.marks.bold.create()]),
  );
  const media = schema.nodes.gif.create({
    gif: { provider: 'giphy', id: 'abc', width: 320, height: 240 },
  });
  const before = paragraph('Before');
  const after = paragraph('After');
  const section = schema.nodes.wyaSection.create({ id: 'group', title: 'Work' }, [
    item,
    prose,
    media,
  ]);
  const state = stateFor(before, section, after);
  const tr = unwrapRichSection(state, before.nodeSize)!;
  assert.ok(tr);
  assert.deepEqual(
    tr.doc.toJSON(),
    schema.nodes.doc.create(null, [before, item, prose, media, after]).toJSON(),
  );
  assert.equal(tr.doc.child(1), item);
  assert.equal(tr.doc.child(2), prose);
  assert.equal(tr.doc.child(3), media);
  tr.doc.check();
});

test('removing the only empty section leaves an editable paragraph', () => {
  const state = stateFor(schema.nodes.wyaSection.create({ id: 'empty', title: 'Empty' }));
  const tr = unwrapRichSection(state, 0)!;
  assert.ok(tr.doc.eq(schema.nodes.doc.create(null, paragraph())));
  assert.equal(tr.selection.from, 1);
  tr.doc.check();
});

test('unwrapping is one undoable operation and does not merge with subsequent typing', () => {
  const section = schema.nodes.wyaSection.create({ id: 'group', title: 'Work' }, paragraph('Text'));
  const initial = stateFor(section);
  let state = initial.apply(unwrapRichSection(initial, 0)!);
  const unwrapped = state.doc;
  state = state.apply(closeHistory(state.tr));
  state = state.apply(state.tr.insertText('More ', 1));
  assert.ok(
    undo(state, (tr) => {
      state = state.apply(tr);
    }),
  );
  assert.ok(state.doc.eq(unwrapped));
  assert.ok(
    undo(state, (tr) => {
      state = state.apply(tr);
    }),
  );
  assert.ok(state.doc.eq(initial.doc));
  assert.ok(
    redo(state, (tr) => {
      state = state.apply(tr);
    }),
  );
  assert.ok(state.doc.eq(unwrapped));
});

test('invalid positions and non-section blocks do not mutate the document', () => {
  const state = stateFor(paragraph('Keep'));
  for (const pos of [-1, 0, 0.5, NaN, Infinity, 2, state.doc.content.size])
    assert.equal(unwrapRichSection(state, pos), null);
  assert.equal(state.doc.textContent, 'Keep');
});
