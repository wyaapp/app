import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { closeHistory, history, redo, undo } from '@tiptap/pm/history';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import type { GifEmbed } from '../lib/gif.ts';
import {
  focusRichParagraph,
  insertRichBlock,
  resolveRichInsertionPoint,
  richDocumentBoundaries,
  RICH_CARET_TRANSACTION,
} from '../lib/rich-document-insertion.ts';

const schema = getSchema(createRichDocumentExtensions());
const paragraph = (text = '') =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
const card = (slug: string) =>
  schema.nodes.wyaItem.create({ item: { id: slug, slug, label: slug, visible: true } });
const section = (content: ProseMirrorNode[] = []) =>
  schema.nodes.wyaSection.create({ id: 'links', title: 'Links' }, content);
const document = (content: ProseMirrorNode[]) => schema.nodes.doc.create(null, content);
const stateFor = (doc: ProseMirrorNode, pos?: number) =>
  EditorState.create({
    doc,
    schema,
    plugins: [history()],
    ...(pos === undefined ? {} : { selection: TextSelection.create(doc, pos) }),
  });

test('slash GIF insertion stays in its section, leaves a typing position and undoes in one step', () => {
  const doc = document([section([paragraph('/gif'), card('after')])]);
  const state = stateFor(doc, 6);
  const gif = schema.nodes.gif.create({ gif: { provider: 'giphy', id: 'YsTs5ltWtEhnq' } });
  const tr = insertRichBlock(state, gif, { range: { from: 2, to: 6 } })!;
  assert.ok(tr);
  assert.equal(tr.doc.firstChild!.child(0).type.name, 'gif');
  assert.equal(tr.doc.firstChild!.child(1).type.name, 'paragraph');
  assert.equal(tr.doc.firstChild!.child(2).attrs.item.slug, 'after');
  assert.equal(tr.selection.$from.parent.type.name, 'paragraph');
  assert.equal(tr.selection.$from.node(-1).type.name, 'wyaSection');
  tr.doc.check();
  let next = state.apply(tr);
  assert.equal(
    undo(next, (transaction) => {
      next = next.apply(transaction);
    }),
    true,
  );
  assert.ok(next.doc.eq(doc));
});

test('GIF resize, fill width and reset have independent undo steps without undoing insertion', () => {
  const original = document([paragraph('/gif')]);
  let state = stateFor(original, 5);
  const gif: GifEmbed = {
    provider: 'giphy',
    id: 'YsTs5ltWtEhnq',
    width: 480,
    height: 270,
  };
  state = state.apply(
    insertRichBlock(state, schema.nodes.gif.create({ gif }), { range: { from: 1, to: 5 } })!,
  );
  const snapshots = [original, state.doc];
  for (const size of [640, 'full', undefined] as const) {
    const node = state.doc.nodeAt(0)!;
    const resized = { ...gif, ...(size !== undefined ? { size } : {}) };
    state = state.apply(
      closeHistory(state.tr).setNodeMarkup(0, undefined, { ...node.attrs, gif: resized }),
    );
    assert.deepEqual(state.doc.firstChild!.attrs.gif, resized);
    assert.equal(state.doc.child(1).type.name, 'paragraph');
    state.doc.check();
    snapshots.push(state.doc);
  }
  for (let index = snapshots.length - 2; index >= 0; index--) {
    assert.equal(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
      true,
    );
    assert.ok(state.doc.eq(snapshots[index]));
  }
  assert.equal(undo(state), false);
  for (const expected of snapshots.slice(1)) {
    assert.equal(
      redo(state, (transaction) => {
        state = state.apply(transaction);
      }),
      true,
    );
    assert.ok(state.doc.eq(expected));
  }
});

test('insertion boundaries include every card edge and section interior, never list/quote internals', () => {
  const list = schema.nodes.bulletList.create(null, [
    schema.nodes.listItem.create(null, paragraph('list')),
  ]);
  const quote = schema.nodes.blockquote.create(null, paragraph('quote'));
  const group = section([card('inside'), list]);
  const doc = document([card('first'), group, quote, section()]);
  const groupStart = 1;
  const quoteStart = groupStart + group.nodeSize;
  const emptySectionStart = quoteStart + quote.nodeSize;
  assert.deepEqual(richDocumentBoundaries(doc), [
    { pos: 0, parent: 'doc' },
    { pos: 1, parent: 'doc' },
    { pos: 2, parent: 'wyaSection', sectionPos: groupStart },
    { pos: 3, parent: 'wyaSection', sectionPos: groupStart },
    { pos: 3 + list.nodeSize, parent: 'wyaSection', sectionPos: groupStart },
    { pos: quoteStart, parent: 'doc' },
    { pos: emptySectionStart, parent: 'doc' },
    { pos: emptySectionStart + 1, parent: 'wyaSection', sectionPos: emptySectionStart },
    { pos: doc.content.size, parent: 'doc' },
  ]);
});

test('clicking before, between or after cards creates a usable caret without a content history entry', () => {
  const doc = document([card('first'), card('second')]);
  for (const pos of [0, 1, 2]) {
    const state = stateFor(doc);
    const tr = focusRichParagraph(state, pos)!;
    assert.ok(tr);
    assert.equal(tr.getMeta(RICH_CARET_TRANSACTION), true);
    assert.equal(tr.getMeta('addToHistory'), false);
    assert.equal(tr.selection.$from.parent.type.name, 'paragraph');
    assert.equal(tr.selection.from, pos + 1);
    const updated = state.apply(tr);
    assert.deepEqual(
      updated.doc.content.content.filter((node) => node.type.name === 'wyaItem'),
      doc.content.content,
    );
    assert.equal(undo(updated), false);
    updated.doc.check();
  }
});

test('repeated gap clicks reuse the adjacent empty paragraph without changing document content', () => {
  const doc = document([card('first'), paragraph(), card('second')]);
  for (const pos of [1, 3]) {
    const tr = focusRichParagraph(stateFor(doc), pos)!;
    assert.equal(tr.docChanged, false);
    assert.equal(tr.selection.from, 2);
    assert.ok(tr.doc.eq(doc));
  }
  const withText = document([paragraph('Keep this text'), card('second')]);
  const tr = focusRichParagraph(stateFor(withText), withText.firstChild!.nodeSize)!;
  assert.equal(tr.doc.child(0).textContent, 'Keep this text');
  assert.equal(tr.doc.child(1).type.name, 'paragraph');
  assert.equal(tr.doc.child(1).content.size, 0);
});

test('section gaps focus inside their section and invalid nested/stale positions do nothing', () => {
  const group = section([card('inside'), paragraph('text')]);
  const doc = document([group]);
  const state = stateFor(doc);
  for (const pos of [1, 2, group.nodeSize - 1]) {
    const tr = focusRichParagraph(state, pos)!;
    assert.equal(tr.selection.$from.node(-1).type.name, 'wyaSection');
    tr.doc.check();
  }
  for (const pos of [-1, 0.5, doc.content.size + 1, 4])
    assert.equal(focusRichParagraph(state, pos), null);
  assert.ok(state.doc.eq(doc));
});

test('insertion resolves after the outer list or quote but keeps cards in the active section', () => {
  const list = schema.nodes.bulletList.create(null, [
    schema.nodes.listItem.create(null, paragraph('list')),
  ]);
  const quote = schema.nodes.blockquote.create(null, paragraph('quote'));
  const doc = document([section([list, quote])]);
  const listState = stateFor(doc, 4);
  assert.equal(resolveRichInsertionPoint(listState), 1 + list.nodeSize);
  assert.equal(resolveRichInsertionPoint(listState, { section: true }), doc.content.size);
  const quoteState = stateFor(doc, 1 + list.nodeSize + 2);
  assert.equal(resolveRichInsertionPoint(quoteState), doc.content.size - 1);
  const tr = insertRichBlock(listState, card('new'))!;
  assert.equal(tr.doc.firstChild!.child(1).type.name, 'wyaItem');
  assert.equal(tr.doc.firstChild!.child(2).type.name, 'paragraph');
  assert.equal(tr.doc.firstChild!.child(3).type.name, 'blockquote');
  tr.doc.check();
});

test('selected cards insert after the selection rather than replacing or preceding the card', () => {
  const doc = document([card('first'), card('second')]);
  const state = EditorState.create({ schema, doc, selection: NodeSelection.create(doc, 0) });
  assert.equal(resolveRichInsertionPoint(state), 1);
  const tr = insertRichBlock(state, card('new'))!;
  assert.deepEqual(
    tr.doc.content.content
      .filter((node) => node.type.name === 'wyaItem')
      .map((node) => node.attrs.item.slug),
    ['first', 'new', 'second'],
  );
});

test('basic blocks replace an empty landing paragraph and focus their editable text', () => {
  const blocks = [
    schema.nodes.heading.create({ level: 2 }),
    schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, paragraph())),
    schema.nodes.blockquote.create(null, paragraph()),
    schema.nodes.codeBlock.create(),
  ];
  for (const block of blocks) {
    const doc = document([card('before'), paragraph(), card('after')]);
    const tr = insertRichBlock(stateFor(doc, 2), block)!;
    assert.equal(tr.doc.childCount, 3);
    assert.equal(tr.doc.child(1).type.name, block.type.name);
    assert.ok(tr.selection.$from.parent.isTextblock);
    assert.equal(tr.selection.$from.parent.content.size, 0);
    tr.doc.check();
  }
});

test('slash insertion replaces only its standalone query and cancelling leaves the document untouched', () => {
  const doc = document([card('first'), paragraph('/discord'), card('second')]);
  const state = stateFor(doc, 10);
  const capturedRange = { from: 2, to: 10 };
  // Opening or cancelling a menu only captures the range; it cannot mutate state.
  assert.equal(state.doc.child(1).textContent, '/discord');
  const tr = insertRichBlock(state, card('discord'), { range: capturedRange })!;
  assert.equal(tr.doc.child(1).attrs.item.slug, 'discord');
  assert.equal(tr.doc.child(2).type.name, 'paragraph');
  assert.equal(tr.doc.child(3).attrs.item.slug, 'second');
  assert.equal(tr.selection.from, 3);
  assert.equal(state.doc.child(1).textContent, '/discord');
  tr.doc.check();
});

test('slash insertion refuses normal text and nested list queries instead of deleting content', () => {
  const ordinary = document([paragraph('Before /card after')]);
  const ordinaryState = stateFor(ordinary, 13);
  assert.equal(insertRichBlock(ordinaryState, card('new'), { range: { from: 8, to: 13 } }), null);
  const nested = document([
    schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, paragraph('/card'))),
  ]);
  const nestedState = stateFor(nested, 8);
  assert.equal(insertRichBlock(nestedState, card('new'), { range: { from: 3, to: 8 } }), null);
  assert.ok(ordinaryState.doc.eq(ordinary));
  assert.ok(nestedState.doc.eq(nested));
});

test('new sections lift to the root and leave existing section content intact', () => {
  const doc = document([section([card('first'), paragraph('/section')]), card('last')]);
  const state = stateFor(doc, 11);
  const tr = insertRichBlock(state, section(), { range: { from: 3, to: 11 } })!;
  assert.equal(tr.doc.childCount, 3);
  assert.equal(tr.doc.child(0).childCount, 1);
  assert.equal(tr.doc.child(0).child(0).attrs.item.slug, 'first');
  assert.equal(tr.doc.child(1).type.name, 'wyaSection');
  assert.equal(tr.doc.child(1).child(0).type.name, 'paragraph');
  assert.equal(tr.selection.$from.node(-1), tr.doc.child(1));
  assert.equal(tr.doc.child(2).attrs.item.slug, 'last');
  tr.doc.check();
});

test('one undo restores both slash query and surrounding cards after insertion', () => {
  const doc = document([card('first'), paragraph('/link'), card('second')]);
  const state = stateFor(doc, 7);
  const tr = insertRichBlock(state, card('new'), { range: { from: 2, to: 7 } })!;
  let current = state.apply(tr);
  assert.equal(
    undo(current, (next) => {
      current = current.apply(next);
    }),
    true,
  );
  assert.ok(current.doc.eq(doc));
  assert.equal(undo(current), false);
});
