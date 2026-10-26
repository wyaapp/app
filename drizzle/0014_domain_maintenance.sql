ALTER TABLE space_domains ADD COLUMN registration_id TEXT NOT NULL DEFAULT '';
ALTER TABLE space_domains ADD COLUMN next_check_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE space_domains ADD COLUMN queued_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE space_domains ADD COLUMN dispatch_id TEXT;
ALTER TABLE space_domains ADD COLUMN queue_claim_id TEXT;
ALTER TABLE space_domains ADD COLUMN check_failures INTEGER NOT NULL DEFAULT 0;

-- Registration identity fences delayed messages after a domain is removed/reconnected.
UPDATE space_domains SET registration_id = lower(hex(randomblob(16))),
  next_check_at = CASE WHEN checked_at > 0 THEN checked_at ELSE created_at END;
CREATE INDEX space_domains_due ON space_domains(next_check_at, queued_until)
  WHERE verified_at IS NOT NULL OR removing = 1;
