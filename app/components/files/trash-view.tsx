'use client';

import { useRef, useState, type ReactNode } from 'react';
import { AlertDialog, Dialog } from 'radix-ui';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowCounterClockwise';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowClockwise';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { FolderIcon } from '@phosphor-icons/react/dist/ssr/Folder';
import { InfoIcon } from '@phosphor-icons/react/dist/ssr/Info';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { TrashIcon } from '@phosphor-icons/react/dist/ssr/Trash';
import { getFileFormat } from '@/lib/file-formats';
import type { TrashEntryInfo } from '@/lib/space-trash';
import { useTranslation } from '../language-provider';
import { FileItemMenu } from './file-item-menu';
import { ItemOpenButton } from './item-open-button';

type Confirmation =
  { kind: 'item'; entry: TrashEntryInfo } | { kind: 'all'; entries: TrashEntryInfo[] };

export function FileTrashView({
  renderLayout,
  entries,
  loading,
  loadError,
  search,
  busy,
  setBusy,
  onRefresh,
  onRestore,
  onPurge,
  onEmpty,
  onNotice,
}: {
  renderLayout: (toolbar: ReactNode, content: ReactNode) => ReactNode;
  entries: TrashEntryInfo[];
  loading: boolean;
  loadError: string;
  search: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
  onRestore: (entry: TrashEntryInfo) => Promise<void>;
  onPurge: (entry: TrashEntryInfo) => Promise<void>;
  onEmpty: (entries: TrashEntryInfo[]) => Promise<void>;
  onNotice: (notice: string) => void;
}) {
  const { t, locale } = useTranslation();
  const pane = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<TrashEntryInfo | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [error, setError] = useState('');
  const normalize = (value: string) =>
    value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase(locale);
  const shown = entries.filter((entry) => normalize(entry.name).includes(normalize(search.trim())));
  const selected = shown.find((entry) => entry.id === selectedId);
  const pending = busy || loading;
  const formatDate = (value: string, full = false) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: full ? 'medium' : 'short',
      ...(full ? { timeStyle: 'short' as const } : {}),
    }).format(new Date(value));
  const location = (entry: TrashEntryInfo) =>
    entry.originalLocation === 'Home' ||
    entry.originalLocation === 'Desktop' ||
    entry.originalLocation === 'All files'
      ? t(entry.originalLocation === 'Desktop' ? 'Home' : entry.originalLocation)
      : entry.originalLocation;
  const contents = (entry: TrashEntryInfo) =>
    entry.kind === 'folder'
      ? `${t(entry.fileCount === 1 ? '1 file' : '{count} files', { count: entry.fileCount })} · ${t(entry.folderCount === 1 ? '1 folder' : '{count} folders', { count: entry.folderCount })}`
      : `${Math.ceil(entry.size / 1024)} KB`;

  async function run(operation: () => Promise<void>, notice?: string) {
    if (pending) return;
    setBusy(true);
    setError('');
    try {
      await operation();
      if (notice) onNotice(notice);
      setDetails(null);
      setConfirmation(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function requestPurge(entry: TrashEntryInfo) {
    setDetails(null);
    setError('');
    setConfirmation({ kind: 'item', entry });
  }
  function focusSelection() {
    requestAnimationFrame(() => {
      const next =
        list.current?.querySelector<HTMLButtonElement>('[data-selected] .file-open') ??
        list.current?.querySelector<HTMLButtonElement>('.file-open');
      if (next) next.focus({ preventScroll: true });
      else pane.current?.focus({ preventScroll: true });
    });
  }
  const restore = (entry: TrashEntryInfo) =>
    void run(() => onRestore(entry), 'Restored as private drafts.');
  return renderLayout(
    <div className="file-toolbar file-trash-toolbar">
      <div className="file-toolbar-actions file-trash-primary-actions">
        <button
          className="button button-light button-small"
          type="button"
          disabled={!selected || pending}
          onClick={() => selected && restore(selected)}
        >
          <ArrowCounterClockwiseIcon size={16} aria-hidden="true" />
          {t('Restore')}
        </button>
        <button
          className="button button-light button-small"
          type="button"
          aria-label={t('Delete permanently')}
          title={t('Delete permanently')}
          disabled={!selected || pending}
          onClick={() => selected && requestPurge(selected)}
        >
          <TrashIcon size={16} aria-hidden="true" />
          <span className="file-command-label">{t('Delete permanently')}</span>
        </button>
      </div>
      <div className="file-toolbar-actions file-trash-secondary-actions">
        <button
          className="button button-light button-small"
          type="button"
          disabled={!entries.length || pending}
          onClick={() => {
            setError('');
            setConfirmation({ kind: 'all', entries: [...entries] });
          }}
        >
          {t('Empty Trash')}
        </button>
        <button
          className="button button-light button-small"
          type="button"
          disabled={pending}
          aria-label={t('Refresh Trash')}
          title={t('Refresh Trash')}
          onClick={() => void run(onRefresh)}
        >
          <ArrowClockwiseIcon size={16} aria-hidden="true" />
        </button>
      </div>
    </div>,
    <section className="file-directory file-trash" aria-label={t('Trash')} ref={pane} tabIndex={-1}>
      {(error || loadError) && !confirmation && (
        <div className="file-error" role="alert">
          {t(error || loadError)}{' '}
          {loadError && (
            <button type="button" disabled={pending} onClick={() => void run(onRefresh)}>
              {t('Try again')}
            </button>
          )}
        </div>
      )}
      <div className="file-directory-scroll">
        <div className="file-directory-heading file-trash-heading" aria-hidden="true">
          <span>{t('Name')}</span>
          <span className="file-trash-location">{t('Original location')}</span>
          <span className="file-trash-date">{t('Deleted')}</span>
        </div>
        {loading ? (
          <p className="file-empty" role="status">
            {t('Loading Trash…')}
          </p>
        ) : shown.length ? (
          <ul
            className="file-list"
            ref={list}
            onKeyDown={(event) => {
              if (
                event.defaultPrevented ||
                pending ||
                (event.target as HTMLElement).closest('[role="menu"]')
              )
                return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopPropagation();
                const index = shown.findIndex((entry) => entry.id === selectedId);
                const next = Math.max(
                  0,
                  Math.min(shown.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                );
                setSelectedId(shown[next].id);
                list.current?.querySelectorAll<HTMLButtonElement>('.file-open')[next]?.focus();
              } else if (event.key === 'Delete' && selected) {
                event.preventDefault();
                event.stopPropagation();
                requestPurge(selected);
              } else if (event.key === 'Escape') {
                event.stopPropagation();
                setSelectedId(null);
              }
            }}
          >
            {shown.map((entry) => {
              const Icon =
                entry.kind === 'folder'
                  ? FolderIcon
                  : getFileFormat(entry.name) === 'widget'
                    ? SquaresFourIcon
                    : FileTextIcon;
              const inspect = () => {
                if (!pending) {
                  setError('');
                  setDetails(entry);
                }
              };
              return (
                <FileItemMenu
                  key={entry.id}
                  name={entry.name}
                  editable
                  actions={[
                    {
                      label: 'Details',
                      icon: <InfoIcon size={16} />,
                      onSelect: inspect,
                      disabled: pending,
                      opensForm: true,
                    },
                    {
                      label: 'Restore',
                      icon: <ArrowCounterClockwiseIcon size={16} />,
                      onSelect: () => restore(entry),
                      disabled: pending,
                    },
                    {
                      label: 'Delete permanently',
                      icon: <TrashIcon size={16} />,
                      onSelect: () => requestPurge(entry),
                      disabled: pending,
                      opensForm: true,
                    },
                  ]}
                  rowProps={
                    {
                      'data-selected': selectedId === entry.id || undefined,
                      onClick: () => setSelectedId(entry.id),
                      onFocus: (event) => {
                        if (event.currentTarget.contains(event.target)) setSelectedId(entry.id);
                      },
                      onContextMenu: () => setSelectedId(entry.id),
                    } as Parameters<typeof FileItemMenu>[0]['rowProps']
                  }
                >
                  <ItemOpenButton
                    className="file-open"
                    selected={selectedId === entry.id}
                    onSelect={() => setSelectedId(entry.id)}
                    onOpen={inspect}
                    title={entry.name}
                  >
                    <span className="file-document-icon">
                      <Icon weight="duotone" size={24} aria-hidden="true" />
                    </span>
                    <span className="file-list-name">
                      <strong>{entry.name}</strong>
                      <small>{contents(entry)}</small>
                      <small className="file-trash-mobile-meta">
                        {location(entry)} · {formatDate(entry.deletedAt)}
                      </small>
                    </span>
                    <span className="file-trash-location" title={location(entry)}>
                      {location(entry)}
                    </span>
                    <time
                      className="file-trash-date"
                      dateTime={entry.deletedAt}
                      title={formatDate(entry.deletedAt, true)}
                    >
                      {formatDate(entry.deletedAt)}
                    </time>
                  </ItemOpenButton>
                </FileItemMenu>
              );
            })}
          </ul>
        ) : (
          <div className="file-empty">
            <TrashIcon weight="duotone" size={32} aria-hidden="true" />
            <h3>{t(search.trim() ? 'No matching items' : 'Trash is empty.')}</h3>
            <p>
              {t(
                search.trim()
                  ? 'Try another name or clear the search.'
                  : 'Deleted files, widgets, and folders will appear here.',
              )}
            </p>
          </div>
        )}
      </div>
      {details && (
        <Dialog.Root
          open
          onOpenChange={(open) => {
            if (!open && !busy) setDetails(null);
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="file-dialog-overlay" />
            <Dialog.Content
              className="file-location-dialog file-trash-dialog"
              onCloseAutoFocus={focusSelection}
            >
              <Dialog.Title>{details.name}</Dialog.Title>
              <Dialog.Description>{t('This item is in Trash.')}</Dialog.Description>
              <dl className="file-trash-details">
                <div>
                  <dt>{t('Original location')}</dt>
                  <dd>{location(details)}</dd>
                </div>
                <div>
                  <dt>{t('Deleted')}</dt>
                  <dd>{formatDate(details.deletedAt, true)}</dd>
                </div>
                <div>
                  <dt>{t('Contents')}</dt>
                  <dd>{contents(details)}</dd>
                </div>
              </dl>
              <p>
                {t(
                  'Restoring keeps files private. Name conflicts are renamed, and missing folders fall back to Home.',
                )}
              </p>
              {error && (
                <p className="file-error" role="alert">
                  {t(error)}
                </p>
              )}
              <div className="file-dialog-actions">
                <button
                  className="button"
                  type="button"
                  disabled={pending}
                  onClick={() => restore(details)}
                >
                  {t('Restore')}
                </button>
                <button
                  className="text-link"
                  type="button"
                  disabled={pending}
                  onClick={() => requestPurge(details)}
                >
                  {t('Delete permanently')}
                </button>
                <Dialog.Close asChild>
                  <button className="text-link" type="button" disabled={busy}>
                    {t('Close')}
                  </button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {confirmation && (
        <AlertDialog.Root
          open
          onOpenChange={(open) => {
            if (!open && !busy) {
              setConfirmation(null);
              setError('');
            }
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="file-dialog-overlay" />
            <AlertDialog.Content
              className="file-location-dialog file-trash-dialog"
              onCloseAutoFocus={focusSelection}
              onEscapeKeyDown={(event) => {
                if (busy) event.preventDefault();
              }}
            >
              <AlertDialog.Title>
                {t(confirmation.kind === 'all' ? 'Empty Trash?' : 'Delete permanently?')}
              </AlertDialog.Title>
              <AlertDialog.Description>
                {confirmation.kind === 'all'
                  ? t(
                      confirmation.entries.length === 1
                        ? 'Permanently delete 1 item from Trash, including its contents? This cannot be undone.'
                        : 'Permanently delete {count} items from Trash, including their contents? This cannot be undone.',
                      { count: confirmation.entries.length },
                    )
                  : t('Permanently delete "{name}" and its contents? This cannot be undone.', {
                      name: confirmation.entry.name,
                    })}
              </AlertDialog.Description>
              {error && (
                <p className="file-error" role="alert">
                  {t(error)}
                </p>
              )}
              <div className="file-dialog-actions">
                <AlertDialog.Cancel asChild>
                  <button className="text-link" type="button" disabled={busy}>
                    {t('Cancel')}
                  </button>
                </AlertDialog.Cancel>
                <button
                  className="button"
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void run(
                      () =>
                        confirmation.kind === 'all'
                          ? onEmpty(confirmation.entries)
                          : onPurge(confirmation.entry),
                      'Permanently deleted.',
                    )
                  }
                >
                  {t(busy ? 'Deleting…' : 'Delete permanently')}
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </section>,
  );
}
