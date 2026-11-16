(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (root.__VOID_PODCAST_FLAG__) root.VoidPodcastLayout = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var PHI = 1.618033988749895;
  var PODCAST_FACTOR = 0.85;
  var HYSTERESIS = 1.08;

  function finite(n, fallback) { return typeof n === 'number' && isFinite(n) ? n : fallback; }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function dist(a, b) { var x = a.x - b.x, y = a.y - b.y; return Math.sqrt(x * x + y * y); }

  function computeLayout(input) {
    input = input || {};
    var vw = Math.max(1, finite(input.vw, 390));
    var vh = Math.max(1, finite(input.vh, 844));
    var cx = finite(input.cx, vw / 2), cy = finite(input.cy, vh / 2);
    var Ro = Math.max(0, finite(input.Ro, 42));
    var R = Math.max(Ro, finite(input.R, Ro * 2));
    var d0 = Math.max(1, finite(input.d0, 72));
    var topSafe = Math.max(0, finite(input.topSafe, 56));
    var bottomSafe = Math.max(0, finite(input.bottomSafe, vh * 0.22));
    var sideSafe = Math.max(0, finite(input.sideSafe, 16));
    var minD = Math.max(44, finite(input.minD, 44));
    var r0 = R / PHI;
    var warnings = [];
    var d = d0;
    var candidate = null;

    function rowFor(size) {
      var dp = Math.max(44, size * PODCAST_FACTOR);
      var upper = Math.min(r0,
        (0.9 * vw - 2 * sideSafe - size) / 2,
        cy - topSafe - size / 2);
      var lower = Math.max(Ro + size / 2 + 8, Ro + dp / 2 + 8);
      if (upper < lower) return null;
      var r = upper;
      var qMax = (vh - bottomSafe) - cy - dp / 2;
      var q = Math.min(r, qMax);
      if (q < lower) q = Math.min(0.618 * r, qMax);
      if (q < lower) return null;
      return { mode: 'row', d: size, dp: dp, r: r, q: q,
        pos: { inner: { x: cx - r, y: cy - r }, flow: { x: cx, y: cy - r }, beyond: { x: cx + r, y: cy - r }, podcast: { x: cx, y: cy + q } } };
    }

    candidate = rowFor(d);
    if (!candidate && d > minD) { d = minD; candidate = rowFor(d); }
    var previous = input.previousMode;
    if (candidate && previous === 'triangle') {
      var rowNeed = Math.max(Ro + d / 2 + 8, Ro + candidate.dp / 2 + 8);
      if (candidate.r < rowNeed * HYSTERESIS) candidate = null;
    }
    if (!candidate) {
      d = Math.max(minD, Math.min(d, d0));
      var dp = Math.max(44, d * PODCAST_FACTOR);
      var sep = d + 8;
      var baseY = -(Ro + d / 2 + 8);
      var halfBase = sep / 2;
      var apexY = baseY - Math.sqrt(3) * sep;
      var qMax = (vh - bottomSafe) - cy - dp / 2;
      var q = Math.min(Math.max(Ro + dp / 2 + 8, 0.618 * Math.max(1, -baseY)), qMax);
      if (q < Ro + dp / 2 + 8) warnings.push('bottom-safe-zone');
      candidate = { mode: 'triangle', d: d, dp: dp, r: Math.max(1, -baseY), q: q,
        pos: { inner: { x: cx, y: cy + apexY }, flow: { x: cx - halfBase, y: cy + baseY }, beyond: { x: cx + halfBase, y: cy + baseY }, podcast: { x: cx, y: cy + q } } };
      if (q < 0) candidate.q = 0;
      warnings.push('triangle-fallback');
    }
    var p = candidate.pos, origin = { x: cx, y: cy }, names = ['inner', 'flow', 'beyond', 'podcast'];
    for (var i = 0; i < names.length; i++) {
      if (dist(p[names[i]], origin) < Ro + (names[i] === 'podcast' ? candidate.dp : candidate.d) / 2 + 8) warnings.push('orb-clearance');
    }
    var seen = {};
    for (var a = 0; a < names.length; a++) for (var b = a + 1; b < names.length; b++) {
      var da = names[a] === 'podcast' ? candidate.dp : candidate.d;
      var db = names[b] === 'podcast' ? candidate.dp : candidate.d;
      if (dist(p[names[a]], p[names[b]]) < (da + db) / 2 + 8) seen.overlap = true;
    }
    if (seen.overlap) warnings.push('overlap');
    var out = { mode: candidate.mode, d: candidate.d, dp: candidate.dp, r: candidate.r, q: candidate.q, pos: candidate.pos };
    if (warnings.length) out.warning = warnings.join(',');
    return out;
  }
  return { computeLayout: computeLayout };
});
