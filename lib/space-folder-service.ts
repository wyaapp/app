import { AppError } from './app-error.ts';
import {
  folderDepth,
  MAX_FOLDER_DEPTH,
  MAX_SPACE_FOLDERS,
  type FolderAction,
  type SpaceFolder,
} from './space-folders.ts';

// Called only after the file service has checked space ownership.
export function createSpaceFolderStore(db: D1Database) {
  type FolderRow = Omit<SpaceFolder, 'system'> & { system: 'desktop' | null };
  const normalize = ({ system, ...folder }: FolderRow): SpaceFolder =>
    system ? { ...folder, name: 'Home', system } : folder;
  async function list(spaceId: string) {
    const result = await db
      .prepare(
        'SELECT id, name, parent_id AS parentId, version, system FROM space_file_folders WHERE space_id = ? ORDER BY system IS NULL, name',
      )
      .bind(spaceId)
      .all<FolderRow>();
    return result.results.map(normalize);
  }
  async function read(spaceId: string, id: string) {
    const folder = await db
      .prepare(
        'SELECT id, name, parent_id AS parentId, version, system FROM space_file_folders WHERE space_id = ? AND id = ?',
      )
      .bind(spaceId, id)
      .first<FolderRow>();
    if (!folder) throw new AppError('Folder not found.', 404);
    return normalize(folder);
  }
  async function desktopId(spaceId: string) {
    const folder = await db
      .prepare("SELECT id FROM space_file_folders WHERE space_id = ? AND system = 'desktop'")
      .bind(spaceId)
      .first<{ id: string }>();
    if (!folder) throw new AppError('Home folder not found.', 404);
    return folder.id;
  }
  async function requireFolder(spaceId: string, id: string | null) {
    if (id) await read(spaceId, id);
  }
  async function change(
    spaceId: string,
    action: FolderAction,
  ): Promise<{ folder?: SpaceFolder; deletedFolder?: string }> {
    const id = action.action === 'create-folder' ? crypto.randomUUID() : action.id;
    try {
      if (action.action === 'create-folder') {
        await requireFolder(spaceId, action.parentId);
        if (folderDepth(await list(spaceId), action.parentId) >= MAX_FOLDER_DEPTH)
          throw new AppError('Folders can be nested up to 5 levels.');
        const result = await db
          .prepare(
            `WITH RECURSIVE parents(id, parent_id, depth) AS (
            SELECT id, parent_id, CASE WHEN system IS NULL THEN 1 ELSE 0 END
            FROM space_file_folders WHERE space_id = ? AND id = ?
            UNION ALL SELECT f.id, f.parent_id, p.depth + CASE WHEN f.system IS NULL THEN 1 ELSE 0 END
            FROM space_file_folders f JOIN parents p ON f.id = p.parent_id
          ) INSERT INTO space_file_folders (id, space_id, parent_id, name)
          SELECT ?, ?, ?, ?
          WHERE (SELECT COUNT(*) FROM space_file_folders WHERE space_id = ? AND system IS NULL) < ?
          AND COALESCE((SELECT MAX(depth) FROM parents), 0) < ?`,
          )
          .bind(
            spaceId,
            action.parentId,
            id,
            spaceId,
            action.parentId,
            action.name,
            spaceId,
            MAX_SPACE_FOLDERS,
            MAX_FOLDER_DEPTH,
          )
          .run();
        if (!result.meta.changes)
          throw new AppError('Keep folders within 5 levels and the 30-folder limit.');
      } else {
        const current = await read(spaceId, id);
        if (current.system)
          throw new AppError('The Home folder cannot be renamed, moved, or deleted.');
        if (current.version !== action.version)
          throw new AppError('This folder changed elsewhere. Refresh Files and try again.', 409);
        if (action.action === 'move-folder') {
          await requireFolder(spaceId, action.parentId);
          if (current.parentId === action.parentId) return { folder: current };
          // Check the whole tree inside the write, including concurrent moves.
          const result = await db
            .prepare(
              `WITH RECURSIVE
            children(id, depth) AS (
              SELECT id, 1 FROM space_file_folders WHERE space_id = ? AND id = ?
              UNION ALL SELECT f.id, c.depth + 1 FROM space_file_folders f JOIN children c ON f.parent_id = c.id
            ), parents(id, parent_id, depth) AS (
              SELECT id, parent_id, CASE WHEN system IS NULL THEN 1 ELSE 0 END FROM space_file_folders WHERE space_id = ? AND id = ?
              UNION ALL SELECT f.id, f.parent_id, p.depth + CASE WHEN f.system IS NULL THEN 1 ELSE 0 END FROM space_file_folders f JOIN parents p ON f.id = p.parent_id
            )
            UPDATE space_file_folders SET parent_id = ?, version = version + 1
            WHERE space_id = ? AND id = ? AND version = ?
            AND NOT EXISTS (SELECT 1 FROM children WHERE id = ?)
            AND (SELECT MAX(depth) FROM children) + COALESCE((SELECT MAX(depth) FROM parents), 0) <= ?`,
            )
            .bind(
              spaceId,
              id,
              spaceId,
              action.parentId,
              action.parentId,
              spaceId,
              id,
              action.version,
              action.parentId,
              MAX_FOLDER_DEPTH,
            )
            .run();
          if (!result.meta.changes)
            throw new AppError(
              'Cannot move this folder here. Avoid nested loops and keep folders within 5 levels.',
              409,
            );
          return { folder: await read(spaceId, id) };
        }
        if (action.action === 'delete-folder') {
          // Emptiness is checked in the write itself, so a concurrent upload cannot be deleted.
          const result = await db
            .prepare(
              `DELETE FROM space_file_folders WHERE space_id = ? AND id = ? AND version = ?
            AND NOT EXISTS (SELECT 1 FROM space_files WHERE folder_id = ?)
            AND NOT EXISTS (SELECT 1 FROM space_file_folders WHERE parent_id = ?)
            AND NOT EXISTS (
              SELECT 1 FROM space_page_files p JOIN spaces s ON s.id = p.space_id WHERE p.folder_id = ?
              AND (EXISTS (SELECT 1 FROM json_each(s.data, '$.tabs') t WHERE json_extract(t.value, '$.id') = p.tab_id)
                OR (COALESCE(json_array_length(s.data, '$.tabs'), 0) = 0 AND p.tab_id = 'home'))
            )`,
            )
            .bind(spaceId, id, action.version, id, id, id)
            .run();
          if (!result.meta.changes)
            throw new AppError(
              'Only empty folders can be deleted. Refresh Files and try again.',
              409,
            );
          return { deletedFolder: id };
        }
        const result = await db
          .prepare(
            'UPDATE space_file_folders SET name = ?, version = version + 1 WHERE space_id = ? AND id = ? AND version = ?',
          )
          .bind(action.name, spaceId, id, action.version)
          .run();
        if (!result.meta.changes)
          throw new AppError('This folder changed elsewhere. Refresh Files and try again.', 409);
      }
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed'))
        throw new AppError('A folder with this name already exists here.', 409);
      if (String(error).includes('FOREIGN KEY constraint failed'))
        throw new AppError('Folder not found.', 404);
      throw error;
    }
    return { folder: await read(spaceId, id) };
  }
  return { list, requireFolder, desktopId, change };
}
