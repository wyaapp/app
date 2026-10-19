import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

const migration = readFileSync('drizzle/0007_retire_legacy_profiles.sql', 'utf8');
const content = JSON.stringify({ name: 'Alice', bio: 'Original', theme: 'lime', links: [] });

function fixture(seed = true) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync('drizzle')
    .filter((file) => /^000[0-6].*\.sql$/.test(file))
    .sort()) {
    db.exec(readFileSync(`drizzle/${file}`, 'utf8'));
    if (seed && file.startsWith('0000')) {
      db.prepare('INSERT INTO profiles VALUES (?,?,?,?,?,?)').run(
        'alice',
        'alice',
        content,
        61,
        '2026-01-01',
        '2026-01-02',
      );
      for (let version = 1; version <= 60; version++) {
        db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?)').run(
          `revision-${version}`,
          'alice',
          version,
          content,
          'Updated profile',
          '2026-01-02',
        );
      }
    }
  }
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec('BEGIN');
  try {
    db.exec(migration);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function snapshot(db: DatabaseSync) {
  return {
    spaces: db.prepare('SELECT * FROM spaces ORDER BY id').all(),
    handles: db.prepare('SELECT * FROM space_handles ORDER BY handle').all(),
    revisions: db.prepare('SELECT * FROM space_revisions ORDER BY id').all(),
  };
}

function assertRemoved(db: DatabaseSync) {
  assert.deepEqual(
    db
      .prepare(
        `SELECT name FROM sqlite_schema
    WHERE name IN ('profiles', 'revisions') OR name LIKE 'legacy_profile_%'
      OR name = 'legacy_revision_insert'`,
      )
      .all(),
    [],
  );
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
}

test('cleanup preserves current spaces, pictures, handles and retained history; removes legacy tables', () => {
  const db = fixture();
  try {
    db.prepare('UPDATE spaces SET data=?, version=62, handle=?, picture_key=? WHERE id=?').run(
      content.replace('Original', 'Current'),
      'renamed',
      'pictures/current.webp',
      'legacy:alice',
    );
    db.prepare(
      'INSERT INTO spaces (id,user_id,handle,data,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    ).run('second-space', 'alice', 'work', content, 1, '2026-01-01', '2026-01-02');
    const before = snapshot(db);
    migrate(db);
    assert.deepEqual(snapshot(db), before);
    assertRemoved(db);
    const history = db
      .prepare('SELECT count(*) AS count,min(version) AS oldest FROM space_revisions')
      .get()!;
    assert.equal(history.count, 50);
    assert.equal(history.oldest, 11);
  } finally {
    db.close();
  }
});

test('cleanup recovers a missing legacy space and only its latest 50 revisions', () => {
  const db = fixture();
  try {
    const before = snapshot(db);
    db.exec('DELETE FROM space_revisions; DELETE FROM space_handles; DELETE FROM spaces;');
    migrate(db);
    assert.deepEqual(snapshot(db), before);
    assertRemoved(db);
  } finally {
    db.close();
  }
});

test('cleanup repairs missing retained history without restoring expired revisions', () => {
  const db = fixture();
  try {
    const before = snapshot(db);
    db.exec('DELETE FROM space_revisions WHERE version IN (11,30,60)');
    migrate(db);
    assert.deepEqual(snapshot(db), before);
    assertRemoved(db);
  } finally {
    db.close();
  }
});

test('cleanup supports empty databases and matching copies', () => {
  for (const seeded of [false, true]) {
    const db = fixture(seeded);
    try {
      const before = snapshot(db);
      migrate(db);
      assert.deepEqual(snapshot(db), before);
      assertRemoved(db);
    } finally {
      db.close();
    }
  }
});

test('cleanup aborts atomically on ownership, content, version or history conflicts', () => {
  for (const sql of [
    "UPDATE spaces SET user_id='bob'",
    "UPDATE spaces SET data='{}'",
    'UPDATE spaces SET version=60',
    "UPDATE spaces SET handle='conflict'",
    "UPDATE space_revisions SET data='{}' WHERE version=60",
    "UPDATE space_revisions SET id='different-id' WHERE version=60",
  ]) {
    const db = fixture();
    try {
      db.exec(sql);
      const before = snapshot(db);
      assert.throws(() => migrate(db), /legacy_profile_cleanup_conflict/, sql);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.prepare('SELECT count(*) AS count FROM profiles').get()!.count, 1);
      assert.equal(db.prepare('SELECT count(*) AS count FROM revisions').get()!.count, 60);
      assert.equal(
        db
          .prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name='legacy_profile_insert'")
          .get()!.count,
        1,
      );
      assert.equal(
        db
          .prepare(
            "SELECT count(*) AS count FROM sqlite_schema WHERE name LIKE 'legacy_profile_cleanup_%'",
          )
          .get()!.count,
        0,
      );
    } finally {
      db.close();
    }
  }
});

test('recovery never takes a current username from another space', () => {
  const db = fixture();
  try {
    db.exec('DELETE FROM space_revisions; DELETE FROM space_handles; DELETE FROM spaces;');
    db.prepare(
      'INSERT INTO spaces (id,user_id,handle,data,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    ).run('other-space', 'bob', 'alice', content, 1, '2026-01-01', '2026-01-02');
    const before = snapshot(db);
    assert.throws(() => migrate(db), /handle_taken/);
    assert.deepEqual(snapshot(db), before);
    assert.equal(db.prepare('SELECT count(*) AS count FROM profiles').get()!.count, 1);
  } finally {
    db.close();
  }
});
