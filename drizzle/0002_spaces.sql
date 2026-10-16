-- Additive migration: retain the original tables during the Worker rollout.
CREATE TABLE spaces (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX spaces_owner ON spaces(user_id, created_at, id);
CREATE TABLE space_handles (
  handle TEXT PRIMARY KEY NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  created_at TEXT NOT NULL
);
CREATE INDEX space_handles_space ON space_handles(space_id);
CREATE TABLE space_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(space_id, version)
);

-- Enforce limits and handle ownership atomically, including concurrent requests.
CREATE TRIGGER spaces_limit BEFORE INSERT ON spaces BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM spaces WHERE user_id = NEW.user_id) >= 5
    THEN RAISE(ABORT, 'space_limit') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM space_handles WHERE handle = NEW.handle)
    THEN RAISE(ABORT, 'handle_taken') END;
END;
CREATE TRIGGER spaces_claim AFTER INSERT ON spaces BEGIN
  INSERT INTO space_handles(handle, space_id, created_at) VALUES(NEW.handle, NEW.id, NEW.created_at);
END;
CREATE TRIGGER spaces_rename_guard BEFORE UPDATE OF handle ON spaces BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM space_handles WHERE handle = NEW.handle AND space_id <> NEW.id)
    THEN RAISE(ABORT, 'handle_taken') END;
END;
CREATE TRIGGER spaces_rename_claim AFTER UPDATE OF handle ON spaces BEGIN
  INSERT INTO space_handles(handle, space_id, created_at) VALUES(NEW.handle, NEW.id, NEW.updated_at)
    ON CONFLICT(handle) DO NOTHING;
END;

INSERT INTO spaces(id, user_id, handle, data, version, created_at, updated_at)
  SELECT 'legacy:' || user_id, user_id, handle, data, version, created_at, updated_at FROM profiles;
INSERT INTO space_revisions(id, space_id, version, data, reason, created_at)
  SELECT id, 'legacy:' || user_id, version, data, reason, created_at FROM revisions;

-- Bridge writes from the previous Worker between migration and deployment.
-- Once a space has newer edits, old code must fail rather than overwrite them.
CREATE TRIGGER legacy_profile_insert AFTER INSERT ON profiles BEGIN
  INSERT INTO spaces(id, user_id, handle, data, version, created_at, updated_at)
    VALUES('legacy:' || NEW.user_id, NEW.user_id, NEW.handle, NEW.data, NEW.version, NEW.created_at, NEW.updated_at);
END;
CREATE TRIGGER legacy_profile_guard BEFORE UPDATE ON profiles BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM spaces WHERE id = 'legacy:' || OLD.user_id AND version = OLD.version AND handle = OLD.handle)
    THEN RAISE(ABORT, 'space_changed') END;
END;
CREATE TRIGGER legacy_profile_update AFTER UPDATE ON profiles BEGIN
  UPDATE spaces SET data = NEW.data, version = NEW.version, updated_at = NEW.updated_at
    WHERE id = 'legacy:' || NEW.user_id;
END;
CREATE TRIGGER legacy_revision_insert AFTER INSERT ON revisions BEGIN
  INSERT INTO space_revisions(id, space_id, version, data, reason, created_at)
    VALUES(NEW.id, 'legacy:' || NEW.user_id, NEW.version, NEW.data, NEW.reason, NEW.created_at);
END;
