/* Void Podcast Voice Thread — synthetic central-orb visualizer (Phase 1).

   Owns ONLY the Podcast central-orb overlay: a single thin, horizontal,
   luminous line across the orb centre, pinned and tapered at both ends.
   Animation is synthetic and driven by playback state + elapsed playback
   time. It NEVER owns playback, NEVER creates an AudioContext or a
   createMediaElementSource, NEVER sets crossOrigin, and NEVER taps the
   Music analyser. Real audio analysis is out of scope for this phase.

   Chromium 70 / Android TV safe: ES5 syntax only, Canvas 2D, no optional
   chaining, nullish coalescing, replaceAll, .at(), globalThis, ResizeObserver,
   OffscreenCanvas. Geometry is resolved through the one authoritative orb
   resolver (getVoid exposed as VoidDomains.getOrbGeometry) — no duplicate
   sizing math. The orb's horizontal line is the same motif the emblem already
   carries (pc-construct M10 60H110 + pc-x centre). */
(function (root) {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') { return; }
  if (!window.__VOID_PODCAST_FLAG__) { return; }

  /* QUIET is a synthetic calm/quiet *visual* resting state. It is NOT an audio
     measurement: real acoustic silence cannot be detected without audio
     analysis (out of scope by owner decision). See evaluateProgress() — QUIET is
     entered only when the playhead is not advancing while playback is nominally
     active, which we render as a calm look. We never claim silence is detected. */
  var STATE = {
    IDLE: 'idle', LOADING: 'loading', BUFFERING: 'buffering', PLAYING: 'playing',
    PAUSED: 'paused', QUIET: 'quiet', ENDED: 'ended', ERROR: 'error'
  };

  /* Restrained palette, matched to the Podcast emblem CSS variables. */
  var GOLD = [216, 180, 106];      /* --pc-accent #d8b46a */
  var SILVER = [217, 222, 230];    /* --pc-line #d9dee6 */
  /* Neutral, non-diagnostic status text (used for error and as the default). */
  var NEUTRAL_MSG = 'Podcast playback stopped — this episode could not be played · ' +
    'پخش این قسمت متوقف شد و امکان پخش نداشت';

  var vm = null, audio = null, opts = null;
  var box = null, canvas = null, ctx = null, statusEl = null;   /* overlay DOM */
  var started = false, bound = false;
  var state = STATE.IDLE;
  var rafId = 0, lastFrame = 0;
  var revealT = 0, rippleAt = -1, errorShown = false;

  /* Cached geometry so we do not read layout every animation frame. */
  var geo = { cx: 0, cy: 0, hole: 0, box: 0, dpr: 1 };
  var geoDirty = true;

  /* Playhead progress tracking for the synthetic QUIET state. This is a
     time-advance check only (no RMS, no audio analysis) — it does not and
     cannot detect acoustic silence. */
  var lastTime = 0, lastTimeAt = 0, progressSeen = false;

  /* Emblem coupling (transient classes; the player owns is-playing). */
  var emblemSel = '.vdc-target--podcast .void-emblem--podcast';
  var emblemEl = null, layerObs = null, bodyObs = null, watchedLayer = null;

  var mq = null;

  /* ---- environment helpers ---- */
  function isTV() { return !!(document.documentElement && document.documentElement.classList.contains('void-tv')); }
  function reducedMotion() { return !!(mq && mq.matches); }
  function docHidden() { return !!document.hidden; }
  /* The Podcast dialog (z-index 1200) covers the orb while open. */
  function dialogOpen() {
    var d = document.getElementById('void-podcast-modal');
    return !!(d && d.open);
  }
  function occluded() { return dialogOpen(); }

  function now() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }
  function isFn(f) { return typeof f === 'function'; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---- geometry: reuse the single authoritative orb resolver ---- */
  function resolveGeometry() {
    var g = null;
    if (opts && isFn(opts.getGeometry)) { g = opts.getGeometry(); }
    if (!g && window.VoidDomains && isFn(window.VoidDomains.getOrbGeometry)) { g = window.VoidDomains.getOrbGeometry(); }
    var w = window.innerWidth || 1, h = window.innerHeight || 1;
    var cx = w / 2, cy = h * 0.45, hole = 0;
    if (g) {
      if (isFinite(g.cx)) { cx = g.cx; }
      if (isFinite(g.cy)) { cy = g.cy; }
      if (isFinite(g.hole) && g.hole > 0) { hole = g.hole; }
    }
    /* Authoritative hole radius comes from getVoid; if unavailable (WebGL not
       live and no fallback orb yet), derive nothing new — wait for a redraw
       rather than invent a competing size. Use a conservative placeholder only
       to avoid a zero-size canvas. */
    if (!(hole > 0)) { hole = 0.11 * Math.min(w, h); }
    return { cx: cx, cy: cy, hole: hole };
  }

  function syncCanvasSize() {
    if (!canvas || !box) { return; }
    var r = resolveGeometry();
    var dpr = Math.min(window.devicePixelRatio || 1, isTV() ? 1 : 2);
    /* Overlay box sized to the orb disc plus a small margin for the taper. */
    var half = Math.round(r.hole) + 12;
    var size = half * 2;
    geo.cx = r.cx; geo.cy = r.cy; geo.hole = r.hole; geo.box = size; geo.dpr = dpr;

    box.style.width = size + 'px';
    box.style.height = size + 'px';
    box.style.left = Math.round(r.cx - size / 2) + 'px';
    box.style.top = Math.round(r.cy - size / 2) + 'px';

    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    geoDirty = false;
  }

  /* ---- overlay DOM (created lazily on start) ---- */
  function buildOverlay() {
    var host = document.getElementById('void-music-root') || document.body;
    if (!box) {
      box = document.createElement('div');
      box.className = 'void-podcast-thread';
      box.setAttribute('aria-hidden', 'true');
      canvas = document.createElement('canvas');
      canvas.className = 'void-podcast-thread__canvas';
      box.appendChild(canvas);
      statusEl = document.createElement('div');
      statusEl.className = 'void-podcast-thread__status';
      statusEl.setAttribute('role', 'status');
      statusEl.setAttribute('aria-live', 'polite');
      statusEl.hidden = true;
      box.appendChild(statusEl);
      host.appendChild(box);
    }
    ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  }

  function removeOverlay() {
    if (box && box.parentNode) { box.parentNode.removeChild(box); }
    box = null; canvas = null; ctx = null; statusEl = null;
    geoDirty = true;
  }

  /* ---- emblem ---- */
  function findEmblem() {
    emblemEl = document.querySelector(emblemSel);
    return emblemEl;
  }
  function applyEmblemState() {
    /* Re-resolve the live emblem on every call. The constellation can rebuild
       and swap the emblem node, so a cached reference would mutate a detached
       node and leave the visible emblem stale (the player's syncEmblem()
       re-queries for exactly this reason). findEmblem() refreshes emblemEl. */
    var el = findEmblem();
    if (!el) { return; }
    var cl = el.classList;
    cl.toggle('is-loading', state === STATE.LOADING);
    cl.toggle('is-buffering', state === STATE.BUFFERING);
    cl.toggle('is-failed', state === STATE.ERROR);
  }
  function watchConstellation() {
    var layer = document.querySelector('.vdc');
    if (layer === watchedLayer) { return; }
    if (layerObs) { layerObs.disconnect(); layerObs = null; }
    watchedLayer = layer;
    if (layer && window.MutationObserver) {
      layerObs = new MutationObserver(function () { applyEmblemState(); });
      try { layerObs.observe(layer, { attributes: true, attributeFilter: ['class'] }); } catch (e) { /* Ch70 */ }
    }
    applyEmblemState();
  }
  function startEmblemWatch() {
    if (!window.MutationObserver) { findEmblem(); applyEmblemState(); return; }
    if (!bodyObs) {
      bodyObs = new MutationObserver(function () { watchConstellation(); });
      try { bodyObs.observe(document.body, { childList: true }); } catch (e) { /* Ch70 */ }
    }
    watchConstellation();
  }
  function stopEmblemWatch() {
    if (layerObs) { layerObs.disconnect(); layerObs = null; }
    if (bodyObs) { bodyObs.disconnect(); bodyObs = null; }
    watchedLayer = null;
    if (emblemEl) {
      emblemEl.classList.remove('is-loading', 'is-buffering', 'is-failed');
    }
    emblemEl = null;
  }

  /* ---- status (error text feedback, never animation-only) ---- */
  function showStatus(msg) {
    if (!statusEl) { return; }
    statusEl.textContent = msg || NEUTRAL_MSG;
    statusEl.hidden = false;
    errorShown = true;
  }
  function hideStatus() {
    if (statusEl) { statusEl.hidden = true; statusEl.textContent = ''; }
    errorShown = false;
  }

  /* ---- state machine ---- */
  function setState(next) {
    if (!next || next === state) { return; }
    state = next;
    progressSeen = (next === STATE.PLAYING) ? progressSeen : false;
    if (next === STATE.LOADING) { _revealBase = 0; }
    if (next === STATE.ENDED) { rippleAt = now(); }
    if (next === STATE.ERROR) {
      var em = (opts && opts.errorMessage) ? opts.errorMessage : NEUTRAL_MSG;
      showStatus(em);
      try { root.dispatchEvent(new CustomEvent('podcast:error', { detail: { message: em } })); } catch (e) { /* CustomEvent unavailable */ }
    }
    else { if (errorShown) { hideStatus(); } }
    applyEmblemState();
    geometry();
    emitState();
    scheduleFrame();
  }
  function getState() { return state; }
  function emitState() {
    try { root.dispatchEvent(new CustomEvent('voidpodcast:thread', { detail: { state: state } })); }
    catch (e) { /* CustomEvent unavailable */ }
  }

  function geometry() { geoDirty = true; }

  /* ---- media state derivation from passive signals ---- */
  function mediaState() {
    if (!audio) { return STATE.IDLE; }
    if (audio.error) { return STATE.ERROR; }
    if (audio.ended) { return STATE.ENDED; }
    if (audio.paused) {
      /* Paused is user intent (unless we never really started). */
      return STATE.PAUSED;
    }
    /* Not paused: loading / buffering / playing. The synthetic QUIET resting
       look is applied afterwards by evaluateProgress(); mediaState() itself
       never infers silence (it reads no audio and no RMS). */
    if (audio.readyState < 3) {            /* HAVE_FUTURE_DATA not reached */
      return audio.readyState >= 1 ? STATE.BUFFERING : STATE.LOADING;
    }
    return STATE.PLAYING;
  }

  /* QUIET: a synthetic calm/quiet resting *look*, not a silence measurement.
     Entered when the playhead has not advanced for a sustained moment while
     playback is nominally active (not paused / errored / ended) and data is
     buffered. This is purely a currentTime-advance check — it cannot and does
     not detect acoustic silence, and uses no audio analysis (out of scope). */
  function evaluateProgress(ts) {
    if (!audio || audio.paused || audio.error || audio.ended) { return; }
    var ct = audio.currentTime || 0;
    if (ct !== lastTime) { lastTime = ct; lastTimeAt = ts; progressSeen = true; }
    else if (progressSeen && (ts - lastTimeAt) > 2500 && audio.readyState >= 3) {
      if (state !== STATE.QUIET) { setState(STATE.QUIET); }
      return;
    }
    if (state === STATE.QUIET && progressSeen && (ts - lastTimeAt) < 2000) {
      setState(STATE.PLAYING);
    }
  }

  /* ---- listeners (added once; the Podcast element persists) ---- */
  var handlers = null;
  function bindMedia() {
    if (bound || !audio) { return; }
    bound = true;
    handlers = {
      loadstart: function () { setState(STATE.LOADING); },
      loadedmetadata: function () { if (state === STATE.LOADING) { setState(mediaState()); } },
      play: function () { setState(mediaState()); },
      playing: function () { setState(STATE.PLAYING); },
      /* A media error fires 'pause' immediately after 'error' (paused becomes
         true), so pause must not downgrade an active error back to PAUSED. */
      pause: function () { setState(audio && audio.error ? STATE.ERROR : STATE.PAUSED); },
      waiting: function () { if (state !== STATE.ENDED) { setState(STATE.BUFFERING); } },
      stalled: function () { if (state === STATE.PLAYING) { setState(STATE.BUFFERING); } },
      canplay: function () { setState(mediaState()); },
      timeupdate: function () { evaluateProgress(now()); if (state === STATE.BUFFERING || state === STATE.QUIET || state === STATE.LOADING) { if (!audio.paused && audio.readyState >= 3) { setState(STATE.PLAYING); } } },
      ended: function () { setState(STATE.ENDED); },
      error: function () { setState(STATE.ERROR); }
    };
    var names = ['loadstart', 'loadedmetadata', 'play', 'playing', 'pause', 'waiting', 'stalled', 'canplay', 'timeupdate', 'ended', 'error'];
    for (var i = 0; i < names.length; i++) { audio.addEventListener(names[i], handlers[names[i]], false); }
  }
  function unbindMedia() {
    if (!bound || !audio || !handlers) { return; }
    var names = ['loadstart', 'loadedmetadata', 'play', 'playing', 'pause', 'waiting', 'stalled', 'canplay', 'timeupdate', 'ended', 'error'];
    for (var i = 0; i < names.length; i++) { audio.removeEventListener(names[i], handlers[names[i]], false); }
    handlers = null; bound = false;
  }

  var winHandlers = null;
  function bindWindow() {
    if (winHandlers) { return; }
    winHandlers = {
      resize: function () { geometry(); scheduleFrame(); },
      orientationchange: function () { geometry(); scheduleFrame(); },
      visibilitychange: function () { scheduleFrame(); },
      /* Dialog open/close changes whether the orb is visible to the user. */
      modal: function () { geometry(); scheduleFrame(); }
    };
    window.addEventListener('resize', winHandlers.resize, false);
    window.addEventListener('orientationchange', winHandlers.orientationchange, false);
    document.addEventListener('visibilitychange', winHandlers.visibilitychange, false);
    if (mq && isFn(mq.addEventListener)) { mq.addEventListener('change', winHandlers.resize, false); }
    else if (mq && isFn(mq.addListener)) { mq.addListener(winHandlers.resize); }
    startModalWatch();
  }
  function unbindWindow() {
    if (!winHandlers) { return; }
    window.removeEventListener('resize', winHandlers.resize, false);
    window.removeEventListener('orientationchange', winHandlers.orientationchange, false);
    document.removeEventListener('visibilitychange', winHandlers.visibilitychange, false);
    if (mq && isFn(mq.removeEventListener)) { mq.removeEventListener('change', winHandlers.resize, false); }
    else if (mq && isFn(mq.removeListener)) { mq.removeListener(winHandlers.resize); }
    stopModalWatch();
    winHandlers = null;
  }

  var modalObs = null;
  function startModalWatch() {
    var d = document.getElementById('void-podcast-modal');
    if (!d || !window.MutationObserver) { return; }
    modalObs = new MutationObserver(function () { if (winHandlers) { winHandlers.modal(); } });
    try { modalObs.observe(d, { attributes: true, attributeFilter: ['open'] }); } catch (e) { /* Ch70 */ }
  }
  function stopModalWatch() {
    if (modalObs) { modalObs.disconnect(); modalObs = null; }
  }

  /* ---- lifecycle decision ---- */
  function shouldAnimate() {
    return started && !reducedMotion() && !docHidden() && !occluded() &&
      (state === STATE.PLAYING || state === STATE.BUFFERING || state === STATE.QUIET ||
       state === STATE.LOADING || state === STATE.ENDED);
  }
  function visible() { return started && !occluded() && !docHidden(); }

  function applyVisibility() {
    if (!box) { return; }
    if (visible()) { box.classList.remove('is-hidden'); }
    else { box.classList.add('is-hidden'); }
  }

  /* ---- render ---- */
  var fpsTarget = 30;
  /* The authoritative orb (WebGL live geometry) can settle a frame or two AFTER
     a resize/orientationchange, so the one-shot resize sync can latch the .45
     fallback centre while the live orb is .40 (visible vertical misplacement on
     portrait). While the overlay is actually on screen, re-pull geometry on a
     light throttle and re-dirty only when the centre really moved — this heals
     the late-settling orb without reading layout on every frame. */
  var lastGeoCheck = 0;
  function scheduleFrame() {
    applyVisibility();
    if (rafId) { return; }
    if (shouldAnimate()) {
      lastFrame = now();
      rafId = root.requestAnimationFrame(tick);
    } else {
      /* Static render for paused / error / reduced-motion / hidden surfaces. */
      render(now(), true);
    }
  }
  function tick(ts) {
    rafId = 0;
    if (!started) { return; }
    if (visible() && (ts - lastGeoCheck) > 180) {
      lastGeoCheck = ts;
      var gc = resolveGeometry();
      if (Math.abs(gc.cx - geo.cx) > 1.5 || Math.abs(gc.cy - geo.cy) > 1.5) { geoDirty = true; }
    }
    var dt = ts - lastFrame;
    if (dt < (1000 / fpsTarget) - 2) {
      if (shouldAnimate()) { rafId = root.requestAnimationFrame(tick); }
      else { render(ts, true); }
      return;
    }
    lastFrame = ts;
    render(ts, false);
    if (shouldAnimate()) { rafId = root.requestAnimationFrame(tick); }
  }

  /* Envelope: quiet, low-count waveform (2-3 lobes) pinned at the ends. */
  function lobes(x, t, amp, count) {
    /* x in [-1,1]; deterministic synthetic displacement, no audio data. */
    var pin = 1 - x * x;                        /* 1 at centre, 0 at ends */
    if (pin < 0) { pin = 0; }
    var s = 0;
    s += Math.sin(t * 1.1 + x * 2.0) * 1.0;
    s += Math.sin(t * 0.6 - x * 3.1 + 1.7) * 0.55;
    s += Math.sin(t * 1.7 + x * count + 0.5) * 0.32;
    return s * amp * pin;
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  function render(ts, staticFrame) {
    if (!ctx) { return; }
    if (geoDirty && (visible() || !staticFrame)) { syncCanvasSize(); }
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2;                 /* canvas-local (box is centred on orb) */
    var R = geo.hole * geo.dpr;                 /* disc radius in device px */
    if (!(R > 1)) { return; }
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    var tv = isTV();
    var points = tv ? 40 : 80;                  /* 32-48 TV / 64-96 desktop */
    var t = (audio && !audio.paused) ? (audio.currentTime || 0) : (lastTime || 0);
    /* Reveal fraction for loading, resolving-ripple life for ended. */
    var reveal = 1, alpha = 0.92, ampScale = 0.14, motionOn = true;
    var broken = false, pulse = -1;

    if (state === STATE.LOADING) {
      reveal = reducedMotion() ? 1 : clamp((ts - revealAt(ts)) / 1200, 0.06, 1);
      alpha = 0.6; ampScale = 0.05;
    } else if (state === STATE.BUFFERING) {
      alpha = 0.42; ampScale = 0.035; pulse = reducedMotion() ? 0.5 : (0.5 + 0.5 * Math.sin(t * 0.7));
    } else if (state === STATE.QUIET) {
      /* Calm, low-motion resting line with a slow brightness breath. */
      alpha = 0.5 + 0.12 * Math.sin((reducedMotion() ? 0 : ts) / 1000 * 0.8); ampScale = 0.04;
    } else if (state === STATE.PAUSED) {
      alpha = 0.5; ampScale = 0.012; motionOn = false;
    } else if (state === STATE.ENDED) {
      ampScale = 0.06; pulse = reducedMotion() ? 1 : clamp((ts - rippleAt) / 1400, 0, 1);
      if (pulse >= 1) { ampScale = 0.02; alpha = 0.4; }
    } else if (state === STATE.ERROR) {
      broken = true; alpha = 0.55; ampScale = 0.0; motionOn = false;
    } else { /* PLAYING */
      alpha = 0.92; ampScale = 0.14;
    }
    if (tv) { ampScale *= 0.8; }                /* quieter on TV */

    /* Travelling highlight for loading/buffering. */
    if ((state === STATE.LOADING || state === STATE.BUFFERING) && !reducedMotion()) {
      pulse = (state === STATE.LOADING) ? ((ts % 1600) / 1600) : (0.5 + 0.5 * Math.sin(ts / 1000 * 0.7));
    }

    drawThread(cx, cy, R, points, t, ampScale, alpha, motionOn, broken, reveal, pulse, tv);
    ctx.restore();
  }

  var _revealBase = 0;
  function revealAt(ts) { if (_revealBase === 0) { _revealBase = ts; } return _revealBase; }

  function drawThread(cx, cy, R, points, t, ampScale, alpha, motionOn, broken, reveal, pulse, tv) {
    var i, x, y, amp = R * ampScale;
    /* Silver outer (faint) + gold core, no shadow blur (GPU-cheap). */
    var passes = tv ? [
      { c: SILVER, w: Math.max(1, R * 0.018), a: alpha * 0.5 }
    ] : [
      { c: SILVER, w: Math.max(1, R * 0.030), a: alpha * 0.45 },
      { c: GOLD, w: Math.max(1, R * 0.012), a: alpha }
    ];

    var span = R * reveal;                       /* reveal grows from centre */
    for (var p = 0; p < passes.length; p++) {
      var pass = passes[p];
      ctx.lineWidth = pass.w;
      ctx.strokeStyle = rgba(pass.c, pass.a);
      ctx.lineCap = 'round';
      if (broken) {
        /* Interrupted centre: draw two segments with a gap at the middle. */
        var gap = R * 0.16;
        drawSide(cx, cy, R, points, t, amp, motionOn, -1, gap, span, pass);
        drawSide(cx, cy, R, points, t, amp, motionOn, 1, gap, span, pass);
      } else {
        ctx.beginPath();
        var started2 = false;
        for (i = 0; i <= points; i++) {
          x = (i / points) * 2 - 1;              /* -1..1 */
          if (Math.abs(x) * R > span) { continue; }
          y = motionOn ? lobes(x, t, amp, 3) : (amp * 0.15 * Math.sin(x * Math.PI));
          var devx = cx + x * R, devy = cy + y;
          if (!started2) { ctx.moveTo(devx, devy); started2 = true; } else { ctx.lineTo(devx, devy); }
        }
        if (started2) { ctx.stroke(); }
      }
      /* Travelling highlight marker (loading/buffering). */
      if (pulse >= 0 && pulse <= 1 && !broken) {
        var hx = -1 + pulse * 2;
        if (Math.abs(hx) * R <= span) {
          ctx.fillStyle = rgba(GOLD, pass.a * 0.9);
          ctx.beginPath();
          ctx.arc(cx + hx * R, cy + (motionOn ? lobes(hx, t, amp, 3) : 0), pass.w * 1.4 + 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function drawSide(cx, cy, R, points, t, amp, motionOn, dir, gap, span, pass) {
    ctx.beginPath();
    var started3 = false, n = Math.max(8, Math.round(points / 2));
    for (var i = 0; i <= n; i++) {
      var x = dir * (gap / R + (i / n) * (1 - gap / R));   /* from gap to edge */
      if (Math.abs(x) * R > span) { break; }
      var y = motionOn ? lobes(x, t, amp, 3) : 0;
      var devx = cx + x * R, devy = cy + y;
      if (!started3) { ctx.moveTo(devx, devy); started3 = true; } else { ctx.lineTo(devx, devy); }
    }
    if (started3) { ctx.stroke(); }
  }

  /* ---- public lifecycle ---- */
  function start(audioElement, options) {
    if (!audioElement || !audioElement.addEventListener) { return false; }
    opts = options || {};
    vm = window.VoidMusic;
    audio = audioElement;
    started = true;
    fpsTarget = isTV() ? 15 : 30;
    _revealBase = 0;
    try { mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { mq = null; }
    buildOverlay();
    syncCanvasSize();
    bindMedia();
    bindWindow();
    startEmblemWatch();
    state = STATE.IDLE;
    setState(mediaState());
    applyEmblemState();
    scheduleFrame();
    return true;
  }

  function stop() {
    if (!started) { return; }
    started = false;
    if (rafId) { root.cancelAnimationFrame(rafId); rafId = 0; }
    hideStatus();
    unbindMedia();
    unbindWindow();
    stopEmblemWatch();
    removeOverlay();
    audio = null; vm = null; opts = null;
    state = STATE.IDLE;
    progressSeen = false; lastTime = 0; lastTimeAt = 0; rippleAt = -1;
  }

  root.VoidPodcastThread = {
    start: start,
    stop: stop,
    setState: setState,
    getState: getState,
    STATE: STATE,
    _test: {
      resolveGeometry: resolveGeometry,
      shouldAnimate: shouldAnimate,
      mediaState: function () { return mediaState(); },
      isVisible: function () { return visible(); },
      overlayPresent: function () { return !!box; },
      emblemBound: function () { return bound; }
    }
  };
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
