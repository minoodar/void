# VOID ADMIN — Phase 1 Current-State Audit

Audited on 2026-11-27 against the working tree of worktree
`E:\google chrome extention\_feature\signals-operational-infrastructure`.

| Item | Value |
| --- | --- |
| Branch at audit start | `feature/signals-operational-infrastructure` @ `fccbfdc` |
| New working branch | `feature/admin-unified-experience` (created from `fccbfdc`) |
| Iteration-2 visual baseline | `79339d3` — tagged `iteration3-baseline` |
| Production `main` | `5eba39c` (untouched, not merged into, not pushed to) |
| Remote | `origin https://github.com/minoodar/void.git` — never pushed from this work |
| Working tree at audit | clean except untracked `_tmp/` (scratch, excluded from commits) |

Nothing below is assumed from earlier reports: every claim names a file and, where it
matters, a line number that was re-read during this audit.

---

## 1. Current architecture

One Cloudflare Worker, one D1 database, one static frontend.

```
index.html  ── loads ─▶ void-letters-api.js (BASE)  ── HTTPS ─▶ void-galaxy-letters Worker ─▶ D1 "DB"
  │                     void-admin.js   (Letters + Music + Domains)
  │                     void-music.js / void-music-viz.js (playback, galaxy, seek bar)
  │                     void-domains.js, podcast-*.js, void-letters.js …
  └─ ?admin=true ─────▶ admin overlay #void-admin-root (body.void-admin-on hides everything else)

signals-preview/  ── served only by preview-server.mjs, injected at serve time ──▶
      preview-shim.js → message-store.js → star-config.js → signals-layer.js
      → signals-demo-console.js → star-studio.js
```

* The Worker is a single flat `if (url.pathname === X && method === Y)` chain
  (`worker/letters/worker.js`, 3050+ lines, no router, no dependencies).
* `index.html:8` sets `window.__VOID_API_BASE__ = 'http://127.0.0.1:8787'` when the URL
  carries `?local-api=1|true`; `void-letters-api.js:8` and `void-admin.js:135-139` both
  honour it. **A local-Worker admin session needs no HTML change** —
  `index.html?admin=true&local-api=1` is already the correct entry point.
* The Signals preview is *not* part of `index.html`. It exists only as tags injected at
  serve time by `signals-preview/preview-server.mjs:73-89`, and that server refuses to
  boot when any production file differs from `HEAD` (`preview-server.mjs:33-71`,
  `process.exit(3)` at L70).

## 2. Existing module entry points

| Surface | Entry point | Notes |
| --- | --- | --- |
| Admin shell | `void-admin.js:1186-1329` (`TEMPLATE`), `boot()` L1512-1523 | Injects `#void-admin-root`, adds body class `void-admin-on` |
| Auth | `onLogin` L325-358, `verifyStoredToken` L360-383, `lock` L314-323, `api()` L215-249 | secret in `sessionStorage['voidAdmin.token.v1']` only (L12); verified against `/admin/session`; 20 s abort timeout (L15) |
| Tabs / views | `setView()` L402-411, `onTabKey()` L413-419, bound L1427-1428 | **binary**: anything not `'letters'` collapses to `'music'` |
| Letters module | `lettersPath()` L882-889, `loadLetters()` L896-919, `renderLetters` L927, `letterRow` L944, `onLetterRowsClick` L1080, `deleteLetter` L1094, reset dialog L1120-1160 | `/admin/letters`, `/admin/letters/:id` DELETE, `/admin/letters/clear` |
| Music module | `loadTracks()` L436+, track dialog, reorder, `/admin/tracks*` | Golden Folder playlist |
| Music Domains | `loadDomainAdmin()`, `#va-domains-*` markup L1231-1237, routes `/admin/domain-*` | manual INNER/FLOW/BEYOND assignment + audit history + accept/undo |
| Shared dialogs | `va-track-dialog`, `va-confirm-dialog`, `va-reset-dialog` (L1279-1327), `askConfirm()` L1165-1173, `settleConfirm()` L1175-1180, `toast()` → `#va-toasts` L1328 | already generic enough to reuse |
| Signals public layer | `signals-preview/signals-layer.js:10-124` | `#signals-root` host; **returns early under `?admin=true` (L124)** so the admin page never mounts a galaxy layer |
| Signals admin prototype | `signals-preview/star-studio.js:41-86` | DOM-hijacks the shell: needs `#va-app`, `.va-tabs`, `#va-panel-letters`, watches their `hidden` attributes (L72-82) because editing `void-admin.js` was out of scope in Iteration 2 |
| Signals demo data | `signals-preview/signals-demo-console.js:374-387` | auto-seeds 2 ambient + 1 important demo messages, and hosts the Notification Center (`renderCenter()` L140-175) |

## 3. API ownership and dependencies

| Area | Owner | Auth | Status |
| --- | --- | --- | --- |
| Letters, tracks, visitors, site updates | `worker/letters/worker.js` (`DB` binding) | `adminAuthorized()` single guard in `fetch` | **operational in production** |
| Music Domains | same Worker, `MUSIC_DOMAINS_ENABLED` | same guard | **operational in production** |
| Void Signals public reads | `/signals/version`, `/signals/messages`, `/signals/messages/:id`, `/signals/profile`, `/signals/state` | none (GET only, `Cache-Control: no-store`) | **implemented + verified, not yet deployed** (branch only) |
| Void Signals admin | `/admin/signals/messages[/:id][/transition]`, `/admin/signals/profiles[/:id][/activate|/restore|/duplicate|/versions]`, `/admin/signals/assignments` | same `adminAuthorized` Bearer secret | **implemented + verified, not yet deployed** |
| Signals frontend | — | — | **still simulated**; zero calls to the real API (see §5) |

Server data contract that the UI must respect:

* ids are `/^[0-9a-f]{32}$/` (worker.js L1838); the preview store mints `m-…`/`site-…`/`sig-…`
  (`message-store.js:44-45,127`) and `validate-iteration2.mjs:156` asserts `/^m-/`.
* timestamps are **unix seconds** (`signalNowSec`, L1903); `message-store.js:108,110` and
  `signals-layer.js:707` treat them as **milliseconds**. Conversion belongs at the client edge.
* `importance ∈ {ambient, important}` maps onto the existing renderer field `type`
  (`signalPublicRow`, L2046-2061); `category ∈ {general, release, event, milestone, maintenance}`
  is a separate axis the preview model does not have yet.
* profile settings are exactly the 11 `star-config.js:28-40` keys with identical ranges
  (`SIGNAL_PROFILE_RANGES`, L1882-1886) plus `schema:1`; the server has no `experimental` or
  `activeProfile` concept, and refuses any presentation key inside message `metadata`
  (`presentation_belongs_in_a_profile`).
* admin rows add `status`, `state_version`, `created_at`, `updated_at`, `scheduled_at`,
  `created_by`, `expired`, `eligible`, `next_transition` (L2063-2077) — `next_transition`
  lists *target statuses*; the verbs the API accepts are `publish | schedule | hide | revoke | reopen`
  (`SIGNAL_TARGETS`, L1846-1848) where `publish` is the restore-from-hidden action and `reopen`
  means "back to draft" (expired rows only). The UI must not invent its own mapping.

## 4. UI inconsistencies and duplication

1. **Two-tab assumption is structural, not cosmetic.** `setView` (L402-411) hard-codes two
   booleans and `onTabKey` (L413-419) toggles between the same pair; `cacheDom` caches
   `tabMusic`/`tabLetters`/`panelMusic`/`panelLetters` (L1343-1348). A third module cannot be
   added without replacing this with a list-driven shell.
2. **Star Studio is attached by side effect.** `star-studio.js` inserts its tab into
   `.va-tabs` and its panel after `#va-panel-letters` (L57-65), then polls the other panels'
   `hidden` attributes to get out of the way (L72-82). This is duplicated navigation logic that
   the shell should own, and it breaks the moment the tablist becomes data-driven.
3. **Three separate implementations of the same controls.** Sliders exist in
   `star-studio.js:235-255` and `signals-demo-console.js:178-214`; a list/table pattern exists
   in `void-admin.js` (`va-table`, `letterRow`) and again as `#signals-nc-list` rows
   (`signals-demo-console.js:140-175`); "empty" text exists as `.va-empty` (TEMPLATE L1239, L1268)
   and as separate strings inside the preview panels. Loading state is `is-busy` on the tracks
   list (L438) but a plain badge in the preview. Feedback is `toast()` in the admin versus a
   `sig-log` console in the preview (`signals-demo-console.js:284,361-370`).
4. **Divergent badge/label vocabulary**: "Preview only · sessionStorage · no Worker, no D1,
   no R2" (studio panel badges L120-124, footer L224-226) contradicts what the Signals module
   will now actually do and must be replaced by real connection/version state.
5. **CSS is already well scoped — keep it that way.** `void-admin.css` is entirely under
   `#void-admin-root` (L10-44) with tokens `--va-fg/-dim/-faint/-line/-line-hi/-panel/-solid/-gold/-rose/-mint`
   (L15-25); the only page-level rules are `body.void-admin-on` visibility (L6-7). A grep for
   bare element selectors in `signals-preview/signals-layer.css` and `star-studio.css` returns
   nothing — both are class/id scoped. New admin styles must reuse `#void-admin-root` scoping
   and the `--va-*` tokens, not introduce a second palette.

## 5. Functional gaps

| Gap | Evidence |
| --- | --- |
| The Signals admin UI does not exist. No file under the repo root references `/signals` or `/admin/signals`. | `void-admin.js` has no signals code; `grep` for `admin/signals` matches only `worker/letters/*` |
| Message content is fabricated in the browser. | `message-store.js:66-79` demo pools, `demoFor()` L122-132, seeded by `signals-layer.js:563` |
| Star settings persist to sessionStorage only; "save" never reaches a server and there is no Save/Activate control at all. | `star-config.js:73-87,165-207`; studio action row `star-studio.js:204-212` has only Reset / Copy JSON / a link |
| No profile identity, versioning or activation concept in the frontend. | `star-config.js` stores one object under `void-star-config-v1` (L25); `activeProfile` is a free string (L188) |
| No configuration refresh for visitors: the layer fetches exactly one URL, its placement JSON. | `signals-layer.js:1187-1200` is the only `fetch` in the file |
| The preview server cannot talk to a real Worker: the shim rewrites every `/signals`, `/admin`, `/tracks`… path to `/__sim` (`preview-shim.js:11-23`), `sim()` has no signals branch so `/__sim/signals/messages` falls through to the empty stub (`preview-server.mjs:117`), and all non-GET is 405 (L158/L170). | line refs as listed |
| Serving a modified tree is blocked by design: the byte-proof exits 3 if any production file differs from `HEAD`. | `preview-server.mjs:33-71` |
| Music module has no internal section navigation; the domains block is inlined in the music panel. | TEMPLATE L1221-1240 |
| `?admin=true` gating is duplicated in three places and one of them is load-bearing for the public page: `void-admin.js:8`, `index.html:930-931` (skips `VoidMusic.enter()`), `signals-layer.js:124`, `star-studio.js:18`. | refs as listed |

## 6. Integration risks

1. **Byte-proof vs. an edited `void-admin.js`.** Once the shell is refactored,
   `preview-server.mjs` will refuse to start, and `validate-iteration2.mjs` /
   `validate-preview.mjs` (which both need that server) will be unable to run. Mitigation:
   an explicit `--allow-dirty` mode that *reports* drift instead of exiting, so the
   production-byte guarantee stays available for public previews and the admin work is still
   testable. Both modes must be documented; neither may publish anything.
2. **The admin overlay hides the page it styles.** `body.void-admin-on > *:not(#void-admin-root)
   { visibility: hidden !important }` (`void-admin.css:7`) means the Star Studio preview must be
   rendered *inside* `#void-admin-root`; a preview that relies on `#signals-root` would be invisible.
3. **Escape handling.** The player claims Escape on `document` capture; the message layer
   intercepts it earlier on `window` capture (`signals-layer.js:1149-1154`). The admin shell has
   no global keydown handler today (only per-element, L1427-1428, L1460) and must keep it that way,
   or it will start stealing Escape from dialogs. `<dialog>` elements already own Escape; do not
   add a shell-level Escape handler that closes panels.
4. **Podcast/Music seek ownership.** `.vm-seek` is created and pointer/keyboard-owned by
   `void-music.js:1201,1449,2542-2577`; the signals layer avoids it via `CHROME_SEL`
   (`signals-layer.js:281-285`) and the shelf clamp (L629-632), asserted by
   `validate-iteration2.mjs:490`. Any admin layout change must not touch the public dock, and the
   studio preview must not create a second seek control.
5. **Unit/id mismatches** listed in §3 will silently break "same stable ID in Galaxy and
   Notification Center" if the client edge does not normalise them.
6. **Stale-snapshot storms.** Every admin mutation can return 409 `stale_snapshot`
   (`expected_version`) or 409 `profile_not_active` / `profile_in_use` / `active_limit_reached`.
   The UI must surface these as "the server says the row moved, reload this section" and never
   report success before the response is read.
7. **Rate limiting.** Admin auth failures are capped at 10/hour per hashed /64 IP; a UI that
   retries a wrong secret in a loop would lock the operator out. Login stays manual
   (`onLogin` L325-358), and no section may auto-retry an unauthenticated request.
8. **Two `activeProfile` meanings.** The old sessionStorage model calls the field
   `activeProfile`; the API calls the published version `active_version`. Keep the names distinct
   in the new UI or the preview/activate distinction becomes unreadable.
9. **Pre-existing failure baseline.** `tests/letters-api.test.mjs` reports 47/48 with
   `visitorStats … negative sessions clamp to 0: expected 0, got null`. Reproduced identically at
   baseline `79339d3` (throw-away detached worktree) and on `main` @ `5eba39c`. Unrelated to this
   task; must stay reported separately, not "fixed" as part of a UI change.

## 7. Recommended implementation sequence

1. **API client first** (`void-signals-api.js`): one place that knows paths, snake_code errors,
   second↔millisecond conversion, and `expected_version`. Everything above it stays declarative.
2. **Shell refactor** (`void-admin.js`, `void-admin.css`): module list + section list +
   `VoidAdminShell.registerModule()`, roving tabindex, remembered module/section, lazy
   per-module loading. Music/Letters markup moves into sections without touching their logic.
   Re-run the existing admin-dependent suites here — they must stay green before any new module lands.
3. **Signals module: data sections** (Overview, Notification Management, Scheduling, Active
   Signals, History & Recovery) — read-heavy, proves auth + list + transition wiring end to end.
4. **Star Studio + Profiles** (the write-heavy part): instant local preview, explicit
   Apply/Activate, version list, restore, assignment, reset-to-active.
5. **Public layer live wiring** + `preview-server.mjs` `--api` / `--allow-dirty`, so the Galaxy
   and Notification Center render real rows with 32-hex ids while read state stays session-only.
6. **Validation**: CDP browser pass at 1440×900 / 768×1024 / 390×844, screenshots, cross-module
   and security checks, then the existing iteration-2 suite reused as regression evidence.
7. **Reports** (`IMPLEMENTATION-REPORT.md` here, plus the pending Iteration-3 operational report)
   and a local commit on `feature/admin-unified-experience`.

Deliberately **not** in scope: any Worker/D1 change (the backend is already committed and
verified), Browser Push, automatic domain classification, deployment of any kind, and any edit to
Music/Podcast playback internals or the shared seek handler.
