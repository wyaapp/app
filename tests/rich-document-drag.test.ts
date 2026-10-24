import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { history, redo, undo } from '@tiptap/pm/history';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import {
  moveRichBlock,
  richBlockAt,
  richBlockAtSelection,
  richBlockBoundaries,
  siblingRichBlockTarget,
} from '../lib/rich-document-drag.ts';

const schema = getSchema(createRichDocumentExtensions());
const paragraph = (text = '') =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
const card = (id: string) =>
  schema.nodes.wyaItem.create({
    item: { id, slug: id, label: id, url: `https://example.com/${id}`, visible: true },
  });
const section = (id: string, content: ProseMirrorNode[] = []) =>
  schema.nodes.wyaSection.create({ id, title: id }, content);
const document = (content: ProseMirrorNode[]) => schema.nodes.doc.create(null, content);
const stateFor = (doc: ProseMirrorNode) =>
  EditorState.create({ doc, schema, plugins: [history()] });

test('moving a GIF in either direction keeps its media and display attributes intact', () => {
  const gif = schema.nodes.gif.create({
    gif: { provider: 'giphy', id: 'abc123', title: 'Hello', width: 480, height: 270, size: 240 },
  });
  const intro = paragraph('Introduction');
  const outro = paragraph('The end');
  const original = document([gif, intro, outro]);
  const forward = moveRichBlock(stateFor(original), 0, original.content.size)!;
  assert.ok(forward);
  assert.equal(forward.doc.child(2), gif);
  assert.deepEqual(forward.doc.child(2).attrs, gif.attrs);
  assert.ok(forward.selection instanceof NodeSelection);
  assert.equal(forward.selection.from, intro.nodeSize + outro.nodeSize);
  const backward = moveRichBlock(stateFor(forward.doc), forward.selection.from, 0)!;
  assert.ok(backward.doc.eq(original));
  forward.doc.check();
  backward.doc.check();
});

test('cards can move between sections and the document without changing identity or redirects', () => {
  const item = card('portfolio');
  const first = section('first', [item]);
  const second = section('second', [paragraph('Details')]);
  const original = document([first, second]);
  const destination = first.nodeSize + 1;
  const moved = moveRichBlock(stateFor(original), 1, destination)!;
  assert.ok(moved);
  assert.equal(moved.doc.firstChild!.content.size, 0);
  assert.equal(moved.doc.child(1).firstChild, item);
  assert.deepEqual(moved.doc.child(1).firstChild!.attrs.item, item.attrs.item);
  const lifted = moveRichBlock(stateFor(moved.doc), 3, moved.doc.content.size)!;
  assert.equal(lifted.doc.child(2), item);
  assert.equal(lifted.doc.child(1).firstChild!.textContent, 'Details');
  moved.doc.check();
  lifted.doc.check();
});

test('a whole section moves with its title, identity, card and formatted prose', () => {
  const prose = schema.nodes.paragraph.create(null, [
    schema.text('Read ', [schema.marks.bold.create()]),
    schema.text('this', [schema.marks.link.create({ href: 'https://example.com', title: 'Link' })]),
  ]);
  const group = section('my-section', [card('site'), prose]);
  const outside = paragraph('Outside');
  const original = document([group, outside]);
  const moved = moveRichBlock(stateFor(original), 0, original.content.size)!;
  assert.equal(moved.doc.lastChild, group);
  assert.deepEqual(moved.doc.lastChild!.toJSON(), group.toJSON());
  moved.doc.check();
});

test('reordering lists and quotes keeps their nested structure whole', () => {
  const list = schema.nodes.bulletList.create(null, [
    schema.nodes.listItem.create(null, paragraph('One')),
    schema.nodes.listItem.create(null, paragraph('Two')),
  ]);
  const quote = schema.nodes.blockquote.create(null, paragraph('A quote'));
  const original = document([list, quote]);
  const moved = moveRichBlock(stateFor(original), 0, original.content.size)!;
  assert.equal(moved.doc.firstChild, quote);
  assert.equal(moved.doc.lastChild, list);
  assert.equal(moveRichBlock(stateFor(original), 1, original.content.size), null);
  assert.equal(moveRichBlock(stateFor(original), list.nodeSize, 2), null);
  moved.doc.check();
});

test('invalid, own-range, schema-incompatible and unchanged drops do nothing', () => {
  const first = section('first', [card('inside'), paragraph('Words')]);
  const second = section('second');
  const original = document([first, second, paragraph('Tail')]);
  const state = stateFor(original);
  for (const target of [-1, 0.5, NaN, Infinity, original.content.size + 1, 0, 1, 2, first.nodeSize])
    assert.equal(moveRichBlock(state, 0, target), null);
  // A section cannot become a child of another section.
  assert.equal(moveRichBlock(state, 0, first.nodeSize + 1), null);
  // Nor can a block be placed in the middle of prose.
  assert.equal(moveRichBlock(state, first.nodeSize, 4), null);
  for (const from of [-1, 0.5, NaN, Infinity, original.content.size, original.content.size + 1, 4])
    assert.equal(moveRichBlock(state, from, 0), null);
  assert.ok(state.doc.eq(original));
  const identical = stateFor(document([paragraph('Same'), paragraph('Same')]));
  assert.equal(moveRichBlock(identical, 0, identical.doc.content.size), null);
});

test('sibling targets use original positions and never cross a section boundary', () => {
  const a = paragraph('A');
  const b = card('b');
  const c = paragraph('C');
  const group = section('group', [a, b, c]);
  const original = document([paragraph('Before'), group, paragraph('After')]);
  const state = stateFor(original);
  const start = original.firstChild!.nodeSize + 1;
  const middle = start + a.nodeSize;
  assert.equal(siblingRichBlockTarget(state, start, -1), null);
  assert.equal(siblingRichBlockTarget(state, start, 1), middle + b.nodeSize);
  assert.equal(siblingRichBlockTarget(state, middle, -1), start);
  assert.equal(siblingRichBlockTarget(state, middle, 1), middle + b.nodeSize + c.nodeSize);
  assert.equal(siblingRichBlockTarget(state, middle + b.nodeSize, 1), null);
  assert.equal(siblingRichBlockTarget(state, middle + 2, 1), null);
  const moved = moveRichBlock(state, middle, siblingRichBlockTarget(state, middle, 1)!)!;
  assert.deepEqual(moved.doc.child(1).content.content, [a, c, b]);
  moved.doc.check();
});

test('each reorder is one undo step, separate from typing and other moves', () => {
  const original = document([paragraph('First'), card('middle'), paragraph('Last')]);
  let state = stateFor(original);
  state = state.apply(state.tr.insertText('!', 6));
  const typed = state.doc;
  state = state.apply(moveRichBlock(state, state.doc.firstChild!.nodeSize, 0)!);
  const firstMove = state.doc;
  state = state.apply(moveRichBlock(state, 0, state.doc.content.size)!);
  const lastMove = state.doc;
  for (const expected of [firstMove, typed, original]) {
    assert.equal(
      undo(state, (transaction) => (state = state.apply(transaction))),
      true,
    );
    assert.ok(state.doc.eq(expected));
  }
  assert.equal(undo(state), false);
  for (const expected of [typed, firstMove, lastMove]) {
    assert.equal(
      redo(state, (transaction) => (state = state.apply(transaction))),
      true,
    );
    assert.ok(state.doc.eq(expected));
    state.doc.check();
  }
});

const listItem = (...content: ProseMirrorNode[]) => schema.nodes.listItem.create(null, content);
const bulletList = (...items: ProseMirrorNode[]) => schema.nodes.bulletList.create(null, items);
const quote = (...content: ProseMirrorNode[]) => schema.nodes.blockquote.create(null, content);
function positionOf(doc: ProseMirrorNode, node: ProseMirrorNode): number {
  let found = -1;
  doc.descendants((child, pos) => {
    if (child === node) found = pos;
    return found === -1;
  });
  assert.notEqual(found, -1);
  return found;
}

test('every supported block, including empty paragraphs and dividers, can be reordered', () => {
  const blocks = [
    paragraph(),
    schema.nodes.horizontalRule.create(),
    schema.nodes.heading.create({ level: 2 }, schema.text('Heading')),
    schema.nodes.codeBlock.create({ language: 'js' }, schema.text('const n = 1;')),
    schema.nodes.markdownBlock.create({ source: '| A | B |\n| - | - |' }),
    schema.nodes.gif.create({ gif: { provider: 'giphy', id: 'abc', size: 'full' } }),
    card('card'),
    section('section', [paragraph('Section prose')]),
    bulletList(listItem(paragraph('List prose'))),
    schema.nodes.orderedList.create({ start: 4 }, listItem(paragraph('Numbered prose'))),
    quote(paragraph('Quoted prose')),
  ];
  for (const block of blocks) {
    const original = document([paragraph('Before'), block, paragraph('After')]);
    const pos = original.firstChild!.nodeSize;
    assert.equal(richBlockAt(original, pos)?.node, block);
    const moved = moveRichBlock(stateFor(original), pos, original.content.size)!;
    assert.ok(moved, block.type.name);
    assert.equal(moved.doc.lastChild, block);
    assert.deepEqual(moved.doc.lastChild!.toJSON(), block.toJSON());
    moved.doc.check();
  }
});

test('nested boundaries expose their exact parent without creating boundaries inside text', () => {
  const nestedParagraph = paragraph('Nested');
  const nestedList = schema.nodes.orderedList.create({ start: 3 }, [listItem(nestedParagraph)]);
  const group = section('group', [quote(bulletList(listItem(paragraph('First'), nestedList)))]);
  const doc = document([group, paragraph()]);
  const boundaries = richBlockBoundaries(doc);
  assert.deepEqual(
    new Set(boundaries.map((boundary) => boundary.parent)),
    new Set(['doc', 'wyaSection', 'blockquote', 'listItem', 'bulletList', 'orderedList']),
  );
  assert.equal(new Set(boundaries.map((boundary) => boundary.pos)).size, boundaries.length);
  for (const boundary of boundaries) {
    const resolved = doc.resolve(boundary.pos);
    assert.equal(resolved.parent.type.name, boundary.parent);
    assert.equal(boundary.parentPos, resolved.depth ? resolved.before() : undefined);
    if (boundary.parent === 'wyaSection') assert.equal(boundary.sectionPos, boundary.parentPos);
  }
  assert.equal(
    boundaries.some(({ pos }) => pos === positionOf(doc, nestedParagraph) + 1),
    false,
  );
  assert.equal(richBlockAt(doc, positionOf(doc, nestedParagraph)), null);
});

test('selection identifies the deepest block while keeping the first list paragraph with its item', () => {
  const first = paragraph('First');
  const continuation = paragraph('Continuation');
  const quoted = paragraph('Inside quote');
  const item = listItem(first, continuation, quote(quoted));
  const list = bulletList(item);
  const doc = document([list, paragraph('After')]);
  const state = stateFor(doc);
  for (const [textblock, expected] of [
    [first, item],
    [continuation, continuation],
    [quoted, quoted],
  ]) {
    const selected = state.apply(
      state.tr.setSelection(TextSelection.create(doc, positionOf(doc, textblock) + 1)),
    );
    assert.equal(richBlockAtSelection(selected)?.node, expected);
    assert.equal(richBlockAtSelection(selected)?.pos, positionOf(doc, expected));
  }
  const selectedList = state.apply(state.tr.setSelection(NodeSelection.create(doc, 0)));
  assert.equal(richBlockAtSelection(selectedList)?.node, list);
  const selectedFirst = state.apply(
    state.tr.setSelection(NodeSelection.create(doc, positionOf(doc, first))),
  );
  assert.equal(richBlockAtSelection(selectedFirst)?.node, item);
});

test('blocks inside quotes reorder and move across quote boundaries without flattening content', () => {
  const first = paragraph('First');
  const second = schema.nodes.heading.create({ level: 3 }, schema.text('Second'));
  const nested = quote(first, second);
  const outside = paragraph('Outside');
  const original = document([section('group', [nested]), outside]);
  const from = positionOf(original, second);
  const reordered = moveRichBlock(stateFor(original), from, positionOf(original, first))!;
  assert.ok(reordered);
  assert.deepEqual(reordered.doc.firstChild!.firstChild!.content.content, [second, first]);
  const lifted = moveRichBlock(
    stateFor(reordered.doc),
    positionOf(reordered.doc, second),
    reordered.doc.content.size,
  )!;
  assert.equal(lifted.doc.lastChild, second);
  assert.equal(lifted.doc.firstChild!.firstChild!.firstChild, first);
  lifted.doc.check();
});

test('individual list items reorder with their nested children and preserve numbered list attributes', () => {
  const first = listItem(paragraph('First'), bulletList(listItem(paragraph('Nested'))));
  const second = listItem(paragraph('Second'));
  const numbered = schema.nodes.orderedList.create({ start: 9 }, [first, second]);
  const original = document([numbered]);
  const state = stateFor(original);
  const from = positionOf(original, second);
  const target = siblingRichBlockTarget(state, from, -1)!;
  assert.equal(target, positionOf(original, first));
  const moved = moveRichBlock(state, from, target)!;
  assert.deepEqual(moved.doc.firstChild!.content.content, [second, first]);
  assert.equal(moved.doc.firstChild!.attrs.start, 9);
  assert.equal(richBlockAtSelection(state.apply(moved))?.node, second);
  assert.equal(
    moveRichBlock(state, positionOf(original, first.firstChild!), original.content.size),
    null,
  );
  moved.doc.check();
});

test('the last list item moves into a compatible list and prunes only empty list or quote wrappers', () => {
  const item = listItem(paragraph('Move me'));
  const existing = listItem(paragraph('Stay here'));
  const sourceSection = section('keep-this-section', [quote(bulletList(item))]);
  const targetList = schema.nodes.orderedList.create({ start: 5 }, [existing]);
  const original = document([sourceSection, targetList]);
  const moved = moveRichBlock(
    stateFor(original),
    positionOf(original, item),
    positionOf(original, existing),
  )!;
  assert.ok(moved);
  assert.equal(moved.doc.firstChild!.type.name, 'wyaSection');
  assert.equal(moved.doc.firstChild!.attrs.id, 'keep-this-section');
  assert.equal(moved.doc.firstChild!.childCount, 0);
  assert.deepEqual(moved.doc.lastChild!.content.content, [item, existing]);
  assert.equal(moved.doc.lastChild!.attrs.start, 5);
  moved.doc.check();
});

test('moving the final quote block out replaces its empty wrapper without a filler paragraph', () => {
  const content = paragraph('Content');
  for (const original of [document([quote(content)]), document([quote(quote(content))])]) {
    for (const target of [0, original.content.size]) {
      const moved = moveRichBlock(stateFor(original), positionOf(original, content), target)!;
      assert.ok(moved);
      assert.equal(moved.doc.childCount, 1);
      assert.equal(moved.doc.firstChild, content);
      moved.doc.check();
    }
  }
});

test('nested moves reject invalid list positions, own descendants, and required first paragraphs', () => {
  const first = paragraph('First');
  const heading = schema.nodes.heading.create({ level: 2 }, schema.text('Subheading'));
  const nested = bulletList(listItem(paragraph('Nested')));
  const item = listItem(first, heading, nested);
  const list = bulletList(item);
  const outside = paragraph('Outside');
  const original = document([list, outside]);
  const state = stateFor(original);
  assert.equal(moveRichBlock(state, positionOf(original, item), original.content.size), null);
  assert.equal(
    moveRichBlock(state, positionOf(original, item), positionOf(original, nested) + 1),
    null,
  );
  assert.equal(moveRichBlock(state, positionOf(original, first), original.content.size), null);
  assert.equal(
    moveRichBlock(state, positionOf(original, heading), positionOf(original, first)),
    null,
  );
  assert.equal(siblingRichBlockTarget(state, positionOf(original, heading), -1), null);
  assert.equal(
    moveRichBlock(state, positionOf(original, outside), positionOf(original, item)),
    null,
  );
  assert.ok(state.doc.eq(original));
});

test('pruning multiple nested wrappers and moving an item remains one reversible history entry', () => {
  const item = listItem(paragraph('Move me'));
  const destination = listItem(paragraph('Destination'));
  const original = document([quote(bulletList(item)), bulletList(destination)]);
  let state = stateFor(original);
  state = state.apply(
    moveRichBlock(state, positionOf(original, item), positionOf(original, destination))!,
  );
  const moved = state.doc;
  assert.equal(moved.childCount, 1);
  assert.deepEqual(moved.firstChild!.content.content, [item, destination]);
  assert.equal(
    undo(state, (tr) => (state = state.apply(tr))),
    true,
  );
  assert.ok(state.doc.eq(original));
  assert.equal(undo(state), false);
  assert.equal(
    redo(state, (tr) => (state = state.apply(tr))),
    true,
  );
  assert.ok(state.doc.eq(moved));
  state.doc.check();
});
