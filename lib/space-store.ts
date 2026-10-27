import {
  canonicalProfileData,
  commitMarkdownFiles,
  ensureMarkdownFiles,
  readMarkdownFiles,
  type MarkdownSpaceRow,
} from './markdown-file-store.ts';
import { AppError } from './app-error.ts';
import {
  type Profile,
  type ProfileData,
  type Revision,
  type SpaceSummary,
} from './profile-types.ts';
import {
  HOSTED_FREE_SPACE_LIMIT,
  HOSTED_PREMIUM_SPACE_LIMIT,
  resolveHostingMode,
  type HostingMode,
} from './plans.ts';

type SpaceRow = {
  id: string;
  user_id: string;
  handle: string;
  data: string;
  version: number;
  updated_at: string;
  picture_key?: string | null;
};

export type SpaceChange = {
  handle: string;
  data: ProfileData;
  reason: string;
};

export function spaceConflict() {
  return new AppError('This space changed in another session. Reload it before trying again.', 409);
}

function rethrowStorageError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('legacy_content_model')) throw spaceConflict();
  if (message.includes('space_limit')) {
    throw new AppError("Your plan's space limit has been reached.", 409);
  }
  if (
    message.includes('handle_taken') ||
    message.includes('UNIQUE constraint failed: spaces.handle')
  ) {
    throw new AppError('This username is currently used by another space.', 409);
  }
  throw error;
}

/** D1 queries for the space service. Private reads are always scoped to an owner. */
export function createSpaceStore(
  db: D1Database,
  hostingMode: HostingMode = 'self-hosted',
  clock: () => number = Date.now,
) {
  const mode = resolveHostingMode(hostingMode);
  const snapshots = new WeakMap<Profile, MarkdownSpaceRow>();
  async function readProfile(row: SpaceRow, includeFiles = true): Promise<Profile> {
    if ((JSON.parse(row.data) as ProfileData).fileModelVersion !== 1) {
      await ensureMarkdownFiles(db, row.id);
      const fresh = await db
        .prepare('SELECT * FROM spaces WHERE id=?')
        .bind(row.id)
        .first<SpaceRow>();
      if (!fresh) throw new AppError('Space not found.', 404);
      row = fresh;
    }
    // Short-link requests read the compiled index, never entire private drafts.
    const files = includeFiles ? await readMarkdownFiles(db, row.id) : undefined;
    const aliases = await db
      .prepare(
        `
      SELECT handle FROM space_handles
      WHERE space_id = ? AND handle <> ? ORDER BY created_at, handle
    `,
      )
      .bind(row.id, row.handle)
      .all<{ handle: string }>();

    const profile: Profile = {
      ...(JSON.parse(row.data) as ProfileData),
      ...(files ? { files } : {}),
      id: row.id,
      handle: row.handle,
      aliases: aliases.results.map((alias) => alias.handle),
      version: row.version,
      updatedAt: row.updated_at,
      pictureUrl: row.picture_key ? `/api/pictures/${row.picture_key}` : null,
    };
    snapshots.set(profile, row);
    return profile;
  }

  async function listSpaces(userId: string): Promise<SpaceSummary[]> {
    const result = await db
      .prepare(
        `
      SELECT id, handle, json_extract(data, '$.name') AS name,
        json_extract(data, '$.theme') AS theme, version
      FROM spaces WHERE user_id = ? ORDER BY created_at, id
    `,
      )
      .bind(userId)
      .all<SpaceSummary>();
    return result.results;
  }

  async function getAccount(userId: string, spaceId?: string): Promise<Profile | null> {
    if (spaceId) {
      const row = await db
        .prepare('SELECT * FROM spaces WHERE user_id = ? AND id = ?')
        .bind(userId, spaceId)
        .first<SpaceRow>();
      if (!row) throw new AppError('Space not found.', 404);
      return readProfile(row);
    }

    // A missing selector is only unambiguous for an owner with one space.
    const rows = await db
      .prepare(
        `
      SELECT * FROM spaces WHERE user_id = ? ORDER BY created_at, id LIMIT 2
    `,
      )
      .bind(userId)
      .all<SpaceRow>();
    if (rows.results.length > 1) {
      throw new AppError('Choose a space first. Use list_spaces and pass its spaceId.', 409);
    }
    return rows.results[0] ? readProfile(rows.results[0]) : null;
  }

  // Internal read: the service must filter hidden content before returning publicly.
  async function findByHandle(handle: string, includeFiles = true): Promise<Profile | null> {
    const row = await db
      .prepare(
        `
      SELECT s.* FROM spaces s JOIN space_handles h ON h.space_id = s.id
      WHERE h.handle = ?
    `,
      )
      .bind(handle.toLowerCase())
      .first<SpaceRow>();
    return row ? readProfile(row, includeFiles) : null;
  }

  async function findHandleOwner(handle: string) {
    return db
      .prepare('SELECT id FROM spaces WHERE handle = ?')
      .bind(handle)
      .first<{ id: string }>();
  }

  async function getHistory(userId: string, spaceId?: string): Promise<Revision[]> {
    const current = await getAccount(userId, spaceId);
    if (!current) return [];
    const result = await db
      .prepare(
        `
      SELECT version, reason, created_at AS createdAt FROM space_revisions
      WHERE space_id = ? ORDER BY version DESC LIMIT 50
    `,
      )
      .bind(current.id)
      .all<Revision>();
    return result.results;
  }

  // Called only after the service has resolved an owned, version-checked space.
  async function getRevision(spaceId: string, version: number): Promise<ProfileData> {
    const revision = await db
      .prepare('SELECT id,data FROM space_revisions WHERE space_id = ? AND version = ?')
      .bind(spaceId, version)
      .first<{ id: string; data: string }>();
    if (!revision) throw new AppError('Revision not found in this space.', 404);
    const data = JSON.parse(revision.data) as ProfileData & { fileSnapshotVersion?: number };
    if (data.fileSnapshotVersion === 1) {
      const rows = await db
        .prepare('SELECT data FROM space_file_revisions WHERE revision_id=? ORDER BY file_id')
        .bind(revision.id)
        .all<{ data: string }>();
      data.files = rows.results.map((row) => JSON.parse(row.data));
      delete data.fileSnapshotVersion;
    }
    return data;
  }

  async function insertSpace(
    userId: string,
    handle: string,
    data: ProfileData,
    now: string,
  ): Promise<Profile> {
    const id = crypto.randomUUID();
    try {
      data = canonicalProfileData(data, []);
      const values = [id, userId, handle, JSON.stringify(data), now, now];
      // Count and insert are one SQLite statement. Competing creates cannot both
      // claim the final slot; expiration is rechecked here, never trusted from UI.
      const query =
        mode === 'hosted'
          ? `
        INSERT INTO spaces (id, user_id, handle, data, version, created_at, updated_at)
        SELECT ?, ?, ?, ?, 1, ?, ?
        WHERE (SELECT count(*) FROM spaces WHERE user_id = ?) < CASE
          WHEN EXISTS(SELECT 1 FROM account_plans WHERE user_id = ? AND premium_until > ?)
          THEN ${HOSTED_PREMIUM_SPACE_LIMIT} ELSE ${HOSTED_FREE_SPACE_LIMIT} END
      `
          : `
        INSERT INTO spaces (id, user_id, handle, data, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `;
      const statement = db.prepare(query);
      const result = await (
        mode === 'hosted'
          ? statement.bind(...values, userId, userId, clock())
          : statement.bind(...values)
      ).run();
      if (result.meta.changes < 1) {
        throw new AppError("Your plan's space limit has been reached.", 409);
      }
    } catch (error) {
      rethrowStorageError(error);
    }
    return (await getAccount(userId, id))!;
  }

  async function saveChange(
    userId: string,
    current: Profile,
    change: SpaceChange,
    now: string,
  ): Promise<Profile> {
    try {
      const snapshot = snapshots.get(current);
      if (!snapshot) throw spaceConflict();
      const owned = await db
        .prepare('SELECT id FROM spaces WHERE id=? AND user_id=?')
        .bind(current.id, userId)
        .first();
      if (!owned) throw new AppError('Space not found.', 404);
      await commitMarkdownFiles(
        db,
        snapshot,
        current.files ?? [],
        change.data.files ?? current.files ?? [],
        change.data,
        {
          handle: change.handle,
          reason: change.reason,
          bumpVersion: true,
          now,
        },
      );
    } catch (error) {
      rethrowStorageError(error);
    }

    // A username claim can remove another space's fallback without changing its
    // content version. Read the mappings instead of predicting the aliases.
    return (await getAccount(userId, current.id))!;
  }

  return {
    listSpaces,
    getAccount,
    findByHandle,
    findHandleOwner,
    getHistory,
    getRevision,
    insertSpace,
    saveChange,
  };
}
