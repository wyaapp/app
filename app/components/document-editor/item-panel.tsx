'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { allItems } from '@/lib/collections';
import { applyDocumentItemDraft } from '@/lib/document-item-draft';
import type { LinkItem, Profile } from '@/lib/profile-types';
import { ItemEditor, itemEditorTitle, type EditingItem } from '@/app/dashboard/item-editor';
import { useTranslation } from '../language-provider';

type DocumentItemPanelProps = {
  item: EditingItem;
  profile: Profile;
  baseline: Profile;
  tabId?: string;
  onApply: (item: LinkItem) => void;
  onCancel: () => void;
  disabled?: boolean;
  onOpenSetupGuide?: () => void;
  registerGuard?: (id: string, guard: () => Promise<boolean>) => () => void;
};

/** Existing forms edit one local card; publishing the document is the only write boundary. */
export function DocumentItemPanel(props: DocumentItemPanelProps) {
  return (
    <ItemDraftPanel
      key={typeof props.item === 'string' ? props.item : (props.item.id ?? props.item.slug)}
      {...props}
    />
  );
}

function ItemDraftPanel({
  item,
  profile: initialProfile,
  baseline: initialBaseline,
  tabId,
  onApply,
  onCancel,
  disabled = false,
  onOpenSetupGuide,
  registerGuard,
}: DocumentItemPanelProps) {
  const { t } = useTranslation();
  // Collection forms retain child ID references. Keep their compiled draft snapshot
  // stable until this panel closes instead of replacing generated preview IDs mid-edit.
  const [{ profile, baseline }] = useState(() => ({
    profile: initialProfile,
    baseline: initialBaseline,
  }));
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = useRef(false);
  const applied = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const confirmation = useRef<{
    promise: Promise<boolean>;
    resolve: (value: boolean) => void;
  } | null>(null);
  const pending = useRef(false);
  const markDirty = useCallback((changed = true) => {
    if (changed) dirty.current = true;
  }, []);
  useEffect(() => {
    if (!registerGuard) return;
    const unregister = registerGuard(`card-panel-${tabId ?? 'document'}`, async () => {
      if (!dirty.current) return true;
      if (confirmation.current) return confirmation.current.promise;
      let resolve!: (value: boolean) => void;
      const promise = new Promise<boolean>((finish) => {
        resolve = finish;
      });
      confirmation.current = { promise, resolve };
      setConfirmDiscard(true);
      panel.current?.focus({ preventScroll: true });
      return promise;
    });
    return () => {
      unregister();
      confirmation.current?.resolve(false);
      confirmation.current = null;
    };
  }, [registerGuard, tabId]);
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  // The compiled projection provides normalized URLs and temporary collection child IDs.
  // The local action helper removes every ID that does not belong to the saved baseline.
  const editing =
    typeof item === 'object'
      ? (profile.links.find(
          (candidate) =>
            candidate.kind === item.kind &&
            ((item.id && candidate.id === item.id) ||
              candidate.slug === item.slug.trim().toLowerCase()),
        ) ?? item)
      : item;

  async function apply(payload: Record<string, unknown>) {
    if (disabled || pending.current) return false;
    pending.current = true;
    setApplying(true);
    setError('');
    try {
      const next = applyDocumentItemDraft(profile, baseline, payload, tabId);
      onApply(next);
      applied.current = true;
      dirty.current = false;
      confirmation.current?.resolve(true);
      confirmation.current = null;
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this card.');
      return false;
    } finally {
      pending.current = false;
      setApplying(false);
    }
  }

  function close() {
    if (applied.current || !dirty.current) onCancel();
    else setConfirmDiscard(true);
  }

  function discard() {
    dirty.current = false;
    confirmation.current?.resolve(true);
    confirmation.current = null;
    onCancel();
  }

  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="document-item-panel"
      aria-label={t(itemEditorTitle(editing))}
      onInputCapture={() => markDirty()}
    >
      <header className="document-item-panel-heading">
        <h3>{t(itemEditorTitle(editing))}</h3>
        <p>{t('Changes stay in this draft until you publish the document.')}</p>
      </header>
      {error && (
        <p className="message error" role="alert">
          {t(error)}
        </p>
      )}
      {confirmDiscard && (
        <div className="document-item-confirm" role="alert">
          <p>{t('Discard unapplied card changes?')}</p>
          <div className="catalog-selection-actions">
            <button
              className="button button-small"
              type="button"
              disabled={applying}
              onClick={discard}
            >
              {t('Discard changes')}
            </button>
            <button
              className="text-link"
              type="button"
              onClick={() => {
                confirmation.current?.resolve(false);
                confirmation.current = null;
                setConfirmDiscard(false);
              }}
            >
              {t('Keep editing')}
            </button>
          </div>
        </div>
      )}
      <ItemEditor
        key={typeof item === 'string' ? item : (item.id ?? item.slug)}
        presentation="window"
        saveMode="manual"
        item={editing}
        handle={profile.handle}
        existingSlugs={allItems(profile.links).flatMap((entry) => [
          entry.slug,
          ...(entry.aliases ?? []),
        ])}
        busy={disabled || applying}
        onSave={apply}
        onClose={close}
        onDirtyChange={markDirty}
        onOpenSetupGuide={onOpenSetupGuide}
      />
    </section>
  );
}
