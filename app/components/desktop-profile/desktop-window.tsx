'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { useTranslation } from '../language-provider';
import { clampWindow, startingPosition, type Point } from './window-state';

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
  const initialized = useRef(false);
  const drag = useRef<{ x: number; y: number; start: Point } | null>(null);
  const [position, setPosition] = useState<Point>({ x: index ? 584 : 132, y: index ? 94 : 54 });

  function bounded(point: Point) {
    if (!node.current || !workspace.current) return point;
    return clampWindow(
      point,
      { width: node.current.offsetWidth, height: node.current.offsetHeight },
      { width: workspace.current.clientWidth, height: workspace.current.clientHeight },
    );
  }

  useEffect(() => {
    const area = workspace.current;
    const element = node.current;
    if (!area || !element || !open || maximized) return;
    const resize = () => {
      if (area.clientWidth <= 960) return;
      setPosition((current) => {
        const point = initialized.current ? current : startingPosition(index, area.clientWidth);
        initialized.current = true;
        return clampWindow(
          point,
          { width: element.offsetWidth, height: element.offsetHeight },
          { width: area.clientWidth, height: area.clientHeight },
        );
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(area);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [index, open, maximized, workspace]);

  return (
    <section
      ref={node}
      id={`desktop-${id}`}
      hidden={!open}
      className={`desktop-window ${id === 'about' ? 'desktop-about' : ''} ${active ? 'is-active' : ''} ${maximized ? 'is-maximized' : ''}`}
      style={
        {
          '--window-x': `${position.x}px`,
          '--window-y': `${position.y}px`,
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
            setPosition((current) =>
              bounded({ x: current.x + step.x * distance, y: current.y + step.y * distance }),
            );
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || maximized || (workspace.current?.clientWidth ?? 0) <= 960)
              return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, start: position };
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
