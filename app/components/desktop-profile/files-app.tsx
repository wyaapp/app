'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
import { ScissorsIcon } from '@phosphor-icons/react/dist/ssr/Scissors';
import { ClipboardIcon } from '@phosphor-icons/react/dist/ssr/Clipboard';
import { ArrowUpIcon } from '@phosphor-icons/react/dist/ssr/ArrowUp';
import { CaretRightIcon } from '@phosphor-icons/react/dist/ssr/CaretRight';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { FolderPlusIcon } from '@phosphor-icons/react/dist/ssr/FolderPlus';
import { PlusIcon } from '@phosphor-icons/react/dist/ssr/Plus';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/ssr/UploadSimple';
import {
  folderNameSchema,
  folderIdSchema,
  folderTrail,
  MAX_FOLDER_DEPTH,
  MAX_SPACE_FOLDERS,
  type SpaceFolder,
} from '@/lib/space-folders';
import { MAX_FILE_BYTES, MAX_SPACE_FILES, fileNameSchema, decodeTextFile } from '@/lib/space-files';
import type { DesktopItem } from '@/lib/desktop-items';
import { isRenameShortcut, useDesktopPreferences } from '@/lib/desktop-preferences';
import { requestedFolderNavigation, type ExplorerFolderRequest } from '@/lib/explorer-navigation';
import {
  desktopEntries,
  findDesktopEntry,
  canMoveEntry,
  entryCommands,
  navigateFolder,
  stepFolderHistory,
  type DesktopEntry,
  type FolderHistory,
} from '@/lib/desktop-entries';
import type { SpacePageFile } from '@/lib/space-page-files';
import { useTranslation } from '../language-provider';
import type { useDesktopFiles } from './use-desktop-files';
import { FileAppRow, type ExplorerAppShortcut } from './file-app-row';
import { FileExplorerRow } from './file-explorer-row';
import { FileLocationDialog } from './file-location-dialog';
import type { DesktopDrag } from './use-desktop-drag';

type FileClipboard =
  { mode: 'cut'; item: DesktopItem } | { mode: 'copy'; copy: { name: string; content: string } };
function rememberedFolder(scope: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const value = localStorage.getItem(`wya:files:folder:${scope}`);
    const parsed = folderIdSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function FilesApp({
  files,
  editable,
  onOpen,
  pages,
  onOpenPage,
  drag,
  requestedFolder,
  onFolderRequestHandled,
  desktopApps = [],
  onOpenApp,
  pinnedTaskbarIds,
  onToggleTaskbarPin,
}: {
  files: ReturnType<typeof useDesktopFiles>;
  editable: boolean;
  onOpen: (id: string) => void;
  pages: SpacePageFile[];
  onOpenPage: (id: string) => void;
  drag: DesktopDrag;
  requestedFolder?: ExplorerFolderRequest;
  onFolderRequestHandled?: (sequence: number) => void;
  desktopApps?: ExplorerAppShortcut[];
  onOpenApp?: (id: string) => void;
  pinnedTaskbarIds?: readonly string[];
  onToggleTaskbarPin?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { renameShortcut } = useDesktopPreferences();
  const directory = useRef<HTMLDivElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const focusRename = useCallback(() => nameInput.current?.focus(), []);
  const [creating, setCreating] = useState<'file' | 'folder' | DesktopEntry | null>(null);
  const [history, setHistory] = useState<FolderHistory>(() => ({
    locations: [rememberedFolder(files.storageScope)],
    index: 0,
  }));
  const [handledFolderRequest, setHandledFolderRequest] = useState<string | null>(null);
  const currentFolderId = history.locations[history.index];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<FileClipboard | null>(null);
  const [moving, setMoving] = useState<DesktopItem | null>(null);
  const [deleting, setDeleting] = useState<SpaceFolder | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploadHover, setUploadHover] = useState(false);
  const folderId = files.folders.some((folder) => folder.id === currentFolderId)
    ? currentFolderId
    : null;
  const desktopFolder = files.folders.find((folder) => folder.system === 'desktop');
  const shownApps = folderId && folderId === desktopFolder?.id && onOpenApp ? desktopApps : [];
  const selectedApp = shownApps.find((app) => `app:${app.id}` === selectedKey);
  const trail = folderTrail(files.folders, folderId);
  const entries = desktopEntries(files.files, files.folders, pages, editable);
  const children = entries.filter((entry) => entry.folderId === folderId);
  const folderCount = children.filter((entry) => entry.kind === 'folder').length;
  const count = children.length - folderCount;
  const rowKeys = [
    ...shownApps.map((app) => `app:${app.id}`),
    ...children.map((entry) => entry.key),
  ];
  const selected = children.find((entry) => entry.key === selectedKey);
  const commands = entryCommands(files, files.folders);
  const movingEntry = moving ? findDesktopEntry(entries, moving) : undefined;

  // A request is consumed once, after the folder list is ready. Later renders
  // must not pull the user back after they navigate elsewhere in Files.
  const folderRequest = requestedFolderNavigation(
    history,
    handledFolderRequest,
    requestedFolder,
    files.folders,
    files.loading || busy,
  );
  if (folderRequest) {
    setHandledFolderRequest(folderRequest.key);
    if (folderRequest.found) {
      setHistory(folderRequest.history);
      setSelectedKey(null);
      setCreating(null);
      setDeleting(null);
      setMoving(null);
      setName('');
      setError('');
      setNotice('');
    }
  }
  useEffect(() => {
    if (files.loading) return;
    try {
      if (folderId) localStorage.setItem(`wya:files:folder:${files.storageScope}`, folderId);
      else localStorage.removeItem(`wya:files:folder:${files.storageScope}`);
    } catch {
      /* Navigation still works when storage is unavailable. */
    }
  }, [folderId, files.loading, files.storageScope]);
  useEffect(() => {
    if (handledFolderRequest) directory.current?.focus({ preventScroll: true });
  }, [handledFolderRequest]);
  useEffect(() => {
    if (
      requestedFolder &&
      handledFolderRequest === `${requestedFolder.sequence}:${requestedFolder.id}`
    )
      onFolderRequestHandled?.(requestedFolder.sequence);
  }, [handledFolderRequest, requestedFolder, onFolderRequestHandled]);
  function accepts(item: DesktopItem, destination: string | null) {
    const source = findDesktopEntry(entries, item);
    return !busy && !files.loading && !!source && canMoveEntry(source, files.folders, destination);
  }
  async function move(item: DesktopItem, destination: string | null) {
    const source = findDesktopEntry(entries, item);
    if (!source) throw new Error('This item is no longer available.');
    await commands.move(source, destination);
    setNotice('Item moved.');
  }
  function dropTarget(destination: string | null, key: string) {
    return drag.target(
      key,
      (item) => accepts(item, destination),
      (item) => {
        setBusy(true);
        setError('');
        void move(item, destination)
          .catch((error: Error) => setError(error.message))
          .finally(() => setBusy(false));
      },
    );
  }
  const directoryDrop = dropTarget(folderId, 'file-directory');

  function navigate(id: string | null, nextHistory = navigateFolder(history, id)) {
    setHistory(nextHistory);
    setSelectedKey(null);
    setCreating(null);
    setDeleting(null);
    setName('');
    setError('');
    setNotice('');
    requestAnimationFrame(() => directory.current?.focus({ preventScroll: true }));
  }
  function stepHistory(direction: -1 | 1) {
    const next = stepFolderHistory(history, direction, files.folders);
    navigate(next.locations[next.index], next);
  }
  function open(entry: DesktopEntry) {
    if (entry.kind === 'folder') navigate(entry.id);
    else if (entry.kind === 'page') onOpenPage(entry.id);
    else onOpen(entry.id);
  }
  function rename(entry: DesktopEntry) {
    if (!editable || busy || !entry.capabilities.rename) return;
    setCreating(entry);
    setName(entry.name);
    setDeleting(null);
    setError('');
    setNotice('');
  }
  async function run(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function focusSelection() {
    requestAnimationFrame(() => {
      const selected = directory.current?.querySelector<HTMLButtonElement>(
        '.file-row[data-selected] .file-open',
      );
      if (selected) selected.focus({ preventScroll: true });
      else directory.current?.focus({ preventScroll: true });
    });
  }
  function cancelCreation() {
    if (busy) return;
    setCreating(null);
    setName('');
    setError('');
    focusSelection();
  }
  async function saveEntry() {
    if (!creating || creating === 'file') return;
    await run(async () => {
      if (creating === 'folder') {
        const folder = await files.changeFolder({
          action: 'create-folder',
          name,
          parentId: folderId,
        });
        if (folder) setSelectedKey(`folder:${folder.id}`);
      } else await commands.rename(creating, name);
      setCreating(null);
      setName('');
      focusSelection();
    });
  }
  function cut(entry: DesktopEntry) {
    if (!entry.capabilities.move) return;
    setClipboard({ mode: 'cut', item: { kind: entry.kind, id: entry.id } });
    setNotice('Choose a folder and paste to move this item.');
  }
  function copy(entry: DesktopEntry) {
    if (!entry.capabilities.copy) return;
    void run(async () => {
      setClipboard({ mode: 'copy', copy: await commands.copy(entry) });
      setNotice('File copied. Paste it into a folder.');
    });
  }
  const cutEntry =
    clipboard?.mode === 'cut' ? findDesktopEntry(entries, clipboard.item) : undefined;
  const canPaste =
    editable &&
    !busy &&
    !files.loading &&
    (clipboard?.mode === 'copy'
      ? files.files.length < MAX_SPACE_FILES
      : !!cutEntry && canMoveEntry(cutEntry, files.folders, folderId));
  function paste() {
    if (!clipboard || !canPaste) return;
    void run(async () => {
      if (clipboard.mode === 'cut') {
        await move(clipboard.item, folderId);
        setSelectedKey(`${clipboard.item.kind}:${clipboard.item.id}`);
        setClipboard(null);
        focusSelection();
      } else {
        const result = await commands.paste(clipboard.copy, folderId, entries);
        if (result) setSelectedKey(`file:${result.id}`);
        focusSelection();
        setNotice('File pasted as a private draft.');
      }
    });
  }
  function renameKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      !editable ||
      busy ||
      files.loading ||
      creating ||
      !selected?.capabilities.rename ||
      !isRenameShortcut(event.nativeEvent, renameShortcut)
    )
      return;
    const target = event.target as HTMLElement;
    // Capture before a file row handles Enter as Open, but leave toolbar and
    // menu buttons (including their Enter activation) alone.
    if (target !== event.currentTarget && !target.matches('.file-row[data-selected] .file-open'))
      return;
    event.preventDefault();
    event.stopPropagation();
    rename(selected);
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]',
      )
    )
      return;
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      if (!busy) stepHistory(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (event.key === 'Escape') {
      setClipboard(null);
      setSelectedKey(null);
      return;
    }
    if (busy || files.loading) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'v' && canPaste) {
        event.preventDefault();
        paste();
      } else if (key === 'c' && selected?.capabilities.copy) {
        event.preventDefault();
        copy(selected);
      } else if (key === 'x' && selected?.capabilities.move) {
        event.preventDefault();
        cut(selected);
      }
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && target.closest('.file-list')) {
      event.preventDefault();
      const index = rowKeys.indexOf(selectedKey ?? '');
      const nextIndex = Math.max(
        0,
        Math.min(rowKeys.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
      );
      const next = rowKeys[nextIndex];
      if (next) {
        setSelectedKey(next);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('.file-open')[nextIndex]?.focus();
      }
    }
  }
  async function deleteFolder() {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      await files.changeFolder({
        action: 'delete-folder',
        id: deleting.id,
        version: deleting.version,
      });
      setDeleting(null);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function create(name: string, content: string) {
    setBusy(true);
    setError('');
    try {
      const file = (await files.change({ action: 'create', name, content, folderId }))!;
      setCreating(null);
      setName('');
      onOpen(file.id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importFiles(selected: File[]) {
    if (!editable || busy || !selected.length) return;
    setBusy(true);
    setError('');
    try {
      if (files.files.length + selected.length > MAX_SPACE_FILES)
        throw new Error('This space has reached its 30-file limit.');
      // Validate the whole selection before creating any drafts.
      const uploads = await Promise.all(
        selected.map(async (file) => {
          if (!fileNameSchema.safeParse(file.name).success || file.size > MAX_FILE_BYTES)
            throw new Error('Choose a .md or .txt file, up to 64 KB.');
          return { name: file.name, content: decodeTextFile(file.name, await file.arrayBuffer()) };
        }),
      );
      const names = new Set(
        files.files
          .filter((file) => file.folderId === folderId)
          .map((file) => file.name.toLowerCase()),
      );
      for (const file of uploads) {
        if (names.has(file.name.toLowerCase()))
          throw new Error('A file with this name already exists.');
        names.add(file.name.toLowerCase());
      }
      for (const file of uploads) await files.change({ action: 'create', ...file, folderId });
      setNotice('Files added as private drafts.');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="desktop-files"
      tabIndex={-1}
      onKeyDownCapture={renameKeyboard}
      onKeyDown={keyboard}
      {...directoryDrop}
      ref={(element) => {
        directory.current = element;
        const cleanup = directoryDrop.ref(element);
        return () => {
          cleanup?.();
          directory.current = null;
        };
      }}
      data-drop-target={uploadHover || directoryDrop['data-drop-target']}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = editable && !busy ? 'copy' : 'none';
          setUploadHover(editable && !busy);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setUploadHover(false);
      }}
      onDrop={(event) => {
        setUploadHover(false);
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.stopPropagation();
          void importFiles(Array.from(event.dataTransfer.files));
        }
      }}
    >
      <nav className="file-breadcrumbs" aria-label={t('Folder location')}>
        <button
          type="button"
          aria-label={t('Back')}
          disabled={busy || stepFolderHistory(history, -1, files.folders) === history}
          onClick={() => stepHistory(-1)}
        >
          <ArrowLeftIcon size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t('Forward')}
          disabled={busy || stepFolderHistory(history, 1, files.folders) === history}
          onClick={() => stepHistory(1)}
        >
          <ArrowRightIcon size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={!folderId || busy}
          aria-label={t('Go to parent folder')}
          onClick={() => navigate(trail.at(-1)?.parentId ?? null)}
          {...dropTarget(trail.at(-1)?.parentId ?? null, 'folder-up')}
        >
          <ArrowUpIcon weight="regular" aria-hidden="true" size={16} />
        </button>
        <ol>
          <li>
            <button
              type="button"
              disabled={busy}
              aria-current={!folderId ? 'page' : undefined}
              onClick={() => navigate(null)}
              {...dropTarget(null, 'folder-root')}
            >
              <FolderOpenIcon weight="regular" aria-hidden="true" size={16} />
              {t('Files')}
            </button>
          </li>
          {trail.map((folder) => (
            <li key={folder.id}>
              <CaretRightIcon weight="regular" size={14} aria-hidden="true" />
              <button
                type="button"
                disabled={busy}
                aria-current={folder.id === folderId ? 'page' : undefined}
                onClick={() => navigate(folder.id)}
                {...dropTarget(folder.id, `breadcrumb-${folder.id}`)}
              >
                {folder.system === 'desktop' ? t('Desktop') : folder.name}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="file-toolbar">
        <div className="file-toolbar-actions file-selection-actions">
          <button
            type="button"
            disabled={(!selected && !selectedApp) || busy}
            onClick={() => {
              if (selected) open(selected);
              else if (selectedApp) onOpenApp?.(selectedApp.id);
            }}
          >
            <FolderOpenIcon size={16} aria-hidden="true" />
            {t('Open')}
          </button>
          {editable && (
            <>
              <button
                type="button"
                aria-label={t('Cut')}
                title={t('Cut')}
                disabled={!selected?.capabilities.move || busy}
                onClick={() => selected && cut(selected)}
              >
                <ScissorsIcon size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t('Copy')}
                title={t('Copy')}
                disabled={!selected?.capabilities.copy || busy}
                onClick={() => selected && copy(selected)}
              >
                <CopyIcon size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t('Paste')}
                title={t('Paste')}
                disabled={!canPaste}
                onClick={paste}
              >
                <ClipboardIcon size={16} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        {editable && (
          <div className="file-toolbar-actions">
            <button
              type="button"
              disabled={busy || files.loading || files.files.length >= MAX_SPACE_FILES}
              onClick={() => {
                setCreating('file');
                setName('');
              }}
            >
              <PlusIcon weight="regular" aria-hidden="true" size={16} />
              {t('New file')}
            </button>
            <button
              type="button"
              disabled={
                busy ||
                files.loading ||
                files.folders.filter((folder) => !folder.system).length >= MAX_SPACE_FOLDERS ||
                trail.filter((folder) => !folder.system).length >= MAX_FOLDER_DEPTH
              }
              onClick={() => {
                setCreating('folder');
                setName('');
              }}
            >
              <FolderPlusIcon weight="regular" aria-hidden="true" size={16} />
              {t('New folder')}
            </button>
            <button
              type="button"
              disabled={busy || files.loading || files.files.length >= MAX_SPACE_FILES}
              onClick={() => upload.current?.click()}
            >
              <UploadSimpleIcon weight="regular" aria-hidden="true" size={16} />
              {t('Upload')}
            </button>
            <input
              ref={upload}
              className="file-upload-input"
              type="file"
              multiple
              accept=".md,.txt,text/plain,text/markdown"
              aria-label={t('Upload text file')}
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                event.target.value = '';
                void importFiles(selected);
              }}
            />
          </div>
        )}
      </div>
      {creating && (
        <form
          className="file-create"
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            cancelCreation();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (creating === 'file') void create(name, '');
            else void saveEntry();
          }}
        >
          <label htmlFor="new-desktop-filename">
            {t(
              creating === 'file' || (typeof creating === 'object' && creating.kind === 'file')
                ? 'Filename'
                : 'Folder name',
            )}
          </label>
          <div>
            <input
              id="new-desktop-filename"
              ref={nameInput}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => {
                if (typeof creating !== 'object') return;
                const value = event.currentTarget.value;
                const extension = creating.kind === 'file' ? value.lastIndexOf('.') : -1;
                event.currentTarget.setSelectionRange(0, extension > 0 ? extension : value.length);
              }}
              placeholder={
                creating === 'file' || (typeof creating === 'object' && creating.kind === 'file')
                  ? 'hello.md'
                  : t('New folder')
              }
              maxLength={100}
              autoFocus
              disabled={busy}
            />
            <button
              type="submit"
              disabled={
                busy ||
                !(
                  creating === 'file' || (typeof creating === 'object' && creating.kind === 'file')
                    ? fileNameSchema
                    : folderNameSchema
                ).safeParse(name).success
              }
            >
              {t(typeof creating === 'object' ? 'Rename' : 'Create')}
            </button>
            <button type="button" disabled={busy} onClick={cancelCreation}>
              {t('Cancel')}
            </button>
          </div>
          <small>
            {t(
              creating === 'file' || (typeof creating === 'object' && creating.kind === 'file')
                ? 'Use .md for Markdown or .txt for plain text.'
                : 'Folders containing published files are visible to visitors.',
            )}
          </small>
        </form>
      )}
      {deleting && (
        <div className="file-delete-confirm" role="alert">
          <span>{t('Delete the empty folder "{name}"?', { name: deleting.name })}</span>
          <button type="button" disabled={busy} onClick={() => void deleteFolder()}>
            {t('Delete folder')}
          </button>
          <button type="button" autoFocus disabled={busy} onClick={() => setDeleting(null)}>
            {t('Cancel')}
          </button>
        </div>
      )}
      {(error || files.error) && (
        <div className="file-error" role="alert">
          {t(error || files.error)}{' '}
          {files.error && (
            <button type="button" onClick={() => void files.reload()}>
              {t('Try again')}
            </button>
          )}
        </div>
      )}
      {files.loading ? (
        <p className="file-empty" role="status">
          {t('Loading files…')}
        </p>
      ) : count || folderCount || shownApps.length ? (
        <ul className="file-list">
          {shownApps.map((app) => (
            <FileAppRow
              key={`app:${app.id}`}
              app={app}
              pinnedTaskbarIds={pinnedTaskbarIds}
              onToggleTaskbarPin={onToggleTaskbarPin}
              selected={selectedKey === `app:${app.id}`}
              onSelect={() => setSelectedKey(`app:${app.id}`)}
              onOpen={() => {
                if (!busy) onOpenApp?.(app.id);
              }}
            />
          ))}
          {children.map((entry) => (
            <FileExplorerRow
              key={entry.key}
              entry={entry}
              pinnedTaskbarIds={pinnedTaskbarIds}
              onToggleTaskbarPin={onToggleTaskbarPin}
              editable={editable}
              selected={selectedKey === entry.key}
              cut={cutEntry?.key === entry.key}
              busy={busy}
              empty={!entries.some((child) => child.folderId === entry.id)}
              onDesktop={!!desktopFolder && entry.folderId === desktopFolder.id}
              drag={drag}
              target={
                entry.kind === 'folder' ? dropTarget(entry.id, `folder-${entry.id}`) : undefined
              }
              onSelect={() => setSelectedKey(entry.key)}
              onOpen={() => {
                if (!busy) open(entry);
              }}
              onCut={() => cut(entry)}
              onCopy={() => copy(entry)}
              onMove={() => setMoving(entry)}
              onRename={() => rename(entry)}
              focusRename={focusRename}
              onDelete={() => {
                if (entry.kind === 'folder') {
                  setDeleting(entry.source);
                  setCreating(null);
                }
              }}
              onTogglePin={() =>
                void run(async () => {
                  await commands.togglePin(entry);
                  setSelectedKey(null);
                  setNotice('Item moved.');
                  focusSelection();
                })
              }
            />
          ))}
        </ul>
      ) : (
        <div className="file-empty">
          <FolderOpenIcon weight="regular" aria-hidden="true" size={36} />
          <h3>
            {t(
              folderId
                ? 'This folder is empty.'
                : editable
                  ? 'A place for your words.'
                  : 'No published files yet.',
            )}
          </h3>
          {editable && (
            <p>
              {t(
                'Add notes, a readme, or something worth sharing. New files start as private drafts.',
              )}
            </p>
          )}
        </div>
      )}
      <footer className="file-statusbar">
        <span>
          {t(count === 1 ? '1 file' : '{count} files', { count })}
          {shownApps.length > 0 && (
            <>
              {' '}
              · {t(shownApps.length === 1 ? '1 app' : '{count} apps', { count: shownApps.length })}
            </>
          )}
          {folderCount > 0 && (
            <>
              {' '}
              ·{' '}
              {t(folderCount === 1 ? '1 folder' : '{count} folders', {
                count: folderCount,
              })}
            </>
          )}
        </span>
        <span role="status">
          {t(
            uploadHover
              ? 'Drop text files here'
              : notice ||
                  (editable
                    ? 'Uploads: .md and .txt · Up to 64 KB each'
                    : 'Published by this space'),
          )}
        </span>
      </footer>
      {moving && movingEntry && (
        <FileLocationDialog
          file={movingEntry}
          folder={moving.kind === 'folder'}
          canMove={(id) => accepts(moving, id)}
          folders={files.folders}
          onMove={(folderId) => move(moving, folderId)}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  );
}
