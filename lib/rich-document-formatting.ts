import { createChainableState, type Editor } from '@tiptap/core';
import { wrapIn } from '@tiptap/pm/commands';
import { liftListItem, wrapInList } from '@tiptap/pm/schema-list';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { liftTarget } from '@tiptap/pm/transform';

export type RichTextStyle =
  | 'paragraph'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'codeBlock';

function selectedTextblocks(tr: Transaction) {
  const { from, to, empty } = tr.selection;
  const blocks: { pos: number; start: number; end: number }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return;
    const start = pos + 1;
    const end = start + node.content.size;
    // A selection beginning at the previous paragraph's end contains no text
    // from that paragraph. Do not change it when formatting the next block.
    if (empty || (from < end && to > start) || (start === end && from <= start && to >= end))
      blocks.push({ pos, start, end });
    return false;
  });
  return blocks;
}

/** One transaction keeps conversion, selection mapping and undo together. */
export function richTextStyleTransaction(
  state: EditorState,
  style: RichTextStyle,
  snapshot?: EditorState,
): Transaction | null {
  const tr = state.tr;
  if (snapshot?.doc === state.doc) tr.setSelection(snapshot.selection);
  if (!(tr.selection instanceof TextSelection)) return null;
  const blocks = selectedTextblocks(tr);
  if (!blocks.length) return null;
  const from = Math.max(tr.selection.from, blocks[0].start);
  const to = Math.min(tr.selection.to, blocks.at(-1)!.end);
  const backwards = tr.selection.anchor > tr.selection.head;
  tr.setSelection(TextSelection.create(tr.doc, backwards ? to : from, backwards ? from : to));

  // Changing an existing list's type should retain its nested items, just as
  // Tiptap's list command does, rather than flattening the selected subtree.
  if (style === 'bulletList' || style === 'orderedList') {
    const { $from, $to } = tr.selection;
    for (let depth = $from.sharedDepth($to.pos); depth > 0; depth--) {
      const list = $from.node(depth);
      if (list.type.name !== 'bulletList' && list.type.name !== 'orderedList') continue;
      if (list.type.name !== style)
        tr.setNodeMarkup($from.before(depth), state.schema.nodes[style]);
      return tr;
    }
  }

  const heading = /^[1-6]$/.test(style);
  const type =
    state.schema.nodes[heading ? 'heading' : style === 'codeBlock' ? style : 'paragraph'];
  const attributes = heading ? { level: Number(style) } : undefined;

  // Work backwards so lifting an earlier list item cannot invalidate a later
  // original position. ProseMirror's lifts split lists/quotes as needed and
  // respect isolating Wya sections; no document nodes are reconstructed.
  for (const block of [...blocks].reverse()) {
    let pos = tr.mapping.map(block.pos, 1);
    let node = tr.doc.nodeAt(pos);
    if (!node?.isTextblock) return null;
    while (true) {
      const range = tr.doc.resolve(pos).blockRange(tr.doc.resolve(pos + node.nodeSize));
      const target = range && liftTarget(range);
      const mapFrom = tr.mapping.maps.length;
      if (target !== null && range) tr.lift(range, target);
      else {
        // A list item's required first paragraph cannot be lifted alone when
        // it has nested children. The list command lifts that item safely,
        // retaining its children, while the document selection stays intact.
        const selection = tr.selection.getBookmark();
        tr.setSelection(TextSelection.create(tr.doc, pos + 1));
        const lifted = liftListItem(state.schema.nodes.listItem)(
          createChainableState({ state, transaction: tr }),
          () => {},
        );
        tr.setSelection(selection.map(tr.mapping.slice(mapFrom)).resolve(tr.doc));
        if (!lifted) break;
      }
      pos = tr.mapping.slice(mapFrom).map(pos, 1);
      node = tr.doc.nodeAt(pos)!;
    }
    tr.setBlockType(pos, pos + node.nodeSize, type, attributes);
  }

  if (style === 'bulletList' || style === 'orderedList' || style === 'blockquote') {
    const command =
      style === 'blockquote'
        ? wrapIn(state.schema.nodes.blockquote)
        : wrapInList(state.schema.nodes[style]);
    const workingState = createChainableState({ state, transaction: tr });
    if (!command(workingState, () => {})) return null;
  }
  return tr;
}

export function setRichTextStyle(editor: Editor, style: RichTextStyle, snapshot?: EditorState) {
  const transaction = richTextStyleTransaction(editor.state, style, snapshot);
  if (!transaction) return false;
  editor.view.dispatch(transaction);
  return true;
}
