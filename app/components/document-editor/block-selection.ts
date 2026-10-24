import { Extension } from '@tiptap/core';
import {
  AllSelection,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Selection,
} from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { richBlockAtSelection } from '../../../lib/rich-document-drag.ts';

const blockSelectionKey = new PluginKey<Selection | null>('richBlockSelection');

/** Select text within textblocks and keep non-text block contents together. */
function currentBlockContent(state: EditorState): Selection {
  const block = richBlockAtSelection(state);
  if (!block) return new AllSelection(state.doc);
  const { pos, node } = block;
  if (state.selection.from < pos || state.selection.to > pos + node.nodeSize)
    return new AllSelection(state.doc);
  // Container selection includes images and other non-text children at its edges.
  return node.isTextblock
    ? TextSelection.create(state.doc, pos + 1, pos + node.nodeSize - 1)
    : NodeSelection.create(state.doc, pos);
}

export function createBlockSelection() {
  return Extension.create({
    name: 'richBlockSelection',
    priority: 1000,
    addProseMirrorPlugins() {
      const reset = (view: EditorView) => {
        if (blockSelectionKey.getState(view.state))
          view.dispatch(view.state.tr.setMeta(blockSelectionKey, false));
        return false;
      };
      return [
        new Plugin<Selection | null>({
          key: blockSelectionKey,
          state: {
            init: () => null,
            apply(tr, previous) {
              const firstPress = tr.getMeta(blockSelectionKey);
              if (firstPress === true) return tr.selection;
              if (firstPress === false || tr.docChanged || tr.selectionSet) return null;
              return previous;
            },
          },
          props: {
            handleKeyDown(view, event) {
              // Keep native selection inside section titles, search fields and other controls.
              if (!view.editable || event.isComposing || event.target !== view.dom) return false;
              const selectAll =
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                !event.shiftKey &&
                event.key.toLowerCase() === 'a';
              if (!selectAll) {
                if (!['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) reset(view);
                return false;
              }
              if (event.repeat) return true;
              const { state } = view;
              const previous = blockSelectionKey.getState(state);
              const wholeDocument =
                state.selection instanceof AllSelection || !!previous?.eq(state.selection);
              const selection = wholeDocument
                ? new AllSelection(state.doc)
                : currentBlockContent(state);
              view.dispatch(
                state.tr
                  .setSelection(selection)
                  .setMeta(blockSelectionKey, !(selection instanceof AllSelection)),
              );
              return true;
            },
            handleDOMEvents: {
              pointerdown: reset,
              blur: reset,
            },
          },
        }),
      ];
    },
  });
}
