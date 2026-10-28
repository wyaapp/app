'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import {
  clampIconPoint,
  desktopIconDrop,
  desktopIconPositions,
  desktopGridPositions,
  moveDesktopGridIcon,
  readIconPositions,
  readDesktopGridPositions,
  serializeDesktopGridPositions,
  DESKTOP_ICON,
  type IconPoint,
  type IconPositions,
  type DesktopSize,
} from '@/lib/desktop-icon-layout';
import type { DesktopDropLocation } from './use-desktop-drag';
import { useDesktopPreferences } from '@/lib/desktop-preferences';

import { remapDesktopPositions } from '@/lib/legacy-desktop-files';

const changeEvent = 'wya:desktop-icon-layout';
const temporary = new Map<string, string>();
const serverSnapshot = () => null;

function read(key: string) {
  if (temporary.has(key)) return temporary.get(key)!;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useDesktopIconLayout(
  scope: string,
  ids: string[],
  workspace: RefObject<HTMLDivElement | null>,
  preview: boolean,
  idAliases: Record<string, string> = {},
) {
  const { iconMode } = useDesktopPreferences();
  const baseKey = `wya:desktop-icons:v1:${preview ? 'preview:' : ''}${encodeURIComponent(scope)}`;
  // Keep the existing free layout key; grid slots have their own arrangement.
  const key = iconMode === 'grid' ? `${baseKey}:grid` : baseKey;
  const subscribe = useCallback(
    (notify: () => void) => {
      const storage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== key) return;
        temporary.delete(key);
        notify();
      };
      window.addEventListener('storage', storage);
      window.addEventListener(changeEvent, notify);
      return () => {
        window.removeEventListener('storage', storage);
        window.removeEventListener(changeEvent, notify);
      };
    },
    [key],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    useCallback(() => read(key), [key]),
    serverSnapshot,
  );
  const saved = useMemo(
    () =>
      remapDesktopPositions(
        iconMode === 'grid' ? readDesktopGridPositions(snapshot) : readIconPositions(snapshot),
        idAliases,
      ),
    [snapshot, iconMode, idAliases],
  );
  const [size, setSize] = useState<DesktopSize>({ width: 0, height: 0 });
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [workspace]);
  const positioned = size.width > 960 && iconMode !== 'auto';
  const positions =
    iconMode === 'grid'
      ? desktopGridPositions(ids, saved, size)
      : desktopIconPositions(ids, saved, size);
  const surfaceWidth = Math.max(
    size.width,
    ...Object.values(positions).map((point) => point.x + DESKTOP_ICON.width + DESKTOP_ICON.edge),
  );
  const overflowing = positioned && surfaceWidth > size.width;
  function write(value: IconPositions, storageKey = key) {
    const serialized = storageKey.endsWith(':grid')
      ? serializeDesktopGridPositions(value)
      : JSON.stringify(value);
    // Preview and browsers with blocked storage still support moving icons.
    temporary.set(storageKey, serialized);
    if (!preview) {
      try {
        window.localStorage.setItem(storageKey, serialized);
        temporary.delete(storageKey);
      } catch {
        /* Keep this visit's layout. */
      }
    }
    window.dispatchEvent(new Event(changeEvent));
  }
  function move(id: string, point: IconPoint) {
    if (!positioned) return;
    // Freeze untouched icons at their current locations, including new shortcuts.
    // Keep stored positions when a smaller viewport temporarily clamps them.
    const next = {
      ...positions,
      ...Object.fromEntries(
        ids.filter((id) => Object.hasOwn(saved, id)).map((id) => [id, saved[id]]),
      ),
    };
    if (iconMode === 'grid') {
      const moved = moveDesktopGridIcon(ids, positions, id, point, {
        ...size,
        width: surfaceWidth,
      });
      for (const [key, value] of Object.entries(moved)) {
        if (key === id || value.x !== positions[key]?.x || value.y !== positions[key]?.y)
          next[key] = value;
      }
    } else next[id] = clampIconPoint(point, size);
    write(next);
  }
  return {
    viewportWidth: size.width,
    positioned,
    mode: iconMode,
    positions,
    surfaceWidth,
    overflowing,
    move,
    reset: () => write({}),
    resetAll() {
      write({}, baseKey);
      write({}, `${baseKey}:grid`);
    },
    drop(id: string, location: DesktopDropLocation) {
      const bounds = workspace.current?.getBoundingClientRect();
      if (!bounds || !positioned) return;
      const surface = workspace.current?.querySelector('.desktop-shortcuts');
      move(
        id,
        desktopIconDrop(
          { x: location.clientX, y: location.clientY },
          location.fromShortcut
            ? { x: location.grabX, y: location.grabY }
            : { x: DESKTOP_ICON.width / 2, y: DESKTOP_ICON.height / 2 },
          {
            left: bounds.left - (surface?.scrollLeft ?? 0),
            top: bounds.top - (surface?.scrollTop ?? 0),
            width: iconMode === 'grid' ? surfaceWidth : bounds.width,
            height: bounds.height,
          },
        ),
      );
    },
  };
}
