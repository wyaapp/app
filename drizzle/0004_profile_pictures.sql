-- Pictures deliberately live outside revision JSON. Replacing/removing a photo
-- never creates a revision, and restoring content never restores a photo.
ALTER TABLE spaces ADD COLUMN picture_key text;
CREATE UNIQUE INDEX spaces_picture_key ON spaces(picture_key);
-- Tracks pending/current objects so interrupted uploads and failed deletions
-- can be cleaned up without retaining a photo history.
CREATE TABLE picture_objects (
  key text PRIMARY KEY NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX picture_objects_created ON picture_objects(created_at);
