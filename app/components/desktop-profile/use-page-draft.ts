'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_PAGE_DOCUMENT_BYTES, normalizePageSource } from '@/lib/page-documents';

type Draft = { source: string; baseSource: string };
type DraftState = Draft & { published: string; ready: boolean; durable: boolean };

function readableSource(source: string) {
  try {
    return normalizePageSource(source);
  } catch {
    // Incomplete source is still the user's draft and must remain recoverable.
    return source;
  }
}

/** Page drafts stay on this device. Navigation never publishes an unfinished document. */
export function usePageDraft({
  spaceId,
  tabId,
  published,
  editable,
  registerGuard,
}: {
  spaceId: string;
  tabId: string;
  published: string;
  editable: boolean;
  registerGuard?: (id: string, guard: () => Promise<boolean>) => () => void;
}) {
  const key = `wya:page-draft:v1:${spaceId}:${tabId}`;
  const [state, setState] = useState<DraftState>({
    published,
    source: published,
    baseSource: published,
    ready: !editable,
    durable: true,
  });
  if (state.published !== published) {
    const clean = state.source === state.baseSource || state.source === published;
    setState({
      ...state,
      published,
      ...(clean ? { source: published, baseSource: published } : {}),
    });
  }
  const current = useRef(state);
  useEffect(() => {
    current.current = state;
  }, [state]);

  const persist = useCallback(
    (draft: Draft, publicSource: string) => {
      try {
        if (draft.source === publicSource || draft.source === draft.baseSource)
          localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify({ version: 1, ...draft }));
        return true;
      } catch {
        return false;
      }
    },
    [key],
  );

  useEffect(() => {
    if (!editable) return;
    let cancelled = false;
    // Restore only in the owner's browser, after the server-rendered view has hydrated.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      let draft: Draft | null = null;
      let durable = true;
      try {
        const raw = localStorage.getItem(key);
        const saved: unknown = raw ? JSON.parse(raw) : null;
        if (
          saved &&
          typeof saved === 'object' &&
          'version' in saved &&
          saved.version === 1 &&
          'source' in saved &&
          typeof saved.source === 'string' &&
          saved.source.length <= MAX_PAGE_DOCUMENT_BYTES &&
          'baseSource' in saved &&
          typeof saved.baseSource === 'string' &&
          saved.baseSource.length <= MAX_PAGE_DOCUMENT_BYTES
        ) {
          const source = readableSource(saved.source);
          if (source !== current.current.published)
            draft = { source, baseSource: readableSource(saved.baseSource) };
        }
      } catch {
        durable = false;
      }
      setState((previous) => ({
        ...previous,
        ...(draft ??
          (durable ? { source: previous.published, baseSource: previous.published } : {})),
        ready: true,
        durable,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [editable, key]);

  useEffect(() => {
    if (!editable || !registerGuard) return;
    return registerGuard(`page-${tabId}`, async () => {
      const draft = current.current;
      if (!draft.ready || draft.source === draft.published || draft.source === draft.baseSource)
        return true;
      const durable = persist(draft, draft.published);
      if (!durable) setState((previous) => ({ ...previous, durable: false }));
      return durable;
    });
  }, [editable, persist, registerGuard, tabId]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      const draft = current.current;
      if (editable && !draft.durable && draft.source !== draft.baseSource) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [editable]);

  function edit(source: string) {
    const next = {
      ...state,
      source,
      ...(source === published ? { baseSource: published } : {}),
    };
    next.durable = persist(next, published);
    current.current = next;
    setState(next);
  }
  function reset(source = published) {
    const next = { ...state, source, baseSource: source, published: source, durable: true };
    persist(next, source);
    current.current = next;
    setState(next);
  }
  return {
    source: state.source,
    dirty: state.source !== published && state.source !== state.baseSource,
    conflict: state.source !== state.baseSource && state.baseSource !== published,
    ready: state.ready,
    durable: state.durable,
    edit,
    reset,
  };
}
