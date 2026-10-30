'use client';

import { ToggleGroup } from 'radix-ui';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/ssr/DownloadSimple';
import { LockSimpleIcon } from '@phosphor-icons/react/dist/ssr/LockSimple';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/ssr/UploadSimple';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/ssr/FloppyDisk';
import { useTranslation } from '../language-provider';
import {
  DocumentAppearanceMenu,
  type DocumentAppearanceMenuProps,
} from './document-appearance-menu';

type DocumentEditorToolbarProps<View extends string> = {
  views?: {
    value: View;
    items: readonly { value: View; label: string; readOnly?: boolean }[];
    onChange: (view: View) => void;
    disabled?: boolean;
  };
  onDownload: () => void;
  downloadDisabled?: boolean;
  onSave?: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
  onPublish?: () => void;
  publishDisabled?: boolean;
  publishLabel?: string;
  publishShortLabel?: string;
  appearance?: DocumentAppearanceMenuProps;
};

export function DocumentEditorToolbar<View extends string>({
  views,
  onDownload,
  downloadDisabled,
  onSave,
  saveDisabled,
  saving,
  onPublish,
  publishDisabled,
  publishLabel,
  publishShortLabel,
  appearance,
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
              title={item.readOnly ? t('Read only') : undefined}
            >
              {item.readOnly && <LockSimpleIcon size={14} aria-hidden="true" />}
              {item.label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      ) : null}
      <div className="document-editor-commands">
        {appearance && <DocumentAppearanceMenu {...appearance} />}
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
        {onSave && (
          <button
            type="button"
            className="document-editor-save"
            title={t('Save draft (Ctrl/Cmd+S)')}
            aria-label={t(saving ? 'Saving…' : 'Save draft')}
            onClick={onSave}
            disabled={saveDisabled}
          >
            <FloppyDiskIcon weight="regular" aria-hidden="true" size={16} />
            <span>{t(saving ? 'Saving…' : 'Save')}</span>
          </button>
        )}
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
