'use client';

import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { PushPinIcon } from '@phosphor-icons/react/dist/ssr/PushPin';
import { PushPinSlashIcon } from '@phosphor-icons/react/dist/ssr/PushPinSlash';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { desktopAppId, desktopItem, type DesktopItem } from '@/lib/desktop-items';
import { isRenameShortcut, useDesktopPreferences } from '@/lib/desktop-preferences';
import { useTranslation } from '../language-provider';
import { FileItemMenu } from './file-item-menu';
import type { DesktopDrag } from './use-desktop-drag';

export type DesktopShortcut = {
  id: string;
  title: string;
  filename?: string;
  folderId?: string;
  Icon: PhosphorIcon;
  color: string;
};

export function DesktopShortcuts({
  apps,
  drag,
  busy,
  onOpen,
  onReorder,
  onUnpin,
  onMoveToFolder,
  canMoveToFolder,
  pinnedTaskbarIds = [],
  onToggleTaskbarPin,
  onRename,
  canRename,
}: {
  apps: DesktopShortcut[];
  drag: DesktopDrag;
  busy: boolean;
  onOpen: (id: string) => void;
  onReorder: (id: string, target: string) => void;
  onUnpin?: (id: string) => void;
  onMoveToFolder?: (item: DesktopItem, folderId: string) => void;
  canMoveToFolder?: (item: DesktopItem, folderId: string) => boolean;
  pinnedTaskbarIds?: readonly string[];
  onToggleTaskbarPin?: (id: string) => void;
  onRename?: (id: string) => void;
  canRename?: (id: string) => boolean;
}) {
  const { t } = useTranslation();
  const { renameShortcut } = useDesktopPreferences();
  return (
    <nav aria-label={t('Desktop apps')}>
      <ul className="desktop-shortcuts">
        {apps.map(({ id, title, filename, folderId, Icon, color }, index) => (
          <FileItemMenu
            key={id}
            name={filename ?? title}
            editable
            showActionButton={false}
            className="desktop-shortcut"
            rowProps={drag.combine(
              drag.source(desktopItem(id), !busy),
              drag.target(
                `shortcut-${id}`,
                (item) =>
                  !busy &&
                  desktopAppId(item) !== id &&
                  (Boolean(folderId && onMoveToFolder && canMoveToFolder?.(item, folderId)) ||
                    apps.some((app) => app.id === desktopAppId(item))),
                (item) => {
                  if (folderId && onMoveToFolder && canMoveToFolder?.(item, folderId)) {
                    onMoveToFolder(item, folderId);
                  } else {
                    onReorder(desktopAppId(item), id);
                  }
                },
              ),
            )}
            actions={[
              {
                label: 'Open',
                icon: <Icon weight="regular" aria-hidden="true" size={16} />,
                onSelect: () => onOpen(id),
              },
              ...(onRename && (canRename?.(id) ?? true)
                ? [
                    {
                      label: 'Rename',
                      icon: <PencilSimpleIcon size={16} aria-hidden="true" />,
                      disabled: busy,
                      opensForm: true,
                      onSelect: () => onRename(id),
                    },
                  ]
                : []),
              ...(onToggleTaskbarPin
                ? [
                    {
                      label: pinnedTaskbarIds.includes(id)
                        ? 'Unpin from taskbar'
                        : 'Pin to taskbar',
                      icon: pinnedTaskbarIds.includes(id) ? (
                        <PushPinSlashIcon size={16} aria-hidden="true" />
                      ) : (
                        <PushPinIcon size={16} aria-hidden="true" />
                      ),
                      onSelect: () => onToggleTaskbarPin(id),
                    },
                  ]
                : []),
              {
                label: 'Move earlier',
                icon: <ArrowLeftIcon weight="regular" aria-hidden="true" size={16} />,
                disabled: busy || index === 0,
                onSelect: () => onReorder(id, apps[index - 1].id),
              },
              {
                label: 'Move later',
                icon: <ArrowRightIcon weight="regular" aria-hidden="true" size={16} />,
                disabled: busy || index === apps.length - 1,
                onSelect: () => onReorder(id, apps[index + 1].id),
              },
              ...(onUnpin &&
              (id.startsWith('tab-') || id.startsWith('file-') || id.startsWith('folder-'))
                ? [
                    {
                      label: 'Move out of Desktop',
                      icon: <FolderOpenIcon weight="regular" aria-hidden="true" size={16} />,
                      disabled: busy,
                      onSelect: () => onUnpin(id),
                    },
                  ]
                : []),
            ]}
          >
            <button
              className="desktop-shortcut-open"
              data-drag-preview
              type="button"
              onClick={() => onOpen(id)}
              onKeyDown={(event) => {
                if (
                  busy ||
                  !onRename ||
                  !(canRename?.(id) ?? true) ||
                  !isRenameShortcut(event.nativeEvent, renameShortcut)
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                onRename(id);
              }}
              aria-controls={`desktop-${folderId ? 'files' : id}`}
            >
              <span className={`desktop-app-icon desktop-color-${color}`}>
                <Icon weight="regular" aria-hidden="true" size={28} />
              </span>
              <span>{filename ?? title}</span>
            </button>
          </FileItemMenu>
        ))}
      </ul>
    </nav>
  );
}
