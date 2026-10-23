import { AppError } from './app-error.ts';
import { consumeLimit, digestKey } from './abuse-limits.ts';
import { createSpaceFolderStore } from './space-folder-service.ts';
import { createSpacePageFileStore } from './space-page-file-service.ts';
import { pageFileActionSchema, type SpacePageFile } from './space-page-files.ts';
import { folderActionSchema, publicFolders, type SpaceFolder } from './space-folders.ts';
import {
  fileActionSchema,
  MAX_SPACE_FILES,
  type SpaceFile,
  type SpaceFileInfo,
} from './space-files.ts';

// Private content never enters profile JSON, public file lists, or profile revisions.
export function createSpaceFileService(db: D1Database) {
  const folders = createSpaceFolderStore(db);
  const pages = createSpacePageFileStore(db);
  const pinnedColumn = `EXISTS(SELECT 1 FROM space_file_folders f
    WHERE f.id = space_files.folder_id AND f.space_id = space_files.space_id AND f.system = 'desktop') AS pinned`;
  const ownerColumns = `id, name, folder_id AS folderId, length(CAST(content AS BLOB)) AS size, version,
    (published_at IS NOT NULL) AS published,
    (published_at IS NOT NULL AND (name COLLATE BINARY <> published_name OR content <> published_content)) AS hasChanges,
    ${pinnedColumn}, updated_at AS updatedAt`;
  const publicColumns = `id, published_name AS name, folder_id AS folderId,
    length(CAST(published_content AS BLOB)) AS size, 0 AS version,
    1 AS published, 0 AS hasChanges, ${pinnedColumn}, published_at AS updatedAt`;
  const normalize = <T extends SpaceFileInfo>(row: T): T => ({
    ...row,
    published: Boolean(row.published),
    hasChanges: Boolean(row.hasChanges),
    pinned: Boolean(row.pinned),
  });
  async function owned(userId: string, spaceId: string) {
    if (
      !(await db
        .prepare('SELECT id FROM spaces WHERE id = ? AND user_id = ?')
        .bind(spaceId, userId)
        .first())
    )
      throw new AppError('Space not found.', 404);
  }
  async function read(spaceId: string, id: string): Promise<SpaceFile> {
    const row = await db
      .prepare(`SELECT ${ownerColumns}, content FROM space_files WHERE space_id = ? AND id = ?`)
      .bind(spaceId, id)
      .first<SpaceFile>();
    if (!row) throw new AppError('File not found.', 404);
    return normalize(row);
  }
  async function get(userId: string, spaceId: string, id?: string) {
    await owned(userId, spaceId);
    if (id) return { file: await read(spaceId, id) };
    const result = await db
      .prepare(`SELECT ${ownerColumns} FROM space_files WHERE space_id = ? ORDER BY name`)
      .bind(spaceId)
      .all<SpaceFileInfo>();
    return {
      files: result.results.map(normalize),
      folders: await folders.list(spaceId),
      pages: await pages.list(spaceId),
    };
  }
  async function publicGet(handle: string, id?: string) {
    const space = await db
      .prepare('SELECT space_id AS id FROM space_handles WHERE handle = ?')
      .bind(handle)
      .first<{ id: string }>();
    if (!space) throw new AppError('Space not found.', 404);
    if (id) {
      const row = await db
        .prepare(
          `SELECT ${publicColumns}, published_content AS content FROM space_files
        WHERE space_id = ? AND id = ? AND published_at IS NOT NULL`,
        )
        .bind(space.id, id)
        .first<SpaceFile>();
      if (!row) throw new AppError('File not found.', 404);
      return { file: normalize(row) };
    }
    const result = await db
      .prepare(
        `SELECT ${publicColumns} FROM space_files
      WHERE space_id = ? AND published_at IS NOT NULL ORDER BY published_name`,
      )
      .bind(space.id)
      .all<SpaceFileInfo>();
    const files = result.results.map(normalize);
    const pageFiles = await pages.list(space.id, true);
    return {
      files,
      pages: pageFiles,
      folders: publicFolders(await folders.list(space.id), [...files, ...pageFiles]),
    };
  }
  async function change(
    userId: string,
    spaceId: string,
    input: unknown,
  ): Promise<{
    file?: SpaceFile;
    deleted?: string;
    folder?: SpaceFolder;
    deletedFolder?: string;
    page?: SpacePageFile;
  }> {
    await owned(userId, spaceId);
    const pageAction = pageFileActionSchema.safeParse(input);
    if (pageAction.success) {
      await consumeLimit(db, `files:${await digestKey(userId)}`, 120, 60_000);
      if (pageAction.data.action === 'move-page')
        await folders.requireFolder(spaceId, pageAction.data.folderId);
      return pages.change(spaceId, pageAction.data);
    }
    const folderAction = folderActionSchema.safeParse(input);
    if (folderAction.success) {
      await consumeLimit(db, `files:${await digestKey(userId)}`, 120, 60_000);
      return folders.change(spaceId, folderAction.data);
    }
    const parsed = fileActionSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError('Use a valid .md or .txt filename and plain text up to 64 KB.');
    const action = parsed.data;
    // Text editing has its own allowance; it must not consume the profile action budget.
    await consumeLimit(db, `files:${await digestKey(userId)}`, 120, 60_000);
    const now = new Date().toISOString();
    const id = action.action === 'create' ? crypto.randomUUID() : action.id;
    try {
      if (action.action === 'create') {
        await folders.requireFolder(spaceId, action.folderId);
        const result = await db
          .prepare(
            `INSERT INTO space_files (id, space_id, name, content, folder_id, updated_at)
          SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM space_files WHERE space_id = ?) < ?`,
          )
          .bind(
            id,
            spaceId,
            action.name,
            action.content,
            action.folderId,
            now,
            spaceId,
            MAX_SPACE_FILES,
          )
          .run();
        if (!result.meta.changes) throw new AppError('This space has reached its 30-file limit.');
      } else {
        const current = await read(spaceId, id);
        if (current.version !== action.version)
          throw new AppError(
            'This file changed elsewhere. Download your edits before reloading it.',
            409,
          );
        if (action.action === 'move') await folders.requireFolder(spaceId, action.folderId);
        let query: string;
        let values: (string | number | null)[];
        if (action.action === 'delete') {
          query = 'DELETE FROM space_files WHERE space_id = ? AND id = ? AND version = ?';
          values = [spaceId, id, action.version];
        } else {
          const changes = {
            save: 'name = ?, content = ?',
            publish: 'published_name = name, published_content = content, published_at = ?',
            unpublish: 'published_name = NULL, published_content = NULL, published_at = NULL',
            pin: 'folder_id = ?',
            move: 'folder_id = ?',
          };
          query = `UPDATE space_files SET ${changes[action.action]}, version = version + 1, updated_at = ?
            WHERE space_id = ? AND id = ? AND version = ?`;
          values = [
            ...(action.action === 'save'
              ? [action.name, action.content]
              : action.action === 'publish'
                ? [now]
                : action.action === 'pin'
                  ? [action.pinned ? await folders.desktopId(spaceId) : null]
                  : action.action === 'move'
                    ? [action.folderId]
                    : []),
            now,
            spaceId,
            id,
            action.version,
          ];
        }
        const result = await db
          .prepare(query)
          .bind(...values)
          .run();
        if (!result.meta.changes)
          throw new AppError(
            'This file changed elsewhere. Download your edits before reloading it.',
            409,
          );
        if (action.action === 'delete') return { deleted: id };
      }
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed'))
        throw new AppError('A file with this name already exists.', 409);
      if (String(error).includes('FOREIGN KEY constraint failed'))
        throw new AppError('Folder not found.', 404);
      throw error;
    }
    return { file: await read(spaceId, id) };
  }
  return { get, publicGet, change };
}
