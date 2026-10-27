'use client';

import { FolderIcon } from '@phosphor-icons/react/dist/ssr/Folder';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { HouseIcon } from '@phosphor-icons/react/dist/ssr/House';
import { TrashIcon } from '@phosphor-icons/react/dist/ssr/Trash';
import { folderTrail, type SpaceFolder } from '@/lib/space-folders';
import { useTranslation } from '../language-provider';
import type { DesktopDrag } from './use-desktop-drag';

export function FileSidebar({
  folders,
  folderId,
  busy,
  onNavigate,
  dropTarget,
  onTrash,
  trashSelected = false,
  trashCount = 0,
}: {
  folders: SpaceFolder[];
  folderId: string | null;
  busy: boolean;
  onNavigate: (id: string | null) => void;
  dropTarget: (id: string | null, key: string) => ReturnType<DesktopDrag['target']>;
  onTrash?: () => void;
  trashSelected?: boolean;
  trashCount?: number;
}) {
  const { t, locale } = useTranslation();
  const home = folders.find((folder) => folder.system === 'desktop');
  const roots = folders
    .filter((folder) => !folder.parentId && !folder.system)
    .sort((a, b) => a.name.localeCompare(b.name, locale, { numeric: true }));
  const trail = folderTrail(folders, folderId);
  return (
    <nav className="file-sidebar" aria-label={t('Locations')}>
      <h3>{t('Locations')}</h3>
      <button
        type="button"
        disabled={busy}
        aria-current={!trashSelected && !folderId ? 'location' : undefined}
        onClick={() => onNavigate(null)}
        {...dropTarget(null, 'sidebar-root')}
      >
        <FolderOpenIcon weight="duotone" size={18} aria-hidden="true" />
        <span>{t('All files')}</span>
      </button>
      {home && (
        <button
          type="button"
          disabled={busy}
          aria-current={!trashSelected && folderId === home.id ? 'location' : undefined}
          data-ancestor={
            (!trashSelected &&
              folderId !== home.id &&
              trail.some((folder) => folder.id === home.id)) ||
            undefined
          }
          onClick={() => onNavigate(home.id)}
          {...dropTarget(home.id, 'sidebar-home')}
        >
          <HouseIcon weight="duotone" size={18} aria-hidden="true" />
          <span>{t('Home')}</span>
        </button>
      )}
      {onTrash && (
        <button
          type="button"
          disabled={busy}
          aria-current={trashSelected ? 'location' : undefined}
          onClick={onTrash}
        >
          <TrashIcon weight="duotone" size={18} aria-hidden="true" />
          <span>{t('Trash')}</span>
          <small className="file-sidebar-count">{trashCount}</small>
        </button>
      )}
      {roots.length > 0 && <h3>{t('Folders')}</h3>}
      {roots.map((folder) => (
        <button
          key={folder.id}
          type="button"
          disabled={busy}
          title={folder.name}
          aria-current={!trashSelected && folderId === folder.id ? 'location' : undefined}
          data-ancestor={
            (!trashSelected &&
              folderId !== folder.id &&
              trail.some((part) => part.id === folder.id)) ||
            undefined
          }
          onClick={() => onNavigate(folder.id)}
          {...dropTarget(folder.id, `sidebar-${folder.id}`)}
        >
          <FolderIcon weight="duotone" size={18} aria-hidden="true" />
          <span>{folder.name}</span>
        </button>
      ))}
    </nav>
  );
}
