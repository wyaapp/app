'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { DropdownMenu } from 'radix-ui';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { ArrowsHorizontalIcon } from '@phosphor-icons/react/dist/ssr/ArrowsHorizontal';
import { GIF_DEFAULT_WIDTH, GIF_MAX_WIDTH, GIF_MIN_WIDTH } from '@/lib/gif';
import { useTranslation } from '../language-provider';

type ResizeSession = {
  pointerId: number;
  startX: number;
  width: number;
  latest: number;
  direction: number;
  moved: boolean;
};

export type MediaSize = number | 'full' | undefined;

export function MediaSizeMenu({
  size,
  label,
  disabled,
  onChange,
}: {
  size: MediaSize;
  label: string;
  disabled: boolean;
  onChange: (size: MediaSize) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <DropdownMenu.Label className="rich-media-size-label">{label}</DropdownMenu.Label>
      <DropdownMenu.RadioGroup
        value={size === 'full' ? 'full' : size === undefined ? 'default' : 'custom'}
        onValueChange={(value) => onChange(value === 'full' ? 'full' : undefined)}
      >
        <DropdownMenu.RadioItem value="default" disabled={disabled}>
          <span className="rich-media-size-check">
            <DropdownMenu.ItemIndicator>
              <CheckIcon size={16} />
            </DropdownMenu.ItemIndicator>
          </span>
          {t('Default size')}
          <span className="rich-media-size-value">{GIF_DEFAULT_WIDTH}px</span>
        </DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="full" disabled={disabled}>
          <span className="rich-media-size-check">
            <DropdownMenu.ItemIndicator>
              <CheckIcon size={16} />
            </DropdownMenu.ItemIndicator>
          </span>
          {t('Fill width')}
          <ArrowsHorizontalIcon size={16} className="rich-media-size-value" />
        </DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
      <DropdownMenu.Separator className="rich-media-size-separator" />
    </>
  );
}

export function ResizableMediaBlock({
  className,
  selected,
  disabled,
  size,
  resizeLabel,
  onResize,
  actions,
  children,
}: {
  className: string;
  selected: boolean;
  disabled: boolean;
  size: MediaSize;
  resizeLabel: string;
  onResize: (size: MediaSize) => void;
  actions?: ReactNode;
  children: (size: MediaSize) => ReactNode;
}) {
  const { t } = useTranslation();
  const wrapper = useRef<HTMLDivElement>(null);
  const resize = useRef<ResizeSession | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [availableWidth, setAvailableWidth] = useState(GIF_MAX_WIDTH);
  const resizeHandleRef = useCallback(
    (handle: HTMLSpanElement | null) => {
      // Removing the handle (including when editing is disabled) cancels the gesture.
      if (!handle) {
        resize.current = null;
        setPreviewWidth(null);
      }
    },
    [setPreviewWidth],
  );

  useEffect(() => {
    const parent = wrapper.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(parent);
      const width =
        parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setAvailableWidth(Math.max(GIF_MIN_WIDTH, Math.min(GIF_MAX_WIDTH, Math.floor(width))));
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  function finish(event: PointerEvent<HTMLSpanElement>, cancel = false) {
    const session = resize.current;
    if (!session || session.pointerId !== event.pointerId) return;
    resize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setPreviewWidth(null);
    if (!cancel && session.moved) onResize(session.latest);
  }

  const displayedSize = previewWidth === null ? size : previewWidth;
  const numericWidth = typeof displayedSize === 'number' ? displayedSize : GIF_DEFAULT_WIDTH;
  const value = displayedSize === 'full' ? availableWidth : Math.min(numericWidth, availableWidth);

  return (
    <NodeViewWrapper
      ref={wrapper}
      className={`rich-media ${className}${selected ? ' is-selected' : ''}${previewWidth !== null ? ' is-resizing' : ''}`}
      contentEditable={false}
      style={{ maxWidth: displayedSize === 'full' ? 'none' : `${numericWidth}px` }}
    >
      {actions}
      {children(displayedSize)}
      {!disabled && (
        <span
          ref={resizeHandleRef}
          role="slider"
          tabIndex={0}
          className="rich-media-resize"
          aria-label={resizeLabel}
          aria-orientation="horizontal"
          aria-valuemin={GIF_MIN_WIDTH}
          aria-valuemax={availableWidth}
          aria-valuenow={value}
          aria-valuetext={size === 'full' && previewWidth === null ? t('Fill width') : `${value}px`}
          title={t('Drag to resize. Arrow keys adjust the width.')}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0 || !wrapper.current) return;
            event.preventDefault();
            event.stopPropagation();
            const width = wrapper.current.getBoundingClientRect().width;
            resize.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              width,
              latest: Math.round(width),
              direction: getComputedStyle(wrapper.current).direction === 'rtl' ? -1 : 1,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus();
          }}
          onPointerMove={(event) => {
            const session = resize.current;
            if (!session || session.pointerId !== event.pointerId) return;
            const delta = (event.clientX - session.startX) * session.direction;
            if (!session.moved && Math.abs(delta) < 2) return;
            session.moved = true;
            session.latest = Math.max(
              GIF_MIN_WIDTH,
              Math.min(availableWidth, Math.round(session.width + delta)),
            );
            setPreviewWidth(session.latest);
          }}
          onPointerUp={(event) => finish(event)}
          onPointerCancel={(event) => finish(event, true)}
          onLostPointerCapture={(event) => finish(event, true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && resize.current) {
              event.preventDefault();
              event.stopPropagation();
              const pointerId = resize.current.pointerId;
              resize.current = null;
              if (event.currentTarget.hasPointerCapture(pointerId))
                event.currentTarget.releasePointerCapture(pointerId);
              setPreviewWidth(null);
              return;
            }
            if (
              resize.current ||
              !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            const width = Math.round(wrapper.current?.getBoundingClientRect().width ?? value);
            const step = event.shiftKey ? 10 : 1;
            const next =
              event.key === 'Home'
                ? GIF_MIN_WIDTH
                : event.key === 'End'
                  ? availableWidth
                  : width + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -step : step);
            onResize(Math.max(GIF_MIN_WIDTH, Math.min(availableWidth, next)));
          }}
        />
      )}
      {previewWidth !== null && (
        <output className="rich-media-resize-value">{previewWidth}px</output>
      )}
    </NodeViewWrapper>
  );
}
