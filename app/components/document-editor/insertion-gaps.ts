import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { focusRichParagraph, richDocumentBoundaries } from '@/lib/rich-document-insertion';

type InsertionGapOptions = {
  labels: { add: string };
};

const insertionGapKey = new PluginKey('richInsertionGaps');

function emptyParagraph(node: ProseMirrorNode | null) {
  return node?.type.name === 'paragraph' && node.content.size === 0;
}

/**
 * Insertion controls occupy no document space. Activating one creates or
 * focuses a real, deletable paragraph where the user can type immediately.
 */
export function createInsertionGaps(options: InsertionGapOptions) {
  return Extension.create({
    name: 'richInsertionGaps',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: insertionGapKey,
          props: {
            decorations(state) {
              if (!editor.isEditable) return DecorationSet.empty;

              const decorations: Decoration[] = [];
              for (const boundary of richDocumentBoundaries(state.doc)) {
                const resolved = state.doc.resolve(boundary.pos);
                const before = resolved.nodeBefore;
                const after = resolved.nodeAfter;
                // A real empty paragraph can be typed into or deleted normally.
                // Its leading control reuses it, so it needs no second control.
                if (emptyParagraph(before)) continue;
                const terminal = after === null;
                const empty = before === null && after === null;
                const mode = empty
                  ? 'empty'
                  : terminal
                    ? 'terminal'
                    : before === null
                      ? 'before'
                      : 'between';
                decorations.push(
                  Decoration.widget(
                    boundary.pos,
                    (view, getPos) => {
                      const dom = view.dom.ownerDocument;
                      const gap = dom.createElement('div');
                      gap.className = 'rich-insertion-gap';
                      gap.contentEditable = 'false';
                      gap.dataset.richInsertion = mode;

                      // Widget positions move with their decorations. Resolve
                      // only on activation, never from the render-time closure.
                      const currentPosition = () => {
                        const pos = getPos();
                        if (!view.editable || pos === undefined) return null;
                        return richDocumentBoundaries(view.state.doc).some(
                          (entry) => entry.pos === pos,
                        )
                          ? pos
                          : null;
                      };
                      const rail = dom.createElement('div');
                      rail.className = 'rich-insertion-rail';
                      const add = dom.createElement('button');
                      add.type = 'button';
                      add.className = 'rich-insertion-add';
                      add.setAttribute('aria-label', options.labels.add);
                      // Preserve the caret on pointer activation. Native Tab,
                      // Enter and Space still reach and activate the button.
                      add.addEventListener('pointerdown', (event) => event.preventDefault());
                      const plus = dom.createElementNS('http://www.w3.org/2000/svg', 'svg');
                      plus.setAttribute('aria-hidden', 'true');
                      plus.setAttribute('width', '18');
                      plus.setAttribute('height', '18');
                      plus.setAttribute('viewBox', '0 0 256 256');
                      const strokes = dom.createElementNS('http://www.w3.org/2000/svg', 'path');
                      strokes.setAttribute('d', 'M40 128H216M128 40V216');
                      strokes.setAttribute('fill', 'none');
                      strokes.setAttribute('stroke', 'currentColor');
                      strokes.setAttribute('stroke-width', '16');
                      strokes.setAttribute('stroke-linecap', 'round');
                      plus.appendChild(strokes);
                      add.appendChild(plus);
                      add.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const pos = currentPosition();
                        if (pos === null) return;
                        const transaction = focusRichParagraph(view.state, pos);
                        if (!transaction) return;
                        view.dispatch(transaction);
                        view.focus();
                      });
                      rail.appendChild(add);
                      gap.appendChild(rail);

                      return gap;
                    },
                    {
                      key: `${boundary.parent}:${boundary.pos}:${mode}`,
                      side: -1,
                      ignoreSelection: true,
                      stopEvent: () => true,
                    },
                  ),
                );
              }
              return DecorationSet.create(state.doc, decorations);
            },
          },
        }),
      ];
    },
  });
}
