'use client';
import { FolderIcon } from '@phosphor-icons/react/dist/ssr/Folder';
import { DesktopIcon } from '@phosphor-icons/react/dist/ssr/Desktop';
import type { SpaceFolder } from '@/lib/space-folders';
import { useTranslation } from '../language-provider';
import { FileItemMenu, type FileRowProps } from './file-item-menu';
export function FolderRow({
  folder,
  editable,
  selected,
  onSelect,
  onOpen,
  actions,
  rowProps,
}: FileRowProps & { folder: SpaceFolder }) {
  const { t } = useTranslation();
  const name = folder.system === 'desktop' ? t('Desktop') : folder.name;
  const Icon = folder.system === 'desktop' ? DesktopIcon : FolderIcon;
  return (
    <FileItemMenu
      name={name}
      editable={editable && !folder.system}
      rowProps={rowProps}
      actions={actions}
    >
      <button
        className="file-open"
        data-drag-preview
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        onDoubleClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            onOpen();
          }
        }}
      >
        <span className="file-document-icon is-folder">
          <Icon weight="regular" size={24} aria-hidden="true" />
        </span>
        <span className="file-list-name">
          <strong>{name}</strong>
          <small>{t('Folder')}</small>
        </span>
      </button>
    </FileItemMenu>
  );
}
