'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { MinusIcon } from '@phosphor-icons/react/dist/ssr/Minus';
import { SquareIcon } from '@phosphor-icons/react/dist/ssr/Square';
import { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import { useTranslation } from '../language-provider';
import { clampWindow, type Point } from './window-state';
import { useWindowPresence } from './use-window-presence';
import type { DesktopCategory } from './app-categories';
import { isRenameShortcut, useDesktopPreferences } from '@/lib/desktop-preferences';
import { WindowTitle } from './window-title';
import { documentAppearanceStyle, type DocumentAppearance } from '@/lib/document-appearance';
import { DocumentAppearanceContext } from './document-appearance-context';
import { DesktopWindowContext } from './window-context';

export function DesktopWindow({
  id,
  title,
  category,
  icon,
  index,
  layoutVersion = 0,
  position: savedPosition,
  onPositionChange,
  open,
  active,
  maximized,
  layer,
  workspace,
  onFocus,
  onHide,
  onMaximize,
  onMinimize = onHide,
  keepMounted = false,
  className = '',
  onRename,
  renameRequest = 0,
  appearance,
  controls = 'window',
  children,
}: {
  id: string;
  title: string;
  category: DesktopCategory;
  icon: ReactNode;
  index: number;
  layoutVersion?: number;
  position?: Point | null;
  onPositionChange?: (point: Point) => void;
  open: boolean;
  active: boolean;
  maximized: boolean;
  layer: number;
  workspace: RefObject<HTMLDivElement | null>;
  /** Raise an already open window; never launch or restore one from a focus event. */
  onFocus: () => void;
  onHide: () => void;
  onMaximize: () => void;
  onMinimize?: () => void;
  keepMounted?: boolean;
  className?: string;
  onRename?: (name: string) => Promise<void>;
  renameRequest?: number;
  appearance?: DocumentAppearance;
  /** Transient child editors close with their document instead of getting a separate taskbar entry. */
  controls?: 'window' | 'dialog';
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { renameShortcut } = useDesktopPreferences();
  const [titleRenameRequest, setTitleRenameRequest] = useState(0);
  const [liveAppearance, setLiveAppearance] = useState<DocumentAppearance | null>(null);
  const node = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; start: Point } | null>(null);
  const presence = useWindowPresence(open, active, layer);
  const resizeFrom = useRef<DOMRect | null>(null);
  const constrainPlacement = useRef<(() => void) | null>(null);
  // CSS places untouched windows; restored positions are available before the window is shown.
  const [placement, setPlacement] = useState<{ point: Point; version: number } | null>(null);
  const [pointerFocus, setPointerFocus] = useState(false);
  const position =
    savedPosition !== undefined
      ? savedPosition
      : placement?.version === layoutVersion
        ? placement.point
        : null;
  const currentPlacement = useRef({ position, onPositionChange });
  useLayoutEffect(() => {
    currentPlacement.current = { position, onPositionChange };
  });

  function setPosition(point: Point) {
    setPlacement({ point, version: layoutVersion });
    onPositionChange?.(point);
  }

  function currentPosition(): Point {
    return { x: node.current?.offsetLeft ?? 0, y: node.current?.offsetTop ?? 0 };
  }

  function bounded(point: Point) {
    if (!node.current || !workspace.current) return point;
    return clampWindow(
      point,
      { width: node.current.offsetWidth, height: node.current.offsetHeight },
      { width: workspace.current.clientWidth, height: workspace.current.clientHeight },
    );
  }

  function stopMotion() {
    node.current?.getAnimations().forEach((animation) => animation.cancel());
  }

  function toggleMaximize() {
    resizeFrom.current = node.current?.getBoundingClientRect() ?? null;
    stopMotion();
    onMaximize();
  }

  useLayoutEffect(() => {
    const element = node.current;
    const from = resizeFrom.current;
    resizeFrom.current = null;
    if (!element || !from || !open || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    const to = element.getBoundingClientRect();
    if (!to.width || !to.height) return;
    // Animate only deliberate maximize/restore actions, never dragging or layout changes.
    const animation = element.animate(
      [
        {
          transformOrigin: 'top left',
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        },
        { transformOrigin: 'top left', transform: 'none' },
      ],
      { duration: 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
    return () => animation.cancel();
  }, [maximized, open]);

  useLayoutEffect(() => {
    const area = workspace.current;
    const element = node.current;
    if (!area || !element || !open || maximized) return;
    const resize = () => {
      if (area.clientWidth <= 960) return;
      const current = currentPlacement.current;
      if (!current.position) return;
      const next = clampWindow(
        current.position,
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: area.clientWidth, height: area.clientHeight },
      );
      if (next.x === current.position.x && next.y === current.position.y) return;
      setPlacement({ point: next, version: layoutVersion });
      current.onPositionChange?.(next);
    };
    const observer = new ResizeObserver(resize);
    constrainPlacement.current = resize;
    observer.observe(area);
    observer.observe(element);
    resize();
    return () => {
      constrainPlacement.current = null;
      observer.disconnect();
    };
  }, [open, maximized, workspace, layoutVersion]);

  useLayoutEffect(() => {
    constrainPlacement.current?.();
  }, [savedPosition]);

  return (
    <section
      ref={node}
      id={`desktop-${id}`}
      hidden={!presence.present}
      inert={!open}
      aria-hidden={!open || undefined}
      data-state={presence.state}
      className={`desktop-window ${className} ${id === 'about' ? 'desktop-about' : ''} ${presence.active ? 'is-active' : ''} ${maximized ? 'is-maximized' : ''}`}
      style={
        {
          ...(liveAppearance || appearance
            ? documentAppearanceStyle(liveAppearance ?? appearance)
            : {}),
          '--window-offset-x': `${index === 0 ? 0 : 452 + (index - 1) * 24}px`,
          '--window-offset-y': `${index === 0 ? 54 : 94 + (index - 1) * 24}px`,
          '--window-x': position ? `${position.x}px` : undefined,
          '--window-y': position ? `${position.y}px` : undefined,
          // Leave an integer layer above each app for its transient child editors.
          zIndex: (presence.layer + 1) * 2,
        } as CSSProperties
      }
      aria-label={title}
      data-category={category}
      onPointerDownCapture={() => {
        if (open && !active) onFocus();
      }}
      onFocusCapture={() => {
        if (open && !active) onFocus();
      }}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === 'desktop-window-out')
          presence.finishExit();
      }}
    >
      <header className="desktop-window-bar">
        <div
          className="desktop-window-handle"
          data-pointer-focus={pointerFocus || undefined}
          tabIndex={0}
          role="group"
          aria-label={t('Move {name} window with arrow keys', { name: title })}
          onDoubleClick={() => {
            if (controls === 'window' && (workspace.current?.clientWidth ?? 0) > 960)
              toggleMaximize();
          }}
          onKeyDown={(event) => {
            setPointerFocus(false);
            if ((event.target as HTMLElement).closest('input, form')) return;
            if (onRename && isRenameShortcut(event.nativeEvent, renameShortcut)) {
              event.preventDefault();
              event.stopPropagation();
              setTitleRenameRequest((value) => value + 1);
              return;
            }
            if ((event.target as HTMLElement).closest('button')) return;
            if (maximized || (workspace.current?.clientWidth ?? 0) <= 960) return;
            const steps: Record<string, Point> = {
              ArrowLeft: { x: -1, y: 0 },
              ArrowRight: { x: 1, y: 0 },
              ArrowUp: { x: 0, y: -1 },
              ArrowDown: { x: 0, y: 1 },
            };
            const step = steps[event.key];
            if (!step) return;
            event.preventDefault();
            stopMotion();
            const distance = event.shiftKey ? 40 : 10;
            const current = currentPosition();
            setPosition(
              bounded({ x: current.x + step.x * distance, y: current.y + step.y * distance }),
            );
          }}
          onBlur={() => setPointerFocus(false)}
          onPointerDown={(event) => {
            setPointerFocus(true);
            if (event.button !== 0 || maximized || (workspace.current?.clientWidth ?? 0) <= 960)
              return;
            stopMotion();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, start: currentPosition() };
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            setPosition(
              bounded({
                x: drag.current.start.x + event.clientX - drag.current.x,
                y: drag.current.start.y + event.clientY - drag.current.y,
              }),
            );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          <span className="desktop-window-icon" aria-hidden="true">
            {icon}
          </span>
          {onRename ? (
            <WindowTitle
              title={title}
              onRename={onRename}
              request={renameRequest + titleRenameRequest}
            />
          ) : (
            <h2>{title}</h2>
          )}
        </div>
        <div className="desktop-window-controls">
          {controls === 'window' && (
            <>
              <button
                type="button"
                className="desktop-wide-control"
                onClick={onMinimize}
                aria-label={t('Minimize {name}', { name: title })}
              >
                <MinusIcon weight="regular" aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                className="desktop-wide-control"
                onClick={toggleMaximize}
                aria-pressed={maximized}
                aria-label={t(maximized ? 'Restore {name}' : 'Maximize {name}', { name: title })}
              >
                {maximized ? (
                  <CopyIcon weight="regular" aria-hidden="true" size={14} />
                ) : (
                  <SquareIcon weight="regular" aria-hidden="true" size={14} />
                )}
              </button>
            </>
          )}
          <button type="button" onClick={onHide} aria-label={t('Close {name}', { name: title })}>
            <XIcon weight="regular" aria-hidden="true" size={17} />
          </button>
        </div>
      </header>
      <div className="desktop-window-body">
        <DesktopWindowContext.Provider
          value={{ id, title, node, workspace, open, active, layer, onFocus }}
        >
          <DocumentAppearanceContext.Provider value={setLiveAppearance}>
            {(presence.present || keepMounted) && children}
          </DocumentAppearanceContext.Provider>
        </DesktopWindowContext.Provider>
      </div>
    </section>
  );
}
