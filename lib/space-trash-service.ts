import { AppError } from './app-error.ts';
import {
  commitMarkdownFiles,
  readMarkdownFiles,
  type MarkdownSpaceRow,
} from './markdown-file-store.ts';
import type { ProfileData } from './profile-types.ts';
import { createSpaceFolderStore } from './space-folder-service.ts';
import {
  folderDepth,
  folderTrail,
  MAX_FOLDER_DEPTH,
  MAX_SPACE_FOLDERS,
  type SpaceFolder,
} from './space-folders.ts';
import { fileInfo, MAX_SPACE_FILES, type SpaceFile } from './space-files.ts';
import {
  makeTrashArchive,
  readTrash,
  trashGuard,
  type TrashAction,
  type TrashArchive,
  type TrashEntryInfo,
} from './space-trash.ts';
import { trashPurgeHistoryStatements } from './space-trash-history.ts';

export type TrashChangeResult = {
  trash: TrashEntryInfo[];
  files?: ReturnType<typeof fileInfo>[];
  folders?: SpaceFolder[];
  deletedIds?: string[];
  deletedFolderIds?: string[];
  restoredIds?: string[];
  deletedFolder?: string;
  defaultFileId?: string | null;
};
function conflict(): never {
  throw new AppError('Trash changed in another session. Reload it before trying again.', 409);
}
function uniqueName(name: string, occupied: string[], file = false) {
  const extension = file ? name.slice(name.lastIndexOf('.')) : '';
  const stem = extension ? name.slice(0, -extension.length) : name;
  let candidate = name;
  for (
    let suffix = 2;
    occupied.some((value) => value.toLowerCase() === candidate.toLowerCase());
    suffix++
  )
    candidate = `${stem.slice(0, 85)} (${suffix})${extension}`;
  return candidate;
}
export function createSpaceTrashService(db: D1Database) {
  const folderStore = createSpaceFolderStore(db);
  async function result(spaceId: string): Promise<TrashChangeResult> {
    const current = await db
      .prepare('SELECT data FROM spaces WHERE id=?')
      .bind(spaceId)
      .first<{ data: string }>();
    const data = JSON.parse(current!.data) as ProfileData;
    return {
      trash: await readTrash(db, spaceId),
      files: (await readMarkdownFiles(db, spaceId)).map(fileInfo),
      folders: await folderStore.list(spaceId),
      defaultFileId: data.defaultFileId ?? null,
    };
  }
  async function deleteFolder(
    space: MarkdownSpaceRow,
    id: string,
    version: number,
  ): Promise<TrashChangeResult> {
    const folders = await folderStore.list(space.id);
    const root = folders.find((folder) => folder.id === id);
    if (!root) throw new AppError('Folder not found.', 404);
    if (root.system) throw new AppError('Home cannot be deleted.');
    if (root.version !== version)
      throw new AppError('This folder changed elsewhere. Reload it before trying again.', 409);
    const removedFolders = folders.filter((folder) =>
      folderTrail(folders, folder.id).some((parent) => parent.id === id),
    );
    const ids = new Set(removedFolders.map((folder) => folder.id));
    const before = await readMarkdownFiles(db, space.id);
    const removedFiles = before.filter((file) => file.folderId && ids.has(file.folderId));
    const archive = makeTrashArchive(
      removedFiles,
      removedFolders,
      root,
      folderTrail(folders, root.parentId)
        .map((folder) => folder.name)
        .join(' / ') || 'All files',
      new Date().toISOString(),
    );
    await commitMarkdownFiles(
      db,
      space,
      before,
      before.filter((file) => !removedFiles.includes(file)),
      JSON.parse(space.data),
      {
        reason: 'Moved folder to Trash',
        bumpVersion: true,
        foldersBefore: folders,
        archives: [archive],
        extra: {
          afterFiles: (token) => [
            db
              .prepare(
                `DELETE FROM space_file_folders WHERE space_id=? AND id IN (SELECT value FROM json_each(?)) AND ${trashGuard}`,
              )
              .bind(space.id, JSON.stringify([...ids]), token),
          ],
        },
      },
    );
    return {
      ...(await result(space.id)),
      deletedFolder: id,
      deletedIds: removedFiles.map((file) => file.id),
      deletedFolderIds: [...ids],
    };
  }
  async function readArchive(spaceId: string, id: string, version: number): Promise<TrashArchive> {
    const entry = (await readTrash(db, spaceId)).find((entry) => entry.id === id);
    if (!entry || entry.version !== version) conflict();
    const rows = (
      await db
        .prepare('SELECT kind,data FROM space_trash_items WHERE space_id=? AND entry_id=?')
        .bind(spaceId, id)
        .all<{ kind: string; data: string }>()
    ).results;
    return {
      entry,
      files: rows.filter((row) => row.kind === 'file').map((row) => JSON.parse(row.data)),
      folders: rows.filter((row) => row.kind === 'folder').map((row) => JSON.parse(row.data)),
    };
  }
  async function change(space: MarkdownSpaceRow, action: TrashAction): Promise<TrashChangeResult> {
    const requested =
      action.action === 'empty-trash'
        ? action.entries
        : [{ id: action.id, version: action.version }];
    if (new Set(requested.map((entry) => entry.id)).size !== requested.length)
      throw new AppError('Select each Trash item once.');
    const archives = await Promise.all(
      requested.map((entry) => readArchive(space.id, entry.id, entry.version)),
    );
    const before = await readMarkdownFiles(db, space.id);
    const folders = await folderStore.list(space.id);
    const data = JSON.parse(space.data) as ProfileData;
    const now = new Date().toISOString();
    const guardSql = `NOT EXISTS(SELECT 1 FROM json_each(?) e LEFT JOIN space_trash t ON t.id=json_extract(e.value,'$.id') AND t.space_id=? WHERE t.id IS NULL OR t.version<>json_extract(e.value,'$.version'))`;
    const guardValues = [JSON.stringify(requested), space.id];
    const deleteEntries = (token: string) =>
      db
        .prepare(
          `DELETE FROM space_trash WHERE space_id=? AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${trashGuard}`,
        )
        .bind(space.id, JSON.stringify(requested), token);
    if (action.action !== 'restore-trash') {
      const files = archives.flatMap((archive) => archive.files);
      // Build history cleanup under the same guarded transaction as tombstones.
      // It is prepared before commit; the space version prevents stale history restores.
      let historyStatements: D1PreparedStatement[] = [];
      await commitMarkdownFiles(db, space, before, before, data, {
        bumpVersion: true,
        foldersBefore: folders,
        extra: {
          guardSql,
          guardValues,
          afterFiles: (token) => [
            ...files.map((file) =>
              db
                .prepare(
                  `INSERT INTO space_file_tombstones(space_id,file_id) SELECT ?,? WHERE ${trashGuard} ON CONFLICT DO NOTHING`,
                )
                .bind(space.id, file.id, token),
            ),
            ...historyStatements.map((statement) => statement),
            deleteEntries(token),
          ],
        },
        // Populated through the hook below before any SQL is executed.
        prepareExtra: async (token) => {
          historyStatements = await trashPurgeHistoryStatements(db, space.id, files, token);
        },
      });
      return result(space.id);
    }
    const archive = archives[0];
    if (before.length + archive.files.length > MAX_SPACE_FILES)
      throw new AppError("Restore would exceed this space's 30-file limit.", 409);
    if (
      folders.filter((folder) => !folder.system).length + archive.folders.length >
      MAX_SPACE_FOLDERS
    )
      throw new AppError("Restore would exceed this space's folder limit.", 409);
    const desktopId = folders.find((folder) => folder.system === 'desktop')?.id ?? null;
    const parent = archive.entry.originalParentId;
    const destination =
      parent === null ? null : folders.some((folder) => folder.id === parent) ? parent : desktopId;
    const restoredFolders: SpaceFolder[] = [];
    const folderIds = new Set(archive.folders.map((folder) => folder.id));
    for (const saved of [...archive.folders].sort(
      (a, b) => folderDepth(archive.folders, a.id) - folderDepth(archive.folders, b.id),
    )) {
      if (saved.system || folders.some((folder) => folder.id === saved.id)) conflict();
      const parentId =
        saved.parentId && folderIds.has(saved.parentId) ? saved.parentId : destination;
      const name = uniqueName(
        saved.name,
        [...folders, ...restoredFolders]
          .filter((folder) => folder.parentId === parentId)
          .map((folder) => folder.name),
      );
      const folder = { ...saved, name, parentId, version: saved.version + 1 };
      restoredFolders.push(folder);
      if (folderDepth([...folders, ...restoredFolders], folder.id) > MAX_FOLDER_DEPTH)
        throw new AppError('Restore would exceed the maximum folder depth.', 409);
    }
    const restored: SpaceFile[] = [];
    for (const saved of archive.files) {
      if (before.some((file) => file.id === saved.id)) conflict();
      const folderId =
        saved.folderId && folderIds.has(saved.folderId) ? saved.folderId : destination;
      const name = uniqueName(
        saved.name,
        [...before, ...restored]
          .filter((file) => file.folderId === folderId)
          .map((file) => file.name),
        true,
      );
      restored.push({
        ...saved,
        name,
        folderId,
        pinned: Boolean(desktopId) && folderId === desktopId,
        version: saved.version + 1,
        updatedAt: now,
        published: false,
        publishedAt: null,
        publishedName: null,
        publishedContent: null,
        publishedAppearance: {},
        hasChanges: false,
      });
    }
    await commitMarkdownFiles(db, space, before, [...before, ...restored], data, {
      reason: 'Restored from Trash',
      bumpVersion: true,
      now,
      foldersBefore: folders,
      restoringIds: restored.map((file) => file.id),
      extra: {
        guardSql,
        guardValues,
        beforeFiles: (token) =>
          restoredFolders.map((folder) =>
            db
              .prepare(
                `INSERT INTO space_file_folders(id,space_id,name,parent_id,version) SELECT ?,?,?,?,? WHERE ${trashGuard}`,
              )
              .bind(folder.id, space.id, folder.name, folder.parentId, folder.version, token),
          ),
        afterFiles: (token) => [deleteEntries(token)],
      },
    });
    return {
      ...(await result(space.id)),
      restoredIds: [
        ...restored.map((file) => file.id),
        ...restoredFolders.map((folder) => folder.id),
      ],
    };
  }
  return { change, deleteFolder };
}
