-- Files become the single content store. The runtime migrates legacy Markdown
-- using the same parser as publication, atomically and once per space.
CREATE TABLE space_files_next (
  id TEXT PRIMARY KEY NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  folder_id TEXT REFERENCES space_file_folders(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '' CHECK (length(CAST(content AS BLOB)) <= 131072),
  appearance TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(appearance) AND json_type(appearance) = 'object' AND length(appearance) <= 1024),
  version INTEGER NOT NULL DEFAULT 1,
  published_name TEXT,
  published_content TEXT,
  published_appearance TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(published_appearance) AND json_type(published_appearance) = 'object' AND length(published_appearance) <= 1024),
  published_at TEXT,
  updated_at TEXT NOT NULL,
  legacy_tab_id TEXT,
  position INTEGER NOT NULL DEFAULT 1000
);
INSERT INTO space_files_next
  (id,space_id,name,folder_id,content,appearance,version,published_name,published_content,published_appearance,published_at,updated_at)
SELECT id,space_id,name,folder_id,content,appearance,version,published_name,published_content,published_appearance,published_at,updated_at
FROM space_files;
DROP TABLE space_files;
ALTER TABLE space_files_next RENAME TO space_files;
CREATE UNIQUE INDEX space_files_name ON space_files(space_id,COALESCE(folder_id,''),name COLLATE NOCASE);
CREATE INDEX space_files_public ON space_files(space_id,published_at);
CREATE UNIQUE INDEX space_files_legacy_tab ON space_files(space_id,legacy_tab_id);

-- Exact pre-cutover recovery material. It is never read by the active editor.
CREATE TABLE space_markdown_migrations (
  space_id TEXT PRIMARY KEY NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_data TEXT NOT NULL,
  source_placement TEXT NOT NULL,
  migrated_at TEXT NOT NULL
);
-- Short-lived transaction predicates. Each D1 batch deletes its own token.
CREATE TABLE space_file_guards (
  id TEXT PRIMARY KEY NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE
);

-- During a rolling release, a stale worker must not restore the old content model.
CREATE TRIGGER spaces_keep_markdown_model
BEFORE UPDATE OF data ON spaces
WHEN json_extract(OLD.data, '$.fileModelVersion') = 1 AND (
  json_extract(NEW.data, '$.fileModelVersion') IS NOT 1 OR
  json_type(NEW.data, '$.tabs') IS NOT NULL OR
  json_type(NEW.data, '$.documents') IS NOT NULL OR
  json_type(NEW.data, '$.sections') IS NOT NULL OR
  json_type(NEW.data, '$.files') IS NOT NULL OR
  json_type(NEW.data, '$.defaultTabId') IS NOT NULL OR
  json_type(NEW.data, '$.ungroupedPosition') IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'legacy_content_model');
END;

-- Bounded historical file rows avoid putting every document into one JSON row.
CREATE TABLE space_file_revisions (
  revision_id TEXT NOT NULL REFERENCES space_revisions(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(revision_id,file_id)
);
