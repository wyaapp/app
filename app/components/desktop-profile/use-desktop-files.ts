'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fileInfo, type FileAction, type SpaceFile, type SpaceFileInfo } from '@/lib/space-files';
import { applyFileOrderPatch } from '@/lib/file-navigation';
import { requestFiles } from '@/lib/file-client';
import type { FolderAction, SpaceFolder } from '@/lib/space-folders';
import type { TrashAction, TrashEntryInfo } from '@/lib/space-trash';

export type FileGuard = () => Promise<boolean>;
export type FileEditorControls = {
  flush: FileGuard;
  togglePin: FileGuard;
  move: (folderId: string | null) => Promise<boolean>;
  rename: (name: string) => Promise<boolean>;
  trash: FileGuard;
};
export function useDesktopFiles(
  spaceId: string,
  handle: string,
  editable: boolean,
  onFilesChanged?: () => Promise<void>,
) {
  const endpoint = editable
    ? `/api/files?spaceId=${encodeURIComponent(spaceId)}`
    : `/api/public-files?handle=${encodeURIComponent(handle)}`;
  const [state, setState] = useState<{
    scope: string;
    files: SpaceFileInfo[];
    documents: SpaceFile[];
    folders: SpaceFolder[];
    defaultFileId: string | null;
  }>({ scope: endpoint, files: [], documents: [], folders: [], defaultFileId: null });
  const [listing, setListing] = useState({ scope: endpoint, loading: true, error: '' });
  const [documentError, setDocumentError] = useState({ scope: endpoint, message: '' });
  const [trashState, setTrashState] = useState<{
    scope: string;
    entries: TrashEntryInfo[];
    loading: boolean;
    error: string;
  }>({ scope: endpoint, entries: [], loading: false, error: '' });
  const metadataError = listing.scope === endpoint ? listing.error : '';
  const error = metadataError || (documentError.scope === endpoint ? documentError.message : '');
  const editors = useRef(new Map<string, FileEditorControls>());
  const changed = useRef(onFilesChanged);
  useEffect(() => {
    changed.current = onFilesChanged;
  }, [onFilesChanged]);
  const scope = useRef(endpoint);
  useEffect(() => {
    scope.current = endpoint;
  }, [endpoint]);

  const request = requestFiles;
  const load = useCallback(
    () =>
      request(endpoint)
        .then((result) => {
          if (scope.current !== endpoint) return;
          setState((previous) => ({
            scope: endpoint,
            files: result.files!,
            folders: result.folders!,
            defaultFileId: result.defaultFileId ?? null,
            documents:
              previous.scope === endpoint
                ? previous.documents.filter((file) =>
                    result.files!.some((item) => item.id === file.id),
                  )
                : [],
          }));
          setListing({ scope: endpoint, loading: false, error: '' });
        })
        .catch((error: Error) => {
          if (scope.current === endpoint)
            setListing({ scope: endpoint, loading: false, error: error.message });
        }),
    [endpoint, request],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const loadTrash = useCallback(async () => {
    if (!editable) return;
    setTrashState((previous) => ({
      scope: endpoint,
      entries: previous.scope === endpoint ? previous.entries : [],
      loading: true,
      error: '',
    }));
    try {
      const result = await request(`${endpoint}&trash=1`);
      if (scope.current === endpoint)
        setTrashState({ scope: endpoint, entries: result.trash ?? [], loading: false, error: '' });
    } catch (error) {
      if (scope.current === endpoint)
        setTrashState((previous) => ({
          ...previous,
          loading: false,
          error: (error as Error).message,
        }));
    }
  }, [editable, endpoint, request]);
  function reload() {
    setListing({ scope: endpoint, loading: true, error: '' });
    setDocumentError({ scope: endpoint, message: '' });
    return load();
  }

  const change = useCallback(
    async (action: FileAction) => {
      if (!editable) throw new Error('Sign in to edit files.');
      const result = await request(endpoint, action);
      if (scope.current !== endpoint) throw new Error('The active space changed.');
      setState((previous) => {
        const files = previous.files.filter(
          (file) => file.id !== (result.file?.id ?? result.deleted),
        );
        if (result.file) files.push(fileInfo(result.file));
        return {
          ...previous,
          defaultFileId:
            result.defaultFileId === undefined ? previous.defaultFileId : result.defaultFileId,
          files: files
            .map((file) => applyFileOrderPatch(file, result.reorderedFiles ?? []))
            .sort((a, b) => a.name.localeCompare(b.name)),
          documents: result.deleted
            ? previous.documents.filter((file) => file.id !== result.deleted)
            : previous.documents.map((file) =>
                file.id === result.file?.id
                  ? result.file
                  : applyFileOrderPatch(file, result.reorderedFiles ?? []),
              ),
        };
      });
      if (action.action === 'properties') await load();
      if (action.action === 'delete') await loadTrash();
      if (['publish', 'unpublish', 'delete', 'properties'].includes(action.action)) {
        // Refresh the public card index/default metadata after publication, not each keystroke.
        // The write already succeeded; a metadata refresh failure must not invite resubmission.
        try {
          await changed.current?.();
        } catch {
          setDocumentError({
            scope: endpoint,
            message: 'The file was saved. Reload to refresh its published details.',
          });
        }
      }
      return result.file;
    },
    [editable, endpoint, request, load, loadTrash],
  );

  const read = useCallback(
    async (id: string) => {
      const editor = editors.current.get(id);
      if (editor && !(await editor.flush()))
        throw new Error('Could not save this file. Open it to check your changes.');
      const result = await request(`${endpoint}&id=${encodeURIComponent(id)}`);
      if (scope.current !== endpoint) throw new Error('The active space changed.');
      const file = result.file!;
      setState((previous) => ({
        ...previous,
        files: previous.files.map((item) => (item.id === id ? fileInfo(file) : item)),
        documents: previous.documents.map((item) => (item.id === id ? file : item)),
      }));
      return file;
    },
    [endpoint, request],
  );

  async function rename(file: SpaceFileInfo, name: string) {
    if (!editable) throw new Error('Sign in to edit files.');
    const editor = editors.current.get(file.id);
    if (editor) {
      if (!(await editor.rename(name)))
        throw new Error('Could not rename this file. Open it to check your changes.');
    } else {
      const latest = await read(file.id);
      await change({
        action: 'save',
        id: file.id,
        version: latest.version,
        name,
        content: latest.content,
      });
    }
  }

  const open = useCallback(
    async (id: string) => {
      setDocumentError({ scope: endpoint, message: '' });
      if (state.scope === endpoint && state.documents.some((file) => file.id === id)) return true;
      try {
        const result = await request(`${endpoint}&id=${encodeURIComponent(id)}`);
        if (scope.current !== endpoint) return false;
        setState((previous) => ({
          ...previous,
          documents: [...previous.documents.filter((file) => file.id !== id), result.file!],
        }));
        return true;
      } catch (error) {
        if (scope.current === endpoint)
          setDocumentError({ scope: endpoint, message: (error as Error).message });
        return false;
      }
    },
    [state.scope, state.documents, endpoint, request],
  );
  const registerEditor = useCallback((id: string, controls: FileEditorControls) => {
    editors.current.set(id, controls);
    return () => {
      editors.current.delete(id);
    };
  }, []);
  async function togglePin(file: SpaceFileInfo) {
    // An open editor owns its current version and any pending autosave.
    const editor = editors.current.get(file.id);
    if (editor) {
      if (!(await editor.togglePin()))
        throw new Error('Could not update the Home shortcut. Open the file to check your changes.');
    } else {
      await change({ action: 'pin', id: file.id, version: file.version, pinned: !file.pinned });
    }
  }
  async function move(file: SpaceFileInfo, folderId: string | null) {
    const editor = editors.current.get(file.id);
    if (editor) {
      if (!(await editor.move(folderId)))
        throw new Error('Could not move this file. Open it to check your changes.');
    } else {
      await change({ action: 'move', id: file.id, version: file.version, folderId });
    }
  }
  async function changeFolder(action: FolderAction) {
    if (!editable) throw new Error('Sign in to edit files.');
    const result = await request(endpoint, action);
    if (scope.current !== endpoint) throw new Error('The active space changed.');
    setState((previous) => {
      const folders = previous.folders.filter(
        (folder) => folder.id !== (result.folder?.id ?? result.deletedFolder),
      );
      if (result.folder) folders.push(result.folder);
      return { ...previous, folders: folders.sort((a, b) => a.name.localeCompare(b.name)) };
    });
    return result.folder;
  }
  const flushAll = useCallback(async () => {
    for (const editor of editors.current.values()) if (!(await editor.flush())) return false;
    return true;
  }, []);
  async function deleteFile(file: SpaceFileInfo) {
    if (!editable) throw new Error('Sign in to edit files.');
    const editor = editors.current.get(file.id);
    if (editor) {
      if (!(await editor.trash()))
        throw new Error('Could not move this file to Trash. Open it to check your changes.');
    } else {
      const latest = await read(file.id);
      await change({ action: 'delete', id: latest.id, version: latest.version });
    }
  }
  async function refreshAfterTrash() {
    await Promise.all([load(), loadTrash()]);
    if (scope.current !== endpoint) return;
    try {
      await changed.current?.();
    } catch {
      setDocumentError({
        scope: endpoint,
        message: 'Your changes were saved. Reload to refresh your space.',
      });
    }
  }
  async function deleteFolder(folder: SpaceFolder) {
    if (!editable) throw new Error('Sign in to edit files.');
    if (!(await flushAll()))
      throw new Error(
        'Could not save open files. Check your changes before moving this folder to Trash.',
      );
    const result = await request(endpoint, {
      action: 'delete-folder',
      id: folder.id,
      version: folder.version,
    });
    if (scope.current !== endpoint) throw new Error('The active space changed.');
    const removed = new Set(result.deletedIds ?? []);
    const removedFolders = new Set(result.deletedFolderIds ?? [folder.id]);
    setState((previous) => ({
      ...previous,
      files: result.files ?? previous.files.filter((file) => !removed.has(file.id)),
      folders: result.folders ?? previous.folders.filter((item) => !removedFolders.has(item.id)),
      documents: previous.documents.filter((file) => !removed.has(file.id)),
      defaultFileId:
        result.defaultFileId === undefined ? previous.defaultFileId : result.defaultFileId,
    }));
    await refreshAfterTrash();
  }
  async function changeTrash(action: TrashAction) {
    if (!editable) throw new Error('Sign in to edit files.');
    const result = await request(endpoint, action);
    if (scope.current !== endpoint) throw new Error('The active space changed.');
    if (result.trash)
      setTrashState({ scope: endpoint, entries: result.trash, loading: false, error: '' });
    await refreshAfterTrash();
  }
  return {
    files: state.scope === endpoint ? state.files : [],
    folders: state.scope === endpoint ? state.folders : [],
    defaultFileId: state.scope === endpoint ? state.defaultFileId : null,
    documents: state.scope === endpoint ? state.documents : [],
    scope: endpoint,
    storageScope: `${spaceId}:${editable ? 'owner' : 'visitor'}`,
    loading: listing.scope !== endpoint || listing.loading,
    metadataError,
    error,
    trash: trashState.scope === endpoint && editable ? trashState.entries : [],
    trashLoading: trashState.scope === endpoint && trashState.loading,
    trashError: trashState.scope === endpoint ? trashState.error : '',
    loadTrash,
    deleteFile,
    deleteFolder,
    restoreTrash: (entry: TrashEntryInfo) =>
      changeTrash({ action: 'restore-trash', id: entry.id, version: entry.version }),
    purgeTrash: (entry: TrashEntryInfo) =>
      changeTrash({ action: 'purge-trash', id: entry.id, version: entry.version }),
    emptyTrash: (entries: TrashEntryInfo[]) =>
      changeTrash({
        action: 'empty-trash',
        entries: entries.map(({ id, version }) => ({ id, version })),
      }),
    reload,
    open,
    read,
    rename,
    change,
    registerEditor,
    togglePin,
    move,
    changeFolder,
    flushAll,
  };
}
