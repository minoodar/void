-- Migration 2026-10-30: per-sender sliding 24h limit + admin API.
-- Additive only: existing letters, letter_senders and letter_limits rows are
-- untouched. Safe to run once on an existing D1 database.
--
--   wrangler d1 execute void-galaxy-letters-db --remote \
--     --file=worker/letters/migrations/2026-10-30-daily-limit-admin.sql

CREATE TABLE IF NOT EXISTS letter_submissions (
  request_id  TEXT PRIMARY KEY,
  sender_hash TEXT NOT NULL,
  letter_id   TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_letter_submissions_sender
  ON letter_submissions(sender_hash, created_at);
