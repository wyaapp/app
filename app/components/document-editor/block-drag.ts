import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { chooseRichBlockDropTarget, type RichBlockDropCandidate } from '@/lib/rich-document-drop';
import {
  moveRichBlock,
  siblingRichBlockTarget,
  richBlockBoundaries,
  richBlockAtSelection,
} from '@/lib/rich-document-drag';

export const blockDragKey = new PluginKey('richBlockDrag');
type DragSession = { from: number; doc: EditorState['doc'] };

/** Snap whole-block moves to container boundaries, never split a text line. */
export function richBlockDropTarget(view: EditorView, session: DragSession, x: number, y: number) {
  const doc = view.state.doc;
  if (doc !== session.doc || session.from < 0 || session.from >= doc.content.size) return null;
  const source = doc.nodeAt(session.from);
  if (!source) return null;
  const fragment = Fragment.from(source);
  const editorBox = view.dom.getBoundingClientRect();
  const viewport = view.dom.parentElement!.getBoundingClientRect();
  if (x < editorBox.left || x > editorBox.right || y < viewport.top || y > viewport.bottom)
    return null;
  const candidates: RichBlockDropCandidate[] = [];
  for (const boundary of richBlockBoundaries(doc)) {
    const $pos = doc.resolve(boundary.pos);
    if (!$pos.parent.canReplace($pos.index(), $pos.index(), fragment)) continue;
    const after = $pos.nodeAfter;
    const before = $pos.nodeBefore;
    const next = after ? view.nodeDOM(boundary.pos) : null;
    const previous = before ? view.nodeDOM(boundary.pos - before.nodeSize) : null;
    const nextBox = next instanceof HTMLElement ? next.getBoundingClientRect() : null;
    const previousBox = previous instanceof HTMLElement ? previous.getBoundingClientRect() : null;
    const container =
      boundary.parentPos === undefined ? view.dom : view.nodeDOM(boundary.parentPos);
    if (!(container instanceof HTMLElement)) continue;
    const content =
      boundary.parent === 'wyaSection'
        ? (container.querySelector<HTMLElement>('.rich-section-content') ?? container)
        : container;
    const box = content.getBoundingClientRect();
    const style = getComputedStyle(content);
    const left =
      box.left + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft);
    const width =
      box.width -
      Number.parseFloat(style.borderLeftWidth) -
      Number.parseFloat(style.borderRightWidth) -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight);
    const top =
      nextBox && previousBox
        ? (nextBox.top + previousBox.bottom) / 2
        : (nextBox?.top ?? previousBox?.bottom ?? box.top);
    candidates.push({
      pos: boundary.pos,
      top,
      left,
      width,
      bounds: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      depth: $pos.depth,
    });
  }
  const editorStyle = getComputedStyle(view.dom);
  const result = chooseRichBlockDropTarget(candidates, x, y, {
    gutter: Number.parseFloat(editorStyle.getPropertyValue('--rich-gutter')) || 36,
    gripWidth: Number.parseFloat(editorStyle.getPropertyValue('--rich-control-size')) || 28,
  });
  return result && moveRichBlock(view.state, session.from, result.pos) ? result : null;
}

export function createBlockDragging() {
  return Extension.create({
    name: 'richBlockDragging',
    addKeyboardShortcuts() {
      const move = (direction: -1 | 1) => {
        if (!this.editor.isEditable) return false;
        const { state, view } = this.editor;
        const block = richBlockAtSelection(state);
        if (!block) return false;
        const from = block.pos;
        const target = siblingRichBlockTarget(state, from, direction);
        const tr = target === null ? null : moveRichBlock(state, from, target);
        if (!tr) return false;
        view.dispatch(tr.scrollIntoView());
        view.dispatch(closeHistory(view.state.tr));
        return true;
      };
      return { 'Alt-ArrowUp': () => move(-1), 'Alt-ArrowDown': () => move(1) };
    },
    addProseMirrorPlugins() {
      let session: DragSession | null = null;
      let owned = false;
      let editorView: EditorView | null = null;
      let indicator: HTMLDivElement | null = null;
      let editorDOM: HTMLElement | null = null;
      const clear = () => {
        session = null;
        if (editorView) editorView.dragging = null;
        indicator?.remove();
        indicator = null;
        editorDOM?.removeAttribute('data-block-dragging');
      };
      const finish = () => {
        clear();
        owned = false;
      };
      return [
        new Plugin({
          key: blockDragKey,
          state: {
            init: () => null,
            apply(tr) {
              const from = tr.getMeta(blockDragKey) as number | null | undefined;
              if (tr.docChanged) clear();
              if (from === null) finish();
              if (typeof from === 'number') {
                owned = true;
                session = { from, doc: tr.doc };
                editorDOM?.setAttribute('data-block-dragging', 'true');
              }
              return null;
            },
          },
          view(view) {
            editorView = view;
            editorDOM = view.dom;
            const onKey = (event: KeyboardEvent) => {
              if (event.key === 'Escape') clear();
            };
            const dom = view.dom.ownerDocument;
            dom.addEventListener('dragend', finish);
            dom.addEventListener('drop', finish);
            dom.addEventListener('keydown', onKey);
            return {
              update() {
                if (!view.editable) clear();
              },
              destroy() {
                clear();
                dom.removeEventListener('dragend', finish);
                dom.removeEventListener('drop', finish);
                dom.removeEventListener('keydown', onKey);
              },
            };
          },
          props: {
            handleDOMEvents: {
              dragover(view, event) {
                if (!session || !view.editable || session.doc !== view.state.doc) return false;
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                const target = richBlockDropTarget(view, session, event.clientX, event.clientY);
                if (!target) {
                  indicator?.remove();
                  indicator = null;
                  return true;
                }
                if (!indicator) {
                  indicator = view.dom.ownerDocument.createElement('div');
                  indicator.className = 'rich-block-drop-indicator';
                  indicator.setAttribute('aria-hidden', 'true');
                  view.dom.ownerDocument.body.appendChild(indicator);
                }
                Object.assign(indicator.style, {
                  top: `${target.top}px`,
                  left: `${target.left}px`,
                  width: `${target.width}px`,
                });
                return true;
              },
              dragleave(view, event) {
                if (!view.dom.contains(event.relatedTarget as Node | null)) {
                  indicator?.remove();
                  indicator = null;
                }
                return false;
              },
            },
            handleDrop(view, event) {
              if (!owned) return false;
              const target =
                session && view.editable && session.doc === view.state.doc
                  ? richBlockDropTarget(view, session, event.clientX, event.clientY)
                  : null;
              const tr =
                target && session ? moveRichBlock(view.state, session.from, target.pos) : null;
              clear();
              if (tr) {
                view.dispatch(tr.scrollIntoView());
                view.dispatch(closeHistory(view.state.tr));
                view.focus();
              }
              return true;
            },
          },
        }),
      ];
    },
  });
}
