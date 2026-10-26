-- Server-managed access, separate from editable/public space data. Expiry uses
-- Unix milliseconds. Payment processing reconciles this projection separately.
CREATE TABLE account_plans (
  user_id TEXT PRIMARY KEY NOT NULL,
  premium_until INTEGER NOT NULL CHECK (premium_until >= 0 AND premium_until <= 9007199254740991),
  updated_at INTEGER NOT NULL
);

-- The old universal five-space cap also restricted self-hosted installations.
-- Hosted creation now checks the current account entitlement and space count in
-- the same conditional INSERT. Existing spaces and their contents are untouched.
DROP TRIGGER spaces_limit;
CREATE TRIGGER spaces_limit BEFORE INSERT ON spaces BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM spaces WHERE handle = NEW.handle)
    THEN RAISE(ABORT, 'handle_taken') END;
END;
