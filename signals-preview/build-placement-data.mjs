/* Phase B visual preview — placement data builder (isolated, read-only over A1 evidence).
 *
 * Reads the corrected A1X-2 frame-by-frame CSS-space masks and the A1X-4 / A1X-5
 * geometry tables, and re-expresses them in a galaxy-relative normalised frame
 *     u = (x_css - cx) / scale ,  v = (y_css - cy) / scale
 * so the preview can test a candidate position against the measured brightness field
 * at any live viewport size, using the LIVE cx / cy / scale published by the renderer.
 *
 * Nothing here is approved production geometry. Every mask is a measurement of the
 * pinned audit baseline 4589f84 (viz blob identical at 404c9b4), re-binned.
 *
 * node signals-preview/build-placement-data.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const AUDIT = 'E:/google chrome extention/_tmp/signals-p1/audit';
const OUT = join(import.meta.dirname, 'placement-data.json');
const U_MIN = -1.6, U_MAX = 1.6, STEP = 0.015;
const N = Math.ceil((U_MAX - U_MIN) / STEP);
const THRS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
const SMAX = 3.5;
const VPS = ['desktop', 'tablet', 'phone'];
const CLUSTER = {
  desktop: { slots: 12, star: 30, admin: 38, minGap: 76 },
  tablet: { slots: 8, star: 28, admin: 36, minGap: 64 },
  phone: { slots: 6, star: 26, admin: 34, minGap: 56 }
};
const sha256 = b => createHash('sha256').update(b).digest('hex');
const read = f => JSON.parse(readFileSync(join(AUDIT, f), 'utf8'));

const geo4 = read('A1X4-exclusion-geometry-v1.json');
const v4 = read('A1X5-placement-comparison-v4.json');
const v5 = read('A1X5-placement-comparison-thrHigh-v5.json');
const curve = read('A1X6-threshold-curve-v1.json');

function encode(bits) {
  const bytes = Buffer.alloc(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  const b64 = bytes.toString('base64');
  const runs = [];
  let cur = 0, len = 0;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === cur) len++;
    else { runs.push(len); cur = bits[i]; len = 1; }
  }
  runs.push(len);
  const rle = JSON.stringify(runs);
  return rle.length < b64.length + 8 ? { enc: 'rle', data: runs } : { enc: 'b64', data: b64 };
}

const sources = {};
const viewports = {};
for (const vp of VPS) {
  const m = read(`A1X2-mask-${vp}.json`);
  sources[`A1X2-mask-${vp}.json`] = sha256(readFileSync(join(AUDIT, `A1X2-mask-${vp}.json`)));
  const { cell, gw, gh, meta } = m;
  const cx = meta.cx, cy = meta.cy, scale = meta.scale;
  const groups = ['natural', 'forced', 'sweep'];
  const n = gw * gh;
  const cycleWorst = new Int32Array(n), cycleSingle = new Int32Array(n), cycleMean = new Int32Array(n);
  const natWorst = new Int32Array(n), natSingle = new Int32Array(n), natMean = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let w = 0, s = 0, sum = 0;
    for (const g of groups) {
      const a = m.maps[g];
      if (a.worst[i] > w) w = a.worst[i];
      if (a.single[i] > s) s = a.single[i];
      sum += a.mean[i];
    }
    cycleWorst[i] = w; cycleSingle[i] = s; cycleMean[i] = Math.round(sum / groups.length);
    natWorst[i] = m.maps.natural.worst[i];
    natSingle[i] = m.maps.natural.single[i];
    natMean[i] = m.maps.natural.mean[i];
  }
  const centreCell = Math.min(gh - 1, Math.floor(cy / cell)) * gw + Math.min(gw - 1, Math.floor(cx / cell));
  const zero = new Int32Array(n);
  const legs = (wArr, sArr, T, TS) => {
    const bits = new Uint8Array(N * N);
    let cells = 0;
    for (let i = 0; i < n; i++) {
      if (!(wArr[i] >= T || sArr[i] >= TS)) continue;
      const x = (i % gw + 0.5) * cell, y = ((i / gw | 0) + 0.5) * cell;
      const col = Math.floor(((x - cx) / scale - U_MIN) / STEP);
      const row = Math.floor(((y - cy) / scale - U_MIN) / STEP);
      if (col < 0 || col >= N || row < 0 || row >= N) continue;
      const b = row * N + col;
      if (!bits[b]) { bits[b] = 1; cells++; }
    }
    return { bits, cells };
  };
  const masks = {};
  const maskStats = {};
  for (const thr of THRS) {
    const T = Math.round(thr * 1000), TS = Math.round(SMAX * thr * 1000);
    const defs = {
      'R-C': legs(cycleWorst, cycleSingle, T, TS),
      'R-C2': legs(cycleWorst, zero, T, TS),
      'R-Cn': legs(natWorst, natSingle, T, TS),
      'R-F': legs(cycleMean, zero, T, TS),
      'R-G': legs(natMean, zero, T, TS)
    };
    for (const [rule, L] of Object.entries(defs)) {
      masks[rule] = masks[rule] || {};
      const enc = encode(L.bits);
      masks[rule][String(thr)] = enc;
      maskStats[rule] = maskStats[rule] || {};
      maskStats[rule][String(thr)] = { cells: L.cells, gridPct: +(100 * L.cells / (N * N)).toFixed(2) };
    }
  }
  const measuredDiscPx = {};
  for (const thr of THRS) {
    const k = String(thr);
    const a = v4.viewports.find(s => s.viewport === vp);
    const b = v5.viewports.find(s => s.viewport === vp);
    measuredDiscPx[k] = (a && a.measuredDiscPx[k]) ?? (b && b.measuredDiscPx[k]) ?? null;
  }
  const placed = {};
  for (const src of [v4, v5]) {
    const s = src.viewports.find(x => x.viewport === vp);
    if (!s) continue;
    for (const [tk, tv] of Object.entries(s.byThreshold)) {
      const thr = tk.replace('thr', '');
      placed[thr] = placed[thr] || {};
      for (const [rule, perUi] of Object.entries(tv.perRule)) {
        placed[thr][rule] = placed[thr][rule] || {};
        for (const [uiName, rec] of Object.entries(perUi)) {
          placed[thr][rule][uiName.indexOf('K1') === 0 ? 'K1' : uiName.indexOf('K0') === 0 ? 'K0' : uiName.indexOf('K4') === 0 ? 'K4' : uiName.slice(0, 2)] = rec.clustersPlaced;
        }
      }
    }
  }
  const cv = curve.viewports[vp];
  viewports[vp] = {
    measuredCss: m.cssViewport, cx, cy, scale, cell, gw, gh,
    portrait: meta.portrait, rs: meta.rs, bufW: meta.bufW, bufH: meta.bufH,
    framesPerGroup: m.maps.natural.frames,
    centreCellCycleWorst: +(cycleWorst[centreCell] / 1000).toFixed(4),
    centreCellNaturalWorst: +(natWorst[centreCell] / 1000).toFixed(4),
    cluster: CLUSTER[vp],
    analyticDiscPx: +(0.911 * scale).toFixed(1),
    measuredDiscPx,
    masks, maskStats,
    auditClustersPlaced: placed,
    thresholdCurve: cv ? cv.curve.map(c => ({ thr: c.thr, persistentPct: c.persistentPct, complementPct: c.complementPct, largestRegionHoldsClusterBox: c.largestRegionHoldsClusterBox })) : null
  };
  console.log(`${vp}: scale=${scale} centre=${cx},${cy} grid=${N}x${N} masks=${Object.keys(masks).length}x${THRS.length}`);
}

const payload = {
  instrument: 'signals-preview-placement-data-v1',
  generatedAt: new Date().toISOString(),
  status: 'EXPERIMENTAL — measured re-binning of A1 evidence, NOT approved production geometry',
  measuredAtSha: '4589f84bf17089b899b372c09d971946f8e70f36',
  previewBaseSha: '404c9b49d050b9e58db05c308ad77cef766bbddc',
  frame: {
    uMin: U_MIN, uMax: U_MAX, step: STEP, n: N,
    mapping: 'u=(x_css-cx)/scale, v=(y_css-cy)/scale; bin=floor((u-uMin)/step); index=row*n+col',
    aggregation: 'a bin is bright if ANY measured 4 CSS px cell inside it is bright (conservative)',
    caveat: 'masks were measured at one viewport per class; at other sizes they are resampled through the live galaxy frame, so they are an approximation outside the measured size'
  },
  predicate: { thresholds: THRS, singleMaxMultiplier: SMAX, legs: 'cell-mean >= thr OR brightest-ever sampled pixel >= 3.5*thr' },
  rules: [
    { id: 'R-C', kind: 'mask', label: 'REV-3 swept footprint (cycle)', note: 'both legs, natural+forced+sweep camera cycle' },
    { id: 'R-C2', kind: 'mask', label: 'Cycle cell-mean only', note: 'drops the 3.5x single-pixel transient leg' },
    { id: 'R-Cn', kind: 'mask', label: 'Natural playback footprint', note: 'both legs, natural playback only' },
    { id: 'R-F', kind: 'mask', label: 'Persistent cells (cycle)', note: 'time-average only; the working experimental default' },
    { id: 'R-G', kind: 'mask', label: 'Persistent cells (natural)', note: 'time-average of natural playback only' },
    { id: 'R-A', kind: 'disc', label: 'REV-3 analytic disc', note: '0.911 * live scale' },
    { id: 'R-B', kind: 'measuredDisc', label: 'Measured bright disc', note: 'A1X-4/5 observed extent at the chosen threshold' },
    { id: 'R-0', kind: 'none', label: 'UI + edges only', note: 'no brightness test — upper bound, not a safe rule' }
  ],
  primitives: {
    GOLDEN: Math.PI * (3 - Math.sqrt(5)),
    MEMBER_R: [0, 1.70, 1.90], MEMBER_A: [0, 0.60, 4.10], MEMBER_S: [1, 0.82, 0.78],
    COMP_R: [1.00, 1.25, 0.85], COMP_A: [2.35, 3.15, 5.20], COMP_S: [0.50, 0.38, 0.30],
    STAR_PAD: 4
  },
  viewports,
  sources: {
    dir: AUDIT,
    files: Object.assign(sources, {
      'A1X4-exclusion-geometry-v1.json': sha256(readFileSync(join(AUDIT, 'A1X4-exclusion-geometry-v1.json'))),
      'A1X5-placement-comparison-v4.json': sha256(readFileSync(join(AUDIT, 'A1X5-placement-comparison-v4.json'))),
      'A1X5-placement-comparison-thrHigh-v5.json': sha256(readFileSync(join(AUDIT, 'A1X5-placement-comparison-thrHigh-v5.json'))),
      'A1X6-threshold-curve-v1.json': sha256(readFileSync(join(AUDIT, 'A1X6-threshold-curve-v1.json')))
    })
  }
};
if (existsSync(OUT)) { console.log('ABORT-WOULD-OVERWRITE ' + OUT); process.exit(2); }
writeFileSync(OUT, JSON.stringify(payload));
console.log('WROTE ' + OUT + ' bytes=' + JSON.stringify(payload).length);