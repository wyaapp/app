import { z } from 'zod';
import type { SpaceFile } from './space-files.ts';
import type { SpaceFolder } from './space-folders.ts';

export const MAX_TRASH_ITEMS = 100;
export const MAX_TRASH_BYTES = 32 * 1024 * 1024;
const entryVersion = { id: z.string().uuid(), version: z.number().int().positive() };
export const trashActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('restore-trash'), ...entryVersion }).strict(),
  z.object({ action: z.literal('purge-trash'), ...entryVersion }).strict(),
  z
    .object({
      action: z.literal('empty-trash'),
      entries: z.array(z.object(entryVersion).strict()).min(1).max(MAX_TRASH_ITEMS),
    })
    .strict(),
]);
export type TrashAction = z.infer<typeof trashActionSchema>;
export type TrashEntryInfo = {
  id: string;
  version: number;
  kind: 'file' | 'folder';
  name: string;
  originalParentId: string | null;
  originalLocation: string;
  deletedAt: string;
  fileCount: number;
  folderCount: number;
  size: number;
};
export type TrashArchive = { entry: TrashEntryInfo; files: SpaceFile[]; folders: SpaceFolder[] };
export const trashGuard = 'EXISTS(SELECT 1 FROM space_file_guards WHERE id=?)';
export const folderManifestSql = `(SELECT json_group_array(json_array(id,version,parent_id,system)) FROM (SELECT id,version,parent_id,system FROM space_file_folders WHERE space_id=? ORDER BY id))`;
export const folderManifest = (folders: SpaceFolder[]) =>
  JSON.stringify(
    [...folders]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((f) => [f.id, f.version, f.parentId, f.system ?? null]),
  );
export function makeTrashArchive(
  files: SpaceFile[],
  folders: SpaceFolder[],
  root: SpaceFile | SpaceFolder,
  location: string,
  now: string,
): TrashArchive {
  const kind = 'content' in root ? 'file' : 'folder';
  return {
    files,
    folders,
    entry: {
      id: crypto.randomUUID(),
      version: 1,
      kind,
      name: root.name,
      originalParentId: 'content' in root ? root.folderId : root.parentId,
      originalLocation: location,
      deletedAt: now,
      fileCount: files.length,
      folderCount: folders.length,
      size: new TextEncoder().encode(JSON.stringify(files) + JSON.stringify(folders)).byteLength,
    },
  };
}
export async function readTrash(db: D1Database, spaceId: string): Promise<TrashEntryInfo[]> {
  return (
    await db
      .prepare(
        `SELECT id,version,kind,name,original_parent_id AS originalParentId,original_location AS originalLocation,deleted_at AS deletedAt,file_count AS fileCount,folder_count AS folderCount,size FROM space_trash WHERE space_id=? ORDER BY deleted_at DESC,id`,
      )
      .bind(spaceId)
      .all<TrashEntryInfo>()
  ).results;
}
export async function unavailableFileIds(db: D1Database, spaceId: string): Promise<Set<string>> {
  const rows = await db
    .prepare(
      `SELECT item_id AS id FROM space_trash_items WHERE space_id=? AND kind='file' UNION SELECT file_id AS id FROM space_file_tombstones WHERE space_id=?`,
    )
    .bind(spaceId, spaceId)
    .all<{ id: string }>();
  return new Set(rows.results.map((row) => row.id));
}
export function archiveStatements(
  db: D1Database,
  spaceId: string,
  archive: TrashArchive,
  token: string,
): D1PreparedStatement[] {
  const e = archive.entry;
  return [
    db
      .prepare(
        `INSERT INTO space_trash(id,space_id,version,kind,name,original_parent_id,original_location,deleted_at,file_count,folder_count,size) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${trashGuard}`,
      )
      .bind(
        e.id,
        spaceId,
        e.version,
        e.kind,
        e.name,
        e.originalParentId,
        e.originalLocation,
        e.deletedAt,
        e.fileCount,
        e.folderCount,
        e.size,
        token,
      ),
    ...[
      ...archive.files.map((file) => ({ kind: 'file', item: file })),
      ...archive.folders.map((folder) => ({ kind: 'folder', item: folder })),
    ].map(({ kind, item }) =>
      db
        .prepare(
          `INSERT INTO space_trash_items(entry_id,space_id,item_id,kind,data) SELECT ?,?,?,?,? WHERE ${trashGuard}`,
        )
        .bind(e.id, spaceId, item.id, kind, JSON.stringify(item), token),
    ),
  ];
}
