import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const migrationsDir = path.join(root, "migrations");
const read = (p) => fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
const currentSchema = read(path.join(root, "schema.sql"));
const legacySchema = read(path.join(root, "test", "fixtures", "historical-schema.sql"));
const migrationNames = [
  "2026-10-30-admin-tracks.sql",
  "2026-10-30-daily-limit-admin.sql",
  "2026-10-31-letter-votes.sql",
  "2026-10-31-visitor-counter.sql",
  "2026-11-01-vote-retract.sql",
  "2026-11-05-reconcile-golden-folder.sql",
  "2026-11-05-secret-ink.sql",
  "2026-11-12-music-domains.sql"
];
const requiredColumns = {
  letters: ["seq", "id", "body", "lang", "created_at", "expires_at", "secret_ink", "base_expires_at", "base_votes_net", "presence"],
  tracks: ["id", "title", "artist", "audio_url", "artwork_url", "duration", "tags", "position", "created_at", "updated_at"],
  letter_votes: ["letter_id", "voter_hash", "vote_type", "created_at"],
  letter_vote_rate: ["voter_hash", "bucket", "count"],
  letter_vote_rate_v2: ["voter_hash", "bucket", "count"],
  visitors: ["ip_hash", "hits", "sessions", "first_seen", "last_seen"],
  daily: ["day", "unique_new", "sessions"],
  rate: ["ip_hash", "hour", "count"],
  track_domains: ["track_id", "domain", "assigned_at"],
  domain_state: ["singleton_id", "version"],
  domain_audit_batches: ["batch_id", "operation", "created_at", "undo_of_batch_id", "undone_by_batch_id"],
  domain_audit_targets: ["batch_id", "track_id", "track_ref", "title_snapshot"],
  domain_audit_changes: ["batch_id", "track_id", "track_ref", "title_snapshot", "domain", "previous_assigned", "new_assigned", "changed_at"],
  domain_track_deletions: ["batch_id", "track_id", "title_snapshot", "artist_snapshot", "created_at_snapshot", "deleted_at"],
  domain_acceptance: ["singleton_id", "accepted_at", "state_version", "accepted_count"],
  domain_accepted_tracks: ["track_id", "title_snapshot", "accepted_at"]
};

function database() { return new DatabaseSync(":memory:"); }
function runSql(db, sql) { db.exec(sql); }
function applyMigrations(db) {
  for (const name of migrationNames) runSql(db, read(path.join(migrationsDir, name)));
}
function schemaSignature(db) {
  const objects = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  const tableNames = objects.filter(x => x.type === "table").map(x => x.name);
  const tables = tableNames.map(name => ({
    name,
    columns: db.prepare("PRAGMA table_info(" + JSON.stringify(name) + ")").all().map(c => ({
      name: c.name, type: c.type.toUpperCase(), notnull: c.notnull, default: c.dflt_value === "NULL" ? null : c.dflt_value, pk: c.pk
    })).sort((a,b) => a.name.localeCompare(b.name)),
    checks: ((objects.find(o => o.type === "table" && o.name === name)?.sql || "").match(/CHECK\s*\([^)]*\)/gi) || []).map(x => x.replace(/\s+/g, " ").toLowerCase()).sort(),
    foreignKeys: db.prepare("PRAGMA foreign_key_list(" + JSON.stringify(name) + ")").all().map(f => ({
      table: f.table, from: f.from, to: f.to, on_update: f.on_update, on_delete: f.on_delete, match: f.match
    })).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    indexes: db.prepare("PRAGMA index_list(" + JSON.stringify(name) + ")").all().map(i => ({
      name: i.name, unique: i.unique, origin: i.origin, partial: i.partial,
      columns: db.prepare("PRAGMA index_info(" + JSON.stringify(i.name) + ")").all().map(c => c.name)
    })).sort((a,b) => a.name.localeCompare(b.name))
  }));
  const definitions = objects.filter(o => o.type === "trigger" || o.type === "index")
    .map(o => [o.type, o.name, o.tbl_name, (o.sql || "").replace(/--[^\r\n]*/g, "").replace(/DEFAULT NULL/gi, "").replace(/\s+/g, " ").replace(/\s+([,)])/g, "$1").replace(/([,(])\s+/g, "$1").trim().toLowerCase()]);
  return { tables, definitions };
}
function assertWorkerSchema(db) {
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name));
  for (const [table, columns] of Object.entries(requiredColumns)) {
    assert.ok(names.has(table), "missing table " + table);
    const actual = db.prepare("PRAGMA table_info(" + JSON.stringify(table) + ")").all().map(c => c.name);
    assert.deepEqual([...actual].sort(), [...columns].sort(), "columns for " + table);
  }
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(x => x.name);
  assert.ok(!triggers.includes("letter_votes_apply_lifespan"), "obsolete lifespan trigger must be absent");
  for (const name of ["domain_tracks_insert", "domain_tracks_delete", "domain_membership_insert", "domain_membership_delete", "domain_audit_target_validate", "domain_acceptance_version_guard"]) {
    assert.ok(triggers.includes(name), "missing Music Domains trigger " + name);
  }
}
test("Path A: fresh current schema.sql satisfies Worker requirements", () => {
  const db = database();
  runSql(db, currentSchema);
  assertWorkerSchema(db);
  db.close();
});
test("Path B: historical baseline plus ordered release migrations matches fresh schema", () => {
  const db = database();
  runSql(db, legacySchema);
  db.exec("INSERT INTO letters(id,body,lang,created_at,expires_at) VALUES('fixture-letter','preserve me','en',100,9000000)");
  db.exec("INSERT INTO letter_senders(sender_hash,letter_id,request_id,claimed_at,next_allowed_at) VALUES('sender','fixture-letter','req',100,200)");
  db.exec("INSERT INTO letter_limits(scope,bucket,count) VALUES('global',0,1)");
  applyMigrations(db);
  assertWorkerSchema(db);
  assert.equal(db.prepare("SELECT body FROM letters WHERE id='fixture-letter'").get().body, "preserve me");
  assert.equal(db.prepare("SELECT count(*) AS n FROM letter_senders WHERE sender_hash='sender'").get().n, 1);
  assert.equal(db.prepare("SELECT count FROM letter_limits WHERE scope='global' AND bucket=0").get().count, 1);
  const fresh = database();
  runSql(fresh, currentSchema);
  assert.deepEqual(schemaSignature(db), schemaSignature(fresh), "legacy upgrade effective schema must match fresh snapshot");
  fresh.close();
  db.close();
});
