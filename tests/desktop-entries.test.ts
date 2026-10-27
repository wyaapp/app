import test from 'node:test';
import assert from 'node:assert/strict';
import {
  desktopEntries,
  canMoveEntry,
  entryCommands,
  availableCopyName,
  navigateFolder,
  stepFolderHistory,
} from '../lib/desktop-entries.ts';
import type { SpaceFile, SpaceFileInfo, FileAction } from '../lib/space-files.ts';
import type { SpaceFolder, FolderAction } from '../lib/space-folders.ts';

const file: SpaceFile = {
  id: 'note',
  position: 0,
  name: 'Note.md',
  folderId: null,
  content: '# Fresh draft',
  appearance: { theme: 'black', accent: 'navy', headingFont: 'serif' },
  size: 13,
  version: 3,
  published: true,
  hasChanges: true,
  pinned: true,
  updatedAt: '2026-10-23',
};
const folders: SpaceFolder[] = [
  { id: 'parent', name: 'Parent', parentId: null, version: 1 },
  { id: 'child', name: 'Child', parentId: 'parent', version: 2 },
];
const migrated = { ...file, id: 'file-links', name: 'Links.md', legacyTabId: 'links' };
const entries = desktopEntries([file, migrated], folders, true);
const text = entries.find((entry) => entry.id === file.id)!;

function commandFixture(folderList = folders) {
  const calls: unknown[] = [];
  return {
    calls,
    commands: entryCommands(
      {
        read: async (id: string) => {
          calls.push(['read', id]);
          return file;
        },
        change: async (action: FileAction) => {
          calls.push(action);
          return { ...file, published: false, pinned: false };
        },
        changeFolder: async (action: FolderAction) => {
          calls.push(action);
        },
        move: async (value: SpaceFileInfo, destination: string | null) => {
          calls.push(['move', value.id, destination]);
        },
        rename: async (value: SpaceFileInfo, name: string) => {
          calls.push(['rename', value.id, name]);
        },
        togglePin: async (value: SpaceFileInfo) => {
          calls.push(['pin', value.id]);
        },
      },
      folderList,
    ),
  };
}

test('normalized entries preserve stable identity and describe supported commands honestly', () => {
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ['folder', 'folder', 'file', 'file'],
  );
  const migratedFile = entries.find((entry) => entry.id === migrated.id)!;
  assert.deepEqual(migratedFile.capabilities, text.capabilities);
  assert.equal(entries.find((entry) => entry.id === 'child')!.folderId, 'parent');
  for (const entry of desktopEntries([file, migrated], folders, false)) {
    assert.equal(Object.values(entry.capabilities).some(Boolean), false);
    assert.equal(canMoveEntry(entry, folders, 'child'), false);
  }
});

test('move commands reject unknown folders, cycles and same-folder drops before writing', async () => {
  const { commands, calls } = commandFixture();
  const parent = entries.find((entry) => entry.id === 'parent')!;
  await assert.rejects(commands.move(parent, 'child'), /Cannot move/);
  await assert.rejects(commands.move(text, 'gone'), /Cannot move/);
  await assert.rejects(commands.move(text, null), /Cannot move/);
  assert.equal(calls.length, 0);
  await commands.move(text, 'parent');
  await commands.move(
    entries.find((entry) => entry.id === migrated.id)!,
    'parent',
  );
  assert.deepEqual(calls, [
    ['move', 'note', 'parent'],
    ['move', 'file-links', 'parent'],
  ]);
});

test('copy reads the latest draft and paste creates only a new private document', async () => {
  const { commands, calls } = commandFixture();
  const clipboard = await commands.copy(text);
  assert.deepEqual(clipboard, {
    name: 'Note.md',
    content: '# Fresh draft',
    appearance: file.appearance,
  });
  await commands.paste(clipboard, null, entries);
  assert.deepEqual(calls, [
    ['read', 'note'],
    {
      action: 'create',
      name: 'Note (copy).md',
      content: '# Fresh draft',
      appearance: file.appearance,
      folderId: null,
    },
  ]);
  await commands.paste(clipboard, 'parent', entries);
  assert.deepEqual(calls.at(-1), {
    action: 'create',
    name: 'Note.md',
    content: '# Fresh draft',
    appearance: file.appearance,
    folderId: 'parent',
  });
});

test('migrated Markdown files have the same rename, copy and pin commands as new files', async () => {
  const { commands, calls } = commandFixture();
  const migratedFile = entries.find((entry) => entry.id === migrated.id)!;
  await commands.copy(migratedFile);
  await commands.rename(migratedFile, 'Renamed.md');
  await commands.togglePin(migratedFile);
  assert.deepEqual(calls, [
    ['read', migrated.id],
    ['rename', migrated.id, 'Renamed.md'],
    ['pin', migrated.id],
  ]);
});

test('copy names avoid case-insensitive collisions and keep long names inside the limit', () => {
  assert.equal(availableCopyName('note.md', ['NOTE.MD', 'Note (copy).md']), 'note (copy 2).md');
  const name = 'a'.repeat(97) + '.md';
  const next = availableCopyName(name, [name]);
  assert.equal(next.length, 100);
  assert.match(next, / \(copy\)\.md$/);
});

test('Desktop is protected while drafts and ordinary folders can be moved onto it', async () => {
  const systemFolder: SpaceFolder = {
    id: 'desktop',
    name: 'Desktop',
    parentId: null,
    version: 1,
    system: 'desktop',
  };
  const allFolders = [systemFolder, ...folders];
  const allEntries = desktopEntries([{ ...file, published: false }], allFolders, true);
  const systemEntry = allEntries.find((entry) => entry.id === systemFolder.id)!;
  assert.equal(Object.values(systemEntry.capabilities).some(Boolean), false);
  assert.equal(canMoveEntry(systemEntry, allFolders, 'parent'), false);
  const draft = allEntries.find((entry) => entry.kind === 'file')!;
  assert.equal(draft.capabilities.pin, true);
  assert.equal(canMoveEntry(draft, allFolders, systemFolder.id), true);
  const folder = allEntries.find((entry) => entry.id === 'parent')!;
  assert.equal(folder.capabilities.pin, true);
  const { commands, calls } = commandFixture();
  await assert.rejects(commands.rename(systemEntry, 'Renamed'), /cannot be renamed/);
  await assert.rejects(commands.togglePin(systemEntry), /cannot be moved/);
  assert.equal(calls.length, 0);
  const writable = commandFixture(allFolders);
  await writable.commands.togglePin(folder);
  assert.deepEqual(writable.calls, [
    {
      action: 'move-folder',
      id: 'parent',
      version: 1,
      parentId: 'desktop',
    },
  ]);
  const movedFolders = allFolders.map((folder) =>
    folder.id === 'parent' ? { ...folder, parentId: 'desktop' } : folder,
  );
  const moved = commandFixture(movedFolders);
  await moved.commands.togglePin(
    desktopEntries([], movedFolders, true).find((entry) => entry.id === 'parent')!,
  );
  assert.deepEqual(moved.calls.at(-1), {
    action: 'move-folder',
    id: 'parent',
    version: 1,
    parentId: null,
  });
});

test('folder history branches correctly and skips deleted destinations', () => {
  const root = { locations: [null], index: 0 };
  const first = navigateFolder(root, 'parent');
  const second = navigateFolder(first, 'child');
  const back = stepFolderHistory(second, -1, folders);
  assert.equal(back.locations[back.index], 'parent');
  assert.equal(stepFolderHistory(back, 1, folders).locations[2], 'child');
  assert.deepEqual(navigateFolder(back, null), { locations: [null, 'parent', null], index: 2 });
  const deleted = stepFolderHistory(second, -1, []);
  assert.equal(deleted.index, 0);
  assert.equal(stepFolderHistory(deleted, -1, []), deleted);
  assert.equal(navigateFolder(root, null), root);
});
