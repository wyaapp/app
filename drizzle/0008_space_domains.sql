CREATE TABLE space_domains (
  space_id TEXT PRIMARY KEY NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  verification_token TEXT NOT NULL,
  verified_at INTEGER,
  provider_id TEXT UNIQUE,
  hostname_status TEXT NOT NULL DEFAULT 'pending',
  ssl_status TEXT NOT NULL DEFAULT 'pending',
  dns_ready INTEGER NOT NULL DEFAULT 0,
  records TEXT NOT NULL DEFAULT '[]',
  redirect INTEGER NOT NULL DEFAULT 0 CHECK (redirect IN (0, 1)),
  removing INTEGER NOT NULL DEFAULT 0 CHECK (removing IN (0, 1)),
  checked_at INTEGER NOT NULL DEFAULT 0,
  attempted_at INTEGER NOT NULL DEFAULT 0,
  lock_id TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- An unverified claim must not prevent the real domain owner from connecting.
CREATE UNIQUE INDEX space_domains_verified_host ON space_domains(hostname) WHERE verified_at IS NOT NULL;
CREATE INDEX space_domains_host ON space_domains(hostname);
CREATE INDEX space_domains_attempted ON space_domains(attempted_at);
