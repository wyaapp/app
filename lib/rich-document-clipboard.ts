import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';
import type { LinkItem } from './profile-types.ts';
import { allItems } from './collections.ts';
import { allocate } from './portable-items.ts';

export type BlockClipboardContext = { scope: string; items: LinkItem[] };
export type ClipboardIdentities = { items: Map<string, LinkItem>; sections: Set<string> };
export const blockClipboardKey = new PluginKey('richBlockClipboard');

const identity = (item: LinkItem) => item.id ?? `legacy:${item.slug}`;
const names = (item: LinkItem) => [item.slug, ...(item.aliases ?? [])];

/** Remember identities owned by this document, including cards just cut from it. */
export function rememberClipboardIdentities(doc: ProseMirrorNode, known: ClipboardIdentities) {
  doc.descendants((node) => {
    if (node.type.name === 'wyaItem' && node.attrs.item)
      for (const item of allItems([node.attrs.item as LinkItem]))
        known.items.set(identity(item), item);
    if (node.type.name === 'wyaSection' && node.attrs.id) known.sections.add(node.attrs.id);
  });
}

function mapFragment(
  fragment: Fragment,
  transform: (node: ProseMirrorNode) => ProseMirrorNode,
): Fragment {
  const nodes: ProseMirrorNode[] = [];
  let changed = false;
  fragment.forEach((node) => {
    const content = node.content.size ? mapFragment(node.content, transform) : node.content;
    const next = transform(content === node.content ? node : node.copy(content));
    changed ||= next !== node;
    nodes.push(next);
  });
  return changed ? Fragment.fromArray(nodes) : fragment;
}

/** Stamp only the serialized clone; the document and Markdown never store clipboard metadata. */
export function stampClipboardScope(slice: Slice, scope: string | null): Slice {
  const content = mapFragment(slice.content, (node) =>
    node.type.name === 'wyaItem' || node.type.name === 'wyaSection'
      ? node.type.create({ ...node.attrs, clipboardOrigin: scope }, node.content, node.marks)
      : node,
  );
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}

/** Give copies independent redirects, while an in-document cut retains its existing identity. */
export function prepareBlockPaste(
  state: EditorState,
  slice: Slice,
  context: BlockClipboardContext,
  known: ClipboardIdentities,
  replaceSelection = true,
): Slice {
  const usedNames = new Set<string>();
  const usedIds = new Set<string>();
  const usedSections = new Set<string>();
  const ownedNames = new Set([...known.items.values()].map((item) => item.slug));
  const reserveItem = (item: LinkItem) => {
    names(item).forEach((name) => usedNames.add(name));
    if (item.id) usedIds.add(item.id);
  };
  // The current document is authoritative for its own contents. A profile projection
  // can lag one render behind a cut, so only reserve its other documents' entries here.
  for (const item of allItems(context.items)) {
    if (!known.items.has(identity(item)) && !ownedNames.has(item.slug)) reserveItem(item);
  }
  const { from, to } = state.selection;
  state.doc.descendants((node, pos) => {
    if (replaceSelection && pos >= from && pos + node.nodeSize <= to) return false;
    if (node.type.name === 'wyaItem' && node.attrs.item)
      allItems([node.attrs.item as LinkItem]).forEach(reserveItem);
    if (node.type.name === 'wyaSection' && node.attrs.id) usedSections.add(node.attrs.id);
  });
  const reserved = new Set(usedNames);
  slice.content.descendants((node) => {
    if (node.type.name === 'wyaItem' && node.attrs.item)
      allItems([node.attrs.item as LinkItem]).forEach((item) =>
        names(item).forEach((name) => reserved.add(name)),
      );
  });

  function pasteItem(item: LinkItem, sameDocument: boolean, copy = false): LinkItem {
    const saved = item.id ? known.items.get(item.id) : undefined;
    const retain =
      sameDocument &&
      !copy &&
      (!item.id || (!!saved && saved.kind === item.kind && !usedIds.has(item.id))) &&
      names(item).every((name) => !usedNames.has(name));
    const { id, sectionId: _sectionId, ...portable } = item;
    void _sectionId;
    const slug = allocate(item.slug, usedNames, reserved);
    const aliases = item.aliases?.map((alias) => allocate(alias, usedNames, reserved));
    if (retain && id) usedIds.add(id);
    return {
      ...portable,
      slug,
      ...(aliases ? { aliases } : {}),
      ...(retain && id ? { id } : {}),
      ...(item.collection
        ? {
            collection: {
              ...item.collection,
              items: item.collection.items.map((child) => pasteItem(child, sameDocument, !retain)),
            },
          }
        : {}),
    };
  }

  const content = mapFragment(slice.content, (node) => {
    const sameDocument = node.attrs.clipboardOrigin === context.scope;
    if (node.type.name === 'wyaItem' && node.attrs.item)
      return node.type.create(
        { ...node.attrs, item: pasteItem(node.attrs.item, sameDocument), clipboardOrigin: null },
        node.content,
        node.marks,
      );
    if (node.type.name === 'wyaSection') {
      const id =
        sameDocument && known.sections.has(node.attrs.id) && !usedSections.has(node.attrs.id)
          ? node.attrs.id
          : crypto.randomUUID();
      usedSections.add(id);
      return node.type.create(
        { ...node.attrs, id, clipboardOrigin: null },
        node.content,
        node.marks,
      );
    }
    return node;
  });
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}

/** A selected whole block is a paste anchor, not text to overwrite. */
export function canPasteAfterBlock(state: EditorState, slice: Slice): boolean {
  if (
    !(state.selection instanceof NodeSelection) ||
    slice.openStart ||
    slice.openEnd ||
    !slice.size
  )
    return false;
  let blocks = true;
  slice.content.forEach((node) => {
    if (!node.isBlock) blocks = false;
  });
  const { $to } = state.selection;
  return blocks && $to.parent.canReplace($to.index(), $to.index(), slice.content);
}

export function createBlockClipboard({ getContext }: { getContext: () => BlockClipboardContext }) {
  return Extension.create({
    name: 'richBlockClipboard',
    addProseMirrorPlugins() {
      const known: ClipboardIdentities = { items: new Map(), sections: new Set() };
      let scope: string | undefined;
      let pasteAfter = false;
      const remember = (view: EditorView) => {
        const context = getContext();
        if (scope !== context.scope) {
          known.items.clear();
          known.sections.clear();
          scope = context.scope;
        }
        rememberClipboardIdentities(view.state.doc, known);
        return context;
      };
      return [
        new Plugin({
          key: blockClipboardKey,
          view(view: EditorView) {
            remember(view);
            return { update: (view) => void remember(view) };
          },
          props: {
            transformCopied: (slice) => stampClipboardScope(slice, getContext().scope),
            transformPasted(slice, view, plainText) {
              pasteAfter = !plainText && canPasteAfterBlock(view.state, slice);
              if (view.dragging?.move) {
                // Native same-editor moves already delete their source. The existing
                // drag handler owns the transaction; do not turn a move into a copy.
                pasteAfter = false;
                return stampClipboardScope(slice, null);
              }
              return prepareBlockPaste(view.state, slice, remember(view), known, !pasteAfter);
            },
            handlePaste(view, event, slice) {
              const insertAfter = pasteAfter;
              pasteAfter = false;
              if (
                !insertAfter ||
                !view.editable ||
                view.composing ||
                !event.clipboardData?.getData('text/html') ||
                !canPasteAfterBlock(view.state, slice)
              )
                return false;
              const pos = view.state.selection.to;
              const tr = closeHistory(view.state.tr).insert(pos, slice.content);
              tr.setSelection(NodeSelection.create(tr.doc, pos));
              view.dispatch(tr.setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView());
              view.dispatch(closeHistory(view.state.tr));
              return true;
            },
          },
        }),
      ];
    },
  });
}
