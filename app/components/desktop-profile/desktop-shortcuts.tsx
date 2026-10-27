'use client';

import type { CSSProperties } from 'react';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/ssr/SlidersHorizontal';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { PushPinIcon } from '@phosphor-icons/react/dist/ssr/PushPin';
import { PushPinSlashIcon } from '@phosphor-icons/react/dist/ssr/PushPinSlash';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import {
  desktopAppId,
  desktopItem,
  desktopShortcutLabel,
  type DesktopItem,
} from '@/lib/desktop-items';
import { isRenameShortcut, useDesktopPreferences } from '@/lib/desktop-preferences';
import { useTranslation } from '../language-provider';
import { FileItemMenu } from './file-item-menu';
import { ItemOpenButton } from './item-open-button';
import type { DesktopDrag } from './use-desktop-drag';
import { DESKTOP_ICON, type IconPoint, type IconPositions } from '@/lib/desktop-icon-layout';

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
  freePositions,
  snapToGrid,
  surfaceWidth,
  overflowing,
  onPositionChange,
  onArrange,
  drag,
  busy,
  selectedId,
  onSelect,
  onOpen,
  onReorder,
  onUnpin,
  onMoveToFolder,
  canMoveToFolder,
  pinnedTaskbarIds = [],
  onToggleTaskbarPin,
  onRename,
  canRename,
  onProperties,
}: {
  apps: DesktopShortcut[];
  freePositions?: IconPositions;
  snapToGrid: boolean;
  surfaceWidth: number;
  overflowing: boolean;
  onPositionChange: (id: string, point: IconPoint) => void;
  onArrange: () => void;
  drag: DesktopDrag;
  busy: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
  onReorder: (id: string, target: string) => void;
  onUnpin?: (id: string) => void;
  onMoveToFolder?: (item: DesktopItem, folderId: string) => void;
  canMoveToFolder?: (item: DesktopItem, folderId: string) => boolean;
  pinnedTaskbarIds?: readonly string[];
  onToggleTaskbarPin?: (id: string) => void;
  onRename?: (id: string) => void;
  canRename?: (id: string) => boolean;
  onProperties?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { renameShortcut, showFileExtensions } = useDesktopPreferences();
  return (
    <nav
      aria-label={t('Home apps')}
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          (event.target as HTMLElement).closest('.desktop-shortcut-open')
        ) {
          event.stopPropagation();
          onSelect(null);
        }
      }}
    >
      <ul
        className="desktop-shortcuts"
        data-free-position={!!freePositions || undefined}
        data-icon-layout={freePositions ? (snapToGrid ? 'grid' : 'free') : 'auto'}
        data-overflow={overflowing || undefined}
        style={
          {
            '--shortcut-surface-width': `${surfaceWidth}px`,
          } as CSSProperties
        }
      >
        {apps.map(({ id, title, filename, folderId, Icon, color }, index) => (
          <FileItemMenu
            key={id}
            name={filename ?? title}
            editable
            showActionButton={false}
            hint={freePositions ? 'Alt + arrow keys to move.' : undefined}
            className="desktop-shortcut"
            rowProps={{
              style: freePositions?.[id]
                ? { left: freePositions[id].x, top: freePositions[id].y }
                : undefined,
              onPointerDown: () => onSelect(id),
              ...drag.combine(
                drag.source(desktopItem(id), !busy),
                drag.target(
                  `shortcut-${id}`,
                  (item) =>
                    !busy &&
                    desktopAppId(item) !== id &&
                    (Boolean(folderId && onMoveToFolder && canMoveToFolder?.(item, folderId)) ||
                      (!freePositions && apps.some((app) => app.id === desktopAppId(item)))),
                  (item) => {
                    if (folderId && onMoveToFolder && canMoveToFolder?.(item, folderId)) {
                      onMoveToFolder(item, folderId);
                    } else {
                      onReorder(desktopAppId(item), id);
                    }
                  },
                ),
              ),
              onContextMenu: () => onSelect(id),
            }}
            actions={[
              {
                label: 'Open',
                icon: <Icon weight="regular" aria-hidden="true" size={16} />,
                onSelect: () => onOpen(id),
                disabled: busy,
              },
              ...(onProperties && desktopItem(id).kind === 'file'
                ? [
                    {
                      label: 'Properties',
                      icon: <SlidersHorizontalIcon size={16} aria-hidden="true" />,
                      onSelect: () => onProperties(id),
                      disabled: busy,
                      opensForm: true,
                    },
                  ]
                : []),
              ...(freePositions
                ? [
                    {
                      label: 'Arrange icons',
                      icon: <SquaresFourIcon size={16} aria-hidden="true" />,
                      disabled: busy,
                      onSelect: onArrange,
                    },
                  ]
                : []),
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
              ...(!freePositions
                ? [
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
                  ]
                : []),
              ...(onUnpin &&
              (id.startsWith('tab-') || id.startsWith('file-') || id.startsWith('folder-'))
                ? [
                    {
                      label: 'Move out of Home',
                      icon: <FolderOpenIcon weight="regular" aria-hidden="true" size={16} />,
                      disabled: busy,
                      onSelect: () => onUnpin(id),
                    },
                  ]
                : []),
            ]}
          >
            <ItemOpenButton
              className="desktop-shortcut-open"
              data-drag-preview
              title={filename ?? title}
              selected={selectedId === id}
              onSelect={() => onSelect(id)}
              onOpen={() => onOpen(id)}
              disabled={busy}
              onKeyDown={(event) => {
                if (
                  freePositions?.[id] &&
                  !busy &&
                  event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  event.key.startsWith('Arrow')
                ) {
                  const direction = {
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    ArrowUp: [0, -1],
                    ArrowDown: [0, 1],
                  }[event.key];
                  if (direction) {
                    event.preventDefault();
                    event.stopPropagation();
                    const point = freePositions[id];
                    const step = event.shiftKey ? 1 : 10;
                    onPositionChange(id, {
                      x:
                        point.x +
                        direction[0] * (snapToGrid ? DESKTOP_ICON.width + DESKTOP_ICON.gap : step),
                      y:
                        point.y +
                        direction[1] * (snapToGrid ? DESKTOP_ICON.height + DESKTOP_ICON.gap : step),
                    });
                    return;
                  }
                }
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
              aria-keyshortcuts={
                freePositions ? 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown' : undefined
              }
            >
              <span className={`desktop-app-icon desktop-color-${color}`}>
                <Icon weight="duotone" aria-hidden="true" size={28} />
              </span>
              <span>{desktopShortcutLabel(id, filename ?? title, showFileExtensions)}</span>
            </ItemOpenButton>
          </FileItemMenu>
        ))}
      </ul>
    </nav>
  );
}
