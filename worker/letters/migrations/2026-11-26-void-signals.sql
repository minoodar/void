-- Migration 2026-11-26: Void Signals operational notification infrastructure.
-- Persistent notification messages plus versioned Star Presentation Profiles.
-- Additive only: no existing table, column, index or trigger is altered or dropped.
-- Safe to run once on an existing D1 database:
--   cd worker/letters && wrangler d1 execute DB --local --file=migrations/2026-11-26-void-signals.sql
--
-- Design notes carried into schema.sql:
--   * id is an opaque 32-hex stable identifier (randomId()). Title, position and
--     array index never participate in identity, so a message keeps its id across
--     every edit and the Galaxy and the Notification Center address one record.
--   * All timestamps are unix seconds (INTEGER), matching letters/tracks. NULL means
--     "not set": scheduled_at NULL = never scheduled, expires_at NULL = never expires.
--   * Lifecycle lives in status; read state never touches this table (session read
--     state is browser-side only), so a row's status cannot change because somebody
--     opened the message.
--   * state_version is a per-row mutation counter used for optimistic concurrency on
--     admin writes, which keeps transitions atomic instead of read-then-write.
--   * category and importance are intentionally NOT CHECK-constrained. SQLite cannot
--     widen a CHECK without a table rebuild, and this project is additive-only; the
--     Worker validates them against an extensible vocabulary instead. status IS
--     constrained because the six lifecycle states are fixed.
--   * metadata is renderer hints only (an allowlist enforced in the Worker). It must
--     never carry visual profile settings; those live in star_profile_versions.

CREATE TABLE IF NOT EXISTS signal_messages (
  id            TEXT PRIMARY KEY,            -- opaque 32-hex stable id, never reused
  title         TEXT NOT NULL,               -- short display label, max 120 codepoints
  body          TEXT NOT NULL,               -- message text, max 500 codepoints, never executable
  category      TEXT NOT NULL DEFAULT 'ambient', -- vocabulary validated in the Worker
  importance    TEXT NOT NULL DEFAULT 'normal',  -- ambient | normal | important
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','scheduled','active','hidden','revoked','expired')),
  state_version INTEGER NOT NULL DEFAULT 1,  -- optimistic-concurrency counter per row
  created_at    INTEGER NOT NULL,            -- Unix timestamp in seconds
  updated_at    INTEGER NOT NULL,            -- Unix timestamp in seconds
  published_at  INTEGER DEFAULT NULL,        -- set when the row first became active
  scheduled_at  INTEGER DEFAULT NULL,        -- future activation time, NULL = unscheduled
  expires_at    INTEGER DEFAULT NULL,        -- end of eligibility, NULL = permanent
  profile_id    TEXT DEFAULT NULL,           -- optional per-message Star Profile override
  created_by    TEXT DEFAULT NULL,           -- self-declared admin label, not an identity
  metadata      TEXT NOT NULL DEFAULT '{}',  -- JSON object of renderer hints (allowlist)
  FOREIGN KEY(profile_id) REFERENCES star_profiles(id) ON DELETE SET NULL
);

-- Public feed: eligible rows only, newest publication first.
CREATE INDEX IF NOT EXISTS idx_signal_messages_status ON signal_messages(status, published_at);
-- Expiry sweep and eligibility filtering.
CREATE INDEX IF NOT EXISTS idx_signal_messages_expiry ON signal_messages(status, expires_at);
-- Scheduled activation sweep.
CREATE INDEX IF NOT EXISTS idx_signal_messages_scheduled ON signal_messages(status, scheduled_at);
-- Category grouping in the Notification Center.
CREATE INDEX IF NOT EXISTS idx_signal_messages_category ON signal_messages(category, status);
-- Profile usage checks before a profile can be retired.
CREATE INDEX IF NOT EXISTS idx_signal_messages_profile ON signal_messages(profile_id);

-- Star Presentation Profiles. Identity is the id; the name is editable and never
-- participates in identity. Version rows are immutable once written.
CREATE TABLE IF NOT EXISTS star_profiles (
  id              TEXT PRIMARY KEY,          -- opaque 32-hex stable id
  name            TEXT NOT NULL,             -- editable label, max 64 codepoints
  current_version INTEGER NOT NULL DEFAULT 0,-- newest saved version (draft or active)
  active_version  INTEGER NOT NULL DEFAULT 0,-- version the public sees; 0 = never activated
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- One immutable row per saved profile revision. Activating publishes an existing
-- version; restoring copies an old version forward as a new one, so history is
-- append-only and the previously active version is always recoverable.
CREATE TABLE IF NOT EXISTS star_profile_versions (
  profile_id  TEXT NOT NULL,
  version     INTEGER NOT NULL,              -- 1-based, monotonic per profile
  settings    TEXT NOT NULL,                 -- compact versioned presentation schema
  created_at  INTEGER NOT NULL,
  created_by  TEXT DEFAULT NULL,
  PRIMARY KEY (profile_id, version),
  FOREIGN KEY(profile_id) REFERENCES star_profiles(id) ON DELETE CASCADE
);

-- Which profile the public renderer uses. scope is 'global' or 'category:<name>'.
CREATE TABLE IF NOT EXISTS star_profile_assignments (
  scope       TEXT PRIMARY KEY,              -- 'global' | 'category:' || category
  profile_id  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES star_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_star_profile_assignments_profile ON star_profile_assignments(profile_id);

-- Change counter for cheap public refresh: clients read one integer and only refetch
-- configuration when it moved. Mirrors the domain_state singleton pattern.
CREATE TABLE IF NOT EXISTS signal_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id=1),
  version INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO signal_state(singleton_id,version) VALUES(1,0);

CREATE TRIGGER IF NOT EXISTS signal_messages_insert AFTER INSERT ON signal_messages BEGIN UPDATE signal_state SET version=version+1 WHERE singleton_id=1; END;
CREATE TRIGGER IF NOT EXISTS signal_messages_update AFTER UPDATE ON signal_messages BEGIN UPDATE signal_state SET version=version+1 WHERE singleton_id=1; END;
CREATE TRIGGER IF NOT EXISTS signal_messages_delete AFTER DELETE ON signal_messages BEGIN UPDATE signal_state SET version=version+1 WHERE singleton_id=1; END;
CREATE TRIGGER IF NOT EXISTS star_profile_versions_insert AFTER INSERT ON star_profile_versions BEGIN UPDATE signal_state SET version=version+1 WHERE singleton_id=1; END;
CREATE TRIGGER IF NOT EXISTS star_profiles_update AFTER UPDATE ON star_profiles BEGIN UPDATE signal_state SET version=version+1 WHERE singleton_id=1; END;
CREATE TRIGGER IF NOT EXISTS star_profile_assignments_insert AFTER INSERT ON star_profile_assignments BEGIN UPDATE signal_state SET version=version+1 WHERE singleton_id=1; END;
CREATE TRIGGER IF NOT EXISTS star_profile_assignments_update AFTER UPDATE ON star_profile_assignments BEGIN UPDATE signal_state SET version=version+1 WHERE singleton_id=1; END;
CREATE TRIGGER IF NOT EXISTS star_profile_assignments_delete AFTER DELETE ON star_profile_assignments BEGIN UPDATE signal_state SET version=version+1 WHERE singleton_id=1; END;
