'use client';
import { useTranslation } from '@/app/components/language-provider';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

export const EntryManualDirtyContext = createContext<((dirty: boolean) => void) | null>(null);
export type EntryDiscardConfirmation = {
  message: string;
  onDiscard: () => void;
  onKeepEditing: () => void;
};
export const EntryDiscardConfirmationContext = createContext<EntryDiscardConfirmation | null>(null);

// Card forms update the document draft only after an explicit Apply action.
export function useEntryDraft(payload: Record<string, unknown>) {
  const onDirtyChange = useContext(EntryManualDirtyContext);
  const serialized = JSON.stringify(payload);
  const [initialPayload] = useState(serialized);
  useEffect(() => {
    onDirtyChange?.(serialized !== initialPayload);
  }, [onDirtyChange, serialized, initialPayload]);
}

export function EntryManualActions({
  busy,
  disabled = false,
  form,
  onCancel,
}: {
  busy: boolean;
  disabled?: boolean;
  form?: string;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const confirmation = useContext(EntryDiscardConfirmationContext);
  const prompt = useRef<HTMLDivElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const confirming = confirmation !== null;
  useEffect(() => {
    if (confirming) {
      prompt.current?.scrollIntoView({ block: 'nearest' });
      keepEditing.current?.focus({ preventScroll: true });
    } else if (wasConfirming.current) {
      cancel.current?.focus({ preventScroll: true });
    }
    wasConfirming.current = confirming;
  }, [confirming]);
  if (confirmation) {
    return (
      <div ref={prompt} className="entry-discard-confirmation" role="alert">
        <p>{confirmation.message}</p>
        <div className="catalog-selection-actions">
          <button
            className="button button-small"
            type="button"
            disabled={busy}
            onClick={confirmation.onDiscard}
          >
            {t('Discard changes')}
          </button>
          <button
            ref={keepEditing}
            className="text-link"
            type="button"
            disabled={busy}
            onClick={confirmation.onKeepEditing}
          >
            {t('Keep editing')}
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      <button type="submit" form={form} className="button button-dark" disabled={busy || disabled}>
        {t('Apply changes')}
      </button>
      <button ref={cancel} type="button" className="text-link" disabled={busy} onClick={onCancel}>
        {t('Cancel')}
      </button>
    </>
  );
}
