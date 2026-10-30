'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { type FileAction, type SpaceFile } from '@/lib/space-files';
import { FileDraftSession } from '@/lib/file-draft-session';
import {
  fileDraftStorageKey,
  legacyPageDraftKey,
  recoverFileDraft,
  recoverLegacyFileDraft,
  serializeFileDraft,
} from '@/lib/file-draft-recovery';
import type { FileEditorControls } from './use-files';

type Recovery = NonNullable<ReturnType<typeof recoverFileDraft>> & { legacy: boolean };
const localFailure = 'Could not keep a local copy. Save or download your changes before closing.';

/** React and browser-storage adapter. Only explicit session commands write to the server. */
export function useFileDraft(
  file: SpaceFile,
  spaceId: string,
  change: (action: FileAction) => Promise<SpaceFile | undefined>,
  registerEditor: (id: string, controls: FileEditorControls) => () => void,
) {
  const [session] = useState(() => new FileDraftSession(file, change));
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [localError, setLocalError] = useState('');
  const recoveryPending = useRef(false);
  const recoverySource = useRef<{ key: string; raw: string } | null>(null);
  const localRaw = useRef<string | null>(null);
  const key = fileDraftStorageKey(spaceId, file.id);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => session.configure(change), [session, change]);
  const checkpoint = useCallback(async () => {
    clearTimeout(timer.current);
    if (recoveryPending.current) return true;
    try {
      const existing = localStorage.getItem(key);
      // Never erase or overwrite a recovery copy written by another browser tab.
      if (existing !== localRaw.current) {
        if (!session.dirty) return true;
        throw new Error('Another tab changed the local draft.');
      }
      if (session.dirty) {
        const raw = serializeFileDraft(session.draft, session.saved);
        if (!recoverFileDraft(raw, session.saved)) throw new Error('Invalid local draft.');
        if (existing !== raw) localStorage.setItem(key, raw);
        localRaw.current = raw;
      } else if (existing !== null) {
        localStorage.removeItem(key);
        localRaw.current = null;
      }
      setLocalError('');
      return true;
    } catch {
      setLocalError(localFailure);
      return !session.dirty;
    }
  }, [key, session]);

  useEffect(() => {
    try {
      localRaw.current = localStorage.getItem(key);
      const local = recoverFileDraft(localRaw.current, session.saved);
      const legacyKey = file.legacyTabId ? legacyPageDraftKey(spaceId, file.legacyTabId) : null;
      const legacyRaw = !local && legacyKey ? localStorage.getItem(legacyKey) : null;
      const legacy = recoverLegacyFileDraft(legacyRaw, session.saved);
      if (local || legacy) {
        recoveryPending.current = true;
        recoverySource.current = local
          ? { key, raw: localRaw.current! }
          : { key: legacyKey!, raw: legacyRaw! };
        setRecovery(
          local
            ? { ...local, legacy: false }
            : { ...legacy!, name: session.saved.name, legacy: true },
        );
      }
    } catch {
      // Editing remains available; checkpoint reports storage failures when needed.
    }
    // One recovery decision per mounted editor, not after every server response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const unsubscribe = session.subscribe(() => {
      render();
      clearTimeout(timer.current);
      // Small local-only writes are coalesced. No timer ever calls the backend.
      timer.current = setTimeout(() => void checkpoint(), 300);
    });
    function beforeUnload(event: BeforeUnloadEvent) {
      void checkpoint();
      if (session.dirty || session.saving) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    const pageHide = () => void checkpoint();
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', pageHide);
    return () => {
      unsubscribe();
      void checkpoint();
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', pageHide);
    };
  }, [checkpoint, session]);
  useEffect(() => session.accept(file), [file, session]);

  function clearRecovery() {
    const source = recoverySource.current;
    try {
      if (source && localStorage.getItem(source.key) === source.raw) {
        localStorage.removeItem(source.key);
        if (source.key === key) localRaw.current = null;
      }
    } catch {
      setLocalError(localFailure);
      return false;
    }
    recoverySource.current = null;
    recoveryPending.current = false;
    setRecovery(null);
    return true;
  }
  async function restoreRecovery() {
    if (!recovery) return;
    const { name, content, appearance } = recovery;
    if (!clearRecovery()) return;
    session.edit({ name, content, appearance });
    await checkpoint();
  }

  const manage = useCallback(
    (...args: Parameters<FileDraftSession['manage']>) =>
      !recoveryPending.current ? session.manage(...args) : Promise.resolve(false),
    [session],
  );
  const rename = useCallback(
    (name: string) => (!recoveryPending.current ? session.rename(name) : Promise.resolve(false)),
    [session],
  );

  useEffect(
    () =>
      registerEditor(file.id, {
        checkpoint,
        trash: () => manage('delete'),
        move: (folderId) => manage('move', folderId),
        rename,
      }),
    [file.id, checkpoint, manage, rename, session, registerEditor],
  );
  return {
    draft: session.draft,
    saved: session.saved,
    dirty: session.dirty,
    saving: session.saving,
    error: session.error,
    localError,
    recovery,
    restoreRecovery,
    discardRecovery: clearRecovery,
    edit: (value: Parameters<FileDraftSession['edit']>[0]) => session.edit(value),
    save: () => (!recoveryPending.current ? session.save() : Promise.resolve(false)),
    manage,
    rename,
  };
}
