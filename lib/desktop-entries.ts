import type { DesktopItem } from './desktop-items.ts';
import type { SpaceFile, SpaceFileInfo, FileAction } from './space-files.ts';
import { canMoveFolder, type SpaceFolder, type FolderAction } from './space-folders.ts';

type EntryCapabilities = { move: boolean; copy: boolean; rename: boolean; pin: boolean };
type EntryBase = {
  id: string;
  key: string;
  name: string;
  folderId: string | null;
  capabilities: EntryCapabilities;
};
export type DesktopEntry = EntryBase &
  ({ kind: 'file'; source: SpaceFileInfo } | { kind: 'folder'; source: SpaceFolder });

export function desktopEntries(
  files: SpaceFileInfo[],
  folders: SpaceFolder[],
  editable: boolean,
): DesktopEntry[] {
  return [
    ...folders.map((source): DesktopEntry => ({
      kind: 'folder',
      id: source.id,
      key: `folder:${source.id}`,
      name: source.name,
      folderId: source.parentId,
      source,
      capabilities: {
        move: editable && !source.system,
        copy: false,
        rename: editable && !source.system,
        pin: editable && !source.system,
      },
    })),
    ...files.map((source): DesktopEntry => ({
      kind: 'file',
      id: source.id,
      key: `file:${source.id}`,
      name: source.name,
      folderId: source.folderId,
      source,
      capabilities: {
        move: editable,
        copy: editable,
        rename: editable,
        pin: editable,
      },
    })),
  ].sort(
    (a, b) =>
      Number(b.kind === 'folder' && Boolean(b.source.system)) -
        Number(a.kind === 'folder' && Boolean(a.source.system)) ||
      Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
      a.name.localeCompare(b.name),
  );
}

export function findDesktopEntry(entries: DesktopEntry[], item: DesktopItem) {
  return entries.find((entry) => entry.kind === item.kind && entry.id === item.id);
}

export function canMoveEntry(
  entry: DesktopEntry,
  folders: SpaceFolder[],
  destination: string | null,
) {
  if (
    !entry.capabilities.move ||
    (destination && !folders.some((folder) => folder.id === destination))
  )
    return false;
  return entry.kind === 'folder'
    ? canMoveFolder(folders, entry.id, destination)
    : entry.folderId !== destination;
}

type EntryFiles = {
  move: (file: SpaceFileInfo, destination: string | null) => Promise<unknown>;
  rename: (file: SpaceFileInfo, name: string) => Promise<unknown>;
  togglePin: (file: SpaceFileInfo) => Promise<unknown>;
  read: (id: string) => Promise<SpaceFile>;
  change: (action: FileAction) => Promise<SpaceFile | undefined>;
  changeFolder: (action: FolderAction) => Promise<unknown>;
};

/** All entry points use these commands; ownership and version checks stay on the server. */
export function entryCommands(files: EntryFiles, folders: SpaceFolder[]) {
  return {
    async move(entry: DesktopEntry, destination: string | null) {
      if (!canMoveEntry(entry, folders, destination))
        throw new Error('Cannot move this item here.');
      if (entry.kind === 'folder')
        return files.changeFolder({
          action: 'move-folder',
          id: entry.id,
          version: entry.source.version,
          parentId: destination,
        });
      return files.move(entry.source, destination);
    },
    async rename(entry: DesktopEntry, name: string) {
      if (!entry.capabilities.rename) throw new Error('This item cannot be renamed here.');
      if (entry.kind === 'folder')
        return files.changeFolder({
          action: 'rename-folder',
          id: entry.id,
          version: entry.source.version,
          name,
        });
      if (entry.kind === 'file') return files.rename(entry.source, name);
    },
    async togglePin(entry: DesktopEntry) {
      if (!entry.capabilities.pin) throw new Error('This item cannot be moved to Home.');
      if (entry.kind === 'folder') {
        const desktop = folders.find((folder) => folder.system === 'desktop');
        if (!desktop) throw new Error('Home folder not found. Refresh Files and try again.');
        const destination = entry.folderId === desktop.id ? null : desktop.id;
        if (!canMoveEntry(entry, folders, destination))
          throw new Error('Cannot move this item here.');
        return files.changeFolder({
          action: 'move-folder',
          id: entry.id,
          version: entry.source.version,
          parentId: destination,
        });
      }
      if (entry.kind === 'file') return files.togglePin(entry.source);
    },
    async copy(entry: DesktopEntry) {
      if (!entry.capabilities.copy || entry.kind !== 'file')
        throw new Error('Only text files can be copied.');
      const file = await files.read(entry.id);
      // Copies retain text and appearance, never publication data, IDs or desktop pins.
      return { name: file.name, content: file.content, appearance: file.appearance };
    },
    async paste(
      copy: Pick<SpaceFile, 'name' | 'content' | 'appearance'>,
      destination: string | null,
      entries: DesktopEntry[],
    ) {
      return files.change({
        action: 'create',
        name: availableCopyName(
          copy.name,
          entries
            .filter((entry) => entry.folderId === destination && entry.kind === 'file')
            .map((entry) => entry.name),
        ),
        content: copy.content,
        appearance: copy.appearance,
        folderId: destination,
      });
    },
  };
}

export function availableCopyName(name: string, names: string[]) {
  const occupied = new Set(names.map((value) => value.toLowerCase()));
  if (!occupied.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = name.slice(0, dot),
    extension = name.slice(dot);
  for (let count = 1; ; count++) {
    const suffix = count === 1 ? ' (copy)' : ` (copy ${count})`;
    const candidate = `${stem.slice(0, 100 - suffix.length - extension.length)}${suffix}${extension}`;
    if (!occupied.has(candidate.toLowerCase())) return candidate;
  }
}

export type FolderHistory = { locations: (string | null)[]; index: number };
export function navigateFolder(history: FolderHistory, destination: string | null): FolderHistory {
  if (history.locations[history.index] === destination) return history;
  const locations = [...history.locations.slice(0, history.index + 1), destination].slice(-50);
  return { locations, index: locations.length - 1 };
}
export function stepFolderHistory(
  history: FolderHistory,
  direction: -1 | 1,
  folders: SpaceFolder[],
): FolderHistory {
  for (
    let index = history.index + direction;
    index >= 0 && index < history.locations.length;
    index += direction
  ) {
    const location = history.locations[index];
    if (location === null || folders.some((folder) => folder.id === location))
      return { ...history, index };
  }
  return history;
}
