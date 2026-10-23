-- Additive migration: keep every signup and its verification/deletion token.
CREATE TABLE IF NOT EXISTS abuse_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_abuse_limits_expiry ON abuse_limits(expires_at);
CREATE INDEX IF NOT EXISTS idx_signups_mailbox_community
  ON signups(community_key, lower(trim(email)));
