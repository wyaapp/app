'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { allItems } from '@/lib/collections';
import { applyDocumentItemDraft } from '@/lib/document-item-draft';
import type { LinkItem, Profile } from '@/lib/profile-types';
import { ItemEditor, itemEditorTitle, type EditingItem } from '@/app/dashboard/item-editor';
import { useTranslation } from '../language-provider';
import { useFileCardId } from '../document-card-context';
import { DocumentItemDialog } from './item-dialog';

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
  const fileId = useFileCardId();
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
    const unregister = registerGuard(`card-panel-${fileId ?? tabId ?? 'document'}`, async () => {
      if (!dirty.current) return true;
      if (confirmation.current) return confirmation.current.promise;
      let resolve!: (value: boolean) => void;
      const promise = new Promise<boolean>((finish) => {
        resolve = finish;
      });
      confirmation.current = { promise, resolve };
      setConfirmDiscard(true);
      return promise;
    });
    return () => {
      unregister();
      confirmation.current?.resolve(false);
      confirmation.current = null;
    };
  }, [registerGuard, tabId, fileId]);
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
    if (disabled || pending.current) return;
    if (applied.current || !dirty.current) onCancel();
    else setConfirmDiscard(true);
  }

  function discard() {
    dirty.current = false;
    confirmation.current?.resolve(true);
    confirmation.current = null;
    onCancel();
  }

  const description = t('Changes stay in this draft until you publish the document.');

  return (
    <DocumentItemDialog
      title={t(itemEditorTitle(editing))}
      description={description}
      onClose={close}
    >
      <section
        className="document-item-panel"
        aria-label={t(itemEditorTitle(editing))}
        onInputCapture={() => markDirty()}
      >
        <header className="document-item-panel-heading">
          <p>{description}</p>
        </header>
        {error && (
          <p className="message error" role="alert">
            {t(error)}
          </p>
        )}
        <ItemEditor
          key={typeof item === 'string' ? item : (item.id ?? item.slug)}
          presentation="dialog"
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
          discardConfirmation={
            confirmDiscard
              ? {
                  message: t('Discard unapplied card changes?'),
                  onDiscard: discard,
                  onKeepEditing: () => {
                    confirmation.current?.resolve(false);
                    confirmation.current = null;
                    setConfirmDiscard(false);
                  },
                }
              : null
          }
          onOpenSetupGuide={onOpenSetupGuide}
        />
      </section>
    </DocumentItemDialog>
  );
}
