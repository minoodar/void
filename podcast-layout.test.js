/* Phone-width layout correction — pure-engine test matrix.
   Orb inputs are derived per viewport from the existing visualizer geometry
   (resizeGL: portrait vw/vh < 0.8 -> cy = .40*vh, scale = vw*.92;
    landscape cy = .45*vh, scale = min(vw*.44, vh*.95); Ro = .11*scale),
   never from fixed pixel constants. Footprints are the real measured
   getBoundingClientRect sizes from the local Chrome run (2026-11-16);
   minD rows are synthesized from the measured label heights at lw=92,
   iconic rows use the adapter's icon-only button size max(44, iconD).
   Feature OFF behaviour is verified by diff, not by this file (pure engine only). */
'use strict';
const assert = require('assert');
const fs = require('fs');
const { computeLayout, LANDSCAPE_REQUIRED, IDS } = require('./podcast-layout.js');

const GAP = 8, MIN_HIT = 44;
const EPS = 1e-6;

/* Measured d0 footprints per viewport: [w, h, iconD, iconOffsetY] per id. */
const M = {
  '1920x1080': { rightSafe: 62,
    full: { inner: [104, 174.8, 104, -35.4], flow: [104, 174.8, 104, -35.4], beyond: [104, 191, 104, -43.5], podcast: [104, 129.5, 88.4, -20.5] },
    nodesc: { inner: [104, 125.8, 104, -10.9], flow: [104, 125.8, 104, -10.9], beyond: [104, 125.8, 104, -10.9], podcast: [104, 110.1, 88.4, -10.9] } },
  '1366x768': { rightSafe: 62,
    full: { inner: [92.2, 162.9, 92.2, -35.4], flow: [92.2, 162.9, 92.2, -35.4], beyond: [92.2, 179.2, 92.2, -43.5], podcast: [92.2, 119.4, 78.3, -20.5] },
    nodesc: { inner: [92.2, 113.9, 92.2, -10.9], flow: [92.2, 113.9, 92.2, -10.9], beyond: [92.2, 113.9, 92.2, -10.9], podcast: [92.2, 100.1, 78.3, -10.9] } },
  '1280x720': { rightSafe: 62,
    full: { inner: [92, 157.2, 86.4, -35.4], flow: [92, 157.2, 86.4, -35.4], beyond: [92, 173.4, 86.4, -43.5], podcast: [92, 114.5, 73.4, -20.5] },
    nodesc: { inner: [92, 108.1, 86.4, -10.9], flow: [92, 108.1, 86.4, -10.9], beyond: [92, 108.1, 86.4, -10.9], podcast: [92, 95.2, 73.4, -10.9] } },
  '768x1024': { rightSafe: 62,
    full: { inner: [92.2, 162.9, 92.2, -35.4], flow: [92.2, 162.9, 92.2, -35.4], beyond: [92.2, 179.2, 92.2, -43.5], podcast: [92.2, 119.4, 78.3, -20.5] },
    nodesc: { inner: [92.2, 113.9, 92.2, -10.9], flow: [92.2, 113.9, 92.2, -10.9], beyond: [92.2, 113.9, 92.2, -10.9], podcast: [92.2, 100.1, 78.3, -10.9] } },
  '500x928': { rightSafe: 62,
    full: { inner: [92, 130.8, 60, -35.4], flow: [92, 130.8, 60, -35.4], beyond: [92, 147, 60, -43.5], podcast: [92, 92.1, 51, -20.5] },
    nodesc: { inner: [92, 84.3, 60, -12.1], flow: [92, 84.3, 60, -12.1], beyond: [92, 100.5, 60, -20.3], podcast: [92, 75.3, 51, -12.1] } },
  '390x844': { rightSafe: 62,
    full: { inner: [92, 126.8, 56, -35.4], flow: [92, 126.8, 56, -35.4], beyond: [92, 143, 56, -43.5], podcast: [92, 88.7, 47.6, -20.5] },
    nodesc: { inner: [92, 80.3, 56, -12.1], flow: [92, 80.3, 56, -12.1], beyond: [92, 96.5, 56, -20.3], podcast: [92, 71.8, 47.6, -12.1] } },
  '360x640': { rightSafe: 0,
    full: { inner: [92, 126.8, 56, -35.4], flow: [92, 126.8, 56, -35.4], beyond: [92, 143, 56, -43.5], podcast: [92, 88.7, 47.6, -20.5] },
    nodesc: { inner: [92, 80.3, 56, -12.1], flow: [92, 80.3, 56, -12.1], beyond: [92, 96.5, 56, -20.3], podcast: [92, 71.8, 47.6, -12.1] } },
  '320x568': { rightSafe: 0,
    full: { inner: [92, 126.8, 56, -35.4], flow: [92, 126.8, 56, -35.4], beyond: [92, 143, 56, -43.5], podcast: [92, 88.7, 47.6, -20.5] },
    nodesc: { inner: [92, 80.3, 56, -12.1], flow: [92, 80.3, 56, -12.1], beyond: [92, 96.5, 56, -20.3], podcast: [92, 71.8, 47.6, -12.1] } },
  '844x390': { rightSafe: 62,
    full: { inner: [92, 126.8, 56, -35.4], flow: [92, 126.8, 56, -35.4], beyond: [92, 143, 56, -43.5], podcast: [92, 88.7, 47.6, -20.5] },
    nodesc: { inner: [92, 80.3, 56, -12.1], flow: [92, 80.3, 56, -12.1], beyond: [92, 96.5, 56, -20.3], podcast: [92, 71.8, 47.6, -12.1] } },
  '667x375': { rightSafe: 0,
    full: { inner: [92, 126.8, 56, -35.4], flow: [92, 126.8, 56, -35.4], beyond: [92, 143, 56, -43.5], podcast: [92, 88.7, 47.6, -20.5] },
    nodesc: { inner: [92, 80.3, 56, -12.1], flow: [92, 80.3, 56, -12.1], beyond: [92, 96.5, 56, -20.3], podcast: [92, 71.8, 47.6, -12.1] } }
};

/* Label block heights measured at label width 92px (the minD label width). */
const LABEL_H92 = {
  full: { inner: 62.8, flow: 62.8, beyond: 79, podcast: 33.1 },
  nodesc: { inner: 16.3, flow: 16.3, beyond: 32.5, podcast: 16.3 }
};

function orbInputs(vw, vh) {
  const portrait = vw / vh < 0.8;
  const scale = portrait ? vw * 0.92 : Math.min(vw * 0.44, vh * 0.95);
  return { cx: vw / 2, cy: vh * (portrait ? 0.40 : 0.45), Ro: 0.11 * scale, R: 0.37 * Math.min(vw, vh) };
}

function fp(w, h, iconD, iconOffsetY) { return { w, h, iconD, iconOffsetY }; }

function tablesFor(name, d0) {
  const rec = M[name];
  const t = { full: { d0: {}, min: {} }, nodesc: { d0: {}, min: {} }, iconic: { d0: {}, min: {} } };
  IDS.forEach(id => {
    const f = rec.full[id], n = rec.nodesc[id];
    t.full.d0[id] = fp(f[0], f[1], f[2], f[3]);
    t.nodesc.d0[id] = fp(n[0], n[1], n[2], n[3]);
    const iconD = Math.max(MIN_HIT, id === 'podcast' ? d0 * 0.85 : d0);
    t.iconic.d0[id] = fp(iconD, iconD, iconD, 0);           // adapter: icon-only button max(44, iconD)
    const hF = MIN_HIT + 8 + LABEL_H92.full[id];
    const hN = MIN_HIT + 8 + LABEL_H92.nodesc[id];
    t.full.min[id] = fp(92, hF, MIN_HIT, MIN_HIT / 2 - hF / 2);
    t.nodesc.min[id] = fp(92, hN, MIN_HIT, MIN_HIT / 2 - hN / 2);
    t.iconic.min[id] = fp(MIN_HIT, MIN_HIT, MIN_HIT, 0);
  });
  return t;
}

function inputFor(vw, vh, extra) {
  const o = orbInputs(vw, vh);
  const d0 = Math.min(104, Math.max(56, Math.min(vw, vh) * 0.12));
  return Object.assign({
    vw, vh, cx: o.cx, cy: o.cy, Ro: o.Ro, R: o.R, d0, minD: MIN_HIT,
    topSafe: 56, bottomSafe: vh * 0.22, sideSafe: 16, rightSafe: M[vw + 'x' + vh].rightSafe,
    footprints: tablesFor(vw + 'x' + vh, d0)
  }, extra || {});
}

/* Independent constraint checkers (rect geometry, not the engine's code path). */
function orbGap(pos, f, cx, cy, Ro) {
  const dx = Math.max(Math.abs(pos.x - cx) - f.w / 2, 0);
  const dy = Math.max(Math.abs(pos.y - cy) - f.h / 2, 0);
  return Math.hypot(dx, dy) - (Ro + GAP);
}
function pairGap(pa, fa, pb, fb) {
  const dx = Math.max(Math.abs(pa.x - pb.x) - (fa.w + fb.w) / 2, 0);
  const dy = Math.max(Math.abs(pa.y - pb.y) - (fa.h + fb.h) / 2, 0);
  return Math.hypot(dx, dy) - GAP;
}
function zoneSlack(pos, f, vw, vh, topSafe, bottomSafe, sideSafe, rightEff) {
  return Math.min(
    pos.y - f.h / 2 - topSafe,
    vh - bottomSafe - (pos.y + f.h / 2),
    pos.x - f.w / 2 - sideSafe,
    vw - rightEff - (pos.x + f.w / 2));
}

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

const CASES = [
  [1920, 1080, 'row', 'full', false],
  [1366, 768, 'row', 'full', false],
  [1280, 720, 'row', 'full', false],
  [768, 1024, 'triangle', 'full', false],
  [500, 928, 'triangle', 'full', false],
  [390, 844, 'triangle', 'nodesc', true],   // right control column: iconic would fit but is gated to vh<500
  [360, 640, 'triangle', 'nodesc', true],   // tall measured labels: pairwise gap < 8 in every permitted mode
  [320, 568, 'triangle', 'nodesc', true],   // same, tighter
  [844, 390, 'row', 'iconic', false],       // amendment: step 2b expected
  [667, 375, 'row', 'iconic', false]        // amendment: step 2b expected
];

for (const [vw, vh, wantMode, wantLabel, wantWarning] of CASES) {
  const name = vw + 'x' + vh;
  const inp = inputFor(vw, vh);
  const l = computeLayout(inp);
  const rightEff = Math.max(inp.sideSafe, inp.rightSafe);

  /* 1. One authoritative centre: the engine never moves the orb centre.
        (X DOM placement from this centre is adapter-side; proven by diff + dev assertion.) */
  ok(l.center.x === inp.cx && l.center.y === inp.cy, name + ': centre is the orb centre, unchanged');

  /* 5. Every hit target >= 44px in both dimensions — always, even least-bad. */
  IDS.forEach(id => {
    ok(l.footprints[id].w >= MIN_HIT - EPS && l.footprints[id].h >= MIN_HIT - EPS,
      name + ': hit >= 44 ' + id);
  });
  ok(Math.abs(l.dp - Math.max(MIN_HIT, l.d * 0.85)) < EPS, name + ': podcast size factor');

  /* 2/3/4. Clearance, pairwise, safe zones — mandatory unless the warning flag is set. */
  if (!wantWarning) {
    ok(!l.warning, name + ': no warning expected');
    IDS.forEach(id => {
      ok(orbGap(l.pos[id], l.footprints[id], inp.cx, inp.cy, inp.Ro) >= -EPS, name + ': orb+8 clearance ' + id);
      ok(zoneSlack(l.pos[id], l.footprints[id], vw, vh, inp.topSafe, inp.bottomSafe, inp.sideSafe, rightEff) >= -EPS,
        name + ': safe zones ' + id);
    });
    for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) {
      ok(pairGap(l.pos[IDS[i]], l.footprints[IDS[i]], l.pos[IDS[j]], l.footprints[IDS[j]]) >= -EPS,
        name + ': pairwise ' + IDS[i] + '+' + IDS[j]);
    }
  } else {
    /* Amendment: warning viewports must still keep the flag, the centre, orb clearance and 44px hits. */
    ok(l.warning && l.warning.indexOf('least-bad-layout') === 0, name + ': warning flag set');
    IDS.forEach(id => {
      ok(orbGap(l.pos[id], l.footprints[id], inp.cx, inp.cy, inp.Ro) >= -EPS, name + ': least-bad still clears orb ' + id);
    });
  }

  /* 6. ROW only in landscape and only when everything fits. */
  if (l.mode === 'row') {
    ok(LANDSCAPE_REQUIRED(vw, vh), name + ': row is landscape');
    ok(!l.warning, name + ': row has no violations');
    IDS.forEach(id => {
      ok(orbGap(l.pos[id], l.footprints[id], inp.cx, inp.cy, inp.Ro) >= -EPS, name + ': row clearance ' + id);
      ok(zoneSlack(l.pos[id], l.footprints[id], vw, vh, inp.topSafe, inp.bottomSafe, inp.sideSafe, rightEff) >= -EPS,
        name + ': row zones ' + id);
    });
  }

  /* 7. TRIANGLE geometry (holds by construction even in least-bad). */
  if (l.mode === 'triangle') {
    const f = l.footprints;
    ok(l.pos.flow.x === inp.cx, name + ': flow on vertical axis');
    ok(Math.abs((l.pos.flow.y + f.flow.h / 2) - (inp.cy - inp.Ro - GAP)) < EPS, name + ': flow bottom 8px above orb top');
    ok(l.pos.inner.y === inp.cy, name + ': inner at orb level');
    ok(Math.abs((inp.cx - inp.Ro - GAP) - (l.pos.inner.x + f.inner.w / 2)) < EPS, name + ': inner edge 8px from orb');
    ok(l.pos.beyond.y === inp.cy, name + ': beyond at orb level');
    ok(Math.abs((l.pos.beyond.x - f.beyond.w / 2) - (inp.cx + inp.Ro + GAP)) < EPS, name + ': beyond edge 8px from orb');
    ok(l.pos.podcast.x === inp.cx, name + ': podcast on vertical axis');
    ok(Math.abs((l.pos.podcast.y - f.podcast.h / 2) - (inp.cy + inp.Ro + GAP)) < EPS, name + ': podcast below orb');
    /* 8. All four construction circles pass through the centre (unclipped geometry). */
    IDS.forEach(id => {
      const c = l.circles[id];
      ok(Math.abs(Math.hypot(c.cx - inp.cx, c.cy - inp.cy) - c.r) <= 1, name + ': circle through X ' + id);
      ok(Math.abs(c.cx - l.icons[id].x) < EPS && Math.abs(c.cy - l.icons[id].y) < EPS, name + ': circle centred on icon ' + id);
    });
  } else {
    /* ROW keeps the original construction: shared radius r, centred on each icon. */
    IDS.forEach(id => ok(Math.abs(l.circles[id].r - l.r) < EPS, name + ': row circle radius ' + id));
  }

  ok(l.mode === wantMode && l.labelMode === wantLabel, name + ': expected ' + wantMode + '/' + wantLabel + ' got ' + l.mode + '/' + l.labelMode);
  ok(!!l.warning === wantWarning, name + ': warning expectation');
  if (l.labelMode === 'iconic') ok(vh < 500, name + ': iconic only when vh < 500');
  ok(Array.isArray(l.tried) && l.tried.length > 0, name + ': fallback trail recorded');
}

/* Warning content is honest about what failed. */
ok(computeLayout(inputFor(390, 844)).warning.indexOf('right-safe:beyond') >= 0, '390x844: names the right-column conflict');
ok(computeLayout(inputFor(360, 640)).warning.indexOf('hit-overlap') >= 0, '360x640: names the hit conflicts');
ok(computeLayout(inputFor(320, 568)).warning.indexOf('hit-overlap') >= 0, '320x568: names the hit conflicts');

/* Fallback chain order: 844x390 tries row full/nodesc before iconic (step 2b). */
{
  const l = computeLayout(inputFor(844, 390));
  const firstOk = l.tried.findIndex(t => t.ok);
  ok(firstOk > 0 && l.tried[firstOk].label === 'iconic' && l.tried[firstOk].mode === 'row', '844x390: iconic reached via fallback');
  ok(l.tried.slice(0, firstOk).every(t => !t.ok), '844x390: earlier steps genuinely failed');
}

/* Hysteresis: leaving TRIANGLE requires ~8% more room than the bare minimum. */
{
  const base = inputFor(1366, 768);
  ok(computeLayout(base).mode === 'row', 'hysteresis: fresh landscape is row');
  const tight = Object.assign({}, base, { R: 150, previousMode: 'triangle' });
  ok(computeLayout(tight).mode === 'triangle', 'hysteresis: stays triangle below 1.08x threshold');
  const roomy = Object.assign({}, base, { previousMode: 'triangle' });
  ok(computeLayout(roomy).mode === 'row', 'hysteresis: returns to row with full room');
}

/* Orientation rule is one named constant, default vw >= vh. */
ok(LANDSCAPE_REQUIRED(844, 390) === true, 'landscape rule: wide');
ok(LANDSCAPE_REQUIRED(390, 844) === false, 'landscape rule: tall');
ok(LANDSCAPE_REQUIRED(500, 500) === true, 'landscape rule: square counts as landscape');

/* Synthetic impossible viewport: least-bad keeps 44px hits, the centre and orb clearance. */
{
  const inp = inputFor(320, 568);
  inp.vw = 300; inp.vh = 300; inp.cx = 150; inp.cy = 135; inp.Ro = 100; inp.R = 111;
  inp.bottomSafe = 66; inp.rightSafe = 0;
  const l = computeLayout(inp);
  ok(l.warning.indexOf('least-bad-layout') === 0, 'synthetic: warning flag');
  ok(l.center.x === 150 && l.center.y === 135, 'synthetic: centre untouched');
  IDS.forEach(id => {
    ok(l.footprints[id].w >= MIN_HIT && l.footprints[id].h >= MIN_HIT, 'synthetic: hit >= 44 ' + id);
    ok(orbGap(l.pos[id], l.footprints[id], 150, 135, 100) >= -EPS, 'synthetic: orb clearance ' + id);
  });
}

/* Purity: no DOM/browser references, deterministic, input never mutated. */
{
  const src = fs.readFileSync(require.resolve('./podcast-layout.js'), 'utf8');
  ok(!/\bdocument\b|\bwindow\b|getBoundingClientRect|requestAnimationFrame|localStorage|\bfetch\s*\(/.test(src),
    'purity: no DOM or browser API references');
  const inp = inputFor(390, 844);
  const snapshot = JSON.stringify(inp);
  const a = computeLayout(inp), b = computeLayout(inp);
  ok(JSON.stringify(a) === JSON.stringify(b), 'purity: deterministic');
  ok(JSON.stringify(inp) === snapshot, 'purity: input not mutated');
}

console.log('podcast-layout: ' + CASES.length + ' viewports + fallback/hysteresis/purity, ' + checks + ' assertions passed');