'use client';
import { useTranslation } from '@/app/components/language-provider';

import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react';
import { EntryAutosave, type AutosaveStatus } from '@/lib/entry-autosave';

export type FlushEntry = () => Promise<boolean>;
export const EntryAutosaveContext = createContext<((flush: FlushEntry | null) => void) | null>(
  null,
);
export const EntrySaveModeContext = createContext<'automatic' | 'manual'>('automatic');
export const EntryManualDirtyContext = createContext<((dirty: boolean) => void) | null>(null);
export type EntryDiscardConfirmation = {
  message: string;
  onDiscard: () => void;
  onKeepEditing: () => void;
};
export const EntryDiscardConfirmationContext = createContext<EntryDiscardConfirmation | null>(null);

export function useEntryAutosave({
  enabled,
  payload,
  busy,
  form,
  onSave,
  valid = true,
}: {
  valid?: boolean;
  enabled: boolean;
  payload: Record<string, unknown>;
  busy: boolean;
  form: RefObject<HTMLFormElement | null>;
  onSave: (data: Record<string, unknown>) => Promise<boolean>;
}) {
  const register = useContext(EntryAutosaveContext);
  const manual = useContext(EntrySaveModeContext) === 'manual';
  const onDirtyChange = useContext(EntryManualDirtyContext);
  const [status, setStatus] = useState<AutosaveStatus>('saved');
  const [queue] = useState(
    () =>
      new EntryAutosave(payload, {
        save: async () => false,
        valid: () => false,
        status: setStatus,
      }),
  );
  const serialized = JSON.stringify(payload);
  const [initialPayload] = useState(serialized);
  useEffect(() => {
    if (manual) onDirtyChange?.(serialized !== initialPayload);
  }, [manual, onDirtyChange, serialized, initialPayload]);
  useEffect(() => {
    queue.configure({
      save: onSave,
      valid: () =>
        valid &&
        !!form.current &&
        Array.from(form.current.elements).every(
          (element) => !('validity' in element) || (element as HTMLInputElement).validity.valid,
        ),
    });
  });
  useEffect(() => {
    if (enabled && !manual) queue.update(JSON.parse(serialized), busy);
    return () => queue.cancel();
  }, [enabled, manual, serialized, busy, queue]);
  useEffect(() => {
    if (!enabled || manual) return;
    register?.(async () => {
      const saved = await queue.flush();
      if (!saved) form.current?.reportValidity();
      return saved;
    });
    const warn = (event: BeforeUnloadEvent) => {
      if (queue.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      register?.(null);
      queue.cancel();
      window.removeEventListener('beforeunload', warn);
    };
  }, [enabled, manual, register, queue, form]);
  return {
    status,
    manual,
    flush: () => (manual ? Promise.resolve(true) : queue.flush()),
    discard: () => queue.discard(),
  };
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

export function EntrySaveStatus({
  status,
  onRetry,
  onDiscard,
}: {
  status: AutosaveStatus;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const canDiscard = status === 'invalid' || status === 'error' || status === 'pending';
  return (
    <div className="entry-save-status">
      <span role="status">
        {t(
          {
            saved: 'All changes saved',
            pending: 'Unsaved changes…',
            saving: 'Saving…',
            invalid: 'Complete the fields to save',
            error: 'Changes not saved',
          }[status],
        )}
      </span>
      <div className="entry-save-actions">
        <button
          type="button"
          className="text-link"
          style={{ visibility: status === 'error' ? 'visible' : 'hidden' }}
          disabled={status !== 'error'}
          onClick={onRetry}
        >
          {t('Retry')}
        </button>
        <button
          type="button"
          className="text-link"
          style={{ visibility: canDiscard ? 'visible' : 'hidden' }}
          disabled={!canDiscard}
          onClick={onDiscard}
        >
          {t('Discard unsaved')}
        </button>
      </div>
    </div>
  );
}
