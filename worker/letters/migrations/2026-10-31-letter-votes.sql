-- Migration 2026-10-31: per-letter votes and dynamic lifespan.
-- Additive only: letters, submissions, limits, tracks and the visitor counter
-- tables are untouched. Vote counts are derived from the ledger row by row, so
-- no counter column can ever drift away from the votes themselves.
--
-- Apply from the repo root. Pass the binding `DB`, not a database name:
-- wrangler resolves it through database_id 559070d9-afb4-471e-8839-78866e9437a1
-- in worker/letters/wrangler.toml.
--
--   cd worker/letters && wrangler d1 execute DB --remote \
--     --file=migrations/2026-10-31-letter-votes.sql

-- One immutable vote per hashed visitor per letter. Only the domain-separated
-- HMAC of the IP is stored ("votes:v1|" || ip); the raw IP never is.
CREATE TABLE IF NOT EXISTS letter_votes (
  letter_id  TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  vote_type  TEXT NOT NULL CHECK (vote_type IN ('like', 'dislike')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (letter_id, voter_hash)
);

CREATE INDEX IF NOT EXISTS idx_letter_votes_voter
  ON letter_votes(voter_hash, created_at);

-- Hourly vote ceiling per hashed visitor. A vote also has to pass the letter
-- vote ledger, so this only curbs abuse across many letters.
CREATE TABLE IF NOT EXISTS letter_vote_rate (
  voter_hash TEXT NOT NULL,
  bucket     INTEGER NOT NULL,               -- floor(timestamp / 3600)
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (voter_hash, bucket)
);

CREATE INDEX IF NOT EXISTS idx_letter_vote_rate_bucket ON letter_vote_rate(bucket);

-- The lifespan shift lives on the insert itself: a duplicate vote writes no
-- ledger row, so it fires no trigger and can never shift the expiry twice.
-- Only an already-faded letter is skipped, matching the endpoint's active-letter
-- gate (NEW.created_at is the vote's own timestamp).
-- Like: +24h, never beyond 90 days from creation.
-- Dislike: -24h, never below one hour and never past the current expiry.
CREATE TRIGGER IF NOT EXISTS letter_votes_apply_lifespan
AFTER INSERT ON letter_votes
BEGIN
  UPDATE letters
  SET expires_at = CASE
    WHEN NEW.vote_type = 'like'
      THEN MIN(expires_at + 86400, created_at + 7776000)
    ELSE MIN(expires_at, MAX(expires_at - 86400, NEW.created_at + 3600))
  END
  WHERE id = NEW.letter_id AND expires_at > NEW.created_at;
END;
