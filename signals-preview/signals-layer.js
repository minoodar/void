/* ======================================================================
   Void Signals — Phase B visual preview (isolated layer).
   Injected at serve time into the pristine production page. No production
   file, API, player, letter flow or Worker is touched.

   Everything here is EXPERIMENTAL. The placement masks are re-binned A1
   measurements of baseline 4589f84 (viz blob identical at 404c9b4); they are
   not approved production geometry. Simulated local events only.
   ====================================================================== */
(function () {
  'use strict';
  if (window.__VOID_SIGNALS_PREVIEW__) return;

  var DATA_URL = 'signals-preview/placement-data.json';
  var STORE = window.VoidSignalsStore || null;
  var STAR = window.VoidStarConfig || null;
  var STAR_FALLBACK = {
    preset: 'organic', style: 'spark', color: 'gold', size: 1, brightness: 1, glow: 1,
    softness: 0, motion: 'animated', motionIntensity: 1, glowTransitionMs: 900, drift: 0.35, experimental: true
  };
  function starCfg() { return STAR ? STAR.effective() : STAR_FALLBACK; }
  var storeSub = null;
  var STAR_PAD = 4;
  var SMAX = 3.5;
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));
  var MEMBER_R = [0, 1.70, 1.90], MEMBER_A = [0, 0.60, 4.10], MEMBER_S = [1, 0.82, 0.78];
  var COMP_R = [1.00, 1.25, 0.85], COMP_A = [2.35, 3.15, 5.20], COMP_S = [0.50, 0.38, 0.30];
  var CLASSES = {
    desktop: { slots: 12, star: 30, admin: 38, minGap: 76, size: 30 },
    tablet: { slots: 8, star: 28, admin: 36, minGap: 64, size: 28 },
    phone: { slots: 6, star: 26, admin: 34, minGap: 56, size: 26 }
  };

  /* ---------------- deterministic primitives (REV-3, unchanged) ---------------- */
  function hash32(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return h;
  }
  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clusterStars(starPx, adminPx, k) {
    var rot = ((hash32('site' + k) % 1000) / 1000) * Math.PI * 2;
    var jit = ((hash32('jit' + k) % 1000) / 1000 - 0.5);
    var S = starPx, out = [{ dx: 0, dy: 0, size: adminPx, role: 'primary' }], i, r, a;
    for (i = 1; i < 3; i++) { r = MEMBER_R[i] * S * (1 + jit * 0.10); a = rot + MEMBER_A[i] + jit * 0.5; out.push({ dx: Math.cos(a) * r, dy: Math.sin(a) * r, size: S * MEMBER_S[i], role: 'member' + i }); }
    for (i = 0; i < 3; i++) { r = COMP_R[i] * S * (1 + jit * 0.14); a = rot + COMP_A[i] + jit * 0.7; out.push({ dx: Math.cos(a) * r, dy: Math.sin(a) * r, size: S * COMP_S[i], role: 'comp' + i }); }
    return out;
  }

  /* ---------------- arrangement presets (Star Studio) ----------------
     A preset only decides where a cluster's points sit. The event engine,
     the placement rules and the message lifetime are untouched, and
     'organic' keeps the REV-3 cluster exactly as A1 measured it. New
     presets are added by extending this table, never by editing spawn(). */
  function rotatePts(list, ang) {
    var c = Math.cos(ang), s = Math.sin(ang), i, p;
    for (i = 1; i < list.length; i++) {
      p = list[i];
      var dx = p.dx * c - p.dy * s, dy = p.dx * s + p.dy * c;
      p.dx = dx; p.dy = dy;
    }
    return list;
  }
  function presetPoints(preset, starPx, adminPx, k) {
    if (!preset || preset === 'organic' || preset === 'custom') return clusterStars(starPx, adminPx, k);
    var rot = ((hash32('site' + k) % 1000) / 1000) * Math.PI * 2;
    var jit = ((hash32('jit' + k) % 1000) / 1000 - 0.5);
    var S = starPx, out = [{ dx: 0, dy: 0, size: adminPx, role: 'primary' }];
    var i, a, r, t, p;
    if (preset === 'constellation') {
      var line = [[0.95, -0.20, 0.80], [1.70, 0.10, 0.62], [2.45, -0.05, 0.48], [1.30, 0.70, 0.42], [2.05, 0.92, 0.32], [2.80, 0.62, 0.24]];
      for (i = 0; i < line.length; i++) out.push({ dx: line[i][0] * S + jit * 3, dy: line[i][1] * S + jit * 3, size: S * line[i][2], role: 'p' + i });
      return rotatePts(out, rot * 0.10 - 0.35);
    }
    if (preset === 'circular') {
      for (i = 0; i < 6; i++) { a = rot + i * Math.PI / 3; r = S * (i % 2 ? 1.55 : 1.12); out.push({ dx: Math.cos(a) * r, dy: Math.sin(a) * r, size: S * (i % 2 ? 0.36 : 0.60), role: 'r' + i }); }
      return out;
    }
    if (preset === 'spiral') {
      for (i = 0; i < 6; i++) { a = rot + i * GOLDEN * 2.1; r = S * 0.66 * Math.sqrt(i + 1); out.push({ dx: Math.cos(a) * r, dy: Math.sin(a) * r, size: S * (0.70 - i * 0.07), role: 's' + i }); }
      return out;
    }
    if (preset === 'geometric') {
      var sq = [[-1, -1], [1, -1], [1, 1], [-1, 1]], q = S * 0.95;
      for (i = 0; i < 4; i++) out.push({ dx: sq[i][0] * q, dy: sq[i][1] * q, size: S * 0.50, role: 'g' + i });
      out.push({ dx: 0, dy: -S * 1.72, size: S * 0.32, role: 'g4' });
      out.push({ dx: 0, dy: S * 1.72, size: S * 0.32, role: 'g5' });
      return rotatePts(out, rot * 0.04);
    }
    if (preset === 'heart') {
      for (i = 0; i < 6; i++) {
        t = i * Math.PI * 2 / 6 + Math.PI / 2;
        out.push({
          dx: S * 0.62 * (16 * Math.pow(Math.sin(t), 3)) / 16,
          dy: -S * 0.62 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16,
          size: S * (i % 2 ? 0.40 : 0.58), role: 'h' + i
        });
      }
      return out;
    }
    if (preset === 'star') {
      for (i = 0; i < 5; i++) { a = rot - Math.PI / 2 + i * Math.PI * 2 / 5; r = S * 1.62; out.push({ dx: Math.cos(a) * r, dy: Math.sin(a) * r, size: S * 0.44, role: 'v' + i }); }
      p = rot - Math.PI / 2 + Math.PI / 5;
      out.push({ dx: Math.cos(p) * S * 0.70, dy: Math.sin(p) * S * 0.70, size: S * 0.28, role: 'v5' });
      return out;
    }
    return clusterStars(starPx, adminPx, k);
  }

  /* ---------------- arrangement / state ---------------- */
  /* The admin view has no galaxy to decorate, but Void Star Studio still needs
     this exact arrangement math for its preview stage: one source of truth for
     placement geometry (configuration architecture §7, item 5). */
  window.VoidStarShapes = { clusterStars: clusterStars, rotatePts: rotatePts, presetPoints: presetPoints };
  if (/[?&]admin=(?:1|true)/.test(location.search)) return;
  var DATA = null;
  var cfg = {
    enabled: true,
    rule: 'R-F',
    thr: 0.15,
    size: 30,
    separation: 76,
    centreGuard: 0.22,
    companions: true,
    glow: 1,
    enterMs: 900,
    /* lifetime is a message property, not a reading rule: 0 = persistent
       (available until server-defined expiration or administrative removal) */
    lifeMs: 0,
    importantLifeMs: 0,
    railReserve: true,
    fallback: 'hold',
    reducedMotion: false,
    autoDemo: false,
    showBoxes: false,
    showCentre: false,
    seed: 20261126,
    order: 'ring',
    maxSignals: 12
  };
  var state = {
    vp: 'desktop', geom: null, signals: [], held: [], log: [], seq: 0,
    counters: { spawned: 0, placed: 0, held: 0, expired: 0, revealed: 0, edge: 0, chrome: 0, centre: 0, bright: 0, separation: 0, capacity: 0 },
    candidates: [], candKey: '', masks: {}, maskKey: '',
    metrics: null, ready: false, destroyed: false
  };
  var timers = [];
  var listeners = [];
  function later(fn, ms) { var t = setTimeout(function () { timers = timers.filter(function (x) { return x !== t; }); fn(); }, ms); timers.push(t); return t; }
  function listen(target, ev, fn, opt) { target.addEventListener(ev, fn, opt); listeners.push([target, ev, fn, opt]); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function round(v, p) { var m = Math.pow(10, p || 1); return Math.round(v * m) / m; }

  /* ---------------- host ---------------- */
  var host = document.createElement('div');
  host.id = 'signals-root';
  /* belt-and-braces for the brief window before the player root exists */
  host.style.cssText = 'visibility:visible !important;opacity:1 !important;';
  host.innerHTML =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    '<linearGradient id="sigGoldGrad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#fff8e8"/><stop offset=".45" stop-color="#f6c86a"/><stop offset="1" stop-color="#b8862f"/></linearGradient>' +
    '<linearGradient id="sigSilverGrad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#dce6f0"/><stop offset="1" stop-color="#93a6bd"/></linearGradient>' +
    '</defs></svg>' +
    '<div class="signals-field" id="signals-field"></div>' +
    '<div class="signals-shelf" id="signals-shelf" hidden><span class="signals-shelf__label">Held — no legal position</span><span class="signals-shelf__items" id="signals-shelf-items"></span></div>' +
    '<div class="signals-reveal" id="signals-reveal" hidden role="dialog" aria-label="Signal detail (demo data)"></div>' +
    '<p id="signals-live" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);margin:0" role="status" aria-live="polite"></p>';
  /* The production music-mode sweep (void-music.js sweep()) force-hides every
     visible direct child of html/body, so the layer lives inside the exempt
     player root instead of on body. */
  var mountObserver = null;
  function mountHost() {
    var target = document.getElementById('void-music-root') || document.body;
    if (host.parentNode === target && !host.hasAttribute('data-vm-swept')) return;
    host.removeAttribute('data-vm-swept');
    host.style.removeProperty('display');
    target.appendChild(host);
    if (target !== document.body && mountObserver) { mountObserver.disconnect(); mountObserver = null; }
  }
  document.body.appendChild(host);
  mountHost();
  if (host.parentNode === document.body && window.MutationObserver) {
    mountObserver = new MutationObserver(function () {
      if (document.getElementById('void-music-root')) mountHost();
    });
    mountObserver.observe(document.body, { childList: true });
  }
  var field = host.querySelector('#signals-field');
  var shelf = host.querySelector('#signals-shelf');
  var shelfItems = host.querySelector('#signals-shelf-items');
  var revealEl = host.querySelector('#signals-reveal');
  var liveEl = host.querySelector('#signals-live');

  /* ---------------- live geometry ---------------- */
  function classify(w, h) {
    if (w >= 1100) return 'desktop';
    if (w >= 620) return 'tablet';
    return 'phone';
  }
  function readGeom() {
    var w = window.innerWidth, h = window.innerHeight;
    var V = window.VoidMusicViz && window.VoidMusicViz._test && window.VoidMusicViz._test.V;
    var cx, cy, scale, live = false;
    if (V && V.vw === w && V.vh === h && isFinite(V.scale) && V.scale > 0) {
      cx = V.cx; cy = V.cy; scale = V.scale; live = true;
    } else {
      var portrait = w / h < 0.8;
      scale = portrait ? w * 0.92 : Math.min(w * 0.44, h * 0.95);
      cx = w / 2; cy = h * (portrait ? 0.40 : 0.45);
    }
    return { w: w, h: h, cx: cx, cy: cy, scale: scale, live: live, vp: classify(w, h) };
  }

  /* ---------------- mask decode + sampling ---------------- */
  function decodeMask(enc, n) {
    var bits = new Uint8Array(n * n), i;
    if (!enc) return bits;
    if (enc.enc === 'b64') {
      var raw = atob(enc.data);
      for (i = 0; i < bits.length; i++) bits[i] = (raw.charCodeAt(i >> 3) >> (i & 7)) & 1;
    } else {
      var runs = enc.data, at = 0, val = 0;
      for (var r = 0; r < runs.length; r++) {
        for (var j = 0; j < runs[r] && at < bits.length; j++) bits[at++] = val;
        val = val ? 0 : 1;
      }
    }
    return bits;
  }
  function frame() { return DATA.frame; }
  function binOf(u, f) { return Math.floor((u - f.uMin) / f.step); }
  function rectBright(bits, g, x0, y0, x1, y1) {
    var f = frame(), n = f.n;
    var c0 = binOf((x0 - g.cx) / g.scale, f), c1 = binOf((x1 - g.cx) / g.scale, f);
    var r0 = binOf((y0 - g.cy) / g.scale, f), r1 = binOf((y1 - g.cy) / g.scale, f);
    if (c1 < 0 || r1 < 0 || c0 >= n || r0 >= n) return false;
    c0 = clamp(c0, 0, n - 1); c1 = clamp(c1, 0, n - 1); r0 = clamp(r0, 0, n - 1); r1 = clamp(r1, 0, n - 1);
    for (var r = r0; r <= r1; r++) { var row = r * n; for (var c = c0; c <= c1; c++) if (bits[row + c]) return true; }
    return false;
  }
  function pointBright(bits, g, x, y) {
    var f = frame(), n = f.n;
    var c = binOf((x - g.cx) / g.scale, f), r = binOf((y - g.cy) / g.scale, f);
    if (c < 0 || r < 0 || c >= n || r >= n) return false;
    return !!bits[r * n + c];
  }
  function maskFor(rule, thr) {
    var vp = DATA.viewports[state.vp];
    if (!vp || !vp.masks[rule]) return null;
    var key = state.vp + '|' + rule + '|' + thr;
    if (state.masks[key]) return state.masks[key];
    var enc = vp.masks[rule][String(thr)];
    if (!enc) return null;
    var bits = decodeMask(enc, frame().n);
    state.masks[key] = bits;
    return bits;
  }
  function referenceField() {
    /* fixed ordering field: independent of the selected rule/threshold, so changing
       the experiment can never reshape a candidate's geometry (A1 §2D discipline). */
    var key = state.vp + '|order';
    if (state.masks[key]) return state.masks[key];
    var vp = DATA.viewports[state.vp];
    var bits = decodeMask(vp.masks['R-F']['0.05'], frame().n);
    state.masks[key] = bits;
    return bits;
  }

  /* ---------------- chrome exclusion (measured live, on demand) ---------------- */
  var CHROME_SEL = '.vm-dock, .vm-seek, .vm-meta, .vm-corner, .vm-hud, .vm-fs, .vm-mini-wrap, .vm-open, ' +
    '.vm-pop.is-open, .vm-queue-pop.is-open, .vm-vol-pop.is-open, .vm-sound-pop.is-open, ' +
    '#void-topnav, #void-reopen, #void-gl-note, #void-counter, #void-golden-status, ' +
    '#void-golden-modal, #void-golden-share, #void-invite, #void-galaxy-stats, ' +
    '.signals-instrument, .signals-tab, .signals-shelf, .signals-reveal';
  function collectChrome() {
    var out = [], nodes = document.querySelectorAll(CHROME_SEL), i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el === host) continue;
      if (el === revealEl && revealEl.hidden) continue;
      var cs = window.getComputedStyle(el);
      /* playback chrome stays reserved even while the HUD fades out, so a
         signal can never land on the seek bar's click area (seek handoff) */
      var essential = el.classList.contains('vm-dock') || el.classList.contains('vm-seek') || el.classList.contains('vm-open');
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.02) {
        /* the dormant rail is still reserved when railReserve is on (A1 K1/K3) */
        if (!(cfg.railReserve && el.id === 'void-topnav') && !essential) continue;
      }
      var r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) continue;
      var pad = STAR_PAD + (el.classList.contains('vm-seek') || el.classList.contains('vm-dock') ? 8 : 0);
      out.push({ id: el.id || String(el.className).slice(0, 30), x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 });
    }
    if (cfg.railReserve) {
      var rail = document.getElementById('void-topnav');
      if (rail) {
        var rr = rail.getBoundingClientRect();
        var found = out.some(function (o) { return o.id === 'void-topnav'; });
        if (!found && rr.width >= 10) out.push({ id: 'void-topnav(reserved)', x: rr.left - STAR_PAD, y: rr.top - STAR_PAD, w: rr.width + STAR_PAD * 2, h: rr.height + STAR_PAD * 2 });
      }
    }
    return out;
  }
  function inChrome(x, y, half, rects) {
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (x + half > r.x && x - half < r.x + r.w && y + half > r.y && y - half < r.y + r.h) return r.id;
    }
    return null;
  }
  function overlapArea(x, y, w, h, rects) {
    var a = 0, i;
    for (i = 0; i < rects.length; i++) {
      var r = rects[i];
      var ox = Math.min(x + w, r.x + r.w) - Math.max(x, r.x);
      var oy = Math.min(y + h, r.y + r.h) - Math.max(y, r.y);
      if (ox > 0 && oy > 0) a += ox * oy;
    }
    return a;
  }

  /* ---------------- candidate field ---------------- */
  function buildCandidates() {
    var g = state.geom, cls = CLASSES[state.vp];
    var key = [state.vp, g.w, g.h, round(g.cx, 1), round(g.cy, 1), round(g.scale, 1), cfg.seed, cfg.separation, cfg.order].join('|');
    if (state.candKey === key && state.candidates.length) return state.candidates;
    var ref = referenceField();
    var step = Math.max(26, cfg.separation * 0.62);
    var rnd = mulberry(cfg.seed);
    var list = [], gx, gy;
    var inset = cls.admin / 2 + STAR_PAD + 6;
    for (gy = inset; gy <= g.h - inset; gy += step) {
      for (gx = inset; gx <= g.w - inset; gx += step) {
        var jx = (rnd() - 0.5) * step * 0.62, jy = (rnd() - 0.5) * step * 0.62;
        var x = clamp(gx + jx, inset, g.w - inset), y = clamp(gy + jy, inset, g.h - inset);
        list.push({ x: x, y: y, b: pointBright(ref, g, x, y) ? 1 : 0, d: Math.hypot(x - g.cx, y - g.cy) });
      }
    }
    /* dark-first, then the chosen spatial preference, then stable position.
       The ordering field is fixed (R-F @ 0.05), so changing rule/threshold can never
       reshape a candidate's geometry — A1 §2D discipline. */
    var pref = cfg.order, ringR = 1.02 * g.scale;
    function prefKey(c) {
      if (pref === 'ring') return Math.abs(c.d - ringR);
      if (pref === 'far') return -c.d;
      return 0;
    }
    list.sort(function (a, b) { return a.b - b.b || prefKey(a) - prefKey(b) || a.x - b.x || a.y - b.y; });
    var kept = [];
    for (var i = 0; i < list.length && kept.length < 96; i++) {
      var c = list[i], ok = true;
      for (var j = 0; j < kept.length; j++) if (Math.hypot(kept[j].x - c.x, kept[j].y - c.y) < cfg.separation) { ok = false; break; }
      if (ok) kept.push({ x: c.x, y: c.y, i: kept.length });
    }
    state.candidates = kept;
    state.candKey = key;
    return kept;
  }

  /* ---------------- legality test ---------------- */
  function starsFor(k) {
    var cls = CLASSES[state.vp];
    var sc = starCfg();
    var sizePx = cfg.size * (sc.experimental ? sc.size : 1);
    var scaleRatio = sizePx / cls.admin;
    var all = presetPoints(sc.experimental ? sc.preset : 'organic', cls.star * scaleRatio, sizePx, k);
    if (!cfg.companions) return [all[0]];
    return all;
  }
  function testPosition(x, y, k, g, rects, occupied) {
    var stars = starsFor(k);
    var guardR = cfg.centreGuard * g.scale;
    var rule = cfg.rule, thr = cfg.thr;
    var vp = DATA.viewports[state.vp];
    var bits = (rule === 'R-C' || rule === 'R-C2' || rule === 'R-Cn' || rule === 'R-F' || rule === 'R-G' || rule === 'R-A' || rule === 'R-B') ? maskFor(rule === 'R-A' || rule === 'R-B' ? 'R-C' : rule, thr) : null;
    var discR = 0;
    if (rule === 'R-A') discR = 0.911 * g.scale;
    else if (rule === 'R-B') {
      var md = vp.measuredDiscPx[String(thr)];
      discR = md ? md * (g.scale / vp.scale) : 0.911 * g.scale;
    }
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i], sx = x + s.dx, sy = y + s.dy, half = s.size / 2 + STAR_PAD;
      if (sx < half || sx > g.w - half || sy < half || sy > g.h - half) return { ok: false, reason: 'edge', star: s.role };
      var cr = inChrome(sx, sy, half, rects);
      if (cr) return { ok: false, reason: 'chrome', star: s.role, hit: cr };
      if (Math.hypot(sx - g.cx, sy - g.cy) < guardR + half) return { ok: false, reason: 'centre', star: s.role };
      if (discR && Math.hypot(sx - g.cx, sy - g.cy) < discR + half) return { ok: false, reason: 'bright', star: s.role, hit: 'disc' };
      if (bits && rectBright(bits, g, sx - half, sy - half, sx + half, sy + half)) return { ok: false, reason: 'bright', star: s.role, hit: rule };
    }
    for (var o = 0; o < occupied.length; o++) {
      if (Math.hypot(occupied[o].x - x, occupied[o].y - y) < cfg.separation) return { ok: false, reason: 'separation', star: 'primary' };
    }
    return { ok: true, stars: stars };
  }
  function findSpot(k, occupied) {
    var g = state.geom, rects = collectChrome(), cands = buildCandidates();
    var reasons = { edge: 0, chrome: 0, centre: 0, bright: 0, separation: 0 };
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i], res = testPosition(c.x, c.y, k, g, rects, occupied);
      if (res.ok) return { ok: true, x: c.x, y: c.y, ci: i, stars: res.stars, tried: i + 1, reasons: reasons };
      reasons[res.reason]++;
    }
    return { ok: false, tried: cands.length, reasons: reasons };
  }

  /* ---------------- demo content (simulated, local only) ---------------- */
  var AMBIENT = [
    { t: 'A letter reached the void', b: 'Sample ambient event. Nothing was sent, stored or read from production.' },
    { t: 'Someone is listening tonight', b: 'Simulated presence pulse from the local demo generator.' },
    { t: 'The queue grew by one', b: 'Demo queue activity — the real queue is untouched.' },
    { t: 'A quiet star joined the field', b: 'Local visual sample used to study entrance and fade timing.' },
    { t: 'Night-side visitor', b: 'Simulated visit. No counter was incremented anywhere.' },
    { t: 'Aurora Drift played through', b: 'Demo completion event for the local tone, not a production track.' }
  ];
  var IMPORTANT = [
    { t: 'A letter is waiting for review', b: 'Simulated owner-facing event. No Notification Center entry is created.' },
    { t: 'Owner action requested', b: 'Demo priority signal — distinguishable by silver core and gold ring.' },
    { t: 'Playback reached the far side', b: 'Local sample of a higher-weight event, for placement study only.' },
    { t: 'Two signals arrived together', b: 'Simulated burst used to test separation and collision handling.' }
  ];

  /* ---------------- rendering ---------------- */
  var GLYPH = '<svg class="sig__glyph" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path class="sig-hair" d="M12 0.8 V23.2 M0.8 12 H23.2" opacity=".22"/>' +
    '<path class="sig-spark" d="M12 1.7 L13.45 9.15 L21.3 12 L13.45 14.85 L12 22.3 L10.55 14.85 L2.7 12 L10.55 9.15 Z"/>' +
    '<circle class="sig-pip" cx="12" cy="12" r="1.05"/></svg>';

  function signalEl(sig, quiet) {
    var el = document.createElement('div');
    el.className = 'sig sig--' + sig.type + (sig.type === 'important' && !quiet ? ' is-arriving' : '');
    el.style.left = round(sig.x, 1) + 'px';
    el.style.top = round(sig.y, 1) + 'px';
    el.style.setProperty('--sig-size', round(sig.size, 1) + 'px');
    el.style.setProperty('--sig-phase', (-((hash32('ph' + sig.k) % 700) / 100)).toFixed(2) + 's');
    el.style.setProperty('--sig-box', round(sig.box, 1) + 'px');
    applyStarType(el, sig.type);
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    var read = STORE ? STORE.isRead(sig.msgId) : false;
    if (read) el.classList.add('is-read');
    el.setAttribute('aria-label', sigAria(sig, read));
    el.dataset.id = String(sig.id);
    el.dataset.msg = String(sig.msgId);
    var body = document.createElement('div');
    body.className = 'sig__body';
    body.innerHTML = '<div class="sig__halo"></div>' + GLYPH +
      (sig.type === 'important' ? '<svg class="sig__ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.6"/></svg>' : '');
    var i;
    for (i = 1; i < sig.stars.length; i++) {
      var s = sig.stars[i];
      var comp = document.createElement('span');
      comp.className = 'sig__comp';
      var d = Math.max(2, round(s.size * 0.42, 1));
      comp.style.width = d + 'px'; comp.style.height = d + 'px';
      comp.style.margin = (-d / 2) + 'px 0 0 ' + (-d / 2) + 'px';
      comp.style.transform = 'translate(' + round(s.dx, 1) + 'px,' + round(s.dy, 1) + 'px)';
      body.appendChild(comp);
    }
    el.appendChild(body);
    listen(el, 'click', function (ev) { ev.stopPropagation(); openMessage(sig.msgId); });
    listen(el, 'keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openMessage(sig.msgId); } });
    if (quiet) el.classList.add('is-in');
    if (sig.type === 'important' && !quiet) later(function () { el.classList.remove('is-arriving'); }, 1600);
    return el;
  }

  /* ---- Star Studio wiring (§5/§6/§7 item 4): presentation, never content ---- */
  function fallbackTokens(sc) {
    var on = !!sc.experimental, still = sc.motion === 'static' || !on;
    var colour = { a: '#f6c86a', b: '#b8862f', core: '#fff8e8' };
    return {
      '--ss-a': colour.a, '--ss-b': colour.b, '--ss-core': colour.core,
      '--ss-size': String(sc.size), '--ss-bright': String(sc.brightness),
      '--ss-glow': String(on ? sc.glow : 1),
      '--ss-soft': (on ? sc.softness * 2.4 : 0).toFixed(2) + 'px',
      '--ss-motion': String(still ? 0 : sc.motionIntensity),
      '--ss-breath': (7.5 / Math.max(0.25, sc.motionIntensity)).toFixed(2) + 's',
      '--ss-glow-ms': Math.round(on ? sc.glowTransitionMs : 400) + 'ms',
      '--ss-drift': (still ? 0 : sc.drift).toFixed(2)
    };
  }
  function applyStar() {
    var sc = starCfg();
    var tk = STAR ? STAR.tokens() : null;
    var t = tk ? tk.tokens : fallbackTokens(sc);
    var still = sc.motion === 'static' || !sc.experimental;
    var k;
    for (k in t) if (Object.prototype.hasOwnProperty.call(t, k)) host.style.setProperty(k, t[k]);
    host.dataset.style = tk ? tk.data.style : (sc.experimental ? sc.style : 'spark');
    host.dataset.preset = tk ? tk.data.preset : (sc.experimental ? sc.preset : 'organic');
    host.dataset.color = tk ? tk.data.color : (sc.experimental ? sc.color : 'gold');
    host.dataset.soft = tk ? tk.data.soft : (sc.experimental && sc.softness > 0 ? '1' : '0');
    host.dataset.motion = tk ? tk.data.motion : (still ? 'static' : 'animated');
    host.dataset.experimental = sc.experimental ? 'on' : 'off';
  }
  /* per-event-type profile: only the tokens that differ from the global layer */
  function applyStarType(el, type) {
    if (!STAR) return;
    var t = STAR.tokens(type).tokens, g = STAR.tokens().tokens, k;
    for (k in t) if (Object.prototype.hasOwnProperty.call(t, k) && t[k] !== g[k]) el.style.setProperty(k, t[k]);
  }
  /* re-shape every star with the current preset without moving or re-reading it */
  function restarSignals() {
    var i;
    for (i = 0; i < state.signals.length; i++) {
      var s = state.signals[i];
      if (!s.el || !s.el.parentNode) continue;
      s.stars = starsFor(s.k);
      s.box = boxOf(s.stars);
      var next = signalEl(s, true);
      if (revealFor === s.msgId) next.classList.add('is-held');
      s.el.parentNode.replaceChild(next, s.el);
      s.el = next;
    }
    for (i = 0; i < state.held.length; i++) { state.held[i].stars = starsFor(state.held[i].k); state.held[i].box = boxOf(state.held[i].stars); }
    renderShelf();
    log('info', 'stars re-shaped from the studio preset — positions and messages untouched');
  }

  function boxOf(stars) {
    var mx = 0;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      mx = Math.max(mx, Math.abs(s.dx) + s.size / 2, Math.abs(s.dy) + s.size / 2);
    }
    return (mx + STAR_PAD) * 2;
  }

  function log(kind, text) {
    state.log.unshift({ kind: kind, text: text, at: Date.now() });
    if (state.log.length > 60) state.log.pop();
    if (window.VoidSignalsPreview && window.VoidSignalsPreview.onlog) window.VoidSignalsPreview.onlog();
  }
  function announce(text) { liveEl.textContent = text; }

  function spawn(type, opts) {
    if (!state.ready || !cfg.enabled) return null;
    opts = opts || {};
    if (state.signals.length >= cfg.maxSignals) {
      state.counters.capacity++;
      log('reject', 'capacity: ' + state.signals.length + '/' + cfg.maxSignals + ' signals already in the field');
      return null;
    }
    state.seq++;
    var k = state.seq;
    var occupied = state.signals.map(function (s) { return { x: s.x, y: s.y }; });
    var spot = findSpot(k, occupied);
    var pool = type === 'important' ? IMPORTANT : AMBIENT;
    var pick = pool[(hash32('demo' + cfg.seed + ':' + k) >>> 0) % pool.length];
    /* identity and lifetime belong to the message store, never to the glyph */
    var msg = STORE ? (STORE.demoFor ? STORE.add(STORE.demoFor(type, cfg.seed, k)) : STORE.add({ type: type, title: pick.t, body: pick.b })) : null;
    var sig = {
      id: 'sig-' + k, k: k, type: type,
      msgId: msg ? msg.id : 'local-' + k,
      title: (msg && msg.title) || opts.title || pick.t,
      body: (msg && msg.body) || opts.body || pick.b,
      size: cfg.size, rule: cfg.rule, thr: cfg.thr, seed: cfg.seed,
      born: Date.now(), life: type === 'important' ? cfg.importantLifeMs : cfg.lifeMs,
      x: 0, y: 0, stars: [], box: 0, ci: -1, held: false
    };
    state.counters.spawned++;
    if (!spot.ok) {
      sig.held = true;
      state.counters.held++;
      for (var r in spot.reasons) state.counters[r] += spot.reasons[r];
      state.held.push(sig);
      log('held', type + ' #' + k + ' held after ' + spot.tried + ' candidates — ' + reasonText(spot.reasons));
      announce('Signal held: no legal position under the current experiment.');
      renderShelf();
      sampleMetrics();
      if (window.VoidSignalsPreview && window.VoidSignalsPreview.onchange) window.VoidSignalsPreview.onchange();
      return sig;
    }
    sig.x = spot.x; sig.y = spot.y; sig.ci = spot.ci; sig.stars = spot.stars; sig.box = boxOf(spot.stars);
    sig.el = signalEl(sig);
    field.appendChild(sig.el);
    requestAnimationFrame(function () { requestAnimationFrame(function () { sig.el.classList.add('is-in'); }); });
    state.signals.push(sig);
    state.counters.placed++;
    if (sig.life > 0) sig.timer = later(function () { expire(sig.id); }, sig.life);
    log('placed', type + ' #' + k + ' at ' + Math.round(sig.x) + ',' + Math.round(sig.y) + ' (candidate ' + spot.ci + ', ' + cfg.rule + ' @ ' + cfg.thr + ')');
    announce((type === 'important' ? 'Important' : 'Ambient') + ' demo signal placed.');
    sampleMetrics();
    if (window.VoidSignalsPreview && window.VoidSignalsPreview.onchange) window.VoidSignalsPreview.onchange();
    return sig;
  }
  function reasonText(r) {
    var parts = [];
    for (var k in r) if (r[k]) parts.push(k + ' ' + r[k]);
    return parts.length ? parts.join(', ') : 'no candidate passed';
  }
  function expire(id) {
    var i, sig = null;
    for (i = 0; i < state.signals.length; i++) if (state.signals[i].id === id) { sig = state.signals[i]; break; }
    if (!sig) return;
    state.signals.splice(i, 1);
    state.counters.expired++;
    /* the glyph faded; the message did not. If its window is open it stays
       open and simply loses its star (detached mode). */
    if (revealFor === sig.msgId) renderReveal(sig.msgId);
    if (sig.el) {
      sig.el.classList.add('is-out');
      var el = sig.el;
      later(function () { if (el.parentNode) el.parentNode.removeChild(el); }, cfg.reducedMotion ? 20 : 660);
    }
    log('info', sig.type + ' #' + sig.k + ' glyph faded out — message ' + sig.msgId + ' stays available');
    if (window.VoidSignalsPreview && window.VoidSignalsPreview.onchange) window.VoidSignalsPreview.onchange();
  }
  function renderShelf() {
    shelfItems.textContent = '';
    var pnl = document.querySelector('.signals-instrument');
    host.classList.toggle('has-panel', !!pnl && !pnl.hidden);
    var show = cfg.fallback === 'shelf' && state.held.length > 0;
    shelf.hidden = !show;
    if (!show) return;
    /* sit above the reserved playback dock, never across it */
    var dock = document.querySelector('.vm-dock');
    var dr = dock ? dock.getBoundingClientRect() : null;
    var bottom = dr && dr.height > 10 ? Math.max(12, state.geom.h - dr.top + 10) : 12;
    shelf.style.bottom = round(bottom, 1) + 'px';
    for (var i = 0; i < state.held.length; i++) {
      (function (sig) {
        var b = document.createElement('button');
        b.type = 'button';
        var read = STORE ? STORE.isRead(sig.msgId) : false;
        b.className = 'signals-shelf__item signals-shelf__item--' + sig.type + (read ? ' is-read' : '');
        b.innerHTML = '<span class="signals-shelf__pip"></span>' + escapeHtml(sig.title);
        b.setAttribute('aria-label', 'Open held message: ' + sig.title + (read ? ' (read this session — opens again)' : ''));
        listen(b, 'click', function () { openMessage(sig.msgId); });
        shelfItems.appendChild(b);
      })(state.held[i]);
    }
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------------- reveal window: message-keyed, explicit-close-only ------
     Owner contract (§2): a click opens the window; it stays open until the
     user closes it with the close control or Escape. Nothing else may close
     it — no reading timer, no display timer, no animation end, no background
     state change, no unrelated Galaxy interaction, no expiry, no resize, and
     no click outside the window. Closing only dims the star: the message
     stays available and clickable, and a later click reopens the same text. */
  var revealFor = null, revealHidPanel = false;

  function findSignal(msgId) {
    var i;
    for (i = 0; i < state.signals.length; i++) if (state.signals[i].msgId === msgId) return state.signals[i];
    for (i = 0; i < state.held.length; i++) if (state.held[i].msgId === msgId) return state.held[i];
    return null;
  }
  function sigAria(sig, read) {
    return (sig.type === 'important' ? 'Important' : 'Ambient') + ' demo signal: ' + sig.title +
      (read ? ' (read this session — opens again)' : '');
  }
  /* the dim/awake visual is derived from the store, never from a local flag */
  function refreshReadStates() {
    if (!STORE) return;
    var i, list = state.signals.concat(state.held);
    for (i = 0; i < list.length; i++) {
      var sig = list[i];
      if (!sig.el) continue;
      var read = STORE.isRead(sig.msgId);
      sig.el.classList.toggle('is-read', read && revealFor !== sig.msgId);
      sig.el.setAttribute('aria-label', sigAria(sig, read));
    }
    renderShelf();
  }

  function openMessage(msgId) {
    var msg = STORE ? STORE.get(msgId) : null;
    if (!msg) { log('warn', 'message ' + msgId + ' is not available in this session'); return false; }
    if (revealFor === msgId) return true;
    revealFor = msgId;
    state.counters.revealed++;
    /* phone: the console yields its band to the window, and returns on close */
    revealHidPanel = false;
    if (state.geom.w < 620) {
      var pnl = document.querySelector('.signals-instrument');
      var tb = document.querySelector('.signals-tab');
      if (pnl && !pnl.hidden) { pnl.hidden = true; if (tb) tb.hidden = false; revealHidPanel = true; }
    }
    renderReveal(msgId);
    if (window.VoidSignalsPreview && window.VoidSignalsPreview.onchange) window.VoidSignalsPreview.onchange();
    return true;
  }

  /* Paints the open window. Re-run (without touching timers) whenever the
     message, its star, or the read state changes while the window is open. */
  function renderReveal(msgId) {
    var msg = STORE ? STORE.get(msgId) : null;
    if (!msg) return false;
    var sig = findSignal(msgId);
    var g = state.geom;
    var read = STORE ? STORE.isRead(msgId) : false;
    var life = msg.expiresAt ? 'expires ' + new Date(msg.expiresAt).toLocaleString() : 'available until removed';
    var wasOpen = revealEl.classList.contains('is-open');
    revealEl.className = 'signals-reveal signals-reveal--' + msg.type;
    revealEl.hidden = false;
    revealEl.innerHTML =
      '<button class="signals-reveal__close" type="button" aria-label="Close this message">&times;</button>' +
      '<div class="signals-reveal__type"><span class="signals-reveal__dot"></span>' +
      (msg.type === 'important' ? 'Important signal' : 'Ambient signal') +
      '<span class="signals-reveal__flag">' + (read ? 're-read · read this session' : 'new this session') + '</span></div>' +
      '<h3 class="signals-reveal__title">' + escapeHtml(msg.title) + '</h3>' +
      '<p class="signals-reveal__body">' + escapeHtml(msg.body) + '</p>' +
      '<div class="signals-reveal__meta"><span>' + escapeHtml(msg.id) + ' · ' + escapeHtml(life) + '</span>' +
      '<span>' + (sig ? (sig.held ? 'held · no legal position'
        : 'k' + sig.k + ' · ' + Math.round(sig.x) + ',' + Math.round(sig.y) + ' · r ' + Math.round(Math.hypot(sig.x - g.cx, sig.y - g.cy)) + 'px')
        : 'no star in the field · message still available') + '</span>' +
      '<span class="signals-reveal__demo">demo data</span></div>' +
      '<p class="signals-reveal__note">Closing keeps this star dim but clickable. Reading never removes the message.</p>';
    var closeBtn = revealEl.querySelector('.signals-reveal__close');
    listen(closeBtn, 'click', closeReveal);
    /* place beside the signal: flank candidates scored by real rect overlap
       against chrome and every signal footprint (including its own) */
    var w = revealEl.offsetWidth, h = revealEl.offsetHeight;
    var size = sig ? sig.size : 44;
    var ax = sig ? (sig.held ? g.w - 40 : sig.x) : g.cx;
    var ay = sig ? (sig.held ? 84 : sig.y) : g.cy;
    var off = size / 2 + 16;
    var cands = [
      { x: ax + off, y: ay - h / 2 },
      { x: ax - off - w, y: ay - h / 2 },
      { x: ax - w / 2, y: ay - off - h },
      { x: ax - w / 2, y: ay + off },
      { x: ax + off, y: ay - h + size / 2 },
      { x: ax - off - w, y: ay - h + size / 2 },
      { x: ax + off, y: ay - size / 2 },
      { x: ax - off - w, y: ay - size / 2 }
    ];
    var rects = collectChrome(), boxes = [], bi;
    for (bi = 0; bi < state.signals.length; bi++) {
      var bs = state.signals[bi], bh = bs.box / 2;
      boxes.push({ x: bs.x - bh, y: bs.y - bh, w: bh * 2, h: bh * 2 });
    }
    var best = null, bestScore = Infinity, ci;
    for (ci = 0; ci < cands.length; ci++) {
      var px = clamp(cands[ci].x, 12, Math.max(12, g.w - w - 12));
      var py = clamp(cands[ci].y, 12, Math.max(12, g.h - h - 12));
      var score = overlapArea(px, py, w, h, rects) * 3 + overlapArea(px, py, w, h, boxes);
      if (score < bestScore) { bestScore = score; best = { x: px, y: py }; }
      if (score === 0) break;
    }
    if (bestScore > 0) {
      /* no free flank: nearest completely clear hole on a coarse grid */
      var gx, gy, near = null, nearD = Infinity;
      for (gy = 12; gy <= g.h - h - 12; gy += 24) {
        for (gx = 12; gx <= g.w - w - 12; gx += 24) {
          if (overlapArea(gx, gy, w, h, rects) || overlapArea(gx, gy, w, h, boxes)) continue;
          var d = Math.hypot(gx + w / 2 - ax, gy + h / 2 - ay);
          if (d < nearD) { nearD = d; near = { x: gx, y: gy }; }
        }
      }
      if (near) best = near;
    }
    revealEl.style.left = round(best.x, 1) + 'px';
    revealEl.style.top = round(best.y, 1) + 'px';
    if (wasOpen) revealEl.classList.add('is-open');
    else requestAnimationFrame(function () { revealEl.classList.add('is-open'); });
    if (sig && sig.el) { sig.el.classList.add('is-held'); sig.el.classList.remove('is-read'); }
    log('info', 'window opened for ' + msg.type + ' message ' + msg.id + (read ? ' (re-read)' : '') + (sig ? '' : ' · no star in the field'));
    announce('Message opened: ' + msg.title + '. Demo data. It stays available after you close it.');
    return true;
  }

  /* The only path that hides the window is an explicit user action: the close
     control, Escape, or an administrative removal of the message itself. */
  function closeReveal() {
    var msgId = revealFor;
    if (!msgId) return;
    /* reading is recorded, the message is not consumed: the star dims in place */
    if (STORE) STORE.markRead(msgId);
    var sig = findSignal(msgId);
    if (sig && sig.el) sig.el.classList.remove('is-held');
    log('info', 'closed by user — message ' + msgId + ' dimmed and still available');
    hideRevealWindow();
  }
  function hideRevealWindow() {
    if (revealHidPanel) {
      var pnl2 = document.querySelector('.signals-instrument');
      var tb2 = document.querySelector('.signals-tab');
      if (pnl2) pnl2.hidden = false;
      if (tb2) tb2.hidden = true;
      revealHidPanel = false;
    }
    revealFor = null;
    revealEl.classList.remove('is-open');
    later(function () { revealEl.hidden = true; revealEl.textContent = ''; }, cfg.reducedMotion ? 10 : 320);
    refreshReadStates();
    if (window.VoidSignalsPreview && window.VoidSignalsPreview.onchange) window.VoidSignalsPreview.onchange();
  }

  /* Clears the visual field only. Messages are NOT deleted (§2): an open
     window keeps its text, and the Notification Center can still open them. */
  function clearAll() {
    var i;
    for (i = 0; i < state.signals.length; i++) {
      var s = state.signals[i];
      if (s.timer) clearTimeout(s.timer);
      if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
    }
    state.signals = [];
    state.held = [];
    renderShelf();
    if (revealFor) {
      if (STORE && !STORE.get(revealFor)) hideRevealWindow();
      else renderReveal(revealFor);
    }
    log('info', 'field cleared — every message stays available');
    if (window.VoidSignalsPreview && window.VoidSignalsPreview.onchange) window.VoidSignalsPreview.onchange();
  }
  /* ---------------- revalidate (geometry / rule changes) ---------------- */
  function revalidate() {
    state.geom = readGeom();
    state.vp = state.geom.vp;
    var g = state.geom;
    host.style.setProperty('--sig-cx', round(g.cx, 1) + 'px');
    host.style.setProperty('--sig-cy', round(g.cy, 1) + 'px');
    host.style.setProperty('--sig-guard', round(cfg.centreGuard * g.scale, 1) + 'px');
    field.classList.toggle('no-comps', !cfg.companions);
    field.classList.toggle('show-boxes', !!cfg.showBoxes);
    field.classList.toggle('show-centre', !!cfg.showCentre);
    host.classList.toggle('is-reduced', !!cfg.reducedMotion);
    host.style.setProperty('--sig-enter', cfg.enterMs + 'ms');
    host.style.setProperty('--sig-glow', String(cfg.glow));
    var rects = collectChrome();
    var kept = [], i;
    for (i = 0; i < state.signals.length; i++) {
      var s = state.signals[i];
      var others = state.signals.filter(function (o) { return o !== s; }).map(function (o) { return { x: o.x, y: o.y }; });
      var res = testPosition(s.x, s.y, s.k, g, rects, others);
      if (res.ok) { kept.push(s); continue; }
      state.counters[res.reason]++;
      var spot = findSpot(s.k, kept.map(function (o) { return { x: o.x, y: o.y }; }));
      if (spot.ok) {
        s.x = spot.x; s.y = spot.y; s.ci = spot.ci; s.stars = spot.stars; s.box = boxOf(spot.stars);
        s.el.style.left = round(s.x, 1) + 'px';
        s.el.style.top = round(s.y, 1) + 'px';
        s.el.style.setProperty('--sig-box', round(s.box, 1) + 'px');
        kept.push(s);
        log('info', '#' + s.k + ' moved to ' + Math.round(s.x) + ',' + Math.round(s.y) + ' after ' + res.reason);
      } else {
        if (s.timer) clearTimeout(s.timer);
        if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
        s.held = true; s.el = null;
        state.held.push(s);
        state.counters.held++;
        log('held', '#' + s.k + ' held after ' + res.reason + ' — no legal position');
      }
    }
    state.signals = kept;
    /* held signals get another chance whenever the experiment changes */
    var stillHeld = [];
    for (i = 0; i < state.held.length; i++) {
      var hs = state.held[i];
      if (state.signals.length >= cfg.maxSignals) { stillHeld.push(hs); continue; }
      var sp = findSpot(hs.k, state.signals.map(function (o) { return { x: o.x, y: o.y }; }));
      if (sp.ok) {
        (function (s) {
          s.held = false; s.x = sp.x; s.y = sp.y; s.ci = sp.ci; s.stars = sp.stars; s.box = boxOf(sp.stars);
          s.el = signalEl(s);
          field.appendChild(s.el);
          requestAnimationFrame(function () { requestAnimationFrame(function () { if (s.el) s.el.classList.add('is-in'); }); });
          state.signals.push(s);
          s.timer = later(function () { expire(s.id); }, Math.max(2500, s.life - (Date.now() - s.born)));
          log('placed', '#' + s.k + ' released from hold at ' + Math.round(s.x) + ',' + Math.round(s.y));
        })(hs);
      } else stillHeld.push(hs);
    }
    state.held = stillHeld;
    renderShelf();
    /* a resize, rule or threshold change re-places the window but never closes
       it, and never marks the message read (§2: only the user closes it) */
    if (revealFor) {
      if (STORE && !STORE.get(revealFor)) hideRevealWindow();
      else renderReveal(revealFor);
    }
  }

  /* ---------------- metrics: sampled on demand, never polled ---------------- */
  function sampleMetrics() {
    var m = null;
    try {
      if (window.VoidMusicViz && typeof window.VoidMusicViz.getMetrics === 'function') m = window.VoidMusicViz.getMetrics();
    } catch (e) { m = null; }
    state.metrics = m ? { stage: m.stage, fps: m.fps, cpuMs: m.cpuMs, tier: m.quality && m.quality.tier, rs: m.quality && m.quality.rs } : null;
    return state.metrics;
  }

  /* ---------------- auto demo (bounded timer chain, no interval) ---------------- */
  var autoTimer = null;
  function autoStep() {
    autoTimer = null;
    if (!cfg.autoDemo || !cfg.enabled || state.destroyed) return;
    var rnd = mulberry(cfg.seed + state.seq * 7919)();
    spawn(rnd < 0.28 ? 'important' : 'ambient');
    autoTimer = later(autoStep, 2600 + Math.round(rnd * 2600));
  }
  function syncAuto() {
    if (cfg.autoDemo && cfg.enabled && !autoTimer) autoTimer = later(autoStep, 700);
    if ((!cfg.autoDemo || !cfg.enabled) && autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  }

  /* ---------------- config ---------------- */
  function setConfig(patch, silent) {
    var structural = false, k;
    for (k in patch) {
      if (!Object.prototype.hasOwnProperty.call(cfg, k)) continue;
      if (cfg[k] !== patch[k]) structural = structural || ['rule', 'thr', 'size', 'separation', 'centreGuard', 'companions', 'railReserve', 'seed', 'enabled', 'order'].indexOf(k) >= 0;
      cfg[k] = patch[k];
    }
    if (cfg.enabled === false) { clearAll(); }
    field.style.display = cfg.enabled ? '' : 'none';
    if (structural) { state.candKey = ''; revalidate(); }
    else {
      host.style.setProperty('--sig-enter', cfg.enterMs + 'ms');
      host.style.setProperty('--sig-glow', String(cfg.glow));
      host.classList.toggle('is-reduced', !!cfg.reducedMotion);
      field.classList.toggle('show-boxes', !!cfg.showBoxes);
      field.classList.toggle('show-centre', !!cfg.showCentre);
      renderShelf();
    }
    syncAuto();
    if (!silent && window.VoidSignalsPreview && window.VoidSignalsPreview.onchange) window.VoidSignalsPreview.onchange();
    return cfg;
  }
  function applyViewportDefaults() {
    var cls = CLASSES[state.vp];
    cfg.maxSignals = cls.slots;
    cfg.size = cls.size;
    cfg.separation = cls.minGap;
  }
  function reset() {
    clearAll();
    state.seq = 0;
    state.counters = { spawned: 0, placed: 0, held: 0, expired: 0, revealed: 0, edge: 0, chrome: 0, centre: 0, bright: 0, separation: 0, capacity: 0 };
    state.log = [];
    state.candKey = '';
    cfg.rule = 'R-F'; cfg.thr = 0.15; cfg.companions = true; cfg.glow = 1; cfg.enterMs = 900;
    cfg.lifeMs = 0; cfg.importantLifeMs = 0; cfg.railReserve = true; cfg.fallback = 'hold';
    cfg.autoDemo = false; cfg.showBoxes = false; cfg.showCentre = false; cfg.enabled = true;
    cfg.seed = 20261126; cfg.centreGuard = 0.22; cfg.order = 'ring';
    applyViewportDefaults();
    field.style.display = '';
    revalidate(); syncAuto();
    log('info', 'experiment reset to the measured default (persistent cycle, thr 0.15)');
    if (window.VoidSignalsPreview && window.VoidSignalsPreview.onchange) window.VoidSignalsPreview.onchange();
  }
  function randomize() {
    cfg.seed = (Date.now() % 1000000) >>> 0;
    state.candKey = '';
    revalidate();
    log('info', 'seed randomised to ' + cfg.seed);
    if (window.VoidSignalsPreview && window.VoidSignalsPreview.onchange) window.VoidSignalsPreview.onchange();
  }

  /* ---------------- export ---------------- */
  function snapshot() {
    var g = state.geom;
    return {
      instrument: 'void-signals-phase-b-preview', at: new Date().toISOString(),
      status: 'EXPERIMENTAL visual preview — simulated local events, not approved production geometry',
      config: JSON.parse(JSON.stringify(cfg)),
      viewport: { class: state.vp, w: g.w, h: g.h, cx: round(g.cx, 1), cy: round(g.cy, 1), scale: round(g.scale, 1), liveRendererGeometry: g.live },
      counters: JSON.parse(JSON.stringify(state.counters)),
      metrics: state.metrics,
      candidates: state.candidates.length,
      signals: state.signals.map(function (s) {
        return { id: s.id, k: s.k, msgId: s.msgId, read: STORE ? STORE.isRead(s.msgId) : false, type: s.type, title: s.title, x: round(s.x, 1), y: round(s.y, 1), size: s.size, rule: s.rule, thr: s.thr, ci: s.ci, box: round(s.box, 1), r_px: round(Math.hypot(s.x - g.cx, s.y - g.cy), 1), r_of_scale: round(Math.hypot(s.x - g.cx, s.y - g.cy) / g.scale, 3) };
      }),
      held: state.held.map(function (s) { return { id: s.id, k: s.k, msgId: s.msgId, type: s.type, title: s.title }; }),
      /* presentation and lifetime are separate records by design (§7) */
      star: { config: starCfg(), tokens: (STAR ? STAR.tokens() : { tokens: fallbackTokens(starCfg()) }).tokens },
      messages: STORE ? { session: STORE.sessionId(), stats: STORE.stats(), entries: STORE.all() } : null,
      window: { open: revealFor, autoClosePaths: 'none — close control and Escape only' },
      log: state.log.slice(0, 40),
      isolation: { productionFilesModified: 0, network: 'all API traffic simulated locally', intercepted: (window.__VOID_PREVIEW__ && window.__VOID_PREVIEW__.intercepted.length) || 0 }
    };
  }
  function exportJSON() {
    var data = JSON.stringify(snapshot(), null, 1);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'void-signals-preview-' + state.vp + '-' + Date.now() + '.json';
    document.body.appendChild(a); a.click();
    later(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
    log('info', 'exported experiment snapshot (' + data.length + ' bytes)');
    return data.length;
  }

  /* ---------------- public surface ---------------- */
  var api = {
    version: 'phase-b-preview-2',
    config: cfg,
    state: state,
    store: STORE,
    data: function () { return DATA; },
    setConfig: setConfig,
    spawn: spawn,
    /* message-keyed window API (§2/§3/§4) */
    openMessage: openMessage,
    renderReveal: renderReveal,
    closeReveal: closeReveal,
    hideRevealWindow: hideRevealWindow,
    revealed: function () { return revealFor; },
    messages: function () { return STORE ? STORE.all() : []; },
    liveMessages: function () { return STORE ? STORE.live() : []; },
    readState: function (id) { return STORE ? STORE.isRead(id) : false; },
    markRead: function (id) { var ok = STORE ? STORE.markRead(id) : false; if (ok) refreshReadStates(); return ok; },
    markUnread: function (id) { var ok = STORE ? STORE.setUnread(id) : false; if (ok) refreshReadStates(); return ok; },
    removeMessage: function (id) {
      var i;
      for (i = state.signals.length - 1; i >= 0; i--) if (state.signals[i].msgId === id) expire(state.signals[i].id);
      for (i = state.held.length - 1; i >= 0; i--) if (state.held[i].msgId === id) { if (state.held[i].el) state.held[i].el.parentNode.removeChild(state.held[i].el); state.held.splice(i, 1); }
      renderShelf();
      if (revealFor === id) hideRevealWindow();
      var ok = STORE ? STORE.remove(id) : false;
      log('info', 'message ' + id + ' removed (administrative)');
      return ok;
    },
    resetSession: function () {
      var sid = STORE ? STORE.resetSession() : null;
      refreshReadStates();
      if (revealFor) renderReveal(revealFor);
      log('info', 'site session reset — unread brightness restored (' + sid + ')');
      return sid;
    },
    /* Star Studio API (§5/§6): appearance only, never message content */
    star: function () { return starCfg(); },
    setStar: function (patch) { if (STAR) STAR.setGlobal(patch); applyStar(); return starCfg(); },
    setExperimental: function (on) { if (STAR) STAR.setExperimental(!!on); applyStar(); return starCfg(); },
    resetStar: function () { if (STAR) STAR.reset(); applyStar(); return starCfg(); },
    reStar: function () { applyStar(); restarSignals(); return starCfg(); },
    starTokens: function () { return STAR ? STAR.tokens().tokens : {}; },
    clear: clearAll,
    reset: reset,
    randomize: randomize,
    revalidate: revalidate,
    exportJSON: exportJSON,
    snapshot: snapshot,
    sampleMetrics: sampleMetrics,
    geometry: readGeom,
    chrome: collectChrome,
    candidates: function () { return buildCandidates(); },
    testAt: function (x, y, k) { return testPosition(x, y, k || 1, state.geom, collectChrome(), []); },
    auditCompare: auditCompare,
    refreshReadStates: refreshReadStates,
    destroy: destroy,
    onchange: null, onlog: null
  };
  window.__VOID_SIGNALS_PREVIEW__ = api;
  window.VoidSignalsPreview = api;

  /* compare live placement against the A1X-5 audit tables at the measured size */
  function auditCompare() {
    var vp = DATA.viewports[state.vp];
    var saved = { size: cfg.size, companions: cfg.companions, sep: cfg.separation, max: cfg.maxSignals, guard: cfg.centreGuard, order: cfg.order };
    cfg.size = vp.cluster.admin; cfg.companions = true; cfg.separation = vp.cluster.minGap;
    cfg.maxSignals = vp.cluster.slots; cfg.centreGuard = 0; cfg.order = 'audit';
    state.candKey = '';
    /* A1 measured the production chrome only: lift the preview instrument out
       of the collision set for the duration of the comparison */
    var panel = document.querySelector('.signals-instrument');
    var tabEl = document.querySelector('.signals-tab');
    var panelWas = panel ? panel.hidden : true, tabWas = tabEl ? tabEl.hidden : true;
    if (panel) panel.hidden = true;
    if (tabEl) tabEl.hidden = true;
    var out = [];
    var rules = ['R-C', 'R-C2', 'R-Cn', 'R-F', 'R-G', 'R-A', 'R-B', 'R-0'];
    var thrs = DATA.predicate.thresholds;
    for (var ri = 0; ri < rules.length; ri++) {
      for (var ti = 0; ti < thrs.length; ti++) {
        cfg.rule = rules[ri]; cfg.thr = thrs[ti];
        var placed = 0, occ = [];
        var cands = buildCandidates();
        var rects = collectChrome();
        for (var ci = 0; ci < cands.length && placed < cfg.maxSignals; ci++) {
          var res = testPosition(cands[ci].x, cands[ci].y, ci + 1, state.geom, rects, occ);
          if (res.ok) { placed++; occ.push({ x: cands[ci].x, y: cands[ci].y }); }
        }
        var audit = vp.auditClustersPlaced[String(thrs[ti])] && vp.auditClustersPlaced[String(thrs[ti])][rules[ri]];
        out.push({ rule: rules[ri], thr: thrs[ti], livePlaced: placed, auditK1: audit ? audit.K1 : null, slots: cfg.maxSignals });
      }
    }
    cfg.size = saved.size; cfg.companions = saved.companions; cfg.separation = saved.sep;
    cfg.maxSignals = saved.max; cfg.centreGuard = saved.guard; cfg.order = saved.order;
    if (panel) panel.hidden = panelWas;
    if (tabEl) tabEl.hidden = tabWas;
    state.candKey = '';
    revalidate();
    return out;
  }

  function destroy() {
    state.destroyed = true;
    if (storeSub) { storeSub(); storeSub = null; }
    hideRevealWindow();
    clearAll();
    if (autoTimer) clearTimeout(autoTimer);
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
    for (var j = 0; j < listeners.length; j++) {
      var L = listeners[j];
      if (L[4] && L[0].removeListener) L[0].removeListener(L[2]);
      else L[0].removeEventListener(L[1], L[2], L[3]);
    }
    listeners = [];
    if (mountObserver) { mountObserver.disconnect(); mountObserver = null; }
    if (host.parentNode) host.parentNode.removeChild(host);
    delete window.__VOID_SIGNALS_PREVIEW__;
    delete window.VoidSignalsPreview;
  }

  /* ---------------- boot ---------------- */
  var resizeTimer = null;
  listen(window, 'resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = later(function () {
      resizeTimer = null;
      var before = state.vp;
      state.geom = readGeom();
      if (state.vp !== state.geom.vp) { state.vp = state.geom.vp; applyViewportDefaults(); }
      state.candKey = '';
      revalidate();
      if (before !== state.vp) log('info', 'viewport class ' + before + ' -> ' + state.vp + '; slots ' + cfg.maxSignals);
      if (window.VoidSignalsPreview && window.VoidSignalsPreview.onchange) window.VoidSignalsPreview.onchange();
    }, 200);
  });
  /* Explicit close only: the close control (bound in renderReveal) or Escape.
     Clicking anywhere else — the galaxy, the field, outside the window — must
     never consume or dismiss the message (§2).
     The player claims Escape on document in the capture phase to leave Music Mode,
     so the window takes it on window capture first; otherwise Escape closes the
     message and tears the experience down underneath it (void-invite.js does the
     same for its share sheet). */
  listen(window, 'keydown', function (ev) {
    if (!revealFor || ev.key !== 'Escape' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    ev.preventDefault();
    ev.stopPropagation();
    closeReveal();
  }, true);
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (mq) {
    cfg.reducedMotion = !!mq.matches;
    var onMq = function () { setConfig({ reducedMotion: !!mq.matches }); };
    if (mq.addEventListener) listen(mq, 'change', onMq);
    else if (mq.addListener) { mq.addListener(onMq); listeners.push([mq, 'change', onMq, null, true]); }
  }

  function start() {
    mountHost();
    applyStar();
    state.geom = readGeom();
    state.vp = state.geom.vp;
    applyViewportDefaults();
    state.ready = true;
    revalidate();
    if (STORE && STORE.subscribe) {
      storeSub = STORE.subscribe(function (reason) {
        if (reason === 'remove') { if (revealFor && !STORE.get(revealFor)) hideRevealWindow(); revalidate(); }
        /* a read-state change has to reach both views: refreshReadStates updates
           the field, the notify repaints the Notification Center instrument */
        else {
          refreshReadStates();
          if (window.VoidSignalsPreview && window.VoidSignalsPreview.onchange) window.VoidSignalsPreview.onchange();
        }
      });
    }
    log('info', 'preview layer ready · ' + state.vp + ' · ' + (state.geom.live ? 'live renderer geometry' : 'formula geometry (renderer not ready)') +
      (STORE ? ' · session ' + STORE.sessionId() : ' · no message store'));
    if (window.VoidSignalsPreview && window.VoidSignalsPreview.onchange) window.VoidSignalsPreview.onchange();
  }

  fetch(DATA_URL, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (json) {
    DATA = json;
    var tries = 0;
    (function wait() {
      var g = readGeom();
      if (g.live || tries > 60) { start(); return; }
      tries++;
      later(wait, 200);
    })();
  }).catch(function (e) {
    log('reject', 'placement data failed to load: ' + e);
    mountHost();
    state.geom = readGeom(); state.vp = state.geom.vp; applyViewportDefaults(); state.ready = true;
  });
})();