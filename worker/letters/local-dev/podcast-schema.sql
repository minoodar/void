-- Local-only schema extension for Podcast Stage 1. Never run remotely.
PRAGMA foreign_keys=OFF;
ALTER TABLE track_domains RENAME TO track_domains_stage1_base;
CREATE TABLE track_domains (
  track_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY(track_id, domain),
  FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE
);
INSERT INTO track_domains (track_id, domain, assigned_at)
SELECT track_id, domain, assigned_at FROM track_domains_stage1_base;
DROP TABLE track_domains_stage1_base;
CREATE INDEX IF NOT EXISTS idx_track_domains_domain_track ON track_domains(domain, track_id);
PRAGMA foreign_keys=ON;
