-- Only verified Stripe reconciliation writes account_plans. User metadata is not identity.
CREATE TABLE billing_accounts (
  user_id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT UNIQUE,
  subscription_id TEXT,
  subscription_status TEXT,
  currency TEXT,
  interval TEXT,
  current_period_end INTEGER NOT NULL DEFAULT 0,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  paid_until INTEGER NOT NULL DEFAULT 0,
  checkout_id TEXT,
  checkout_url TEXT,
  checkout_price_id TEXT,
  checkout_key TEXT,
  checkout_expires_at INTEGER NOT NULL DEFAULT 0,
  lock_id TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE billing_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  processed_at INTEGER NOT NULL
);
CREATE INDEX billing_events_processed ON billing_events (processed_at);
