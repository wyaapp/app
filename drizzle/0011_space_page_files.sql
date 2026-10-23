-- Only placement is stored here. Existing tabs remain the source of page content.
CREATE TABLE space_page_files (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  tab_id TEXT NOT NULL,
  folder_id TEXT REFERENCES space_file_folders(id) ON DELETE SET NULL,
  pinned INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (space_id, tab_id)
);
CREATE INDEX space_page_files_folder ON space_page_files(folder_id);
