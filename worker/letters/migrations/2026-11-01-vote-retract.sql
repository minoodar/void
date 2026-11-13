-- Preserve each existing letter's current expiry as the baseline so migration
-- does not infer historical lifetime changes from votes that hit a cap or floor.
-- The Worker uses this v2 bucket table for vote writes; create it additively so
-- fresh installs and databases that already have it use the same rate contract.
CREATE TABLE IF NOT EXISTS letter_vote_rate_v2 (
  voter_hash TEXT NOT NULL,
  bucket     INTEGER NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (voter_hash, bucket)
);
CREATE INDEX IF NOT EXISTS idx_letter_vote_rate_v2_bucket
  ON letter_vote_rate_v2(bucket);

ALTER TABLE letters ADD COLUMN base_expires_at INTEGER;
ALTER TABLE letters ADD COLUMN base_votes_net INTEGER NOT NULL DEFAULT 0;

UPDATE letters SET
  base_expires_at = expires_at,
  base_votes_net =
    (SELECT COUNT(*) FROM letter_votes v
     WHERE v.letter_id = letters.id AND v.vote_type = 'like') -
    (SELECT COUNT(*) FROM letter_votes v
     WHERE v.letter_id = letters.id AND v.vote_type = 'dislike');

DROP TRIGGER IF EXISTS letter_votes_apply_lifespan;
