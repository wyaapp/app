-- The running Worker must already use spaces (0002 or later). Wrangler applies
-- this file atomically. Never drop the source tables after a failed guard.
CREATE TABLE legacy_profile_cleanup_guard (
  valid INTEGER NOT NULL CONSTRAINT legacy_profile_cleanup_conflict CHECK (valid = 1)
);

-- Recover missing copies without replacing current content or stable IDs.
-- Normal space triggers enforce username ownership and the five-space limit.
INSERT INTO spaces (id, user_id, handle, data, version, created_at, updated_at)
SELECT 'legacy:' || p.user_id, p.user_id, p.handle, p.data, p.version, p.created_at, p.updated_at
FROM profiles p
WHERE NOT EXISTS (SELECT 1 FROM spaces s WHERE s.id = 'legacy:' || p.user_id);

-- A newer space is authoritative. Equal versions must agree; an older space
-- or different owner needs manual reconciliation, not a silent overwrite.
INSERT INTO legacy_profile_cleanup_guard (valid)
SELECT NOT EXISTS (
  SELECT 1 FROM profiles p JOIN spaces s ON s.id = 'legacy:' || p.user_id
  WHERE s.user_id <> p.user_id OR s.version < p.version
    OR (s.version = p.version AND (s.data <> p.data OR s.handle <> p.handle))
);

-- Keep only history within the latest 50 versions across both sources. This
-- repairs missing retained revisions without resurrecting expired history.
CREATE TABLE legacy_profile_cleanup_history AS
WITH versions AS (
  SELECT space_id, version FROM space_revisions
  UNION
  SELECT 'legacy:' || user_id, version FROM revisions
), ranked AS (
  SELECT space_id, version,
    row_number() OVER (PARTITION BY space_id ORDER BY version DESC) AS position
  FROM versions
)
SELECT r.id, 'legacy:' || r.user_id AS space_id, r.version, r.data, r.reason, r.created_at
FROM revisions r JOIN ranked v
  ON v.space_id = 'legacy:' || r.user_id AND v.version = r.version
WHERE v.position <= 50;

INSERT INTO legacy_profile_cleanup_guard (valid)
SELECT NOT EXISTS (
  SELECT 1 FROM legacy_profile_cleanup_history r JOIN space_revisions s
    ON s.id = r.id OR (s.space_id = r.space_id AND s.version = r.version)
  WHERE s.id <> r.id OR s.space_id <> r.space_id OR s.version <> r.version
    OR s.data <> r.data OR s.reason <> r.reason OR s.created_at <> r.created_at
);
INSERT INTO space_revisions (id, space_id, version, data, reason, created_at)
SELECT r.id, r.space_id, r.version, r.data, r.reason, r.created_at
FROM legacy_profile_cleanup_history r
WHERE NOT EXISTS (SELECT 1 FROM space_revisions s WHERE s.id = r.id);

-- Verify every retained source revision is present before removing its source.
INSERT INTO legacy_profile_cleanup_guard (valid)
SELECT NOT EXISTS (
  SELECT 1 FROM legacy_profile_cleanup_history r
  WHERE NOT EXISTS (
    SELECT 1 FROM space_revisions s WHERE s.id = r.id AND s.space_id = r.space_id
      AND s.version = r.version AND s.data = r.data
      AND s.reason = r.reason AND s.created_at = r.created_at
  )
);

DROP TRIGGER legacy_profile_insert;
DROP TRIGGER legacy_profile_guard;
DROP TRIGGER legacy_profile_update;
DROP TRIGGER legacy_revision_insert;
DROP TABLE revisions;
DROP TABLE profiles;
DROP TABLE legacy_profile_cleanup_history;
DROP TABLE legacy_profile_cleanup_guard;
