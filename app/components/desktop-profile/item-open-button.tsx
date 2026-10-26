'use client';

import { useRef, type ButtonHTMLAttributes } from 'react';
import { createItemActivation } from '@/lib/item-activation';

type Props = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'onDoubleClick' | 'onSelect' | 'aria-pressed'
> & {
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
};

/** Shared activation for Home shortcuts and every kind of Files entry. */
export function ItemOpenButton({
  selected,
  onSelect,
  onOpen,
  onKeyDown,
  onFocus,
  onBlur,
  onPointerDown,
  onPointerCancel,
  onContextMenu,
  ...props
}: Props) {
  const activation = useRef(createItemActivation());
  return (
    <button
      {...props}
      type="button"
      aria-pressed={selected}
      onPointerDown={(event) => {
        activation.current.pointerDown(event.pointerType);
        onPointerDown?.(event);
      }}
      onPointerCancel={(event) => {
        activation.current.cancel();
        onPointerCancel?.(event);
      }}
      onContextMenu={(event) => {
        activation.current.cancel();
        onContextMenu?.(event);
      }}
      onFocus={(event) => {
        onSelect();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        activation.current.cancel();
        onBlur?.(event);
      }}
      onClick={(event) => {
        onSelect();
        if (activation.current.click(event, selected)) onOpen();
      }}
      onDoubleClick={() => {
        if (activation.current.doubleClick()) onOpen();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          activation.current.cancel();
          if (!event.repeat) onOpen();
        }
      }}
    />
  );
}
