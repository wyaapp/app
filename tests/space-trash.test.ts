import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createSpaceFileService } from '../lib/space-file-service.ts';
import { createSpaceService } from '../lib/space-service.ts';
import { AppError } from '../lib/app-error.ts';
import {
  commitMarkdownFiles,
  ensureMarkdownFiles,
  readMarkdownFiles,
  restoreMarkdownSnapshot,
} from '../lib/markdown-file-store.ts';
function fixture(maxCompoundTerms = Infinity) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync('drizzle')
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(`drizzle/${name}`, 'utf8'));
  sqlite
    .prepare('INSERT INTO spaces(id,user_id,handle,data,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(
      'space',
      'owner',
      'alex',
      JSON.stringify({ name: 'Alex', bio: '', theme: 'lilac', links: [], fileModelVersion: 1 }),
      '2026-10-27',
      '2026-10-27',
    );
  function prepare(sql: string) {
    if (sql.split(/\bUNION\s+ALL\b/i).length > maxCompoundTerms)
      throw new Error('too many terms in compound SELECT: SQLITE_ERROR');
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
  const files = createSpaceFileService(db);
  const spaces = createSpaceService(db);
  return {
    sqlite,
    db,
    files,
    spaces,
    async create(name: string, content = '') {
      return (await files.change('owner', 'space', { action: 'create', name, content })).file!;
    },
  };
}
const status = (expected: number) => (error: unknown) =>
  error instanceof AppError && error.status === expected;

test('Trash preserves private draft and appearance, removes public content, and restores same identity privately with a collision-safe name', async () => {
  const f = fixture();
  try {
    let file = await f.create('hello.md', '# Published');
    file = (
      await f.files.change('owner', 'space', {
        action: 'publish',
        id: file.id,
        version: file.version,
      })
    ).file!;
    file = (
      await f.files.change('owner', 'space', {
        action: 'save',
        id: file.id,
        version: file.version,
        name: file.name,
        content: '# Unsaved to public',
        appearance: { theme: 'dim' },
      })
    ).file!;
    await f.files.change('owner', 'space', {
      action: 'delete',
      id: file.id,
      version: file.version,
    });
    assert.equal((await f.files.get('owner', 'space')).files?.length, 0);
    await assert.rejects(f.files.publicGet('alex', file.id), status(404));
    const entry = (await f.files.getTrash('owner', 'space')).trash[0];
    assert.equal(entry.name, 'hello.md');
    assert.equal(entry.fileCount, 1);
    await f.create('hello.md');
    const restored = await f.files.change('owner', 'space', {
      action: 'restore-trash',
      id: entry.id,
      version: entry.version,
    });
    assert.deepEqual(restored.restoredIds, [file.id]);
    const saved = (await f.files.get('owner', 'space', file.id)).file!;
    assert.equal(saved.content, file.content);
    assert.deepEqual(saved.appearance, file.appearance);
    assert.equal(saved.name, 'hello (2).md');
    assert.equal(saved.published, false);
    assert.equal(saved.version, file.version + 1);
    assert.equal((await f.files.getTrash('owner', 'space')).trash.length, 0);
    await assert.rejects(
      f.files.change('owner', 'space', {
        action: 'restore-trash',
        id: entry.id,
        version: entry.version,
      }),
      status(409),
    );
  } finally {
    f.sqlite.close();
  }
});

test('Nonempty nested folders move atomically to Trash and restore as a single private subtree', async () => {
  const f = fixture();
  try {
    const root = (
      await f.files.change('owner', 'space', { action: 'create-folder', name: 'Projects' })
    ).folder!;
    const child = (
      await f.files.change('owner', 'space', {
        action: 'create-folder',
        name: 'Nested',
        parentId: root.id,
      })
    ).folder!;
    const file = (
      await f.files.change('owner', 'space', {
        action: 'create',
        name: 'demo.widget',
        content: '```js\nlet x = 1;\n```',
        folderId: child.id,
      })
    ).file!;
    const deleted = await f.files.change('owner', 'space', {
      action: 'delete-folder',
      id: root.id,
      version: root.version,
    });
    assert.deepEqual(deleted.deletedIds, [file.id]);
    assert.equal(deleted.deletedFolderIds?.length, 2);
    const entry = deleted.trash![0];
    assert.equal(entry.folderCount, 2);
    await f.files.change('owner', 'space', {
      action: 'restore-trash',
      id: entry.id,
      version: entry.version,
    });
    assert.equal((await f.files.get('owner', 'space', file.id)).file!.folderId, child.id);
    assert.ok(
      (await f.files.get('owner', 'space')).folders?.some((folder) => folder.id === root.id),
    );
  } finally {
    f.sqlite.close();
  }
});

test('Trash is ownership scoped and a deleted parent falls back to Home when a file is restored', async () => {
  const f = fixture();
  try {
    const home = (await f.files.get('owner', 'space')).folders!.find(
      (folder) => folder.system === 'desktop',
    )!;
    const parent = (
      await f.files.change('owner', 'space', { action: 'create-folder', name: 'Gone' })
    ).folder!;
    const file = (
      await f.files.change('owner', 'space', {
        action: 'create',
        name: 'a.txt',
        content: 'private',
        folderId: parent.id,
      })
    ).file!;
    await f.files.change('owner', 'space', {
      action: 'delete',
      id: file.id,
      version: file.version,
    });
    const entry = (await f.files.getTrash('owner', 'space')).trash[0];
    await assert.rejects(f.files.getTrash('someone', 'space'), status(404));
    await assert.rejects(
      f.files.change('someone', 'space', {
        action: 'purge-trash',
        id: entry.id,
        version: entry.version,
      }),
      status(404),
    );
    await f.files.change('owner', 'space', {
      action: 'delete-folder',
      id: parent.id,
      version: parent.version,
    });
    await f.files.change('owner', 'space', {
      action: 'restore-trash',
      id: entry.id,
      version: entry.version,
    });
    assert.equal((await f.files.get('owner', 'space', file.id)).file!.folderId, home.id);
  } finally {
    f.sqlite.close();
  }
});

test('Purge removes snapshots and tombstones prevent history or stale commits from resurrecting removed identities', async () => {
  const f = fixture();
  try {
    const file = await f.create('private.md', '# Do not resurrect');
    await f.files.change('owner', 'space', {
      action: 'delete',
      id: file.id,
      version: file.version,
    });
    const entry = (await f.files.getTrash('owner', 'space')).trash[0];
    const oldSpace = await ensureMarkdownFiles(f.db, 'space');
    await f.files.change('owner', 'space', {
      action: 'purge-trash',
      id: entry.id,
      version: entry.version,
    });
    assert.equal((await f.files.getTrash('owner', 'space')).trash.length, 0);
    assert.equal(
      f.sqlite
        .prepare('SELECT count(*) AS n FROM space_file_revisions WHERE file_id=?')
        .get(file.id)!.n,
      0,
    );
    const current = await ensureMarkdownFiles(f.db, 'space');
    const restored = await restoreMarkdownSnapshot(
      f.db,
      current,
      { ...JSON.parse(current.data), files: [file] },
      [],
      new Date().toISOString(),
    );
    assert.deepEqual(restored.files, []);
    await assert.rejects(
      commitMarkdownFiles(f.db, oldSpace, [], [file], JSON.parse(oldSpace.data)),
      status(409),
    );
    await assert.rejects(
      commitMarkdownFiles(f.db, current, [], [file], JSON.parse(current.data)),
      status(409),
    );
  } finally {
    f.sqlite.close();
  }
});

test('Empty Trash deletes only the explicitly confirmed snapshot and keeps new arrivals', async () => {
  const f = fixture();
  try {
    const a = await f.create('a.md');
    await f.files.change('owner', 'space', { action: 'delete', id: a.id, version: a.version });
    const entries = (await f.files.getTrash('owner', 'space')).trash.map(({ id, version }) => ({
      id,
      version,
    }));
    const b = await f.create('b.md');
    await f.files.change('owner', 'space', { action: 'delete', id: b.id, version: b.version });
    await f.files.change('owner', 'space', { action: 'empty-trash', entries });
    assert.deepEqual(
      (await f.files.getTrash('owner', 'space')).trash.map((entry) => entry.name),
      ['b.md'],
    );
  } finally {
    f.sqlite.close();
  }
});

test('Active file quota blocks restore without dropping archived data and folder mutations invalidate stale commits', async () => {
  const f = fixture();
  try {
    const file = await f.create('old.md');
    await f.files.change('owner', 'space', {
      action: 'delete',
      id: file.id,
      version: file.version,
    });
    const entry = (await f.files.getTrash('owner', 'space')).trash[0];
    for (let i = 0; i < 30; i++) await f.create(`file-${i}.md`);
    await assert.rejects(
      f.files.change('owner', 'space', {
        action: 'restore-trash',
        id: entry.id,
        version: entry.version,
      }),
      status(409),
    );
    assert.equal((await f.files.getTrash('owner', 'space')).trash.length, 1);
    const space = await ensureMarkdownFiles(f.db, 'space');
    const before = await readMarkdownFiles(f.db, 'space');
    const folders = (await f.files.get('owner', 'space')).folders!;
    await f.files.change('owner', 'space', { action: 'create-folder', name: 'Concurrent' });
    await assert.rejects(
      commitMarkdownFiles(f.db, space, before, before, JSON.parse(space.data), {
        foldersBefore: folders,
      }),
      status(409),
    );
  } finally {
    f.sqlite.close();
  }
});

test('ordinary edits never enter Trash and its independent retention limit fails atomically without deleting active content', async () => {
  const f = fixture();
  try {
    let file = await f.create('keep.md', '# first');
    file = (
      await f.files.change('owner', 'space', {
        action: 'save',
        id: file.id,
        version: file.version,
        name: 'renamed.md',
        content: '# second',
      })
    ).file!;
    assert.equal((await f.files.getTrash('owner', 'space')).trash.length, 0);
    const now = new Date().toISOString();
    for (let i = 0; i < 100; i++) {
      const id = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      f.sqlite
        .prepare(
          `INSERT INTO space_trash(id,space_id,kind,name,original_location,deleted_at,file_count,folder_count,size) VALUES(?,'space','folder',?,'All files',?,0,1,100)`,
        )
        .run(id, `Old ${i}`, now);
      f.sqlite
        .prepare(
          `INSERT INTO space_trash_items(entry_id,space_id,item_id,kind,data) VALUES(?,'space',?,'folder',?)`,
        )
        .run(
          id,
          itemId,
          JSON.stringify({ id: itemId, name: `Old ${i}`, parentId: null, version: 1 }),
        );
    }
    await assert.rejects(
      f.files.change('owner', 'space', { action: 'delete', id: file.id, version: file.version }),
      (error) =>
        error instanceof AppError &&
        error.status === 409 &&
        error.message.startsWith('Trash is full'),
    );
    assert.equal((await f.files.get('owner', 'space', file.id)).file!.content, '# second');
    assert.equal((await f.files.getTrash('owner', 'space')).trash.length, 100);
    // Retained Trash does not count against the separate active file quota.
    assert.ok((await f.create('still-allowed.md')).id);
  } finally {
    f.sqlite.close();
  }
});

test('archived identities are excluded from old snapshots until explicitly restored through Trash', async () => {
  const f = fixture();
  try {
    const file = await f.create('recover.md', '# recoverable');
    await f.files.change('owner', 'space', {
      action: 'delete',
      id: file.id,
      version: file.version,
    });
    const current = await ensureMarkdownFiles(f.db, 'space');
    const old = await restoreMarkdownSnapshot(
      f.db,
      current,
      { ...JSON.parse(current.data), files: [file] },
      [],
      new Date().toISOString(),
    );
    assert.deepEqual(old.files, []);
    await assert.rejects(
      commitMarkdownFiles(f.db, current, [], [file], JSON.parse(current.data)),
      status(409),
    );
    assert.equal((await f.files.getTrash('owner', 'space')).trash.length, 1);
  } finally {
    f.sqlite.close();
  }
});

test('bulk history snapshots, multi-file writes, and Trash work with a low D1 compound SELECT limit', async () => {
  const f = fixture(2);
  try {
    const created = [];
    for (let i = 0; i < 8; i++) created.push(await f.create(`file-${i}.md`, `# File ${i}`));
    const space = await ensureMarkdownFiles(f.db, 'space');
    const before = await readMarkdownFiles(f.db, 'space');
    const changed = before.map((file) => ({
      ...file,
      content: file.content + '\nChanged',
      version: file.version + 1,
    }));
    await commitMarkdownFiles(f.db, space, before, changed, JSON.parse(space.data), {
      reason: 'Bulk edit',
      bumpVersion: true,
    });
    assert.equal((await f.files.get('owner', 'space')).files?.length, 8);
    const file = (await f.files.get('owner', 'space', created[0].id)).file!;
    await f.files.change('owner', 'space', {
      action: 'delete',
      id: file.id,
      version: file.version,
    });
    const entry = (await f.files.getTrash('owner', 'space')).trash[0];
    assert.equal(entry.fileCount, 1);
    assert.equal((await f.files.get('owner', 'space')).files?.length, 7);
    await f.files.change('owner', 'space', {
      action: 'restore-trash',
      id: entry.id,
      version: entry.version,
    });
    assert.equal((await f.files.get('owner', 'space', file.id)).file?.content, file.content);
  } finally {
    f.sqlite.close();
  }
});

test('archived paths name the system desktop Home without changing optimistic folder manifests', async () => {
  const f = fixture();
  try {
    const home = (await f.files.get('owner', 'space')).folders!.find(
      (folder) => folder.system === 'desktop',
    )!;
    f.sqlite.prepare('UPDATE space_file_folders SET name=? WHERE id=?').run('Desktop', home.id);
    const file = (
      await f.files.change('owner', 'space', {
        action: 'create',
        name: 'home.md',
        content: '# Home',
        folderId: home.id,
      })
    ).file!;
    await f.files.change('owner', 'space', {
      action: 'delete',
      id: file.id,
      version: file.version,
    });
    assert.equal((await f.files.getTrash('owner', 'space')).trash[0].originalLocation, 'Home');
  } finally {
    f.sqlite.close();
  }
});
