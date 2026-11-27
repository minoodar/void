# Unified Admin Control Center — Owner Review Handoff

Prepared 2026-11-27 on `feature/admin-unified-experience`. The review pass below was written while
the work was local-only; §7 records what has since been released to production.

## 1. Git state

| Item | Value |
| --- | --- |
| Latest `origin/main` at review time | `fbbc3f7` — *fix: stabilize podcast artwork and polish glass menus* |
| Branch for this review | `feature/admin-unified-experience` |
| HEAD | merge commit `d876ea5` (*Merge origin/main (podcast artwork stability + glass menus) into the unified admin release branch*) |
| Safety reference before reconciling | branch `safety/admin-pre-reconcile-20261127` and tag `audit/admin-pre-reconcile`, both at `c8e2504` |
| Safety reference before releasing | branch `safety/admin-pre-release-20261127` and tag `release/pre-production-1ae8f53`, both at `1ae8f53` |
| Working tree | clean except untracked `_tmp/` (scratch probes, never committed) |

The admin branch was based on `404c9b4`. `origin/main` had moved ahead twice since; both moves are
now integrated by merges (`e68d46e` for `8dd256a`, `d876ea5` for `fbbc3f7`), each with **no
conflicts** — neither side touched a file the admin work touched
(`git diff --name-only` overlap was empty both times).

Integrated from Podcast work:

| Commit | What it brings |
| --- | --- |
| `93fc2f5` | publisher homepage links on the podcast show header |
| `0332bc5` | merge of PR #11 (release/podcast-homepage-links-20261126) |
| `cb69bb2` | backfill of podcast publisher homepage links |
| `8dd256a` | merge of PR #12, plus `podcast-backfill.test.mjs` |
| `fbbc3f7` | podcast artwork stability through load/rotate/rerender, and the accepted Podcast glass menus |

Files that moved: `podcast-feed.js`, `podcast-store.js`, `podcast-window.js/.css`,
`podcast-emblem.js/.css`, `podcast-layout.js`, `podcast-thread.css`, `podcast-player.js`,
`void-domains.js/.css`, `void-glass.css`, `index.html`, plus the podcast test suites.

## 2. Podcast work deliberately left out

* `fab5a39 podcast-voice-thread-phase1` and `2c04ca1 / c865bf2 preview/podcast-galaxy-ui` are
  **already ancestors of `origin/main`** (`git merge-base --is-ancestor` confirmed for each), so there
  was nothing to integrate and nothing to re-accept. The audio-ownership rules the Voice Thread was
  rejected against are unchanged in this branch: Music owns `new Audio()` in `void-music.js:626`,
  Podcast owns its own `document.createElement('audio')` in `podcast-player.js:173`, and the browser
  pass below proves `VoidPodcastPlayer` never adopts `VoidMusic.getAudio()`.
* `f07023d fix: stabilize podcast artwork rendering` (branch `feature/podcast-artwork-stability`,
  pushed to origin, **not merged into main**) is excluded. It is a clean descendant of `origin/main`,
  so it can be merged or cherry-picked without conflict whenever the owner accepts it. It also removes
  the artwork-as-link behaviour that `93fc2f5` just shipped, which is a product decision for the
  Podcast owner, not the admin panel.
* Podcast menu glass styling is **integrated, not invented here**. It arrived on `origin/main` via
  `fbbc3f7` and came with its own tests (`D3: the glass menus preserve placement and sizing with
  restrained Podcast-only styling`), so the admin branch took it by merge rather than restyling the
  same files from a second direction. The admin panel still touches none of it: every admin style is
  scoped under `#void-admin-root`.

## 3. Admin architecture preserved

Three peer modules, one shell, unchanged boundaries: **LETTERS · MUSIC · VOID SIGNALS**
(`void-admin.js` `registerBuiltins` + `void-signals-admin.js` section registry). No module internals
were rewritten for this merge; the only admin-side code changes in this session were the two phone
touch-target media blocks and the `index.html` asset re-key, both already committed at `c8e2504`.
Authentication is still the single shared `ADMIN_SECRET` with the existing session-token handling.

## 4. What was tested

Node suites, run against the merged tree:

| Suite | Result |
| --- | --- |
| `worker/letters/test/phase-a.test.mjs` | **135/135** (letters, tracks, visitors, all Signals routes) |
| `podcast-feed.test.js` | **37 pass / 0 fail** |
| `podcast-store.test.js` | **247 assertions passed** |
| `podcast-backfill.test.mjs` (new from main) | **10 pass / 0 fail** |
| `tests/podcast-ux.test.mjs` | **29 pass / 1 fail** — the failure is `keys: every changed asset is keyed away from its HEAD key`, which fails identically on a clean `origin/main` checkout (verified in a throwaway worktree). It is a pre-commit guard that only passes while podcast files have uncommitted edits. |
| `tests/letters-api.test.mjs` | **47/48** — pre-existing `visitorStats … negative sessions clamp to 0`, unrelated and unchanged |

Browser passes (headless Chrome over CDP against the local Worker + local D1; screenshots in
`_tmp/admin-shots/`):

| Probe | Result |
| --- | --- |
| `_tmp/admin-shell-probe.mjs` | 48/48, 0 exceptions, 0 console errors, 0 writes |
| `_tmp/admin-letters-music-probe.mjs` | 48/48 |
| `_tmp/admin-writes-probe.mjs` (Signals lifecycle + Star Studio save/activate) | 46/46 |
| `_tmp/admin-mobile-nav-probe.mjs` (390×844) | 19/19 |
| `_tmp/owner-review-walkthrough.mjs` (seeded data, all three modules, 1440×900 + 390×844) | **25/25**, 0 exceptions, 0 console errors, 2 admin POSTs both to `127.0.0.1:8787` |
| `_tmp/podcast-music-merged-probe.mjs` | 13/14 — the one FAIL was my probe's own selector for the domain bar, re-proven by the next line |
| `_tmp/emblem-click-probe.mjs` | 5/5 — four-icon selector renders `inner/flow/beyond/podcast`, emblem click opens the podcast window, no write traffic |

Auth behaviour observed against the running Worker: no credential → `401`, wrong secret → `403`,
correct secret → `200`. The secret never appears in the DOM, a cookie, or `localStorage`; it stays in
`sessionStorage['voidAdmin.token.v1']`.

## 5. Data seeded for the review

The local database had been emptied by the write tests, so the panel would have shown only empty
states. `_tmp/seed-local-demo.mjs` adds clearly-labelled rows through the real admin API:
3 Golden Folder tracks, 2 letters (one Persian), 5 signals covering `draft / active / scheduled /
hidden / revoked`, and one Star Profile `DEMO · Gold Bloom` with saved v2 while v1 is public, assigned
globally. `node _tmp/seed-local-demo.mjs --clear` removes exactly those rows again. Track audio paths
are placeholders (`demo/local-tone-*.mp3`) — the list, dialogs, reorder and domain rows are demoable,
but pressing play on a demo track will not produce sound.

## 6. Known limitations for this review

* Signals is admin-side only. The public page still renders no Signals layer, and
  `signals-preview/preview-server.mjs` has no live-API mode. That is the deferred integration item,
  not a defect in the panel.
* One shared local secret, no roles, no 2FA — as scoped for this owner-operated version.
* `created_by` is a self-declared label, not an identity; admin writes are not rate-limited (only
  failed logins are, 10/hour per hashed /64 IP).
* The artwork-stability fix and the Podcast glass menus are in this branch by merge from
  `origin/main` (`fbbc3f7`); `f07023d` from `feature/podcast-artwork-stability` is still separate
  (see §2).

## 7. Production release (2026-11-27)

* Database: a full production export was taken before any change —
  `E:\google chrome extention\_backups\void-galaxy-music-20261127-signals-pre-production\void-galaxy-letters-db-559070d9-pre-signals.sql`
  (101,993 bytes, md5 `79d842997e8a458b3c94369ed8dea0d9`, 21 tables, 461 data rows).
  `BACKUP-INFO.txt` beside it records the database id and export id.
* Migration: `worker/letters/migrations/2026-11-26-void-signals.sql` applied to
  `DB` = `559070d9-afb4-471e-8839-78866e9437a1` (version `production`) only. It is additive:
  19 objects all guarded by `IF NOT EXISTS`, no `DROP`/`ALTER`/`TRUNCATE`, and the only
  `UPDATE`/`DELETE` keywords are foreign-key clauses on the new tables and trigger bodies that
  bump the new `signal_state` singleton. Post-apply check: 5 tables, 6 named indexes, 8 triggers,
  and the pre-existing counts unchanged (13 letters / 17 tracks / 236 visitors / 29 daily /
  24 votes). `signal_messages` and `star_profiles` are empty, `signal_state.version` is 0, so the
  release activates no public notification behaviour by itself.
* Worker: `void-galaxy-letters` was already at the `fbbc3f7` state. The release version is recorded
  in the final report; the production `ADMIN_SECRET` and `LETTER_SALT` bindings were left exactly as
  found (their values were never read or printed).
* Public scope: the Galaxy notification client wiring stays out of this release, so visitors see no
  Signals layer. `/signals/*` is live but read-only and returns nothing until the owner publishes a
  message from the panel.
