# Void Signals — Phase B visual preview (safe first release)

Isolated visual prototype. **Not a production implementation.** No production release,
merge, backend integration or architectural approval is implied. Owner approval is
required before any subsequent production implementation.

## 1. Preview URL

- Local only: **http://127.0.0.1:8970/** (binds 127.0.0.1, never exposed publicly)
- Start: `node signals-preview/preview-server.mjs` (from the preview worktree root)
- Validate: `node signals-preview/validate-preview.mjs --port=8970`
- The server refuses to start if any tracked production file differs from HEAD
  (`git diff --name-only HEAD` + `git status --porcelain`, excluding `signals-preview/`).
  Manifest: `http://127.0.0.1:8970/__preview/manifest`.

No public preview URL was created: publishing one would have required changing the
production GitHub Pages site or adding hosting infrastructure, which §7 forbids.
Per §7 order, the existing isolated preview infrastructure (local static server on a
dedicated worktree) was used instead. DNS, Pages config, Worker routes and secrets
were not touched.

## 2. Isolation mechanism

- Worktree `E:/google chrome extention/_preview/signals-first-visual`,
  branch `preview/signals-first-visual`, base = `origin/main` =
  `404c9b49d050b9e58db05c308ad77cef766bbddc`. Never merged, never pushed.
- Production bytes are served **unmodified from disk**. The preview tags
  (`preview-shim.js`, `signals-layer.css`, `signals-layer.js`, `signals-demo-console.js`)
  are injected **at serve time** into the HTML response only. No production file on
  disk was edited, so no backup of production files was needed.
- `preview-shim.js` sets `window.__VOID_API_BASE__` to `ORIGIN + '/__sim'` and wraps
  `fetch`, `XMLHttpRequest.open`, `navigator.sendBeacon` (blocked) and `WebSocket`
  (remote construction throws). Every `/tracks|/letters|/visitors|/admin|/podcast|…`
  request is answered locally with simulated JSON; non-GET → 405. Audio is a
  locally synthesised 96 s WAV (`/__sim/audio/demo-tone.wav`).
- Verified per viewport: **off-origin network requests = 0**, exceptions = 0,
  console errors = 0. No real user data read, no notifications, no push.
- All new files live under `signals-preview/` and are removable as one directory.

## 3. Files added (all new, none modified)

| file | purpose |
| --- | --- |
| `signals-preview/preview-shim.js` | network isolation + simulated API base |
| `signals-preview/preview-server.mjs` | static server, serve-time injection, `/__sim`, production byte-proof |
| `signals-preview/signals-layer.css` | Signal visual language, instrument, reveal, shelf, scrollbars, reduced motion |
| `signals-preview/signals-layer.js` | isolated placement engine + demo API (`window.VoidSignalsPreview`) |
| `signals-preview/signals-demo-console.js` | permanently visible demo instrument (28 live controls) |
| `signals-preview/build-placement-data.mjs` | builds masks from read-only A1 audit JSON |
| `signals-preview/placement-data.json` | 138,626 B encoded exclusion masks (RLE), frame mapping, primitives, source hashes |
| `signals-preview/validate-preview.mjs` | CDP harness: 3 viewports, full demo loop, sweeps, audits, screenshots |
| `signals-preview/validation/validation-results-v1.json` | machine-readable results |
| `signals-preview/validation/shots/*.png` | 28 screenshots (desktop / tablet / phone) |
| `signals-preview/PREVIEW-REPORT.md` | this report |

## 4. Placement experiment results (experimental, NOT approved geometry)

Live sweep, 14 spawn attempts per rule/threshold, default separation and centre guard:

| rule | desktop 1440×900 | tablet 820×1180 | phone 390×844 |
| --- | --- | --- | --- |
| R-C (REV-3 swept, cycle) @0.05/0.15/0.30 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| R-C2 @0.05/0.15/0.30 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| R-A (analytic disc) | 0 | 0 | 0 |
| R-Cn (natural swept) @0.05/0.15/0.30 | 4 / 12 / 12 | 1 / 1 / 8 | 0 / 0 / 0 |
| R-F (persistent cycle) @0.05/0.15/0.30 | 12 / 12 / 12 | 8 / 8 / 8 | 1 / 6 / 6 |
| R-G (persistent natural) @0.05/0.15/0.30 | 12 / 12 / 12 | 8 / 8 / 8 | 2 / 6 / 6 |
| R-0 (no mask, chrome+centre only) | 12 | 8 | 6 |

- **REV-3 as specified (R-C) places nothing at any measured threshold on any
  viewport**, reproducing the Phase A verdict in a live browser. R-F / R-G fill the
  viewport slot budget (12 / 8 / 6). These thresholds remain *experimental*.
- Rail reservation on/off delta = **0** placed signals on all viewports (matches A1
  K0↔K1), reported both ways as instructed.
- Independent overlap audit after every run: signal footprint vs production chrome
  = **0**, vs galaxy centre guard = **0**, on all three viewports.
- Reveal panel audit: chrome overlaps = 0, covered signals = 0 on all viewports.
- `auditCompare` (48 rule×threshold rows per viewport, instrument lifted out of the
  collision set, A1 cluster size/minGap/order) reproduces A1 exactly for
  R-C/R-C2/R-A/R-B/R-F/R-G/R-0. Remaining deltas are confined to marginal pockets:
  desktop R-Cn ±2, tablet R-Cn 0–1 vs 2–8, phone R-C/R-C2 @≥0.20 and R-Cn (0 vs 1–2).
  Cause: the live preview collides against the *current* chrome (loaded-track dock,
  centre open button, galaxy-stats pill, faded-HUD reservation) and a seeded jittered
  candidate grid, while A1 used its own fixed chrome snapshot and grid. Recorded,
  not smoothed away.
- No-position fallbacks exercised: `hold` (quiet counters + instrument log) and
  `shelf` (edge tray above the reserved dock, chips open the reveal). Neither forces
  a position over chrome or the galaxy centre.

### Placement constraint discovered during Phase B

The production music-mode sweep (`void-music.js` `sweep()`, `void-music.css`
`html.vm-on [data-vm-swept]`) force-hides every visible direct child of `html`/`body`
with inline `display:none !important`. A body-mounted overlay cannot survive it.
The layer therefore mounts **inside `#void-music-root`** (an exempt element), which
also means Signals exist only while the galaxy experience is open — the intended
scope. Playback chrome (`.vm-dock`, `.vm-seek`, `.vm-open`) stays reserved even while
the HUD fades, so a Signal can never land on the seek bar's click area (Podcast Seek
handoff safeguard). The instrument, tab and shelf are offset clear of the production
galaxy-stats pill; on phone the console opens from a tab and yields its band to the
reveal panel, restoring on close.

## 5. Demo controls (§5)

28 live controls in a permanently visible glass instrument (desktop/tablet left rail;
phone: tab → compact top sheet): Ambient, Important, Reveal, Clear all, Play demo tone,
experiment on/off; exclusion rule, brightness threshold, min separation, signal size,
centre guard, fallback mode, candidate order, companions, rail reserve, footprint
boxes, centre guard overlay; entrance ms, ambient lifetime, glow, reduced motion,
auto demo; reset, randomize, export JSON, sample perf, compare-with-A1; live readout
(placed/held/rejected/collisions/fps/cpu/viewport/scale) and a 24-row event log.
All apply instantly; seed 20261126 makes runs reproducible.

## 6. Validation (§8)

- 3 viewports: 1440×900, 820×1180, 390×844 — full demo loop completed on each
  (spawn → reveal → close → REV-3 fallback → shelf/hold → 18-case sweep → rail both
  ways → sliders/toggles → reduced motion → auto demo → off/on → randomize/export/
  reset/fill). 28 screenshots in `validation/shots/`.
- OS-level `prefers-reduced-motion: reduce` emulated via CDP on all viewports:
  breath/ring animations `none`, transitions 1 ms, layer config auto-switches.
- Production test suites, run in the preview worktree, all pass:
  podcast-player-controller **236**, podcast-player **61**, void-music-owner **53**,
  void-music-guest **192**, podcast-layout **386**, podcast-store **218**,
  podcast-publish-mock **114**, void-podcast-thread **62**, podcast-feed **36/36**.
- Galaxy + Music interface verified working with the simulated tone (camera cycle
  runs, dock/seek/HUD render, playback controls untouched).
- Console errors 0, page exceptions 0, off-origin requests 0 on every viewport.

## 7. Performance observations

Headless Chromium with SwiftShader (software rasteriser, no GPU): renderer reports
fps ≈ 10.6–11.8 desktop, ≈ 10.5–10.9 tablet, ≈ 15.0–16.7 phone, quality tier 0
(the production software fallback), frame CPU 1.2–3.8 ms. These figures are the
software-rendering baseline of the existing renderer, not a regression: the Signals
layer adds **no requestAnimationFrame loop and no polling** — entrance, breath, ring
and reveal are CSS transform/opacity animations; timers are bounded and cleaned up;
listeners are registered once and removed by `destroy()`. Mask lookups are O(1)
bit/RLE reads; candidate fields are cached per geometry+config key.

## 8. Production untouched — explicit confirmation

- `git diff --name-only HEAD` in the preview worktree: **empty**; the only untracked
  path before commit was `signals-preview/`.
- Server byte-proof at every start: 96 tracked files checked, **0 modified**.
- Main worktree `void-galaxy-music-main`: clean, HEAD `5eba39c` (unchanged).
- `origin/main` still `404c9b49d050b9e58db05c308ad77cef766bbddc`.
- No Worker code, D1, R2, API contract, playback implementation, Letters behaviour,
  notification, push message, environment variable, DNS or hosting change was made.

---

# Iteration 2 — persistent messages, session read state, Void Star Studio

Branch `preview/signals-first-visual`, built on iteration-1 commit `44a70f684f3e49af3a5a08c59e9508710917ce6e`.
Iteration-1 files were copied to `signals-preview/_iteration1-backup/` before any edit; the
prototype was extended in place, not recreated. Per the brief, the 28-control campaign and the
production suites were **not** re-run — their recorded results are reused (§6 above, carried into
`reusedFromIteration1` in the new results file), and only the changed behaviour was tested.

## 9. Permanent message availability (§2)

Message lifetime is now separate from presentation. Ambient, Important and Notification Center
messages all default to `lifeMs: 0` — persistent until server expiry or administrative removal —
so reading can never consume one. The 10-step contract is demonstrated with real mouse clicks in
headless Chrome at 1440×900 and 390×844: appear at initial brightness → click → window opens →
window survives 9 s of page time, a viewport resize, unrelated spawns and rule changes, glyph
expiry (`lifeMs` 2500 ms while the window is open) and clicks on empty sky → close control closes →
same star becomes dim but stays hit-testable → clicking it again reopens the original text and
states `re-read · read this session`.

One genuine defect was found and fixed here: Escape was registered on `document`, while the
production player claims Escape on `document` **in the capture phase** to leave Music Mode
(`void-music.js:2640`). Closing a message with Escape therefore also tore down the whole
experience — `#void-music-root[hidden]`, and with it the galaxy signals and the instrument. The
layer now takes Escape on `window` capture and stops it, the same convention `void-invite.js:162`
documents for its share sheet. A regression check asserts the root is still laid out
(`rootHidden:false`, width 1440/390) after an Escape close. Clicking outside the window remains a
no-op by design, and `store.remove()` is the only path that makes a message disappear (verified:
6 → 5, gone from both views).

## 10. Session-scoped read state (§3)

`signals-preview/message-store.js` owns three separate concerns: message lifetime (server fields),
read state (current site session only) and visual state (a class the renderer reads). Storage is
`sessionStorage` only — `void-sig-session-v1` holds the session id `site-…`, `void-sig-read-v1`
holds a JSON array of stable `m-…` message ids and nothing else. Proven in-page: the stored value
is `["m-20261126-i2"]` (no whitespace, no title-like strings, no body keys), a message read before
a reload comes back dim under the same id while an unread one stays bright, and `resetSession()`
restores initial brightness for every still-valid message without deleting any. Nothing is written
to D1 and no endpoint was added. Titles and array positions are never used as identity.

## 11. Notification Center parity (§4)

The Center and the Galaxy render the same `messages()` list — the audit compares row count against
store count and finds no copies and no second lifecycle. A read from either view dims the same
star; `markUnread()` repaints the Center without a manual refresh (fixed by having the layer's
store subscription call `refreshReadStates()` plus the instrument's `onchange`, `signals-layer.js:1172`);
opening from a Center row and closing, then clicking the star, reopens the identical id and title.

## 12. Void Star Studio (§5–§7)

A third tab is injected into the existing `?admin=true` Notification Management interface, so the
section sits beside the current tabs rather than replacing them. Controls: 4 star styles, 5 colours,
8 arrangement presets (Organic, Constellation, Circular, Spiral, Geometric, plus Heart, Star and a
disabled "custom" slot), 7 sliders split into Appearance and Motion, an experimental on/off switch,
per-event-type scopes (Ambient / Important), Reset to default, side-by-side preset comparison and a
JSON readout. Badges state `Preview only`, `sessionStorage · cleared when the tab closes` and
`no Worker, no D1, no R2, no production config`; changes apply on the next input event with no save
button, and nothing leaves the page.

`signals-preview/star-config.js` keeps the six responsibilities of §7 separated: the event engine,
the lifecycle and the session read set never see presentation, and appearance is a layered model
(defaults ← `global` ← `profiles.byType`, with `occasion` and `timeBased` reserved but unimplemented
in this iteration) written to `void-star-config-v1` and rendered as `--ss-*` custom properties.
Verified: a per-type glow override layers under a global colour; the message record keys stay
`body, createdAt, demo, expiresAt, id, readInSession, title, type` — no preset or glow field can leak
into message content; and the control room contains no galaxy host, instrument or reveal node.

## 13. Visual quality and placement re-measured (§8)

Deep-black field, restrained gold/silver/ice palettes, CSS transform/opacity only, reduced motion
honoured from both the instrument and the OS media query. The dim state measures opacity **0.52**
(well above the "must not disappear into pure black" floor) with `pointer-events: auto`; the reopened
star reaches 1.0, which is the "star awakening again" read the brief asked for.

Honest note on the invariant: iteration-1's `overlapAudit` recorded `signals = 0`, so it proved
nothing about collisions and could not be reused as evidence. It was replaced with a per-star audit
that mirrors the engine's own test (each point of a cluster at `size/2 + STAR_PAD`) against
**visible** chrome only, with decorative halo touches reported separately. Both viewports: `blocked: []`,
`centreOverlaps: 0`, `revealOverSeek: false`, and the engine's own `counters.chrome = 0`. The Podcast
Seek handoff constraint holds — no signal footprint overlaps `.vm-seek`.

## 14. Iteration-2 validation

`node signals-preview/validate-iteration2.mjs --port=8970` → **114 checks, 114 pass, 0 fail**
(desktop 1440×900, phone 390×844, admin/Star Studio), 19 screenshots in
`signals-preview/validation/shots2/`, results in
`signals-preview/validation/validation-results-iteration2.json` with the pinned `head`, the byte
proof (`productionFilesModified: 0` over 96 tracked files) and the reused iteration-1 record.
Off-origin requests: 0. Uncaught exceptions and console errors: 0 in every context.

Two CDP facts were learned while building it and are worth recording for the next harness: a DOM
`keydown` from `Input.dispatchKeyEvent` needs `type:"rawKeyDown"` carrying `key`, `code` **and**
`windowsVirtualKeyCode`/`nativeVirtualKeyCode` (`type:"keyDown"` alone delivered nothing here, and a
raw frame without `key` produces an `e.key`-less event), and a probe listener for a key the overlay
consumes must be registered on `window` capture, since `stopPropagation` halts the document-level
listeners.