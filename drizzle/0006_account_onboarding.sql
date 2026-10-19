-- Kept separate from public profile data; supports email and Sites account IDs.
CREATE TABLE account_onboarding (
  user_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'skipped')),
  occupation TEXT CHECK (occupation IN ('developer', 'designer', 'content_creator', 'student', 'other')),
  purpose TEXT CHECK (purpose IN ('links', 'projects', 'interests', 'business', 'explore')),
  discovery TEXT CHECK (discovery IN ('friend', 'profile', 'social_media', 'search', 'chatgpt', 'other')),
  updated_at TEXT NOT NULL,
  CHECK (status != 'skipped' OR (occupation IS NULL AND purpose IS NULL AND discovery IS NULL))
);
