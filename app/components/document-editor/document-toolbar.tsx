'use client';

import { ToggleGroup } from 'radix-ui';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/ssr/DownloadSimple';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/ssr/UploadSimple';
import { useTranslation } from '../language-provider';

type DocumentEditorToolbarProps<View extends string> = {
  views?: {
    value: View;
    items: readonly { value: View; label: string }[];
    onChange: (view: View) => void;
    disabled?: boolean;
  };
  onDownload: () => void;
  downloadDisabled?: boolean;
  onPublish?: () => void;
  publishDisabled?: boolean;
  publishLabel?: string;
  publishShortLabel?: string;
  onEditCopy?: () => void;
  editCopyLabel?: string;
};

export function DocumentEditorToolbar<View extends string>({
  views,
  onDownload,
  downloadDisabled,
  onPublish,
  publishDisabled,
  publishLabel,
  publishShortLabel,
  onEditCopy,
  editCopyLabel,
}: DocumentEditorToolbarProps<View>) {
  const { t } = useTranslation();
  return (
    <div className="document-editor-toolbar">
      {views ? (
        <ToggleGroup.Root
          type="single"
          className="document-editor-views"
          aria-label={t('Document view')}
          value={views.value}
          disabled={views.disabled}
          orientation="horizontal"
          loop
          onValueChange={(value) => {
            const selected = views.items.find((item) => item.value === value);
            if (selected) views.onChange(selected.value);
          }}
        >
          {views.items.map((item) => (
            <ToggleGroup.Item
              key={item.value}
              type="button"
              className="document-editor-view"
              value={item.value}
            >
              {item.label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      ) : onEditCopy ? (
        <button type="button" className="document-editor-edit-copy" onClick={onEditCopy}>
          {editCopyLabel ?? t('Edit a copy')}
        </button>
      ) : null}
      <div className="document-editor-commands">
        <button
          type="button"
          className="document-editor-download"
          aria-label={t('Download')}
          title={t('Download')}
          onClick={onDownload}
          disabled={downloadDisabled}
        >
          <DownloadSimpleIcon weight="regular" aria-hidden="true" size={16} />
          <span className="document-editor-command-label">{t('Download')}</span>
        </button>
        {onPublish && (
          <button
            type="button"
            className="document-editor-publish"
            aria-label={publishLabel ?? t('Publish changes')}
            title={publishLabel ?? t('Publish changes')}
            onClick={onPublish}
            disabled={publishDisabled}
          >
            <UploadSimpleIcon weight="regular" aria-hidden="true" size={16} />
            <span className="document-editor-command-label" aria-hidden="true">
              {publishLabel ?? t('Publish changes')}
            </span>
            <span className="document-editor-publish-short" aria-hidden="true">
              {publishShortLabel ?? t('Publish')}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
