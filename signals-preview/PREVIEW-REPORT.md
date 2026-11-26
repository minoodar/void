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