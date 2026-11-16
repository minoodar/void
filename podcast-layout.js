(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (root.__VOID_PODCAST_FLAG__) root.VoidPodcastLayout = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var PHI = 1.618033988749895;
  var PODCAST_FACTOR = 0.85;
  var HYSTERESIS = 1.08;
  var GAP = 8;
  var MIN_HIT = 44;
  var IDS = ['inner', 'flow', 'beyond', 'podcast'];

  /* Named orientation rule: the owner may replace this with a width threshold. */
  var LANDSCAPE_REQUIRED = function (vw, vh) { return vw >= vh; };

  function finite(n, fallback) { return typeof n === 'number' && isFinite(n) ? n : fallback; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function fp(raw, d) {
    raw = raw || {};
    var iconD = Math.max(1, finite(raw.iconD, d));
    return {
      w: Math.max(MIN_HIT, finite(raw.w, d)),
      h: Math.max(MIN_HIT, finite(raw.h, d)),
      iconD: iconD,
      iconOffsetY: finite(raw.iconOffsetY, 0)
    };
  }

  function computeLayout(input) {
    input = input || {};
    var vw = Math.max(1, finite(input.vw, 390)), vh = Math.max(1, finite(input.vh, 844));
    var cx = finite(input.cx, vw / 2), cy = finite(input.cy, vh * 0.45);
    var Ro = Math.max(0, finite(input.Ro, 42));
    var R = Math.max(Ro, finite(input.R, Ro * 2));
    var d0 = Math.max(MIN_HIT, finite(input.d0, 72));
    var minD = Math.max(MIN_HIT, finite(input.minD, MIN_HIT));
    var topSafe = Math.max(0, finite(input.topSafe, 56));
    var bottomSafe = Math.max(0, finite(input.bottomSafe, vh * 0.22));
    var sideSafe = Math.max(0, finite(input.sideSafe, 16));
    var rightSafe = Math.max(0, finite(input.rightSafe, 0));
    var rightEff = Math.max(sideSafe, rightSafe);
    var tables = input.footprints || {};
    var center = { x: cx, y: cy };

    function fps(mode, d) {
      var t = (tables[mode] || {})[d <= minD + 0.5 ? 'min' : 'd0'] || {};
      var out = {};
      IDS.forEach(function (id) { out[id] = fp(t[id], id === 'podcast' ? Math.max(MIN_HIT, d * PODCAST_FACTOR) : d); });
      return out;
    }
    function icon(pos, f) { return { x: pos.x, y: pos.y + f.iconOffsetY }; }
    function violations(pos, f) {
      var bad = [], i, j, a, b, dx, dy;
      IDS.forEach(function (id) {
        var p = pos[id], q = f[id];
        dx = Math.max(Math.abs(p.x - cx) - q.w / 2, 0);
        dy = Math.max(Math.abs(p.y - cy) - q.h / 2, 0);
        if (Math.hypot(dx, dy) < Ro + GAP - 1e-9) bad.push('orb-clearance:' + id);
        if (p.y - q.h / 2 < topSafe - 1e-9) bad.push('top-safe:' + id);
        if (p.y + q.h / 2 > vh - bottomSafe + 1e-9) bad.push('bottom-safe:' + id);
        if (p.x - q.w / 2 < sideSafe - 1e-9) bad.push('left-safe:' + id);
        if (p.x + q.w / 2 > vw - rightEff + 1e-9) bad.push('right-safe:' + id);
      });
      for (i = 0; i < IDS.length; i++) for (j = i + 1; j < IDS.length; j++) {
        a = pos[IDS[i]]; b = pos[IDS[j]];
        dx = Math.max(Math.abs(a.x - b.x) - (f[IDS[i]].w + f[IDS[j]].w) / 2, 0);
        dy = Math.max(Math.abs(a.y - b.y) - (f[IDS[i]].h + f[IDS[j]].h) / 2, 0);
        if (Math.hypot(dx, dy) < GAP - 1e-9) bad.push('hit-overlap:' + IDS[i] + '+' + IDS[j]);
      }
      return bad;
    }
    function circlesFor(mode, pos, f, rowR) {
      var out = {};
      IDS.forEach(function (id) {
        var ic = icon(pos[id], f[id]);
        out[id] = { cx: ic.x, cy: ic.y, r: mode === 'row' ? rowR : dist(ic, center) };
      });
      return out;
    }
    function row(d, mode) {
      var f = fps(mode, d);
      var maxH = Math.max(f.inner.h, f.flow.h, f.beyond.h);
      var rowY = cy - Ro - GAP - maxH / 2;
      var r = Math.min(R / PHI, cx - sideSafe - f.inner.w / 2, vw - rightEff - cx - f.beyond.w / 2);
      var q = Ro + GAP + f.podcast.h / 2;
      var pos = {
        inner: { x: cx - r, y: rowY }, flow: { x: cx, y: rowY }, beyond: { x: cx + r, y: rowY },
        podcast: { x: cx, y: cy + q }
      };
      if (r <= 0 || r < GAP + (f.inner.w + f.flow.w) / 2 || r < GAP + (f.flow.w + f.beyond.w) / 2) return null;
      var bad = violations(pos, f);
      if (bad.length) return null;
      return { mode: 'row', d: d, r: r, q: q, pos: pos, f: f, bad: bad };
    }
    function triangle(d, mode) {
      var f = fps(mode, d);
      var q = Ro + GAP + f.podcast.h / 2;
      var pos = {
        flow: { x: cx, y: cy - Ro - GAP - f.flow.h / 2 },
        inner: { x: cx - Ro - GAP - f.inner.w / 2, y: cy },
        beyond: { x: cx + Ro + GAP + f.beyond.w / 2, y: cy },
        podcast: { x: cx, y: cy + q }
      };
      return { mode: 'triangle', d: d, r: Ro + GAP + f.flow.h / 2, q: q, pos: pos, f: f, bad: violations(pos, f) };
    }

    var landscape = LANDSCAPE_REQUIRED(vw, vh);
    var rowAllowed = landscape;
    if (rowAllowed && input.previousMode === 'triangle') {
      var probe = row(d0, 'full');
      if (!probe || probe.r < (Ro + d0 / 2 + GAP) * HYSTERESIS) rowAllowed = false;
    }
    var modes = vh < 500 ? ['full', 'nodesc', 'iconic'] : ['full', 'nodesc'];
    var tried = [], cand = null, m, di, d, c;
    for (m = 0; m < modes.length && !cand; m++) {
      for (di = 0; di < 2 && !cand; di++) {
        d = di === 0 ? d0 : minD;
        if (rowAllowed) {
          c = row(d, modes[m]);
          tried.push({ mode: 'row', label: modes[m], d: d, ok: !!c });
          if (c) cand = c;
        }
      }
    }
    for (m = 0; m < modes.length && !cand; m++) {
      for (di = 0; di < 2 && !cand; di++) {
        d = di === 0 ? d0 : minD;
        c = triangle(d, modes[m]);
        tried.push({ mode: 'triangle', label: modes[m], d: d, ok: c.bad.length === 0 });
        if (!c.bad.length) cand = c;
      }
    }
    var warning = '';
    if (!cand) {
      cand = triangle(minD, modes[modes.length - 1]);
      warning = 'least-bad-layout' + (cand.bad.length ? ',' + cand.bad.join(',') : '');
    }
    var icons = {};
    IDS.forEach(function (id) { icons[id] = icon(cand.pos[id], cand.f[id]); });
    return {
      mode: cand.mode, labelMode: modes[cand === null ? 0 : modes.indexOf(candLabel(tried, cand))],
      d: cand.d, dp: Math.max(MIN_HIT, cand.d * PODCAST_FACTOR), r: cand.r, q: cand.q,
      pos: cand.pos, icons: icons, footprints: cand.f,
      circles: circlesFor(cand.mode, cand.pos, cand.f, cand.r),
      center: center, warning: warning, tried: tried
    };
    function candLabel(tr, cd) {
      for (var i = tr.length - 1; i >= 0; i--) if (tr[i].ok && tr[i].d === cd.d && tr[i].mode === cd.mode) return tr[i].label;
      return modes[modes.length - 1];
    }
  }

  return { computeLayout: computeLayout, LANDSCAPE_REQUIRED: LANDSCAPE_REQUIRED, IDS: IDS };
});