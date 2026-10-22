'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { useTranslation } from '../language-provider';
import { clampWindow, type Point } from './window-state';

export function DesktopWindow({
  id,
  title,
  icon,
  index,
  open,
  active,
  maximized,
  layer,
  workspace,
  onFocus,
  onHide,
  onMaximize,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  index: number;
  open: boolean;
  active: boolean;
  maximized: boolean;
  layer: number;
  workspace: RefObject<HTMLDivElement | null>;
  onFocus: () => void;
  onHide: () => void;
  onMaximize: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const node = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; start: Point } | null>(null);
  // CSS places untouched windows, including the server-rendered first frame.
  const [position, setPosition] = useState<Point | null>(null);

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

  useLayoutEffect(() => {
    const area = workspace.current;
    const element = node.current;
    if (!area || !element || !open || maximized) return;
    const resize = () => {
      if (area.clientWidth <= 960) return;
      setPosition((current) => {
        if (!current) return current;
        const next = clampWindow(
          current,
          { width: element.offsetWidth, height: element.offsetHeight },
          { width: area.clientWidth, height: area.clientHeight },
        );
        return next.x === current.x && next.y === current.y ? current : next;
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(area);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [open, maximized, workspace]);

  return (
    <section
      ref={node}
      id={`desktop-${id}`}
      hidden={!open}
      className={`desktop-window ${id === 'about' ? 'desktop-about' : ''} ${active ? 'is-active' : ''} ${maximized ? 'is-maximized' : ''}`}
      style={
        {
          '--window-offset-x': `${index === 0 ? 0 : 452 + (index - 1) * 24}px`,
          '--window-offset-y': `${index === 0 ? 54 : 94 + (index - 1) * 24}px`,
          '--window-x': position ? `${position.x}px` : undefined,
          '--window-y': position ? `${position.y}px` : undefined,
          zIndex: layer + 1,
        } as CSSProperties
      }
      aria-label={title}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
      <header className="desktop-window-bar">
        <div
          className="desktop-window-handle"
          tabIndex={0}
          role="group"
          aria-label={t('Move {name} window with arrow keys', { name: title })}
          onDoubleClick={() => {
            if ((workspace.current?.clientWidth ?? 0) > 960) onMaximize();
          }}
          onKeyDown={(event) => {
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
            const distance = event.shiftKey ? 40 : 10;
            const current = currentPosition();
            setPosition(
              bounded({ x: current.x + step.x * distance, y: current.y + step.y * distance }),
            );
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || maximized || (workspace.current?.clientWidth ?? 0) <= 960)
              return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
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
          {icon}
          <h2>{title}</h2>
          <span className="desktop-window-grip" aria-hidden="true" />
        </div>
        <div className="desktop-window-controls">
          <button
            type="button"
            className="desktop-wide-control"
            onClick={onHide}
            aria-label={t('Minimize {name}', { name: title })}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="desktop-wide-control"
            onClick={onMaximize}
            aria-pressed={maximized}
            aria-label={t(maximized ? 'Restore {name}' : 'Maximize {name}', { name: title })}
          >
            {maximized ? <Copy size={14} /> : <Square size={14} />}
          </button>
          <button type="button" onClick={onHide} aria-label={t('Close {name}', { name: title })}>
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="desktop-window-body">{open && children}</div>
    </section>
  );
}
