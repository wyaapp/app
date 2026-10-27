import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { AppError } from '../lib/app-error.ts';
import {
  canonicalProfileData,
  commitMarkdownFiles,
  ensureMarkdownFiles,
  filesFromLegacyAction,
  legacyActionProfile,
  legacyMarkdownId,
  readMarkdownFiles,
  restoreMarkdownSnapshot,
  type MarkdownSpaceRow,
} from '../lib/markdown-file-store.ts';
import { serializePageItem, parsePageSource } from '../lib/page-documents.ts';
import { publicProfileFiles } from '../lib/profile-files.ts';
import { createSpaceFileService } from '../lib/space-file-service.ts';
import { createSpaceService } from '../lib/space-service.ts';
import type { ProfileData, LinkItem } from '../lib/profile-types.ts';

function fixture(data: ProfileData) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync('drizzle')
    .filter((value) => value.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(`drizzle/${name}`, 'utf8'));
  }
  sqlite
    .prepare('INSERT INTO spaces(id,user_id,handle,data,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('space', 'owner', 'alex', JSON.stringify(data), '2026-10-26', '2026-10-27');
  let beforeBatch: (() => void) | undefined;
  function prepare(sql: string) {
    let values: SQLInputValue[] = [];
    const statement = {
      bind(...args: SQLInputValue[]) {
        values = args;
        return statement;
      },
      async first() {
        return sqlite.prepare(sql).get(...values) ?? null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
      async run() {
        return statement.execute();
      },
      execute() {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  }
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const intercept = beforeBatch;
      beforeBatch = undefined;
      intercept?.();
      sqlite.exec('BEGIN');
      try {
        const result = statements.map((statement) => statement.execute());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  return {
    sqlite,
    db,
    row: () =>
      sqlite
        .prepare('SELECT id,data,version,updated_at FROM spaces WHERE id=?')
        .get('space') as MarkdownSpaceRow,
    beforeBatch(callback: () => void) {
      beforeBatch = callback;
    },
  };
}
const link: LinkItem = {
  id: 'stable-code',
  slug: 'code',
  aliases: ['github'],
  label: 'Code',
  platform: 'website',
  url: 'https://example.com/public',
  visible: true,
};
const publicSource = '# Existing text\n\n' + serializePageItem(link) + '\n\nFinal **paragraph**.\n';
const legacy: ProfileData = {
  name: 'Alex',
  bio: 'Hello',
  theme: 'lilac',
  links: [link],
  tabs: [
    {
      id: 'home',
      title: 'Home',
      slug: 'home',
      sections: [],
      ungrouped: ['code'],
      appearance: { theme: 'dim' },
    },
    { id: 'private', title: 'Private', slug: 'private', hidden: true, sections: [], ungrouped: [] },
  ],
  defaultTabId: 'home',
  documents: { home: publicSource, private: '# Private notes\n\nNot published.' },
  desktopOrder: ['tab-home', 'about', 'tab-private'],
};

test('legacy migration preserves exact Markdown, publication, appearance, placement and ordinary files', async () => {
  const f = fixture(legacy);
  try {
    const desktop = f.sqlite
      .prepare("SELECT id FROM space_file_folders WHERE space_id='space' AND system='desktop'")
      .get()!.id as string;
    f.sqlite
      .prepare('INSERT INTO space_file_folders(id,space_id,name) VALUES(?,?,?)')
      .run('folder', 'space', 'Projects');
    f.sqlite
      .prepare('INSERT INTO space_page_files(space_id,tab_id,folder_id,version) VALUES(?,?,?,?)')
      .run('space', 'home', 'folder', 3);
    f.sqlite
      .prepare(
        'INSERT INTO space_files(id,space_id,name,folder_id,content,version,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run('ordinary', 'space', 'Socials.md', 'folder', '# Keep original file', 4, '2026-10-25');
    const oldData = f.row().data;
    const migrated = await ensureMarkdownFiles(f.db, 'space');
    const files = await readMarkdownFiles(f.db, 'space');
    const home = files.find((file) => file.legacyTabId === 'home')!;
    const privateFile = files.find((file) => file.legacyTabId === 'private')!;
    assert.equal(home.id, await legacyMarkdownId('space', 'home'));
    assert.match(home.id, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(home.content, publicSource);
    assert.equal(home.publishedContent, publicSource);
    assert.equal(home.name, 'Socials (2).md');
    assert.equal(home.folderId, 'folder');
    assert.equal(home.pinned, false);
    assert.equal(home.published, true);
    assert.deepEqual(home.appearance, { theme: 'dim' });
    assert.equal(privateFile.content, legacy.documents!.private);
    assert.equal(privateFile.published, false);
    assert.equal(privateFile.folderId, desktop);
    assert.equal(privateFile.pinned, true);
    assert.equal(
      publicProfileFiles(files).some((file) => file.id === privateFile.id),
      false,
    );
    assert.equal(files.find((file) => file.id === 'ordinary')?.content, '# Keep original file');
    assert.equal(files.find((file) => file.id === 'ordinary')?.version, 4);
    const stored = JSON.parse(migrated.data) as ProfileData;
    for (const key of ['tabs', 'documents', 'sections', 'defaultTabId', 'files'])
      assert.ok(!Object.hasOwn(stored, key));
    assert.equal(stored.defaultFileId, home.id);
    assert.equal(stored.links[0].id, 'stable-code');
    assert.equal(stored.links[0].fileId, home.id);
    assert.deepEqual(stored.links[0].aliases, ['github']);
    assert.deepEqual(stored.desktopOrder, [`file-${home.id}`, 'about', `file-${privateFile.id}`]);
    assert.equal(
      f.sqlite.prepare('SELECT source_data FROM space_markdown_migrations').get()?.source_data,
      oldData,
    );
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM space_page_files').get()?.n, 0);
    const first = structuredClone(files);
    assert.equal((await ensureMarkdownFiles(f.db, 'space')).data, migrated.data);
    assert.deepEqual(await readMarkdownFiles(f.db, 'space'), first);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM space_file_guards').get()?.n, 0);
  } finally {
    f.sqlite.close();
  }
});

test('content too large for migration leaves the original layout and placements intact', async () => {
  const data = { ...legacy, documents: { ...legacy.documents, home: 'a'.repeat(128 * 1024 + 1) } };
  const f = fixture(data);
  try {
    const before = f.row();
    await assert.rejects(
      ensureMarkdownFiles(f.db, 'space'),
      (error) => error instanceof AppError && error.status === 409,
    );
    assert.deepEqual(f.row(), before);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM space_files').get()?.n, 0);
    assert.equal(
      f.sqlite.prepare('SELECT count(*) AS n FROM space_markdown_migrations').get()?.n,
      0,
    );
  } finally {
    f.sqlite.close();
  }
});

test('canonical projection never stores tab content and never indexes unpublished draft changes', async () => {
  const f = fixture(legacy);
  try {
    await ensureMarkdownFiles(f.db, 'space');
    const files = await readMarkdownFiles(f.db, 'space');
    const home = files.find((file) => file.legacyTabId === 'home')!;
    home.content = serializePageItem({
      ...link,
      label: 'Private pending label',
      url: 'https://example.com/secret',
    });
    home.hasChanges = true;
    const canonical = canonicalProfileData({ ...legacy, files, defaultFileId: home.id }, files);
    assert.equal(canonical.links[0].url, link.url);
    assert.equal(canonical.links[0].label, link.label);
    assert.ok(!JSON.stringify(canonical).includes('Private pending'));
    assert.ok(!Object.hasOwn(canonical, 'files'));
    assert.ok(!Object.hasOwn(canonical, 'documents'));
    assert.equal(canonical.fileModelVersion, 1);
  } finally {
    f.sqlite.close();
  }
});

test('legacy mutation projection reads card registry and Markdown from the same published snapshot', async () => {
  const f = fixture(legacy);
  try {
    const space = await ensureMarkdownFiles(f.db, 'space');
    const files = await readMarkdownFiles(f.db, 'space');
    const home = files.find((file) => file.legacyTabId === 'home')!;
    home.content = serializePageItem({
      ...link,
      label: 'Private pending label',
      url: 'https://example.com/secret',
    });
    home.hasChanges = true;
    const projected = legacyActionProfile(JSON.parse(space.data), files);
    const inDocument = parsePageSource(projected.documents!.home, { preserveUnknown: true })
      .items[0].item;
    assert.equal(projected.links[0].url, inDocument.url);
    assert.equal(projected.links[0].label, inDocument.label);
    assert.ok(!Object.hasOwn(projected.links[0], 'fileId'));
    assert.equal(home.content.includes('Private pending label'), true);
  } finally {
    f.sqlite.close();
  }
});

test('atomic file commit rejects stale file versions without losing concurrent edits or recording a revision', async () => {
  const f = fixture(legacy);
  try {
    const space = await ensureMarkdownFiles(f.db, 'space');
    const before = await readMarkdownFiles(f.db, 'space');
    const after = structuredClone(before);
    const home = after.find((file) => file.legacyTabId === 'home')!;
    home.content = '# Losing edit';
    home.version++;
    f.beforeBatch(() =>
      f.sqlite
        .prepare('UPDATE space_files SET content=?,version=version+1 WHERE id=?')
        .run('# Concurrent winning edit', home.id),
    );
    await assert.rejects(
      commitMarkdownFiles(f.db, space, before, after, JSON.parse(space.data), {
        reason: 'Stale mutation',
        bumpVersion: true,
      }),
      (error) => error instanceof AppError && error.status === 409,
    );
    assert.equal(
      f.sqlite.prepare('SELECT content FROM space_files WHERE id=?').get(home.id)?.content,
      '# Concurrent winning edit',
    );
    assert.equal(f.row().version, space.version);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM space_revisions').get()?.n, 0);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM space_file_guards').get()?.n, 0);
  } finally {
    f.sqlite.close();
  }
});

test('atomic file commit rolls back failed insertions including file deletion, profile revision and guard', async () => {
  const f = fixture(legacy);
  try {
    const space = await ensureMarkdownFiles(f.db, 'space');
    const before = await readMarkdownFiles(f.db, 'space');
    const after = structuredClone(before);
    after[1].name = after[0].name;
    after[1].folderId = after[0].folderId;
    after[1].version++;
    await assert.rejects(
      commitMarkdownFiles(f.db, space, before, after, JSON.parse(space.data), {
        reason: 'Bad rename',
        bumpVersion: true,
      }),
      /UNIQUE constraint failed/,
    );
    assert.deepEqual(await readMarkdownFiles(f.db, 'space'), before);
    assert.deepEqual(f.row(), space);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM space_revisions').get()?.n, 0);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM space_file_guards').get()?.n, 0);
  } finally {
    f.sqlite.close();
  }
});

test('migration retries a concurrent legacy placement change instead of losing the new location', async () => {
  const f = fixture(legacy);
  try {
    const desktop = f.sqlite
      .prepare("SELECT id FROM space_file_folders WHERE space_id='space' AND system='desktop'")
      .get()!.id as string;
    f.sqlite
      .prepare('INSERT INTO space_file_folders(id,space_id,name) VALUES(?,?,?)')
      .run('folder', 'space', 'Projects');
    f.sqlite
      .prepare('INSERT INTO space_page_files(space_id,tab_id,folder_id,version) VALUES(?,?,?,?)')
      .run('space', 'home', desktop, 1);
    f.beforeBatch(() =>
      f.sqlite
        .prepare(
          'UPDATE space_page_files SET folder_id=?,version=version+1 WHERE space_id=? AND tab_id=?',
        )
        .run('folder', 'space', 'home'),
    );
    await ensureMarkdownFiles(f.db, 'space');
    assert.equal(
      (await readMarkdownFiles(f.db, 'space')).find((file) => file.legacyTabId === 'home')
        ?.folderId,
      'folder',
    );
    const saved = JSON.parse(
      f.sqlite.prepare('SELECT source_placement FROM space_markdown_migrations').get()!
        .source_placement as string,
    );
    assert.deepEqual(saved, [{ tabId: 'home', folderId: 'folder', version: 2 }]);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM space_file_guards').get()?.n, 0);
  } finally {
    f.sqlite.close();
  }
});

test('legacy metadata actions preserve pending drafts and reject edits to a file with a pending draft', async () => {
  const f = fixture(legacy);
  try {
    const space = await ensureMarkdownFiles(f.db, 'space');
    const files = await readMarkdownFiles(f.db, 'space');
    const home = files.find((file) => file.legacyTabId === 'home')!;
    home.content = '# Pending private prose';
    home.hasChanges = true;
    const original = legacyActionProfile(JSON.parse(space.data), files);
    const changed = { ...original, bio: 'Updated bio' };
    const saved = await filesFromLegacyAction(space, original, changed, files, null, '2026-10-28');
    assert.equal(saved.bio, 'Updated bio');
    assert.deepEqual(
      saved.files?.find((file) => file.id === home.id),
      home,
    );
    assert.equal(saved.links[0].url, link.url);
    await assert.rejects(
      filesFromLegacyAction(
        space,
        original,
        {
          ...changed,
          documents: { ...changed.documents, home: '# Legacy change' },
        },
        files,
        null,
        '2026-10-28',
      ),
      (error) => error instanceof AppError && error.status === 409,
    );
  } finally {
    f.sqlite.close();
  }
});

test('restoring a file snapshot increases stale file versions and safely handles removed folders', async () => {
  const f = fixture(legacy);
  try {
    const space = await ensureMarkdownFiles(f.db, 'space');
    const files = await readMarkdownFiles(f.db, 'space');
    const saved = structuredClone(files);
    saved[0].folderId = 'removed-folder';
    saved[0].content = '# Older saved content';
    files[0].version += 5;
    const restored = await restoreMarkdownSnapshot(
      f.db,
      space,
      { ...JSON.parse(space.data), files: saved },
      files,
      '2026-10-28',
    );
    const file = restored.files!.find((file) => file.id === files[0].id)!;
    assert.equal(file.content, '# Older saved content');
    assert.equal(file.folderId, null);
    assert.equal(file.version, files[0].version + 1);
    assert.equal(file.updatedAt, '2026-10-28');
    assert.ok(!Object.hasOwn(restored, 'tabs'));
    assert.ok(!Object.hasOwn(restored, 'documents'));
  } finally {
    f.sqlite.close();
  }
});

test('publishing records restorable private and published file snapshots with stable identities', async () => {
  const f = fixture(legacy);
  try {
    const service = createSpaceService(f.db);
    const fileService = createSpaceFileService(f.db);
    const owner = (await service.getAccount('owner', 'space'))!;
    const home = owner.files!.find((file) => file.legacyTabId === 'home')!;
    const draftSource =
      '# Pending changes\n\n' + serializePageItem({ ...link, url: 'https://example.com/changed' });
    const draft = (
      await fileService.change('owner', 'space', {
        action: 'save',
        id: home.id,
        version: home.version,
        name: 'Draft name.md',
        content: draftSource,
        appearance: { theme: 'black' },
      })
    ).file!;
    assert.equal(draft.hasChanges, true);
    const published = (
      await fileService.change('owner', 'space', {
        action: 'publish',
        id: draft.id,
        version: draft.version,
      })
    ).file!;
    const current = (await service.getAccount('owner', 'space'))!;
    assert.equal(current.version, owner.version + 1);
    assert.equal(
      (await service.getPublicProfile('alex'))!.links[0].url,
      'https://example.com/changed',
    );
    const revision = f.sqlite
      .prepare('SELECT id,data FROM space_revisions WHERE space_id=? AND version=?')
      .get('space', owner.version)!;
    const metadata = JSON.parse(revision.data as string);
    assert.equal(metadata.fileSnapshotVersion, 1);
    assert.ok(!Object.hasOwn(metadata, 'files'));
    assert.ok(!JSON.stringify(metadata).includes('Pending changes'));
    assert.equal(
      f.sqlite
        .prepare('SELECT count(*) AS n FROM space_file_revisions WHERE revision_id=?')
        .get(revision.id)?.n,
      owner.files!.length,
    );
    const restored = await service.mutate('owner', {
      action: 'restore_revision',
      spaceId: 'space',
      expectedVersion: current.version,
      revision: owner.version,
    });
    const restoredHome = restored.files!.find((file) => file.id === home.id)!;
    assert.equal(restoredHome.version, published.version + 1);
    assert.equal(restoredHome.content, draft.content);
    assert.equal(restoredHome.name, draft.name);
    assert.equal(restoredHome.hasChanges, true);
    assert.equal(restoredHome.publishedContent, home.publishedContent);
    assert.equal(restoredHome.publishedName, home.publishedName);
    assert.deepEqual(restoredHome.publishedAppearance, home.publishedAppearance);
    const visible = (await service.getPublicProfile('alex'))!;
    assert.equal(visible.links[0].id, link.id);
    assert.equal(visible.links[0].fileId, home.id);
    assert.equal(visible.links[0].url, link.url);
    assert.ok(!JSON.stringify(visible).includes('Pending changes'));
  } finally {
    f.sqlite.close();
  }
});
