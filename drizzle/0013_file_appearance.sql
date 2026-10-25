-- Appearance follows the same private draft / published snapshot boundary as file contents.
ALTER TABLE space_files ADD COLUMN appearance TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(appearance) AND json_type(appearance) = 'object' AND length(appearance) <= 1024);
ALTER TABLE space_files ADD COLUMN published_appearance TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(published_appearance) AND json_type(published_appearance) = 'object' AND length(published_appearance) <= 1024);
