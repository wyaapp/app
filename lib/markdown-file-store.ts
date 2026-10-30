import { AppError } from './app-error.ts';
import type { LinkItem, ProfileData } from './profile-types.ts';
import type { SpaceFile, SpaceFileInfo } from './space-files.ts';
import { fileBytes, fileNameSchema, MAX_FILE_BYTES } from './space-files.ts';
import { normalizeDocumentAppearance, sameDocumentAppearance } from './document-appearance.ts';
import { getPageSource, parsePageSource } from './page-documents.ts';
import { getProfileLayout } from './profile-tabs.ts';
import { profileFileLinks } from './profile-files.ts';
import { fileNavigationOrder } from './file-navigation.ts';
import { normalizeMainWindowId } from './main-window.ts';
import { normalizeMobileLayout } from './mobile-layout.ts';
import { allItems } from './collections.ts';
import { folderTrail, type SpaceFolder } from './space-folders.ts';
import {
  archiveStatements,
  folderManifest,
  folderManifestSql,
  makeTrashArchive,
  MAX_TRASH_BYTES,
  MAX_TRASH_ITEMS,
  readTrash,
  unavailableFileIds,
  type TrashArchive,
} from './space-trash.ts';

export type MarkdownSpaceRow = { id: string; data: string; version: number; updated_at: string };
type FileRow = {
  id: string;
  name: string;
  folder_id: string | null;
  content: string;
  appearance: string;
  version: number;
  published_name: string | null;
  published_content: string | null;
  published_appearance: string;
  published_at: string | null;
  updated_at: string;
  legacy_tab_id: string | null;
  position: number;
  pinned: number;
};
function appearance(raw: string) {
  try {
    return normalizeDocumentAppearance(JSON.parse(raw));
  } catch {
    return {};
  }
}
export async function readMarkdownFiles(
  db: D1Database,
  spaceId: string,
  fileId?: string,
): Promise<SpaceFile[]> {
  const rows = await db
    .prepare(
      `SELECT f.*, EXISTS(SELECT 1 FROM space_file_folders d
    WHERE d.id=f.folder_id AND d.space_id=f.space_id AND d.system='desktop') AS pinned
    FROM space_files f WHERE space_id=? ${fileId ? 'AND f.id=?' : ''} ORDER BY position,id`,
    )
    .bind(...(fileId ? [spaceId, fileId] : [spaceId]))
    .all<FileRow>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    content: row.content,
    folderId: row.folder_id,
    size: fileBytes(row.content),
    appearance: appearance(row.appearance),
    version: row.version,
    published: row.published_at !== null,
    publishedAt: row.published_at,
    publishedName: row.published_name,
    publishedContent: row.published_content,
    publishedAppearance: appearance(row.published_appearance),
    hasChanges:
      row.published_at !== null &&
      (row.name !== row.published_name ||
        row.content !== row.published_content ||
        !sameDocumentAppearance(appearance(row.appearance), appearance(row.published_appearance))),
    pinned: Boolean(row.pinned),
    updatedAt: row.updated_at,
    position: row.position,
    ...(row.legacy_tab_id ? { legacyTabId: row.legacy_tab_id } : {}),
  }));
}

/** Listing files never transfers draft or published bodies from D1. */
export async function readMarkdownFileInfo(
  db: D1Database,
  spaceId: string,
): Promise<SpaceFileInfo[]> {
  const rows = await db
    .prepare(
      `SELECT f.id,f.name,f.folder_id,f.version,f.position,f.updated_at,
    f.legacy_tab_id,f.appearance,f.published_at,
    length(CAST(f.content AS BLOB)) AS size,
    (f.published_at IS NOT NULL AND (f.name IS NOT f.published_name OR
      f.content IS NOT f.published_content OR f.appearance IS NOT f.published_appearance)) AS has_changes,
    EXISTS(SELECT 1 FROM space_file_folders d WHERE d.id=f.folder_id AND d.space_id=f.space_id AND d.system='desktop') AS pinned
    FROM space_files f WHERE f.space_id=? ORDER BY f.position,f.id`,
    )
    .bind(spaceId)
    .all<{
      id: string;
      name: string;
      folder_id: string | null;
      version: number;
      position: number;
      updated_at: string;
      legacy_tab_id: string | null;
      appearance: string;
      published_at: string | null;
      size: number;
      has_changes: number;
      pinned: number;
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    folderId: row.folder_id,
    version: row.version,
    position: row.position,
    updatedAt: row.updated_at,
    appearance: appearance(row.appearance),
    published: row.published_at !== null,
    size: row.size,
    hasChanges: Boolean(row.has_changes),
    pinned: Boolean(row.pinned),
    ...(row.legacy_tab_id ? { legacyTabId: row.legacy_tab_id } : {}),
  }));
}

/** A UUID gives old tab identities a stable file address on every migration retry. */
export async function legacyMarkdownId(spaceId: string, tabId: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`wya:markdown:v1:${spaceId}:${tabId}`),
    ),
  );
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function availableName(
  title: string,
  folderId: string | null,
  files: SpaceFile[],
  ignoreId?: string,
) {
  let name = (title.replace(/[\\/\u0000-\u001f\u007f]/g, '-').trim() || 'Untitled')
    .replace(/^\.+/, '')
    .slice(0, 97);
  if (!/\.md$/i.test(name)) name += '.md';
  if (!fileNameSchema.safeParse(name).success) name = 'Untitled.md';
  const occupied = new Set(
    files
      .filter((file) => file.folderId === folderId && file.id !== ignoreId)
      .map((file) => file.name.toLowerCase()),
  );
  const stem = name.slice(0, -3);
  for (let n = 2; occupied.has(name.toLowerCase()); n++) name = `${stem.slice(0, 88)} (${n}).md`;
  return name;
}
export type LegacyPlacement = { tabId: string; folderId: string | null; version?: number };
export async function legacyMarkdownFiles(
  space: MarkdownSpaceRow,
  data: ProfileData,
  existing: SpaceFile[],
  placement: LegacyPlacement[],
  desktopId: string | null,
) {
  const hasLegacy = Boolean(
    data.tabs?.length ||
    Object.keys(data.documents ?? {}).length ||
    data.links?.length ||
    data.sections?.length,
  );
  const layout = hasLegacy
    ? getProfileLayout({ ...data, links: data.links ?? [] })
    : { tabs: [], defaultTabId: '' };
  const files = existing.filter((file) => !file.legacyTabId);
  for (const [position, tab] of layout.tabs.entries()) {
    const saved = existing.find((file) => file.legacyTabId === tab.id);
    const id = saved?.id ?? (await legacyMarkdownId(space.id, tab.id));
    const source =
      typeof data.documents?.[tab.id] === 'string'
        ? data.documents[tab.id]
        : getPageSource({ ...data, links: data.links ?? [] }, tab);
    if (fileBytes(source) > MAX_FILE_BYTES)
      throw new AppError(
        'This page exceeds the Markdown file limit. Its original data has not been changed.',
        409,
      );
    const folder = placement.find((item) => item.tabId === tab.id);
    const folderId = folder ? folder.folderId : saved ? saved.folderId : desktopId;
    const name = availableName(tab.title, folderId, files, id);
    const theme = normalizeDocumentAppearance(tab.appearance);
    files.push({
      id,
      name,
      content: source,
      folderId,
      size: fileBytes(source),
      appearance: theme,
      version: saved ? saved.version + 1 : 1,
      published: !tab.hidden,
      hasChanges: false,
      publishedAt: tab.hidden ? null : space.updated_at,
      publishedName: tab.hidden ? null : name,
      publishedContent: tab.hidden ? null : source,
      publishedAppearance: tab.hidden ? {} : theme,
      pinned: Boolean(desktopId) && folderId === desktopId,
      updatedAt: space.updated_at,
      position,
      legacyTabId: tab.id,
    });
  }
  return {
    files,
    defaultFileId: files.find((file) => file.legacyTabId === layout.defaultTabId)?.id,
  };
}

/** The live profile stores only metadata and its derived published lookup index. */
export function canonicalProfileData(data: ProfileData, files: SpaceFile[]): ProfileData {
  const {
    files: _files,
    tabs: _tabs,
    documents: _documents,
    sections: _sections,
    ungroupedPosition: _ungrouped,
    defaultTabId: _defaultTabId,
    mainWindowId: _mainWindowId,
    mobileLayout: _mobileLayout,
    ...base
  } = data;
  void _files;
  void _tabs;
  void _documents;
  void _sections;
  void _ungrouped;
  void _defaultTabId;
  const mainWindowId = normalizeMainWindowId(_mainWindowId, files);
  const mobileLayout = normalizeMobileLayout(_mobileLayout, files);
  const defaultFileId = files.some((file) => file.id === data.defaultFileId)
    ? data.defaultFileId
    : fileNavigationOrder(files)[0]?.id;
  const desktopOrder = base.desktopOrder?.map((id) => {
    if (!id.startsWith('tab-')) return id;
    const file = files.find((file) => file.legacyTabId === id.slice(4));
    return file ? `file-${file.id}` : id;
  });
  return {
    ...base,
    ...(desktopOrder ? { desktopOrder: [...new Set(desktopOrder)] } : {}),
    ...(mainWindowId ? { mainWindowId } : {}),
    ...(mobileLayout ? { mobileLayout } : {}),
    fileModelVersion: 1,
    defaultFileId,
    links: profileFileLinks(files, true),
  };
}

/** Legacy actions get a temporary projection; it is never persisted as another source of truth. */
export function legacyActionProfile(data: ProfileData, files: SpaceFile[]): ProfileData {
  const links: LinkItem[] = [];
  const claimed = new Set<string>();
  const documents: Record<string, string> = {};
  function editable(item: LinkItem): LinkItem {
    const { fileId: _owner, ...rest } = item;
    void _owner;
    for (const slug of [item.slug, ...(item.aliases ?? [])]) {
      if (claimed.has(slug))
        throw new AppError(
          'These files have overlapping card names. Edit their Markdown files directly.',
          409,
        );
      claimed.add(slug);
    }
    return {
      ...rest,
      ...(item.collection
        ? { collection: { ...item.collection, items: item.collection.items.map(editable) } }
        : {}),
    };
  }
  const tabs = [...files]
    .sort((a, b) => (a.position ?? 1000) - (b.position ?? 1000) || a.id.localeCompare(b.id))
    // Legacy tab actions can add arbitrary blocks and force .md names. Keep
    // widgets and plain text outside this temporary editing projection.
    .filter((file) => /\.md$/i.test(file.published ? (file.publishedName ?? file.name) : file.name))
    .map((file) => {
      const id = file.legacyTabId ?? file.id;
      const source = file.published ? (file.publishedContent ?? file.content) : file.content;
      documents[id] = source;
      const parsed = parsePageSource(source, { preserveUnknown: true });
      links.push(...parsed.items.map(({ item }) => editable(item)));
      return {
        id,
        title: file.published ? (file.publishedName ?? file.name) : file.name,
        slug: id,
        hidden: !file.published,
        appearance: file.published ? file.publishedAppearance : file.appearance,
        ...parsed.layout,
      };
    });
  const currentDefault = files.find((file) => file.id === data.defaultFileId);
  return {
    ...data,
    files,
    links,
    tabs,
    documents,
    defaultTabId:
      tabs.find((tab) => tab.id === (currentDefault?.legacyTabId ?? currentDefault?.id))?.id ??
      tabs[0]?.id,
  };
}

/** Write only changed projected documents back; unrelated private drafts remain untouched. */
export async function filesFromLegacyAction(
  space: MarkdownSpaceRow,
  original: ProfileData,
  changed: ProfileData,
  files: SpaceFile[],
  desktopId: string | null,
  now: string,
): Promise<ProfileData> {
  const layout = getProfileLayout(changed);
  const sameOrder =
    JSON.stringify(layout.tabs.map((tab) => tab.id)) ===
    JSON.stringify(original.tabs?.map((tab) => tab.id));
  const unprojected = files.filter(
    (file) => !original.tabs?.some((tab) => tab.id === (file.legacyTabId ?? file.id)),
  );
  const next: SpaceFile[] = [...unprojected];
  for (const [index, tab] of layout.tabs.entries()) {
    const current = files.find((file) => (file.legacyTabId ?? file.id) === tab.id);
    const previous = original.tabs?.find((old) => old.id === tab.id);
    const position = sameOrder && current ? (current.position ?? index) : index;
    const source = changed.documents?.[tab.id] ?? getPageSource(changed, tab);
    if (fileBytes(source) > MAX_FILE_BYTES)
      throw new AppError('A Markdown file must be 128 KB or smaller.');
    const unchanged =
      current &&
      previous &&
      source === original.documents?.[tab.id] &&
      tab.title === previous.title &&
      Boolean(tab.hidden) === Boolean(previous.hidden) &&
      sameDocumentAppearance(tab.appearance, previous.appearance);
    if (unchanged) {
      // Reordering is metadata only and must not publish a pending edit.
      next.push(
        current.position === position
          ? current
          : { ...current, position, version: current.version + 1, updatedAt: now },
      );
      continue;
    }
    if (current?.hasChanges)
      throw new AppError(
        'This file has an unpublished draft. Publish or discard that draft before editing it through a legacy action.',
        409,
      );
    const id = current?.id ?? (await legacyMarkdownId(space.id, tab.id));
    const folderId = current ? current.folderId : desktopId;
    const name = availableName(
      tab.title,
      folderId,
      [...next, ...files.filter((file) => file.id !== id)],
      id,
    );
    const theme = normalizeDocumentAppearance(tab.appearance);
    next.push({
      ...current,
      id,
      name,
      content: source,
      folderId,
      appearance: theme,
      size: fileBytes(source),
      version: (current?.version ?? 0) + 1,
      published: !tab.hidden,
      hasChanges: false,
      publishedAt: tab.hidden ? null : now,
      publishedName: tab.hidden ? null : name,
      publishedContent: tab.hidden ? null : source,
      publishedAppearance: tab.hidden ? {} : theme,
      pinned: Boolean(desktopId) && folderId === desktopId,
      updatedAt: now,
      position,
      ...(current?.legacyTabId || !current ? { legacyTabId: current?.legacyTabId ?? tab.id } : {}),
    });
  }
  for (const file of files)
    if (!next.some((after) => after.id === file.id) && file.hasChanges)
      throw new AppError(
        'This file has an unpublished draft. Save it before removing the file.',
        409,
      );
  // The compatibility projection excludes widgets, but their public short links
  // still belong to the space. Legacy edits must not take that ownership away.
  const reserved = new Map(
    allItems(profileFileLinks(unprojected, true)).flatMap((item) =>
      [item.slug, ...(item.aliases ?? [])].map((slug) => [slug, item.fileId] as const),
    ),
  );
  for (const file of next) {
    if (!file.published || unprojected.some((existing) => existing.id === file.id)) continue;
    const before = files.find((existing) => existing.id === file.id);
    if (
      before?.published &&
      file.publishedName === before.publishedName &&
      file.publishedContent === before.publishedContent
    )
      continue;
    for (const item of allItems(profileFileLinks([file], true)))
      for (const slug of [item.slug, ...(item.aliases ?? [])])
        if (reserved.has(slug) && reserved.get(slug) !== file.id)
          throw new AppError(
            `The short link /${slug} is already published in another file. Choose a unique slug before publishing.`,
            409,
          );
  }
  const defaultTab = layout.defaultTabId;
  const previousDefault = files.find((file) => file.id === original.defaultFileId);
  const retainUnprojectedDefault =
    previousDefault &&
    defaultTab === original.defaultTabId &&
    !original.tabs?.some((tab) => tab.id === (previousDefault.legacyTabId ?? previousDefault.id)) &&
    next.some((file) => file.id === previousDefault.id);
  const defaultFileId =
    // Editing an unrelated Markdown page must not replace a widget/text default
    // with the fallback page used only inside the legacy action adapter.
    (retainUnprojectedDefault ? previousDefault.id : undefined) ??
    next.find((file) => (file.legacyTabId ?? file.id) === defaultTab)?.id ??
    (await legacyMarkdownId(space.id, defaultTab));
  return { ...canonicalProfileData({ ...changed, defaultFileId }, next), files: next };
}

export async function restoreMarkdownSnapshot(
  db: D1Database,
  space: MarkdownSpaceRow,
  snapshot: ProfileData,
  current: SpaceFile[],
  now: string,
): Promise<ProfileData> {
  const folders = (
    await db
      .prepare('SELECT id,system FROM space_file_folders WHERE space_id=?')
      .bind(space.id)
      .all<{ id: string; system: string | null }>()
  ).results;
  const desktopId = folders.find((folder) => folder.system === 'desktop')?.id ?? null;
  let files: SpaceFile[];
  let defaultFileId = snapshot.defaultFileId;
  if (snapshot.files) {
    files = [];
    for (const saved of snapshot.files) {
      const existing = current.find((file) => file.id === saved.id);
      const folderId =
        saved.folderId && folders.some((folder) => folder.id === saved.folderId)
          ? saved.folderId
          : null;
      let name = saved.name;
      const extension = name.slice(name.lastIndexOf('.'));
      const stem = name.slice(0, -extension.length);
      for (
        let suffix = 2;
        files.some(
          (file) => file.folderId === folderId && file.name.toLowerCase() === name.toLowerCase(),
        );
        suffix++
      )
        name = `${stem.slice(0, 88)} (${suffix})${extension}`;
      files.push({
        ...saved,
        name,
        folderId,
        pinned: Boolean(desktopId) && folderId === desktopId,
        hasChanges: saved.hasChanges || (saved.published && name !== saved.publishedName),
        version: Math.max(saved.version, existing?.version ?? 0) + 1,
        updatedAt: now,
      });
    }
  } else {
    const converted = await legacyMarkdownFiles(
      { ...space, updated_at: now },
      snapshot,
      current,
      [],
      desktopId,
    );
    files = converted.files;
    defaultFileId = converted.defaultFileId;
  }
  // Deleted content is recoverable only through Trash. A historical snapshot
  // must never silently restore archived or permanently removed identities.
  const unavailable = await unavailableFileIds(db, space.id);
  files = files.filter((file) => !unavailable.has(file.id));
  return { ...canonicalProfileData({ ...snapshot, defaultFileId }, files), files };
}

const manifestSql = `(SELECT json_group_array(json_array(id,version)) FROM (SELECT id,version FROM space_files WHERE space_id=? ORDER BY id))`;
const manifest = (files: SpaceFile[]) =>
  JSON.stringify(
    [...files]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((file) => [file.id, file.version]),
  );
const guarded = 'EXISTS(SELECT 1 FROM space_file_guards WHERE id=?)';

/** All profile/file/index writes share an atomic predicate across both version domains. */
export async function commitMarkdownFiles(
  db: D1Database,
  space: MarkdownSpaceRow,
  before: SpaceFile[],
  after: SpaceFile[],
  data: ProfileData,
  options: {
    handle?: string;
    userId?: string;
    reason?: string;
    migrationPlacement?: LegacyPlacement[];
    bumpVersion?: boolean;
    now?: string;
    foldersBefore?: SpaceFolder[];
    archives?: TrashArchive[];
    restoringIds?: string[];
    prepareExtra?: (token: string) => Promise<void>;
    extra?: {
      guardSql?: string;
      guardValues?: (string | number | null)[];
      beforeFiles?: (token: string) => D1PreparedStatement[];
      afterFiles?: (token: string) => D1PreparedStatement[];
    };
  } = {},
) {
  const token = crypto.randomUUID();
  const now = options.now ?? new Date().toISOString();
  await options.prepareExtra?.(token);
  const folders =
    options.foldersBefore ??
    (
      await db
        .prepare(
          'SELECT id,name,parent_id AS parentId,version,system FROM space_file_folders WHERE space_id=?',
        )
        .bind(space.id)
        .all<SpaceFolder>()
    ).results;
  const genuinelyRemoved = before.filter((file) => !after.some((next) => next.id === file.id));
  const archives =
    options.archives ??
    genuinelyRemoved.map((file) =>
      makeTrashArchive(
        [file],
        [],
        file,
        folderTrail(folders, file.folderId)
          .map((folder) => (folder.system === 'desktop' ? 'Home' : folder.name))
          .join(' / ') || 'All files',
        now,
      ),
    );
  const archiveCount = archives.reduce(
    (total, archive) => total + archive.entry.fileCount + archive.entry.folderCount,
    0,
  );
  const archiveSize = archives.reduce((total, archive) => total + archive.entry.size, 0);
  if (archives.length) {
    const trash = await readTrash(db, space.id);
    if (
      trash.reduce((total, entry) => total + entry.fileCount + entry.folderCount, 0) +
        archiveCount >
        MAX_TRASH_ITEMS ||
      trash.reduce((total, entry) => total + entry.size, 0) + archiveSize > MAX_TRASH_BYTES
    )
      throw new AppError(
        'Trash is full. Permanently delete or restore some items before deleting more.',
        409,
      );
  }
  const allAddedIds = after
    .filter((file) => !before.some((old) => old.id === file.id))
    .map((file) => file.id);
  const archivedAddedIds = allAddedIds.filter((id) => !options.restoringIds?.includes(id));
  const extraGuard = options.extra?.guardSql ? ` AND (${options.extra.guardSql})` : '';
  const placementGuard = options.migrationPlacement
    ? ` AND (SELECT json_group_array(json_array(tab_id,folder_id,version)) FROM (SELECT tab_id,folder_id,version FROM space_page_files WHERE space_id=? ORDER BY tab_id))=?`
    : '';
  const placementValues = options.migrationPlacement
    ? [
        space.id,
        JSON.stringify(
          [...options.migrationPlacement]
            .sort((a, b) => (a.tabId < b.tabId ? -1 : a.tabId > b.tabId ? 1 : 0))
            .map((item) => [item.tabId, item.folderId, item.version]),
        ),
      ]
    : [];
  const statements = [
    db
      .prepare(
        `INSERT INTO space_file_guards(id,space_id)
    SELECT ?,id FROM spaces WHERE id=? AND version=? AND data=? AND ${manifestSql}=?${placementGuard}
      AND ${folderManifestSql}=?
      AND (SELECT COALESCE(sum(file_count+folder_count),0) FROM space_trash WHERE space_id=?)+?<=${MAX_TRASH_ITEMS}
      AND (SELECT COALESCE(sum(size),0) FROM space_trash WHERE space_id=?)+?<=${MAX_TRASH_BYTES}
      AND NOT EXISTS(SELECT 1 FROM space_file_tombstones WHERE space_id=? AND file_id IN (SELECT value FROM json_each(?)))
      AND NOT EXISTS(SELECT 1 FROM space_trash_items WHERE space_id=? AND kind='file' AND item_id IN (SELECT value FROM json_each(?)))${extraGuard}`,
      )
      .bind(
        token,
        space.id,
        space.version,
        space.data,
        space.id,
        manifest(before),
        ...placementValues,
        space.id,
        folderManifest(folders),
        space.id,
        archiveCount,
        space.id,
        archiveSize,
        space.id,
        JSON.stringify(allAddedIds),
        space.id,
        JSON.stringify(archivedAddedIds),
        ...(options.extra?.guardValues ?? []),
      ),
  ];
  if (options.migrationPlacement)
    statements.push(
      db
        .prepare(
          `INSERT INTO space_markdown_migrations(space_id,source_data,source_placement,migrated_at)
    SELECT ?,?,?,? WHERE ${guarded} ON CONFLICT(space_id) DO NOTHING`,
        )
        .bind(space.id, space.data, JSON.stringify(options.migrationPlacement), now, token),
    );
  if (options.reason) {
    const revisionId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO space_revisions(id,space_id,version,data,reason,created_at)
      SELECT ?,?,?,?,?,? WHERE ${guarded}`,
        )
        .bind(
          revisionId,
          space.id,
          space.version,
          JSON.stringify({ ...JSON.parse(space.data), fileSnapshotVersion: 1 }),
          options.reason,
          now,
          token,
        ),
    );
    // Keep each file snapshot below the database row limit, and each statement
    // below D1's bound-parameter limit. History remains one atomic operation.
    for (let offset = 0; offset < before.length; offset += 20) {
      const group = before.slice(offset, offset + 20);
      statements.push(
        db
          .prepare(
            `WITH snapshots(revision_id,file_id,data) AS (VALUES ${group.map(() => '(?,?,?)').join(',')})
             INSERT INTO space_file_revisions(revision_id,file_id,data) SELECT revision_id,file_id,data FROM snapshots WHERE ${guarded}`,
          )
          .bind(...group.flatMap((file) => [revisionId, file.id, JSON.stringify(file)]), token),
      );
    }
  }
  for (const archive of archives)
    statements.push(...archiveStatements(db, space.id, archive, token));
  statements.push(...(options.extra?.beforeFiles?.(token) ?? []));
  const changed = after.filter(
    (file) => !before.some((old) => JSON.stringify(old) === JSON.stringify(file)),
  );
  const changedIds = new Set(changed.map((file) => file.id));
  const removed = before.filter(
    (file) => !after.some((next) => next.id === file.id) || changedIds.has(file.id),
  );
  // Delete before inserting to allow atomic filename swaps within one folder.
  for (let offset = 0; offset < removed.length; offset += 80) {
    const group = removed.slice(offset, offset + 80);
    statements.push(
      db
        .prepare(
          `DELETE FROM space_files WHERE space_id=? AND id IN (${group.map(() => '?').join(',')}) AND ${guarded}`,
        )
        .bind(space.id, ...group.map((file) => file.id), token),
    );
  }
  for (let offset = 0; offset < changed.length; offset += 6) {
    const group = changed.slice(offset, offset + 6);
    statements.push(
      db
        .prepare(
          `WITH changed(id,space_id,name,folder_id,content,appearance,version,published_name,published_content,published_appearance,published_at,updated_at,legacy_tab_id,position) AS (VALUES ${group.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')})
          INSERT INTO space_files
          (id,space_id,name,folder_id,content,appearance,version,published_name,published_content,published_appearance,published_at,updated_at,legacy_tab_id,position)
          SELECT * FROM changed WHERE ${guarded}`,
        )
        .bind(
          ...group.flatMap((file) => [
            file.id,
            space.id,
            file.name,
            file.folderId,
            file.content,
            JSON.stringify(file.appearance ?? {}),
            file.version,
            file.published ? (file.publishedName ?? file.name) : null,
            file.published ? (file.publishedContent ?? file.content) : null,
            JSON.stringify(file.publishedAppearance ?? {}),
            file.published ? (file.publishedAt ?? file.updatedAt) : null,
            file.updatedAt,
            file.legacyTabId ?? null,
            file.position ?? 1000,
          ]),
          token,
        ),
    );
  }
  statements.push(...(options.extra?.afterFiles?.(token) ?? []));
  const content = canonicalProfileData(data, after);
  const updateIndex = statements.length;
  statements.push(
    db
      .prepare(
        `UPDATE spaces SET data=?, ${options.handle ? 'handle=?,' : ''}
    version=version+?, updated_at=? WHERE id=? AND ${guarded}`,
      )
      .bind(
        JSON.stringify(content),
        ...(options.handle ? [options.handle] : []),
        options.bumpVersion ? 1 : 0,
        now,
        space.id,
        token,
      ),
  );
  if (options.migrationPlacement)
    statements.push(
      db
        .prepare(`DELETE FROM space_page_files WHERE space_id=? AND ${guarded}`)
        .bind(space.id, token),
    );
  statements.push(db.prepare('DELETE FROM space_file_guards WHERE id=?').bind(token));
  const result = await db.batch(statements);
  if (!result[updateIndex].meta.changes)
    throw new AppError(
      'This space changed in another session. Reload it before trying again.',
      409,
    );
}

export async function ensureMarkdownFiles(
  db: D1Database,
  spaceId: string,
): Promise<MarkdownSpaceRow> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const space = await db
      .prepare('SELECT id,data,version,updated_at FROM spaces WHERE id=?')
      .bind(spaceId)
      .first<MarkdownSpaceRow>();
    if (!space) throw new AppError('Space not found.', 404);
    const data = JSON.parse(space.data) as ProfileData;
    if (data.fileModelVersion === 1) return space;
    const before = await readMarkdownFiles(db, spaceId);
    const placement = (
      await db
        .prepare(
          'SELECT tab_id AS tabId,folder_id AS folderId,version FROM space_page_files WHERE space_id=?',
        )
        .bind(spaceId)
        .all<LegacyPlacement>()
    ).results;
    const desktop = await db
      .prepare("SELECT id FROM space_file_folders WHERE space_id=? AND system='desktop'")
      .bind(spaceId)
      .first<{ id: string }>();
    const converted = await legacyMarkdownFiles(
      space,
      data,
      before,
      placement,
      desktop?.id ?? null,
    );
    const next = {
      ...data,
      defaultFileId: converted.defaultFileId,
      desktopOrder: data.desktopOrder?.map((id) =>
        id.startsWith('tab-')
          ? `file-${converted.files.find((file) => file.legacyTabId === id.slice(4))?.id ?? id.slice(4)}`
          : id,
      ),
    };
    try {
      await commitMarkdownFiles(db, space, before, converted.files, next, {
        migrationPlacement: placement,
      });
    } catch (error) {
      if (error instanceof AppError && error.status === 409 && attempt < 2) continue;
      throw error;
    }
  }
  const space = await db
    .prepare('SELECT id,data,version,updated_at FROM spaces WHERE id=?')
    .bind(spaceId)
    .first<MarkdownSpaceRow>();
  if (!space) throw new AppError('Space not found.', 404);
  return space;
}
