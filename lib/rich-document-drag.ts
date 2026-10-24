import { closeHistory } from '@tiptap/pm/history';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Selection, type EditorState, type Transaction } from '@tiptap/pm/state';

const blockParents = [
  'doc',
  'wyaSection',
  'blockquote',
  'listItem',
  'bulletList',
  'orderedList',
] as const;
type RichBlockParent = (typeof blockParents)[number];

export type RichBlockBoundary = {
  pos: number;
  parent: RichBlockParent;
  /** The opening position of a nested container; absent for the document. */
  parentPos?: number;
  sectionPos?: number;
};

export type RichBlock = RichBlockBoundary & { node: ProseMirrorNode };

function isBlockParent(
  node: ProseMirrorNode,
): node is ProseMirrorNode & { type: { name: RichBlockParent } } {
  return blockParents.includes(node.type.name as RichBlockParent);
}

/** Direct child boundaries, including list items and blocks nested in quotes. */
export function richBlockBoundaries(doc: ProseMirrorNode): RichBlockBoundary[] {
  const boundaries: RichBlockBoundary[] = [];
  const visit = (parent: ProseMirrorNode, parentPos?: number) => {
    if (!isBlockParent(parent)) return;
    const start = parentPos === undefined ? 0 : parentPos + 1;
    const boundary = (pos: number): RichBlockBoundary => ({
      pos,
      parent: parent.type.name,
      ...(parentPos === undefined ? {} : { parentPos }),
      ...(parent.type.name === 'wyaSection' ? { sectionPos: parentPos } : {}),
    });
    boundaries.push(boundary(start));
    parent.forEach((child, offset) => {
      visit(child, start + offset);
      boundaries.push(boundary(start + offset + child.nodeSize));
    });
  };
  visit(doc);
  return boundaries;
}

/** A list item's first paragraph belongs to the item rather than a separate block. */
export function richBlockAt(doc: ProseMirrorNode, pos: number): RichBlock | null {
  if (!Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return null;
  const resolved = doc.resolve(pos);
  const { parent, nodeAfter: node } = resolved;
  if (
    !node ||
    node.isInline ||
    !isBlockParent(parent) ||
    (parent.type.name === 'listItem' && resolved.index() === 0)
  )
    return null;
  const parentPos = resolved.depth ? resolved.before() : undefined;
  return {
    pos,
    node,
    parent: parent.type.name,
    ...(parentPos === undefined ? {} : { parentPos }),
    ...(parent.type.name === 'wyaSection' ? { sectionPos: parentPos } : {}),
  };
}

/** Prefer a selected node, otherwise the deepest semantic block containing the caret. */
export function richBlockAtSelection(state: EditorState): RichBlock | null {
  const { selection, doc } = state;
  if (selection instanceof NodeSelection) {
    const selected = richBlockAt(doc, selection.from);
    if (selected) return selected;
  }
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const block = richBlockAt(doc, $from.before(depth));
    if (block) return block;
  }
  return richBlockAt(doc, $from.pos);
}

/** Return an original-document boundary that swaps a block with its sibling. */
export function siblingRichBlockTarget(
  state: EditorState,
  from: number,
  direction: -1 | 1,
): number | null {
  const source = richBlockAt(state.doc, from);
  if (!source) return null;
  const resolved = state.doc.resolve(from);
  let target: number | null = null;
  if (direction === -1) {
    const previous = resolved.nodeBefore;
    if (previous) target = from - previous.nodeSize;
  } else if (direction === 1) {
    const end = from + source.node.nodeSize;
    const next = state.doc.resolve(end).nodeAfter;
    if (next) target = end + next.nodeSize;
  }
  return target !== null && moveRichBlock(state, from, target) ? target : null;
}

/**
 * Move one whole block, never fit or split it into another block. Both positions
 * refer to the original document; target mapping happens after removal. Keeping
 * the node intact preserves card IDs, redirects, GIF sizing and section content.
 */
export function moveRichBlock(
  state: EditorState,
  from: number,
  targetBoundary: number,
): Transaction | null {
  const source = richBlockAt(state.doc, from);
  if (
    !source ||
    !Number.isInteger(targetBoundary) ||
    !richBlockBoundaries(state.doc).some((entry) => entry.pos === targetBoundary)
  )
    return null;
  const end = from + source.node.nodeSize;
  // This includes unchanged positions immediately before and after the block.
  if (targetBoundary >= from && targetBoundary <= end) return null;
  const target = state.doc.resolve(targetBoundary);
  const fragment = Fragment.from(source.node);
  if (!target.parent.canReplace(target.index(), target.index(), fragment)) return null;

  // Moving a final list item or quote child removes the now-empty wrapper. Wya
  // sections retain their identity and may be empty, so they are never pruned.
  let removalFrom = from;
  let removalTo = end;
  let removal = state.doc.resolve(from);
  let replaceOnlyContainer = false;
  while (!removal.parent.canReplace(removal.index(), removal.index() + 1)) {
    if (
      removal.depth === 0 &&
      removal.parent.childCount === 1 &&
      (targetBoundary === 0 || targetBoundary === state.doc.content.size) &&
      removal.parent.canReplace(0, 1, fragment)
    ) {
      replaceOnlyContainer = true;
      break;
    }
    if (
      removal.parent.childCount !== 1 ||
      !['bulletList', 'orderedList', 'blockquote'].includes(removal.parent.type.name)
    )
      return null;
    removalFrom = removal.before();
    removalTo = removal.after();
    removal = state.doc.resolve(removalFrom);
  }
  if (targetBoundary > removalFrom && targetBoundary < removalTo) return null;

  const tr = closeHistory(state.tr);
  let destination: number;
  if (replaceOnlyContainer) {
    destination = removalFrom;
    tr.replaceWith(removalFrom, removalTo, source.node);
  } else {
    tr.delete(removalFrom, removalTo);
    destination = tr.mapping.map(targetBoundary);
    const mapped = tr.doc.resolve(destination);
    if (!mapped.parent.canReplace(mapped.index(), mapped.index(), fragment)) return null;
    tr.insert(destination, source.node);
  }
  if (tr.doc.eq(state.doc)) return null;
  tr.setSelection(
    NodeSelection.isSelectable(source.node)
      ? NodeSelection.create(tr.doc, destination)
      : Selection.near(tr.doc.resolve(destination)),
  );
  return tr.scrollIntoView();
}
