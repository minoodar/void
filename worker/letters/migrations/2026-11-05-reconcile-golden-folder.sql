-- One-time data reconciliation for the Golden Folder.
--
-- 2026-10-30-admin-tracks.sql seeded seven tracks. One of them (gf-conquest)
-- was later removed through the admin panel, and a second row pointing at the
-- same "State Of Siege" audio file was added. The public site now reads this
-- table only, so restore the missing track and drop the duplicate.
--
-- Back up first (read-only):
--   cd worker/letters && wrangler d1 execute DB --remote \
--     --command "SELECT * FROM tracks ORDER BY position;"
--
-- Apply:
--   cd worker/letters && wrangler d1 execute DB --remote \
--     --file=migrations/2026-11-05-reconcile-golden-folder.sql
--
-- Verify:
--   cd worker/letters && wrangler d1 execute DB --remote \
--     --command "SELECT id, title, position FROM tracks ORDER BY position;"

-- Duplicate: same audio_url as 570193694a53e7b715c246314811b20d.
DELETE FROM tracks WHERE id = '45cb6a3892652d3e84505638df795016';

-- Restore the track the seed migration shipped (idempotent).
INSERT INTO tracks (id, title, artist, audio_url, artwork_url, duration, tags, position, created_at, updated_at)
SELECT
  'gf-conquest',
  'Conquest of Paradise',
  '',
  'https://pub-fa04af4cffb74c979c0f18d50fa5f218.r2.dev/Conquest-of-Paradise.mp3',
  NULL, NULL, '[]', 1,
  CAST(strftime('%s','now') AS INTEGER),
  CAST(strftime('%s','now') AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE id = 'gf-conquest');

-- Deterministic order for the expected ten tracks; any other row keeps its place.
UPDATE tracks SET position = CASE id
  WHEN 'gf-adagio' THEN 0
  WHEN 'gf-conquest' THEN 1
  WHEN 'gf-asturias' THEN 2
  WHEN 'gf-a-toi' THEN 3
  WHEN 'gf-piano-sleep' THEN 4
  WHEN 'gf-rachmaninoff' THEN 5
  WHEN 'gf-ave-maria' THEN 6
  WHEN '570193694a53e7b715c246314811b20d' THEN 7
  WHEN '2650b776870e3b8d846e57473e0a12b7' THEN 8
  WHEN 'bdd5dad4572722514f20931b4dc3995d' THEN 9
  ELSE position END
WHERE id IN (
  'gf-adagio', 'gf-conquest', 'gf-asturias', 'gf-a-toi', 'gf-piano-sleep',
  'gf-rachmaninoff', 'gf-ave-maria', '570193694a53e7b715c246314811b20d',
  '2650b776870e3b8d846e57473e0a12b7', 'bdd5dad4572722514f20931b4dc3995d'
);
