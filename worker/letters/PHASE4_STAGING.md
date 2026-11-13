# Phase 4 staging guide

## Isolated target

- Worker: void-galaxy-letters-phase4-staging
- D1 database: void-galaxy-letters-phase4-staging-20261112
- D1 ID: 2ef3cd89-e4d4-45f6-9ec1-73ae1a5aa639
- Wrangler config: wrangler.phase4-staging.toml

Use only the explicit staging config and verify its D1 name and ID before any remote operation. Never use the default wrangler.toml for Phase 4 staging operations. Never target Production.

## Supported database initialization paths

### Path A: fresh database

Initialize a new database from schema.sql only. This is the canonical current schema snapshot and already represents the schema in the general release migration chain. Do not replay historical migrations after it.

### Path B: legacy upgrade

For a database at the historical pre-admin baseline, apply migrations in this exact order:

1. 2026-10-30-admin-tracks.sql
2. 2026-10-30-daily-limit-admin.sql
3. 2026-10-31-letter-votes.sql
4. 2026-10-31-visitor-counter.sql
5. 2026-11-01-vote-retract.sql
6. 2026-11-05-reconcile-golden-folder.sql
7. 2026-11-05-secret-ink.sql
8. 2026-11-12-music-domains.sql

Do not run this chain against a fresh database initialized from schema.sql.

2026-11-12-staging-schema-reconcile.sql is a one-off staging-only reconciliation artifact. It is not part of either general release path and must not be replayed as a release migration. It was prepared for the specifically named staging database above.

## Local toolchain and tests

Use Node.js 24 or 26 and npm 11. Install exact project dependencies with npm ci. Run npm test for the Worker and schema path tests. Wrangler is local and pinned; use npx wrangler only with the explicit staging config for a separately authorized staging task.

Do not deploy, execute remote SQL, change secrets/bindings, or run the live D1 test harness as part of local verification. Those actions require separate explicit authorization. Never place ADMIN_SECRET in source, command arguments, logs, or reports.
