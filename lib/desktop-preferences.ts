'use client';

import { useSyncExternalStore } from 'react';

export type RenameShortcut = 'Enter' | 'F2';

export function isRenameShortcut(
  event: {
    key: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    isComposing?: boolean;
    repeat?: boolean;
  },
  shortcut: RenameShortcut,
) {
  return (
    event.key === shortcut &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.isComposing &&
    !event.repeat
  );
}

const renameStorageKey = 'wya:desktop:rename-shortcut';
const preferencesEvent = 'wya:desktop-preferences-change';
let temporaryRenameShortcut: RenameShortcut | null = null;

function getRenameShortcut(): RenameShortcut {
  if (temporaryRenameShortcut) return temporaryRenameShortcut;
  try {
    return window.localStorage.getItem(renameStorageKey) === 'F2' ? 'F2' : 'Enter';
  } catch {
    return 'Enter';
  }
}

function setRenameShortcut(value: RenameShortcut) {
  if (value !== 'Enter' && value !== 'F2') return;
  try {
    window.localStorage.setItem(renameStorageKey, value);
    temporaryRenameShortcut = null;
  } catch {
    // The current desktop stays usable when this browser cannot persist settings.
    temporaryRenameShortcut = value;
  }
  window.dispatchEvent(new Event(preferencesEvent));
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== renameStorageKey) return;
    temporaryRenameShortcut = null;
    onChange();
  };
  window.addEventListener(preferencesEvent, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(preferencesEvent, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

const getServerSnapshot = (): RenameShortcut => 'Enter';

/** Device preferences are shared by all windows, spaces, and tabs in this browser. */
export function useDesktopPreferences() {
  const renameShortcut = useSyncExternalStore(subscribe, getRenameShortcut, getServerSnapshot);
  return { renameShortcut, setRenameShortcut };
}
