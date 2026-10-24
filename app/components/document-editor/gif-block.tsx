'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { closeHistory } from '@tiptap/pm/history';
import { DropdownMenu } from 'radix-ui';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { ArrowsHorizontalIcon } from '@phosphor-icons/react/dist/ssr/ArrowsHorizontal';
import {
  GIF_DEFAULT_WIDTH,
  GIF_MAX_WIDTH,
  GIF_MIN_WIDTH,
  gifDisplayMaxWidth,
  type GifEmbed,
} from '@/lib/gif';
import { GifEmbedView } from '../gif-embed';
import { useTranslation } from '../language-provider';

type ResizeSession = {
  pointerId: number;
  startX: number;
  width: number;
  latest: number;
  direction: number;
  moved: boolean;
};

export function GifSizeMenu({
  gif,
  disabled,
  onChange,
}: {
  gif: GifEmbed;
  disabled: boolean;
  onChange: (size: GifEmbed['size']) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <DropdownMenu.Label className="rich-gif-size-label">{t('GIF size')}</DropdownMenu.Label>
      <DropdownMenu.RadioGroup
        value={gif.size === 'full' ? 'full' : gif.size === undefined ? 'default' : 'custom'}
        onValueChange={(value) => onChange(value === 'full' ? 'full' : undefined)}
      >
        <DropdownMenu.RadioItem value="default" disabled={disabled}>
          <span className="rich-gif-size-check">
            <DropdownMenu.ItemIndicator>
              <CheckIcon size={16} />
            </DropdownMenu.ItemIndicator>
          </span>
          {t('Default size')}
          <span className="rich-gif-size-value">{GIF_DEFAULT_WIDTH}px</span>
        </DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="full" disabled={disabled}>
          <span className="rich-gif-size-check">
            <DropdownMenu.ItemIndicator>
              <CheckIcon size={16} />
            </DropdownMenu.ItemIndicator>
          </span>
          {t('Fill width')}
          <ArrowsHorizontalIcon size={16} className="rich-gif-size-value" />
        </DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
      <DropdownMenu.Separator className="rich-gif-size-separator" />
    </>
  );
}

export function GifBlock({
  disabled,
  renderActions,
  ...props
}: NodeViewProps & { disabled: boolean; renderActions?: (items: ReactNode) => ReactNode }) {
  const { t } = useTranslation();
  const gif = props.node.attrs.gif as GifEmbed;
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

  function commit(size: GifEmbed['size']) {
    if (disabled || !props.editor.isEditable || props.editor.isDestroyed) return;
    const pos = props.getPos();
    if (pos === undefined) return;
    const { state, view } = props.editor;
    const current = state.doc.nodeAt(pos);
    const previous = current?.attrs.gif as GifEmbed | undefined;
    if (
      current?.type.name !== 'gif' ||
      previous?.id !== gif.id ||
      previous.provider !== gif.provider
    )
      return;
    if (previous.size === size) return;
    const next = { ...previous };
    if (size === undefined) delete next.size;
    else next.size = size;
    view.dispatch(
      closeHistory(state.tr).setNodeMarkup(pos, undefined, { ...current.attrs, gif: next }),
    );
  }

  function finish(event: PointerEvent<HTMLSpanElement>, cancel = false) {
    const session = resize.current;
    if (!session || session.pointerId !== event.pointerId) return;
    resize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setPreviewWidth(null);
    if (!cancel && session.moved) commit(session.latest);
  }

  const displayed = previewWidth === null ? gif : { ...gif, size: previewWidth };
  const numericWidth = typeof displayed.size === 'number' ? displayed.size : GIF_DEFAULT_WIDTH;
  const value = displayed.size === 'full' ? availableWidth : Math.min(numericWidth, availableWidth);

  return (
    <NodeViewWrapper
      ref={wrapper}
      className={`rich-gif${props.selected ? ' is-selected' : ''}${previewWidth !== null ? ' is-resizing' : ''}`}
      contentEditable={false}
      style={{ maxWidth: gifDisplayMaxWidth(displayed) }}
    >
      {renderActions?.(<GifSizeMenu gif={gif} disabled={disabled} onChange={commit} />)}
      <GifEmbedView gif={displayed} />
      {!disabled && (
        <span
          ref={resizeHandleRef}
          role="slider"
          tabIndex={0}
          className="rich-gif-resize"
          aria-label={t('Resize GIF')}
          aria-orientation="horizontal"
          aria-valuemin={GIF_MIN_WIDTH}
          aria-valuemax={availableWidth}
          aria-valuenow={value}
          aria-valuetext={
            gif.size === 'full' && previewWidth === null ? t('Fill width') : `${value}px`
          }
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
            commit(Math.max(GIF_MIN_WIDTH, Math.min(availableWidth, next)));
          }}
        />
      )}
      {previewWidth !== null && <output className="rich-gif-resize-value">{previewWidth}px</output>}
    </NodeViewWrapper>
  );
}
