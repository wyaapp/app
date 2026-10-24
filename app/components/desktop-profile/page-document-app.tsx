'use client';

import { lazy, Suspense, useMemo, useState } from 'react';
import { getPageSource, MAX_PAGE_DOCUMENT_BYTES } from '@/lib/page-documents';
import { compilePageDocument } from '@/lib/page-document-actions';
import { pageDocumentName } from '@/lib/space-page-files';
import type { LinkItem, Profile } from '@/lib/profile-types';
import type { EditingItem } from '@/app/dashboard/item-editor';
import { DocumentItemPanel } from '../document-editor/item-panel';
import { DocumentEditorToolbar } from '../document-editor/document-toolbar';
import type { WyaBlockKind } from '../document-editor/rich-markdown-editor';
import type { ProfileTab } from '@/lib/profile-tabs';
import { PageDocument } from '../page-document';
import { useTranslation } from '../language-provider';
import type { DesktopOwnerControls } from './owner-controls';
import { usePageDraft } from './use-page-draft';

const RichMarkdownEditor = lazy(() =>
  import('../document-editor/rich-markdown-editor').then((module) => ({
    default: module.RichMarkdownEditor,
  })),
);
const NEW_CARD: Record<WyaBlockKind, EditingItem> = {
  link: 'new',
  project: 'new-project',
  game: 'new-interest',
  collection: 'new-collection',
  discord: 'new-discord',
};

export function PageDocumentApp({
  profile,
  tab,
  owner,
  preview,
}: {
  profile: Profile;
  tab: ProfileTab;
  owner?: DesktopOwnerControls;
  preview: boolean;
}) {
  const { t } = useTranslation();
  const editable = !!owner && !owner.visitor;
  const published = getPageSource(profile, tab);
  const draft = usePageDraft({
    spaceId: profile.id,
    tabId: tab.id,
    published,
    editable,
    registerGuard: owner?.registerDocumentGuard,
  });
  const [view, setView] = useState<'visual' | 'source' | 'preview'>('visual');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [cardPanel, setCardPanel] = useState<{
    item: EditingItem;
    apply: (item: LinkItem) => void;
  } | null>(null);
  const source = editable ? draft.source : published;
  const validation = useMemo(() => {
    if (!editable || source === published) return { error: '', profile };
    try {
      return {
        error: '',
        profile: { ...profile, ...compilePageDocument(profile, tab.id, source) },
      };
    } catch (error) {
      return { error: (error as Error).message, profile };
    }
  }, [editable, source, published, profile, tab.id]);
  // An incomplete title or Code edit must not make previously edited cards revert visually.
  const [lastValidProfile, setLastValidProfile] = useState(profile);
  if (!validation.error && lastValidProfile !== validation.profile)
    setLastValidProfile(validation.profile);
  const draftProfile = validation.error ? lastValidProfile : validation.profile;
  const disabled = publishing || !!owner?.busy || !draft.ready;

  function download() {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = pageDocumentName(tab.title);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function publish() {
    if (!owner || disabled || validation.error || draft.conflict || !draft.dirty) return;
    setPublishing(true);
    setPublishError(false);
    const saved = await owner.publishDocument(tab.id, source, profile.version);
    if (saved) {
      draft.reset(source);
      setView('visual');
    } else setPublishError(true);
    setPublishing(false);
  }

  if (!editable)
    return (
      <div className="page-document-content">
        <PageDocument source={published} profile={profile} preview={preview} />
      </div>
    );

  return (
    <div className="desktop-page-document">
      <DocumentEditorToolbar<'visual' | 'source' | 'preview'>
        views={{
          value: view,
          items: [
            { value: 'visual', label: t('Visual') },
            { value: 'source', label: t('Code') },
            { value: 'preview', label: t('Preview') },
          ],
          onChange: setView,
          disabled: publishing || !!cardPanel,
        }}
        onDownload={download}
        downloadDisabled={!draft.ready}
        onPublish={() => void publish()}
        publishDisabled={
          disabled || !!cardPanel || !draft.dirty || !!validation.error || draft.conflict
        }
        publishLabel={t(publishing ? 'Publishing…' : 'Publish changes')}
        publishShortLabel={t(publishing ? 'Publishing…' : 'Publish')}
      />
      {draft.dirty && (
        <div className="page-document-notice" role="status">
          <span>
            {t(
              draft.conflict
                ? 'This page changed after you started this draft. Download your draft before discarding it and starting again.'
                : draft.durable
                  ? 'Unpublished draft saved on this device.'
                  : 'Your draft could not be saved on this device. Keep this window open, publish it, or download a copy.',
            )}
          </span>
          <button
            type="button"
            disabled={publishing || !!cardPanel}
            onClick={() => setConfirmDiscard(true)}
          >
            {t('Discard draft')}
          </button>
        </div>
      )}
      {confirmDiscard && (
        <div className="page-document-notice" role="alert">
          <span>{t('Discard your unpublished changes?')}</span>
          <button
            type="button"
            onClick={() => {
              draft.reset();
              setConfirmDiscard(false);
              setPublishError(false);
            }}
          >
            {t('Discard draft')}
          </button>
          <button type="button" onClick={() => setConfirmDiscard(false)}>
            {t('Cancel')}
          </button>
        </div>
      )}
      {publishError && (
        <p className="page-document-error" role="alert">
          {t('Could not publish this page. Your draft is still here.')}
        </p>
      )}
      {validation.error && (
        <p className="page-document-error" role="alert">
          {t(validation.error)}
        </p>
      )}
      {cardPanel && (
        <DocumentItemPanel
          item={cardPanel.item}
          profile={draftProfile}
          baseline={profile}
          tabId={tab.id}
          disabled={disabled}
          registerGuard={owner?.registerDocumentGuard}
          onApply={(item) => {
            cardPanel.apply(item);
            setCardPanel(null);
          }}
          onCancel={() => setCardPanel(null)}
        />
      )}
      <div className="page-document-visual" hidden={view !== 'visual' || !!cardPanel}>
        {draft.ready && (
          <Suspense fallback={<p className="rich-editor-loading">{t('Loading…')}</p>}>
            <RichMarkdownEditor
              source={source}
              onChange={(next) => {
                draft.edit(next);
                setPublishError(false);
              }}
              disabled={disabled || !!cardPanel}
              cards={{
                profile: draftProfile,
                onEdit: (item, apply) => setCardPanel({ item, apply }),
                onInsert: (kind, apply) => setCardPanel({ item: NEW_CARD[kind], apply }),
              }}
            />
          </Suspense>
        )}
      </div>
      {view === 'source' && (
        <textarea
          className="page-document-source"
          aria-label={t('Markdown source')}
          value={source}
          disabled={disabled}
          maxLength={MAX_PAGE_DOCUMENT_BYTES}
          spellCheck={false}
          onChange={(event) => {
            draft.edit(event.target.value);
            setPublishError(false);
          }}
        />
      )}
      {view === 'preview' && (
        <div className="page-document-content">
          {!validation.error && (
            <PageDocument source={source} profile={validation.profile} preview />
          )}
        </div>
      )}
      <footer className="page-document-status">
        <span>{pageDocumentName(tab.title)}</span>
        <span>{t(draft.dirty ? 'Unpublished changes' : 'Published')}</span>
      </footer>
    </div>
  );
}
