'use client';

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import {
  createDesktopSession,
  desktopSessionKey,
  loadDesktopSession,
  needsSessionRestore,
  saveDesktopSession,
  sessionPoint,
  taskbarPinIds,
  withInitialActiveWindow,
  type DesktopSession,
  type DesktopSessionScope,
  type SessionStorage,
  type SessionRestoration,
} from './desktop-session';
import { windowReducer, type Point, type WindowAction, type WindowState } from './window-state';

type State = {
  key: string;
  ready: boolean;
  windows: WindowState;
  positions: Record<string, Point>;
  pinnedIds: string[];
};
type Action =
  | { type: 'restore'; key: string; session: DesktopSession }
  | { type: 'window'; key: string; action: WindowAction }
  | { type: 'position'; key: string; id: string; point: Point }
  | { type: 'toggle-pin'; key: string; id: string; pinnableIds: string[] }
  | {
      type: 'reconcile';
      key: string;
      scope: DesktopSessionScope;
      availableIds: string[];
      pinnableIds: string[];
    };

function reducer(state: State, action: Action): State {
  if (action.type === 'restore') {
    return {
      key: action.key,
      ready: true,
      windows: {
        ...action.session.windows,
        // Owner forms stay mounted through visitor preview; document contents are scope-specific.
        loaded: [
          ...new Set([
            ...state.windows.loaded.filter((id) => !id.startsWith('file-')),
            ...action.session.windows.loaded,
          ]),
        ],
      },
      positions: action.session.positions,
      pinnedIds: action.session.pinnedIds,
    };
  }
  if (state.key !== action.key || !state.ready) return state;
  if (action.type === 'window') {
    const windows = windowReducer(state.windows, action.action);
    if (windows === state.windows && action.action.type !== 'reset') return state;
    return {
      ...state,
      windows,
      positions: action.action.type === 'reset' ? {} : state.positions,
    };
  }
  if (action.type === 'position') {
    const point = sessionPoint(action.point);
    const previous = state.positions[action.id];
    return !point || (point.x === previous?.x && point.y === previous.y)
      ? state
      : { ...state, positions: { ...state.positions, [action.id]: point } };
  }
  if (action.type === 'toggle-pin') {
    const pinnedIds = taskbarPinIds(
      state.pinnedIds.includes(action.id)
        ? state.pinnedIds.filter((id) => id !== action.id)
        : [...state.pinnedIds, action.id],
      action.pinnableIds,
    );
    return JSON.stringify(pinnedIds) === JSON.stringify(state.pinnedIds)
      ? state
      : { ...state, pinnedIds };
  }
  const next = createDesktopSession(
    action.scope,
    state.windows,
    state.positions,
    action.availableIds,
    state.pinnedIds,
    action.pinnableIds,
  );
  const windows = {
    ...next.windows,
    loaded: state.windows.loaded.filter(
      (id) => !id.startsWith('file-') || action.availableIds.includes(id),
    ),
  };
  if (
    JSON.stringify(windows) === JSON.stringify(state.windows) &&
    JSON.stringify(next.positions) === JSON.stringify(state.positions) &&
    JSON.stringify(next.pinnedIds) === JSON.stringify(state.pinnedIds)
  )
    return state;
  return { ...state, windows, positions: next.positions, pinnedIds: next.pinnedIds };
}

function browserStorage(): SessionStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useDesktopSession({
  spaceId,
  mode,
  initialState,
  initialActiveId,
  availableIds,
  pinnableIds = availableIds,
  metadataReady,
  metadataError = false,
  loadedDocumentIds = [],
  restoreDocuments,
  enabled = true,
  idAliases = {},
}: DesktopSessionScope & {
  initialState: WindowState;
  /** Applied only when restoring this scope, never when resizing or switching windows. */
  initialActiveId?: string;
  availableIds: string[];
  pinnableIds?: string[];
  metadataReady: boolean;
  metadataError?: boolean;
  /** Raw file IDs already available in this scope, including the server snapshot. */
  loadedDocumentIds?: readonly string[];
  restoreDocuments?: (ids: string[]) => Promise<string[]>;
  enabled?: boolean;
  idAliases?: Record<string, string>;
}) {
  const scope = { spaceId, mode };
  const key = desktopSessionKey(scope);
  const [state, send] = useReducer(reducer, {
    key,
    ready: false,
    windows: initialState,
    positions: {},
    pinnedIds: [],
  });
  const current = useRef({
    initialState,
    initialActiveId,
    availableIds,
    pinnableIds,
    loadedDocumentIds,
    restoreDocuments,
    idAliases,
  });
  const restoration = useRef<SessionRestoration | null>(null);
  const snapshots = useRef(
    new Map<string, { state: State; availableIds: string[]; pinnableIds: string[] }>(),
  );
  useLayoutEffect(() => {
    current.current = {
      initialState,
      initialActiveId,
      availableIds,
      pinnableIds,
      loadedDocumentIds,
      restoreDocuments,
      idAliases,
    };
    if (state.key !== key || !state.ready) return;
    const previous = snapshots.current.get(key);
    snapshots.current.set(key, {
      state,
      availableIds:
        metadataReady && !metadataError ? availableIds : (previous?.availableIds ?? availableIds),
      pinnableIds:
        metadataReady && !metadataError ? pinnableIds : (previous?.pinnableIds ?? pinnableIds),
    });
  });

  useLayoutEffect(() => {
    if (!metadataReady || !needsSessionRestore(restoration.current, key, metadataError)) return;
    let cancelled = false;
    const scope = { spaceId, mode };
    const {
      initialState,
      initialActiveId,
      availableIds,
      pinnableIds,
      loadedDocumentIds,
      restoreDocuments,
      idAliases,
    } = current.current;
    const saved = enabled
      ? loadDesktopSession(browserStorage(), scope, availableIds, pinnableIds, idAliases)
      : null;
    let session = withInitialActiveWindow(
      saved ?? createDesktopSession(scope, initialState, {}, availableIds),
      initialActiveId,
      availableIds,
    );
    const documents = session.windows.running
      .filter((id) => id.startsWith('file-'))
      .map((id) => id.slice(5));
    const cached = new Set(loadedDocumentIds);
    const missing = documents.filter((id) => !cached.has(id));

    function finish(opened: readonly string[]) {
      if (cancelled) return;
      if (missing.length) {
        const successful = new Set(opened);
        const accessibleIds = availableIds.filter(
          (id) =>
            !id.startsWith('file-') ||
            !missing.includes(id.slice(5)) ||
            successful.has(id.slice(5)),
        );
        session = createDesktopSession(
          scope,
          session.windows,
          session.positions,
          accessibleIds,
          session.pinnedIds,
          pinnableIds,
        );
        // Failed or newly unpublished primary files must not leave mobile blank.
        session = withInitialActiveWindow(session, initialActiveId, accessibleIds);
      }
      restoration.current = { key, metadataFailed: metadataError };
      send({ type: 'restore', key, session });
    }
    if (!missing.length || metadataError || !restoreDocuments) {
      // Hydrated documents and saved geometry can be revealed in the same paint.
      finish([]);
    } else {
      // Only genuinely absent documents hold restoration open; cached files never refetch.
      try {
        void restoreDocuments(missing).then(finish, () => finish([]));
      } catch {
        finish([]);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [key, spaceId, mode, metadataReady, metadataError, enabled]);

  const availableKey = JSON.stringify(availableIds);
  const pinnableKey = JSON.stringify(pinnableIds);
  useEffect(() => {
    if (metadataReady && !metadataError)
      send({
        type: 'reconcile',
        key,
        scope: { spaceId, mode },
        availableIds: current.current.availableIds,
        pinnableIds: current.current.pinnableIds,
      });
  }, [key, spaceId, mode, availableKey, pinnableKey, metadataReady, metadataError]);

  const ready = state.key === key && state.ready;
  useEffect(() => {
    if (
      !enabled ||
      !ready ||
      !metadataReady ||
      metadataError ||
      restoration.current?.metadataFailed
    )
      return;
    const scope = { spaceId, mode };
    const timer = window.setTimeout(() => {
      const latest = snapshots.current.get(key);
      if (!latest) return;
      saveDesktopSession(
        browserStorage(),
        createDesktopSession(
          scope,
          latest.state.windows,
          latest.state.positions,
          latest.availableIds,
          latest.state.pinnedIds,
          latest.pinnableIds,
        ),
      );
    }, 200);
    return () => window.clearTimeout(timer);
  }, [key, spaceId, mode, state, enabled, ready, metadataReady, metadataError]);

  useEffect(() => {
    if (
      !enabled ||
      !ready ||
      !metadataReady ||
      metadataError ||
      restoration.current?.metadataFailed
    )
      return;
    const scope = { spaceId, mode };
    const flush = () => {
      const latest = snapshots.current.get(key);
      if (!latest?.state.ready) return;
      saveDesktopSession(
        browserStorage(),
        createDesktopSession(
          scope,
          latest.state.windows,
          latest.state.positions,
          latest.availableIds,
          latest.state.pinnedIds,
          latest.pinnableIds,
        ),
      );
    };
    window.addEventListener('pagehide', flush);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
    };
  }, [key, spaceId, mode, enabled, ready, metadataReady, metadataError]);

  const dispatch = useCallback(
    (action: WindowAction) => send({ type: 'window', key, action }),
    [key],
  );
  const setPosition = useCallback(
    (id: string, point: Point) => send({ type: 'position', key, id, point }),
    [key],
  );
  const toggleTaskbarPin = useCallback(
    (id: string) => {
      if (!metadataReady || metadataError || restoration.current?.metadataFailed) return;
      send({ type: 'toggle-pin', key, id, pinnableIds: current.current.pinnableIds });
    },
    [key, metadataReady, metadataError],
  );
  return {
    windows: state.windows,
    dispatch,
    positions: state.positions,
    setPosition,
    pinnedIds: ready ? state.pinnedIds : [],
    toggleTaskbarPin,
    ready,
  };
}
