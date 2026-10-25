'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fileActionSchema,
  fileNameSchema,
  type FileAction,
  type SpaceFile,
} from '@/lib/space-files';
import type { FileEditorControls } from './use-desktop-files';
import { normalizeDocumentAppearance, sameDocumentAppearance } from '@/lib/document-appearance';

export function useFileDraft(
  file: SpaceFile,
  editable: boolean,
  change: (action: FileAction) => Promise<SpaceFile | undefined>,
  registerEditor: (id: string, controls: FileEditorControls) => () => void,
) {
  const [draft, setDraft] = useState({
    name: file.name,
    content: file.content,
    appearance: normalizeDocumentAppearance(file.appearance),
  });
  const [saved, setSaved] = useState(file);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const current = useRef(draft);
  const persisted = useRef(file);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isDirty = useCallback(
    () =>
      current.current.name.trim() !== persisted.current.name ||
      current.current.content !== persisted.current.content ||
      !sameDocumentAppearance(current.current.appearance, persisted.current.appearance),
    [],
  );

  const flush = useCallback(
    async function flushDraft(): Promise<boolean> {
      clearTimeout(timer.current);
      if (!editable) return true;
      while (inFlight.current) {
        if (!(await inFlight.current)) return false;
      }
      if (!isDirty()) return true;
      const action = {
        action: 'save' as const,
        id: file.id,
        version: persisted.current.version,
        ...current.current,
      };
      if (!fileActionSchema.safeParse(action).success) {
        setError('Use a valid .md or .txt filename and plain text up to 64 KB.');
        return false;
      }
      setSaving(true);
      setError('');
      const promise = (async () => {
        try {
          const next = (await change(action))!;
          persisted.current = next;
          setSaved(next);
          return true;
        } catch (error) {
          setError((error as Error).message);
          return false;
        } finally {
          setSaving(false);
          inFlight.current = null;
        }
      })();
      inFlight.current = promise;
      if (!(await promise)) return false;
      // A keystroke during the request must be saved too, without replacing the input value.
      return isDirty() ? flushDraft() : true;
    },
    [editable, file.id, change, isDirty],
  );

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (editable && (isDirty() || inFlight.current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [editable, isDirty]);

  function edit(value: Partial<typeof draft>) {
    current.current = { ...current.current, ...value };
    setDraft(current.current);
    setError('');
    clearTimeout(timer.current);
    if (editable) timer.current = setTimeout(() => void flush(), 900);
  }
  const manage = useCallback(
    async (
      action: 'publish' | 'unpublish' | 'pin' | 'delete' | 'move',
      folderId?: string | null,
    ) => {
      if (!(await flush())) return false;
      setSaving(true);
      setError('');
      const promise = (async () => {
        try {
          const submitted = persisted.current;
          const next = await change({
            action,
            id: file.id,
            version: persisted.current.version,
            ...(action === 'pin' ? { pinned: !persisted.current.pinned } : {}),
            ...(action === 'move' ? { folderId: folderId ?? null } : {}),
          } as FileAction);
          if (next) {
            persisted.current = next;
            setSaved(next);
            // Publication can normalize card URLs/source. Keep later keystrokes intact.
            if (action === 'publish' && current.current.content === submitted.content) {
              current.current = { ...current.current, content: next.content };
              setDraft(current.current);
            }
          }
          return true;
        } catch (error) {
          setError((error as Error).message);
          return false;
        } finally {
          setSaving(false);
          inFlight.current = null;
        }
      })();
      inFlight.current = promise;
      return promise;
    },
    [change, file.id, flush],
  );
  const rename = useCallback(
    async (name: string) => {
      if (!editable) return false;
      const parsed = fileNameSchema.safeParse(name);
      if (!parsed.success) {
        setError('Use a .md or .txt filename without folders.');
        return false;
      }
      if (!(await flush())) return false;
      current.current = { ...current.current, name: parsed.data };
      setDraft(current.current);
      if (await flush()) return true;
      // A rejected rename must not trap subsequent content edits behind the failed name.
      // Preserve any text typed while saving and any name already accepted by the server.
      if (current.current.name === parsed.data) {
        current.current = { ...current.current, name: persisted.current.name };
        setDraft(current.current);
      }
      return false;
    },
    [editable, flush],
  );
  useEffect(
    () =>
      registerEditor(file.id, {
        flush,
        togglePin: () => manage('pin'),
        move: (folderId) => manage('move', folderId),
        rename,
      }),
    [file.id, flush, manage, rename, registerEditor],
  );
  return {
    draft,
    saved,
    edit,
    flush,
    manage,
    saving,
    error,
    dirty:
      draft.name.trim() !== saved.name ||
      draft.content !== saved.content ||
      !sameDocumentAppearance(draft.appearance, saved.appearance),
  };
}
