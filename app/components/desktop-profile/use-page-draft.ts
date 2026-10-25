'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeDocumentAppearance, type DocumentAppearance } from '@/lib/document-appearance';
import {
  restorePageDraft,
  samePageDraft,
  serializePageDraft,
  type PageDraft,
  type PageDraftValue,
} from '@/lib/page-draft';

type DraftState = PageDraft & { published: PageDraftValue; ready: boolean; durable: boolean };

/** Content and appearance share one recoverable draft and one publication boundary. */
export function usePageDraft({
  spaceId,
  tabId,
  published: publishedSource,
  appearance,
  editable,
  registerGuard,
}: {
  spaceId: string;
  tabId: string;
  published: string;
  appearance?: DocumentAppearance;
  editable: boolean;
  registerGuard?: (id: string, guard: () => Promise<boolean>) => () => void;
}) {
  const key = `wya:page-draft:v1:${spaceId}:${tabId}`;
  const published = useMemo(
    () => ({
      source: publishedSource,
      appearance: normalizeDocumentAppearance(appearance),
    }),
    [publishedSource, appearance],
  );
  const [state, setState] = useState<DraftState>({
    published,
    value: published,
    base: published,
    ready: !editable,
    durable: true,
  });
  if (!samePageDraft(state.published, published)) {
    const clean = samePageDraft(state.value, state.base) || samePageDraft(state.value, published);
    setState({ ...state, published, ...(clean ? { value: published, base: published } : {}) });
  }
  const current = useRef(state);
  useEffect(() => {
    current.current = state;
  }, [state]);

  const persist = useCallback(
    (draft: PageDraft, publicValue: PageDraftValue) => {
      try {
        if (samePageDraft(draft.value, publicValue) || samePageDraft(draft.value, draft.base))
          localStorage.removeItem(key);
        else localStorage.setItem(key, serializePageDraft(draft));
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
    void Promise.resolve().then(() => {
      if (cancelled) return;
      let draft: PageDraft | null = null;
      let durable = true;
      try {
        const raw = localStorage.getItem(key);
        draft = restorePageDraft(raw ? JSON.parse(raw) : null, current.current.published);
      } catch {
        durable = false;
      }
      setState((previous) => ({
        ...previous,
        ...(draft ?? (durable ? { value: previous.published, base: previous.published } : {})),
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
      if (
        !draft.ready ||
        samePageDraft(draft.value, draft.published) ||
        samePageDraft(draft.value, draft.base)
      )
        return true;
      const durable = persist(draft, draft.published);
      if (!durable) setState((previous) => ({ ...previous, durable: false }));
      return durable;
    });
  }, [editable, persist, registerGuard, tabId]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      const draft = current.current;
      if (editable && !draft.durable && !samePageDraft(draft.value, draft.base)) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [editable]);

  function update(change: Partial<PageDraftValue>) {
    const value = { ...current.current.value, ...change };
    const next = {
      ...current.current,
      value,
      ...(samePageDraft(value, published) ? { base: published } : {}),
    };
    next.durable = persist(next, published);
    current.current = next;
    setState(next);
  }
  function reset(source = published.source, nextAppearance = published.appearance) {
    const value = { source, appearance: nextAppearance };
    const next = { ...current.current, value, base: value, published: value, durable: true };
    persist(next, value);
    current.current = next;
    setState(next);
  }
  return {
    source: state.value.source,
    appearance: state.value.appearance,
    dirty: !samePageDraft(state.value, published) && !samePageDraft(state.value, state.base),
    conflict: !samePageDraft(state.value, state.base) && !samePageDraft(state.base, published),
    ready: state.ready,
    durable: state.durable,
    edit: (source: string) => update({ source }),
    editAppearance: (appearance: DocumentAppearance) => update({ appearance }),
    reset,
  };
}
