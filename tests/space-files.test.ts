import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createSpaceFileService } from '../lib/space-file-service.ts';
import {
  fileActionSchema,
  decodeTextFile,
  fileLinkUrl,
  MAX_FILE_BYTES,
  MAX_SPACE_FILES,
} from '../lib/space-files.ts';
import { AppError } from '../lib/app-error.ts';
import {
  folderActionSchema,
  folderTrail,
  MAX_FOLDER_DEPTH,
  MAX_SPACE_FOLDERS,
  canMoveFolder,
  desktopFolder,
  folderDepth,
  folderIdSchema,
} from '../lib/space-folders.ts';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  let beforeRun: ((sql: string) => void) | undefined;
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync('drizzle')
    .filter((file) => file.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(`drizzle/${file}`, 'utf8'));
  for (const [id, user] of [
    ['one', 'alice'],
    ['two', 'alice'],
    ['three', 'bob'],
  ]) {
    sqlite
      .prepare(
        'INSERT INTO spaces (id,user_id,handle,data,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      )
      .run(id, user, id, '{}', 'now', 'now');
  }
  const db = {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      const statement = {
        bind(...input: SQLInputValue[]) {
          values = input;
          return statement;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...values) };
        },
        async run() {
          beforeRun?.(sql);
          return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return {
    sqlite,
    service: createSpaceFileService(db),
    db,
    interceptRun(callback?: (sql: string) => void) {
      beforeRun = callback;
    },
  };
}
const status = (code: number) => (error: unknown) =>
  error instanceof AppError && error.status === code;
const create = (name = 'readme.md', content = '# Hello') => ({ action: 'create', name, content });
const createFolder = (name: string, parentId: string | null = null) => ({
  action: 'create-folder',
  name,
  parentId,
});

test('folder creation rechecks depth and quota inside the write after concurrent changes', async () => {
  const { service, sqlite, interceptRun } = fixture();
  try {
    const parent = (await service.change('alice', 'one', createFolder('Race parent'))).folder!;
    let deep: string | null = null;
    for (let i = 0; i < 4; i++)
      deep = (await service.change('alice', 'one', createFolder(`Level ${i}`, deep))).folder!.id;
    interceptRun((sql) => {
      if (!sql.includes('INSERT INTO space_file_folders')) return;
      interceptRun();
      sqlite
        .prepare('UPDATE space_file_folders SET parent_id = ?, version = version + 1 WHERE id = ?')
        .run(deep, parent.id);
    });
    await assert.rejects(
      service.change('alice', 'one', createFolder('Racing child', parent.id)),
      status(400),
    );
    assert.equal(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM space_file_folders WHERE name = 'Racing child'")
        .get()?.n,
      0,
    );
    for (let i = 5; i < MAX_SPACE_FOLDERS - 1; i++)
      await service.change('alice', 'one', createFolder(`Fill ${i}`));
    interceptRun((sql) => {
      if (!sql.includes('INSERT INTO space_file_folders')) return;
      interceptRun();
      sqlite
        .prepare('INSERT INTO space_file_folders (id,space_id,name) VALUES (?,?,?)')
        .run(crypto.randomUUID(), 'one', 'Concurrent last folder');
    });
    await assert.rejects(service.change('alice', 'one', createFolder('Over limit')), status(400));
    assert.equal(
      (await service.get('alice', 'one')).folders!.filter((folder) => !folder.system).length,
      MAX_SPACE_FOLDERS,
    );
  } finally {
    sqlite.close();
  }
});

test('each space has a protected Desktop directory that does not consume user folder limits', async () => {
  const { service, sqlite } = fixture();
  try {
    const owned = (await service.get('alice', 'one')).folders!;
    const desktop = desktopFolder(owned)!;
    assert.ok(folderIdSchema.safeParse(desktop.id).success);
    assert.equal(desktop.name, 'Desktop');
    assert.equal(desktop.parentId, null);
    assert.equal(owned.length, 1);
    assert.notEqual(desktop.id, desktopFolder((await service.get('alice', 'two')).folders!)!.id);
    assert.equal(folderDepth(owned, desktop.id), 0);
    assert.equal(canMoveFolder(owned, desktop.id, null), false);
    assert.ok(
      (await service.get('alice', 'one')).pages!.every((page) => page.folderId === desktop.id),
    );
    sqlite.prepare('UPDATE spaces SET data = ? WHERE id = ?').run(
      JSON.stringify({
        tabs: [
          {
            id: 'home',
            slug: 'links',
            title: 'Links',
            hidden: true,
            sections: [],
            ungrouped: [],
          },
        ],
      }),
      'one',
    );
    const empty = await service.publicGet('one');
    assert.deepEqual(empty.files, []);
    assert.deepEqual(empty.pages, []);
    assert.deepEqual(empty.folders, [{ ...desktop, version: 0 }]);
    for (const action of [
      { action: 'rename-folder', name: 'Other' },
      { action: 'move-folder', parentId: null },
      { action: 'delete-folder' },
    ])
      await assert.rejects(
        service.change('alice', 'one', { ...action, id: desktop.id, version: desktop.version }),
        status(400),
      );
    await assert.rejects(service.change('alice', 'one', createFolder('desktop')), status(409));
    assert.throws(
      () => sqlite.prepare('DELETE FROM space_file_folders WHERE id = ?').run(desktop.id),
      /protected/,
    );
    assert.throws(
      () =>
        sqlite.prepare('UPDATE space_file_folders SET system = NULL WHERE id = ?').run(desktop.id),
      /protected/,
    );
    let parentId = desktop.id;
    for (let depth = 1; depth <= MAX_FOLDER_DEPTH; depth++) {
      parentId = (await service.change('alice', 'one', createFolder(`Nested ${depth}`, parentId)))
        .folder!.id;
      assert.equal(folderDepth((await service.get('alice', 'one')).folders!, parentId), depth);
    }
    await assert.rejects(
      service.change('alice', 'one', createFolder('Too deep', parentId)),
      status(400),
    );
    const top = (await service.get('alice', 'one')).folders!.find(
      (folder) => folder.name === 'Nested 1',
    )!;
    assert.equal(canMoveFolder((await service.get('alice', 'one')).folders!, top.id, null), true);
    const moved = (
      await service.change('alice', 'one', {
        action: 'move-folder',
        id: top.id,
        version: top.version,
        parentId: null,
      })
    ).folder!;
    assert.equal(
      canMoveFolder((await service.get('alice', 'one')).folders!, moved.id, desktop.id),
      true,
    );
    await service.change('alice', 'one', {
      action: 'move-folder',
      id: moved.id,
      version: moved.version,
      parentId: desktop.id,
    });
  } finally {
    sqlite.close();
  }
});

test('Desktop membership governs files and page shortcuts while publication stays independent', async () => {
  const { service, sqlite } = fixture();
  try {
    const desktop = desktopFolder((await service.get('alice', 'one')).folders!)!;
    const nested = (await service.change('alice', 'one', createFolder('Notes', desktop.id)))
      .folder!;
    let file = (
      await service.change('alice', 'one', {
        ...create('draft.md', 'Private draft'),
        folderId: desktop.id,
      })
    ).file!;
    assert.equal(file.pinned, true);
    assert.deepEqual((await service.publicGet('one')).files, []);
    await assert.rejects(service.publicGet('one', file.id), status(404));
    file = (
      await service.change('alice', 'one', {
        action: 'publish',
        id: file.id,
        version: file.version,
      })
    ).file!;
    assert.equal((await service.publicGet('one', file.id)).file!.pinned, true);
    const stale = file.version;
    file = (
      await service.change('alice', 'one', {
        action: 'move',
        id: file.id,
        version: file.version,
        folderId: nested.id,
      })
    ).file!;
    assert.equal(file.pinned, false, 'descendants are not direct desktop icons');
    await assert.rejects(
      service.change('alice', 'one', { action: 'pin', id: file.id, version: stale, pinned: true }),
      status(409),
    );
    file = (
      await service.change('alice', 'one', {
        action: 'pin',
        id: file.id,
        version: file.version,
        pinned: true,
      })
    ).file!;
    assert.equal(file.folderId, desktop.id);
    file = (
      await service.change('alice', 'one', {
        action: 'unpublish',
        id: file.id,
        version: file.version,
      })
    ).file!;
    assert.equal(file.folderId, desktop.id);
    assert.equal(file.pinned, true);
    assert.deepEqual((await service.publicGet('one')).files, []);
    file = (
      await service.change('alice', 'one', {
        action: 'pin',
        id: file.id,
        version: file.version,
        pinned: false,
      })
    ).file!;
    assert.equal(file.folderId, null);
    assert.equal(file.pinned, false);
    let page = (await service.get('alice', 'one')).pages![0];
    assert.equal(page.folderId, desktop.id);
    page = (
      await service.change('alice', 'one', {
        action: 'move-page',
        id: page.id,
        version: page.version,
        folderId: null,
      })
    ).page!;
    assert.equal(page.pinned, false);
    assert.equal(
      (await service.get('alice', 'one')).pages![0].folderId,
      null,
      'explicit root override must not become Desktop',
    );
    page = (
      await service.change('alice', 'one', {
        action: 'pin-page',
        id: page.id,
        version: page.version,
        pinned: true,
      })
    ).page!;
    assert.equal(page.folderId, desktop.id);
    assert.equal(page.pinned, true);
  } finally {
    sqlite.close();
  }
});

test('Desktop migration preserves user directories, duplicate shortcut names and private/public snapshots', () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  try {
    for (const name of readdirSync('drizzle')
      .filter((name) => name.endsWith('.sql') && name < '0012')
      .sort())
      sqlite.exec(readFileSync(`drizzle/${name}`, 'utf8'));
    sqlite
      .prepare(
        'INSERT INTO spaces (id,user_id,handle,data,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      )
      .run('old', 'alice', 'old', '{}', 'now', 'now');
    const originalDesktop = crypto.randomUUID();
    const elsewhere = crypto.randomUUID();
    const reservedName = crypto.randomUUID();
    const folder = sqlite.prepare(
      'INSERT INTO space_file_folders (id,space_id,name) VALUES (?,?,?)',
    );
    folder.run(originalDesktop, 'old', 'Desktop');
    folder.run(reservedName, 'old', 'Desktop (2)');
    folder.run(elsewhere, 'old', 'Writing');
    const a = '00000000-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    const c = '00000000-0000-4000-8000-000000000003';
    const d = '00000000-0000-4000-8000-000000000004';
    const e = '00000000-0000-4000-8000-000000000005';
    const put = sqlite.prepare(
      "INSERT INTO space_files (id,space_id,name,content,published_name,published_content,published_at,pinned,folder_id,updated_at) VALUES (?,'old',?,?,?,?,'now',?,?,'now')",
    );
    put.run(a, 'readme.md', 'A', 'readme.md', 'A', 1, elsewhere);
    put.run(b, 'README.md', 'Private body', 'public.md', 'Public body', 1, originalDesktop);
    put.run(
      c,
      `README (${b.replaceAll('-', '')}-1).md`,
      'C',
      `README (${b.replaceAll('-', '')}-1).md`,
      'C',
      1,
      null,
    );
    const longName = `${'a'.repeat(97)}.md`;
    put.run(d, longName, 'D', longName, 'D', 1, elsewhere);
    put.run(e, longName, 'E', longName, 'E', 1, originalDesktop);
    put.run(
      crypto.randomUUID(),
      'stay.txt',
      'Keep here',
      'stay.txt',
      'Keep here',
      0,
      originalDesktop,
    );
    sqlite
      .prepare('INSERT INTO space_page_files (space_id,tab_id,folder_id,pinned) VALUES (?,?,?,?)')
      .run('old', 'home', elsewhere, 1);
    sqlite
      .prepare('INSERT INTO space_page_files (space_id,tab_id,folder_id,pinned) VALUES (?,?,?,?)')
      .run('old', 'elsewhere', elsewhere, 0);
    sqlite.exec(readFileSync('drizzle/0012_desktop_folder.sql', 'utf8'));
    const desktop = sqlite
      .prepare("SELECT * FROM space_file_folders WHERE space_id = 'old' AND system = 'desktop'")
      .get()!;
    assert.ok(folderIdSchema.safeParse(desktop.id).success);
    assert.notEqual(desktop.id, originalDesktop);
    assert.equal(
      sqlite.prepare('SELECT name,system FROM space_file_folders WHERE id = ?').get(originalDesktop)
        ?.name,
      'Desktop (3)',
    );
    assert.equal(
      sqlite.prepare('SELECT folder_id FROM space_files WHERE name = ?').get('stay.txt')?.folder_id,
      originalDesktop,
    );
    const migrated = sqlite.prepare('SELECT * FROM space_files WHERE id = ?').get(b)!;
    assert.equal(migrated.folder_id, desktop.id);
    assert.equal(migrated.name, `README (${b.replaceAll('-', '')}-2).md`);
    assert.equal(migrated.published_name, `public (${b.replaceAll('-', '')}-2).md`);
    assert.equal(migrated.content, 'Private body');
    assert.equal(migrated.published_content, 'Public body');
    assert.equal(migrated.version, 2);
    const renamedLong = sqlite
      .prepare('SELECT name,published_name,content FROM space_files WHERE id = ?')
      .get(e)!;
    assert.equal((renamedLong.name as string).length, 100);
    assert.ok((renamedLong.name as string).endsWith('.md'));
    assert.equal(renamedLong.name, renamedLong.published_name);
    assert.equal(renamedLong.content, 'E');
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS n FROM space_files WHERE folder_id = ?').get(desktop.id)
        ?.n,
      5,
    );
    assert.equal(
      sqlite.prepare("SELECT folder_id FROM space_page_files WHERE tab_id = 'home'").get()
        ?.folder_id,
      desktop.id,
    );
    assert.equal(
      sqlite.prepare("SELECT folder_id FROM space_page_files WHERE tab_id = 'elsewhere'").get()
        ?.folder_id,
      elsewhere,
    );
    assert.equal(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '_desktop_file_moves'")
        .get()?.n,
      0,
    );
    for (const table of ['space_files', 'space_page_files'])
      assert.equal(
        sqlite
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((column) => column.name === 'pinned'),
        false,
      );
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    sqlite.close();
  }
});

test('tab entries use their titles and keep hidden tabs and their folders private', async () => {
  const { service, sqlite } = fixture();
  try {
    const data = {
      name: 'Alice',
      bio: '',
      theme: 'lilac',
      links: [],
      defaultTabId: 'links',
      tabs: [
        { id: 'links', title: 'My links', slug: 'links', sections: [], ungrouped: [] },
        {
          id: 'secret',
          title: 'Secret plans',
          slug: 'plans',
          hidden: true,
          sections: [],
          ungrouped: [],
        },
      ],
    };
    sqlite.prepare('UPDATE spaces SET data = ? WHERE id = ?').run(JSON.stringify(data), 'one');
    const folder = (await service.change('alice', 'one', createFolder('Writing'))).folder!;
    const privateFolder = (await service.change('alice', 'one', createFolder('Private plans')))
      .folder!;
    const foreign = (await service.change('bob', 'three', createFolder('Other account'))).folder!;
    const owned = (await service.get('alice', 'one')).pages!;
    assert.deepEqual(
      owned.map((page) => page.name),
      ['My links', 'Secret plans'],
    );
    assert.ok(owned.every((page) => page.version === 0 && page.pinned));
    assert.deepEqual(
      (await service.publicGet('one')).pages!.map((page) => page.id),
      ['links'],
    );
    const move = { action: 'move-page', id: 'links', version: 0, folderId: folder.id };
    await assert.rejects(service.change('bob', 'one', move), status(404));
    await assert.rejects(service.change('alice', 'two', move), status(404));
    await assert.rejects(
      service.change('alice', 'one', { ...move, folderId: foreign.id }),
      status(404),
    );
    let page = (await service.change('alice', 'one', move)).page!;
    assert.equal(page.folderId, folder.id);
    await assert.rejects(service.change('alice', 'one', move), status(409));
    page = (
      await service.change('alice', 'one', {
        action: 'pin-page',
        id: page.id,
        version: page.version,
        pinned: false,
      })
    ).page!;
    assert.equal(page.pinned, false);
    assert.equal(page.folderId, null);
    page = (
      await service.change('alice', 'one', {
        action: 'move-page',
        id: page.id,
        version: page.version,
        folderId: folder.id,
      })
    ).page!;
    await service.change('alice', 'one', {
      action: 'move-page',
      id: 'secret',
      version: 0,
      folderId: privateFolder.id,
    });
    const publicFiles = await service.publicGet('one');
    assert.equal(JSON.stringify(publicFiles).includes('Private plans'), false);
    assert.equal(JSON.stringify(publicFiles).includes('Secret plans'), false);
    assert.deepEqual(
      publicFiles.folders!.filter((folder) => !folder.system).map((folder) => folder.id),
      [folder.id],
    );
    assert.equal(publicFiles.pages![0].pinned, false);
    assert.deepEqual(publicFiles.files, []);
    assert.equal(
      sqlite.prepare('SELECT data FROM spaces WHERE id = ?').get('one')?.data,
      JSON.stringify(data),
    );
    await assert.rejects(
      service.change('alice', 'one', {
        action: 'delete-folder',
        id: folder.id,
        version: folder.version,
      }),
      status(409),
    );
    // Changing a URL slug does not rename the tab entry.
    data.tabs[0].slug = 'elsewhere';
    sqlite.prepare('UPDATE spaces SET data = ? WHERE id = ?').run(JSON.stringify(data), 'one');
    assert.equal((await service.get('alice', 'one')).pages![0].name, 'My links');
    // Renaming a tab updates its entry automatically; deleting it cannot strand a folder.
    data.tabs[0].title = 'Elsewhere';
    sqlite.prepare('UPDATE spaces SET data = ? WHERE id = ?').run(JSON.stringify(data), 'one');
    assert.equal((await service.get('alice', 'one')).pages![0].name, 'Elsewhere');
    data.tabs.shift();
    data.defaultTabId = 'secret';
    sqlite.prepare('UPDATE spaces SET data = ? WHERE id = ?').run(JSON.stringify(data), 'one');
    assert.deepEqual((await service.publicGet('one')).pages, []);
    await service.change('alice', 'one', {
      action: 'delete-folder',
      id: folder.id,
      version: folder.version,
    });
    await assert.rejects(
      service.change('alice', 'one', {
        action: 'pin-page',
        id: 'links',
        version: page.version,
        pinned: true,
      }),
      status(404),
    );
  } finally {
    sqlite.close();
  }
});

test('moving folders preserves their contents and rejects cycles, deep trees and stale versions', async () => {
  const { service, sqlite } = fixture();
  try {
    let projects = (await service.change('alice', 'one', createFolder('Projects'))).folder!;
    const notes = (await service.change('alice', 'one', createFolder('Notes', projects.id)))
      .folder!;
    const work = (await service.change('alice', 'one', createFolder('Work'))).folder!;
    const foreign = (await service.change('alice', 'two', createFolder('Foreign'))).folder!;
    const file = (await service.change('alice', 'one', { ...create(), folderId: notes.id })).file!;
    const move = {
      action: 'move-folder',
      id: projects.id,
      version: projects.version,
      parentId: work.id,
    };
    assert.equal(
      canMoveFolder((await service.get('alice', 'one')).folders!, projects.id, notes.id),
      false,
    );
    for (const parentId of [projects.id, notes.id])
      await assert.rejects(service.change('alice', 'one', { ...move, parentId }), status(409));
    await assert.rejects(service.change('bob', 'one', move), status(404));
    await assert.rejects(
      service.change('alice', 'one', { ...move, parentId: foreign.id }),
      status(404),
    );
    projects = (await service.change('alice', 'one', move)).folder!;
    assert.equal(projects.parentId, work.id);
    assert.equal((await service.get('alice', 'one', file.id)).file!.folderId, notes.id);
    await assert.rejects(service.change('alice', 'one', move), status(409));
    await assert.rejects(
      service.change('alice', 'one', {
        action: 'move-folder',
        id: work.id,
        version: work.version,
        parentId: notes.id,
      }),
      status(409),
    );
    let parentId: string | null = null;
    for (let i = 0; i < 4; i++)
      parentId = (await service.change('alice', 'one', createFolder(`depth-${i}`, parentId)))
        .folder!.id;
    await assert.rejects(
      service.change('alice', 'one', { ...move, version: projects.version, parentId }),
      status(409),
    );
    assert.equal(
      canMoveFolder((await service.get('alice', 'one')).folders!, projects.id, parentId),
      false,
    );
    projects = (
      await service.change('alice', 'one', { ...move, version: projects.version, parentId: null })
    ).folder!;
    assert.equal(projects.parentId, null);
  } finally {
    sqlite.close();
  }
});

test('folders organize files without exposing private folders or drafts', async () => {
  const { service, sqlite } = fixture();
  try {
    const projects = (await service.change('alice', 'one', createFolder('Projects'))).folder!;
    const notes = (await service.change('alice', 'one', createFolder('Notes', projects.id)))
      .folder!;
    const privateFolder = (await service.change('alice', 'one', createFolder('Private plans')))
      .folder!;
    await service.change('alice', 'one', {
      ...create('secret.txt', 'private'),
      folderId: privateFolder.id,
    });
    let file = (await service.change('alice', 'one', { ...create(), folderId: notes.id })).file!;
    assert.deepEqual(
      (await service.publicGet('one')).folders!.filter((folder) => !folder.system),
      [],
    );
    file = (
      await service.change('alice', 'one', {
        action: 'publish',
        id: file.id,
        version: file.version,
      })
    ).file!;
    const visible = (await service.publicGet('one')).folders!;
    assert.deepEqual(
      new Set(visible.filter((folder) => !folder.system).map((folder) => folder.id)),
      new Set([projects.id, notes.id]),
    );
    assert.deepEqual(
      folderTrail(visible, notes.id).map((folder) => folder.name),
      ['Projects', 'Notes'],
    );
    assert.ok(visible.every((folder) => folder.version === 0));
    assert.equal(JSON.stringify(await service.publicGet('one')).includes('Private plans'), false);
    file = (
      await service.change('alice', 'one', {
        action: 'save',
        id: file.id,
        version: file.version,
        name: file.name,
        content: 'unpublished revision',
      })
    ).file!;
    const oldVersion = file.version;
    file = (
      await service.change('alice', 'one', {
        action: 'move',
        id: file.id,
        version: file.version,
        folderId: projects.id,
      })
    ).file!;
    assert.equal(file.folderId, projects.id);
    assert.equal(file.pinned, false);
    assert.equal(file.hasChanges, true);
    const published = (await service.publicGet('one', file.id)).file!;
    assert.equal(published.content, '# Hello');
    assert.equal(published.folderId, projects.id);
    assert.equal(published.pinned, false);
    assert.deepEqual(
      (await service.publicGet('one'))
        .folders!.filter((folder) => !folder.system)
        .map((folder) => folder.id),
      [projects.id],
    );
    await assert.rejects(
      service.change('alice', 'one', {
        action: 'move',
        id: file.id,
        version: oldVersion,
        folderId: null,
      }),
      status(409),
    );
    file = (
      await service.change('alice', 'one', {
        action: 'move',
        id: file.id,
        version: file.version,
        folderId: null,
      })
    ).file!;
    assert.equal(file.folderId, null);
    assert.deepEqual(
      (await service.publicGet('one')).folders!.filter((folder) => !folder.system),
      [],
    );
    assert.equal((await service.get('alice', 'one')).folders!.length, 4);
  } finally {
    sqlite.close();
  }
});

test('folder ownership, sibling names, moves and empty deletion are enforced', async () => {
  const { service, sqlite } = fixture();
  try {
    let folder = (await service.change('alice', 'one', createFolder('Notes'))).folder!;
    const elsewhere = (await service.change('alice', 'two', createFolder('Notes'))).folder!;
    await assert.rejects(service.change('bob', 'one', createFolder('Stolen')), status(404));
    await assert.rejects(
      service.change('alice', 'one', createFolder('Child', elsewhere.id)),
      status(404),
    );
    await assert.rejects(
      service.change('alice', 'one', { ...create(), folderId: elsewhere.id }),
      status(404),
    );
    await assert.rejects(service.change('alice', 'one', createFolder('NOTES')), status(409));
    const rename = {
      action: 'rename-folder',
      id: folder.id,
      version: folder.version,
      name: 'Writing',
    };
    await assert.rejects(service.change('bob', 'one', rename), status(404));
    await assert.rejects(service.change('alice', 'two', rename), status(404));
    folder = (await service.change('alice', 'one', rename)).folder!;
    await assert.rejects(service.change('alice', 'one', rename), status(409));
    const child = (await service.change('alice', 'one', createFolder('Notes', folder.id))).folder!;
    const remove = { action: 'delete-folder', id: folder.id, version: folder.version };
    await assert.rejects(service.change('alice', 'one', remove), status(409));
    await service.change('alice', 'one', {
      action: 'delete-folder',
      id: child.id,
      version: child.version,
    });
    const rootFile = (await service.change('alice', 'one', create())).file!;
    const nestedFile = (await service.change('alice', 'one', { ...create(), folderId: folder.id }))
      .file!;
    await assert.rejects(service.change('alice', 'one', remove), status(409));
    await assert.rejects(
      service.change('alice', 'one', {
        action: 'move',
        id: rootFile.id,
        version: rootFile.version,
        folderId: folder.id,
      }),
      status(409),
    );
    await assert.rejects(
      service.change('alice', 'one', {
        action: 'move',
        id: rootFile.id,
        version: rootFile.version,
        folderId: elsewhere.id,
      }),
      status(404),
    );
    assert.equal((await service.get('alice', 'one', rootFile.id)).file?.folderId, null);
    await service.change('alice', 'one', {
      action: 'delete',
      id: nestedFile.id,
      version: nestedFile.version,
    });
    await service.change('alice', 'one', remove);
    assert.deepEqual(
      (await service.get('alice', 'one')).folders!.filter((folder) => !folder.system),
      [],
    );
    assert.equal((await service.get('alice', 'one')).files!.length, 1);
    await assert.rejects(
      service.change('alice', 'one', { ...create('other.txt'), folderId: folder.id }),
      status(404),
    );
  } finally {
    sqlite.close();
  }
});

test('folder limits, names and hierarchy are bounded', async () => {
  const { service, sqlite } = fixture();
  try {
    for (const name of ['../secrets', '.hidden', 'a/b', 'a\\b', 'a\0b', '', '   ', 'x'.repeat(101)])
      assert.equal(folderActionSchema.safeParse(createFolder(name)).success, false, name);
    let parent: string | null = null;
    for (let i = 0; i < MAX_FOLDER_DEPTH; i++)
      parent = (await service.change('alice', 'one', createFolder(`level-${i}`, parent))).folder!
        .id;
    await assert.rejects(
      service.change('alice', 'one', createFolder('too deep', parent)),
      status(400),
    );
    for (let i = MAX_FOLDER_DEPTH; i < MAX_SPACE_FOLDERS; i++)
      await service.change('alice', 'one', createFolder(`folder-${i}`));
    await assert.rejects(service.change('alice', 'one', createFolder('over quota')), status(400));
    assert.equal((await service.get('alice', 'one')).folders!.length, MAX_SPACE_FOLDERS + 1);
    // Folder cascades also cooperate with deleting an entire space.
    await service.change('alice', 'one', { ...create(), folderId: parent });
    sqlite.prepare('DELETE FROM space_handles WHERE space_id = ?').run('one');
    sqlite.prepare('DELETE FROM spaces WHERE id = ?').run('one');
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS n FROM space_file_folders WHERE space_id = ?').get('one')
        ?.n,
      0,
    );
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS n FROM space_files WHERE space_id = ?').get('one')?.n,
      0,
    );
  } finally {
    sqlite.close();
  }
});

test('drafts and draft edits never appear in public listings or file responses', async () => {
  const { service, sqlite, db } = fixture();
  try {
    let file = (await service.change('alice', 'one', create())).file!;
    assert.deepEqual((await service.publicGet('one')).files, []);
    await assert.rejects(service.publicGet('one', file.id), status(404));
    file = (
      await service.change('alice', 'one', {
        action: 'pin',
        id: file.id,
        version: file.version,
        pinned: true,
      })
    ).file!;
    assert.equal(file.pinned, true);
    assert.deepEqual((await service.publicGet('one')).files, []);
    file = (
      await service.change('alice', 'one', {
        action: 'publish',
        id: file.id,
        version: file.version,
      })
    ).file!;
    assert.equal(file.published, true);
    assert.equal(file.hasChanges, false);
    file = (
      await service.change('alice', 'one', {
        action: 'save',
        id: file.id,
        version: file.version,
        name: 'README.md',
        content: file.content,
      })
    ).file!;
    assert.equal(file.hasChanges, true, 'case-only renames must be publishable');
    assert.equal((await service.publicGet('one', file.id)).file?.name, 'readme.md');
    file = (
      await service.change('alice', 'one', {
        action: 'save',
        id: file.id,
        version: file.version,
        name: 'private-name.txt',
        content: 'secret draft',
      })
    ).file!;
    assert.equal(file.hasChanges, true);
    const published = (await service.publicGet('one', file.id)).file!;
    assert.equal(published.name, 'readme.md');
    assert.equal(published.content, '# Hello');
    assert.equal(JSON.stringify(await service.publicGet('one')).includes('secret'), false);
    assert.equal(JSON.stringify(await service.publicGet('one')).includes('private-name'), false);
    assert.equal('content' in (await service.get('alice', 'one')).files![0], false);
    assert.equal(
      (await createSpaceFileService(db).get('alice', 'one', file.id)).file?.content,
      'secret draft',
    );
    file = (
      await service.change('alice', 'one', {
        action: 'publish',
        id: file.id,
        version: file.version,
      })
    ).file!;
    file = (
      await service.change('alice', 'one', {
        action: 'pin',
        id: file.id,
        version: file.version,
        pinned: true,
      })
    ).file!;
    assert.equal((await service.publicGet('one', file.id)).file?.content, 'secret draft');
    assert.equal((await service.publicGet('one')).files![0].pinned, true);
    file = (
      await service.change('alice', 'one', {
        action: 'unpublish',
        id: file.id,
        version: file.version,
      })
    ).file!;
    assert.equal(file.pinned, true);
    assert.deepEqual((await service.publicGet('one')).files, []);
    await assert.rejects(service.publicGet('one', file.id), status(404));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM space_revisions').get()?.n, 0);
  } finally {
    sqlite.close();
  }
});

test('ownership and per-file versions prevent cross-space access and lost updates', async () => {
  const { service, sqlite } = fixture();
  try {
    const file = (await service.change('alice', 'one', create())).file!;
    await assert.rejects(service.get('bob', 'one'), status(404));
    await assert.rejects(service.get('alice', 'two', file.id), status(404));
    await assert.rejects(service.publicGet('two', file.id), status(404));
    const save = {
      action: 'save',
      id: file.id,
      version: file.version,
      name: file.name,
      content: 'new',
    };
    await assert.rejects(service.change('bob', 'one', save), status(404));
    await assert.rejects(service.change('alice', 'two', save), status(404));
    const newer = (await service.change('alice', 'one', save)).file!;
    for (const action of ['save', 'publish', 'unpublish', 'pin', 'delete']) {
      await assert.rejects(
        service.change(
          'alice',
          'one',
          action === 'save'
            ? save
            : {
                action,
                id: file.id,
                version: file.version,
                ...(action === 'pin' ? { pinned: true } : {}),
              },
        ),
        status(409),
      );
    }
    assert.equal((await service.get('alice', 'one', file.id)).file?.content, 'new');
    await service.change('alice', 'one', { action: 'delete', id: file.id, version: newer.version });
    await assert.rejects(service.get('alice', 'one', file.id), status(404));
    await assert.rejects(service.publicGet('one', file.id), status(404));
  } finally {
    sqlite.close();
  }
});

test('names, content sizes and quotas are checked on the server', async () => {
  const { service, sqlite } = fixture();
  try {
    for (const name of [
      '../private.md',
      'a/b.txt',
      'a\\b.txt',
      '.hidden.txt',
      'x.html',
      'x.txt\0',
      'x\n.md',
    ])
      assert.equal(fileActionSchema.safeParse(create(name)).success, false, name);
    for (const content of [
      'a'.repeat(MAX_FILE_BYTES + 1),
      '😀'.repeat(MAX_FILE_BYTES / 4 + 1),
      'bad\0file',
    ])
      assert.equal(fileActionSchema.safeParse(create('a.txt', content)).success, false);
    assert.equal(fileActionSchema.safeParse({ ...create(), userId: 'bob' }).success, false);
    assert.equal(
      fileActionSchema.safeParse(create(' Read Me.MD ', 'é'.repeat(MAX_FILE_BYTES / 2))).success,
      true,
    );
    await service.change('alice', 'one', create());
    await assert.rejects(service.change('alice', 'one', create('README.MD')), status(409));
    await service.change('alice', 'two', create());
    for (let i = 1; i < MAX_SPACE_FILES; i++)
      await service.change('alice', 'one', create(`${i}.txt`));
    await assert.rejects(service.change('alice', 'one', create('over.txt')), status(400));
    assert.equal((await service.get('alice', 'one')).files?.length, MAX_SPACE_FILES);
    assert.equal((await service.get('alice', 'two')).files?.length, 1);
  } finally {
    sqlite.close();
  }
});

test('Markdown links allow only explicit web or mail destinations', () => {
  for (const url of ['https://example.com/a', 'http://example.com', 'mailto:hello@example.com'])
    assert.equal(fileLinkUrl(url), url);
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,<script>x</script>',
    '//evil.test',
    '/api/account',
    'file:///etc/passwd',
    'java\nscript:alert(1)',
  ])
    assert.equal(fileLinkUrl(url), '');
});

test('uploads decode UTF-8 text and reject binary, invalid encoding and oversized files', () => {
  const bytes = (value: string) => new TextEncoder().encode(value).buffer;
  assert.equal(
    decodeTextFile('notes.txt', bytes('Olá\n<strong>literal text</strong>')),
    'Olá\n<strong>literal text</strong>',
  );
  assert.equal(decodeTextFile('readme.md', bytes('# Markdown')), '# Markdown');
  assert.throws(() => decodeTextFile('binary.txt', bytes('a\0b')), AppError);
  assert.throws(() => decodeTextFile('bad.txt', new Uint8Array([255, 255]).buffer), AppError);
  assert.throws(() => decodeTextFile('huge.txt', new ArrayBuffer(MAX_FILE_BYTES + 1)), AppError);
  assert.throws(() => decodeTextFile('page.html', bytes('<h1>Hello</h1>')), AppError);
});
