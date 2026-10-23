CREATE TABLE space_file_folders (
  id TEXT PRIMARY KEY NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES space_file_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX space_file_folders_name ON space_file_folders(space_id, COALESCE(parent_id, ''), name);

ALTER TABLE space_files ADD COLUMN folder_id TEXT REFERENCES space_file_folders(id) ON DELETE CASCADE;
DROP INDEX space_files_name;
CREATE UNIQUE INDEX space_files_name ON space_files(space_id, COALESCE(folder_id, ''), name);
