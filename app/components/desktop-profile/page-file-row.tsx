'use client';
import { ItemOpenButton } from './item-open-button';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { HouseIcon } from '@phosphor-icons/react/dist/ssr/House';
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
      <ItemOpenButton
        className="file-open"
        data-drag-preview
        title={page.name}
        selected={selected}
        onSelect={onSelect}
        onOpen={onOpen}
      >
        <span className="file-document-icon is-page">
          <FileTextIcon weight="duotone" size={24} aria-hidden="true" />
        </span>
        <span className="file-list-name">
          <strong>{page.name}</strong>
        </span>
        <span className="file-list-type">{t('Markdown page')}</span>
        <span className="file-list-status">
          {editable && page.hidden && <span>{t('Hidden')}</span>}
          {page.pinned && <HouseIcon weight="duotone" size={14} aria-label={t('On Home')} />}
        </span>
      </ItemOpenButton>
    </FileItemMenu>
  );
}
