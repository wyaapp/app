'use client';
import { ItemOpenButton } from './item-open-button';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { getFileFormat, isRichTextFile } from '@/lib/file-formats';
import { HouseIcon } from '@phosphor-icons/react/dist/ssr/House';
import type { SpaceFileInfo } from '@/lib/space-files';
import { useTranslation } from '../language-provider';
import { FileItemMenu, type FileRowProps } from './file-item-menu';
export function FileRow({
  file,
  editable,
  menuEnabled,
  selected,
  onSelect,
  onOpen,
  actions,
  rowProps,
}: FileRowProps & { file: SpaceFileInfo }) {
  const { t } = useTranslation();
  const format = getFileFormat(file.name);
  const Icon = format === 'widget' ? SquaresFourIcon : FileTextIcon;
  return (
    <FileItemMenu
      name={file.name}
      editable={menuEnabled ?? editable}
      rowProps={rowProps}
      actions={actions}
    >
      <ItemOpenButton
        className="file-open"
        data-drag-preview
        title={file.name}
        selected={selected}
        onSelect={onSelect}
        onOpen={onOpen}
      >
        <span className={`file-document-icon ${isRichTextFile(file.name) ? 'is-markdown' : ''}`}>
          <Icon weight="duotone" size={24} aria-hidden="true" />
        </span>
        <span className="file-list-name">
          <strong>{file.name}</strong>
          <small>{Math.ceil(file.size / 1024)} KB</small>
        </span>
        <span className="file-list-type">
          {format === 'widget' ? t('Widget') : format === 'markdown' ? 'Markdown' : t('Plain text')}
        </span>
        <span className="file-list-status">
          {editable && (
            <span
              title={t(
                file.published ? (file.hasChanges ? 'Unpublished changes' : 'Published') : 'Draft',
              )}
            >
              {t(
                file.published ? (file.hasChanges ? 'Unpublished changes' : 'Published') : 'Draft',
              )}
            </span>
          )}
          {file.pinned && <HouseIcon weight="duotone" size={14} aria-label={t('On Home')} />}
        </span>
      </ItemOpenButton>
    </FileItemMenu>
  );
}
