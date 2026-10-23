CREATE TABLE space_files (
  id TEXT PRIMARY KEY NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  published_name TEXT,
  published_content TEXT,
  published_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  updated_at TEXT NOT NULL,
  CHECK (length(CAST(content AS BLOB)) <= 65536)
);
CREATE UNIQUE INDEX space_files_name ON space_files(space_id, name);
CREATE INDEX space_files_public ON space_files(space_id, published_at);
