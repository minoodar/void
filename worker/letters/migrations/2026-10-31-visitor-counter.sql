-- Migration 2026-10-31: visitor counter tables for the letters database.
-- Additive only: existing letters, submissions, limits and tracks are untouched.
-- Counts start from zero; the retired void-galaxy-counter database is not read.
--
-- Apply from the repo root. Pass the binding `DB`, not a database name:
-- wrangler resolves it through database_id 559070d9-afb4-471e-8839-78866e9437a1
-- in worker/letters/wrangler.toml.
--
--   cd worker/letters && wrangler d1 execute DB --remote \
--     --file=migrations/2026-10-31-visitor-counter.sql

CREATE TABLE IF NOT EXISTS visitors (
  ip_hash    TEXT PRIMARY KEY,
  hits       INTEGER NOT NULL DEFAULT 0,
  sessions   INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visitors_hits ON visitors(hits);
CREATE INDEX IF NOT EXISTS idx_visitors_sessions ON visitors(sessions);

CREATE TABLE IF NOT EXISTS daily (
  day        TEXT PRIMARY KEY,
  unique_new INTEGER NOT NULL DEFAULT 0,
  sessions   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rate (
  ip_hash TEXT NOT NULL,
  hour    INTEGER NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, hour)
);

CREATE INDEX IF NOT EXISTS idx_rate_hour ON rate(hour);
