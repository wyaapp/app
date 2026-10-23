'use client';

import { lazy, Suspense, useState } from 'react';
import Markdown from 'react-markdown';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/ssr/DownloadSimple';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { TrashIcon } from '@phosphor-icons/react/dist/ssr/Trash';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/ssr/UploadSimple';
import { fileBytes, fileLinkUrl, type SpaceFile } from '@/lib/space-files';
import { useTranslation } from '../language-provider';
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
      <div className="file-editor-heading">
        {editable ? (
          <label>
            {t('Filename')}
            <input
              aria-label={t('Filename')}
              value={draft.name}
              disabled={managing}
              maxLength={100}
              onChange={(event) => editor.edit({ name: event.target.value })}
            />
          </label>
        ) : (
          <strong>{file.name}</strong>
        )}
        {editable && (
          <span className="file-state">
            {t(
              saved.published
                ? saved.hasChanges || dirty
                  ? 'Unpublished changes'
                  : 'Published'
                : 'Private draft',
            )}
          </span>
        )}
      </div>
      <div className="file-toolbar">
        <div className="file-toolbar-actions">
          {(editable || localCopy) && (
            <div className="file-view-tabs" aria-label={t('Document view')}>
              {markdown && (
                <button
                  type="button"
                  aria-pressed={view === 'visual'}
                  onClick={() => setView('visual')}
                >
                  {t('Visual')}
                </button>
              )}
              <button
                type="button"
                aria-pressed={view === 'code' || (!markdown && view === 'visual')}
                onClick={() => setView('code')}
              >
                {t(markdown ? 'Code' : 'Edit')}
              </button>
              <button
                type="button"
                aria-pressed={view === 'preview'}
                onClick={() => setView('preview')}
              >
                {t('Preview')}
              </button>
            </div>
          )}
          {!editable && !localCopy && (
            <button
              type="button"
              onClick={() => {
                setLocalCopy(true);
                setView(markdown ? 'visual' : 'code');
              }}
            >
              {t('Edit a copy')}
            </button>
          )}
          <button type="button" onClick={download}>
            <DownloadSimpleIcon weight="regular" aria-hidden="true" size={16} />
            {t('Download')}
          </button>
        </div>
        {editable && (
          <div className="file-toolbar-actions">
            <button
              type="button"
              className="file-publish"
              disabled={managing || saving || (saved.published && !saved.hasChanges && !dirty)}
              onClick={() => void manage('publish')}
            >
              <UploadSimpleIcon weight="regular" aria-hidden="true" size={16} />
              {t(saved.published ? 'Publish changes' : 'Publish')}
            </button>
          </div>
        )}
      </div>
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
              skipHtml
              urlTransform={fileLinkUrl}
              components={{
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
        <span role="status">
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
      </footer>
    </div>
  );
}
