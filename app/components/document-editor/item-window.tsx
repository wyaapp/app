'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { DesktopWindow } from '../desktop-profile/desktop-window';
import { useDesktopWindow } from '../desktop-profile/window-context';
import type { Point } from '../desktop-profile/window-state';

/** An owned editor window: the document stays mounted underneath the dialog. */
export function DocumentItemWindow({
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
  const host = useDesktopWindow();
  const hostRef = useRef(host);
  const [mount, setMount] = useState<{ container: HTMLElement; position: Point } | null>(null);
  const content = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    hostRef.current = host;
  });
  useLayoutEffect(() => {
    const parent = hostRef.current;
    const area = parent?.workspace.current;
    const source = parent?.node.current;
    const container = area?.parentElement;
    if (!area || !source || !container) return;
    const bounds = area.getBoundingClientRect();
    const document = source.getBoundingClientRect();
    const width = Math.min(560, bounds.width - 32);
    const height = Math.min(640, bounds.height - 48);
    const right = document.right - bounds.left + 16;
    const left = document.left - bounds.left - width - 16;
    const x =
      right + width <= bounds.width - 16
        ? right
        : left >= 16
          ? left
          : Math.max(16, Math.min(document.left - bounds.left + 48, bounds.width - width - 16));
    const y = Math.max(16, Math.min(document.top - bounds.top + 24, bounds.height - height - 16));
    setMount({ container, position: { x, y } });
  }, []);

  if (!host || !mount) return null;
  return (
    <Dialog.Root open={host.open} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal container={mount.container}>
        <Dialog.Overlay className="document-item-overlay" />
        <Dialog.Content
          ref={content}
          className="document-item-dialog"
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const field = content.current?.querySelector<HTMLElement>(
              'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
            );
            (field ?? content.current)?.focus({ preventScroll: true });
          }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">
            {host.title}. {description}
          </Dialog.Description>
          <DesktopWindow
            id={`${host.id}-card-editor`}
            title={title}
            category="content"
            icon={<PencilSimpleIcon weight="regular" aria-hidden="true" size={17} />}
            controls="dialog"
            index={0}
            position={mount.position}
            onPositionChange={(position) =>
              setMount((current) => current && { ...current, position })
            }
            open={host.open}
            active
            maximized={false}
            layer={host.layer + 0.5}
            workspace={host.workspace}
            onFocus={host.onFocus}
            onHide={onClose}
            onMaximize={() => {}}
            className="desktop-card-window"
          >
            {children}
          </DesktopWindow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
