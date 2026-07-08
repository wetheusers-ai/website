-- We the Users — "Join the call" schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS communities (
  key        TEXT PRIMARY KEY,            -- slug, e.g. "open-source"
  name       TEXT NOT NULL,               -- display name
  category   TEXT,                        -- category key (NULL for unsorted write-ins)
  approved   INTEGER NOT NULL DEFAULT 0,  -- 0 = pending (write-in), 1 = visible publicly
  seeded     INTEGER NOT NULL DEFAULT 0,  -- 1 = shipped in the seed list
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signups (
  id             TEXT PRIMARY KEY,            -- random id
  community_key  TEXT NOT NULL,
  name           TEXT,                        -- optional, private
  email          TEXT,                        -- optional, private (never returned publicly)
  email_verified INTEGER NOT NULL DEFAULT 0,  -- only verified emails count toward public tallies
  verify_token   TEXT,                        -- nulled once verified
  created_at     TEXT NOT NULL,
  verified_at    TEXT,
  ip_hash        TEXT                         -- hashed IP for light abuse throttling (no raw IP stored)
);

CREATE INDEX IF NOT EXISTS idx_signups_community ON signups(community_key);
CREATE INDEX IF NOT EXISTS idx_signups_token     ON signups(verify_token);
CREATE INDEX IF NOT EXISTS idx_signups_email     ON signups(email);
CREATE INDEX IF NOT EXISTS idx_signups_iphash    ON signups(ip_hash, created_at);
