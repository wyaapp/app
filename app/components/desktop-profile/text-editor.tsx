'use client';

import { lazy, Suspense, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { TrashIcon } from '@phosphor-icons/react/dist/ssr/Trash';
import { fileBytes, type SpaceFile } from '@/lib/space-files';
import { getFileFormat, isRichTextFile } from '@/lib/file-formats';
import { parseWidgetSource } from '@/lib/widget-files';
import { parseFileDocument, FILE_DOCUMENT_TAB_ID } from '@/lib/file-documents';
import type { LinkItem, Profile } from '@/lib/profile-types';
import type { EditingItem } from '@/app/dashboard/item-editor';
import { useTranslation } from '../language-provider';
import { DocumentEditorToolbar } from '../document-editor/document-toolbar';
import { PageDocument } from '../page-document';
import { WidgetView } from './widget-view';
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
  onCreateWidget,
}: {
  file: SpaceFile;
  editable: boolean;
  files: ReturnType<typeof useDesktopFiles>;
  profile: Profile;
  registerGuard?: DesktopOwnerControls['registerDocumentGuard'];
  onCreateWidget?: (source: string) => Promise<void>;
}) {
  return (
    <FileCardProvider fileId={file.id} publishedLinks={profile.links}>
      <TextDocumentEditor
        file={file}
        editable={editable}
        files={files}
        profile={profile}
        registerGuard={registerGuard}
        onCreateWidget={onCreateWidget}
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
  onCreateWidget,
}: {
  file: SpaceFile;
  editable: boolean;
  files: ReturnType<typeof useDesktopFiles>;
  profile: Profile;
  registerGuard?: DesktopOwnerControls['registerDocumentGuard'];
  onCreateWidget?: (source: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const editor = useFileDraft(file, profile.id, editable, files.change, files.registerEditor);
  const { draft, saved, error, saving, dirty } = editor;
  useWindowDocumentAppearance(draft.appearance);
  const widget = getFileFormat(draft.name) === 'widget';
  const markdown = isRichTextFile(draft.name);
  const [view, setView] = useState<'preview' | 'visual' | 'code'>(() =>
    getFileFormat(file.name) === 'widget' && file.content.trim() ? 'preview' : 'visual',
  );
  const currentView = !widget && view === 'preview' ? 'visual' : view;
  const [localCopy, setLocalCopy] = useState(false);
  const canEdit = (editable || localCopy) && !editor.recovery;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [managing, setManaging] = useState(false);
  const [cardPanel, setCardPanel] = useState<{
    item: EditingItem;
    apply: (item: LinkItem) => void;
    restoreEditor: () => void;
  } | null>(null);
  const validation = useMemo(() => {
    if (!markdown) return { data: null, widget: null, error: '' };
    try {
      return {
        data: parseFileDocument(draft.content).data,
        widget: widget ? parseWidgetSource(draft.content) : null,
        error: '',
      };
    } catch (cause) {
      return { data: null, widget: null, error: (cause as Error).message };
    }
  }, [draft.content, markdown, widget]);
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
  async function convertToMarkdown() {
    setManaging(true);
    const renamed = await editor.rename(draft.name.replace(/\.widget$/i, '.md'));
    if (renamed) setView('visual');
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
      data-widget={widget || undefined}
      style={documentAppearanceStyle(draft.appearance) as CSSProperties}
      onKeyDownCapture={(event) => {
        if (editable && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat && !managing && !saving && !cardPanel && !editor.recovery)
            void editor.save();
        }
      }}
    >
      <DocumentEditorToolbar<'preview' | 'visual' | 'code'>
        views={
          markdown && canEdit
            ? {
                value: currentView,
                items: [
                  ...(widget ? [{ value: 'preview' as const, label: t('Preview') }] : []),
                  { value: 'visual', label: t(widget ? 'Edit' : 'Visual') },
                  { value: 'code', label: t('Code'), readOnly: true },
                ],
                onChange: setView,
                disabled: managing || !!cardPanel,
              }
            : undefined
        }
        onEditCopy={
          !editable && !localCopy
            ? () => {
                setLocalCopy(true);
                setView('visual');
              }
            : undefined
        }
        onDownload={download}
        onSave={editable ? () => void editor.save() : undefined}
        saveDisabled={saving || managing || !dirty || !!cardPanel || !!editor.recovery}
        saving={saving}
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
          !!editor.recovery ||
          saving ||
          !!cardPanel ||
          !!validation.error ||
          (widget && !validation.widget) ||
          (saved.published && !saved.hasChanges && !dirty)
        }
        publishLabel={t(saved.published ? 'Publish changes' : 'Publish')}
        publishShortLabel={t('Publish')}
      />
      {editor.recovery && (
        <div className="file-error" role="status">
          <p>
            {t(
              editor.recovery.conflict
                ? 'Unsaved changes were found on this device. The server copy has changed too. Recover the local draft to review it before saving.'
                : 'Unsaved changes were found on this device. Recover them to continue editing. Nothing is sent until you save or publish.',
            )}
          </p>
          <button
            type="button"
            disabled={saving || managing}
            onClick={() => void editor.restoreRecovery()}
          >
            {t('Recover draft')}
          </button>{' '}
          <button type="button" disabled={saving || managing} onClick={editor.discardRecovery}>
            {t('Discard recovered draft')}
          </button>
        </div>
      )}
      {error && (
        <div className="file-error" role="alert">
          {t(error)}{' '}
          <button type="button" disabled={saving || managing} onClick={() => void editor.save()}>
            {t('Retry save')}
          </button>
          {dirty && (
            <button type="button" onClick={download}>
              {t('Download unsaved copy')}
            </button>
          )}
        </div>
      )}
      {editor.localError && (
        <div className="file-error" role="alert">
          {t(editor.localError)}{' '}
          <button type="button" onClick={download}>
            {t('Download unsaved copy')}
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
      {markdown && canEdit && (!widget || currentView === 'visual') && (
        <div
          className="file-editor-visual document-appearance-content"
          hidden={currentView !== 'visual'}
        >
          <Suspense fallback={<p className="rich-editor-loading">{t('Loading…')}</p>}>
            {documentProfile && (
              <RichMarkdownEditor
                key={widget ? 'widget' : 'markdown'}
                source={draft.content}
                onChange={(content) => editor.edit({ content })}
                disabled={managing || !!cardPanel}
                preserveUnknown
                widgetOnly={widget}
                onCreateWidget={editable && !widget ? onCreateWidget : undefined}
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
      {widget && (currentView === 'preview' || !canEdit) ? (
        <div className="widget-window-content document-appearance-content">
          {validation.widget ? (
            <WidgetView
              block={validation.widget}
              profile={documentProfile ?? profile}
              preview={editable || localCopy}
            />
          ) : !validation.error ? (
            <div className="file-empty">
              <p>{t('This widget is empty.')}</p>
              {canEdit && (
                <button type="button" onClick={() => setView('visual')}>
                  {t('Edit widget')}
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : canEdit && (currentView === 'code' || !markdown) ? (
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
          <span>
            {t(
              'Move this file to Trash? Its published copy will be hidden. You can restore it later as a private draft.',
            )}
          </span>
          <button type="button" disabled={managing} onClick={() => void manage('delete')}>
            {t('Move to Trash')}
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
                ? editor.recovery
                  ? 'Local draft available'
                  : error
                    ? 'Not saved'
                    : saving || managing
                      ? 'Saving…'
                      : dirty
                        ? 'Unsaved changes · on this device'
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
              {widget && (
                <button
                  type="button"
                  disabled={managing || saving || !!cardPanel || !!editor.recovery}
                  onClick={() => void convertToMarkdown()}
                >
                  {t('Convert to Markdown')}
                </button>
              )}
              {saved.published && (
                <button
                  type="button"
                  disabled={managing || saving || !!editor.recovery}
                  onClick={() => void manage('unpublish')}
                >
                  {t('Unpublish')}
                </button>
              )}
              <button
                type="button"
                disabled={managing || saving || !!editor.recovery}
                aria-label={t('Move to Trash')}
                title={t('Move to Trash')}
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
