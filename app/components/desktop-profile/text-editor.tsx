'use client';

import { lazy, Suspense, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { TrashIcon } from '@phosphor-icons/react/dist/ssr/Trash';
import { fileBytes, type SpaceFile } from '@/lib/space-files';
import { parseFileDocument, FILE_DOCUMENT_TAB_ID } from '@/lib/file-documents';
import type { LinkItem, Profile } from '@/lib/profile-types';
import type { EditingItem } from '@/app/dashboard/item-editor';
import { useTranslation } from '../language-provider';
import { DocumentEditorToolbar } from '../document-editor/document-toolbar';
import { PageDocument } from '../page-document';
import { FileCardProvider } from '../document-card-context';
import { DocumentItemPanel } from '../document-editor/item-panel';
import type { WyaBlockKind } from '../document-editor/rich-markdown-editor';
import { useFileDraft } from './use-file-draft';
import { documentAppearanceStyle } from '@/lib/document-appearance';
import { useWindowDocumentAppearance } from './document-appearance-context';
import type { useDesktopFiles } from './use-desktop-files';
import type { DesktopOwnerControls } from './owner-controls';

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
  profile,
  registerGuard,
}: {
  file: SpaceFile;
  editable: boolean;
  files: ReturnType<typeof useDesktopFiles>;
  profile: Profile;
  registerGuard?: DesktopOwnerControls['registerDocumentGuard'];
}) {
  return (
    <FileCardProvider fileId={file.id}>
      <TextDocumentEditor
        file={file}
        editable={editable}
        files={files}
        profile={profile}
        registerGuard={registerGuard}
      />
    </FileCardProvider>
  );
}

function TextDocumentEditor({
  file,
  editable,
  files,
  profile,
  registerGuard,
}: {
  file: SpaceFile;
  editable: boolean;
  files: ReturnType<typeof useDesktopFiles>;
  profile: Profile;
  registerGuard?: DesktopOwnerControls['registerDocumentGuard'];
}) {
  const { t } = useTranslation();
  const editor = useFileDraft(file, editable, files.change, files.registerEditor);
  const { draft, saved, error, saving, dirty } = editor;
  useWindowDocumentAppearance(draft.appearance);
  const markdown = /\.md$/i.test(draft.name);
  const [view, setView] = useState<'visual' | 'code'>('visual');
  const [localCopy, setLocalCopy] = useState(false);
  const canEdit = editable || localCopy;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [managing, setManaging] = useState(false);
  const [cardPanel, setCardPanel] = useState<{
    item: EditingItem;
    apply: (item: LinkItem) => void;
    restoreEditor: () => void;
  } | null>(null);
  const validation = useMemo(() => {
    if (!markdown) return { data: null, error: '' };
    try {
      return { data: parseFileDocument(draft.content).data, error: '' };
    } catch (cause) {
      return { data: null, error: (cause as Error).message };
    }
  }, [draft.content, markdown]);
  const documentProfile = validation.data
    ? { ...profile, ...validation.data, name: profile.name, bio: profile.bio, theme: profile.theme }
    : null;
  const registerCardGuard = useCallback(
    (id: string, guard: () => Promise<boolean>) =>
      registerGuard?.(`file-${file.id}-${id}`, guard) ?? (() => {}),
    [file.id, registerGuard],
  );
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
    <div
      className="desktop-text-editor document-appearance-surface"
      style={documentAppearanceStyle(draft.appearance) as CSSProperties}
    >
      <DocumentEditorToolbar<'visual' | 'code'>
        views={
          markdown && canEdit
            ? {
                value: view,
                items: [
                  { value: 'visual', label: t('Visual') },
                  { value: 'code', label: t('Code'), readOnly: true },
                ],
                onChange: setView,
                disabled: managing || !!cardPanel,
              }
            : undefined
        }
        onEditCopy={
          !canEdit
            ? () => {
                setLocalCopy(true);
                setView('visual');
              }
            : undefined
        }
        onDownload={download}
        appearance={
          canEdit
            ? {
                value: draft.appearance,
                onChange: (appearance) => editor.edit({ appearance }),
                disabled: managing || !!cardPanel,
              }
            : undefined
        }
        onPublish={editable ? () => void manage('publish') : undefined}
        publishDisabled={
          managing ||
          saving ||
          !!cardPanel ||
          !!validation.error ||
          (saved.published && !saved.hasChanges && !dirty)
        }
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
      {validation.error && (
        <div className="file-error" role="alert">
          {t(validation.error)}
        </div>
      )}
      {cardPanel && documentProfile && (
        <DocumentItemPanel
          item={cardPanel.item}
          profile={documentProfile}
          baseline={documentProfile}
          tabId={FILE_DOCUMENT_TAB_ID}
          disabled={managing}
          temporary={!editable}
          registerGuard={registerCardGuard}
          onApply={(item) => {
            cardPanel.apply(item);
            cardPanel.restoreEditor();
            setCardPanel(null);
          }}
          onCancel={() => {
            cardPanel.restoreEditor();
            setCardPanel(null);
          }}
        />
      )}
      {markdown && canEdit && (
        <div className="file-editor-visual document-appearance-content" hidden={view !== 'visual'}>
          <Suspense fallback={<p className="rich-editor-loading">{t('Loading…')}</p>}>
            {documentProfile && (
              <RichMarkdownEditor
                source={draft.content}
                onChange={(content) => editor.edit({ content })}
                disabled={managing || !!cardPanel}
                preserveUnknown
                cards={{
                  scope: `${profile.id}:file:${file.id}:${editable ? 'owner' : 'temporary'}`,
                  profile: documentProfile,
                  onEdit: (item, apply, restoreEditor) =>
                    setCardPanel({ item, apply, restoreEditor }),
                  onInsert: (kind, apply, restoreEditor) =>
                    setCardPanel({ item: NEW_CARD[kind], apply, restoreEditor }),
                }}
              />
            )}
          </Suspense>
        </div>
      )}
      {canEdit && (view === 'code' || !markdown) ? (
        <textarea
          className="file-source"
          data-plain-text={!markdown || undefined}
          aria-label={t(markdown ? 'Markdown source' : 'File contents')}
          value={draft.content}
          readOnly={markdown}
          disabled={!markdown && managing}
          spellCheck={false}
          onChange={!markdown ? (event) => editor.edit({ content: event.target.value }) : undefined}
        />
      ) : !canEdit ? (
        <div
          className="file-preview space-typography document-appearance-content"
          data-plain-text={!markdown || undefined}
        >
          {markdown ? (
            documentProfile && (
              <PageDocument
                source={draft.content}
                profile={documentProfile}
                appearance={draft.appearance}
                preserveUnknown
              />
            )
          ) : (
            <pre>{draft.content}</pre>
          )}
          {!markdown && !draft.content && <p className="subtle">{t('This file is empty.')}</p>}
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

const NEW_CARD: Record<WyaBlockKind, EditingItem> = {
  link: 'new',
  project: 'new-project',
  game: 'new-interest',
  collection: 'new-collection',
  discord: 'new-discord',
};
