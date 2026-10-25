import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getExtensionField, getSchema } from '@tiptap/core';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  EditorState,
  NodeSelection,
  TextSelection,
  type Plugin,
  type Transaction,
} from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';
import { createRichDocumentExtensions } from '../lib/rich-document-schema.ts';
import {
  canPasteAfterBlock,
  createBlockClipboard,
  prepareBlockPaste,
  rememberClipboardIdentities,
  stampClipboardScope,
  type BlockClipboardContext,
  type ClipboardIdentities,
} from '../lib/rich-document-clipboard.ts';
import type { LinkItem } from '../lib/profile-types.ts';

const schema = getSchema(createRichDocumentExtensions());
const scope = 'owner:space:page';
const paragraph = (text = '') =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
const link = (overrides: Partial<LinkItem> = {}): LinkItem => ({
  id: 'saved-link',
  slug: 'code',
  aliases: ['repo'],
  label: 'Code',
  platform: 'github',
  url: 'https://github.com/alex',
  visible: true,
  ...overrides,
});
const card = (item = link()) => schema.nodes.wyaItem.create({ item });
const closed = (...nodes: ProseMirrorNode[]) => new Slice(Fragment.fromArray(nodes), 0, 0);
const stateFor = (...nodes: ProseMirrorNode[]) =>
  EditorState.create({ schema, doc: schema.nodes.doc.create(null, nodes) });
const identities = (doc: ProseMirrorNode): ClipboardIdentities => {
  const known = { items: new Map<string, LinkItem>(), sections: new Set<string>() };
  rememberClipboardIdentities(doc, known);
  return known;
};
const pastedItem = (slice: Slice) => slice.content.firstChild!.attrs.item as LinkItem;

test('copying stamps only the clipboard clone, including cards inside sections', () => {
  const original = closed(
    schema.nodes.wyaSection.create({ id: 'section-one', title: 'Work' }, [
      card(),
      paragraph('Note'),
    ]),
  );
  const copied = stampClipboardScope(original, scope);
  assert.equal(original.content.firstChild!.attrs.clipboardOrigin, null);
  assert.equal(original.content.firstChild!.firstChild!.attrs.clipboardOrigin, null);
  assert.equal(copied.content.firstChild!.attrs.clipboardOrigin, scope);
  assert.equal(copied.content.firstChild!.firstChild!.attrs.clipboardOrigin, scope);
  assert.equal(copied.content.firstChild!.lastChild, original.content.firstChild!.lastChild);
});

test('copying a card allocates independent redirects without a foreign saved ID', () => {
  const state = stateFor(card(), paragraph());
  const slice = stampClipboardScope(closed(card()), scope);
  const pasted = prepareBlockPaste(
    state,
    slice,
    { scope, items: [link()] },
    identities(state.doc),
    false,
  );
  const expected = link({ slug: 'code-2', aliases: ['repo-2'] });
  delete expected.id;
  assert.deepEqual(pastedItem(pasted), expected);
  assert.equal(pasted.content.firstChild!.attrs.clipboardOrigin, null);
  assert.equal(state.doc.firstChild!.attrs.item.id, 'saved-link');
});

test('cut and paste inside the document preserves IDs and redirects despite a lagging profile', () => {
  const before = stateFor(card(), paragraph('After'));
  const known = identities(before.doc);
  const after = before.apply(before.tr.delete(0, before.doc.firstChild!.nodeSize));
  const pasted = prepareBlockPaste(
    after,
    stampClipboardScope(closed(card()), scope),
    { scope, items: [link()] },
    known,
  );
  assert.deepEqual(pastedItem(pasted), link());
});

test('replacement preserves identity, but pasting after a selected block produces a copy', () => {
  const initial = stateFor(card(), paragraph());
  const state = initial.apply(initial.tr.setSelection(NodeSelection.create(initial.doc, 0)));
  const slice = stampClipboardScope(state.selection.content(), scope);
  const context = { scope, items: [link()] };
  const known = identities(state.doc);
  assert.deepEqual(pastedItem(prepareBlockPaste(state, slice, context, known)), link());
  const after = pastedItem(prepareBlockPaste(state, slice, context, known, false));
  assert.equal(after.id, undefined);
  assert.equal(after.slug, 'code-2');
});

test('cross-document paste strips saved IDs and avoids redirects from every destination page', () => {
  const state = stateFor(paragraph());
  const foreign = link({ sectionId: 'old-section' });
  const pasted = prepareBlockPaste(
    state,
    stampClipboardScope(closed(card(foreign)), 'other-page'),
    {
      scope,
      items: [link({ id: 'other-card' })],
    },
    identities(state.doc),
  );
  const item = pastedItem(pasted);
  assert.equal(item.id, undefined);
  assert.equal(item.sectionId, undefined);
  assert.equal(item.slug, 'code-2');
  assert.deepEqual(item.aliases, ['repo-2']);
});

test('a forged same-document marker cannot preserve an unknown saved ID', () => {
  const state = stateFor(paragraph());
  const pasted = prepareBlockPaste(
    state,
    stampClipboardScope(closed(card()), scope),
    { scope, items: [] },
    identities(state.doc),
  );
  assert.equal(pastedItem(pasted).id, undefined);
  assert.equal(pastedItem(pasted).slug, 'code');
});

test('copies remap collection children and reserve incoming suffixes before allocating', () => {
  const game: LinkItem = {
    id: 'game-one',
    slug: 'one',
    label: 'Game one',
    url: 'https://game.example/',
    platform: 'website',
    visible: true,
    kind: 'interest',
    interest: { type: 'game', note: '', favorite: false },
  };
  const collection = link({
    id: 'games',
    slug: 'games',
    aliases: ['play'],
    kind: 'collection',
    collection: { type: 'game', items: [game] },
  });
  const state = stateFor(
    card(collection),
    card(link({ id: 'existing', slug: 'code', aliases: [] })),
    paragraph(),
  );
  const slice = stampClipboardScope(
    closed(
      card(collection),
      card(link({ id: 'one', aliases: [] })),
      card(link({ id: 'two', slug: 'code-2', aliases: [] })),
    ),
    scope,
  );
  const pasted = prepareBlockPaste(
    state,
    slice,
    { scope, items: [] },
    identities(state.doc),
    false,
  );
  const copied = pastedItem(pasted);
  assert.equal(copied.id, undefined);
  assert.equal(copied.slug, 'games-2');
  assert.deepEqual(copied.aliases, ['play-2']);
  assert.equal(copied.collection!.items[0].id, undefined);
  assert.equal(copied.collection!.items[0].slug, 'one-2');
  assert.equal(pasted.content.child(1).attrs.item.slug, 'code-3');
  assert.equal(pasted.content.child(2).attrs.item.slug, 'code-2');
});

test('section copies get fresh IDs; in-document cuts retain section and child identities', () => {
  const section = schema.nodes.wyaSection.create({ id: 'section-one', title: 'Work' }, [
    card(),
    paragraph('Note'),
  ]);
  const state = stateFor(section, paragraph('After'));
  const known = identities(state.doc);
  const slice = stampClipboardScope(closed(section), scope);
  const copy = prepareBlockPaste(state, slice, { scope, items: [] }, known, false).content
    .firstChild!;
  assert.notEqual(copy.attrs.id, section.attrs.id);
  assert.equal(copy.firstChild!.attrs.item.id, undefined);
  const cut = state.apply(state.tr.delete(0, section.nodeSize));
  const moved = prepareBlockPaste(cut, slice, { scope, items: [link()] }, known).content
    .firstChild!;
  assert.equal(moved.attrs.id, 'section-one');
  assert.equal(moved.firstChild!.attrs.item.id, 'saved-link');
  assert.equal(moved.attrs.clipboardOrigin, null);
  const foreign = prepareBlockPaste(
    cut,
    stampClipboardScope(closed(section), 'other-page'),
    { scope, items: [] },
    known,
  ).content.firstChild!;
  assert.notEqual(foreign.attrs.id, 'section-one');
});

test('ordinary text, inline marks, and nested list paste are unchanged', () => {
  const marked = schema.nodes.paragraph.create(
    null,
    schema.text('Hello', [
      schema.marks.bold.create(),
      schema.marks.link.create({ href: 'https://example.com' }),
    ]),
  );
  const list = schema.nodes.bulletList.create(null, [
    schema.nodes.listItem.create(null, [
      marked,
      schema.nodes.bulletList.create(null, [
        schema.nodes.listItem.create(null, paragraph('Nested')),
      ]),
    ]),
  ]);
  const state = stateFor(paragraph());
  for (const slice of [
    closed(list),
    new Slice(marked.content, 0, 0),
    new Slice(Fragment.from(marked), 1, 1),
  ]) {
    assert.equal(stampClipboardScope(slice, scope), slice);
    assert.equal(
      prepareBlockPaste(state, slice, { scope, items: [] }, identities(state.doc)),
      slice,
    );
  }
});

test('paste-after applies only when closed blocks fit beside the selected block', () => {
  const initial = stateFor(card(), paragraph());
  const selected = initial.apply(initial.tr.setSelection(NodeSelection.create(initial.doc, 0)));
  assert.equal(canPasteAfterBlock(selected, closed(card())), true);
  assert.equal(canPasteAfterBlock(selected, closed(paragraph('Text'))), true);
  assert.equal(
    canPasteAfterBlock(
      selected,
      closed(schema.nodes.listItem.create(null, paragraph('List entry'))),
    ),
    false,
  );
  assert.equal(
    canPasteAfterBlock(selected, new Slice(Fragment.from(paragraph('Text')), 1, 1)),
    false,
  );
  assert.equal(
    canPasteAfterBlock(selected, new Slice(Fragment.from(schema.text('Inline')), 0, 0)),
    false,
  );
  assert.equal(canPasteAfterBlock(selected, Slice.empty), false);
  const caret = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, 2)));
  assert.equal(canPasteAfterBlock(caret, closed(card())), false);
});

function fixture(
  nodes: ProseMirrorNode[],
  initialContext: BlockClipboardContext = { scope, items: [link()] },
) {
  let context = initialContext;
  const plugins = getExtensionField<() => Plugin[]>(
    createBlockClipboard({ getContext: () => context }),
    'addProseMirrorPlugins',
    {},
  )();
  const plugin = plugins[0];
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, nodes),
    plugins: [...plugins, history()],
  });
  const transactions: Transaction[] = [];
  const view = {
    get state() {
      return state;
    },
    editable: true,
    composing: false,
    dispatch(tr: Transaction) {
      const previous = state;
      state = state.apply(tr);
      transactions.push(tr);
      pluginView.update?.(view, previous);
    },
  } as unknown as EditorView;
  const pluginView = plugin.spec.view!(view);
  const copied = () =>
    plugin.props.transformCopied!.call(plugin, view.state.selection.content(), view);
  const transform = (slice: Slice, plainText = false) =>
    plugin.props.transformPasted!.call(plugin, slice, view, plainText);
  const paste = (slice: Slice, plainText = false, html = true) =>
    plugin.props.handlePaste!.call(
      plugin,
      view,
      {
        clipboardData: {
          getData: (type: string) => (type === 'text/html' && html ? '<p>Clipboard HTML</p>' : ''),
        },
      } as ClipboardEvent,
      transform(slice, plainText),
    );
  return {
    view,
    copied,
    paste,
    transform,
    transactions,
    context: (next: BlockClipboardContext) => {
      context = next;
    },
  };
}

test('native rich block paste appends a copy and is one undoable operation', () => {
  const { view, copied, paste, transactions } = fixture([card(), paragraph('After')]);
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
  const before = view.state.doc;
  assert.equal(paste(copied()), true);
  assert.equal(view.state.doc.childCount, 3);
  assert.equal(view.state.doc.child(0).attrs.item.id, 'saved-link');
  assert.equal(view.state.doc.child(1).attrs.item.slug, 'code-2');
  assert.equal(view.state.selection.from, before.firstChild!.nodeSize);
  assert.equal(transactions.at(-2)!.getMeta('paste'), true);
  assert.equal(transactions.at(-2)!.getMeta('uiEvent'), 'paste');
  assert.equal(
    undo(view.state, (tr) => view.dispatch(tr)),
    true,
  );
  assert.ok(view.state.doc.eq(before));
  assert.equal(
    redo(view.state, (tr) => view.dispatch(tr)),
    true,
  );
  assert.equal(view.state.doc.child(1).attrs.item.slug, 'code-2');
});

test('paste as plain text and clipboard without HTML keep native replacement behavior', () => {
  const { view, paste } = fixture([card(), paragraph()]);
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
  const before = view.state.doc;
  assert.equal(paste(closed(paragraph('Plain')), true), false);
  assert.equal(paste(closed(paragraph('Plain')), false, false), false);
  assert.equal(view.state.doc, before);
});

test('native internal drag moves retain identity and clear clipboard markers', () => {
  const { view, transform } = fixture([card(), paragraph()]);
  view.dragging = { move: true, slice: closed(card()) };
  const moved = transform(stampClipboardScope(closed(card()), scope));
  assert.deepEqual(pastedItem(moved), link());
  assert.equal(moved.content.firstChild!.attrs.clipboardOrigin, null);
});

test('document scope changes clear remembered identities from the previous document', () => {
  const { view, copied, transform, context } = fixture([card(), paragraph()]);
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
  const slice = copied();
  view.dispatch(view.state.tr.delete(0, view.state.doc.firstChild!.nodeSize));
  context({ scope: 'another-document', items: [] });
  const pasted = transform(stampClipboardScope(slice, 'another-document'));
  assert.equal(pastedItem(pasted).id, undefined);
});
