'use client';

import { lazy, Suspense, useState } from 'react';
import Markdown from 'react-markdown';
import remarkDirective from 'remark-directive';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { TrashIcon } from '@phosphor-icons/react/dist/ssr/Trash';
import { fileBytes, fileLinkUrl, type SpaceFile } from '@/lib/space-files';
import { remarkStrikethrough } from '@/lib/remark-strikethrough';
import { useTranslation } from '../language-provider';
import { DocumentEditorToolbar } from '../document-editor/document-toolbar';
import { GifEmbedView, gifFromMarker, remarkGifEmbeds } from '../gif-embed';
import { useFileDraft } from './use-file-draft';
import type { useDesktopFiles } from './use-desktop-files';

const RichMarkdownEditor = lazy(() =>
  import('../document-editor/rich-markdown-editor').then((module) => ({
    default: module.RichMarkdownEditor,
  })),
);

export function TextEditorWelcome({ onBrowse }: { onBrowse: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="file-empty">
      <FileTextIcon weight="regular" aria-hidden="true" size={36} />
      <h3>{t('Text Editor')}</h3>
      <p>{t('Open a text or Markdown file to get started.')}</p>
      <button className="button" type="button" onClick={onBrowse}>
        <FolderOpenIcon weight="regular" aria-hidden="true" size={18} />
        {t('Browse files')}
      </button>
    </div>
  );
}
export function TextEditor({
  file,
  editable,
  files,
}: {
  file: SpaceFile;
  editable: boolean;
  files: ReturnType<typeof useDesktopFiles>;
}) {
  const { t } = useTranslation();
  const editor = useFileDraft(file, editable, files.change, files.registerEditor);
  const { draft, saved, error, saving, dirty } = editor;
  const markdown = /\.md$/i.test(draft.name);
  const [view, setView] = useState<'visual' | 'code' | 'preview'>(
    editable ? (markdown ? 'visual' : 'code') : 'preview',
  );
  const [localCopy, setLocalCopy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [managing, setManaging] = useState(false);
  async function manage(action: 'publish' | 'unpublish' | 'delete') {
    setManaging(true);
    await editor.manage(action);
    setManaging(false);
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([draft.content], { type: 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = draft.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="desktop-text-editor">
      <DocumentEditorToolbar<'visual' | 'code' | 'preview'>
        views={
          editable || localCopy
            ? {
                value: !markdown && view === 'visual' ? 'code' : view,
                items: [
                  ...(markdown ? [{ value: 'visual' as const, label: t('Visual') }] : []),
                  { value: 'code', label: t(markdown ? 'Code' : 'Edit') },
                  { value: 'preview', label: t('Preview') },
                ],
                onChange: setView,
              }
            : undefined
        }
        onEditCopy={
          !editable && !localCopy
            ? () => {
                setLocalCopy(true);
                setView(markdown ? 'visual' : 'code');
              }
            : undefined
        }
        onDownload={download}
        onPublish={editable ? () => void manage('publish') : undefined}
        publishDisabled={managing || saving || (saved.published && !saved.hasChanges && !dirty)}
        publishLabel={t(saved.published ? 'Publish changes' : 'Publish')}
        publishShortLabel={t('Publish')}
      />
      {error && (
        <div className="file-error" role="alert">
          {t(error)}{' '}
          <button type="button" disabled={saving || managing} onClick={() => void editor.flush()}>
            {t('Retry save')}
          </button>
        </div>
      )}
      {markdown && (editable || localCopy) && (
        <div className="file-editor-visual" hidden={view !== 'visual'}>
          <Suspense fallback={<p className="rich-editor-loading">{t('Loading…')}</p>}>
            <RichMarkdownEditor
              source={draft.content}
              onChange={(content) => editor.edit({ content })}
              disabled={managing}
            />
          </Suspense>
        </div>
      )}
      {(view === 'code' || (!markdown && view === 'visual')) && (editable || localCopy) ? (
        <textarea
          className="file-source"
          aria-label={t('File contents')}
          value={draft.content}
          disabled={managing}
          spellCheck={false}
          onChange={(event) => editor.edit({ content: event.target.value })}
        />
      ) : view === 'preview' || (!editable && !localCopy) ? (
        <div className="file-preview space-typography">
          {markdown ? (
            <Markdown
              remarkPlugins={[
                remarkDirective,
                remarkStrikethrough,
                [remarkGifEmbeds, { preserveUnknown: true }],
              ]}
              skipHtml
              urlTransform={fileLinkUrl}
              components={{
                div: ({ node, children, ...props }) => {
                  const gif = gifFromMarker(node?.properties);
                  return gif ? <GifEmbedView gif={gif} /> : <div {...props}>{children}</div>;
                },
                a: ({ href, children }) =>
                  href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                      {children}
                    </a>
                  ) : (
                    <span>{children}</span>
                  ),
                img: ({ alt }) => <span className="file-image-alt">{alt || t('Image')}</span>,
              }}
            >
              {draft.content}
            </Markdown>
          ) : (
            <pre>{draft.content}</pre>
          )}
          {!draft.content && <p className="subtle">{t('This file is empty.')}</p>}
        </div>
      ) : null}
      {confirmDelete && (
        <div className="file-delete-confirm" role="alert">
          <span>{t('Delete this file? Its published copy will also be removed.')}</span>
          <button type="button" disabled={managing} onClick={() => void manage('delete')}>
            {t('Delete file')}
          </button>
          <button type="button" disabled={managing} onClick={() => setConfirmDelete(false)}>
            {t('Cancel')}
          </button>
        </div>
      )}
      <footer className="file-statusbar">
        <div className="file-status-summary" role="status">
          {editable && (
            <>
              <span>
                {t(
                  saved.published
                    ? saved.hasChanges || dirty
                      ? 'Unpublished changes'
                      : 'Published'
                    : 'Private draft',
                )}
              </span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>
            {t(
              editable
                ? error
                  ? 'Not saved'
                  : saving || managing
                    ? 'Saving…'
                    : dirty
                      ? 'Unsaved changes'
                      : 'All changes saved'
                : localCopy
                  ? 'Temporary copy. Only on this device.'
                  : 'Read only',
            )}
          </span>
        </div>
        <div className="file-status-details">
          <span>{Math.ceil(fileBytes(draft.content) / 1024)} KB</span>
          {editable && (
            <div className="file-toolbar-actions">
              {saved.published && (
                <button
                  type="button"
                  disabled={managing || saving}
                  onClick={() => void manage('unpublish')}
                >
                  {t('Unpublish')}
                </button>
              )}
              <button
                type="button"
                disabled={managing || saving}
                aria-label={t('Delete file')}
                title={t('Delete file')}
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon weight="regular" aria-hidden="true" size={15} />
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
