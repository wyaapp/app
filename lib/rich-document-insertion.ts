import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';

export type RichDocumentBoundary = {
  pos: number;
  parent: 'doc' | 'wyaSection';
  sectionPos?: number;
};

/** A caret landing spot is editor UI, not a change to the published document. */
export const RICH_CARET_TRANSACTION = 'richCaretOnly';

/** Only these boundaries accept standalone content, including Wya cards. */
export function richDocumentBoundaries(doc: ProseMirrorNode): RichDocumentBoundary[] {
  const boundaries: RichDocumentBoundary[] = [{ pos: 0, parent: 'doc' }];
  doc.forEach((child, offset) => {
    if (child.type.name === 'wyaSection') {
      boundaries.push({ pos: offset + 1, parent: 'wyaSection', sectionPos: offset });
      child.forEach((nested, nestedOffset) => {
        boundaries.push({
          pos: offset + 1 + nestedOffset + nested.nodeSize,
          parent: 'wyaSection',
          sectionPos: offset,
        });
      });
    }
    boundaries.push({ pos: offset + child.nodeSize, parent: 'doc' });
  });
  return boundaries;
}

function boundaryAt(doc: ProseMirrorNode, pos: number) {
  if (!Number.isInteger(pos) || pos < 0 || pos > doc.content.size) return null;
  const resolved = doc.resolve(pos);
  return resolved.parent.type.name === 'doc' || resolved.parent.type.name === 'wyaSection'
    ? resolved
    : null;
}

function emptyParagraph(node: ProseMirrorNode | null | undefined) {
  return node?.type.name === 'paragraph' && node.content.size === 0;
}

/** Find the edge after the current block, lifting out of lists and quotes. */
export function resolveRichInsertionPoint(
  state: EditorState,
  { section = false }: { section?: boolean } = {},
): number {
  const { $from, to, node } = state.selection as typeof state.selection & {
    node?: ProseMirrorNode;
  };
  if (!section) {
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name === 'wyaSection')
        return $from.depth > depth ? $from.after(depth + 1) : node ? to : $from.pos;
    }
  }
  return $from.depth ? $from.after(1) : node ? to : $from.pos;
}

function focusParagraph(tr: Transaction, pos: number, reuseBefore: boolean) {
  const resolved = boundaryAt(tr.doc, pos);
  if (!resolved) return false;
  if (emptyParagraph(resolved.nodeAfter)) {
    tr.setSelection(TextSelection.create(tr.doc, pos + 1)).setStoredMarks(null);
    return true;
  }
  if (reuseBefore && emptyParagraph(resolved.nodeBefore)) {
    tr.setSelection(TextSelection.create(tr.doc, pos - 1)).setStoredMarks(null);
    return true;
  }
  const paragraph = tr.doc.type.schema.nodes.paragraph;
  if (!paragraph || !resolved.parent.canReplaceWith(resolved.index(), resolved.index(), paragraph))
    return false;
  tr.insert(pos, paragraph.create()).setSelection(TextSelection.create(tr.doc, pos + 1));
  tr.setStoredMarks(null);
  return true;
}

/** Focus an existing empty line or make a caret landing spot at an exact gap. */
export function focusRichParagraph(state: EditorState, pos: number): Transaction | null {
  const tr = state.tr;
  if (!focusParagraph(tr, pos, true)) return null;
  if (tr.docChanged) tr.setMeta(RICH_CARET_TRANSACTION, true).setMeta('addToHistory', false);
  return tr.scrollIntoView();
}

export type RichInsertionOptions = {
  /** An exact document/section boundary, such as the gap whose + was clicked. */
  pos?: number;
  /** The slash query in a standalone paragraph. Nothing is deleted on cancel. */
  range?: { from: number; to: number };
};

function queryParagraph(doc: ProseMirrorNode, range: { from: number; to: number }) {
  if (
    !Number.isInteger(range.from) ||
    !Number.isInteger(range.to) ||
    range.from < 0 ||
    range.to < range.from ||
    range.to > doc.content.size
  )
    return null;
  const from = doc.resolve(range.from);
  const to = doc.resolve(range.to);
  if (
    from.parent !== to.parent ||
    from.parent.type.name !== 'paragraph' ||
    from.parent.content.size !== from.parent.textContent.length ||
    (from.node(-1).type.name !== 'doc' && from.node(-1).type.name !== 'wyaSection') ||
    from.parent.textBetween(0, from.parentOffset).trim() ||
    to.parent.textBetween(to.parentOffset, to.parent.content.size).trim()
  )
    return null;
  return { from: from.before(), to: from.after(), resolved: from };
}

function firstTextPosition(node: ProseMirrorNode): number | null {
  if (node.isTextblock) return 1;
  let position: number | null = null;
  node.descendants((child, pos) => {
    if (position !== null) return false;
    if (child.isTextblock) {
      position = pos + 2;
      return false;
    }
    return true;
  });
  return position;
}

/** Insert once, with one undo step for the block and its caret landing spot. */
export function insertRichBlock(
  state: EditorState,
  block: ProseMirrorNode,
  options: RichInsertionOptions = {},
): Transaction | null {
  if (block.type.schema !== state.schema || block.isInline) return null;
  try {
    block.check();
  } catch {
    return null;
  }
  const section = block.type.name === 'wyaSection';
  const tr = state.tr;
  let pos: number;
  let end: number;

  if (options.range) {
    const query = queryParagraph(state.doc, options.range);
    if (!query) return null;
    if (section && query.resolved.node(-1).type.name === 'wyaSection') {
      const sectionEnd = query.resolved.after(query.resolved.depth - 1);
      tr.delete(query.from, query.to);
      pos = tr.mapping.map(sectionEnd);
      end = pos;
    } else {
      pos = query.from;
      end = query.to;
    }
  } else {
    pos = options.pos ?? resolveRichInsertionPoint(state, { section });
    let boundary = boundaryAt(tr.doc, pos);
    if (!boundary) return null;
    if (section && boundary.parent.type.name === 'wyaSection') {
      pos = boundary.after();
      boundary = tr.doc.resolve(pos);
    }
    if (emptyParagraph(boundary.nodeAfter)) end = pos + boundary.nodeAfter!.nodeSize;
    else if (emptyParagraph(boundary.nodeBefore)) {
      end = pos;
      pos -= boundary.nodeBefore!.nodeSize;
    } else end = pos;
  }

  // Empty or card-only sections still need somewhere to start typing.
  if (section && firstTextPosition(block) === null)
    block = block.copy(block.content.append(Fragment.from(state.schema.nodes.paragraph.create())));

  const from = boundaryAt(tr.doc, pos);
  const to = boundaryAt(tr.doc, end);
  if (
    !from ||
    !to ||
    from.parent !== to.parent ||
    !from.parent.canReplace(from.index(), to.index(), Fragment.from(block))
  )
    return null;
  tr.replaceWith(pos, end, block);
  const textPosition = firstTextPosition(block);
  if (textPosition !== null)
    tr.setSelection(TextSelection.create(tr.doc, pos + textPosition)).setStoredMarks(null);
  else if (!focusParagraph(tr, pos + block.nodeSize, false)) return null;
  return tr.scrollIntoView();
}
