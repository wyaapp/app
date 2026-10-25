import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { parseP5Input } from './p5.ts';

export const p5PasteKey = new PluginKey('richP5Paste');

/** Resolve remote source through the picker; never mutate a stale async selection. */
export function createP5Paste(onPaste: (editor: Editor, input: string) => void) {
  return Extension.create({
    name: 'richP5Paste',
    priority: 1160,
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: p5PasteKey,
          props: {
            handlePaste(view, event, slice) {
              if (
                !view.editable ||
                view.composing ||
                !event.clipboardData ||
                event.clipboardData.files.length
              )
                return false;
              const { selection, storedMarks } = view.state;
              if (
                !(selection instanceof TextSelection) ||
                !selection.empty ||
                selection.$from.parent.type.name !== 'paragraph' ||
                selection.$from.parent.content.size ||
                !['doc', 'wyaSection'].includes(selection.$from.node(-1).type.name) ||
                (storedMarks ?? selection.$from.marks()).some((mark) => mark.type.spec.code)
              )
                return false;
              const plain = event.clipboardData.getData('text/plain').trim();
              const html = event.clipboardData.getData('text/html').trim();
              // A copied rich block follows normal schema clipboard handling.
              let literal = true;
              slice.content.descendants((node) => {
                if (
                  (!node.isText && node.type.name !== 'paragraph') ||
                  node.marks.some((mark) => mark.type.name !== 'link' || mark.attrs.href !== plain)
                )
                  literal = false;
              });
              if (
                !literal ||
                (plain && slice.content.textBetween(0, slice.content.size).trim() !== plain)
              )
                return false;
              const input = parseP5Input(plain)
                ? plain
                : !plain && parseP5Input(html)
                  ? html
                  : null;
              if (!input) return false;
              onPaste(editor, input);
              return true;
            },
          },
        }),
      ];
    },
  });
}
