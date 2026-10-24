'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { moveRichBlock, richBlockAt, type RichBlock } from '@/lib/rich-document-drag';
import { blockDragKey, richBlockDropTarget } from './block-drag';

type TouchBlockHandleProps = {
  editor: Editor;
  block: RichBlock | null;
  children: ReactNode;
};

type PointerDrag = {
  id: number;
  startX: number;
  startY: number;
  from: number;
  doc: Editor['state']['doc'];
  button: HTMLButtonElement;
  dragging: boolean;
};

type HandleEvents = {
  pointerDown?: (event: PointerEvent) => void;
  pointerMove?: (event: PointerEvent) => void;
  pointerUp?: (event: PointerEvent) => void;
  cancelPointer?: (event: PointerEvent) => void;
  click?: (event: MouseEvent) => void;
};

/** The shared block grip on touch devices, without relying on native HTML dragging. */
export function TouchBlockHandle({ editor, block, children }: TouchBlockHandleProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const blockRef = useRef(block);
  const repositionRef = useRef<() => void>(() => {});
  const events = useRef<HandleEvents>({});

  useLayoutEffect(() => {
    blockRef.current = block;
    repositionRef.current();
  }, [block]);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || editor.isDestroyed) return;
    const view = editor.view;
    const viewportElement = view.dom.parentElement;
    if (!viewportElement) return;
    const dom = view.dom.ownerDocument;
    const win = dom.defaultView;
    let session: PointerDrag | null = null;
    let indicator: HTMLDivElement | null = null;
    let delegatedClick = false;

    const position = () => {
      const current = blockRef.current;
      const validBlock =
        current && !editor.isDestroyed ? richBlockAt(editor.state.doc, current.pos) : null;
      const node = validBlock ? view.nodeDOM(validBlock.pos) : null;
      if (!editor.isEditable || !(node instanceof HTMLElement)) {
        if (session) clear();
        element.style.visibility = 'hidden';
        return;
      }
      const editorBox = view.dom.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const container =
        element.offsetParent instanceof HTMLElement ? element.offsetParent : element.parentElement;
      if (!container) return;
      const containingBox = container.getBoundingClientRect();
      const viewport = viewportElement.getBoundingClientRect();
      const style = getComputedStyle(view.dom);
      const gutter = Number.parseFloat(style.getPropertyValue('--rich-gutter')) || 36;
      const padding = Number.parseFloat(style.paddingLeft) || 0;
      const contentLeft = editorBox.left + padding;
      const left = Math.max(contentLeft, box.left) - gutter;
      const divider = current?.node.type.name === 'horizontalRule';
      const top = divider ? box.top + (box.height - element.offsetHeight) / 2 : box.top;
      Object.assign(element.style, {
        left: `${left - containingBox.left - container.clientLeft + container.scrollLeft}px`,
        top: `${top - containingBox.top - container.clientTop + container.scrollTop}px`,
        visibility:
          top + element.offsetHeight < viewport.top || top > viewport.bottom ? 'hidden' : '',
        clipPath: `inset(${Math.max(0, viewport.top - top)}px 0 ${Math.max(0, top + element.offsetHeight - viewport.bottom)}px 0)`,
      });
    };
    repositionRef.current = position;

    const clear = () => {
      const previous = session;
      session = null;
      indicator?.remove();
      indicator = null;
      element.removeAttribute('data-dragging');
      if (previous && element.hasPointerCapture(previous.id))
        element.releasePointerCapture(previous.id);
      if (previous?.dragging && !editor.isDestroyed) editor.commands.setMeta(blockDragKey, null);
    };

    const drawTarget = (x: number, y: number) => {
      if (!session || editor.isDestroyed) return null;
      const target = richBlockDropTarget(view, session, x, y);
      if (!target) {
        indicator?.remove();
        indicator = null;
        return null;
      }
      if (!indicator) {
        indicator = dom.createElement('div');
        indicator.className = 'rich-block-drop-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        dom.body.appendChild(indicator);
      }
      Object.assign(indicator.style, {
        left: `${target.left}px`,
        top: `${target.top}px`,
        width: `${target.width}px`,
      });
      return target;
    };

    const pointerDown = (event: PointerEvent) => {
      const current = blockRef.current;
      const target = event.target;
      const button = target instanceof Element ? target.closest('button') : null;
      if (
        !current ||
        !button ||
        button.disabled ||
        !element.contains(button) ||
        !event.isPrimary ||
        event.button !== 0 ||
        editor.isDestroyed ||
        !editor.isEditable ||
        richBlockAt(editor.state.doc, current.pos)?.node !== current.node
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      clear();
      session = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        from: current.pos,
        doc: editor.state.doc,
        button,
        dragging: false,
      };
      element.setPointerCapture(event.pointerId);
    };

    const pointerMove = (event: PointerEvent) => {
      if (!session || session.id !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      if (editor.isDestroyed || !editor.isEditable || session.doc !== editor.state.doc) {
        clear();
        return;
      }
      if (!session.dragging) {
        if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 5) return;
        session.dragging = true;
        element.dataset.dragging = 'true';
        editor.commands.setMeta(blockDragKey, session.from);
      }
      drawTarget(event.clientX, event.clientY);
    };

    const pointerUp = (event: PointerEvent) => {
      if (!session || session.id !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const previous = session;
      const valid = !editor.isDestroyed && editor.isEditable && previous.doc === editor.state.doc;
      const target = valid && previous.dragging ? drawTarget(event.clientX, event.clientY) : null;
      const transaction = target ? moveRichBlock(editor.state, previous.from, target.pos) : null;
      clear();
      if (transaction) {
        view.dispatch(transaction.scrollIntoView());
        view.dispatch(closeHistory(view.state.tr));
        view.focus();
      } else if (valid && !previous.dragging) {
        delegatedClick = true;
        try {
          previous.button.click();
        } finally {
          delegatedClick = false;
        }
      }
    };

    const cancelPointer = (event: PointerEvent) => {
      if (session?.id === event.pointerId) clear();
    };
    const click = (event: MouseEvent) => {
      // A tap delegates one detail=0 click. Keyboard clicks remain native;
      // compatibility clicks from pointer gestures must not reopen the menu.
      if (!delegatedClick && event.detail !== 0 && element.contains(event.target as Node)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const keyDown = (event: KeyboardEvent) => {
      if (session && event.key === 'Escape') {
        event.preventDefault();
        clear();
      }
    };
    const transaction = () => {
      if (session && (!editor.isEditable || editor.state.doc !== session.doc)) clear();
      position();
    };
    const observer = new ResizeObserver(position);
    observer.observe(view.dom);
    observer.observe(viewportElement);
    if (element.parentElement) observer.observe(element.parentElement);
    events.current = { pointerDown, pointerMove, pointerUp, cancelPointer, click };
    dom.addEventListener('keydown', keyDown);
    dom.addEventListener('scroll', position, true);
    win?.addEventListener('resize', position);
    editor.on('transaction', transaction);
    editor.on('update', transaction);
    editor.on('destroy', clear);
    position();
    return () => {
      clear();
      repositionRef.current = () => {};
      observer.disconnect();
      events.current = {};
      dom.removeEventListener('keydown', keyDown);
      dom.removeEventListener('scroll', position, true);
      win?.removeEventListener('resize', position);
      editor.off('transaction', transaction);
      editor.off('update', transaction);
      editor.off('destroy', clear);
    };
  }, [editor]);
  return (
    <div
      ref={elementRef}
      className="rich-touch-block-handle"
      hidden={!block}
      onPointerDownCapture={(event) => events.current.pointerDown?.(event.nativeEvent)}
      onPointerMoveCapture={(event) => events.current.pointerMove?.(event.nativeEvent)}
      onPointerUpCapture={(event) => events.current.pointerUp?.(event.nativeEvent)}
      onPointerCancelCapture={(event) => events.current.cancelPointer?.(event.nativeEvent)}
      onLostPointerCaptureCapture={(event) => events.current.cancelPointer?.(event.nativeEvent)}
      onClickCapture={(event) => events.current.click?.(event.nativeEvent)}
    >
      {children}
    </div>
  );
}
