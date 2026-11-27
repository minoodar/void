# Void Signals — Iteration 3 Operational Report

Scope of this document: the operational Signals infrastructure (Worker, D1, admin
API, administration UI) delivered for the "Persistent Messages & Star Studio —
Iteration 3" brief. The unified administration shell around it is documented in
`admin-experience/IMPLEMENTATION-REPORT.md`.

---

## 1. Verified baseline and branch

| Item | Value |
| --- | --- |
| Production branch (untouched) | `main` @ `5eba39c` (clone `void-galaxy-music-main`) |
| Iteration-2 baseline | `79339d3` — `preview: persistent signals, session read state and Void Star Studio` |
| Working branch | `feature/signals-operational-infrastructure` @ `fccbfdc` |
| Follow-on branch (same worktree) | `feature/admin-unified-experience` @ `91e7257` (parent `fccbfdc`) |
| Worktree | `E:\google chrome extention\_feature\signals-operational-infrastructure` |
| Commits ahead of `origin/main` | 5 (`44a70f6`, `79339d3`, `fccbfdc`, `91e7257`, and the report commit) |
| Pushed / merged / deployed | **no / no / no** — `origin` was never written to |

`fccbfdc` carries the backend (Worker, schema, migration, tests). `91e7257`
carries the administration front end and the shell it lives in.

## 2. Implemented architecture

```
index.html?admin=true
  └─ void-admin.js          unified shell: auth, routing, shared components
       ├─ void-signals-api.js    thin client for /signals + /admin/signals/*
       ├─ void-star-studio.js    presentation engine (preview + persisted schema)
       └─ void-signals-admin.js  Signals module: 7 sections, registered into shell
                     │
                     ▼  fetch, Authorization: Bearer <secret>
        Cloudflare Worker `void-galaxy-letters` (worker/letters/worker.js)
          ├─ signalsPublic()   GET-only public reads, eligible rows only
          ├─ adminSignals()    one dispatcher, reached only past adminAuthorized()
          └─ D1  signal_messages · star_profiles · star_profile_versions
                 star_profile_assignments · signal_state
```

Deliberate boundaries:

- Signals reuses the existing letters Worker and D1 instead of a new service —
  no new deployment unit, no new secret, no CORS origin added.
- The admin front end is injected only when `?admin=(1|true)` is present, and
  only after the credential round-trip succeeds (`void-admin.js:8`, `inject()`
  at `void-admin.js:2012`).
- The shell owns navigation and feedback; the Signals module owns lifecycle,
  preview and persistence. Neither reaches into Letters or Music state.

## 3. D1 migration and schema

`worker/letters/migrations/2026-11-26-void-signals.sql` (also folded into
`worker/letters/schema.sql`, `CREATE TABLE IF NOT EXISTS`, additive only).

| Table | Purpose | Notes |
| --- | --- | --- |
| `signal_messages` | the single message identity | 32-hex `id`, never reused; `status` CHECK-constrained; `state_version` for optimistic concurrency; `profile_id` FK `ON DELETE SET NULL` |
| `star_profiles` | profile identity | `current_version` (newest saved) vs `active_version` (what the public sees, `0` = never activated) |
| `star_profile_versions` | append-only revisions | PK `(profile_id, version)`; settings stored as one compact JSON schema |
| `star_profile_assignments` | which profile renders | PK `scope` = `global` or `category:<name>` |
| `signal_state` | change counter singleton | `singleton_id=1 CHECK`, `version` |

8 triggers bump `signal_state.version` on every message insert/update/delete,
profile version insert, profile update and assignment insert/update/delete, so
one integer describes every configuration change. Indexes cover the four public
filters (status+published, status+expires, status+scheduled, category+status)
and profile-usage lookups.

**Not applied to production.** Applied to the local sandbox D1 only.

## 4. API route contract

Public (GET only, unauthenticated, `Cache-Control: no-store` by design —
eligibility depends on server time, `worker.js:2119`):

| Route | Returns |
| --- | --- |
| `GET /signals/version` | `{ ok, version }` — cheap poll token |
| `GET /signals/messages?limit=` | eligible messages + version (cap 60) |
| `GET /signals/messages/{id}` | one eligible message; hidden/revoked/expired/unknown all answer `404 message_not_available` so the feed cannot leak admin state |
| `GET /signals/profile` | active presentation config + version + `server_time` |
| `GET /signals/state` | config + eligible messages in one round-trip |

Administration (every route below the single `adminAuthorized` gate,
`Cache-Control: no-store`):

| Route | Methods |
| --- | --- |
| `/admin/signals/messages` | `GET` list (cap 200, filters), `POST` create |
| `/admin/signals/messages/{id}` | `GET` detail, `PUT` update, `DELETE` hard delete |
| `/admin/signals/messages/{id}/transition` | `POST` `publish·schedule·hide·revoke·reopen` |
| `/admin/signals/profiles` | `GET`, `POST` |
| `/admin/signals/profiles/{id}` | `GET`, `PUT` (saves a new version, does not publish), `DELETE` |
| `/admin/signals/profiles/{id}/versions` | `GET` |
| `/admin/signals/profiles/{id}/activate|restore|duplicate` | `POST` |
| `/admin/signals/assignments` | `GET`, `POST` |

Validation enforced server-side: id `/^[0-9a-f]{32}$/`, title ≤120, body ≤500,
name ≤64, actor ≤32 codepoints; importance `ambient|important`; category
vocabulary `general|release|event|milestone|maintenance`; `scheduled_at` must be
≥30 s in the future and ≤1 year out; `expires_in` 60 s…1 year; ≤60 active
messages; metadata allowlist `lang|icon|tone|occasion` with every presentation
key refused, which keeps content and presentation in separate stores.

## 5. Authentication and authorization model

- One guard: `fetch` dispatches `/admin/*` only after `adminAuthorized()`
  (`worker.js:472-484`). New routes must be added inside that block;
  `adminSignals` is reached from it and cannot be called unauthenticated.
- Comparison is `SHA-256(bearer)` vs `SHA-256(ADMIN_SECRET)` over `timingSafeEqual`,
  never a direct string compare.
- Missing/short secret → `503`; wrong credential → `401`; `ADMIN_AUTH_HOURLY_LIMIT = 10`
  caps failed unlocks per client per hour.
- The token exists only in `sessionStorage` under `voidAdmin.token.v1`
  (`void-admin.js:12,133-141`): per-tab, cleared on tab close, never mirrored to
  `localStorage`, cookies, the DOM, or any build file. Verified in the browser.
- Public routes are read-only and answer 405 for any other method; no public
  route performs a mutation, so `?admin=true` remains a UI-entry switch and
  never an authorization signal.
- Error bodies carry codes (`invalid_transition`, `confirmation_required`,
  `version_conflict`, `signals_unavailable`), never SQL, bindings or secrets.

## 6. Message lifecycle implementation

State machine (`worker.js:1852`), enforced server-side and mirrored in the UI:

```
draft ──publish──> active ──hide──> hidden ──reopen/publish──> active
  │                  │                                        (only while eligible)
  ├──schedule──> scheduled ──publish──> active
  │                  │
  └──revoke──> revoked (terminal)        active ──expiry sweep──> expired ──reopen──> draft
```

- A message is **never consumed by reading**. Read state is a client hint only;
  no API call changes `status`.
- Expiry is evaluated against `expires_at` and server time, independent of read
  or open state (`SIGNAL_ELIGIBLE_WHERE`).
- Revoked and expired rows never return to the public feed; `revoked` is
  terminal by design, and recovery means `reopen → draft` (an explicit admin act).
- Hard delete requires the literal phrase `DELETE SIGNAL`; the UI prefers
  hide/revoke and the probe confirmed a refused delete leaves the row intact.
- `state_version` rejects stale writes (`409 version_conflict`), so two open
  admin tabs cannot silently overwrite each other.

## 7. Notification Management capabilities

In the unified shell (Signals → Notification Management), all against the real
local Worker:

- List with filters (status, category, importance), pagination-safe at 200 rows.
- Create draft (title, body, category, importance, expiry, optional profile).
- Edit a draft/scheduled row; optimistic-concurrency conflicts surface as a
  toast instead of a silent overwrite.
- Transition buttons publish / schedule / hide / revoke / reopen, each behind a
  shared confirmation dialog and disabled when the state machine forbids it.
- Hard delete behind the typed confirmation phrase.
- Per-message profile override (`profile_id`) and metadata allowlist.
- Live counts feed the module tab badge; every action re-reads the server
  rather than trusting the optimistic row.

## 8. Star Studio live preview behavior

Two distinct verbs, and the difference is enforced by code, not copy:

- **Live preview** — edits apply instantly to the admin-only preview stage
  (`void-star-studio.js` renders the same arrangement/appearance model the
  public renderer will use). Nothing is written; `active_version` does not move.
- **Apply / Activate** — the only path that calls the API. Save writes a new
  immutable version row; activate sets `active_version` to an existing version.
  Only then does `/signals/profile` change.

Guarantees proven in the browser: the preview is temporary and admin-only; an
unactivated preview never reaches a public client; reload restores the
*activated* profile, not the abandoned preview; and the one product defect found
while validating (a dirty-draft state that kept re-activating the previous
profile) was fixed in `void-star-studio.js` with a clean-draft fast path.

## 9. Profile persistence and versioning

- Every save appends `star_profile_versions(profile_id, version)`.
- `current_version` tracks the newest draft, `active_version` what the public
  sees, so previewing and publishing are separate columns, not a flag.
- `restore` copies an old version forward as a new version (history stays
  append-only); `duplicate` forks a profile; `delete` requires
  `DELETE PROFILE` and is refused while messages still reference the profile.
- Assignments bind a profile to `global` or `category:<name>` scope; the most
  specific applicable scope wins.

## 10. Public configuration delivery

- `GET /signals/state` returns `{ ok, version, server_time, ...config, messages }`
  with `Cache-Control: no-store`; `GET /signals/version` exists so a client can
  poll one integer and refetch only when it moved.
- Presentation config reaches the public renderer **only** from activated
  versions; unactivated drafts are invisible to every public route (asserted in
  the live smoke suite).
- No production client consumes these routes yet — see item 16.

## 11. Session read-state implementation

- `signals-preview/message-store.js` keeps read state in `sessionStorage` under
  `void-sig-read-v1`, storing **message ids only** — never titles, bodies, or
  recipient data (the brief's privacy rule).
- Read → dim (star stays visible and clickable); reopen is allowed any number of
  times; only an explicit close changes the visual, and no window timer exists.
- A new site session starts unread for eligible stars; expiration is unaffected
  by read state.
- Read state never leaves the browser: there is no read/write endpoint, so the
  Worker cannot be used to mark another visitor's messages.

## 12. Performance and compatibility findings

- No polling in the admin module; sections load on entry and cache until an
  explicit refresh (verified: a return to a visited section issues zero requests,
  and Refresh issues exactly one).
- `void-signals-api.js` de-duplicates in-flight reads; the change counter means
  a public client can skip the config body entirely when the version is
  unchanged.
- Preview stars animate on `transform`/`opacity` only, one composite layer each;
  no per-frame layout.
- The admin bundles are ES5-style (`var`, function expressions, no build step),
  consistent with the rest of the site, and are injected lazily so visitors
  never download them (measured: 0 requests for the four Signals assets without
  `?admin=true`).
- Browser checks ran in real headless Chromium over CDP; reduced-motion, 390 px,
  768 px and 1440 px were exercised. Real-GPU behaviour is unverified.

## 13. Test results

Backend / offline suites:

| Suite | Result |
| --- | --- |
| `worker/letters/test/phase-a.test.mjs` | **135/135 passed** (includes signals lifecycle, security, ceiling) |
| `worker/letters/test/schema-paths.test.mjs` | **2 pass / 0 fail** |
| `worker/letters/test/live-signals-smoke.mjs` | **73/73 passed** against `http://127.0.0.1:8787`; sandbox left with 0 messages / 0 profiles |

Browser suites (real headless Chromium, local Worker + local static server):

| Probe | Result |
| --- | --- |
| Signals operational writes (`_tmp/admin-writes-probe.mjs`) | **46/46**, 0 exceptions, 0 console errors |
| Unified shell read-only (`_tmp/admin-shell-probe.mjs`) | **48/48** |
| Letters + Music + cross-module (`_tmp/admin-letters-music-probe.mjs`) | **48/48**, 8 POSTs, 0 credentialed off-host requests |
| Letters return path (`_tmp/letters-return-probe.mjs`) | **10/10** |
| Public isolation without `?admin=true` (`_tmp/public-no-admin-probe.mjs`) | **9/9** (`fetched:[]` for admin bundles) |
| Mobile navigation 390×844 (`_tmp/admin-mobile-nav-probe.mjs`) | **19/19** |
| Document-overflow sweep, 12 module/section pairs (`_tmp/mobile-overflow-audit.mjs`) | **1/1** — `overflow: 0` everywhere |
| Touch-target sweep, 12 module/section pairs (`_tmp/studio-touch-audit.mjs`) | **1/1** after fix |
| Desktop regression after the touch fix (`_tmp/desktop-untouched-probe.mjs`) | **10/10** |

Pre-existing failures, reported separately and **unchanged** by this work
(reproduced byte-for-byte in clean checkouts of `fccbfdc` and `79339d3` under
`_tmp/base-fcc` / `_tmp/base-793`):

| Suite | Now | At both baselines |
| --- | --- | --- |
| `tests/letters-api.test.mjs` | 47/48 — "negative sessions clamp to 0" | identical |
| `tests/podcast-ux.test.mjs` | 26/29 — pre-existing dismissals, asset cache keys, popover positioning | identical |
| `tests/x-share-host.test.mjs` | 7/12 (12 tests, 5 fail) | identical |

A frontend pass was not used to stand in for backend validation: message
lifecycle, auth failures, and version conflicts are asserted by
`phase-a.test.mjs` and `live-signals-smoke.mjs`, and the browser probes assert
the resulting HTTP calls, not just the rendered DOM.

## 14. Screenshots

Under `_tmp/admin-shots/` (not committed — scratch evidence):

- `write-01-draft.png` … `write-06-profiles-assigned.png` — draft → scheduled →
  revoked → studio preview → activated → profile assigned.
- `admin-1440x900-signals.png`, `admin-1440-signals-messages.png`,
  `admin-1440-studio.png`, `admin-1440-profiles.png`.
- `admin-768x1024-signals.png`, `admin-390x844-signals.png`,
  `mob-01-landing.png` … `mob-07-keyboard-nav.png` (mobile nav, studio touch
  targets, keyboard focus).

## 15. Changed-file inventory

Committed in `fccbfdc` (backend):

```
A worker/letters/migrations/2026-11-26-void-signals.sql   +105
M worker/letters/package.json                             +5/-2
M worker/letters/schema.sql                               +66
A worker/letters/test/live-signals-smoke.mjs              +360
M worker/letters/test/phase-a.test.mjs                    +516
M worker/letters/test/schema-paths.test.mjs               +17/-1
M worker/letters/worker.js                                +1243
```

Committed in `91e7257` (administration UI + shell):

```
A void-signals-api.js      +459
A void-star-studio.js      +764
A void-signals-admin.js    +876
A void-signals-admin.css   +537
M void-admin.js            +622/-52   (shell: modules, routing, shared components)
M void-admin.css           +73        (shell section nav, cards, phone touch targets)
M index.html               +2/-2      (re-key void-admin.css/.js to v=20261127)
```

Explicitly **not** touched anywhere in this work: `void-music*.js`,
`void-podcast*`, `podcast-*.js`, `void-letters*.js`, `void-domains.js`, the
shared seek handler, `worker/letters/wrangler.toml`, and any production
configuration. `git diff --name-only 79339d3 -- "*podcast*" "*seek*"` is empty.

## 16. Known defects and unresolved risks

1. **The public site does not consume `/signals` yet.** `index.html` ships no
   Signals UI; the message layer and read state live in the dev-only prototype
   under `signals-preview/`, which is served by its own preview server and keeps
   its own in-memory/store-backed data. The API and the administration UI are
   operational; visitor-facing delivery is the next, separate step and needs an
   owner decision (see item 18).
2. **`signals-preview/preview-server.mjs` has no live-API mode** (`--api`): the
   prototype cannot be pointed at the local Worker without the shim. Not needed
   for the shipped admin path, which talks to the Worker directly.
3. **One shared secret for all admin modules.** Letters, Music and Signals are
   separated by route and UI, not by credential; a leaked secret exposes all
   three. There is no per-module token, no second factor, no IP allowlist.
4. **No per-actor attribution.** `created_by` is a self-declared label (≤32
   codepoints), not an identity — it is fine as an audit hint, wrong as a control.
5. **Message history is append-only for profiles, not for messages.** A message
   keeps `state_version` but no per-transition log; history/recovery depends on
   profile versions plus the change counter.
6. **Admin writes are not rate-limited.** Only failed *authentication* is
   (10/hour). An authenticated client can write freely.
7. **`hidden → active` reopen depends on the client clock only for display.**
   The Worker is authoritative, but the UI countdown is local.
8. Local sandbox clock skew was observed (worker clock within 1 s of local) and
   is not a production risk; recorded because the smoke test prints it.

## 17. Exact final commit SHA

- Implementation (this deliverable's code): **`91e7257`** on
  `feature/admin-unified-experience`, parent `fccbfdc`.
- This report is committed in the child of `91e7257` on the same branch;
  `git log --oneline -3` shows both.
- Nothing was pushed: `git log --oneline origin/main..HEAD` lists exactly the 5
  local commits named in item 1.

## 18. Remaining production release requirements

Owner-run, in order, each gated on explicit approval. **None of this has been
executed in this iteration.**

1. Confirm identity before any `--remote` command:
   `cd worker/letters && wrangler d1 list` must show id
   `559070d9-afb4-471e-8839-78866e9437a1`.
2. Apply the migration (additive, idempotent):
   `cd worker/letters && wrangler d1 execute DB --remote --file=migrations/2026-11-26-void-signals.sql`
3. Deploy the Worker (`worker/letters/worker.js` is the deploy source; Workers
   Builds on push to `main`, or `cd worker/letters && wrangler deploy`).
   The migration must land *before* the deploy: `/signals` degrades to `503` if
   its tables are missing, which is the intended behaviour, not an outage.
4. Verify read-only against the live host:
   `curl -s https://void-galaxy-letters.minoodar.workers.dev/signals/version`
   → `{"ok":true,"version":N}`; `GET /admin/signals/messages` without a header
   → `401`.
5. Optional live smoke (writes test messages, so run it only when the owner
   accepts test rows in production, and clean up afterwards):
   `SIGNALS_LIVE_URL=https://void-galaxy-letters.minoodar.workers.dev
   SIGNALS_ADMIN_SECRET=<secret> node worker/letters/test/live-signals-smoke.mjs`
6. Ship the front end only after the public-layer decision in item 16.1: wire
   the visitor signals layer to `/signals/state`, re-key `index.html`, and go
   through the normal GitHub Pages publish-and-verify flow.
7. No new secret or env var is required. `ADMIN_SECRET` (≥16 chars) and
   `LETTER_SALT` already exist; the existing CORS origins already cover
   `minoodar.github.io` and `void.runs-at.dev`.

---

## Local setup and testing

```bash
# 1. Local Worker on its own sandbox D1 (never --remote, never production id)
cd worker/letters
./node_modules/.bin/wrangler dev --local \
  --persist-to ../../.wrangler/signals-local \
  --config wrangler.local.toml --port 8787 --ip 127.0.0.1 \
  --var ADMIN_SECRET:local-dev-signals-secret-not-real

# 2. Serve the repo root so index.html and the admin bundles resolve
node _tmp/admin-static.mjs 8991      # ROOT = process.cwd(); run from the worktree root

# 3. Open the admin surface  (secret above; nothing here touches production)
http://127.0.0.1:8991/index.html?admin=true&local-api=1
#    index.html:8 maps ?local-api=1 to window.__VOID_API_BASE__ = 127.0.0.1:8787

# 4. Suites
node worker/letters/test/phase-a.test.mjs              # 135/135
node worker/letters/test/schema-paths.test.mjs         # 2 pass / 0 fail
SIGNALS_LIVE_URL=http://127.0.0.1:8787 \
SIGNALS_ADMIN_SECRET=local-dev-signals-secret-not-real \
  node worker/letters/test/live-signals-smoke.mjs      # 73/73, sandbox left clean

# 5. Browser probes (real headless Chromium over CDP)
node <skill>/scripts/cdp-run.mjs _tmp/admin-writes-probe.mjs \
  --url=http://127.0.0.1:8991/index.html?admin=true&local-api=1 \
  --port=9361 --width=1440 --height=900 --shots=_tmp/admin-shots
```

Sandbox reset, if a run leaves rows behind: delete them through the admin UI, or
`wrangler d1 execute DB --local --persist-to ../../.wrangler/signals-local
--config wrangler.local.toml --file=...` (local only).

## No production migration or deployment occurred

**No production migration was run, no Worker was deployed, and no production
data, D1 database, R2 bucket, DNS, Cloudflare Pages or hosting configuration was
modified.** All database writes happened in a local sandbox D1 file inside this
worktree (`.wrangler/signals-local`, gitignored). No notification was sent to
any real user; no production message data was read, and none exists. No commit
was pushed and no branch was merged.
