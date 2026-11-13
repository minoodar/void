-- Phase A: Isolated Letters Schema
-- All operations assume SQLite/Cloudflare D1 compatibility.
-- Canonical fresh-install snapshot. It includes the current visitor and vote tables.

CREATE TABLE IF NOT EXISTS letters (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,          -- 128-bit random hex identifier
  body        TEXT NOT NULL,                 -- Normalized, validated UTF-8 text (max 500 codepoints)
  lang        TEXT DEFAULT NULL,             -- Normalized ISO/BCP47 lang tag or NULL
  presence    TEXT DEFAULT NULL,             -- Symbolic mark: human | moon | root | unknown | NULL (none).
                                             -- Production already has this nullable TEXT column (NULL default);
                                             -- no ALTER TABLE or migration is required.
  created_at  INTEGER NOT NULL,              -- Unix timestamp in seconds
  expires_at  INTEGER NOT NULL,              -- Unix timestamp in seconds
  secret_ink  INTEGER NOT NULL DEFAULT 0,    -- 1 = readers see it masked until they reveal it
  base_expires_at INTEGER DEFAULT NULL,       -- Expiry snapshot used as the vote baseline
  base_votes_net INTEGER NOT NULL DEFAULT 0   -- Net vote count already baked into that snapshot
);

CREATE INDEX IF NOT EXISTS idx_letters_expires ON letters(expires_at);
CREATE INDEX IF NOT EXISTS idx_letters_created ON letters(created_at);

-- Legacy 30-day claim ledger. Kept for backward compatibility and for admin
-- cleanup of pre-migration letters; POST /letters no longer reads or writes it.
CREATE TABLE IF NOT EXISTS letter_senders (
  sender_hash     TEXT PRIMARY KEY,          -- HMAC-SHA-256(LETTER_SALT, "letters:v1|" || ip)
  letter_id       TEXT NOT NULL,
  request_id      TEXT NOT NULL,             -- UUIDv4 from client
  claimed_at      INTEGER NOT NULL,          -- Unix timestamp in seconds
  next_allowed_at INTEGER NOT NULL           -- claimed_at + 30 days (2,592,000 seconds)
);

CREATE INDEX IF NOT EXISTS idx_letter_senders_claimed ON letter_senders(claimed_at);

-- One row per accepted submission. Powers two things:
--   1. idempotent retry by (sender_hash, request_id), including after a reload;
--   2. the sliding 24-hour per-sender limit (2 letters per 24h).
-- Only the domain-separated HMAC of the IP is stored; the raw IP never is.
CREATE TABLE IF NOT EXISTS letter_submissions (
  request_id  TEXT PRIMARY KEY,              -- Lowercased UUIDv4 from the client
  sender_hash TEXT NOT NULL,                 -- HMAC-SHA-256(LETTER_SALT, "letters:v1|" || ip)
  letter_id   TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL               -- Unix timestamp in seconds
);

CREATE INDEX IF NOT EXISTS idx_letter_submissions_sender
  ON letter_submissions(sender_hash, created_at);

-- Unified Rate Limiter (hourly buckets for the global ceiling). The per-sender
-- rule is the sliding 24-hour window in letter_submissions, not this table.
CREATE TABLE IF NOT EXISTS letter_limits (
  scope   TEXT NOT NULL,                     -- 'global' OR 'sender:' || sender_hash
  bucket  INTEGER NOT NULL,                  -- floor(timestamp / 3600)
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, bucket)
);

CREATE INDEX IF NOT EXISTS idx_letter_limits_bucket ON letter_limits(bucket);

-- Playlist tracks managed by the admin dashboard. Public GET /tracks is read-only.
-- Keep this table structural here; the 2026-10-30-admin-tracks migration seeds
-- the original Golden Folder playlist exactly once.
CREATE TABLE IF NOT EXISTS tracks (
  id          TEXT PRIMARY KEY,              -- admin-created 32-hex id, or seeded slug
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL DEFAULT '',
  audio_url   TEXT NOT NULL,                 -- absolute https URL or same-site relative path
  artwork_url TEXT DEFAULT NULL,             -- optional custom cover
  duration    INTEGER DEFAULT NULL,          -- seconds, NULL when unknown
  tags        TEXT NOT NULL DEFAULT '[]',    -- JSON array of lowercase tags
  position    INTEGER NOT NULL DEFAULT 0,    -- playlist order, ascending
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_position ON tracks(position);

-- Music Domains additive schema (kept in sync with the migration).
-- Music Domains phase 4 additive schema. Safe to apply after admin-tracks.
CREATE TABLE IF NOT EXISTS track_domains (
 track_id TEXT NOT NULL, domain TEXT NOT NULL CHECK(domain IN ('inner','flow','beyond')),
 assigned_at INTEGER NOT NULL, PRIMARY KEY(track_id,domain),
 FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_track_domains_domain_track ON track_domains(domain,track_id);
CREATE TABLE IF NOT EXISTS domain_state (singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1), version INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO domain_state(singleton_id,version) VALUES(1,0);
CREATE TRIGGER IF NOT EXISTS domain_tracks_insert AFTER INSERT ON tracks BEGIN UPDATE domain_state SET version=version+1 WHERE singleton_id=1; END;
CREATE TRIGGER IF NOT EXISTS domain_tracks_delete AFTER DELETE ON tracks BEGIN UPDATE domain_state SET version=version+1 WHERE singleton_id=1; END;
CREATE TRIGGER IF NOT EXISTS domain_membership_insert AFTER INSERT ON track_domains BEGIN UPDATE domain_state SET version=version+1 WHERE singleton_id=1; END;
CREATE TRIGGER IF NOT EXISTS domain_membership_delete AFTER DELETE ON track_domains BEGIN UPDATE domain_state SET version=version+1 WHERE singleton_id=1; END;
CREATE TABLE IF NOT EXISTS domain_audit_batches (
 batch_id TEXT PRIMARY KEY, operation TEXT NOT NULL CHECK(operation IN ('add','remove','set','undo','track_delete')),
 created_at INTEGER NOT NULL, undo_of_batch_id TEXT UNIQUE, undone_by_batch_id TEXT UNIQUE,
 FOREIGN KEY(undo_of_batch_id) REFERENCES domain_audit_batches(batch_id),
 FOREIGN KEY(undone_by_batch_id) REFERENCES domain_audit_batches(batch_id)
);
CREATE TABLE IF NOT EXISTS domain_audit_targets (
 batch_id TEXT NOT NULL, track_id TEXT NOT NULL, track_ref TEXT, title_snapshot TEXT NOT NULL,
 PRIMARY KEY(batch_id,track_id), FOREIGN KEY(batch_id) REFERENCES domain_audit_batches(batch_id) ON DELETE CASCADE,
 FOREIGN KEY(track_ref) REFERENCES tracks(id) ON DELETE SET NULL
);
CREATE TRIGGER IF NOT EXISTS domain_audit_target_validate BEFORE INSERT ON domain_audit_targets WHEN NOT EXISTS(SELECT 1 FROM tracks WHERE id=NEW.track_id) BEGIN SELECT RAISE(ABORT,'unknown_track'); END;
CREATE TABLE IF NOT EXISTS domain_audit_changes (
 batch_id TEXT NOT NULL, track_id TEXT NOT NULL, track_ref TEXT, title_snapshot TEXT NOT NULL,
 domain TEXT NOT NULL CHECK(domain IN ('inner','flow','beyond')), previous_assigned INTEGER NOT NULL CHECK(previous_assigned IN (0,1)),
 new_assigned INTEGER NOT NULL CHECK(new_assigned IN (0,1)), changed_at INTEGER NOT NULL,
 PRIMARY KEY(batch_id,track_id,domain), CHECK(previous_assigned<>new_assigned),
 FOREIGN KEY(batch_id) REFERENCES domain_audit_batches(batch_id) ON DELETE CASCADE,
 FOREIGN KEY(track_ref) REFERENCES tracks(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS domain_track_deletions (
 batch_id TEXT NOT NULL, track_id TEXT NOT NULL, title_snapshot TEXT NOT NULL, artist_snapshot TEXT NOT NULL,
 created_at_snapshot INTEGER NOT NULL, deleted_at INTEGER NOT NULL, PRIMARY KEY(batch_id,track_id),
 FOREIGN KEY(batch_id) REFERENCES domain_audit_batches(batch_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS domain_acceptance (
 singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1), accepted_at INTEGER NOT NULL,
 state_version INTEGER NOT NULL, accepted_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS domain_accepted_tracks (
 track_id TEXT PRIMARY KEY, title_snapshot TEXT NOT NULL, accepted_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS domain_acceptance_version_guard BEFORE INSERT ON domain_acceptance WHEN NEW.state_version<>(SELECT version FROM domain_state WHERE singleton_id=1) BEGIN SELECT RAISE(ABORT,'stale_snapshot'); END;

-- Current vote and request-rate tables. The lifespan adjustment is handled by the Worker.
CREATE TABLE IF NOT EXISTS letter_votes (
  letter_id TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('like', 'dislike')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (letter_id, voter_hash)
);
CREATE INDEX IF NOT EXISTS idx_letter_votes_voter ON letter_votes(voter_hash, created_at);
CREATE TABLE IF NOT EXISTS letter_vote_rate (
  voter_hash TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (voter_hash, bucket)
);
CREATE INDEX IF NOT EXISTS idx_letter_vote_rate_bucket ON letter_vote_rate(bucket);
CREATE TABLE IF NOT EXISTS letter_vote_rate_v2 (
  voter_hash TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (voter_hash, bucket)
);
CREATE INDEX IF NOT EXISTS idx_letter_vote_rate_v2_bucket ON letter_vote_rate_v2(bucket);
CREATE TABLE IF NOT EXISTS visitors (
  ip_hash TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visitors_hits ON visitors(hits);
CREATE INDEX IF NOT EXISTS idx_visitors_sessions ON visitors(sessions);
CREATE TABLE IF NOT EXISTS daily (
  day TEXT PRIMARY KEY,
  unique_new INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rate (
  ip_hash TEXT NOT NULL,
  hour INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, hour)
);
CREATE INDEX IF NOT EXISTS idx_rate_hour ON rate(hour);
