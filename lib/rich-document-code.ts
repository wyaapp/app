import Code from '@tiptap/extension-code';
import { getMarkRange } from '@tiptap/core';
import { TextSelection, type EditorState } from '@tiptap/pm/state';
import codemarkModule from 'prosemirror-codemark';

// The package publishes a CommonJS default export. Node's native ESM loader and
// the browser bundler unwrap that export differently.
const codemark =
  (codemarkModule as unknown as { default?: typeof codemarkModule }).default ?? codemarkModule;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function hasMultiUnitGraphemeBeforeCursor(state: EditorState) {
  const { selection } = state;
  if (!selection.empty || !selection.$from.parent.inlineContent) return false;
  const text = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '', '\ufffc');
  return (graphemes.segment(text).containing(text.length - 1)?.segment.length ?? 0) > 1;
}

export const RichCode = Code.extend({
  // Codemark owns boundary navigation; Tiptap's exit handler inserts a space.
  exitable: false,
  addInputRules() {
    // Codemark supplies its own backtick rules and undo-input-rule metadata.
    return [];
  },
  addProseMirrorPlugins() {
    const plugins = codemark({ markType: this.type });
    for (const plugin of plugins) {
      const handleKeyDown = plugin.props.handleKeyDown;
      if (!handleKeyDown) continue;
      let wordMove: { state: EditorState; end: number } | null = null;
      const appendTransaction = plugin.spec.appendTransaction;
      plugin.spec.appendTransaction = (transactions, previous, state) => {
        const pending = wordMove;
        if (pending) {
          if (state.doc !== pending.state.doc || transactions.some((tr) => tr.docChanged)) {
            wordMove = null;
          } else if (transactions.some((tr) => tr.selectionSet)) {
            wordMove = null;
            if (
              state.selection instanceof TextSelection &&
              state.selection.empty &&
              state.selection.head >= pending.end
            ) {
              // Keep the browser's word boundaries, but do not let one word
              // jump cross from code into adjacent unspaced text. Codemark
              // draws the inner-edge caret from these same typing marks.
              return state.tr
                .setSelection(TextSelection.create(state.doc, pending.end))
                .ensureMarks(pending.state.storedMarks ?? pending.state.selection.$head.marks())
                .scrollIntoView();
            }
          }
        }
        return appendTransaction?.call(plugin, transactions, previous, state) ?? null;
      };
      plugin.props.handleKeyDown = (view, event) => {
        wordMove = null;
        if (!view.editable || view.composing || event.isComposing) return false;
        const { state } = view;
        if (
          event.key === 'ArrowRight' &&
          event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          state.selection instanceof TextSelection &&
          state.selection.empty &&
          this.type.isInSet(state.storedMarks ?? state.selection.$head.marks())
        ) {
          const range = getMarkRange(state.selection.$head, this.type);
          if (range && state.selection.head < range.to) wordMove = { state, end: range.to };
        }
        // Codemark's Firefox workaround deletes one UTF-16 unit. Let native
        // editing delete whole emoji/combining characters instead of splitting them.
        if (event.key === 'Backspace' && hasMultiUnitGraphemeBeforeCursor(view.state)) return false;
        return handleKeyDown.call(plugin, view, event);
      };
      const domEvents = plugin.props.handleDOMEvents;
      plugin.props.handleDOMEvents = {
        ...domEvents,
        pointerdown(view, event) {
          wordMove = null;
          return domEvents?.pointerdown?.call(plugin, view, event) ?? false;
        },
        blur(view, event) {
          wordMove = null;
          return domEvents?.blur?.call(plugin, view, event) ?? false;
        },
        compositionstart(view, event) {
          wordMove = null;
          return domEvents?.compositionstart?.call(plugin, view, event) ?? false;
        },
      };
    }
    return plugins;
  },
});
