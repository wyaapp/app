'use client';

import { useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { ClipboardPaste } from 'lucide-react';
import { useTranslation } from '../components/language-provider';
import { CLIPBOARD_LIMIT, parseClipboard, prepareContentPaste } from '@/lib/content-clipboard';
import { itemLabel } from '@/lib/item-label';
import type { ActiveWorkspace } from './use-workspace';
import type { ContentClipboard } from './use-content-clipboard';

export function ContentClipboardDialog({
  clipboard,
  workspace,
}: {
  clipboard: ContentClipboard;
  workspace: ActiveWorkspace;
}) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const dialog = clipboard.dialog;
  if (!dialog) return null;
  const { profile, activeProfileTab, layoutChanged, newProfileTab, editing } = workspace;
  const copying = dialog.mode === 'copy';
  const blocked =
    layoutChanged || newProfileTab
      ? 'Save or discard layout changes before pasting.'
      : typeof editing === 'string'
        ? 'Finish or cancel your new item before pasting.'
        : '';
  const parsed = (() => {
    if (copying || !dialog.text) return null;
    try {
      const content = parseClipboard(JSON.parse(dialog.text));
      return {
        content,
        preview: prepareContentPaste(profile, content, activeProfileTab.id, dialog.sectionId),
      };
    } catch (error) {
      return {
        error:
          error instanceof SyntaxError
            ? 'Copy an item or section from Wya first.'
            : error instanceof Error
              ? error.message
              : 'Could not paste content.',
      };
    }
  })();
  const error = blocked || dialog.error || parsed?.error || workspace.error;
  const busy = submitting || workspace.busy;
  const target = dialog.sectionId
    ? activeProfileTab.sections.find((section) => section.id === dialog.sectionId)?.title
    : activeProfileTab.title;
  async function paste() {
    if (!parsed?.content || blocked || busy) return;
    setSubmitting(true);
    try {
      if (!(await workspace.finishEntry())) return;
      if (
        await workspace.save({
          action: 'paste_content',
          content: parsed.content,
          tabId: activeProfileTab.id,
          ...(dialog?.sectionId ? { sectionId: dialog.sectionId } : {}),
        })
      )
        clipboard.close();
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) clipboard.close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="icon-dialog-overlay" />
        <Dialog.Content
          className="icon-dialog remove-item-dialog content-clipboard-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelButton.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = clipboard.returnFocus.current?.isConnected
              ? clipboard.returnFocus.current
              : workspace.addLinkButton.current;
            target?.focus({ preventScroll: true });
          }}
        >
          <Dialog.Title>{t(copying ? 'Copy content' : 'Paste content')}</Dialog.Title>
          <Dialog.Description>
            {copying
              ? t('Select and copy this text, then use Add → Paste in another tab or space.')
              : t('Add a copy to {name}. Existing content stays unchanged.', {
                  name: target ?? '',
                })}
          </Dialog.Description>
          {(copying || !parsed?.content) && (
            <label className="clipboard-text">
              {t(copying ? 'Text to copy' : 'Paste copied content here')}
              <textarea
                rows={4}
                readOnly={copying}
                maxLength={CLIPBOARD_LIMIT}
                value={dialog.text}
                onFocus={(event) => {
                  if (copying) event.target.select();
                }}
                onChange={(event) => {
                  const input = event.currentTarget;
                  clipboard.changeText(input.value);
                  requestAnimationFrame(() => {
                    if (!input.isConnected) cancelButton.current?.focus();
                  });
                }}
                placeholder={t('Copy an item or section from its ⋯ menu.')}
              />
            </label>
          )}
          {clipboard.reading && <p role="status">{t('Reading clipboard…')}</p>}
          {parsed?.content && parsed.preview && (
            <div className="clipboard-preview">
              <strong>
                {parsed.content.kind === 'section'
                  ? parsed.content.title
                  : itemLabel(parsed.content.items[0])}
              </strong>
              <p>{t('Items: {count}', { count: parsed.preview.itemCount })}</p>
              {parsed.preview.itemCount > parsed.content.items.length && (
                <p>{t('Includes games inside collections.')}</p>
              )}
              {parsed.content.kind === 'section' && parsed.content.items.length > 0 && (
                <ul>
                  {parsed.content.items.slice(0, 5).map((item) => (
                    <li key={item.slug}>{itemLabel(item)}</li>
                  ))}
                  {parsed.content.items.length > 5 && (
                    <li>{t('And {count} more', { count: parsed.content.items.length - 5 })}</li>
                  )}
                </ul>
              )}
              {parsed.preview.hiddenCount > 0 && (
                <p>
                  {t(
                    parsed.preview.hiddenCount === 1
                      ? 'The hidden item will stay hidden.'
                      : '{count} hidden items will stay hidden.',
                    {
                      count: parsed.preview.hiddenCount,
                    },
                  )}
                </p>
              )}
              {activeProfileTab.hidden && <p>{t('This tab is hidden from visitors.')}</p>}
              {parsed.preview.renames.length > 0 && (
                <p>{t('Conflicting short URLs and aliases will get a number added to the end.')}</p>
              )}
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => clipboard.changeText('')}
              >
                {t('Paste different content')}
              </button>
            </div>
          )}
          {error && (
            <p className="message error" role="alert">
              {t(error)}
            </p>
          )}
          <div className="remove-item-actions">
            <Dialog.Close asChild>
              <button
                ref={cancelButton}
                type="button"
                className="button button-light"
                disabled={busy}
              >
                {t(copying ? 'Done' : 'Cancel')}
              </button>
            </Dialog.Close>
            {!copying && (
              <button
                type="button"
                className="button"
                disabled={busy || clipboard.reading || !!blocked || !parsed?.content}
                onClick={() => void paste()}
              >
                <ClipboardPaste size={16} />
                {t(submitting ? 'Pasting…' : 'Paste')}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
