'use client';

import { useSyncExternalStore } from 'react';

export type RenameShortcut = 'Enter' | 'F2';
export const desktopIconModes = ['auto', 'free', 'grid'] as const;
export type DesktopIconMode = (typeof desktopIconModes)[number];

export function readDesktopIconMode(value: unknown): DesktopIconMode {
  return value === 'auto' || value === 'free' ? value : 'grid';
}

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
const iconModeStorageKey = 'wya:desktop:icon-layout';
const extensionsStorageKey = 'wya:desktop:show-file-extensions';
const preferencesEvent = 'wya:desktop-preferences-change';
let temporaryRenameShortcut: RenameShortcut | null = null;
let temporaryIconMode: DesktopIconMode | null = null;
let temporaryShowFileExtensions: boolean | null = null;

function getShowFileExtensions(): boolean {
  if (temporaryShowFileExtensions !== null) return temporaryShowFileExtensions;
  try {
    return window.localStorage.getItem(extensionsStorageKey) !== 'false';
  } catch {
    return true;
  }
}

function setShowFileExtensions(value: boolean) {
  try {
    window.localStorage.setItem(extensionsStorageKey, String(value));
    temporaryShowFileExtensions = null;
  } catch {
    temporaryShowFileExtensions = value;
  }
  window.dispatchEvent(new Event(preferencesEvent));
}

function getIconMode(): DesktopIconMode {
  if (temporaryIconMode) return temporaryIconMode;
  try {
    return readDesktopIconMode(window.localStorage.getItem(iconModeStorageKey));
  } catch {
    return 'grid';
  }
}

function setIconMode(value: DesktopIconMode) {
  if (!desktopIconModes.includes(value)) return;
  try {
    window.localStorage.setItem(iconModeStorageKey, value);
    temporaryIconMode = null;
  } catch {
    temporaryIconMode = value;
  }
  window.dispatchEvent(new Event(preferencesEvent));
}

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
    if (
      event.key !== null &&
      event.key !== renameStorageKey &&
      event.key !== iconModeStorageKey &&
      event.key !== extensionsStorageKey
    )
      return;
    if (event.key === null || event.key === renameStorageKey) temporaryRenameShortcut = null;
    if (event.key === null || event.key === iconModeStorageKey) temporaryIconMode = null;
    if (event.key === null || event.key === extensionsStorageKey)
      temporaryShowFileExtensions = null;
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
const getServerIconMode = (): DesktopIconMode => 'grid';
const getServerShowFileExtensions = () => true;

/** Device preferences are shared by all windows, spaces, and tabs in this browser. */
export function useDesktopPreferences() {
  const renameShortcut = useSyncExternalStore(subscribe, getRenameShortcut, getServerSnapshot);
  const iconMode = useSyncExternalStore(subscribe, getIconMode, getServerIconMode);
  const showFileExtensions = useSyncExternalStore(
    subscribe,
    getShowFileExtensions,
    getServerShowFileExtensions,
  );
  return {
    renameShortcut,
    setRenameShortcut,
    iconMode,
    setIconMode,
    showFileExtensions,
    setShowFileExtensions,
  };
}
