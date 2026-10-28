import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createSpaceFileService } from '../lib/space-file-service.ts';
import { createSpaceService } from '../lib/space-service.ts';
import { AppError } from '../lib/app-error.ts';
import { serializePageItem, parsePageSource } from '../lib/page-documents.ts';
import type { LinkItem } from '../lib/profile-types.ts';
import { publicFileDiscordGuild } from '../lib/discord-widget.ts';

function fixture() {
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
    files,
    spaces,
    async create(name: string, content = '') {
      return (await files.change('owner', 'space', { action: 'create', name, content })).file!;
    },
  };
}
const card = (slug: string, id = slug, aliases?: string[]): LinkItem => ({
  id,
  slug,
  label: slug,
  url: 'https://example.com/',
  platform: 'website',
  visible: true,
  ...(aliases ? { aliases } : {}),
});
const status = (expected: number) => (error: unknown) =>
  error instanceof AppError && error.status === expected;

test('Main window persists per space, respects ownership and publication, and resets safely', async () => {
  const f = fixture();
  try {
    let file = await f.create('Main.md', '# Hello');
    let profile = (await f.spaces.getAccount('owner', 'space'))!;
    const select = (mainWindowId: string | null) => ({
      action: 'update_profile',
      spaceId: 'space',
      expectedVersion: profile.version,
      mainWindowId,
    });
    await assert.rejects(f.spaces.mutate('owner', select(`file-${file.id}`)), status(400));
    file = (
      await f.files.change('owner', 'space', {
        action: 'publish',
        id: file.id,
        version: file.version,
      })
    ).file!;
    profile = (await f.spaces.getAccount('owner', 'space'))!;
    await assert.rejects(f.spaces.mutate('another-owner', select(`file-${file.id}`)), status(404));
    await assert.rejects(
      f.spaces.mutate('owner', select(`file-${crypto.randomUUID()}`)),
      status(400),
    );
    profile = await f.spaces.mutate('owner', select(`file-${file.id}`));
    assert.equal(profile.mainWindowId, `file-${file.id}`);
    assert.equal((await f.spaces.getPublicProfile('alex'))!.mainWindowId, `file-${file.id}`);
    const unchanged = await f.spaces.mutate('owner', select(`file-${file.id}`));
    assert.equal(unchanged.version, profile.version);
    profile = await f.spaces.mutate('owner', {
      action: 'update_profile',
      spaceId: 'space',
      expectedVersion: profile.version,
      bio: 'New Bio',
    });
    assert.equal(profile.mainWindowId, `file-${file.id}`);
    await f.files.change('owner', 'space', {
      action: 'unpublish',
      id: file.id,
      version: file.version,
    });
    profile = (await f.spaces.getAccount('owner', 'space'))!;
    assert.equal(profile.mainWindowId, undefined);
    assert.equal((await f.spaces.getPublicProfile('alex'))!.mainWindowId, undefined);
    profile = await f.spaces.mutate('owner', select('about'));
    assert.equal((await f.spaces.getAccount('owner', 'space'))!.mainWindowId, 'about');
    profile = await f.spaces.mutate('owner', select(null));
    assert.equal(profile.mainWindowId, undefined);
  } finally {
    f.sqlite.close();
  }
});

test('unchanged file saves preserve versions, timestamps, publication, and space data', async () => {
  const f = fixture();
  try {
    let file = await f.create('Profile.md', '# Profile');
    file = (
      await f.files.change('owner', 'space', {
        action: 'save',
        id: file.id,
        version: file.version,
        name: file.name,
        content: file.content,
        appearance: { theme: 'dim', accent: '#abc' },
      })
    ).file!;
    file = (
      await f.files.change('owner', 'space', {
        action: 'publish',
        id: file.id,
        version: file.version,
      })
    ).file!;
    const space = f.sqlite.prepare('SELECT * FROM spaces WHERE id=?').get('space');
    const row = f.sqlite.prepare('SELECT * FROM space_files WHERE id=?').get(file.id);
    const history = await f.spaces.getHistory('owner', 'space');
    // Fail if an otherwise identical save touches file or profile rows at all.
    f.sqlite.exec(`
      CREATE TRIGGER no_file_insert BEFORE INSERT ON space_files
        BEGIN SELECT RAISE(ABORT, 'Unexpected file insert'); END;
      CREATE TRIGGER no_file_update BEFORE UPDATE ON space_files
        BEGIN SELECT RAISE(ABORT, 'Unexpected file update'); END;
      CREATE TRIGGER no_file_delete BEFORE DELETE ON space_files
        BEGIN SELECT RAISE(ABORT, 'Unexpected file delete'); END;
      CREATE TRIGGER no_space_update BEFORE UPDATE ON spaces
        BEGIN SELECT RAISE(ABORT, 'Unexpected space update'); END;
    `);
    for (const appearance of [undefined, { theme: 'dim', accent: '#AABBCC' }]) {
      const result = await f.files.change('owner', 'space', {
        action: 'save',
        id: file.id,
        version: file.version,
        name: ` ${file.name} `,
        content: file.content,
        ...(appearance ? { appearance } : {}),
      });
      assert.deepEqual(result.file, file);
      assert.equal(result.defaultFileId, file.id);
    }
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM spaces WHERE id=?').get('space'), space);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM space_files WHERE id=?').get(file.id), row);
    assert.deepEqual(await f.spaces.getHistory('owner', 'space'), history);
  } finally {
    f.sqlite.close();
  }
});

test('unchanged saves still enforce ownership and version conflicts, while appearance edits save', async () => {
  const f = fixture();
  try {
    const file = await f.create('Draft.md', '# Draft');
    const action = {
      action: 'save',
      id: file.id,
      version: file.version,
      name: file.name,
      content: file.content,
    };
    await assert.rejects(f.files.change('another-owner', 'space', action), status(404));
    const changed = (
      await f.files.change('owner', 'space', { ...action, appearance: { theme: 'black' } })
    ).file!;
    assert.equal(changed.version, file.version + 1);
    assert.deepEqual(changed.appearance, { theme: 'black' });
    await assert.rejects(
      f.files.change('owner', 'space', { ...action, appearance: changed.appearance }),
      status(409),
    );
    assert.deepEqual((await f.files.get('owner', 'space', file.id)).file, changed);
  } finally {
    f.sqlite.close();
  }
});

test('Properties reorders by display rank, returns safe peer version updates, and preserves published snapshots', async () => {
  const f = fixture();
  try {
    const first = await f.create('A.md', '# A');
    const second = await f.create('B.md', '# B');
    const third = await f.create('C.md', '# C');
    const published = (
      await f.files.change('owner', 'space', {
        action: 'publish',
        id: first.id,
        version: first.version,
      })
    ).file!;
    const oldPublic = (await f.files.publicGet('alex', first.id)).file!;
    f.sqlite.prepare('UPDATE space_files SET position=1000').run();
    const result = await f.files.change('owner', 'space', {
      action: 'properties',
      id: third.id,
      version: third.version,
      name: third.name,
      position: 0,
      isDefault: true,
    });
    const listing = await f.files.get('owner', 'space');
    assert.equal(listing.files![0].id, third.id);
    assert.deepEqual(
      listing.files!.map((file) => file.position),
      [0, 1, 2],
    );
    assert.equal(result.defaultFileId, third.id);
    assert.equal(result.reorderedFiles?.length, 2);
    assert.equal(
      result.reorderedFiles?.find((file) => file.id === first.id)?.previousVersion,
      published.version,
    );
    assert.equal(
      result.reorderedFiles?.find((file) => file.id === second.id)?.previousVersion,
      second.version,
    );
    const newPublic = (await f.files.publicGet('alex', first.id)).file!;
    assert.deepEqual({ ...newPublic, position: oldPublic.position }, oldPublic);
    await assert.rejects(
      f.files.change('owner', 'space', {
        action: 'save',
        id: second.id,
        version: second.version,
        name: second.name,
        content: 'stale',
      }),
      status(409),
    );
    assert.equal((await f.spaces.getHistory('owner', 'space')).length, 2);
    const cleared = await f.files.change('owner', 'space', {
      action: 'properties',
      id: third.id,
      version: result.file!.version,
      name: third.name,
      position: 2,
      isDefault: false,
    });
    const reordered = await f.files.get('owner', 'space');
    assert.equal(cleared.defaultFileId, reordered.files![0].id);
    assert.equal(reordered.defaultFileId, cleared.defaultFileId);
    assert.notEqual(cleared.defaultFileId, third.id);
  } finally {
    f.sqlite.close();
  }
});

test('Publishing a copied card assigns a fresh identity while the original remains unchanged', async () => {
  const f = fixture();
  try {
    const original = await f.create(
      'Original.md',
      serializePageItem(card('original', 'shared-card')),
    );
    await f.files.change('owner', 'space', {
      action: 'publish',
      id: original.id,
      version: original.version,
    });
    const before = (await f.files.get('owner', 'space', original.id)).file!;
    const copy = await f.create('Copy.md', serializePageItem(card('copied', 'shared-card')));
    const published = (
      await f.files.change('owner', 'space', {
        action: 'publish',
        id: copy.id,
        version: copy.version,
      })
    ).file!;
    const copiedId = parsePageSource(published.content).items[0].item.id;
    assert.notEqual(copiedId, 'shared-card');
    assert.match(copiedId!, /^[a-f0-9-]{36}$/);
    assert.deepEqual((await f.files.get('owner', 'space', original.id)).file, before);
    const profile = (await f.spaces.getPublicProfile('alex', false))!;
    assert.equal(profile.links.find((item) => item.slug === 'original')?.id, 'shared-card');
    assert.equal(profile.links.find((item) => item.slug === 'copied')?.id, copiedId);
  } finally {
    f.sqlite.close();
  }
});

test('Duplicate shortlink aliases and redirect cycles fail atomically before publication', async () => {
  const f = fixture();
  try {
    const original = await f.create(
      'Original.md',
      serializePageItem(card('original', 'original-id', ['previous'])),
    );
    await f.files.change('owner', 'space', {
      action: 'publish',
      id: original.id,
      version: original.version,
    });
    const duplicate = await f.create(
      'Duplicate.md',
      serializePageItem(card('another', 'another-id', ['previous'])),
    );
    await assert.rejects(
      f.files.change('owner', 'space', {
        action: 'publish',
        id: duplicate.id,
        version: duplicate.version,
      }),
      status(409),
    );
    assert.deepEqual((await f.files.get('owner', 'space', duplicate.id)).file, duplicate);
    const cycle = await f.create(
      'Cycle.md',
      serializePageItem({ ...card('cycle'), url: 'https://wya.im/alex/cycle' }),
    );
    await assert.rejects(
      f.files.change('owner', 'space', { action: 'publish', id: cycle.id, version: cycle.version }),
      status(400),
    );
    assert.equal((await f.files.get('owner', 'space', cycle.id)).file!.published, false);
    assert.equal((await f.spaces.getHistory('owner', 'space')).length, 1);
  } finally {
    f.sqlite.close();
  }
});

test('widgets share private drafts, published snapshots, version checks, and lossless format conversion', async () => {
  const f = fixture();
  try {
    let file = await f.create('Code.widget');
    await assert.rejects(
      f.files.change('owner', 'space', { action: 'publish', id: file.id, version: file.version }),
      /exactly one block/,
    );
    const content = '```js\nconsole.log("original");\n```\n';
    file = (
      await f.files.change('owner', 'space', {
        action: 'save',
        id: file.id,
        version: file.version,
        name: file.name,
        content,
      })
    ).file!;
    file = (
      await f.files.change('owner', 'space', {
        action: 'publish',
        id: file.id,
        version: file.version,
      })
    ).file!;
    const published = (await f.files.publicGet('alex', file.id)).file!;
    assert.equal(published.name, 'Code.widget');
    assert.equal(published.content, content);
    const originalId = file.id;
    file = (
      await f.files.change('owner', 'space', {
        action: 'save',
        id: file.id,
        version: file.version,
        name: 'Code.md',
        content,
      })
    ).file!;
    assert.equal(file.id, originalId);
    assert.equal(file.content, content);
    assert.equal(file.hasChanges, true);
    assert.deepEqual((await f.files.publicGet('alex', file.id)).file, published);
    file = (
      await f.files.change('owner', 'space', {
        action: 'properties',
        id: file.id,
        version: file.version,
        name: 'Code.widget',
        position: 0,
      })
    ).file!;
    assert.equal(file.id, originalId);
    assert.equal(file.content, content);
    assert.equal(file.hasChanges, false);
    await assert.rejects(
      f.files.change('owner', 'space', {
        action: 'save',
        id: file.id,
        version: file.version - 1,
        name: file.name,
        content,
      }),
      status(409),
    );
    file = (
      await f.files.change('owner', 'space', {
        action: 'unpublish',
        id: file.id,
        version: file.version,
      })
    ).file!;
    await assert.rejects(f.files.publicGet('alex', file.id), status(404));
    assert.equal(file.content, content);
    assert.equal((await f.spaces.getHistory('owner', 'space')).length, 3);
  } finally {
    f.sqlite.close();
  }
});

test('widget writes and conversions reject unsupported or multiple blocks atomically', async () => {
  const f = fixture();
  try {
    const markdown = await f.create('Article.md', '# A heading\n\nA paragraph');
    const widget = await f.create('Code.widget', '```js\ncode\n```');
    await assert.rejects(f.create('Invalid.widget', '# A heading'), /Widgets support/);
    for (const action of [
      {
        action: 'save',
        id: widget.id,
        version: widget.version,
        name: widget.name,
        content: '```js\ncode\n```\n\nExtra paragraph',
      },
      {
        action: 'save',
        id: markdown.id,
        version: markdown.version,
        name: 'Article.widget',
        content: markdown.content,
      },
      {
        action: 'properties',
        id: markdown.id,
        version: markdown.version,
        name: 'Article.widget',
        position: 0,
      },
    ])
      await assert.rejects(f.files.change('owner', 'space', action), /exactly one block/);
    assert.deepEqual((await f.files.get('owner', 'space', markdown.id)).file, markdown);
    assert.deepEqual((await f.files.get('owner', 'space', widget.id)).file, widget);
    assert.equal((await f.files.get('owner', 'space')).files?.length, 2);
  } finally {
    f.sqlite.close();
  }
});

test('published Discord widgets keep the normal public lookup, privacy boundary, and short-link index', async () => {
  const f = fixture();
  try {
    const item: LinkItem = {
      kind: 'discord',
      slug: 'community',
      label: 'Community',
      platform: 'discord',
      url: '',
      visible: true,
      discord: { guildId: '771498135188799500' },
    };
    let file = await f.create('Community.widget', serializePageItem(item));
    await assert.rejects(f.files.publicGet('alex', file.id), status(404));
    file = (
      await f.files.change('owner', 'space', {
        action: 'publish',
        id: file.id,
        version: file.version,
      })
    ).file!;
    const published = (await f.files.publicGet('alex', file.id)).file!;
    assert.equal(publicFileDiscordGuild(published, 'community'), item.discord!.guildId);
    const profile = (await f.spaces.getPublicProfile('alex', false))!;
    assert.equal(profile.links[0].fileId, file.id);
    assert.equal(profile.links[0].slug, 'community');
    const hidden = serializePageItem({ ...item, visible: false });
    file = (
      await f.files.change('owner', 'space', {
        action: 'save',
        id: file.id,
        version: file.version,
        name: file.name,
        content: hidden,
      })
    ).file!;
    await assert.rejects(
      f.files.change('owner', 'space', { action: 'publish', id: file.id, version: file.version }),
      /visible/,
    );
    assert.deepEqual((await f.files.publicGet('alex', file.id)).file, published);
    await assert.rejects(f.files.get('other-user', 'space', file.id), status(404));
  } finally {
    f.sqlite.close();
  }
});

test('unrelated profile and legacy Markdown actions retain widget snapshots, index ownership, and default file', async () => {
  const f = fixture();
  try {
    const markdown = await f.create('Links.md', serializePageItem(card('website')));
    await f.files.change('owner', 'space', {
      action: 'publish',
      id: markdown.id,
      version: markdown.version,
    });
    const item: LinkItem = {
      kind: 'discord',
      slug: 'community',
      label: 'Community',
      platform: 'discord',
      url: '',
      visible: true,
      discord: { guildId: '771498135188799500' },
    };
    let widget = await f.create('Community.widget', serializePageItem(item));
    widget = (
      await f.files.change('owner', 'space', {
        action: 'publish',
        id: widget.id,
        version: widget.version,
      })
    ).file!;
    widget = (
      await f.files.change('owner', 'space', {
        action: 'properties',
        id: widget.id,
        version: widget.version,
        name: widget.name,
        position: 0,
        isDefault: true,
      })
    ).file!;
    const published = (await f.files.publicGet('alex', widget.id)).file!;
    let profile = (await f.spaces.getAccount('owner', 'space'))!;
    profile = await f.spaces.mutate('owner', {
      action: 'update_profile',
      spaceId: 'space',
      expectedVersion: profile.version,
      bio: 'Updated Bio',
    });
    assert.equal(profile.defaultFileId, widget.id);
    assert.deepEqual((await f.files.get('owner', 'space', widget.id)).file, widget);
    profile = await f.spaces.mutate('owner', {
      action: 'upsert_link',
      spaceId: 'space',
      expectedVersion: profile.version,
      tabId: markdown.id,
      slug: 'website',
      originalSlug: 'website',
      label: 'Updated website',
      destination: 'https://example.com/updated',
      platform: 'website',
      visible: true,
    });
    assert.equal(profile.defaultFileId, widget.id);
    assert.deepEqual((await f.files.get('owner', 'space', widget.id)).file, widget);
    assert.deepEqual((await f.files.publicGet('alex', widget.id)).file, published);
    const visible = (await f.spaces.getPublicProfile('alex', false))!;
    assert.equal(visible.links.find((value) => value.slug === 'community')?.fileId, widget.id);
    assert.equal(visible.links.find((value) => value.slug === 'website')?.label, 'Updated website');
    assert.equal(
      publicFileDiscordGuild((await f.files.publicGet('alex', widget.id)).file!, 'community'),
      item.discord!.guildId,
    );
    await assert.rejects(
      f.spaces.mutate('owner', {
        action: 'upsert_link',
        spaceId: 'space',
        expectedVersion: profile.version,
        tabId: markdown.id,
        slug: 'community',
        label: 'Conflicting legacy link',
        destination: 'https://example.com/conflict',
        platform: 'website',
      }),
      status(409),
    );
    assert.equal(
      (await f.spaces.getPublicProfile('alex', false))!.links.find(
        (value) => value.slug === 'community',
      )?.fileId,
      widget.id,
    );
  } finally {
    f.sqlite.close();
  }
});
