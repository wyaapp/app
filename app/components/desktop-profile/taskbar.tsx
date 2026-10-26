'use client';

import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { MinusIcon } from '@phosphor-icons/react/dist/ssr/Minus';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import { PushPinIcon } from '@phosphor-icons/react/dist/ssr/PushPin';
import { PushPinSlashIcon } from '@phosphor-icons/react/dist/ssr/PushPinSlash';
import { useTranslation } from '../language-provider';
import { FileItemMenu } from './file-item-menu';
import { taskbarItems } from './taskbar-items';
import type { WindowState } from './window-state';

export type TaskbarPinControls = {
  pinnedTaskbarIds: readonly string[];
  onToggleTaskbarPin: (id: string) => void;
};

export function DesktopTaskbarApps({
  entries,
  windows,
  active,
  pinnedTaskbarIds,
  onToggleTaskbarPin,
  onOpen,
  onMinimize,
  onClose,
  onFocusFallback,
  buttonRef,
}: TaskbarPinControls & {
  entries: { id: string; title: string; Icon: PhosphorIcon; pinnable?: boolean }[];
  windows: WindowState;
  active?: string;
  onOpen: (id: string) => void;
  onMinimize: (id: string) => void;
  onClose: (id: string) => void;
  onFocusFallback: () => void;
  buttonRef: (id: string, node: HTMLButtonElement | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav className="desktop-taskbar-apps" aria-label={t('Taskbar apps')}>
      <ul className="desktop-dock">
        {taskbarItems(entries, pinnedTaskbarIds, windows.running).map(
          ({ id, title, Icon, pinnable }) => {
            const pinned = pinnedTaskbarIds.includes(id);
            const running = windows.running.includes(id);
            const visible = windows.order.includes(id);
            return (
              <FileItemMenu
                key={id}
                name={title}
                className="desktop-dock-item"
                editable
                showActionButton={false}
                actions={[
                  {
                    label: 'Open',
                    icon: <Icon size={16} aria-hidden="true" />,
                    onSelect: () => {},
                    afterClose: () => onOpen(id),
                  },
                  ...(running && visible
                    ? [
                        {
                          label: 'Minimize',
                          icon: <MinusIcon size={16} aria-hidden="true" />,
                          onSelect: () => {},
                          opensForm: true,
                          afterClose: () => onMinimize(id),
                        },
                      ]
                    : []),
                  ...(running
                    ? [
                        {
                          label: 'Close',
                          icon: <XIcon size={16} aria-hidden="true" />,
                          onSelect: () => {},
                          opensForm: true,
                          afterClose: () => onClose(id),
                        },
                      ]
                    : []),
                  ...(pinnable !== false
                    ? [
                        {
                          label: pinned ? 'Unpin from taskbar' : 'Pin to taskbar',
                          icon: pinned ? (
                            <PushPinSlashIcon size={16} aria-hidden="true" />
                          ) : (
                            <PushPinIcon size={16} aria-hidden="true" />
                          ),
                          opensForm: pinned && !running,
                          onSelect: () => {},
                          afterClose: () => {
                            if (pinned && !running) onFocusFallback();
                            onToggleTaskbarPin(id);
                          },
                        },
                      ]
                    : []),
                ]}
              >
                <button
                  type="button"
                  ref={(node) => buttonRef(id, node)}
                  onClick={() => (active === id ? onMinimize(id) : onOpen(id))}
                  aria-label={title}
                  aria-pressed={active === id}
                  aria-controls={running ? `desktop-${id}` : undefined}
                  className={running ? 'is-open' : ''}
                  title={pinned ? `${title} (${t('Pinned')})` : title}
                  data-pinned={pinned || undefined}
                >
                  <Icon weight="duotone" aria-hidden="true" size={19} />
                  <span>{title}</span>
                </button>
              </FileItemMenu>
            );
          },
        )}
      </ul>
    </nav>
  );
}
