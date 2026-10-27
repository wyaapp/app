'use client';

import { useId, useState } from 'react';
import { Dialog } from 'radix-ui';
import { fileNavigationOrder } from '@/lib/file-navigation';
import {
  fileNameSchema,
  type FileAction,
  type SpaceFile,
  type SpaceFileInfo,
} from '@/lib/space-files';
import { useTranslation } from '../language-provider';

export function FilePropertiesDialog({
  file,
  files,
  defaultFileId,
  onSave,
  onClose,
}: {
  file: SpaceFile;
  files: readonly SpaceFileInfo[];
  defaultFileId: string | null;
  onSave: (action: FileAction) => Promise<SpaceFile | undefined>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [current, setCurrent] = useState(file);
  const [name, setName] = useState(file.name);
  const ordered = fileNavigationOrder(files);
  const [position, setPosition] = useState(() =>
    Math.max(
      0,
      ordered.findIndex((entry) => entry.id === file.id),
    ),
  );
  const [isDefault, setDefault] = useState(file.id === defaultFileId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(unpublish = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (unpublish) {
        const next = await onSave({ action: 'unpublish', id: file.id, version: current.version });
        if (next) setCurrent(next);
      } else {
        await onSave({
          action: 'properties',
          id: file.id,
          version: current.version,
          name,
          position,
          isDefault,
        });
        onClose();
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="file-dialog-overlay" />
        <Dialog.Content className="file-location-dialog file-properties-dialog">
          <Dialog.Title>{t('File properties')}</Dialog.Title>
          <Dialog.Description>
            {t('Manage the file name and navigation. Publish content from the editor.')}
          </Dialog.Description>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label htmlFor={`${id}-name`}>{t('File name')}</label>
            <input
              id={`${id}-name`}
              value={name}
              required
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="file-default-control">
              <span>{t(current.published ? 'Visible to visitors' : 'Hidden from visitors')}</span>
              {current.published && (
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => void save(true)}
                >
                  {t('Unpublish')}
                </button>
              )}
            </div>
            <div className="file-default-control">
              <span>{t(isDefault ? 'Default page' : 'Open this file first in Classic view')}</span>
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => setDefault(!isDefault)}
              >
                {t(isDefault ? 'Clear default' : 'Make default')}
              </button>
            </div>
            <label htmlFor={`${id}-position`}>{t('Navigation position')}</label>
            <select
              id={`${id}-position`}
              value={position}
              disabled={busy}
              onChange={(event) => setPosition(Number(event.target.value))}
            >
              {ordered.map((entry, index) => (
                <option key={entry.id} value={index}>
                  {index + 1}
                </option>
              ))}
            </select>
            {error && <p role="alert">{t(error)}</p>}
            <div className="file-dialog-actions window-section-divider">
              <button
                type="submit"
                className="button"
                disabled={
                  busy ||
                  !fileNameSchema.safeParse(name).success ||
                  !Number.isInteger(position) ||
                  position < 0 ||
                  position >= ordered.length
                }
              >
                {t(busy ? 'Saving…' : 'Save changes')}
              </button>
              <Dialog.Close asChild>
                <button type="button" className="text-link" disabled={busy}>
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
