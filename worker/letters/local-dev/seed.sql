-- Local-only fixture memberships. Run only with Wrangler's --local flag.
INSERT OR IGNORE INTO track_domains (track_id, domain, assigned_at)
SELECT 'gf-adagio', 'beyond', strftime('%s','now')
WHERE EXISTS (SELECT 1 FROM tracks WHERE id = 'gf-adagio');
INSERT OR IGNORE INTO track_domains (track_id, domain, assigned_at)
SELECT 'gf-asturias', 'beyond', strftime('%s','now')
WHERE EXISTS (SELECT 1 FROM tracks WHERE id = 'gf-asturias');
INSERT OR IGNORE INTO track_domains (track_id, domain, assigned_at)
SELECT 'gf-a-toi', 'inner', strftime('%s','now')
WHERE EXISTS (SELECT 1 FROM tracks WHERE id = 'gf-a-toi');
INSERT OR IGNORE INTO track_domains (track_id, domain, assigned_at)
SELECT 'gf-piano-sleep', 'inner', strftime('%s','now')
WHERE EXISTS (SELECT 1 FROM tracks WHERE id = 'gf-piano-sleep');
INSERT OR IGNORE INTO track_domains (track_id, domain, assigned_at)
SELECT 'gf-rachmaninoff', 'inner', strftime('%s','now')
WHERE EXISTS (SELECT 1 FROM tracks WHERE id = 'gf-rachmaninoff');
INSERT OR IGNORE INTO track_domains (track_id, domain, assigned_at)
SELECT 'gf-ave-maria', 'beyond', strftime('%s','now')
WHERE EXISTS (SELECT 1 FROM tracks WHERE id = 'gf-ave-maria');
INSERT OR IGNORE INTO track_domains (track_id, domain, assigned_at)
SELECT 'gf-ave-maria', 'inner', strftime('%s','now')
WHERE EXISTS (SELECT 1 FROM tracks WHERE id = 'gf-ave-maria');
INSERT OR IGNORE INTO track_domains (track_id, domain, assigned_at)
SELECT 'gf-piano-sleep', 'podcast', strftime('%s','now')
WHERE EXISTS (SELECT 1 FROM tracks WHERE id = 'gf-piano-sleep');
INSERT OR IGNORE INTO track_domains (track_id, domain, assigned_at)
SELECT 'gf-ave-maria', 'podcast', strftime('%s','now')
WHERE EXISTS (SELECT 1 FROM tracks WHERE id = 'gf-ave-maria');
