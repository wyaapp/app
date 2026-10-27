import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createSpaceService } from '../lib/space-service.ts';
import { AppError, findVisibleLink, type ProfileData } from '../lib/model.ts';
import { resolveLinkDestination } from '../lib/link-redirects.ts';
import { parseFileDocument } from '../lib/file-documents.ts';
import { createSpaceFileService } from '../lib/space-file-service.ts';
import type { Profile } from '../lib/profile-types.ts';
import type { HostingMode } from '../lib/plans.ts';

const data: ProfileData = {
  name: 'Original',
  bio: 'Existing profile',
  theme: 'lime',
  links: [
    {
      slug: 'code',
      label: 'Code',
      url: 'https://example.com/',
      platform: 'github',
      icon: 'rocket',
      visible: true,
    },
  ],
};
function fixture(
  legacy = false,
  reclaimable = true,
  keepLegacyBridge = false,
  hostingMode: HostingMode = 'self-hosted',
  clock: () => number = Date.now,
) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(readFileSync('drizzle/0000_dapper_morlocks.sql', 'utf8'));
  if (legacy) {
    sqlite
      .prepare('INSERT INTO profiles VALUES (?,?,?,?,?,?)')
      .run('alice', 'original', JSON.stringify(data), 2, '2026-01-01', '2026-01-02');
    sqlite
      .prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?)')
      .run(
        'rev1',
        'alice',
        1,
        JSON.stringify({ ...data, bio: 'Before' }),
        'Updated profile',
        '2026-01-02',
      );
  }
  sqlite.exec(readFileSync('drizzle/0002_spaces.sql', 'utf8'));
  sqlite.exec(readFileSync('drizzle/0004_profile_pictures.sql', 'utf8'));
  sqlite.exec(readFileSync('drizzle/0005_security_limits.sql', 'utf8'));
  if (reclaimable) sqlite.exec(readFileSync('drizzle/0003_reclaimable_handles.sql', 'utf8'));
  if (!keepLegacyBridge)
    sqlite.exec(readFileSync('drizzle/0007_retire_legacy_profiles.sql', 'utf8'));
  if (reclaimable) sqlite.exec(readFileSync('drizzle/0015_hosted_plans.sql', 'utf8'));
  for (const migration of [
    '0009_space_files',
    '0010_space_file_folders',
    '0011_space_page_files',
    '0012_desktop_folder',
    '0013_file_appearance',
    '0017_markdown_files',
    '0018_space_trash',
  ])
    sqlite.exec(readFileSync(`drizzle/${migration}.sql`, 'utf8'));
  const queries: string[] = [];
  function prepare(sql: string) {
    queries.push(sql);
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
        return { success: true, meta: { changes: Number(result.changes) }, results: [] };
      },
    };
    return statement;
  }
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((s) => s.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  const service = createSpaceService(db, clock, hostingMode);
  async function contentSpace(userId: string, handle: string) {
    const profile = await service.mutate(userId, create(handle));
    const files = createSpaceFileService(db);
    const file = (
      await files.change(userId, profile.id, { action: 'create', name: 'Socials.md', content: '' })
    ).file!;
    await files.change(userId, profile.id, {
      action: 'publish',
      id: file.id,
      version: file.version,
    });
    return (await service.getAccount(userId, profile.id))!;
  }
  return { sqlite, db, service, contentSpace, queries };
}
function pageFile(profile: Profile, id = 'home') {
  return (
    profile.files!.find((file) => file.legacyTabId === id || file.id === id) ?? profile.files![0]
  );
}
function pageLayout(profile: Profile, id = 'home') {
  return parseFileDocument(pageFile(profile, id).content).data.tabs![0];
}
const create = (handle: string) => ({ action: 'create_profile', handle, name: handle });
const status = (expected: number) => (error: unknown) =>
  error instanceof AppError && error.status === expected;

test('page document publishing is owner-scoped, versioned, atomic and restores with revisions', async () => {
  const { service, sqlite } = fixture(true);
  try {
    const original = (await service.getAccount('alice'))!;
    const action = {
      action: 'publish_document',
      spaceId: original.id,
      expectedVersion: original.version,
      tabId: 'home',
      source: '# My links\n\n' + pageFile(original).content,
      appearance: { theme: 'dim', bodyFont: 'serif' },
    };
    await assert.rejects(service.mutate('bob', action), status(404));
    let saved = await service.mutate('alice', action);
    assert.equal(saved.version, original.version + 1);
    assert.ok(pageFile(saved).content.startsWith('# My links'));
    assert.equal(saved.links[0].id, 'legacy:code');
    assert.deepEqual(pageFile(saved).appearance, action.appearance);
    assert.deepEqual(
      pageFile((await service.getPublicProfile(saved.handle))!).appearance,
      action.appearance,
    );
    await assert.rejects(service.mutate('alice', action), status(409));
    const source = pageFile(saved).content.replace(
      'https://example.com/',
      'https://wya.im/original/code',
    );
    await assert.rejects(
      service.mutate('alice', { ...action, expectedVersion: saved.version, source }),
      status(400),
    );
    assert.equal((await service.getAccount('alice'))!.version, saved.version);
    saved = await service.mutate('alice', {
      action: 'restore_revision',
      spaceId: saved.id,
      expectedVersion: saved.version,
      revision: original.version,
    });
    assert.equal(saved.documents, undefined);
    assert.deepEqual(saved.links, original.links);
    assert.deepEqual(pageFile(saved).appearance, {});
  } finally {
    sqlite.close();
  }
});

test('redirect profile lookup reads the saved projection without loading or parsing files', async () => {
  const { service, sqlite, queries } = fixture(true);
  try {
    const original = (await service.getAccount('alice'))!;
    sqlite
      .prepare('UPDATE space_files SET content=?, published_content=? WHERE id=?')
      .run(
        '::link[Malformed]{slug="broken"}',
        '::link[Malformed]{slug="broken"}',
        pageFile(original).id,
      );
    queries.length = 0;
    const lookup = (await service.getPublicProfile('original', false))!;
    assert.equal(lookup.documents, undefined);
    assert.equal(lookup.files, undefined);
    assert.equal(
      queries.some((query) => /space_files/.test(query)),
      false,
    );
    assert.equal(
      await resolveLinkDestination(lookup, 'code', async () => null),
      'https://example.com/',
    );
  } finally {
    sqlite.close();
  }
});

test('email aliases and project cards use ownership, versioning, history and loop prevention', async () => {
  const { service, contentSpace } = fixture();
  let current = await contentSpace('alice', 'alice');
  const email = {
    action: 'upsert_link',
    spaceId: current.id,
    expectedVersion: current.version,
    slug: 'email',
    aliases: ['contact'],
    label: 'Email',
    platform: 'email',
    destination: 'hello@example.com',
    emailSubject: 'Hello',
  };
  await assert.rejects(service.mutate('bob', email), status(404));
  current = await service.mutate('alice', email);
  const emailVersion = current.version;
  const emailId = current.links[0].id;
  const project = {
    action: 'upsert_project',
    spaceId: current.id,
    expectedVersion: current.version,
    slug: 'project',
    aliases: ['app'],
    label: 'My work',
    description: 'Project description',
    buttons: [{ label: 'Demo', destination: 'https://example.com/' }],
    visible: true,
  };
  await assert.rejects(service.mutate('bob', project), status(404));
  await assert.rejects(
    service.mutate('alice', {
      ...project,
      buttons: [{ label: 'Loop', destination: 'https://wya.im/alice/app' }],
    }),
    status(400),
  );
  current = await service.mutate('alice', project);
  await assert.rejects(service.mutate('alice', project), status(409));
  current = await service.mutate('alice', {
    action: 'set_layout',
    spaceId: current.id,
    expectedVersion: current.version,
    ungrouped: ['email'],
    sections: [{ id: 'work', title: 'Projects', slugs: ['project'] }],
  });
  assert.equal(current.links[1].sectionId, 'work');
  current = await service.mutate('alice', {
    ...email,
    expectedVersion: current.version,
    originalSlug: 'email',
    slug: 'mail',
    aliases: undefined,
  });
  assert.equal(current.links[0].id, emailId);
  assert.deepEqual(current.links[0].aliases, ['contact']);
  const restored = await service.mutate('alice', {
    action: 'restore_revision',
    spaceId: current.id,
    expectedVersion: current.version,
    revision: emailVersion,
  });
  assert.equal(restored.links.length, 1);
  assert.equal(restored.links[0].slug, 'email');
  assert.deepEqual(restored.links[0].aliases, ['contact']);
});

test('layouts enforce ownership and versions and survive profile edits, renames and history restoration', async () => {
  const { service } = fixture(true);
  const original = (await service.getAccount('alice'))!;
  const action = {
    action: 'set_layout',
    spaceId: original.id,
    expectedVersion: 2,
    ungroupedPosition: 1,
    ungrouped: [],
    sections: [{ id: 'socials', title: 'Socials', slugs: ['code'] }],
  };
  await assert.rejects(service.mutate('bob', action), status(404));
  let saved = await service.mutate('alice', action);
  assert.equal(saved.links[0].sectionId, 'socials');
  assert.equal((await service.getHistory('alice'))[0].reason, 'Updated profile tabs and layout');
  await assert.rejects(service.mutate('alice', action), status(409));
  saved = await service.mutate('alice', {
    action: 'update_profile',
    expectedVersion: saved.version,
    bio: 'With sections',
  });
  assert.equal(pageLayout(saved).sections[0].title, 'Socials');
  assert.deepEqual(pageLayout(saved).ungrouped, []);
  saved = await service.mutate('alice', {
    action: 'rename_space',
    expectedVersion: saved.version,
    handle: 'renamed',
  });
  assert.equal(pageLayout(saved).sections[0].title, 'Socials');
  assert.deepEqual(pageLayout(saved).ungrouped, []);
  saved = await service.mutate('alice', {
    action: 'restore_revision',
    expectedVersion: saved.version,
    revision: 2,
  });
  assert.equal(saved.sections, undefined);
  assert.equal(saved.ungroupedPosition, undefined);
  assert.deepEqual(saved.links, original.links);
});

test('slug renames retire the old path, record history, and enforce ownership, versions and loop checks', async () => {
  const { service } = fixture(true);
  const edit = {
    action: 'upsert_link',
    expectedVersion: 2,
    originalSlug: 'code',
    slug: 'work',
    label: 'My work',
    destination: 'https://example.com/',
    platform: 'website',
  };
  const original = (await service.getAccount('alice'))!;
  await assert.rejects(service.mutate('bob', { ...edit, spaceId: original.id }), status(404));
  await assert.rejects(
    service.mutate('alice', { ...edit, destination: 'https://wya.im/original/work' }),
    status(400),
  );
  assert.equal((await service.getAccount('alice'))!.version, 2);
  const renamed = await service.mutate('alice', edit);
  assert.equal(renamed.version, 3);
  assert.equal(renamed.links[0].icon, 'rocket');
  assert.deepEqual(
    (await service.getPublicProfile('original'))!.links.map((link) => link.slug),
    ['work'],
  );
  assert.equal((await service.getHistory('alice'))[0].reason, 'Changed /code to /work');
  await assert.rejects(service.mutate('alice', edit), status(409));
  const restored = await service.mutate('alice', {
    action: 'restore_revision',
    expectedVersion: 3,
    revision: 2,
  });
  assert.deepEqual(restored.links, original.links);
});

test('saving own-site links allows promotion but rejects cycles without changing content or history', async () => {
  const { service, contentSpace } = fixture();
  let a = await contentSpace('alice', 'alice');
  let b = await contentSpace('bob', 'bob');
  const link = (version: number, slug: string, destination: string, visible = true) => ({
    action: 'upsert_link',
    expectedVersion: version,
    slug,
    label: slug,
    destination,
    platform: 'website',
    visible,
  });
  a = await service.mutate('alice', link(a.version, 'wya', 'https://wya.im/'));
  a = await service.mutate('alice', link(a.version, 'go', 'https://wya.im/bob/go'));
  b = await service.mutate('bob', link(b.version, 'go', 'https://example.com/'));
  const history = await service.getHistory('bob');
  await assert.rejects(
    service.mutate('bob', link(b.version, 'go', 'https://wya.im/alice/go')),
    status(400),
  );
  assert.equal((await service.getAccount('bob'))!.version, b.version);
  assert.deepEqual(await service.getHistory('bob'), history);
  a = await service.mutate('alice', {
    action: 'rename_space',
    expectedVersion: a.version,
    handle: 'renamed',
  });
  await assert.rejects(
    service.mutate('alice', link(a.version, 'self', 'https://wya.im/alice/self')),
    status(400),
  );
  a = await service.mutate(
    'alice',
    link(a.version, 'hidden', 'https://wya.im/renamed/hidden', false),
  );
  await assert.rejects(
    service.mutate('alice', link(a.version, 'hidden', 'https://wya.im/renamed/hidden', true)),
    status(400),
  );
});

test('migration preserves profiles, icons and history while rejecting old Worker content after cutover', async () => {
  const { sqlite, service } = fixture(true, true, true);
  let profile = (await service.getAccount('alice'))!;
  assert.equal(profile.id, 'legacy:alice');
  assert.equal(profile.version, 2);
  assert.deepEqual(profile.links, [
    { ...data.links[0], id: 'legacy:code', fileId: pageFile(profile).id },
  ]);
  assert.equal((await service.getHistory('alice'))[0].reason, 'Updated profile');
  sqlite.exec('BEGIN');
  sqlite
    .prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?)')
    .run('rev2', 'alice', 2, JSON.stringify(data), 'Old Worker edit', '2026-01-03');
  assert.throws(
    () =>
      sqlite
        .prepare('UPDATE profiles SET data=?, version=3 WHERE user_id=?')
        .run(JSON.stringify({ ...data, bio: 'During deployment' }), 'alice'),
    /legacy_content_model/,
  );
  sqlite.exec('ROLLBACK');
  profile = (await service.getAccount('alice'))!;
  assert.equal(profile.bio, 'Existing profile');
  assert.equal(profile.version, 2);
  assert.equal((await service.getHistory('alice')).length, 1);
  sqlite
    .prepare('INSERT INTO profiles VALUES (?,?,?,?,?,?)')
    .run('bob', 'old-worker-signup', JSON.stringify(data), 1, '2026-01-03', '2026-01-03');
  assert.equal((await service.getAccount('bob'))!.handle, 'old-worker-signup');
  await service.mutate('alice', {
    action: 'update_profile',
    expectedVersion: 2,
    bio: 'New Worker edit',
  });
  assert.throws(
    () => sqlite.prepare('UPDATE profiles SET version=4 WHERE user_id=?').run('alice'),
    /space_changed/,
  );
  assert.equal((await service.getAccount('alice'))!.bio, 'New Worker edit');
});

test('hosted Free allows two spaces under competing creates; aliases do not consume slots', async () => {
  const { service } = fixture(false, true, false, 'hosted');
  const first = await service.mutate('alice', create('one'));
  await service.mutate('alice', {
    action: 'rename_space',
    expectedVersion: 1,
    handle: 'one-renamed',
  });
  const results = await Promise.allSettled(
    ['two', 'three'].map((handle) => service.mutate('alice', create(handle))),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && status(409)(r.reason)).length, 1);
  assert.equal((await service.listSpaces('alice')).length, 2);
  assert.equal((await service.getAccount('alice', first.id))!.aliases[0], 'one');
  await service.mutate('bob', create('bob'));
  assert.equal((await service.listSpaces('bob')).length, 1);
});

test('hosted Premium allows ten spaces atomically and never grants another account access', async () => {
  const now = Date.now();
  const { sqlite, service } = fixture(false, true, false, 'hosted', () => now);
  sqlite.prepare('INSERT INTO account_plans VALUES (?, ?, ?)').run('alice', now + 1000, now);
  for (let i = 0; i < 9; i++) await service.mutate('alice', create(`premium-${i}`));
  const results = await Promise.allSettled(
    ['premium-nine', 'premium-ten', 'premium-eleven'].map((handle) =>
      service.mutate('alice', create(handle)),
    ),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(
    results.filter((result) => result.status === 'rejected' && status(409)(result.reason)).length,
    2,
  );
  assert.equal((await service.listSpaces('alice')).length, 10);
  await service.mutate('bob', create('bob-one'));
  await service.mutate('bob', create('bob-two'));
  await assert.rejects(service.mutate('bob', create('bob-three')), status(409));
});

test('Premium expiry preserves existing spaces and edits but blocks additional creates', async () => {
  let now = Date.now();
  const { sqlite, service } = fixture(false, true, false, 'hosted', () => now);
  sqlite.prepare('INSERT INTO account_plans VALUES (?, ?, ?)').run('alice', now + 1000, now);
  const first = await service.mutate('alice', create('kept-one'));
  await service.mutate('alice', create('kept-two'));
  await service.mutate('alice', create('kept-three'));
  // The same long-lived service must recheck expiry at INSERT, even if a client
  // loaded its Premium allowance just before the paid period ended.
  now += 1000;
  await assert.rejects(service.mutate('alice', create('expired-four')), status(409));
  assert.equal((await service.listSpaces('alice')).length, 3);
  const edited = await service.mutate('alice', {
    action: 'update_profile',
    spaceId: first.id,
    expectedVersion: 1,
    bio: 'Still editable',
  });
  assert.equal(edited.bio, 'Still editable');
  assert.equal((await service.getHistory('alice', first.id)).length, 1);
  sqlite
    .prepare('UPDATE account_plans SET premium_until = ? WHERE user_id = ?')
    .run(now + 1000, 'alice');
  await service.mutate('alice', create('renewed-four'));
});

test('self-hosted spaces have no paid space cap and client plan fields cannot grant hosted access', async () => {
  const { service } = fixture();
  for (let i = 0; i < 12; i++) await service.mutate('alice', create(`self-${i}`));
  assert.equal((await service.listSpaces('alice')).length, 12);
  const hosted = fixture(false, true, false, 'hosted').service;
  await assert.rejects(
    hosted.mutate('alice', { ...create('forged'), plan: 'premium', spaceLimit: null }),
    status(400),
  );
  assert.equal((await hosted.listSpaces('alice')).length, 0);
});

test('plan migration preserves accounts already over the Free allowance', async () => {
  const { sqlite, db, service } = fixture(false, false);
  const originals = [];
  for (let i = 0; i < 5; i++) originals.push(await service.mutate('alice', create(`legacy-${i}`)));
  sqlite.exec(readFileSync('drizzle/0003_reclaimable_handles.sql', 'utf8'));
  sqlite.exec(readFileSync('drizzle/0015_hosted_plans.sql', 'utf8'));
  const hosted = createSpaceService(db, Date.now, 'hosted');
  for (const original of originals)
    assert.deepEqual(await hosted.getAccount('alice', original.id), {
      ...original,
      pictureUrl: null,
    });
  await assert.rejects(hosted.mutate('alice', create('legacy-six')), status(409));
  // The old five-space database trigger must also be gone for self-hosting.
  await service.mutate('alice', create('self-six'));
  await assert.rejects(service.mutate('bob', create('legacy-0')), status(409));
});

test('accounts and spaces isolate reads, edits and history; ambiguous requests fail closed', async () => {
  const { service } = fixture();
  const a = await service.mutate('alice', create('personal'));
  const b = await service.mutate('alice', create('work'));
  await assert.rejects(service.getAccount('alice'), status(409));
  await assert.rejects(
    service.mutate('alice', { action: 'update_profile', expectedVersion: 1, bio: 'Ambiguous' }),
    status(409),
  );
  await assert.rejects(service.getAccount('bob', a.id), status(404));
  await assert.rejects(service.getHistory('bob', a.id), status(404));
  await assert.rejects(service.checkHandle('bob', 'available', a.id), status(404));
  await assert.rejects(
    service.mutate('bob', {
      action: 'update_profile',
      spaceId: a.id,
      expectedVersion: 1,
      bio: 'Attack',
    }),
    status(404),
  );
  await service.mutate('alice', {
    action: 'update_profile',
    spaceId: a.id,
    expectedVersion: 1,
    bio: 'Personal bio',
  });
  assert.equal((await service.getAccount('alice', b.id))!.bio, '');
  assert.equal((await service.getHistory('alice', b.id)).length, 0);
  await assert.rejects(
    service.mutate('alice', {
      action: 'restore_revision',
      spaceId: b.id,
      expectedVersion: 1,
      revision: 1,
    }),
    status(404),
  );
});

test('only the immediately previous username redirects, and rename-back and restore keep that rule', async () => {
  const { service } = fixture(true);
  let p = await service.mutate('alice', {
    action: 'rename_space',
    expectedVersion: 2,
    handle: ' @Alex.New ',
  });
  assert.equal(p.handle, 'alex.new');
  assert.deepEqual(p.aliases, ['original']);
  for (const handle of ['original', 'alex.new'])
    assert.equal((await service.getPublicProfile(handle))!.id, p.id);
  assert.equal((await service.checkHandle('bob', 'original')).available, true);
  assert.equal((await service.checkHandle('bob', 'alex.new')).available, false);
  p = await service.mutate('alice', {
    action: 'rename_space',
    expectedVersion: p.version,
    handle: 'original',
  });
  assert.deepEqual(p.aliases, ['alex.new']);
  p = await service.mutate('alice', {
    action: 'rename_space',
    expectedVersion: p.version,
    handle: 'third',
  });
  assert.deepEqual(p.aliases, ['original']);
  assert.equal(await service.getPublicProfile('alex.new'), null);
  assert.equal((await service.getPublicProfile('original'))!.handle, 'third');
  p = await service.mutate('alice', {
    action: 'restore_revision',
    expectedVersion: p.version,
    revision: 1,
  });
  assert.equal(p.bio, 'Before');
  assert.equal(p.handle, 'third');
  assert.deepEqual(p.aliases, ['original']);
  assert.equal(p.links[0].icon, 'rocket');
});

test('another account can claim a fallback without inheriting private data or old links', async () => {
  const { service } = fixture(true);
  let alice = await service.mutate('alice', {
    action: 'rename_space',
    expectedVersion: 2,
    handle: 'alice-new',
  });
  const bob = await service.mutate('bob', create('original'));
  assert.equal((await service.getPublicProfile('original'))!.id, bob.id);
  assert.deepEqual((await service.getPublicProfile('original'))!.links, []);
  assert.equal((await service.getAccount('alice'))!.id, alice.id);
  assert.deepEqual((await service.getAccount('alice'))!.aliases, []);
  assert.equal((await service.getHistory('bob')).length, 0);
  await assert.rejects(service.getHistory('bob', alice.id), status(404));
  await assert.rejects(
    service.mutate('alice', {
      action: 'rename_space',
      expectedVersion: alice.version,
      handle: 'original',
    }),
    status(409),
  );
  // Editing or restoring the old owner's content must not resurrect a claimed alias.
  alice = await service.mutate('alice', {
    action: 'update_profile',
    expectedVersion: alice.version,
    bio: 'Changed',
  });
  alice = await service.mutate('alice', {
    action: 'restore_revision',
    expectedVersion: alice.version,
    revision: 1,
  });
  assert.deepEqual(alice.aliases, []);
  alice = await service.mutate('alice', {
    action: 'rename_space',
    expectedVersion: alice.version,
    handle: 'alice-newest',
  });
  assert.deepEqual(alice.aliases, ['alice-new']);
  assert.equal((await service.getPublicProfile('original'))!.id, bob.id);
  // If the new owner releases it, its fallback belongs to that new owner.
  await service.mutate('bob', {
    action: 'rename_space',
    expectedVersion: bob.version,
    handle: 'bob-new',
  });
  assert.equal((await service.getPublicProfile('original'))!.handle, 'bob-new');
  await service.mutate('bob', {
    action: 'rename_space',
    expectedVersion: bob.version + 1,
    handle: 'bob-newest',
  });
  assert.equal(await service.getPublicProfile('original'), null);
});

test('another space on the same account can take the previous username by renaming', async () => {
  const { service } = fixture();
  const first = await service.mutate('alice', create('first'));
  await service.mutate('alice', {
    action: 'rename_space',
    expectedVersion: 1,
    handle: 'first-new',
  });
  const second = await service.mutate('alice', create('second'));
  assert.equal((await service.checkHandle('alice', 'first', second.id)).available, true);
  const renamed = await service.mutate('alice', {
    action: 'rename_space',
    spaceId: second.id,
    expectedVersion: 1,
    handle: 'first',
  });
  assert.deepEqual(renamed.aliases, ['second']);
  assert.equal((await service.getPublicProfile('first'))!.id, second.id);
  assert.deepEqual((await service.getAccount('alice', first.id))!.aliases, []);
  assert.equal((await service.listSpaces('alice')).length, 2);
});

test('migration retains the latest released username, even after rename-back, without changing content or history', async () => {
  const { sqlite, service } = fixture(false, false);
  let p = await service.mutate('alice', create('first'));
  for (const handle of ['second', 'first', 'third'])
    p = await service.mutate('alice', {
      action: 'rename_space',
      expectedVersion: p.version,
      handle,
    });
  assert.deepEqual(new Set(p.aliases), new Set(['first', 'second']));
  const history = await service.getHistory('alice');
  sqlite.exec(readFileSync('drizzle/0003_reclaimable_handles.sql', 'utf8'));
  const migrated = (await service.getAccount('alice'))!;
  assert.deepEqual(migrated, { ...p, aliases: ['first'] });
  assert.deepEqual(await service.getHistory('alice'), history);
  assert.equal(await service.getPublicProfile('second'), null);
  assert.equal((await service.getPublicProfile('first'))!.handle, 'third');
  const claimed = await service.mutate('bob', create('first'));
  assert.equal((await service.getPublicProfile('first'))!.id, claimed.id);
});

test('competing claims of a fallback have one winner and failed claims leave no partial mappings', async () => {
  const { service } = fixture(false, true, false, 'hosted');
  const owner = await service.mutate('owner', create('released'));
  await service.mutate('owner', {
    action: 'rename_space',
    expectedVersion: 1,
    handle: 'owner-new',
  });
  const contender = await service.mutate('alice', create('alice'));
  const results = await Promise.allSettled([
    service.mutate('alice', { action: 'rename_space', expectedVersion: 1, handle: 'released' }),
    service.mutate('bob', create('released')),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && status(409)(r.reason)).length, 1);
  const winner = (await service.getPublicProfile('released'))!;
  assert.notEqual(winner.id, owner.id);
  assert.deepEqual((await service.getAccount('owner'))!.aliases, []);
  const alice = (await service.getAccount('alice'))!;
  if (winner.id === contender.id) {
    assert.deepEqual(alice.aliases, ['alice']);
    assert.equal(await service.getAccount('bob'), null);
  } else {
    assert.equal(alice.handle, 'alice');
    assert.deepEqual(alice.aliases, []);
    assert.equal((await service.getHistory('alice')).length, 0);
  }
  // Hitting the space limit must not transfer a fallback before rejecting.
  await service.mutate('owner', {
    action: 'rename_space',
    expectedVersion: 2,
    handle: 'owner-last',
  });
  for (let n = 0; n < 2; n++) await service.mutate('full', create(`full-${n}`));
  await assert.rejects(service.mutate('full', create('owner-new')), status(409));
  assert.equal((await service.getPublicProfile('owner-new'))!.id, owner.id);
});

test('concurrent renames and competing claims are atomic with no stray aliases or history', async () => {
  const { service } = fixture();
  const a = await service.mutate('alice', create('start'));
  const changes = await Promise.allSettled(
    ['first', 'second'].map((handle) =>
      service.mutate('alice', {
        action: 'rename_space',
        spaceId: a.id,
        expectedVersion: 1,
        handle,
      }),
    ),
  );
  assert.equal(changes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(changes.filter((r) => r.status === 'rejected' && status(409)(r.reason)).length, 1);
  const current = (await service.getAccount('alice', a.id))!;
  const loser = current.handle === 'first' ? 'second' : 'first';
  assert.equal(await service.getPublicProfile(loser), null);
  assert.equal((await service.getHistory('alice', a.id)).length, 1);
  const b = await service.mutate('bob', create('bob'));
  const claims = await Promise.allSettled(
    [
      [a.id, 'alice', current.version],
      [b.id, 'bob', 1],
    ].map(([spaceId, userId, expectedVersion]) =>
      service.mutate(String(userId), {
        action: 'rename_space',
        spaceId,
        expectedVersion,
        handle: 'shared',
      }),
    ),
  );
  assert.equal(claims.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(claims.filter((r) => r.status === 'rejected' && status(409)(r.reason)).length, 1);
  assert.equal(
    (await service.getHistory('alice', a.id)).length +
      (await service.getHistory('bob', b.id)).length,
    2,
  );
});

test('sections can precede ungrouped widgets in durable and public profiles, with reversible ordering', async () => {
  const { service } = fixture(true);
  let current = (await service.getAccount('alice'))!;
  current = await service.mutate('alice', {
    action: 'upsert_link',
    spaceId: current.id,
    expectedVersion: current.version,
    slug: 'contact',
    label: 'Contact',
    destination: 'https://example.com/contact',
    platform: 'website',
  });
  const order = {
    ungrouped: ['contact'],
    sections: [{ id: 'work', title: 'Work', slugs: ['code'] }],
  };
  current = await service.mutate('alice', {
    action: 'set_layout',
    spaceId: current.id,
    expectedVersion: current.version,
    ...order,
    ungroupedPosition: 1,
  });
  assert.equal(pageLayout((await service.getAccount('alice', current.id))!).ungroupedPosition, 1);
  const published = (await service.getPublicProfile(current.handle))!;
  assert.equal(pageLayout(published).ungroupedPosition, 1);
  assert.deepEqual(
    published.links.map((link) => link.slug),
    ['code', 'contact'],
  );
  const savedVersion = current.version;
  current = await service.mutate('alice', {
    action: 'set_layout',
    spaceId: current.id,
    expectedVersion: current.version,
    ...order,
    ungroupedPosition: 0,
  });
  assert.equal(pageLayout(current).ungroupedPosition, undefined);
  assert.deepEqual(
    current.links.map((link) => link.slug),
    ['contact', 'code'],
  );
  current = await service.mutate('alice', {
    action: 'restore_revision',
    spaceId: current.id,
    expectedVersion: current.version,
    revision: savedVersion,
  });
  assert.equal(pageLayout(current).ungroupedPosition, 1);
  assert.deepEqual(
    current.links.map((link) => link.slug),
    ['code', 'contact'],
  );
});

test('legacy page actions persist Markdown files, hide private cards publicly and restore history', async () => {
  const { service } = fixture(true);
  let current = (await service.getAccount('alice'))!;
  const originalVersion = current.version;
  const action = {
    action: 'set_tabs',
    spaceId: current.id,
    expectedVersion: current.version,
    defaultTabId: 'games',
    tabs: [
      { id: 'home', slug: 'home', title: 'Home', ungrouped: ['code'], sections: [] },
      { id: 'games', slug: 'games', title: 'Games', ungrouped: [], sections: [] },
    ],
  };
  await assert.rejects(service.mutate('bob', action), status(404));
  current = await service.mutate('alice', action);
  await assert.rejects(service.mutate('alice', action), status(409));
  current = await service.mutate('alice', {
    action: 'upsert_link',
    spaceId: current.id,
    expectedVersion: current.version,
    slug: 'private-game',
    label: 'Secret',
    platform: 'website',
    destination: 'https://example.com/',
    visible: false,
    tabId: 'games',
  });
  assert.deepEqual(pageLayout(current, 'games').ungrouped, ['private-game']);
  current = await service.mutate('alice', {
    action: 'update_profile',
    spaceId: current.id,
    expectedVersion: current.version,
    bio: 'Tabs stay',
  });
  current = await service.mutate('alice', {
    action: 'rename_space',
    spaceId: current.id,
    expectedVersion: current.version,
    handle: 'tabbed',
  });
  assert.equal(current.files!.length, 2);
  assert.equal(current.defaultFileId, pageFile(current, 'games').id);
  const publicProfile = (await service.getPublicProfile('tabbed'))!;
  assert.equal(JSON.stringify(publicProfile).includes('private-game'), false);
  const restored = await service.mutate('alice', {
    action: 'restore_revision',
    spaceId: current.id,
    expectedVersion: current.version,
    revision: originalVersion,
  });
  assert.equal(restored.tabs, undefined);
  assert.equal(restored.defaultTabId, undefined);
  assert.equal(restored.files?.length, 1);
  assert.equal(restored.links.length, 1);
});

test('hidden tabs exclude all contents and aliases from public access without deleting owner data', async () => {
  const { service } = fixture(true);
  let current = (await service.getAccount('alice'))!;
  current = await service.mutate('alice', {
    action: 'upsert_collection',
    expectedVersion: current.version,
    spaceId: current.id,
    slug: 'favorites',
    label: 'Secret games',
    visible: true,
    entries: [
      {
        game: { title: 'Secret game', source: { provider: 'igdb', id: 1, slug: 'game' } },
        buttons: [{ label: 'Play', destination: 'https://example.com/play' }],
      },
    ],
  });
  current = await service.mutate('alice', {
    action: 'upsert_link',
    spaceId: current.id,
    expectedVersion: current.version,
    slug: 'code',
    aliases: ['secret-alias'],
    label: 'Code',
    platform: 'website',
    destination: 'https://example.com/',
    visible: true,
  });
  const childSlug = current.links.find((item) => item.slug === 'favorites')!.collection!.items[0]
    .slug;
  const tabs = [
    { id: 'home', title: 'Home', slug: 'home', ungrouped: [], sections: [] },
    {
      id: 'secret',
      title: 'Private tab',
      slug: 'secret',
      hidden: true,
      ungrouped: ['favorites', 'code'],
      sections: [],
    },
  ];
  const saveTabs = (updated: typeof tabs) =>
    service.mutate('alice', {
      action: 'set_tabs',
      expectedVersion: current.version,
      spaceId: current.id,
      defaultTabId: 'secret',
      tabs: updated,
    });
  current = await saveTabs(tabs);
  const publicProfile = (await service.getPublicProfile(current.handle))!;
  assert.deepEqual(
    publicProfile.files!.map((file) => file.legacyTabId),
    ['home'],
  );
  assert.equal(publicProfile.defaultFileId, pageFile(publicProfile).id);
  assert.equal(JSON.stringify(publicProfile).includes('Secret game'), false);
  for (const slug of ['favorites', 'code', 'secret-alias', childSlug]) {
    assert.equal(findVisibleLink(publicProfile, slug), undefined);
    await assert.rejects(
      resolveLinkDestination(publicProfile, slug, service.getPublicProfile),
      status(404),
    );
  }
  assert.equal(
    parseFileDocument(pageFile((await service.getAccount('alice'))!, 'secret').content).data.links
      .length,
    2,
  );
  current = await saveTabs(tabs.map((tab) => ({ ...tab, hidden: true })));
  const empty = (await service.getPublicProfile(current.handle))!;
  assert.deepEqual(empty.files, []);
  assert.deepEqual(empty.links, []);
  current = await saveTabs(tabs.map((tab) => ({ ...tab, hidden: false })));
  const restored = (await service.getPublicProfile(current.handle))!;
  assert.equal(restored.defaultFileId, pageFile(restored, 'secret').id);
  assert.ok(findVisibleLink(restored, childSlug));
  assert.ok(findVisibleLink(restored, 'secret-alias'));
});

test('game interests use account isolation, optimistic versions, public visibility and revision restoration', async () => {
  const { service, contentSpace } = fixture();
  let current = await contentSpace('alice', 'alice');
  const game = {
    action: 'upsert_interest',
    spaceId: current.id,
    expectedVersion: current.version,
    interestType: 'game',
    slug: 'game',
    label: 'Hollow Knight',
    favorite: true,
  };
  await assert.rejects(service.mutate('bob', game), status(404));
  current = await service.mutate('alice', game);
  assert.equal((await service.getPublicProfile('alice'))!.links.length, 0);
  await assert.rejects(service.mutate('alice', game), status(409));
  current = await service.mutate('alice', {
    ...game,
    expectedVersion: current.version,
    visible: true,
  });
  assert.equal((await service.getPublicProfile('alice'))!.links[0].interest?.favorite, true);
  await assert.rejects(
    service.mutate('alice', {
      ...game,
      expectedVersion: current.version,
      destination: 'https://wya.im/alice/game',
    }),
    status(400),
  );
  const version = current.version;
  current = await service.mutate('alice', {
    action: 'delete_link',
    spaceId: current.id,
    expectedVersion: current.version,
    slug: 'game',
  });
  current = await service.mutate('alice', {
    action: 'restore_revision',
    spaceId: current.id,
    expectedVersion: current.version,
    revision: version,
  });
  assert.equal(current.links[0].interest?.type, 'game');
  assert.equal(current.links[0].visible, true);
});

test('game button destinations receive loop checks and survive history restoration', async () => {
  const { service, contentSpace } = fixture();
  let current = await contentSpace('alice', 'alice');
  const game = {
    action: 'upsert_interest',
    spaceId: current.id,
    interestType: 'game',
    slug: 'game',
    label: 'Game',
    visible: true,
  };
  await assert.rejects(
    service.mutate('alice', {
      ...game,
      expectedVersion: current.version,
      buttons: [{ label: 'Loop', destination: 'https://wya.im/alice/game' }],
    }),
    status(400),
  );
  current = await service.mutate('alice', {
    ...game,
    expectedVersion: current.version,
    buttons: [{ label: 'Store', destination: 'https://store.example/game' }],
  });
  const version = current.version;
  current = await service.mutate('alice', {
    ...game,
    expectedVersion: current.version,
    buttons: [],
  });
  assert.equal(current.links[0].url, '');
  current = await service.mutate('alice', {
    action: 'restore_revision',
    spaceId: current.id,
    expectedVersion: current.version,
    revision: version,
  });
  assert.equal(current.links[0].url, 'https://store.example/game');
  assert.deepEqual((await service.getPublicProfile('alice'))!.links[0].interest?.buttons, [
    { label: 'Store', url: 'https://store.example/game' },
  ]);
});

test('Games widgets enforce ownership, conflict checks, public filtering, history and nested loops', async () => {
  const { service, contentSpace } = fixture();
  let current = await contentSpace('alice', 'collection-test');
  const input = {
    action: 'upsert_collection',
    spaceId: current.id,
    expectedVersion: current.version,
    slug: 'games',
    label: 'My games',
    visible: true,
    entries: [{ game: { title: 'Game', source: { provider: 'igdb', id: 1, slug: 'game' } } }],
  };
  await assert.rejects(service.mutate('bob', input), status(404));
  current = await service.mutate('alice', input);
  const collectionVersion = current.version;
  const child = current.links[0].collection!.items[0];
  await assert.rejects(service.mutate('alice', input), status(409));
  await assert.rejects(
    service.mutate('alice', {
      ...input,
      expectedVersion: current.version,
      entries: [
        {
          id: child.id,
          buttons: [
            { label: 'Loop', destination: `https://wya.im/${current.handle}/${child.slug}` },
          ],
        },
      ],
    }),
    /loop/,
  );
  current = await service.mutate('alice', {
    ...input,
    expectedVersion: current.version,
    entries: [{ id: child.id, visible: false }],
  });
  assert.deepEqual((await service.getPublicProfile(current.handle))!.links, []);
  current = await service.mutate('alice', {
    action: 'restore_revision',
    spaceId: current.id,
    expectedVersion: current.version,
    revision: collectionVersion,
  });
  assert.equal(current.links[0].collection!.items[0].visible, true);
  assert.equal(current.links[0].collection!.items[0].id, child.id);
  current = await service.mutate('alice', {
    ...input,
    expectedVersion: current.version,
    visible: false,
    entries: [{ id: child.id }],
  });
  assert.deepEqual((await service.getPublicProfile(current.handle))!.links, []);
});

test('tab imports enforce ownership, stale versions and loops, and create one restorable revision', async () => {
  const { exportTab } = await import('../lib/tab-transfer.ts');
  const { service } = fixture();
  let profile = await service.mutate('alice', create('alice'));
  const file = exportTab(data, 'home');
  const input = {
    action: 'import_tab',
    spaceId: profile.id,
    expectedVersion: profile.version,
    file,
  };
  await assert.rejects(service.mutate('bob', input), status(404));
  const bad = structuredClone(file);
  bad.items[0].url = 'https://wya.im/alice/code';
  await assert.rejects(service.mutate('alice', { ...input, file: bad }), status(400));
  assert.equal((await service.getAccount('alice', profile.id))!.version, 1);
  profile = await service.mutate('alice', input);
  assert.equal(profile.version, 2);
  assert.equal(profile.links.length, 1);
  assert.equal(profile.files!.length, 2);
  assert.equal((await service.getHistory('alice', profile.id)).length, 1);
  await assert.rejects(service.mutate('alice', input), status(409));
  profile = await service.mutate('alice', {
    action: 'restore_revision',
    spaceId: profile.id,
    expectedVersion: 2,
    revision: 1,
  });
  assert.equal(profile.links.length, 0);
  assert.equal(profile.tabs, undefined);
  assert.deepEqual(profile.files, []);
});

test('reserved usernames are rejected by backend creation, renaming and availability checks', async () => {
  const { service } = fixture();
  const original = await service.mutate('alice', create('alice'));

  for (const handle of ['privacy', ' @Privacy ', 'terms', 'TERMS', 'dashboard']) {
    await assert.rejects(service.mutate('bob', create(handle)), status(400));
    await assert.rejects(
      service.mutate('alice', {
        action: 'rename_space',
        spaceId: original.id,
        expectedVersion: 1,
        handle,
      }),
      status(400),
    );
    await assert.rejects(service.checkHandle('alice', handle, original.id), status(400));
  }

  assert.deepEqual(await service.listSpaces('bob'), []);
  assert.deepEqual(
    await service.getAccount('alice', original.id),
    await service.getPublicProfile('alice'),
  );
  assert.equal((await service.getAccount('alice', original.id))!.version, 1);
  assert.deepEqual(await service.getHistory('alice', original.id), []);
});

test('unchanged edits keep the version and history but still enforce ownership and expected version', async () => {
  const { service } = fixture();
  const created = await service.mutate('alice', create('alice'));
  const original = (await service.getAccount('alice', created.id))!;
  const rename = {
    action: 'rename_space',
    spaceId: original.id,
    expectedVersion: 1,
    handle: ' @ALICE ',
  };
  const update = {
    action: 'update_profile',
    spaceId: original.id,
    expectedVersion: 1,
    bio: original.bio,
  };

  assert.deepEqual(await service.mutate('alice', rename), original);
  assert.deepEqual(await service.mutate('alice', update), original);
  assert.deepEqual(await service.getHistory('alice', original.id), []);
  await assert.rejects(service.mutate('bob', update), status(404));
  await assert.rejects(service.mutate('alice', { ...rename, expectedVersion: 2 }), status(409));
});

test('a failed username claim rolls back its revision and keeps both spaces intact', async () => {
  const { service } = fixture();
  const alice = await service.mutate('alice', create('alice'));
  const bob = await service.mutate('bob', create('bob'));
  const before = await service.getAccount('alice', alice.id);

  await assert.rejects(
    service.mutate('alice', {
      action: 'rename_space',
      spaceId: alice.id,
      expectedVersion: alice.version,
      handle: 'bob',
    }),
    status(409),
  );

  assert.deepEqual(await service.getAccount('alice', alice.id), before);
  assert.deepEqual(await service.getHistory('alice', alice.id), []);
  assert.equal((await service.getPublicProfile('alice'))!.id, alice.id);
  assert.equal((await service.getPublicProfile('bob'))!.id, bob.id);
});

test('page style and typography persist through edits, public reads, renames and revision restore', async () => {
  const { service } = fixture();
  let profile = await service.mutate('alice', create('desktop-test'));
  assert.equal(profile.pageStyle, undefined);
  assert.equal(profile.font, undefined);
  profile = await service.mutate('alice', {
    action: 'update_profile',
    expectedVersion: profile.version,
    pageStyle: 'desktop',
    font: 'serif',
  });
  const desktopVersion = profile.version;
  profile = await service.mutate('alice', {
    action: 'update_profile',
    expectedVersion: profile.version,
    bio: 'Still a desktop',
  });
  assert.equal(profile.pageStyle, 'desktop');
  assert.equal(profile.font, 'serif');
  profile = await service.mutate('alice', {
    action: 'rename_space',
    expectedVersion: profile.version,
    handle: 'desktop-renamed',
  });
  assert.equal((await service.getPublicProfile('desktop-renamed'))?.pageStyle, 'desktop');
  assert.equal((await service.getPublicProfile('desktop-renamed'))?.font, 'serif');
  profile = await service.mutate('alice', {
    action: 'update_profile',
    expectedVersion: profile.version,
    pageStyle: 'classic',
    font: 'mono',
  });
  assert.equal(profile.pageStyle, 'classic');
  assert.equal(profile.font, 'mono');
  profile = await service.mutate('alice', {
    action: 'restore_revision',
    expectedVersion: profile.version,
    revision: desktopVersion,
  });
  assert.equal(profile.pageStyle, 'desktop');
  assert.equal(profile.font, 'serif');
  await assert.rejects(
    service.mutate('alice', {
      action: 'update_profile',
      expectedVersion: profile.version,
      pageStyle: 'unknown',
    }),
    status(400),
  );
  await assert.rejects(
    service.mutate('alice', {
      action: 'update_profile',
      expectedVersion: profile.version,
      font: 'url(https://example.com/font)',
    }),
    status(400),
  );
  await assert.rejects(
    service.mutate('bob', {
      action: 'update_profile',
      spaceId: profile.id,
      expectedVersion: profile.version,
      font: 'system',
    }),
    status(404),
  );
  profile = await service.mutate('alice', {
    action: 'update_profile',
    expectedVersion: profile.version,
    font: 'original',
  });
  assert.equal((await service.getPublicProfile('desktop-renamed'))?.font, 'original');
});
