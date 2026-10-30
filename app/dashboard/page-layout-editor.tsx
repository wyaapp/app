'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { ArrowDownIcon } from '@phosphor-icons/react/dist/ssr/ArrowDown';
import { ArrowUpIcon } from '@phosphor-icons/react/dist/ssr/ArrowUp';
import { ArrowLineUpIcon } from '@phosphor-icons/react/dist/ssr/ArrowLineUp';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { DotsSixVerticalIcon } from '@phosphor-icons/react/dist/ssr/DotsSixVertical';
import { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/ssr/FloppyDisk';
import { MinusIcon } from '@phosphor-icons/react/dist/ssr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/ssr/Plus';
import { SpinnerGapIcon } from '@phosphor-icons/react/dist/ssr/SpinnerGap';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { getFileFormat } from '@/lib/file-formats';
import type { MobileLayout } from '@/lib/mobile-layout';
import type { SpaceFileInfo } from '@/lib/space-files';
import { useTranslation } from '../components/language-provider';
import type { RegisterNavigationGuard } from '@/lib/navigation-guard';

export type PageLayoutEditorProps = {
  files: readonly SpaceFileInfo[];
  value: readonly string[];
  disabled?: boolean;
  onSave: (layout: MobileLayout) => Promise<boolean>;
  onOpenFiles?: () => void;
  registerGuard?: RegisterNavigationGuard;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
const PAGE_LAYOUT_DRAG = 'page-layout-file';

function FileIcon({ name }: { name: string }) {
  const Icon = getFileFormat(name) === 'widget' ? SquaresFourIcon : FileTextIcon;
  return <Icon weight="duotone" size={24} aria-hidden="true" />;
}

export function PageLayoutEditor({
  files,
  value,
  disabled = false,
  onSave,
  onOpenFiles,
  registerGuard,
}: PageLayoutEditorProps) {
  const { t } = useTranslation();
  const scope = useId();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [announcement, setAnnouncement] = useState('');
  const inFlight = useRef(false);
  const published = useMemo(
    () => new Map(files.filter((file) => file.published).map((file) => [file.id, file])),
    [files],
  );
  // Deletions and unpublishing take effect immediately. Newly published files remain available
  // without replacing a local unsaved arrangement.
  const saved = useMemo(
    () => [...new Set(value)].filter((id) => published.has(id)),
    [value, published],
  );
  const selected = useMemo(
    () => [...new Set(draft ?? value)].filter((id) => published.has(id)),
    [draft, value, published],
  );
  const dirty =
    selected.length !== saved.length || selected.some((id, index) => id !== saved[index]);
  const locked = disabled || status === 'saving';
  const available = files.filter((file) => !selected.includes(file.id));

  useEffect(() => {
    if (!dirty && status !== 'saving') return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [dirty, status]);

  useEffect(
    () =>
      registerGuard?.('mobile-layout', async () => {
        // Saving runs the owner's navigation guards too. Let our own explicit save through.
        if (inFlight.current || !dirty) return true;
        if (!window.confirm(t('Discard your unsaved page layout changes?'))) return false;
        setDraft(null);
        setStatus('idle');
        return true;
      }),
    [dirty, registerGuard, t],
  );

  const update = useCallback((ids: string[]) => {
    setDraft(ids);
    setStatus('idle');
  }, []);

  const move = useCallback(
    (id: string, target: number) => {
      const current = [...selected];
      const index = current.indexOf(id);
      const nextIndex = Math.max(0, Math.min(current.length - 1, target));
      if (locked || index < 0 || index === nextIndex) return;
      current.splice(index, 1);
      current.splice(nextIndex, 0, id);
      update(current);
      setAnnouncement(t('Moved to position {position}.', { position: nextIndex + 1 }));
    },
    [selected, locked, t, update],
  );

  const drop = useCallback(
    (id: string, targetId: string, edge: 'before' | 'after') => {
      const from = selected.indexOf(id);
      const target = selected.indexOf(targetId);
      if (from < 0 || target < 0 || id === targetId) return;
      const insertion = target + (edge === 'after' ? 1 : 0);
      move(id, insertion - (from < insertion ? 1 : 0));
    },
    [selected, move],
  );

  async function save() {
    if (!dirty || locked || inFlight.current) return;
    inFlight.current = true;
    setStatus('saving');
    try {
      if (await onSave({ fileIds: selected, screens: 'all' })) {
        setDraft(null);
        setStatus('saved');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className="page-layout-app" aria-busy={status === 'saving'}>
      <header className="page-layout-intro">
        <h2>{t('Your space, your layout')}</h2>
        <p>{t('Arrange the published files on your page.')}</p>
      </header>

      <section className="panel-section panel-section-divider" aria-labelledby={`${scope}-visible`}>
        <div className="page-layout-heading">
          <h3 id={`${scope}-visible`}>{t('Files in the column')}</h3>
          <span className="page-layout-count">{selected.length}</span>
        </div>
        <p className="page-layout-hint" id={`${scope}-reorder`}>
          {t('Shown from top to bottom. Drag to reorder, or use the arrow buttons.')}
        </p>
        {selected.length ? (
          <ol className="page-layout-list">
            {selected.map((id, index) => (
              <SelectedFile
                key={id}
                file={published.get(id)!}
                index={index}
                count={selected.length}
                scope={scope}
                disabled={locked}
                onMove={move}
                onDrop={drop}
                onRemove={() => {
                  update(selected.filter((entry) => entry !== id));
                  setAnnouncement(t('Hidden from the column.'));
                }}
              />
            ))}
          </ol>
        ) : (
          <p className="page-layout-empty">
            {t('No files selected. The column will show only your Bio.')}
          </p>
        )}
      </section>

      <section
        className="panel-section panel-section-divider"
        aria-labelledby={`${scope}-available`}
      >
        <div className="page-layout-heading">
          <h3 id={`${scope}-available`}>{t('Other files')}</h3>
          {onOpenFiles && (
            <button type="button" className="page-layout-text-button" onClick={onOpenFiles}>
              {t('Open Files')}
            </button>
          )}
        </div>
        <p className="page-layout-hint">
          {t('Only published files can appear on your public page.')}
        </p>
        {available.length ? (
          <ul className="page-layout-list">
            {available.map((file) => (
              <li className="page-layout-available" key={file.id}>
                <FileIcon name={file.name} />
                <div className="page-layout-file-name">
                  <strong>{file.name}</strong>
                  <small>{t(file.published ? 'Published' : 'Draft - publish to add')}</small>
                </div>
                <button
                  type="button"
                  className="page-layout-add"
                  disabled={locked || !file.published}
                  aria-label={t('Show {name} in the column', { name: file.name })}
                  onClick={() => {
                    update([...selected, file.id]);
                    setAnnouncement(t('Added to the end of the column.'));
                  }}
                >
                  <PlusIcon size={18} aria-hidden="true" />
                  <span>{t('Add')}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="page-layout-empty">
            {t(
              files.length
                ? 'All published files are included.'
                : 'Create and publish a file to add it here.',
            )}
          </p>
        )}
      </section>

      <footer className="panel-section panel-section-divider page-layout-footer">
        <p className="page-layout-save-status" role="status" data-state={status}>
          {status === 'saving' && (
            <SpinnerGapIcon className="page-layout-spinner" size={18} aria-hidden="true" />
          )}
          {status === 'saved' && !dirty && <CheckIcon size={18} aria-hidden="true" />}
          {t(
            status === 'saving'
              ? 'Saving changes...'
              : status === 'error'
                ? 'Could not save. Your changes are still here. Try again.'
                : dirty
                  ? 'Unsaved changes'
                  : status === 'saved'
                    ? 'Page layout saved.'
                    : 'Changes are applied when you save.',
          )}
        </p>
        <div className="page-layout-save-actions">
          <button
            type="button"
            className="page-layout-text-button"
            disabled={locked || !dirty}
            onClick={() => {
              setDraft(null);
              setStatus('idle');
              setAnnouncement(t('Changes discarded.'));
            }}
          >
            {t('Discard changes')}
          </button>
          <button
            type="button"
            className="button"
            disabled={locked || !dirty}
            onClick={() => void save()}
          >
            <FloppyDiskIcon size={18} aria-hidden="true" />
            {t(status === 'error' ? 'Try again' : 'Save changes')}
          </button>
        </div>
      </footer>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

function SelectedFile({
  file,
  index,
  count,
  scope,
  disabled,
  onMove,
  onDrop,
  onRemove,
}: {
  file: SpaceFileInfo;
  index: number;
  count: number;
  scope: string;
  disabled: boolean;
  onMove: (id: string, index: number) => void;
  onDrop: (id: string, targetId: string, edge: 'before' | 'after') => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const row = useRef<HTMLLIElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const [edge, setEdge] = useState<'before' | 'after' | null>(null);

  useEffect(() => {
    const element = row.current;
    const dragHandle = handle.current;
    if (!element || !dragHandle || disabled) return;
    const unbindSource = draggable({
      element,
      dragHandle,
      getInitialData: () => ({ type: PAGE_LAYOUT_DRAG, scope, id: file.id }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
    const unbindTarget = dropTargetForElements({
      element,
      canDrop: ({ source }) =>
        source.data.type === PAGE_LAYOUT_DRAG &&
        source.data.scope === scope &&
        source.data.id !== file.id,
      getData: ({ input }) => ({
        edge:
          input.clientY < element.getBoundingClientRect().top + element.offsetHeight / 2
            ? 'before'
            : 'after',
      }),
      onDrag: ({ self }) => setEdge(self.data.edge === 'before' ? 'before' : 'after'),
      onDragEnter: ({ self }) => setEdge(self.data.edge === 'before' ? 'before' : 'after'),
      onDragLeave: () => setEdge(null),
      onDrop: ({ source, self }) => {
        setEdge(null);
        if (typeof source.data.id === 'string') {
          onDrop(source.data.id, file.id, self.data.edge === 'before' ? 'before' : 'after');
        }
      },
    });
    return () => {
      unbindSource();
      unbindTarget();
    };
  }, [disabled, file.id, onDrop, scope]);

  return (
    <li
      ref={row}
      className="page-layout-selected"
      data-dragging={dragging || undefined}
      data-drop-edge={edge ?? undefined}
    >
      <button
        ref={handle}
        type="button"
        className="icon-button page-layout-drag-handle"
        disabled={disabled || count < 2}
        aria-label={t('Reorder {name}', { name: file.name })}
        aria-describedby={`${scope}-reorder`}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          onMove(file.id, index + (event.key === 'ArrowUp' ? -1 : 1));
        }}
      >
        <DotsSixVerticalIcon size={20} aria-hidden="true" />
      </button>
      <FileIcon name={file.name} />
      <div className="page-layout-file-name">
        <strong>{file.name}</strong>
        <small>
          {index === 0
            ? t('First in the column')
            : t('Position {position}', { position: index + 1 })}
        </small>
      </div>
      <div className="page-layout-row-actions">
        <button
          type="button"
          className="icon-button"
          disabled={disabled || index === 0}
          aria-label={t('Move {name} to first', { name: file.name })}
          title={t('Move to first')}
          onClick={() => onMove(file.id, 0)}
        >
          <ArrowLineUpIcon size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={disabled || index === 0}
          aria-label={t('Move {name} up', { name: file.name })}
          title={t('Move up')}
          onClick={() => onMove(file.id, index - 1)}
        >
          <ArrowUpIcon size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={disabled || index === count - 1}
          aria-label={t('Move {name} down', { name: file.name })}
          title={t('Move down')}
          onClick={() => onMove(file.id, index + 1)}
        >
          <ArrowDownIcon size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={disabled}
          aria-label={t('Hide {name} from the column', { name: file.name })}
          title={t('Hide from the column')}
          onClick={onRemove}
        >
          <MinusIcon size={18} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
