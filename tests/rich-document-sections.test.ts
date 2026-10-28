import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getExtensionField, getSchema } from '@tiptap/core';
import { closeHistory, history, redo, undo } from '@tiptap/pm/history';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  EditorState,
  NodeSelection,
  TextSelection,
  type Plugin,
  type Transaction,
} from '@tiptap/pm/state';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import {
  createSectionMigration,
  migrateRichSections,
  unwrapRichSection,
} from '../lib/rich-document-sections.ts';

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

const migrationStateFor = (...content: ProseMirrorNode[]) =>
  EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, content),
    plugins: [
      history(),
      ...getExtensionField<() => Plugin[]>(createSectionMigration(), 'addProseMirrorPlugins')(),
    ],
  });

test('section migration retains literal titles, marked prose and block identity', () => {
  const item = schema.nodes.wyaItem.create({
    item: { id: 'preserved', slug: 'work', label: 'Work', visible: true },
  });
  const prose = schema.nodes.paragraph.create(
    null,
    schema.text('Marked text', [schema.marks.bold.create()]),
  );
  const title = '**Literal** [title](https://example.com)';
  const media = schema.nodes.gif.create({ gif: { provider: 'giphy', id: 'preserved-media' } });
  const section = schema.nodes.wyaSection.create({ id: 'old', title }, [item, prose, media]);
  const tr = migrateRichSections(stateFor(section))!;
  assert.equal(tr.doc.child(0).type.name, 'heading');
  assert.equal(tr.doc.child(0).attrs.level, 3);
  assert.equal(tr.doc.child(0).textContent, title);
  assert.deepEqual(tr.doc.child(0).child(0).marks, []);
  assert.equal(tr.doc.child(1), item);
  assert.equal(tr.doc.child(2), prose);
  assert.equal(tr.doc.child(3), media);
  tr.doc.check();
});

test('section migration handles several sections and keeps surrounding blocks in order', () => {
  const before = paragraph('Before');
  const first = paragraph('First');
  const between = paragraph('Between');
  const second = paragraph('Second');
  const after = paragraph('After');
  const state = stateFor(
    before,
    schema.nodes.wyaSection.create({ title: 'One' }, first),
    between,
    schema.nodes.wyaSection.create({ title: '' }, second),
    schema.nodes.wyaSection.create({ title: 'Empty with a title' }),
    schema.nodes.wyaSection.create({ title: '' }),
    after,
  );
  const tr = migrateRichSections(state)!;
  assert.deepEqual(
    tr.doc.content.content.map((node) => [node.type.name, node.textContent]),
    [
      ['paragraph', 'Before'],
      ['heading', 'One'],
      ['paragraph', 'First'],
      ['paragraph', 'Between'],
      ['paragraph', 'Second'],
      ['heading', 'Empty with a title'],
      ['paragraph', 'After'],
    ],
  );
  assert.equal(tr.doc.child(2), first);
  assert.equal(tr.doc.child(4), second);
  tr.doc.check();
});

test('migration leaves an editable paragraph when all sections are empty and untitled', () => {
  const empty = schema.nodes.wyaSection.create({ title: '' });
  for (const content of [[empty], [empty, empty, empty]]) {
    const tr = migrateRichSections(stateFor(...content))!;
    assert.ok(tr.doc.eq(schema.nodes.doc.create(null, paragraph())));
    assert.equal(tr.selection.from, 1);
    tr.doc.check();
  }
});

test('migration maps text and node selections to the same section children', () => {
  const before = paragraph('Before');
  const text = paragraph('Selected text');
  const item = schema.nodes.wyaItem.create({ item: { id: 'selected', label: 'Item' } });
  const section = schema.nodes.wyaSection.create({ title: 'Title' }, [text, item]);
  const state = stateFor(before, section);
  const textStart = before.nodeSize + 2;
  const selectedText = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, textStart + 2, textStart + 6)),
  );
  const textTr = migrateRichSections(selectedText)!;
  assert.equal(textTr.selection.$from.parent, text);
  assert.equal(textTr.selection.$from.parentOffset, 2);
  assert.equal(textTr.selection.$to.parentOffset, 6);

  const selectedItem = state.apply(
    state.tr.setSelection(NodeSelection.create(state.doc, before.nodeSize + 1 + text.nodeSize)),
  );
  const itemTr = migrateRichSections(selectedItem)!;
  assert.ok(itemTr.selection instanceof NodeSelection);
  assert.equal(itemTr.selection.node, item);
});

test('a legacy paste and its migration undo and redo together without restoring wrappers', () => {
  const initial = migrationStateFor(paragraph('Existing'));
  let state = initial;
  const child = paragraph('Pasted');
  const section = schema.nodes.wyaSection.create({ title: 'Paste title' }, child);
  const applied = state.applyTransaction(
    state.tr.insert(state.doc.content.size, section).setMeta('uiEvent', 'paste'),
  );
  assert.equal(applied.transactions.length, 2);
  state = applied.state;
  const pasted = state.doc;
  assert.deepEqual(
    pasted.content.content.map((node) => node.type.name),
    ['paragraph', 'heading', 'paragraph'],
  );
  assert.equal(pasted.lastChild, child);
  const apply = (tr: Transaction) => {
    state = state.applyTransaction(tr).state;
    assert.ok(state.doc.content.content.every((node) => node.type.name !== 'wyaSection'));
  };
  for (let cycle = 0; cycle < 2; cycle++) {
    assert.equal(undo(state, apply), true);
    assert.ok(state.doc.eq(initial.doc));
    assert.equal(undo(state, apply), false, 'normalization is not a separate undo event');
    assert.equal(redo(state, apply), true);
    assert.ok(state.doc.eq(pasted));
    assert.equal(redo(state, apply), false);
  }
});

test('ordinary text edits and selection changes do not append a migration', () => {
  const state = migrationStateFor(paragraph('Ordinary'));
  assert.equal(migrateRichSections(state), null);
  const edited = state.applyTransaction(state.tr.insertText('More ', 1));
  assert.equal(edited.transactions.length, 1);
  assert.equal(edited.state.doc.textContent, 'More Ordinary');
  const selected = edited.state.applyTransaction(
    edited.state.tr.setSelection(TextSelection.create(edited.state.doc, 3)),
  );
  assert.equal(selected.transactions.length, 1);
  assert.equal(selected.state.doc, edited.state.doc);
});
