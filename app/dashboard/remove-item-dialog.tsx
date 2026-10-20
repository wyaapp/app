'use client';
import { useTranslation } from '@/app/components/language-provider';

import { itemLabel } from '@/lib/item-label';
import { AlertDialog } from 'radix-ui';
import type { LinkItem } from '@/lib/model';

export function RemoveItemDialog({
  item,
  busy,
  error,
  hasLayoutDraft,
  onCancel,
  onConfirm,
  onReturnFocus,
}: {
  item: LinkItem | null;
  busy: boolean;
  error: string;
  hasLayoutDraft: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  onReturnFocus: () => void;
}) {
  const { t } = useTranslation();
  const kind =
    item?.kind === 'discord'
      ? t('Discord widget')
      : item?.kind === 'collection'
        ? t('Game Collection')
        : item?.kind === 'project'
          ? t('project')
          : item?.kind === 'interest'
            ? t(item.interest?.type ?? 'item')
            : t('link');
  return (
    <AlertDialog.Root
      open={Boolean(item)}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="icon-dialog-overlay" />
        <AlertDialog.Content
          className="icon-dialog remove-item-dialog"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
        >
          <AlertDialog.Title>
            {t('Remove') + ' '}
            {kind}?
          </AlertDialog.Title>
          <AlertDialog.Description>
            <strong>{item ? itemLabel(item) : ''}</strong>{' '}
            {' ' +
              t(
                'will be removed from your profile, and its short URL and aliases will stop working.',
              )}{' '}
            {item?.collection && 'All games inside it and their short URLs will also be removed. '}
            {t('You can restore it from history.')}
            {hasLayoutDraft && (
              <span className="remove-item-draft-note">
                {t(
                  'Your other layout changes will stay unsaved. You can save or discard them afterward.',
                )}
              </span>
            )}
          </AlertDialog.Description>
          {error && (
            <p className="message error" role="alert">
              {t(error)}
            </p>
          )}
          <div className="remove-item-actions">
            <AlertDialog.Cancel asChild>
              <button type="button" className="button button-light" disabled={busy}>
                {t('Keep it')}
              </button>
            </AlertDialog.Cancel>
            <button
              type="button"
              className="button button-danger"
              disabled={busy}
              onClick={() => void onConfirm()}
            >
              {busy ? t('Removing…') : t('Remove {type}', { type: kind })}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
