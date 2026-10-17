-- Current usernames are exclusive; the immediately previous username is only
-- a fallback redirect. Claiming that username transfers its mapping atomically.
DROP TRIGGER spaces_limit;
DROP TRIGGER spaces_claim;
DROP TRIGGER spaces_rename_guard;
DROP TRIGGER spaces_rename_claim;

-- Use the latest rename revision, not handle creation time: renaming back may
-- have made an older handle the most recently released address.
DELETE FROM space_handles
WHERE handle <> (SELECT handle FROM spaces WHERE id = space_handles.space_id)
  AND handle IS NOT (
    SELECT substr(reason, length('Changed username from @') + 1,
      instr(reason, ' to @') - length('Changed username from @') - 1)
    FROM space_revisions
    WHERE space_id = space_handles.space_id
      AND reason LIKE 'Changed username from @% to @%'
    ORDER BY version DESC LIMIT 1
  );

CREATE TRIGGER spaces_limit BEFORE INSERT ON spaces BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM spaces WHERE user_id = NEW.user_id) >= 5
    THEN RAISE(ABORT, 'space_limit') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM spaces WHERE handle = NEW.handle)
    THEN RAISE(ABORT, 'handle_taken') END;
END;
CREATE TRIGGER spaces_claim AFTER INSERT ON spaces BEGIN
  INSERT INTO space_handles(handle, space_id, created_at) VALUES(NEW.handle, NEW.id, NEW.created_at)
    ON CONFLICT(handle) DO UPDATE SET space_id = excluded.space_id, created_at = excluded.created_at;
END;
CREATE TRIGGER spaces_rename_guard BEFORE UPDATE OF handle ON spaces BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM spaces WHERE handle = NEW.handle AND id <> NEW.id)
    THEN RAISE(ABORT, 'handle_taken') END;
END;
CREATE TRIGGER spaces_rename_claim AFTER UPDATE OF handle ON spaces
WHEN NEW.handle <> OLD.handle BEGIN
  -- Keep only the address being released by this rename. Do not remove any
  -- address another space has already claimed.
  DELETE FROM space_handles WHERE space_id = NEW.id AND handle <> OLD.handle;
  INSERT INTO space_handles(handle, space_id, created_at) VALUES(NEW.handle, NEW.id, NEW.updated_at)
    ON CONFLICT(handle) DO UPDATE SET space_id = excluded.space_id, created_at = excluded.created_at;
END;
