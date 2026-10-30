'use client';

import { useRef, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import { useTranslation } from '../language-provider';

/** A focused modal form, independent of the retired desktop/window manager. */
export function DocumentItemDialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="document-item-overlay" />
        <Dialog.Content
          className="document-item-dialog"
          ref={content}
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const field = content.current?.querySelector<HTMLElement>(
              'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
            );
            (field ?? content.current)?.focus({ preventScroll: true });
          }}
        >
          <header className="document-item-dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <button type="button" aria-label={t('Close')} onClick={onClose}>
              <XIcon size={22} />
            </button>
          </header>
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
