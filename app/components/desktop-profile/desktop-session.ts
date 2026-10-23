import type { Point, WindowState } from './window-state.ts';

export type DesktopSessionScope = { spaceId: string; mode: 'owner' | 'visitor' };
export type DesktopSession = {
  version: 1;
  scope: DesktopSessionScope;
  windows: WindowState;
  positions: Record<string, Point>;
  pinnedIds: string[];
};
export type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type SessionRestoration = { key: string; metadataFailed: boolean };

const MAX_WINDOWS = 100;
const MAX_SESSION_LENGTH = 64 * 1024;
const MAX_COORDINATE = 100_000;
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function taskbarPinIds(values: readonly unknown[], pinnableIds: readonly string[]) {
  const pinnable = new Set(pinnableIds);
  return [...new Set(values.filter((id): id is string => validId(id) && pinnable.has(id)))].slice(
    0,
    MAX_WINDOWS,
  );
}

export function desktopSessionKey(scope: DesktopSessionScope) {
  return `wya:desktop-session:v1:${scope.mode}:${encodeURIComponent(scope.spaceId)}`;
}

export function needsSessionRestore(
  previous: SessionRestoration | null,
  key: string,
  metadataFailed: boolean,
) {
  return !previous || previous.key !== key || (previous.metadataFailed && !metadataFailed);
}

export function sessionPoint(value: unknown): Point | null {
  if (
    !object(value) ||
    typeof value.x !== 'number' ||
    typeof value.y !== 'number' ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y)
  )
    return null;
  return {
    x: Math.round(Math.max(-MAX_COORDINATE, Math.min(value.x, MAX_COORDINATE))),
    y: Math.round(Math.max(0, Math.min(value.y, MAX_COORDINATE))),
  };
}

/** Only identifiers and window metadata are persisted, never an app's state or contents. */
export function createDesktopSession(
  scope: DesktopSessionScope,
  windows: WindowState,
  positions: Record<string, Point>,
  availableIds: readonly string[],
  pinnedIds: readonly string[] = [],
  pinnableIds: readonly string[] = availableIds,
): DesktopSession {
  const available = new Set(availableIds.filter(validId));
  const ids = (values: readonly unknown[], allowed = available) =>
    [...new Set(values.filter((id) => validId(id) && allowed.has(id)))].slice(
      0,
      MAX_WINDOWS,
    ) as string[];
  const running = ids(windows.running);
  const active = new Set(running);
  const points = Object.entries(positions)
    .filter(([id]) => available.has(id))
    .slice(0, MAX_WINDOWS)
    .flatMap(([id, point]) => {
      const valid = sessionPoint(point);
      return valid ? [[id, valid] as const] : [];
    });
  return {
    version: 1,
    scope: { spaceId: scope.spaceId, mode: scope.mode },
    windows: {
      // Closed editors are kept mounted during a visit, but are not restored as documents.
      loaded: running,
      running,
      order: ids(windows.order, active),
      maximized: ids(windows.maximized, active),
    },
    positions: Object.fromEntries(points),
    pinnedIds: taskbarPinIds(pinnedIds, pinnableIds),
  };
}

export function readDesktopSession(
  value: string | null,
  scope: DesktopSessionScope,
  availableIds: readonly string[],
  pinnableIds: readonly string[] = availableIds,
): DesktopSession | null {
  if (!value || value.length > MAX_SESSION_LENGTH) return null;
  try {
    const saved: unknown = JSON.parse(value);
    if (
      !object(saved) ||
      saved.version !== 1 ||
      !object(saved.scope) ||
      saved.scope.spaceId !== scope.spaceId ||
      saved.scope.mode !== scope.mode ||
      !object(saved.windows) ||
      !Array.isArray(saved.windows.running) ||
      !Array.isArray(saved.windows.order) ||
      !Array.isArray(saved.windows.maximized) ||
      !object(saved.positions)
    )
      return null;
    return createDesktopSession(
      scope,
      {
        loaded: [],
        running: saved.windows.running,
        order: saved.windows.order,
        maximized: saved.windows.maximized,
      },
      saved.positions as Record<string, Point>,
      availableIds,
      Array.isArray(saved.pinnedIds) ? saved.pinnedIds : [],
      pinnableIds,
    );
  } catch {
    return null;
  }
}

export function loadDesktopSession(
  storage: SessionStorage | null,
  scope: DesktopSessionScope,
  availableIds: readonly string[],
  pinnableIds: readonly string[] = availableIds,
) {
  try {
    return readDesktopSession(
      storage?.getItem(desktopSessionKey(scope)) ?? null,
      scope,
      availableIds,
      pinnableIds,
    );
  } catch {
    return null;
  }
}

export function saveDesktopSession(storage: SessionStorage | null, session: DesktopSession) {
  try {
    if (!storage) return false;
    storage.setItem(
      desktopSessionKey(session.scope),
      JSON.stringify({
        version: session.version,
        scope: session.scope,
        windows: {
          running: session.windows.running,
          order: session.windows.order,
          maximized: session.windows.maximized,
        },
        positions: session.positions,
        pinnedIds: session.pinnedIds,
      }),
    );
    return true;
  } catch {
    // A full or blocked browser store must never stop the desktop from working.
    return false;
  }
}
