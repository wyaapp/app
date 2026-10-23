import { AppError } from './app-error.ts';
import { getProfileLayout } from './profile-tabs.ts';
import type { ProfileData } from './profile-types.ts';
import { pageDocumentName, type PageFileAction, type SpacePageFile } from './space-page-files.ts';
import { createSpaceFolderStore } from './space-folder-service.ts';

export function createSpacePageFileStore(db: D1Database) {
  const folders = createSpaceFolderStore(db);
  async function list(spaceId: string, publicOnly = false): Promise<SpacePageFile[]> {
    const space = await db
      .prepare('SELECT data FROM spaces WHERE id = ?')
      .bind(spaceId)
      .first<{ data: string }>();
    if (!space) throw new AppError('Space not found.', 404);
    const data = JSON.parse(space.data) as ProfileData;
    const tabs = getProfileLayout({ ...data, links: data.links ?? [] }).tabs;
    const desktopId = await folders.desktopId(spaceId);
    const saved = await db
      .prepare(
        'SELECT tab_id AS id, folder_id AS folderId, version FROM space_page_files WHERE space_id = ?',
      )
      .bind(spaceId)
      .all<{ id: string; folderId: string | null; version: number }>();
    return tabs
      .filter((tab) => !publicOnly || !tab.hidden)
      .map((tab) => {
        const entry = saved.results.find((entry) => entry.id === tab.id);
        const folderId = entry ? entry.folderId : desktopId;
        return {
          id: tab.id,
          name: pageDocumentName(tab.title),
          title: tab.title,
          folderId,
          pinned: folderId === desktopId,
          hidden: Boolean(tab.hidden),
          version: publicOnly ? 0 : (entry?.version ?? 0),
        };
      });
  }
  async function change(spaceId: string, action: PageFileAction) {
    const current = (await list(spaceId)).find((page) => page.id === action.id);
    if (!current) throw new AppError('Page not found. Save your content layout first.', 404);
    if (current.version !== action.version)
      throw new AppError('This page changed elsewhere. Refresh Files and try again.', 409);
    const desktopId = await folders.desktopId(spaceId);
    const folderId =
      action.action === 'move-page' ? action.folderId : action.pinned ? desktopId : null;
    const pinned = folderId === desktopId;
    const result =
      current.version === 0
        ? await db
            .prepare(
              `INSERT INTO space_page_files (space_id, tab_id, folder_id)
          VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
            )
            .bind(spaceId, current.id, folderId)
            .run()
        : await db
            .prepare(
              `UPDATE space_page_files SET folder_id = ?, version = version + 1
          WHERE space_id = ? AND tab_id = ? AND version = ?`,
            )
            .bind(folderId, spaceId, current.id, action.version)
            .run();
    if (!result.meta.changes)
      throw new AppError('This page changed elsewhere. Refresh Files and try again.', 409);
    return { page: { ...current, folderId, pinned, version: current.version + 1 } };
  }
  return { list, change };
}
