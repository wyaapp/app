'use client';
import { ItemOpenButton } from './item-open-button';

import type { Icon } from '@phosphor-icons/react';
import { PushPinIcon } from '@phosphor-icons/react/dist/ssr/PushPin';
import { PushPinSlashIcon } from '@phosphor-icons/react/dist/ssr/PushPinSlash';
import { useTranslation } from '../language-provider';
import { FileItemMenu, type FileRowProps } from './file-item-menu';

export type ExplorerAppShortcut = { id: string; title: string; Icon: Icon; color: string };

/** Fixed applications are launchers, not user documents or movable folders. */
export function FileAppRow({
  app,
  selected,
  onSelect,
  onOpen,
  pinnedTaskbarIds = [],
  onToggleTaskbarPin,
}: {
  app: ExplorerAppShortcut;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  pinnedTaskbarIds?: readonly string[];
  onToggleTaskbarPin?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const Icon = app.Icon;
  const pinned = pinnedTaskbarIds.includes(app.id);
  return (
    <FileItemMenu
      name={app.title}
      editable
      actions={[
        { label: 'Open', icon: <Icon size={16} />, onSelect: onOpen },
        ...(onToggleTaskbarPin
          ? [
              {
                label: pinned ? 'Unpin from taskbar' : 'Pin to taskbar',
                icon: pinned ? <PushPinSlashIcon size={16} /> : <PushPinIcon size={16} />,
                onSelect: () => onToggleTaskbarPin(app.id),
              },
            ]
          : []),
      ]}
      rowProps={
        {
          'data-selected': selected || undefined,
          onContextMenu: onSelect,
          onFocus: (event) => {
            if (event.currentTarget.contains(event.target)) onSelect();
          },
          onClick: (event) => {
            if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node))
              return;
            onSelect();
            if (event.target === event.currentTarget)
              event.currentTarget
                .querySelector<HTMLButtonElement>('.file-open')
                ?.focus({ preventScroll: true });
          },
        } as FileRowProps['rowProps']
      }
    >
      <ItemOpenButton
        className="file-open"
        title={app.title}
        selected={selected}
        onSelect={onSelect}
        onOpen={onOpen}
      >
        <span className={`file-app-icon desktop-app-icon desktop-color-${app.color}`}>
          <Icon weight="duotone" size={24} aria-hidden="true" />
        </span>
        <span className="file-list-name">
          <strong>{app.title}</strong>
        </span>
        <span className="file-list-type">{t('Application')}</span>
        <span className="file-list-status" />
      </ItemOpenButton>
    </FileItemMenu>
  );
}
