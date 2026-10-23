'use client';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { DesktopIcon } from '@phosphor-icons/react/dist/ssr/Desktop';
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
  return (
    <FileItemMenu
      name={file.name}
      editable={menuEnabled ?? editable}
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
        <span className={`file-document-icon ${/\.md$/i.test(file.name) ? 'is-markdown' : ''}`}>
          <FileTextIcon weight="regular" size={24} aria-hidden="true" />
        </span>
        <span className="file-list-name">
          <strong>{file.name}</strong>
          <small>
            {/\.md$/i.test(file.name) ? 'Markdown' : t('Plain text')} ·{' '}
            {Math.ceil(file.size / 1024)} KB
          </small>
        </span>
        <span className="file-list-status">
          {editable && (
            <span>
              {t(
                file.published ? (file.hasChanges ? 'Unpublished changes' : 'Published') : 'Draft',
              )}
            </span>
          )}
          {file.pinned && <DesktopIcon weight="regular" size={14} aria-label={t('On Desktop')} />}
        </span>
      </button>
    </FileItemMenu>
  );
}
