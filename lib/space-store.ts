import { AppError } from './app-error.ts';
import {
  MAX_SPACES,
  type Profile,
  type ProfileData,
  type Revision,
  type SpaceSummary,
} from './profile-types.ts';

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
  if (message.includes('space_limit')) {
    throw new AppError(`You can have up to ${MAX_SPACES} spaces.`, 409);
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
export function createSpaceStore(db: D1Database) {
  async function readProfile(row: SpaceRow): Promise<Profile> {
    const aliases = await db
      .prepare(
        `
      SELECT handle FROM space_handles
      WHERE space_id = ? AND handle <> ? ORDER BY created_at, handle
    `,
      )
      .bind(row.id, row.handle)
      .all<{ handle: string }>();

    return {
      ...(JSON.parse(row.data) as ProfileData),
      id: row.id,
      handle: row.handle,
      aliases: aliases.results.map((alias) => alias.handle),
      version: row.version,
      updatedAt: row.updated_at,
      pictureUrl: row.picture_key ? `/api/pictures/${row.picture_key}` : null,
    };
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
  async function findByHandle(handle: string): Promise<Profile | null> {
    const row = await db
      .prepare(
        `
      SELECT s.* FROM spaces s JOIN space_handles h ON h.space_id = s.id
      WHERE h.handle = ?
    `,
      )
      .bind(handle.toLowerCase())
      .first<SpaceRow>();
    return row ? readProfile(row) : null;
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
      .prepare('SELECT data FROM space_revisions WHERE space_id = ? AND version = ?')
      .bind(spaceId, version)
      .first<{ data: string }>();
    if (!revision) throw new AppError('Revision not found in this space.', 404);
    return JSON.parse(revision.data) as ProfileData;
  }

  async function insertSpace(
    userId: string,
    handle: string,
    data: ProfileData,
    now: string,
  ): Promise<Profile> {
    const id = crypto.randomUUID();
    try {
      await db
        .prepare(
          `
        INSERT INTO spaces (id, user_id, handle, data, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `,
        )
        .bind(id, userId, handle, JSON.stringify(data), now, now)
        .run();
    } catch (error) {
      rethrowStorageError(error);
    }
    return { ...data, id, handle, aliases: [], version: 1, updatedAt: now };
  }

  async function saveChange(
    userId: string,
    current: Profile,
    change: SpaceChange,
    now: string,
  ): Promise<Profile> {
    try {
      // D1 batch is atomic. Both writes use the same owner/version predicate so
      // a concurrent edit cannot leave behind a revision for a rejected update.
      const results = await db.batch([
        db
          .prepare(
            `
          INSERT INTO space_revisions (id, space_id, version, data, reason, created_at)
          SELECT ?, id, version, data, ?, ? FROM spaces
          WHERE user_id = ? AND id = ? AND version = ?
        `,
          )
          .bind(crypto.randomUUID(), change.reason, now, userId, current.id, current.version),
        db
          .prepare(
            `
          UPDATE spaces SET data = ?, handle = ?, version = version + 1, updated_at = ?
          WHERE user_id = ? AND id = ? AND version = ?
        `,
          )
          .bind(
            JSON.stringify(change.data),
            change.handle,
            now,
            userId,
            current.id,
            current.version,
          ),
      ]);
      if (results[1].meta.changes < 1) throw spaceConflict();
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
