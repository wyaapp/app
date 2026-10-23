'use client';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { DesktopIcon } from '@phosphor-icons/react/dist/ssr/Desktop';
import type { SpacePageFile } from '@/lib/space-page-files';
import { useTranslation } from '../language-provider';
import { FileItemMenu, type FileRowProps } from './file-item-menu';
export function PageFileRow({
  page,
  editable,
  menuEnabled,
  selected,
  onSelect,
  onOpen,
  actions,
  rowProps,
}: FileRowProps & { page: SpacePageFile }) {
  const { t } = useTranslation();
  return (
    <FileItemMenu
      name={page.name}
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
        <span className="file-document-icon is-page">
          <FileTextIcon weight="regular" size={24} aria-hidden="true" />
        </span>
        <span className="file-list-name">
          <strong>{page.name}</strong>
          <small>{t('Markdown page')}</small>
        </span>
        <span className="file-list-status">
          {editable && page.hidden && <span>{t('Hidden')}</span>}
          {page.pinned && <DesktopIcon weight="regular" size={14} aria-label={t('On Desktop')} />}
        </span>
      </button>
    </FileItemMenu>
  );
}
