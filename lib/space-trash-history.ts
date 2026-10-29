import { AppError } from './app-error.ts';
import { canonicalProfileData, legacyMarkdownFiles } from './markdown-file-store.ts';
import type { ProfileData } from './profile-types.ts';
import type { SpaceFile } from './space-files.ts';

const guarded = 'EXISTS(SELECT 1 FROM space_file_guards WHERE id=? AND space_id=?)';
type RevisionData = ProfileData & { fileSnapshotVersion?: number };
type RevisionRow = { id: string; data: string; created_at: string; affected: number };

/** Remove indexed payloads as well as the file snapshots that produced them. */
function scrubReferences(data: RevisionData, ids: Set<string>, legacyIds: Set<string>) {
  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value))
      return value
        .filter(
          (item) =>
            !item ||
            typeof item !== 'object' ||
            !ids.has((item as { fileId?: string }).fileId ?? ''),
        )
        .map(scrub);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
    return value;
  };
  const next = { ...data, links: scrub(data.links) as ProfileData['links'] };
  if (next.defaultFileId && ids.has(next.defaultFileId)) delete next.defaultFileId;
  if (next.mobileLayout)
    next.mobileLayout = {
      ...next.mobileLayout,
      fileIds: next.mobileLayout.fileIds.filter((id) => !ids.has(id)),
    };
  if (next.desktopOrder)
    next.desktopOrder = next.desktopOrder.filter(
      (id) =>
        !(id.startsWith('file-') && ids.has(id.slice(5))) &&
        !(id.startsWith('tab-') && legacyIds.has(id.slice(4))),
    );
  if (next.files) next.files = next.files.filter((file) => !ids.has(file.id));
  return next;
}

/**
 * Build purge operations for the caller's guarded D1 batch. No content is deleted
 * while preparing the statements. Legacy revisions become split file snapshots
 * so erasing one former page does not erase unrelated history with it.
 */
export async function trashPurgeHistoryStatements(
  db: D1Database,
  spaceId: string,
  files: SpaceFile[],
  token: string,
): Promise<D1PreparedStatement[]> {
  if (!files.length) return [];
  const ids = new Set(files.map((file) => file.id));
  const legacyIds = new Set(files.flatMap((file) => (file.legacyTabId ? [file.legacyTabId] : [])));
  const allRevisions = await db
    .prepare(
      `SELECT r.id,r.data,r.created_at,
       EXISTS(SELECT 1 FROM space_file_revisions f WHERE f.revision_id=r.id
         AND f.file_id IN (SELECT value FROM json_each(?))) AS affected
       FROM space_revisions r WHERE r.space_id=?`,
    )
    .bind(JSON.stringify([...ids]), spaceId)
    .all<RevisionRow>();
  const statements: D1PreparedStatement[] = [];

  for (const row of allRevisions.results) {
    let data: RevisionData;
    try {
      data = JSON.parse(row.data) as RevisionData;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    } catch {
      throw new AppError(
        'History could not be safely updated. Nothing was permanently deleted.',
        409,
      );
    }
    let next = scrubReferences(data, ids, legacyIds);
    let affected = Boolean(row.affected) || JSON.stringify(next) !== JSON.stringify(data);
    const legacy =
      data.fileSnapshotVersion !== 1 &&
      data.fileModelVersion !== 1 &&
      !data.files &&
      Boolean(
        data.tabs?.length ||
        Object.keys(data.documents ?? {}).length ||
        data.links?.length ||
        data.sections?.length,
      );
    if (legacy) {
      const converted = await legacyMarkdownFiles(
        { id: spaceId, data: row.data, version: 1, updated_at: row.created_at },
        data,
        files.filter((file) => file.legacyTabId),
        [],
        null,
      );
      if (converted.files.some((file) => ids.has(file.id))) {
        affected = true;
        const retained = converted.files.filter((file) => !ids.has(file.id));
        next = {
          ...canonicalProfileData({ ...data, defaultFileId: converted.defaultFileId }, retained),
          fileSnapshotVersion: 1,
        };
        next = scrubReferences(next, ids, legacyIds);
        // A legacy revision has no split rows, but replace them defensively so
        // the revised snapshot cannot include stale, previously orphaned data.
        statements.push(
          db
            .prepare(
              `DELETE FROM space_file_revisions WHERE revision_id=?
               AND revision_id IN (SELECT id FROM space_revisions WHERE space_id=?) AND ${guarded}`,
            )
            .bind(row.id, spaceId, token, spaceId),
        );
        for (let offset = 0; offset < retained.length; offset += 15) {
          const group = retained.slice(offset, offset + 15);
          statements.push(
            db
              .prepare(
                `WITH snapshots(revision_id,file_id,data) AS (VALUES ${group.map(() => '(?,?,?)').join(',')})
                 INSERT INTO space_file_revisions(revision_id,file_id,data) SELECT revision_id,file_id,data FROM snapshots WHERE ${guarded}`,
              )
              .bind(
                ...group.flatMap((file) => [row.id, file.id, JSON.stringify(file)]),
                token,
                spaceId,
              ),
          );
        }
      }
    }
    if (affected)
      statements.push(
        db
          .prepare(
            `UPDATE space_revisions SET data=?,reason='Content permanently deleted'
             WHERE id=? AND space_id=? AND ${guarded}`,
          )
          .bind(JSON.stringify(next), row.id, spaceId, token, spaceId),
      );
  }
  statements.push(
    db
      .prepare(
        `DELETE FROM space_file_revisions
         WHERE revision_id IN (SELECT id FROM space_revisions WHERE space_id=?)
         AND file_id IN (SELECT value FROM json_each(?)) AND ${guarded}`,
      )
      .bind(spaceId, JSON.stringify([...ids]), token, spaceId),
    // This exact pre-cutover backup is internal recovery material, not active
    // user history. Keeping it would retain a second copy of erased content.
    db
      .prepare(`DELETE FROM space_markdown_migrations WHERE space_id=? AND ${guarded}`)
      .bind(spaceId, token, spaceId),
  );
  return statements;
}
