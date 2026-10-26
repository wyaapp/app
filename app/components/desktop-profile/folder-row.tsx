'use client';
import { ItemOpenButton } from './item-open-button';
import { FolderIcon } from '@phosphor-icons/react/dist/ssr/Folder';
import { HouseIcon } from '@phosphor-icons/react/dist/ssr/House';
import type { SpaceFolder } from '@/lib/space-folders';
import { useTranslation } from '../language-provider';
import { FileItemMenu, type FileRowProps } from './file-item-menu';
export function FolderRow({
  folder,
  editable,
  menuEnabled,
  selected,
  onSelect,
  onOpen,
  actions,
  rowProps,
}: FileRowProps & { folder: SpaceFolder }) {
  const { t } = useTranslation();
  const name = folder.system === 'desktop' ? t('Home') : folder.name;
  const Icon = folder.system === 'desktop' ? HouseIcon : FolderIcon;
  return (
    <FileItemMenu
      name={name}
      editable={menuEnabled ?? (editable && !folder.system)}
      rowProps={rowProps}
      actions={actions}
    >
      <ItemOpenButton
        className="file-open"
        data-drag-preview
        title={name}
        selected={selected}
        onSelect={onSelect}
        onOpen={onOpen}
      >
        <span className="file-document-icon is-folder">
          <Icon weight="duotone" size={24} aria-hidden="true" />
        </span>
        <span className="file-list-name">
          <strong>{name}</strong>
        </span>
        <span className="file-list-type">{t('Folder')}</span>
        <span className="file-list-status" />
      </ItemOpenButton>
    </FileItemMenu>
  );
}
