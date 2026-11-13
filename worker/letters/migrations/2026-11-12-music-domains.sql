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
