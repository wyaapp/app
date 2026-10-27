CREATE TABLE space_trash (
  id TEXT PRIMARY KEY NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  kind TEXT NOT NULL CHECK(kind IN ('file','folder')),
  name TEXT NOT NULL,
  original_parent_id TEXT,
  original_location TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  folder_count INTEGER NOT NULL,
  size INTEGER NOT NULL
);
CREATE INDEX space_trash_space ON space_trash(space_id,deleted_at);
CREATE TABLE space_trash_items (
  entry_id TEXT NOT NULL REFERENCES space_trash(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('file','folder')),
  data TEXT NOT NULL CHECK(json_valid(data)),
  PRIMARY KEY(space_id,kind,item_id)
);
CREATE INDEX space_trash_items_entry ON space_trash_items(entry_id);
CREATE TABLE space_file_tombstones (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  PRIMARY KEY(space_id,file_id)
);
