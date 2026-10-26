'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fileInfo, type FileAction, type SpaceFile, type SpaceFileInfo } from '@/lib/space-files';
import type { FolderAction, SpaceFolder } from '@/lib/space-folders';
import type { PageFileAction, SpacePageFile } from '@/lib/space-page-files';

export type FileGuard = () => Promise<boolean>;
export type FileEditorControls = {
  flush: FileGuard;
  togglePin: FileGuard;
  move: (folderId: string | null) => Promise<boolean>;
  rename: (name: string) => Promise<boolean>;
};
export function useDesktopFiles(spaceId: string, handle: string, editable: boolean) {
  const endpoint = editable
    ? `/api/files?spaceId=${encodeURIComponent(spaceId)}`
    : `/api/public-files?handle=${encodeURIComponent(handle)}`;
  const [state, setState] = useState<{
    scope: string;
    files: SpaceFileInfo[];
    documents: SpaceFile[];
    folders: SpaceFolder[];
    pages: SpacePageFile[];
  }>({ scope: endpoint, files: [], documents: [], folders: [], pages: [] });
  const [listing, setListing] = useState({ scope: endpoint, loading: true, error: '' });
  const [documentError, setDocumentError] = useState({ scope: endpoint, message: '' });
  const metadataError = listing.scope === endpoint ? listing.error : '';
  const error = metadataError || (documentError.scope === endpoint ? documentError.message : '');
  const editors = useRef(new Map<string, FileEditorControls>());
  const scope = useRef(endpoint);
  useEffect(() => {
    scope.current = endpoint;
  }, [endpoint]);

  const request = useCallback(
    async (url: string, action?: FileAction | FolderAction | PageFileAction) => {
      const response = await fetch(
        url,
        action
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(action),
            }
          : { cache: 'no-store' },
      );
      const result = (await response.json()) as {
        error?: string;
        files?: SpaceFileInfo[];
        file?: SpaceFile;
        deleted?: string;
        folders?: SpaceFolder[];
        folder?: SpaceFolder;
        deletedFolder?: string;
        pages?: SpacePageFile[];
        page?: SpacePageFile;
      };
      if (!response.ok)
        throw new Error(result.error || 'Could not load or save files. Please try again.');
      return result;
    },
    [],
  );
  const load = useCallback(
    () =>
      request(endpoint)
        .then((result) => {
          if (scope.current !== endpoint) return;
          setState((previous) => ({
            scope: endpoint,
            files: result.files!,
            folders: result.folders!,
            pages: result.pages!,
            documents: previous.scope === endpoint ? previous.documents : [],
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
          files: files.sort((a, b) => a.name.localeCompare(b.name)),
          documents: result.deleted
            ? previous.documents.filter((file) => file.id !== result.deleted)
            : previous.documents.map((file) => (file.id === result.file?.id ? result.file : file)),
        };
      });
      return result.file;
    },
    [editable, endpoint, request],
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
  async function changePage(action: PageFileAction) {
    if (!editable) throw new Error('Sign in to edit files.');
    const result = await request(endpoint, action);
    if (scope.current !== endpoint) throw new Error('The active space changed.');
    setState((previous) => ({
      ...previous,
      pages: [...previous.pages.filter((page) => page.id !== result.page!.id), result.page!],
    }));
  }
  const flushAll = useCallback(async () => {
    for (const editor of editors.current.values()) if (!(await editor.flush())) return false;
    return true;
  }, []);
  return {
    files: state.scope === endpoint ? state.files : [],
    folders: state.scope === endpoint ? state.folders : [],
    pages: state.scope === endpoint ? state.pages : [],
    documents: state.scope === endpoint ? state.documents : [],
    scope: endpoint,
    storageScope: `${spaceId}:${editable ? 'owner' : 'visitor'}`,
    loading: listing.scope !== endpoint || listing.loading,
    metadataError,
    error,
    reload,
    open,
    read,
    rename,
    change,
    registerEditor,
    togglePin,
    move,
    changeFolder,
    changePage,
    flushAll,
  };
}
