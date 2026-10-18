'use client';
import { itemLabel } from '@/lib/item-label';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Layers, Link2 } from 'lucide-react';
import type { LinkItem } from '@/lib/model';
import { getLayoutGroups, type LinkLayout } from '@/lib/link-layout';
import { dropLayoutItem, layoutDropAt, type LayoutDrag, type LayoutDrop } from '@/lib/layout-drag';

type Point = { x: number; y: number };
type Session = {
  source: LayoutDrag;
  pointerId: number;
  origin: Point;
  point: Point;
  active: boolean;
};
type Feedback = {
  source: LayoutDrag;
  point: Point;
  target: LayoutDrop | null;
  line: { left: number; top: number; width: number } | null;
  hint: string;
};

export function useLayoutDrag(
  layout: LinkLayout,
  links: LinkItem[],
  busy: boolean,
  onChange: (layout: LinkLayout) => void,
  onAnnounce: (message: string) => void,
) {
  const root = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef({ layout, busy, onChange, onAnnounce });
  const positions = useRef<{ selector: string; rects: Map<string, DOMRect> } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  useLayoutEffect(() => {
    latest.current = { layout, busy, onChange, onAnnounce };
  });
  useLayoutEffect(() => {
    const previous = positions.current;
    positions.current = null;
    if (!previous || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.current?.querySelectorAll<HTMLElement>(previous.selector).forEach((element) => {
      const key = element.dataset.linkSlug ?? element.dataset.layoutGroup!;
      const old = previous.rects.get(key);
      if (!old) return;
      const rect = element.getBoundingClientRect();
      const x = old.left - rect.left,
        y = old.top - rect.top;
      if (x || y)
        element.animate(
          [{ transform: `translate(${x}px,${y}px)` }, { transform: 'translate(0,0)' }],
          { duration: 180, easing: 'ease-out' },
        );
    });
  }, [layout]);

  function clear() {
    const current = session.current;
    session.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (current && root.current?.hasPointerCapture(current.pointerId))
      root.current.releasePointerCapture(current.pointerId);
    setFeedback(null);
  }
  // Window-level Escape/blur also works when the pointer has left the editor.
  useEffect(() => {
    const cancel = () => {
      const current = session.current;
      session.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      if (current && root.current?.hasPointerCapture(current.pointerId))
        root.current.releasePointerCapture(current.pointerId);
      setFeedback(null);
      if (current?.active) latest.current.onAnnounce('Move cancelled. Layout unchanged.');
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && session.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  function locate(current: Session): Feedback {
    const editor = root.current!;
    const bounds = editor.getBoundingClientRect();
    const elements = Array.from(editor.querySelectorAll<HTMLElement>('[data-layout-group]'));
    const groups = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.dataset.layoutGroup!,
        top: rect.top,
        bottom: rect.bottom,
        rows: Array.from(element.querySelectorAll<HTMLElement>('[data-link-slug]')).map((row) => {
          const r = row.getBoundingClientRect();
          return { id: row.dataset.linkSlug!, top: r.top, bottom: r.bottom };
        }),
      };
    });
    const { x, y } = current.point;
    const inside =
      x >= bounds.left - 24 && x <= bounds.right + 24 && y >= bounds.top && y <= bounds.bottom + 64;
    const target = inside ? layoutDropAt(current.source, y, groups) : null;
    let line: Feedback['line'] = null,
      hint = 'Move over the list to choose a position';
    if (target?.kind === 'section') {
      const sections = groups.filter((group) => group.id !== current.source.id);
      const before = sections.find((group) => group.id === target.beforeId);
      const name = getLayoutGroups(latest.current.layout).find(
        (group) => group.id === target.beforeId,
      )?.title;
      line = {
        left: bounds.left,
        top: before ? before.top - 12 : sections.at(-1)!.bottom + 12,
        width: bounds.width,
      };
      hint = before
        ? `Place before ${name || 'Untitled section'}`
        : 'Place at the bottom of the page';
    } else if (target?.kind === 'link') {
      const group = groups.find((group) => group.id === target.groupId)!;
      const row = group.rows.find((row) => row.id === target.beforeId);
      const rows = group.rows.filter((row) => row.id !== current.source.id);
      const element = elements.find((element) => element.dataset.layoutGroup === target.groupId)!;
      const heading = element
        .querySelector('.section-editor-heading, .ungrouped-heading')
        ?.getBoundingClientRect();
      line = {
        left: bounds.left,
        top: row
          ? row.top - 8
          : rows.at(-1)
            ? rows.at(-1)!.bottom + 8
            : (heading?.bottom ?? group.top) + 12,
        width: bounds.width,
      };
      const name =
        latest.current.layout.sections.find((section) => section.id === target.groupId)?.title ||
        'No section';
      hint = `${row ? 'Insert here' : 'Place at the end'} · ${name}`;
    }
    return { source: current.source, point: current.point, target, line, hint };
  }
  function tick() {
    const current = session.current;
    if (!current?.active) return;
    if (latest.current.busy) {
      clear();
      return;
    }
    const rect = root.current?.getBoundingClientRect();
    if (rect && current.point.x >= rect.left - 24 && current.point.x <= rect.right + 24) {
      const edge = 80,
        y = current.point.y;
      const speed =
        y < edge
          ? -Math.ceil((edge - y) / 6)
          : y > window.innerHeight - edge
            ? Math.ceil((y - window.innerHeight + edge) / 6)
            : 0;
      if (speed) {
        window.scrollBy(0, Math.max(-18, Math.min(18, speed)));
        setFeedback(locate(current));
      }
    }
    frame.current = requestAnimationFrame(tick);
  }
  function start(event: PointerEvent, source: LayoutDrag) {
    if (busy || event.button !== 0 || !event.isPrimary || session.current) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).focus();
    const point = { x: event.clientX, y: event.clientY };
    session.current = { source, pointerId: event.pointerId, origin: point, point, active: false };
    // Capture on a stable ancestor, not a row that can move between groups.
    root.current?.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.point = { x: event.clientX, y: event.clientY };
    if (!current.active) {
      if (Math.hypot(current.point.x - current.origin.x, current.point.y - current.origin.y) < 6)
        return;
      current.active = true;
      frame.current = requestAnimationFrame(tick);
      onAnnounce(`Moving ${current.source.kind}. Release to place; Escape to cancel.`);
    }
    event.preventDefault();
    setFeedback(locate(current));
  }
  function finish(event: PointerEvent) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.point = { x: event.clientX, y: event.clientY };
    if (current.active && !latest.current.busy) {
      const target = locate(current).target;
      const next = target
        ? dropLayoutItem(latest.current.layout, current.source, target)
        : latest.current.layout;
      if (next !== latest.current.layout) {
        const selector =
          current.source.kind === 'section' ? '[data-layout-group]' : '[data-link-slug]';
        positions.current = {
          selector,
          rects: new Map(
            Array.from(root.current!.querySelectorAll<HTMLElement>(selector)).map((element) => [
              element.dataset.linkSlug ?? element.dataset.layoutGroup!,
              element.getBoundingClientRect(),
            ]),
          ),
        };
        latest.current.onChange(next);
        onAnnounce('Moved. Save layout to publish, or Discard to undo.');
        requestAnimationFrame(() => {
          const attribute = current.source.kind === 'section' ? 'layoutGroup' : 'linkSlug';
          Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])
            .find((element) => element.dataset[attribute] === current.source.id)
            ?.querySelector<HTMLButtonElement>('.drag-handle')
            ?.focus({ preventScroll: true });
        });
      } else onAnnounce('Layout unchanged.');
    }
    clear();
  }
  const section =
    feedback?.source.kind === 'section'
      ? getLayoutGroups(layout).find((section) => section.id === feedback.source.id)
      : null;
  const draggedItem = links.find((link) => link.slug === feedback?.source.id);
  const label = section?.title || (draggedItem ? itemLabel(draggedItem) : 'Untitled section');
  const overlay = feedback
    ? createPortal(
        <div className="layout-drag-layer" aria-hidden="true">
          {feedback.line && (
            <div
              className="layout-insertion-line"
              style={{
                left: feedback.line.left,
                top: feedback.line.top,
                width: feedback.line.width,
              }}
            />
          )}
          <div
            className="layout-drag-preview"
            style={{
              left: Math.max(8, Math.min(feedback.point.x + 16, window.innerWidth - 268)),
              top: Math.max(8, Math.min(feedback.point.y + 16, window.innerHeight - 130)),
            }}
          >
            <GripVertical size={18} />
            <div>
              <span className="layout-drag-kind">
                {section ? (
                  <>
                    <Layers size={13} />
                    Section · {section.slugs.length} items
                  </>
                ) : (
                  <>
                    <Link2 size={13} />
                    Link
                  </>
                )}
              </span>
              <strong>{label}</strong>
              <small>{feedback.hint}</small>
              <small className="layout-drag-cancel">Esc to cancel</small>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;
  return {
    root,
    start,
    active: feedback?.source,
    overlay,
    handlers: {
      onPointerMove: move,
      onPointerUp: finish,
      onPointerCancel: clear,
      onLostPointerCapture: (event: PointerEvent) => {
        if (event.target === root.current) clear();
      },
    },
  };
}
