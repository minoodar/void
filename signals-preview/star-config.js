/* ======================================================================
   Void Star Studio — star appearance configuration model (preview only).

   Responsibility (configuration architecture §7): item 4, "Star Appearance
   Configuration". Appearance never lives inside a message: the renderer asks
   this module for effective tokens and for the arrangement preset id.

   Structure is deliberately layered so later iterations can add real
   profiles without touching the event engine:

     defaults  →  global overrides  →  per-event-type profile  →  active profile

   Only `defaults`, `global` and `profiles.byType` are wired in this
   iteration. `profiles.occasion` and `profiles.timeBased` are reserved
   shapes (documented, not evaluated): no calendar behaviour and no
   production configuration API are implemented.

   Persistence is sessionStorage only. Nothing is sent to a Worker or stored
   in D1/R2; these values are preview-only and cannot reach production.
   ====================================================================== */
(function () {
  'use strict';
  if (window.VoidStarConfig) return;

  var KEY = 'void-star-config-v1';
  var VERSION = 1;

  var DEFAULTS = {
    preset: 'organic',
    style: 'spark',
    color: 'gold',
    size: 1,
    brightness: 1,
    glow: 1,
    softness: 0,
    motion: 'animated',
    motionIntensity: 1,
    glowTransitionMs: 900,
    drift: 0.35
  };

  var META = {
    presets: [
      { id: 'organic', label: 'Organic galaxy', note: 'REV-3 deterministic cluster — the A1 reference geometry' },
      { id: 'constellation', label: 'Constellation', note: 'primary with a short branching line' },
      { id: 'circular', label: 'Circular', note: 'companions on an even ring' },
      { id: 'spiral', label: 'Spiral', note: 'golden-angle arm around the primary' },
      { id: 'geometric', label: 'Geometric', note: 'square lattice, crisp edges' },
      { id: 'heart', label: 'Heart', note: 'parametric heart outline' },
      { id: 'star', label: 'Star', note: 'five-point star vertices' },
      { id: 'custom', label: 'Custom pattern (reserved)', note: 'placeholder for a future free-form preset', disabled: true }
    ],
    styles: [
      { id: 'spark', label: 'Spark glyph', note: 'four-point spark with hairline cross' },
      { id: 'point', label: 'Light point', note: 'single luminous dot' },
      { id: 'bloom', label: 'Soft bloom', note: 'diffuse glow, no hairlines' },
      { id: 'hairline', label: 'Hairline cross', note: 'thin cross only' }
    ],
    colors: [
      { id: 'gold', label: 'Gold', a: '#f6c86a', b: '#b8862f', core: '#fff8e8' },
      { id: 'silver', label: 'Silver', a: '#dce6f0', b: '#93a6bd', core: '#ffffff' },
      { id: 'white', label: 'White', a: '#f2f5f8', b: '#c3ccd6', core: '#ffffff' },
      { id: 'ember', label: 'Ember', a: '#f0b072', b: '#a9663a', core: '#ffe9cf' },
      { id: 'ice', label: 'Ice', a: '#cfe2ee', b: '#7f9db4', core: '#f4fbff' }
    ],
    motions: [
      { id: 'animated', label: 'Animated' },
      { id: 'static', label: 'Static' }
    ]
  };

  /* ---------------- sessionStorage-backed state ---------------- */
  function ssGet() {
    try {
      var raw = window.sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function ssSet(obj) {
    try { window.sessionStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) { /* memory only */ }
  }

  var saved = ssGet();
  if (!saved || saved.version !== VERSION) {
    saved = { version: VERSION, activeProfile: 'default', experimental: true, global: {}, profiles: { byType: { ambient: {}, important: {} }, occasion: {}, timeBased: {} } };
    ssSet(saved);
  }
  if (!saved.profiles) saved.profiles = { byType: { ambient: {}, important: {} }, occasion: {}, timeBased: {} };
  if (!saved.profiles.byType) saved.profiles.byType = { ambient: {}, important: {} };

  var subs = [];
  function emit() {
    for (var i = 0; i < subs.length; i++) { try { subs[i](); } catch (e) { } }
  }

  function clampNum(v, a, b, d) {
    v = Number(v);
    if (!isFinite(v)) return d;
    return v < a ? a : v > b ? b : v;
  }
  var RANGES = {
    size: [0.5, 2.2, 1], brightness: [0.3, 1.6, 1], glow: [0, 2, 1],
    softness: [0, 1, 0], motionIntensity: [0, 1.6, 1], glowTransitionMs: [120, 2600, 900], drift: [0, 1.2, 0.35]
  };
  function sanitize(patch) {
    var out = {}, k;
    for (k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      if (k === 'preset') { if (find(META.presets, patch[k]) && patch[k] !== 'custom') out.preset = patch[k]; }
      else if (k === 'style') { if (find(META.styles, patch[k])) out.style = patch[k]; }
      else if (k === 'color') { if (find(META.colors, patch[k])) out.color = patch[k]; }
      else if (k === 'motion') { if (find(META.motions, patch[k])) out.motion = patch[k]; }
      else if (RANGES[k]) out[k] = clampNum(patch[k], RANGES[k][0], RANGES[k][1], RANGES[k][2]);
    }
    return out;
  }
  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function effective(type) {
    var cfg = {}, k;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) cfg[k] = DEFAULTS[k];
    var layers = [saved.global, type && saved.profiles.byType[type]];
    for (var li = 0; li < layers.length; li++) {
      var layer = layers[li] || {};
      for (k in layer) if (Object.prototype.hasOwnProperty.call(layer, k)) cfg[k] = layer[k];
    }
    cfg.experimental = !!saved.experimental;
    cfg.activeProfile = saved.activeProfile;
    return cfg;
  }

  /* CSS custom properties consumed by the renderer and by the studio stage */
  function tokens(type) {
    var cfg = effective(type);
    var on = !!cfg.experimental;
    var colour = find(META.colors, on ? cfg.color : 'gold') || META.colors[0];
    var still = cfg.motion === 'static' || !on;
    var intensity = still ? 1 : Math.max(0.25, cfg.motionIntensity);
    var t = {
      '--ss-a': colour.a, '--ss-b': colour.b, '--ss-core': colour.core,
      '--ss-size': String(cfg.size),
      '--ss-bright': String(cfg.brightness),
      '--ss-glow': String(on ? cfg.glow : 1),
      '--ss-soft': (on ? cfg.softness * 2.4 : 0).toFixed(2) + 'px',
      '--ss-motion': String(still ? 0 : cfg.motionIntensity),
      '--ss-breath': (7.5 / intensity).toFixed(2) + 's',
      '--ss-glow-ms': Math.round(on ? cfg.glowTransitionMs : 400) + 'ms',
      '--ss-drift': (still ? 0 : cfg.drift).toFixed(2)
    };
    return {
      cfg: cfg, tokens: t,
      data: {
        style: on ? cfg.style : 'spark',
        preset: on ? cfg.preset : 'organic',
        color: on ? cfg.color : 'gold',
        soft: on && cfg.softness > 0 ? '1' : '0',
        motion: still ? 'static' : 'animated'
      }
    };
  }

  var api = {
    version: VERSION,
    KEY: KEY,
    defaults: DEFAULTS,
    meta: META,
    ranges: RANGES,
    effective: effective,
    tokens: tokens,
    find: find,
    raw: function () { return saved; },
    isExperimental: function () { return !!saved.experimental; },
    setGlobal: function (patch) {
      var clean = sanitize(patch);
      for (var k in clean) if (Object.prototype.hasOwnProperty.call(clean, k)) saved.global[k] = clean[k];
      ssSet(saved); emit(); return saved.global;
    },
    setForType: function (type, patch) {
      if (!saved.profiles.byType[type]) saved.profiles.byType[type] = {};
      var clean = sanitize(patch), k;
      for (k in clean) if (Object.prototype.hasOwnProperty.call(clean, k)) saved.profiles.byType[type][k] = clean[k];
      ssSet(saved); emit(); return saved.profiles.byType[type];
    },
    setExperimental: function (on) { saved.experimental = !!on; ssSet(saved); emit(); return saved.experimental; },
    setActiveProfile: function (name) { saved.activeProfile = String(name || 'default'); ssSet(saved); emit(); return saved.activeProfile; },
    reset: function () {
      saved.global = {};
      saved.profiles.byType = { ambient: {}, important: {} };
      saved.experimental = true;
      saved.activeProfile = 'default';
      ssSet(saved); emit(); return api.effective();
    },
    /* reserved for later iterations: occasion / time-based profiles are stored
       but never evaluated here, and no calendar logic runs in this preview */
    setOccasionProfile: function (name, patch) {
      if (!saved.profiles.occasion) saved.profiles.occasion = {};
      saved.profiles.occasion[name] = sanitize(patch); ssSet(saved); emit(); return saved.profiles.occasion[name];
    },
    setTimeProfile: function (name, patch) {
      if (!saved.profiles.timeBased) saved.profiles.timeBased = {};
      saved.profiles.timeBased[name] = sanitize(patch); ssSet(saved); emit(); return saved.profiles.timeBased[name];
    },
    subscribe: function (fn) { subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; }
  };

  window.VoidStarConfig = api;
})();
