-- This migration and the folder-aware application must be released together.
-- Desktop is a real directory. Existing user folders keep their IDs and contents.
ALTER TABLE space_file_folders ADD COLUMN system TEXT
  CHECK (system IS NULL OR (system = 'desktop' AND parent_id IS NULL AND name = 'Desktop' COLLATE BINARY));
CREATE UNIQUE INDEX space_file_folders_system ON space_file_folders(space_id, system);

UPDATE space_file_folders AS original
SET name = (
  WITH RECURSIVE candidates(n) AS (
    SELECT 2 UNION ALL SELECT n + 1 FROM candidates
    WHERE n <= (SELECT COUNT(*) + 2 FROM space_file_folders WHERE space_id = original.space_id)
  )
  SELECT 'Desktop (' || n || ')' FROM candidates
  WHERE NOT EXISTS (
    SELECT 1 FROM space_file_folders sibling
    WHERE sibling.space_id = original.space_id AND sibling.parent_id IS NULL
      AND sibling.name = 'Desktop (' || n || ')' COLLATE NOCASE
  ) ORDER BY n LIMIT 1
), version = version + 1
WHERE parent_id IS NULL AND name = 'Desktop' COLLATE NOCASE;

INSERT INTO space_file_folders (id, space_id, name, system)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  id, 'Desktop', 'desktop' FROM spaces;

-- Old shortcuts could point to equally named files in different folders. Keep the
-- first name; give later collisions a stable unique suffix before the extension.
-- Planning names first avoids update-order-dependent collisions. Both snapshot
-- and draft names receive the suffix, without publishing draft content or names.
CREATE TABLE _desktop_file_moves (id TEXT PRIMARY KEY, suffix TEXT NOT NULL);
INSERT INTO _desktop_file_moves (id, suffix)
SELECT original.id, (
  WITH RECURSIVE candidates(n, suffix) AS (
    SELECT 1, ' (' || replace(original.id, '-', '') || '-1)'
    UNION ALL SELECT n + 1, ' (' || replace(original.id, '-', '') || '-' || (n + 1) || ')'
    FROM candidates WHERE n <= (SELECT COUNT(*) FROM space_files WHERE space_id = original.space_id)
  )
  SELECT suffix FROM candidates WHERE NOT EXISTS (
    SELECT 1 FROM space_files sibling WHERE sibling.space_id = original.space_id AND sibling.pinned = 1
    AND sibling.name =
      substr(original.name, 1, min(length(original.name) - CASE WHEN lower(substr(original.name, -3)) = '.md' THEN 3 ELSE 4 END,
        100 - length(suffix) - CASE WHEN lower(substr(original.name, -3)) = '.md' THEN 3 ELSE 4 END)) ||
      suffix || substr(original.name, -CASE WHEN lower(substr(original.name, -3)) = '.md' THEN 3 ELSE 4 END) COLLATE NOCASE
  ) ORDER BY n LIMIT 1
) FROM space_files original WHERE original.pinned = 1 AND EXISTS (
  SELECT 1 FROM space_files sibling WHERE sibling.space_id = original.space_id
    AND sibling.pinned = 1 AND sibling.name = original.name COLLATE NOCASE AND sibling.id < original.id
);

UPDATE space_files AS original
SET name = substr(name, 1, min(length(name) - CASE WHEN lower(substr(name, -3)) = '.md' THEN 3 ELSE 4 END,
      100 - length((SELECT suffix FROM _desktop_file_moves WHERE id = original.id)) - CASE WHEN lower(substr(name, -3)) = '.md' THEN 3 ELSE 4 END)) ||
    (SELECT suffix FROM _desktop_file_moves WHERE id = original.id) || substr(name, -CASE WHEN lower(substr(name, -3)) = '.md' THEN 3 ELSE 4 END),
  published_name = CASE WHEN published_name IS NULL THEN NULL ELSE
    substr(published_name, 1, min(length(published_name) - CASE WHEN lower(substr(published_name, -3)) = '.md' THEN 3 ELSE 4 END,
      100 - length((SELECT suffix FROM _desktop_file_moves WHERE id = original.id)) - CASE WHEN lower(substr(published_name, -3)) = '.md' THEN 3 ELSE 4 END)) ||
    (SELECT suffix FROM _desktop_file_moves WHERE id = original.id) || substr(published_name, -CASE WHEN lower(substr(published_name, -3)) = '.md' THEN 3 ELSE 4 END)
    END,
  folder_id = (SELECT id FROM space_file_folders WHERE space_id = original.space_id AND system = 'desktop'),
  version = version + 1
WHERE id IN (SELECT id FROM _desktop_file_moves);

UPDATE space_files AS original
SET folder_id = (SELECT id FROM space_file_folders WHERE space_id = original.space_id AND system = 'desktop'),
  version = version + 1
WHERE pinned = 1 AND id NOT IN (SELECT id FROM _desktop_file_moves);
DROP TABLE _desktop_file_moves;

UPDATE space_page_files AS original
SET folder_id = (SELECT id FROM space_file_folders WHERE space_id = original.space_id AND system = 'desktop'),
  version = version + 1
WHERE pinned = 1;
ALTER TABLE space_files DROP COLUMN pinned;
ALTER TABLE space_page_files DROP COLUMN pinned;

-- All space creation paths, including OAuth/MCP, get the same built-in directory.
CREATE TRIGGER spaces_create_desktop_folder AFTER INSERT ON spaces BEGIN
  INSERT INTO space_file_folders (id, space_id, name, system)
  VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
    NEW.id, 'Desktop', 'desktop');
END;

CREATE TRIGGER desktop_folder_protect_update BEFORE UPDATE OF system, name, parent_id ON space_file_folders
WHEN OLD.system = 'desktop' AND (NEW.system IS NOT OLD.system OR NEW.name IS NOT OLD.name OR NEW.parent_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'The Desktop folder is protected'); END;
CREATE TRIGGER desktop_folder_protect_delete BEFORE DELETE ON space_file_folders
WHEN OLD.system = 'desktop' AND EXISTS (SELECT 1 FROM spaces WHERE id = OLD.space_id)
BEGIN SELECT RAISE(ABORT, 'The Desktop folder is protected'); END;
