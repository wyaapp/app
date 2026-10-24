import { Extension } from '@tiptap/core';
import { AllSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  richBlockAt,
  richBlockAtSelection,
  richBlockBoundaries,
} from '../../../lib/rich-document-drag.ts';

type BlockFocus = { hover: number | null; within: boolean; explicit: number | null };
export const blockFocusKey = new PluginKey<BlockFocus>('richBlockFocus');

export function activeRichBlock(state: EditorState, editable = true) {
  const focus = blockFocusKey.getState(state);
  if (!editable || !focus || state.selection instanceof AllSelection) return null;
  const pos = focus.hover ?? (focus.within ? focus.explicit : null);
  return pos !== null
    ? richBlockAt(state.doc, pos)
    : focus.within
      ? richBlockAtSelection(state)
      : null;
}

export function createBlockFocus() {
  return Extension.create({
    name: 'richBlockFocus',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin<BlockFocus>({
          key: blockFocusKey,
          state: {
            init: () => ({ hover: null, within: false, explicit: null }),
            apply(tr, previous) {
              const update = tr.getMeta(blockFocusKey) as Partial<BlockFocus> | undefined;
              let explicit = previous.explicit;
              if (tr.docChanged && explicit !== null) {
                const before = richBlockAt(tr.before, explicit);
                const from = tr.mapping.map(explicit, 1);
                const to = before ? tr.mapping.map(explicit + before.node.nodeSize, -1) : from;
                const after = richBlockAt(tr.doc, from);
                // Attribute edits replace a node's opening token, so testing
                // mapResult.deleted alone would lose a still-focused input.
                // Map the whole block; deletion collapses its range instead.
                explicit =
                  before &&
                  after &&
                  to > from &&
                  after.node.type === before.node.type &&
                  from + after.node.nodeSize === to
                    ? from
                    : null;
              }
              return {
                ...previous,
                explicit,
                ...(tr.docChanged ? { hover: null } : {}),
                ...(tr.selectionSet ? { explicit: null, hover: null } : {}),
                ...update,
              };
            },
          },
          props: {
            decorations(state) {
              const block = activeRichBlock(state, editor.isEditable);
              return block
                ? DecorationSet.create(state.doc, [
                    Decoration.node(block.pos, block.pos + block.node.nodeSize, {
                      class: `rich-block-active${blockFocusKey.getState(state)?.hover === block.pos ? ' rich-block-hovered' : ''}`,
                    }),
                  ])
                : DecorationSet.empty;
            },
          },
          view(view) {
            const focus = (event: FocusEvent) => {
              let explicit: number | null = null;
              // Inputs and controls inside NodeViews do not update the editor's text selection.
              if (event.target !== view.dom && event.target instanceof Element) {
                for (const boundary of richBlockBoundaries(view.state.doc)) {
                  const block = richBlockAt(view.state.doc, boundary.pos);
                  const dom = block && view.nodeDOM(block.pos);
                  if (dom instanceof Element && dom.contains(event.target)) explicit = block!.pos;
                }
              }
              view.dispatch(view.state.tr.setMeta(blockFocusKey, { within: true, explicit }));
            };
            const blur = () =>
              queueMicrotask(() => {
                if (editor.isDestroyed) return;
                if (!view.dom.contains(view.dom.ownerDocument.activeElement))
                  view.dispatch(
                    view.state.tr.setMeta(blockFocusKey, { within: false, explicit: null }),
                  );
              });
            view.dom.addEventListener('focusin', focus);
            view.dom.addEventListener('focusout', blur);
            return {
              destroy() {
                view.dom.removeEventListener('focusin', focus);
                view.dom.removeEventListener('focusout', blur);
              },
            };
          },
        }),
      ];
    },
  });
}
