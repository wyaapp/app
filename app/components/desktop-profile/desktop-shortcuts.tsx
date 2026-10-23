'use client';

import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { desktopAppId, desktopItem, type DesktopItem } from '@/lib/desktop-items';
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
}: {
  apps: DesktopShortcut[];
  drag: DesktopDrag;
  busy: boolean;
  onOpen: (id: string) => void;
  onReorder: (id: string, target: string) => void;
  onUnpin?: (id: string) => void;
  onMoveToFolder?: (item: DesktopItem, folderId: string) => void;
  canMoveToFolder?: (item: DesktopItem, folderId: string) => boolean;
}) {
  const { t } = useTranslation();
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
