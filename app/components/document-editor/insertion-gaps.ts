import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { focusRichParagraph, richDocumentBoundaries } from '@/lib/rich-document-insertion';

type InsertionGapOptions = {
  onAdd: (pos: number, anchor: HTMLElement) => void;
  labels: { add: string; write: string };
};

const insertionGapKey = new PluginKey('richInsertionGaps');

function emptyParagraph(node: ProseMirrorNode | null) {
  return node?.type.name === 'paragraph' && node.content.size === 0;
}

function nonTextBlock(node: ProseMirrorNode | null) {
  return !!node && (node.isAtom || node.type.name === 'wyaSection');
}

/**
 * Insertion controls are decorations, never document content. Opening their
 * menu does not add blank paragraphs or change the saved Markdown.
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
                const compact = emptyParagraph(after);
                // Empty lines use one small control at the active caret, not
                // a gutter of controls beside every blank paragraph.
                if (
                  compact &&
                  (!state.selection.empty ||
                    state.selection.from < boundary.pos + 1 ||
                    state.selection.to > boundary.pos + after!.nodeSize - 1)
                )
                  continue;
                const terminal = after === null;
                const empty = before === null && after === null;

                // Editable prose already has a place for the caret. Full
                // writing lanes are only needed between non-text blocks or
                // at their outer edges. In particular, typing into an empty
                // paragraph must not add a new lane on either side of it.
                const needsWritingLane =
                  (before === null || nonTextBlock(before)) &&
                  (after === null || nonTextBlock(after));
                if (!compact && !needsWritingLane) continue;

                const mode = compact
                  ? 'compact'
                  : empty
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
                      gap.className = [
                        'rich-insertion-gap',
                        compact && 'is-compact',
                        boundary.parent === 'wyaSection' && 'is-section',
                      ]
                        .filter(Boolean)
                        .join(' ');
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
                      const button = (className: string, label: string) => {
                        const element = dom.createElement('button');
                        element.type = 'button';
                        element.className = className;
                        element.setAttribute('aria-label', label);
                        // Keep the existing text selection when using the
                        // pointer; keyboard users can still Tab to each button.
                        element.addEventListener('pointerdown', (event) => event.preventDefault());
                        return element;
                      };

                      const add = button('rich-insertion-add', options.labels.add);
                      add.title = options.labels.add;
                      add.setAttribute('aria-haspopup', 'dialog');
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
                        if (pos !== null) options.onAdd(pos, add);
                      });
                      gap.appendChild(add);

                      if (!compact) {
                        const label = options.labels.write;
                        const write = button('rich-insertion-write', label);
                        write.textContent = label;
                        write.addEventListener('click', (event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const pos = currentPosition();
                          if (pos === null) return;
                          const transaction = focusRichParagraph(view.state, pos);
                          if (!transaction) return;
                          view.dispatch(transaction);
                          view.focus();
                        });
                        gap.appendChild(write);
                      }

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
