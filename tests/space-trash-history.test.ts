import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { trashPurgeHistoryStatements } from '../lib/space-trash-history.ts';
import { AppError } from '../lib/app-error.ts';
import type { SpaceFile } from '../lib/space-files.ts';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE space_revisions(id TEXT PRIMARY KEY,space_id TEXT,data TEXT,reason TEXT,created_at TEXT);
    CREATE TABLE space_file_revisions(revision_id TEXT REFERENCES space_revisions(id) ON DELETE CASCADE,
      file_id TEXT,data TEXT,PRIMARY KEY(revision_id,file_id));
    CREATE TABLE space_file_guards(id TEXT PRIMARY KEY,space_id TEXT);
    CREATE TABLE space_markdown_migrations(space_id TEXT PRIMARY KEY,source_data TEXT,source_placement TEXT);
  `);
  function prepare(sql: string) {
    let values: SQLInputValue[] = [];
    const statement = {
      bind(...args: SQLInputValue[]) {
        values = args;
        return statement;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
      execute() {
        return sqlite.prepare(sql).run(...values);
      },
    };
    return statement;
  }
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  return {
    sqlite,
    db,
    addRevision(id: string, data: unknown, spaceId = 'space', reason = 'Updated content') {
      sqlite
        .prepare('INSERT INTO space_revisions VALUES(?,?,?,?,?)')
        .run(id, spaceId, JSON.stringify(data), reason, '2026-10-27T00:00:00.000Z');
    },
    snapshot(revision: string, file: SpaceFile) {
      sqlite
        .prepare('INSERT INTO space_file_revisions VALUES(?,?,?)')
        .run(revision, file.id, JSON.stringify(file));
    },
    revision(id: string) {
      const row = sqlite.prepare('SELECT data FROM space_revisions WHERE id=?').get(id)!;
      return JSON.parse(row.data as string);
    },
  };
}

const file = (id: string, content: string, legacyTabId?: string): SpaceFile => ({
  id,
  name: `${id}.md`,
  content,
  folderId: null,
  size: content.length,
  version: 1,
  published: false,
  hasChanges: false,
  pinned: false,
  updatedAt: '2026-10-27T00:00:00.000Z',
  ...(legacyTabId ? { legacyTabId } : {}),
});

test('permanent purge removes modern snapshots and owned index payloads without erasing other files or spaces', async () => {
  const f = fixture();
  try {
    const removed = file('removed', 'SECRET draft');
    const kept = file('kept', '# Retained');
    const source = {
      name: 'Owner',
      bio: 'Retained Bio',
      theme: 'lilac',
      fileModelVersion: 1,
      fileSnapshotVersion: 1,
      defaultFileId: removed.id,
      desktopOrder: ['file-removed', 'file-kept', 'settings'],
      links: [
        { fileId: removed.id, label: 'SECRET index' },
        {
          fileId: kept.id,
          label: 'Keep index',
          collection: {
            items: [{ fileId: removed.id, label: 'SECRET nested' }, { label: 'Keep nested' }],
          },
        },
      ],
    };
    f.addRevision('modern', source, 'space', 'Published SECRET.md');
    f.addRevision('other', source, 'other-space');
    f.snapshot('modern', removed);
    f.snapshot('modern', kept);
    f.snapshot('other', removed);
    f.sqlite.prepare('INSERT INTO space_file_guards VALUES(?,?)').run('guard', 'space');
    f.sqlite
      .prepare('INSERT INTO space_markdown_migrations VALUES(?,?,?)')
      .run('space', 'SECRET backup', '[]');
    f.sqlite
      .prepare('INSERT INTO space_markdown_migrations VALUES(?,?,?)')
      .run('other-space', 'Other backup', '[]');

    await f.db.batch(await trashPurgeHistoryStatements(f.db, 'space', [removed], 'guard'));

    assert.equal(
      f.sqlite
        .prepare('SELECT count(*) AS n FROM space_file_revisions WHERE revision_id=?')
        .get('modern')!.n,
      1,
    );
    assert.deepEqual(
      JSON.parse(
        f.sqlite.prepare('SELECT data FROM space_file_revisions WHERE revision_id=?').get('modern')!
          .data as string,
      ),
      kept,
    );
    const actual = f.revision('modern');
    assert.equal(actual.bio, source.bio);
    assert.equal(actual.defaultFileId, undefined);
    assert.deepEqual(actual.desktopOrder, ['file-kept', 'settings']);
    assert.deepEqual(actual.links, [
      { fileId: kept.id, label: 'Keep index', collection: { items: [{ label: 'Keep nested' }] } },
    ]);
    const stored = f.sqlite
      .prepare('SELECT data,reason FROM space_revisions WHERE id=?')
      .get('modern')!;
    assert.doesNotMatch(JSON.stringify(stored), /SECRET/);
    assert.deepEqual(f.revision('other'), source);
    assert.equal(
      f.sqlite
        .prepare('SELECT count(*) AS n FROM space_file_revisions WHERE revision_id=?')
        .get('other')!.n,
      1,
    );
    assert.equal(
      f.sqlite
        .prepare('SELECT count(*) AS n FROM space_markdown_migrations WHERE space_id=?')
        .get('space')!.n,
      0,
    );
    assert.equal(
      f.sqlite
        .prepare('SELECT count(*) AS n FROM space_markdown_migrations WHERE space_id=?')
        .get('other-space')!.n,
      1,
    );
  } finally {
    f.sqlite.close();
  }
});

test('legacy purge converts affected revisions to remaining file snapshots and retains unrelated legacy history', async () => {
  const f = fixture();
  try {
    const removed = file('original-migrated-id', 'SECRET current', 'home');
    const source = {
      name: 'Owner',
      bio: 'Keep Bio',
      theme: 'lilac',
      defaultTabId: 'home',
      desktopOrder: ['tab-home', 'tab-keep', 'settings'],
      tabs: [
        { id: 'home', title: 'SECRET', slug: 'home', ungrouped: ['secret'], sections: [] },
        { id: 'keep', title: 'Keep', slug: 'keep', ungrouped: [], sections: [], hidden: true },
      ],
      documents: { home: '# SECRET historical', keep: '# Retained Markdown' },
      links: [
        {
          slug: 'secret',
          label: 'SECRET link',
          url: 'https://example.com',
          platform: 'website',
          visible: true,
        },
      ],
    };
    const unrelated = {
      ...source,
      desktopOrder: ['tab-keep', 'settings'],
      tabs: [source.tabs[1]],
      documents: { keep: '# Other content' },
      links: [],
      defaultTabId: 'keep',
    };
    f.addRevision('legacy', source);
    f.addRevision('unrelated', unrelated);
    f.sqlite.prepare('INSERT INTO space_file_guards VALUES(?,?)').run('guard', 'space');

    await f.db.batch(await trashPurgeHistoryStatements(f.db, 'space', [removed], 'guard'));

    const actual = f.revision('legacy');
    assert.equal(actual.fileSnapshotVersion, 1);
    assert.equal(actual.fileModelVersion, 1);
    assert.equal(actual.bio, source.bio);
    assert.equal(actual.tabs, undefined);
    assert.equal(actual.documents, undefined);
    const saved = f.sqlite
      .prepare('SELECT data FROM space_file_revisions WHERE revision_id=?')
      .all('legacy');
    assert.equal(saved.length, 1);
    const retained = JSON.parse(saved[0].data as string);
    assert.equal(retained.content, '# Retained Markdown');
    assert.equal(retained.legacyTabId, 'keep');
    assert.equal(retained.published, false);
    assert.equal(actual.defaultFileId, retained.id);
    assert.deepEqual(actual.desktopOrder, [`file-${retained.id}`, 'settings']);
    assert.doesNotMatch(JSON.stringify(actual) + JSON.stringify(saved), /SECRET/);
    assert.deepEqual(f.revision('unrelated'), unrelated);
  } finally {
    f.sqlite.close();
  }
});

test('history purge preparation cannot mutate data and every operation requires the matching space guard', async () => {
  const f = fixture();
  try {
    const removed = file('removed', 'SECRET');
    const source = { name: 'Owner', bio: '', theme: 'lilac', links: [], fileSnapshotVersion: 1 };
    f.addRevision('modern', source);
    f.snapshot('modern', removed);
    f.sqlite
      .prepare('INSERT INTO space_markdown_migrations VALUES(?,?,?)')
      .run('space', 'SECRET', '[]');
    f.sqlite.prepare('INSERT INTO space_file_guards VALUES(?,?)').run('wrong-space', 'other-space');
    const before = () =>
      JSON.stringify({
        revisions: f.sqlite.prepare('SELECT * FROM space_revisions').all(),
        files: f.sqlite.prepare('SELECT * FROM space_file_revisions').all(),
        backup: f.sqlite.prepare('SELECT * FROM space_markdown_migrations').all(),
      });
    const original = before();
    const statements = await trashPurgeHistoryStatements(f.db, 'space', [removed], 'missing');
    assert.equal(before(), original);
    await f.db.batch(statements);
    assert.equal(before(), original);
    await f.db.batch(await trashPurgeHistoryStatements(f.db, 'space', [removed], 'wrong-space'));
    assert.equal(before(), original);
  } finally {
    f.sqlite.close();
  }
});

test('unreadable historical payloads fail before permanent deletion is prepared', async () => {
  const f = fixture();
  try {
    f.sqlite
      .prepare('INSERT INTO space_revisions VALUES(?,?,?,?,?)')
      .run('broken', 'space', '{', 'Broken history', '2026-10-27');
    await assert.rejects(
      trashPurgeHistoryStatements(f.db, 'space', [file('removed', 'SECRET')], 'guard'),
      (error) => error instanceof AppError && error.status === 409,
    );
    assert.equal(
      f.sqlite.prepare('SELECT data FROM space_revisions WHERE id=?').get('broken')!.data,
      '{',
    );
  } finally {
    f.sqlite.close();
  }
});
