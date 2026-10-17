CREATE TABLE security_limits (key TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX security_limits_expiry ON security_limits(expires_at);
CREATE TABLE auth_mail_locks (recipient TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX auth_mail_locks_expiry ON auth_mail_locks(expires_at);

-- History has a defined retention budget, not merely a 50-row display limit.
DELETE FROM space_revisions WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY space_id ORDER BY version DESC) AS position
    FROM space_revisions
  ) WHERE position > 50
);
CREATE TRIGGER space_revision_retention AFTER INSERT ON space_revisions BEGIN
  DELETE FROM space_revisions WHERE space_id = NEW.space_id AND id NOT IN (
    SELECT id FROM space_revisions WHERE space_id = NEW.space_id ORDER BY version DESC LIMIT 50
  );
END;
