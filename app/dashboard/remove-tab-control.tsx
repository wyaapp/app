'use client';
import { useState } from 'react';
import { AlertDialog } from 'radix-ui';
import type { ProfileLayout } from '@/lib/profile-tabs';

export function RemoveTabControl({
  layout,
  sourceId,
  busy,
  onConfirm,
  onReturnFocus,
}: {
  layout: ProfileLayout;
  sourceId: string;
  busy: boolean;
  onConfirm: (targetId: string) => void;
  onReturnFocus: () => void;
}) {
  const [targetId, setTargetId] = useState('');
  const [open, setOpen] = useState(false);
  const source = layout.tabs.find((tab) => tab.id === sourceId);
  const target = layout.tabs.find((tab) => tab.id === targetId && tab.id !== sourceId);
  return (
    <AlertDialog.Root
      open={open && Boolean(source && target)}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <div className="tab-remove">
        <label>
          Move contents to
          <select
            value={target?.id ?? ''}
            disabled={busy}
            onChange={(event) => setTargetId(event.target.value)}
          >
            <option value="">Choose a destination…</option>
            {layout.tabs
              .filter((tab) => tab.id !== sourceId)
              .map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.title || 'Untitled'}
                </option>
              ))}
          </select>
        </label>
        <small>Choosing a destination does not change your layout.</small>
        <AlertDialog.Trigger asChild>
          <button
            type="button"
            className="button button-small button-danger"
            disabled={busy || !target}
          >
            Remove tab…
          </button>
        </AlertDialog.Trigger>
      </div>
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
          <AlertDialog.Title>Remove “{source?.title || 'Untitled'}”?</AlertDialog.Title>
          <AlertDialog.Description>
            All items and sections in <strong>{source?.title || 'Untitled'}</strong> will move to{' '}
            <strong>{target?.title || 'Untitled'}</strong>. No items will be deleted.
            {layout.defaultTabId === sourceId && (
              <span className="remove-item-draft-note">
                {target?.title || 'Untitled'} will become your default tab.
              </span>
            )}
            <span className="remove-item-draft-note">
              This updates your draft. Save layout to publish, or Discard to undo.
            </span>
          </AlertDialog.Description>
          <div className="remove-item-actions">
            <AlertDialog.Cancel asChild>
              <button type="button" className="button button-light" disabled={busy}>
                Keep tab
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                className="button button-danger"
                disabled={busy || !target}
                onClick={() => {
                  if (!busy && target) onConfirm(target.id);
                }}
              >
                Remove tab
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
