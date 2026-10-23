'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  createDesktopSession,
  desktopSessionKey,
  loadDesktopSession,
  needsSessionRestore,
  saveDesktopSession,
  sessionPoint,
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
};
type Action =
  | { type: 'restore'; key: string; session: DesktopSession }
  | { type: 'window'; key: string; action: WindowAction }
  | { type: 'position'; key: string; id: string; point: Point }
  | { type: 'reconcile'; key: string; scope: DesktopSessionScope; availableIds: string[] };

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
  const next = createDesktopSession(
    action.scope,
    state.windows,
    state.positions,
    action.availableIds,
  );
  const windows = {
    ...next.windows,
    loaded: state.windows.loaded.filter(
      (id) => !id.startsWith('file-') || action.availableIds.includes(id),
    ),
  };
  if (
    JSON.stringify(windows) === JSON.stringify(state.windows) &&
    JSON.stringify(next.positions) === JSON.stringify(state.positions)
  )
    return state;
  return { ...state, windows, positions: next.positions };
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
  availableIds,
  metadataReady,
  metadataError = false,
  restoreDocuments,
  enabled = true,
}: DesktopSessionScope & {
  initialState: WindowState;
  availableIds: string[];
  metadataReady: boolean;
  metadataError?: boolean;
  restoreDocuments?: (ids: string[]) => Promise<string[]>;
  enabled?: boolean;
}) {
  const scope = { spaceId, mode };
  const key = desktopSessionKey(scope);
  const [state, send] = useReducer(reducer, {
    key,
    ready: false,
    windows: initialState,
    positions: {},
  });
  const current = useRef({ initialState, availableIds, restoreDocuments });
  const restoration = useRef<SessionRestoration | null>(null);
  const snapshots = useRef(new Map<string, { state: State; availableIds: string[] }>());
  useEffect(() => {
    current.current = { initialState, availableIds, restoreDocuments };
    if (state.key !== key || !state.ready) return;
    const previous = snapshots.current.get(key);
    snapshots.current.set(key, {
      state,
      availableIds:
        metadataReady && !metadataError ? availableIds : (previous?.availableIds ?? availableIds),
    });
  });

  useEffect(() => {
    if (!metadataReady || !needsSessionRestore(restoration.current, key, metadataError)) return;
    let cancelled = false;
    const scope = { spaceId, mode };
    const { initialState, availableIds, restoreDocuments } = current.current;
    async function restore() {
      const saved = enabled ? loadDesktopSession(browserStorage(), scope, availableIds) : null;
      let session = saved ?? createDesktopSession(scope, initialState, {}, availableIds);
      const documents = session.windows.running
        .filter((id) => id.startsWith('file-'))
        .map((id) => id.slice(5));
      let opened: string[] = [];
      try {
        opened = !metadataError && restoreDocuments ? await restoreDocuments(documents) : [];
      } catch {
        // An inaccessible document should not prevent other apps from restoring.
      }
      if (cancelled) return;
      if (documents.length) {
        const successful = new Set(opened.map((id) => `file-${id}`));
        session = createDesktopSession(
          scope,
          session.windows,
          session.positions,
          availableIds.filter(
            (id) =>
              !id.startsWith('file-') || !documents.includes(id.slice(5)) || successful.has(id),
          ),
        );
      }
      restoration.current = { key, metadataFailed: metadataError };
      send({ type: 'restore', key, session });
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [key, spaceId, mode, metadataReady, metadataError, enabled]);

  const availableKey = JSON.stringify(availableIds);
  useEffect(() => {
    if (metadataReady && !metadataError)
      send({
        type: 'reconcile',
        key,
        scope: { spaceId, mode },
        availableIds: current.current.availableIds,
      });
  }, [key, spaceId, mode, availableKey, metadataReady, metadataError]);

  const ready = state.key === key && state.ready;
  useEffect(() => {
    if (!enabled || !ready || !metadataReady || metadataError) return;
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
        ),
      );
    }, 200);
    return () => window.clearTimeout(timer);
  }, [key, spaceId, mode, state, enabled, ready, metadataReady, metadataError]);

  useEffect(() => {
    if (!enabled || !ready || !metadataReady || metadataError) return;
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
  return { windows: state.windows, dispatch, positions: state.positions, setPosition, ready };
}
