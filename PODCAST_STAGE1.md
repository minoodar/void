# Podcast Stage 1

Owner feedback v2 raises the Podcast visual diameter to `0.85 × d` and adds the
standing-wave halo, antinode, shoulder, dust, voice-sparkle, and listener-halo
details. Variant B remains the default centre node so it rhymes with the orb X.
The 0.85 factor passes the existing nine-viewport layout matrix without changing
the row/triangle fallback, axis invariants, safe zones, or hit-target floor.

## Stage 2A — Podcast window (flag ON only)

The Podcast emblem now opens its own window after the waiting animation; it never
opens the Golden Folder music panel. Files: `podcast-window.js` / `.css` (sibling
glass dialog — Library → Show, two levels), `podcast-sample-data.js` (3 fictional
shows, 14 fictional episodes, no audio), `podcast-store.js` + `podcast-store.test.js`
(subscriptions + progress under `void.podcast.v1`, corrupt-storage safe). The CSS/JS
load dynamically from the flag-ON branch of `void-domains.js`; `index.html` is
untouched. Play buttons only dispatch `podcast:play` and show a marked Stage-2B
placeholder. First run seeds subscriptions plus one partial and one completed
sample progress entry. Open locally: serve the worktree root and visit
`index.html?local-api=1&podcast=1` (local worker on :8787), then Golden Folder →
Podcast emblem.
