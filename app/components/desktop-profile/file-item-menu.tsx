'use client';

import { useRef, type ReactNode, type HTMLAttributes, type Ref } from 'react';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/ssr/DotsThree';
import { ContextMenu, DropdownMenu } from 'radix-ui';
import { useTranslation } from '../language-provider';

export type ItemAction = {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  opensForm?: boolean;
  afterClose?: () => void;
  onSelect: () => void;
};
export type FileRowProps = {
  editable: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  actions: ItemAction[];
  rowProps?: HTMLAttributes<HTMLLIElement> & { ref?: Ref<HTMLLIElement> };
};
export function FileItemMenu({
  name,
  editable,
  actions,
  hint,
  children,
  rowProps,
  className = 'file-row',
  showActionButton = true,
}: {
  name: string;
  editable: boolean;
  actions: ItemAction[];
  hint?: string;
  children: ReactNode;
  rowProps?: HTMLAttributes<HTMLLIElement> & { ref?: Ref<HTMLLIElement> };
  className?: string;
  showActionButton?: boolean;
}) {
  const { t } = useTranslation();
  const opensForm = useRef(false);
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const touchPress = useRef(false);
  const consumeTouchClick = useRef(false);
  function restoreFocus(event: Event) {
    if (opensForm.current) event.preventDefault();
    afterClose.current?.();
    opensForm.current = false;
    afterClose.current = undefined;
  }
  const menuLabel = t('Actions for {name}', { name });
  function items(context = false) {
    const Item = context ? ContextMenu.Item : DropdownMenu.Item;
    return (
      <>
        {actions.map((action) => (
          <Item
            key={action.label}
            disabled={action.disabled}
            onSelect={() => {
              opensForm.current = Boolean(action.opensForm);
              afterClose.current = action.afterClose;
              action.onSelect();
            }}
          >
            {action.icon}
            {t(action.label)}
          </Item>
        ))}
        {hint && <p className="file-menu-hint">{t(hint)}</p>}
      </>
    );
  }
  return (
    <ContextMenu.Root
      onOpenChange={(open) => {
        if (open && touchPress.current) consumeTouchClick.current = true;
      }}
    >
      <ContextMenu.Trigger asChild disabled={!editable}>
        <li
          className={className}
          {...rowProps}
          onPointerDownCapture={(event) => {
            rowProps?.onPointerDownCapture?.(event);
            touchPress.current = event.pointerType !== 'mouse';
            consumeTouchClick.current = false;
          }}
          onPointerUpCapture={(event) => {
            rowProps?.onPointerUpCapture?.(event);
            touchPress.current = false;
          }}
          onPointerCancelCapture={(event) => {
            rowProps?.onPointerCancelCapture?.(event);
            touchPress.current = false;
          }}
          onClickCapture={(event) => {
            // A touch long press opens the menu, not the item under the finger.
            if (consumeTouchClick.current && event.detail > 0) {
              consumeTouchClick.current = false;
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            rowProps?.onClickCapture?.(event);
          }}
          onKeyDown={(event) => {
            rowProps?.onKeyDown?.(event);
            if (
              !editable ||
              event.defaultPrevented ||
              !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
            )
              return;
            // Some browsers do not emit contextmenu for these keyboard keys.
            // Send it through Radix's trigger so positioning and focus stay shared.
            event.preventDefault();
            event.stopPropagation();
            touchPress.current = false;
            const bounds = event.currentTarget.getBoundingClientRect();
            event.currentTarget.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: bounds.left + bounds.width / 2,
                clientY: bounds.bottom,
              }),
            );
          }}
        >
          {children}
          {editable && showActionButton && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="file-actions-trigger" type="button" aria-label={menuLabel}>
                  <DotsThreeIcon weight="regular" size={20} aria-hidden="true" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="file-actions-menu"
                  align="end"
                  sideOffset={5}
                  collisionPadding={12}
                  aria-label={menuLabel}
                  onCloseAutoFocus={restoreFocus}
                >
                  {items()}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </li>
      </ContextMenu.Trigger>
      {editable && (
        <ContextMenu.Portal>
          <ContextMenu.Content
            className="file-actions-menu"
            collisionPadding={12}
            aria-label={menuLabel}
            onCloseAutoFocus={restoreFocus}
          >
            {items(true)}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      )}
    </ContextMenu.Root>
  );
}
