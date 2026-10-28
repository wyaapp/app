'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { AlertDialog, DropdownMenu } from 'radix-ui';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/ssr/MagnifyingGlass';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import { CaretDownIcon } from '@phosphor-icons/react/dist/ssr/CaretDown';
import { SortAscendingIcon } from '@phosphor-icons/react/dist/ssr/SortAscending';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/ssr/SlidersHorizontal';
import { explorerView, type ExplorerSort } from '@/lib/explorer-view';
import { FileSidebar } from './file-sidebar';
import { FileTrashView } from './file-trash-view';
import { TrashIcon } from '@phosphor-icons/react/dist/ssr/Trash';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
import { ScissorsIcon } from '@phosphor-icons/react/dist/ssr/Scissors';
import { ClipboardIcon } from '@phosphor-icons/react/dist/ssr/Clipboard';
import { ArrowUpIcon } from '@phosphor-icons/react/dist/ssr/ArrowUp';
import { CaretRightIcon } from '@phosphor-icons/react/dist/ssr/CaretRight';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/ssr/FolderOpen';
import { FolderPlusIcon } from '@phosphor-icons/react/dist/ssr/FolderPlus';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { getFileFormat } from '@/lib/file-formats';
import { parseWidgetSource } from '@/lib/widget-files';
import { PlusIcon } from '@phosphor-icons/react/dist/ssr/Plus';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/ssr/UploadSimple';
import {
  folderNameSchema,
  folderIdSchema,
  folderTrail,
  MAX_FOLDER_DEPTH,
  MAX_SPACE_FOLDERS,
} from '@/lib/space-folders';
import {
  MAX_FILE_BYTES,
  MAX_SPACE_FILES,
  fileNameSchema,
  decodeTextFile,
  type SpaceFile,
} from '@/lib/space-files';
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
import { useTranslation } from '../language-provider';
import type { useDesktopFiles } from './use-desktop-files';
import { FileAppRow, type ExplorerAppShortcut } from './file-app-row';
import { FileExplorerRow } from './file-explorer-row';
import { FileLocationDialog } from './file-location-dialog';
import { FilePropertiesDialog } from './file-properties-dialog';
import type { DesktopDrag } from './use-desktop-drag';

type FileClipboard =
  | { mode: 'cut'; item: DesktopItem }
  | { mode: 'copy'; copy: Pick<SpaceFile, 'name' | 'content' | 'appearance'> };
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
  drag: DesktopDrag;
  requestedFolder?: ExplorerFolderRequest;
  onFolderRequestHandled?: (sequence: number) => void;
  desktopApps?: ExplorerAppShortcut[];
  onOpenApp?: (id: string) => void;
  pinnedTaskbarIds?: readonly string[];
  onToggleTaskbarPin?: (id: string) => void;
}) {
  const { t, locale } = useTranslation();
  const { renameShortcut } = useDesktopPreferences();
  const directory = useRef<HTMLDivElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const createRequested = useRef(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ExplorerSort>('name-asc');
  const focusRename = useCallback(() => nameInput.current?.focus(), []);
  const [creating, setCreating] = useState<'file' | 'widget' | 'folder' | DesktopEntry | null>(
    null,
  );
  const [history, setHistory] = useState<FolderHistory>(() => ({
    locations: [rememberedFolder(files.storageScope)],
    index: 0,
  }));
  const [handledFolderRequest, setHandledFolderRequest] = useState<string | null>(null);
  const currentFolderId = history.locations[history.index];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<FileClipboard | null>(null);
  const [moving, setMoving] = useState<DesktopItem | null>(null);
  const [deleting, setDeleting] = useState<DesktopEntry | null>(null);
  const [trashSelected, setTrashSelected] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploadHover, setUploadHover] = useState(false);
  const [properties, setProperties] = useState<SpaceFile | null>(null);
  const folderId = files.folders.some((folder) => folder.id === currentFolderId)
    ? currentFolderId
    : null;
  const desktopFolder = files.folders.find((folder) => folder.system === 'desktop');
  const shownApps = folderId && folderId === desktopFolder?.id && onOpenApp ? desktopApps : [];
  const trail = folderTrail(files.folders, folderId);
  const entries = desktopEntries(files.files, files.folders, editable);
  const children = entries.filter((entry) => entry.folderId === folderId);
  const folderCount = children.filter((entry) => entry.kind === 'folder').length;
  const count = children.length - folderCount;
  type ExplorerRow =
    | DesktopEntry
    | {
        kind: 'app';
        key: string;
        name: string;
        app: ExplorerAppShortcut;
      };
  const shownItems = explorerView<ExplorerRow>(
    [
      ...children,
      ...shownApps.map((app) => ({
        kind: 'app' as const,
        key: `app:${app.id}`,
        name: app.title,
        app,
      })),
    ],
    search,
    sort,
    locale,
  );
  const rowKeys = shownItems.map((item) => item.key);
  const selectedRow = shownItems.find((item) => item.key === selectedKey);
  const selected = selectedRow?.kind === 'app' ? undefined : selectedRow;
  const selectedApp = selectedRow?.kind === 'app' ? selectedRow.app : undefined;
  const locationName = trashSelected
    ? t('Trash')
    : trail.at(-1)?.system === 'desktop'
      ? t('Home')
      : (trail.at(-1)?.name ?? t('All files'));
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
      setTrashSelected(false);
      setSearch('');
      setSelectedKey(null);
      setCreating(null);
      setDeleting(null);
      setMoving(null);
      setName('');
      setError('');
      setNotice('');
    }
  }
  const loadTrash = files.loadTrash;
  useEffect(() => {
    if (editable) void loadTrash();
  }, [editable, files.storageScope, loadTrash]);
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
    return (
      !trashSelected &&
      !busy &&
      !files.loading &&
      !!source &&
      canMoveEntry(source, files.folders, destination)
    );
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
    setTrashSelected(false);
    setHistory(nextHistory);
    setSearch('');
    setMoving(null);
    setSelectedKey(null);
    setCreating(null);
    setDeleting(null);
    setName('');
    setError('');
    setNotice('');
    requestAnimationFrame(() => directory.current?.focus({ preventScroll: true }));
  }
  function showTrash() {
    navigate(folderId, history);
    setTrashSelected(true);
    void files.loadTrash();
  }
  function stepHistory(direction: -1 | 1) {
    if (trashSelected) {
      if (direction === -1) navigate(folderId, history);
      return;
    }
    const next = stepFolderHistory(history, direction, files.folders);
    navigate(next.locations[next.index], next);
  }
  function open(entry: DesktopEntry) {
    if (entry.kind === 'folder') navigate(entry.id);
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
    if (!creating || creating === 'file' || creating === 'widget') return;
    await run(async () => {
      if (creating === 'folder') {
        const folder = await files.changeFolder({
          action: 'create-folder',
          name,
          parentId: folderId,
        });
        if (folder) {
          setSearch('');
          setSelectedKey(`folder:${folder.id}`);
        }
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
    !trashSelected &&
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
        setSearch('');
        setSelectedKey(`${clipboard.item.kind}:${clipboard.item.id}`);
        setClipboard(null);
        focusSelection();
      } else {
        const result = await commands.paste(clipboard.copy, folderId, entries);
        if (result) {
          setSearch('');
          setSelectedKey(`file:${result.id}`);
        }
        focusSelection();
        setNotice('File pasted as a private draft.');
      }
    });
  }
  function renameKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      !editable ||
      trashSelected ||
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
    if (trashSelected) return;
    if (event.key === 'Escape') {
      setClipboard(null);
      setSelectedKey(null);
      return;
    }
    if (busy || files.loading) return;
    if (
      event.key === 'Delete' &&
      editable &&
      selected &&
      (selected.kind === 'file' || !selected.source.system)
    ) {
      event.preventDefault();
      setDeleting(selected);
      return;
    }
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
  async function moveToTrash() {
    if (!deleting || busy) return;
    await run(async () => {
      if (deleting.kind === 'folder') await files.deleteFolder(deleting.source);
      else await files.deleteFile(deleting.source);
      setDeleting(null);
      setSelectedKey(null);
      setNotice('Moved to Trash.');
      focusSelection();
    });
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
    if (!editable || trashSelected || busy || !selected.length) return;
    setBusy(true);
    setError('');
    try {
      if (files.files.length + selected.length > MAX_SPACE_FILES)
        throw new Error('This space has reached its 30-file limit.');
      // Validate the whole selection before creating any drafts.
      const uploads = await Promise.all(
        selected.map(async (file) => {
          if (!fileNameSchema.safeParse(file.name).success || file.size > MAX_FILE_BYTES)
            throw new Error('Choose a .md, .txt, or .widget file, up to 128 KB.');
          const content = decodeTextFile(file.name, await file.arrayBuffer());
          if (getFileFormat(file.name) === 'widget') parseWidgetSource(content);
          return { name: file.name, content };
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
  function renderBrowser(toolbar: ReactNode, content: ReactNode) {
    return (
      <>
        {toolbar}
        <div className="file-browser">
          <FileSidebar
            folders={files.folders}
            folderId={folderId}
            busy={busy || files.loading}
            onNavigate={navigate}
            dropTarget={dropTarget}
            onTrash={editable ? showTrash : undefined}
            trashSelected={trashSelected}
            trashCount={files.trash.length}
          />
          {content}
        </div>
      </>
    );
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
          event.dataTransfer.dropEffect = editable && !trashSelected && !busy ? 'copy' : 'none';
          setUploadHover(editable && !trashSelected && !busy);
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
      <div className="file-navigation">
        <nav className="file-breadcrumbs" aria-label={t('Folder location')}>
          <button
            type="button"
            aria-label={t('Back')}
            disabled={
              busy || (!trashSelected && stepFolderHistory(history, -1, files.folders) === history)
            }
            onClick={() => stepHistory(-1)}
          >
            <ArrowLeftIcon size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('Forward')}
            disabled={
              busy || trashSelected || stepFolderHistory(history, 1, files.folders) === history
            }
            onClick={() => stepHistory(1)}
          >
            <ArrowRightIcon size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={(!folderId && !trashSelected) || busy}
            aria-label={t('Go to parent folder')}
            onClick={() => navigate(trashSelected ? null : (trail.at(-1)?.parentId ?? null))}
            {...dropTarget(trail.at(-1)?.parentId ?? null, 'folder-up')}
          >
            <ArrowUpIcon weight="regular" aria-hidden="true" size={16} />
          </button>
          <ol>
            <li>
              <button
                type="button"
                disabled={busy}
                aria-current={!folderId && !trashSelected ? 'page' : undefined}
                onClick={() => navigate(null)}
                {...dropTarget(null, 'folder-root')}
              >
                <FolderOpenIcon weight="regular" aria-hidden="true" size={16} />
                {t('Files')}
              </button>
            </li>
            {trashSelected && (
              <li>
                <CaretRightIcon size={14} aria-hidden="true" />
                <button type="button" aria-current="page" disabled={busy} onClick={showTrash}>
                  <TrashIcon size={16} aria-hidden="true" />
                  {t('Trash')}
                </button>
              </li>
            )}
            {!trashSelected &&
              trail.map((folder) => (
                <li key={folder.id}>
                  <CaretRightIcon weight="regular" size={14} aria-hidden="true" />
                  <button
                    type="button"
                    disabled={busy}
                    aria-current={folder.id === folderId ? 'page' : undefined}
                    onClick={() => navigate(folder.id)}
                    {...dropTarget(folder.id, `breadcrumb-${folder.id}`)}
                  >
                    {folder.system === 'desktop' ? t('Home') : folder.name}
                  </button>
                </li>
              ))}
          </ol>
        </nav>
        <div className="file-search">
          <MagnifyingGlassIcon size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={t(trashSelected ? 'Search Trash' : 'Search this folder')}
            placeholder={t('Search {folder}', { folder: locationName })}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelectedKey(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setSearch('');
              }
            }}
          />
          {search && (
            <button type="button" aria-label={t('Clear search')} onClick={() => setSearch('')}>
              <XIcon size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {editable && trashSelected ? (
        <FileTrashView
          renderLayout={renderBrowser}
          entries={files.trash}
          loading={files.trashLoading}
          loadError={files.trashError}
          search={search}
          busy={busy}
          setBusy={setBusy}
          onRefresh={files.loadTrash}
          onRestore={files.restoreTrash}
          onPurge={files.purgeTrash}
          onEmpty={files.emptyTrash}
          onNotice={setNotice}
        />
      ) : (
        renderBrowser(
          <div className="file-toolbar">
            {editable && (
              <div className="file-toolbar-actions file-create-actions">
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger
                    type="button"
                    className="file-new-button"
                    disabled={busy || files.loading}
                  >
                    <PlusIcon size={16} aria-hidden="true" />
                    {t('New')}
                    <CaretDownIcon size={12} aria-hidden="true" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="file-actions-menu file-new-menu"
                      align="start"
                      sideOffset={5}
                      collisionPadding={12}
                      aria-label={t('New')}
                      onCloseAutoFocus={(event) => {
                        if (!createRequested.current) return;
                        event.preventDefault();
                        createRequested.current = false;
                        requestAnimationFrame(() => nameInput.current?.focus());
                      }}
                    >
                      <DropdownMenu.Item
                        disabled={files.files.length >= MAX_SPACE_FILES}
                        onSelect={() => {
                          createRequested.current = true;
                          setCreating('file');
                          setName('');
                          setDeleting(null);
                        }}
                      >
                        <PlusIcon size={16} aria-hidden="true" />
                        {t('New file')}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={files.files.length >= MAX_SPACE_FILES}
                        onSelect={() => {
                          createRequested.current = true;
                          setCreating('widget');
                          setName('');
                          setDeleting(null);
                        }}
                      >
                        <SquaresFourIcon size={16} aria-hidden="true" />
                        {t('New widget')}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={
                          files.folders.filter((folder) => !folder.system).length >=
                            MAX_SPACE_FOLDERS ||
                          trail.filter((folder) => !folder.system).length >= MAX_FOLDER_DEPTH
                        }
                        onSelect={() => {
                          createRequested.current = true;
                          setCreating('folder');
                          setName('');
                          setDeleting(null);
                        }}
                      >
                        <FolderPlusIcon size={16} aria-hidden="true" />
                        {t('New folder')}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
                <button
                  type="button"
                  disabled={busy || files.loading || files.files.length >= MAX_SPACE_FILES}
                  onClick={() => upload.current?.click()}
                  title={t('Uploads: .md, .txt, .widget · Up to 128 KB each')}
                  aria-label={t('Upload')}
                >
                  <UploadSimpleIcon size={16} aria-hidden="true" />
                  <span>{t('Upload')}</span>
                </button>
                <input
                  ref={upload}
                  className="file-upload-input"
                  type="file"
                  multiple
                  accept=".md,.txt,.widget,text/plain,text/markdown"
                  aria-label={t('Upload text file')}
                  onChange={(event) => {
                    const selected = Array.from(event.target.files ?? []);
                    event.target.value = '';
                    void importFiles(selected);
                  }}
                />
              </div>
            )}

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
                    aria-label={t('Properties')}
                    title={t('Properties')}
                    disabled={busy || selected?.kind !== 'file'}
                    onClick={() => {
                      if (selected?.kind === 'file')
                        void run(async () => setProperties(await files.read(selected.id)));
                    }}
                  >
                    <SlidersHorizontalIcon size={16} aria-hidden="true" />
                  </button>
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
                  <button
                    type="button"
                    aria-label={t('Move to Trash')}
                    title={t('Move to Trash')}
                    disabled={
                      busy || !selected || (selected.kind === 'folder' && !!selected.source.system)
                    }
                    onClick={() => {
                      if (!selected) return;
                      setDeleting(selected);
                      setCreating(null);
                      setError('');
                    }}
                  >
                    <TrashIcon size={16} aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
            <label className="file-sort">
              <SortAscendingIcon size={16} aria-hidden="true" />
              <select
                aria-label={t('Sort by')}
                value={sort}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'name-asc' || value === 'name-desc' || value === 'type')
                    setSort(value);
                }}
              >
                <option value="name-asc">{t('Name (A–Z)')}</option>
                <option value="name-desc">{t('Name (Z–A)')}</option>
                <option value="type">{t('Type')}</option>
              </select>
            </label>
          </div>,
          <section className="file-directory" aria-label={locationName}>
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
                  if (creating === 'file' || creating === 'widget') void create(name, '');
                  else void saveEntry();
                }}
              >
                <label htmlFor="new-desktop-filename">
                  {t(
                    creating === 'file' ||
                      creating === 'widget' ||
                      (typeof creating === 'object' && creating.kind === 'file')
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
                      event.currentTarget.setSelectionRange(
                        0,
                        extension > 0 ? extension : value.length,
                      );
                    }}
                    placeholder={
                      creating === 'file' ||
                      creating === 'widget' ||
                      (typeof creating === 'object' && creating.kind === 'file')
                        ? creating === 'widget'
                          ? 'untitled.widget'
                          : 'hello.md'
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
                      (creating === 'widget' && getFileFormat(name.trim()) !== 'widget') ||
                      !(
                        creating === 'file' ||
                        creating === 'widget' ||
                        (typeof creating === 'object' && creating.kind === 'file')
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
                    creating === 'file' ||
                      creating === 'widget' ||
                      (typeof creating === 'object' && creating.kind === 'file')
                      ? creating === 'widget'
                        ? 'Use .widget for a single Discord, GIF, code, or p5.js block.'
                        : 'Use .md for Markdown, .txt for plain text, or .widget for one block.'
                      : 'Folders containing published files are visible to visitors.',
                  )}
                </small>
              </form>
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
            <div className="file-directory-scroll">
              <div className="file-directory-heading" aria-hidden="true">
                <span>{t('Name')}</span>
                <span className="file-list-type">{t('Type')}</span>
                <span>{t('Status')}</span>
              </div>
              {files.loading ? (
                <p className="file-empty" role="status">
                  {t('Loading files…')}
                </p>
              ) : shownItems.length ? (
                <ul className="file-list">
                  {shownItems.map((entry) =>
                    entry.kind === 'app' ? (
                      <FileAppRow
                        key={entry.key}
                        app={entry.app}
                        pinnedTaskbarIds={pinnedTaskbarIds}
                        onToggleTaskbarPin={onToggleTaskbarPin}
                        selected={selectedKey === entry.key}
                        onSelect={() => setSelectedKey(entry.key)}
                        onOpen={() => {
                          if (!busy) onOpenApp?.(entry.app.id);
                        }}
                      />
                    ) : (
                      <FileExplorerRow
                        key={entry.key}
                        entry={entry}
                        pinnedTaskbarIds={pinnedTaskbarIds}
                        onToggleTaskbarPin={onToggleTaskbarPin}
                        editable={editable}
                        selected={selectedKey === entry.key}
                        cut={cutEntry?.key === entry.key}
                        busy={busy}
                        onProperties={() =>
                          void run(async () => setProperties(await files.read(entry.id)))
                        }
                        onDownload={() =>
                          void run(async () => {
                            const file = await files.readDraft(entry.id);
                            const url = URL.createObjectURL(
                              new Blob([file.content], { type: 'text/plain;charset=utf-8' }),
                            );
                            const anchor = document.createElement('a');
                            anchor.href = url;
                            anchor.download = file.name;
                            anchor.click();
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          })
                        }
                        onDesktop={!!desktopFolder && entry.folderId === desktopFolder.id}
                        drag={drag}
                        target={
                          entry.kind === 'folder'
                            ? dropTarget(entry.id, `folder-${entry.id}`)
                            : undefined
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
                          setDeleting(entry);
                          setCreating(null);
                          setError('');
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
                    ),
                  )}
                </ul>
              ) : search.trim() ? (
                <div className="file-empty">
                  <MagnifyingGlassIcon weight="duotone" size={32} aria-hidden="true" />
                  <h3>{t('No matching items')}</h3>
                  <p>{t('Try another name or clear the search.')}</p>
                  <button type="button" onClick={() => setSearch('')}>
                    {t('Clear search')}
                  </button>
                </div>
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
            </div>
          </section>,
        )
      )}
      <footer className="file-statusbar">
        <span>
          {trashSelected ? (
            t(files.trash.length === 1 ? '1 item in Trash' : '{count} items in Trash', {
              count: files.trash.length,
            })
          ) : search.trim() ? (
            t('{count} results', { count: shownItems.length })
          ) : (
            <>
              {t(count === 1 ? '1 file' : '{count} files', { count })}
              {shownApps.length > 0 && (
                <>
                  {' '}
                  ·{' '}
                  {t(shownApps.length === 1 ? '1 app' : '{count} apps', {
                    count: shownApps.length,
                  })}
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
            </>
          )}
          {!trashSelected && selectedRow && <> · {t('1 selected')}</>}
        </span>
        <span role="status">
          {t(
            uploadHover
              ? 'Drop text files here'
              : notice ||
                  (trashSelected
                    ? 'Only you can see Trash.'
                    : editable
                      ? 'Uploads: .md, .txt, .widget · Up to 128 KB each'
                      : 'Published by this space'),
          )}
        </span>
      </footer>
      {deleting && (
        <AlertDialog.Root
          open
          onOpenChange={(open) => {
            if (!open && !busy) setDeleting(null);
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
              <AlertDialog.Title>{t('Move to Trash?')}</AlertDialog.Title>
              <AlertDialog.Description>
                {t(
                  deleting.kind === 'folder'
                    ? 'Move "{name}" and everything inside it to Trash? Published content will be removed from your space.'
                    : 'Move "{name}" to Trash? It will no longer be visible to visitors.',
                  { name: deleting.name },
                )}
              </AlertDialog.Description>
              <p>{t('You can restore it later from Trash. Restored files are private drafts.')}</p>
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
                  disabled={busy}
                  onClick={() => void moveToTrash()}
                >
                  {t(busy ? 'Moving…' : 'Move to Trash')}
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
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
      {editable && properties && (
        <FilePropertiesDialog
          file={properties}
          files={files.files}
          defaultFileId={files.defaultFileId}
          onSave={files.change}
          onClose={() => {
            setProperties(null);
            focusSelection();
          }}
        />
      )}
    </div>
  );
}
