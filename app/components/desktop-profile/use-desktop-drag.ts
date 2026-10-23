'use client';

import { useEffect, useState, type RefCallback } from 'react';
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { DESKTOP_DRAG_TYPE, readDesktopDrag, type DesktopItem } from '@/lib/desktop-items';

type DragProps = {
  ref: RefCallback<HTMLElement>;
  'data-drop-target'?: true;
};
type DragState = { spaceId: string; item: DesktopItem; over: string | null };

function readItem(data: Record<string, unknown>, spaceId: string) {
  const payload = data[DESKTOP_DRAG_TYPE];
  return typeof payload === 'string' ? readDesktopDrag(payload, spaceId) : null;
}

export function useDesktopDrag(spaceId: string) {
  const [state, setState] = useState<DragState | null>(null);
  const current = state?.spaceId === spaceId ? state : null;

  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => Boolean(readItem(source.data, spaceId)),
        onDragStart: ({ source, location }) => {
          const item = readItem(source.data, spaceId);
          if (item)
            setState({
              spaceId,
              item,
              over: (location.current.dropTargets[0]?.data.desktopTargetId as string) ?? null,
            });
        },
        onDropTargetChange: ({ location }) => {
          const over = (location.current.dropTargets[0]?.data.desktopTargetId as string) ?? null;
          setState((previous) =>
            previous?.spaceId === spaceId ? { ...previous, over } : previous,
          );
        },
        onDrop: () => setState(null),
      }),
    [spaceId],
  );

  return {
    item: current?.item ?? null,
    source(value: DesktopItem, enabled = true): DragProps {
      return {
        ref(element) {
          if (!element || !enabled) return;
          return draggable({
            element,
            // Menus remain ordinary buttons, even inside a draggable row.
            canDrag: ({ input }) =>
              !element.ownerDocument
                .elementFromPoint(input.clientX, input.clientY)
                ?.closest('.file-actions-trigger'),
            getInitialData: () => ({
              [DESKTOP_DRAG_TYPE]: JSON.stringify({ ...value, spaceId }),
            }),
            onGenerateDragPreview({ nativeSetDragImage, location }) {
              const source = element.querySelector<HTMLElement>('[data-drag-preview]');
              if (!source) return;
              const bounds = source.getBoundingClientRect();
              setCustomNativeDragPreview({
                nativeSetDragImage,
                getOffset: () => ({
                  x: Math.max(
                    0,
                    Math.min(location.initial.input.clientX - bounds.left, bounds.width),
                  ),
                  y: Math.max(
                    0,
                    Math.min(location.initial.input.clientY - bounds.top, bounds.height),
                  ),
                }),
                render({ container }) {
                  const preview = source.cloneNode(true) as HTMLElement;
                  preview.inert = true;
                  preview.setAttribute('aria-hidden', 'true');
                  preview.removeAttribute('aria-controls');
                  preview.removeAttribute('aria-pressed');
                  preview
                    .querySelectorAll('.file-list-status, .file-list-name small')
                    .forEach((node) => node.remove());
                  // The preview lives outside the window, so keep the source's
                  // layout without copying its surrounding desktop or toolbar.
                  const style = getComputedStyle(source);
                  Object.assign(preview.style, {
                    width: `${bounds.width}px`,
                    margin: '0',
                    padding: style.padding,
                    display: style.display,
                    flexDirection: style.flexDirection,
                    alignItems: style.alignItems,
                    justifyContent: style.justifyContent,
                    gap: style.gap,
                    font: style.font,
                    color: style.color,
                    textAlign: style.textAlign,
                    border: '0',
                    boxShadow: 'none',
                    background: 'transparent',
                  });
                  container.appendChild(preview);
                },
              });
            },
          });
        },
      };
    },
    target(
      id: string,
      accepts: (item: DesktopItem) => boolean,
      drop?: (item: DesktopItem) => void,
      options?: { exclude?: string },
    ): DragProps {
      return {
        'data-drop-target': current?.over === id || undefined,
        ref(element) {
          if (!element) return;
          return dropTargetForElements({
            element,
            getData: () => ({ desktopTargetId: id }),
            getDropEffect: () => 'move',
            canDrop: ({ source, input }) => {
              const item = readItem(source.data, spaceId);
              if (!item || !accepts(item)) return false;
              return !(
                options?.exclude &&
                element.ownerDocument
                  .elementFromPoint(input.clientX, input.clientY)
                  ?.closest(options.exclude)
              );
            },
            onDrop({ source, location, self }) {
              // A folder inside Files also sits inside the desktop. Only the
              // innermost accepted target executes the command.
              if (location.current.dropTargets[0]?.element !== self.element) return;
              const item = readItem(source.data, spaceId);
              if (item && accepts(item)) drop?.(item);
            },
          });
        },
      };
    },
    combine(...bindings: DragProps[]): DragProps {
      return {
        'data-drop-target': bindings.some((binding) => binding['data-drop-target']) || undefined,
        ref(element) {
          if (!element) return;
          const cleanups = bindings.map((binding) => binding.ref(element));
          return () => cleanups.forEach((cleanup) => cleanup?.());
        },
      };
    },
  };
}
export type DesktopDrag = ReturnType<typeof useDesktopDrag>;
