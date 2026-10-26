'use client';

import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { FolderSimpleIcon } from '@phosphor-icons/react/dist/ssr/FolderSimple';
import { folderTrail, type SpaceFolder } from '@/lib/space-folders';
import { useTranslation } from '../language-provider';

export function FileLocationDialog({
  file,
  folders,
  onMove,
  onClose,
  folder = false,
  canMove,
}: {
  file: { name: string; folderId: string | null };
  folders: SpaceFolder[];
  onMove: (folderId: string | null) => Promise<void>;
  onClose: () => void;
  folder?: boolean;
  canMove?: (id: string | null) => boolean;
}) {
  const { t } = useTranslation();
  const [destination, setDestination] = useState(file.folderId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locations = folders
    .map((folder) => ({
      id: folder.id,
      path: folderTrail(folders, folder.id)
        .map((part) => (part.system === 'desktop' ? t('Home') : part.name))
        .join(' / '),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="file-dialog-overlay" />
        <Dialog.Content
          className="file-location-dialog"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <Dialog.Title>{t(folder ? 'Move folder' : 'Move file')}</Dialog.Title>
          <Dialog.Description>{file.name}</Dialog.Description>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                await onMove(destination || null);
                onClose();
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="file-destination">{t('Destination folder')}</label>
            <select
              id="file-destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              disabled={busy}
            >
              <option value="" disabled={canMove && !canMove(null)}>
                {t('Files')} /
              </option>
              {locations.map((folder) => (
                <option key={folder.id} value={folder.id} disabled={canMove && !canMove(folder.id)}>
                  {folder.path}
                </option>
              ))}
            </select>
            <p className="subtle">
              {t('Folders containing published files are visible to visitors.')}
            </p>
            {error && (
              <p className="file-error" role="alert">
                {t(error)}
              </p>
            )}
            <div className="file-dialog-actions">
              <button
                className="button"
                type="submit"
                disabled={
                  busy ||
                  destination === (file.folderId ?? '') ||
                  (canMove && !canMove(destination || null))
                }
              >
                <FolderSimpleIcon weight="regular" aria-hidden="true" size={16} />
                {t(busy ? 'Moving…' : folder ? 'Move folder' : 'Move file')}
              </button>
              <Dialog.Close asChild>
                <button className="text-link" type="button" disabled={busy}>
                  {t('Cancel')}
                </button>
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
