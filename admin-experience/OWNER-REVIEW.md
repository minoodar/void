# Unified Admin Control Center — Owner Review Handoff

Prepared 2026-11-27 on `feature/admin-unified-experience`. Local work only: nothing was pushed,
merged into a remote branch, deployed, or applied to production.

## 1. Git state

| Item | Value |
| --- | --- |
| Latest `origin/main` at review time | `8dd256a` — *Merge pull request #12 from feature/podcast-homepage-backfill-integration* |
| Branch for this review | `feature/admin-unified-experience` |
| HEAD | merge commit `e68d46e` (*Merge origin/main … into the unified admin branch*) |
| Safety reference before reconciling | branch `safety/admin-pre-reconcile-20261127` and tag `audit/admin-pre-reconcile`, both at `c8e2504` |
| Working tree | clean except untracked `_tmp/` (scratch probes, never committed) |

The admin branch was based on `404c9b4`; `origin/main` had moved 4 commits ahead. Those 4 commits
are now integrated by the merge, with **no conflicts** — none of them touched a file the admin work
touched (`git diff --name-only` overlap between the two sides was empty).

Integrated from Podcast work:

| Commit | What it brings |
| --- | --- |
| `93fc2f5` | publisher homepage links on the podcast show header |
| `0332bc5` | merge of PR #11 (release/podcast-homepage-links-20261126) |
| `cb69bb2` | backfill of podcast publisher homepage links |
| `8dd256a` | merge of PR #12, plus `podcast-backfill.test.mjs` |

Files that moved: `podcast-feed.js`, `podcast-store.js`, `podcast-window.js/.css`, `void-domains.js`,
`tests/podcast-ux.test.mjs`, `podcast-backfill.test.mjs`, `podcast-feed.test.js`, `podcast-store.test.js`.

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
* Podcast menu glass styling is **not** in this branch. `podcast-window.js` currently has uncommitted
  in-flight edits in `E:\google chrome extention\_preview\void-galaxy-music-podcast-ui` (share-popover
  placement), so that file pair belongs to the Podcast UI agent. The admin panel touches none of it:
  every admin style is scoped under `#void-admin-root`, so a glass restyle of the podcast menus cannot
  conflict with this work.

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
* The artwork-stability fix and the podcast menu glass pass are not in this branch (see §2).
