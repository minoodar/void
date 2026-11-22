/* void-podcast-thread — Node test
 *
 * The Voice Thread is a DOM/Canvas module, so unlike the pure-logic podcast
 * modules it cannot run in a bare Node context. This harness installs the
 * smallest window/document/canvas/event stubs the module touches, loads it,
 * and asserts the pieces Phase 1 is actually about:
 *   1. passive media listeners map to the correct synthetic states
 *      (loadstart -> loading, waiting -> buffering, playing -> playing,
 *       pause -> paused, ended -> ended, error -> error + visible feedback)
 *   2. no inferred amplitude: mediaState() is a pure function of element
 *      fields (paused / ended / error / readyState), never of currentTime
 *   3. animation gating: play only while active + unoccluded + visible; the
 *      modal covering the orb and a hidden document both freeze motion
 *   4. emblem/player state coordination: the thread applies only the transient
 *      emblem classes (is-loading / is-buffering / is-failed), never is-playing
 *   5. one error surface, reused: the dialog already shows the neutral message
 *   6. clean teardown: listeners, overlay and emblem watch are all removed
 *   7. no duplicate listeners across repeated start() (episode switches)
 *
 * Self-running: prints a pass count and exits non-zero on any failed assertion.
 */
'use strict';

var assert = require('assert');
var checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg); }

/* ---- fake DOM element -------------------------------------------------- */
function makeEl(tag) {
  var e = { tagName: (tag || '').toUpperCase(), style: {}, attrs: {}, children: [], listeners: {} };
  var classes = {};
  e.classList = {
    add: function () { for (var k = 0; k < arguments.length; k++) { classes[arguments[k]] = true; } },
    remove: function () { for (var k = 0; k < arguments.length; k++) { delete classes[arguments[k]]; } },
    contains: function (c) { return !!classes[c]; },
    toggle: function (c, on) { if (on === undefined) { on = !classes[c]; } if (on) classes[c] = true; else delete classes[c]; return !!on; },
    _all: function () { return Object.keys(classes); }
  };
  Object.defineProperty(e, 'className', {
    get: function () { return Object.keys(classes).join(' '); },
    set: function (v) { classes = {}; String(v == null ? '' : v).split(/\s+/).forEach(function (c) { if (c) classes[c] = true; }); }
  });
  e.setAttribute = function (k, v) { e.attrs[k] = v; };
  e.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; };
  e.appendChild = function (c) { e.children.push(c); c.parentNode = e; return c; };
  e.removeChild = function (c) { var i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); c.parentNode = null; return c; };
  e.remove = function () { if (e.parentNode) e.parentNode.removeChild(e); };
  e.addEventListener = function (name, fn) { (e.listeners[name] || (e.listeners[name] = [])).push(fn); };
  e.removeEventListener = function (name, fn) { var a = e.listeners[name]; if (!a) return; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  e.dispatch = function (name) { (e.listeners[name] || []).slice().forEach(function (fn) { fn({ type: name }); }); };
  e.countFor = function (name) { return (e.listeners[name] || []).length; };
  Object.defineProperty(e, 'textContent', { get: function () { return e._tc || ''; }, set: function (v) { e._tc = String(v); } });
  Object.defineProperty(e, 'hidden', { get: function () { return !!e._hidden; }, set: function (v) { e._hidden = !!v; } });
  if (e.tagName === 'CANVAS') {
    e.width = 0; e.height = 0;
    e.getContext = function () { return makeCtx(); };
  }
  return e;
}

/* no-op 2D context: recording nothing but proving render() never throws */
function makeCtx() {
  var noop = function () {};
  return {
    clearRect: noop, save: noop, restore: noop, beginPath: noop, closePath: noop,
    arc: noop, moveTo: noop, lineTo: noop, fill: noop, stroke: noop, fillRect: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, clip: noop, setTransform: noop,
    scale: noop, translate: noop, createLinearGradient: function () { return { addColorStop: noop }; },
    lineWidth: 1, lineCap: 'butt', fillStyle: '', strokeStyle: '', globalAlpha: 1, font: '', textAlign: ''
  };
}

/* ---- fake media element ------------------------------------------------- */
function makeAudio() {
  var a = makeEl('audio');
  a._t = 0; a.duration = 100; a.paused = true; a.ended = false; a.error = null; a.readyState = 0;
  Object.defineProperty(a, 'currentTime', { get: function () { return a._t; }, set: function (v) { a._t = Number(v); } });
  a.play = function () { a.paused = false; a.dispatch('play'); };
  a.pause = function () { a.paused = true; a.dispatch('pause'); };
  return a;
}

/* ---- install globals ---------------------------------------------------- */
var geoCalls = 0;
var GEO = { cx: 100, cy: 200, hole: 60 };
var modal = makeEl('div');
modal.open = false;

var doc = {
  hidden: false,
  documentElement: makeEl('html'),
  createElement: function (t) { return makeEl(t); },
  getElementById: function (id) { return id === 'void-podcast-modal' ? modal : null; },
  querySelector: function () { return null; },
  addEventListener: function () {}, removeEventListener: function () {}
};
doc.body = makeEl('body');

var frameQueue = [];
var win = {
  __VOID_PODCAST_FLAG__: true,
  innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
  document: doc,
  _listeners: {},
  addEventListener: function (name, fn) { (win._listeners[name] || (win._listeners[name] = [])).push(fn); },
  removeEventListener: function (name, fn) { var a = win._listeners[name]; if (!a) return; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
  dispatchEvent: function (ev) { (win._listeners[ev.type] || []).slice().forEach(function (fn) { fn(ev); }); return true; },
  matchMedia: function () { return { matches: false, addEventListener: function () {}, removeEventListener: function () {}, addListener: function () {}, removeListener: function () {} }; },
  requestAnimationFrame: function (cb) { frameQueue.push(cb); return frameQueue.length; },
  cancelAnimationFrame: function () {},
  performance: { now: function () { return Date.now(); } }
};
win.VoidDomains = { getOrbGeometry: function () { geoCalls++; return GEO; } };

global.window = win;
global.document = doc;
global.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };

/* emblem node the thread should bind transient classes onto */
var emblem = makeEl('div');
var emblemTarget = emblem;        /* re-assignable to simulate a constellation rebuild */

global.__testEmblem = emblem;

/* ---- load the module ---------------------------------------------------- */
require('./void-podcast-thread.js');
var Thread = win.VoidPodcastThread;
ok(!!Thread && typeof Thread.start === 'function', 'module exports VoidPodcastThread.start');
eq(typeof Thread.setState, 'function', 'exports setState');
eq(typeof Thread.getState, 'function', 'exports getState');
eq(typeof Thread.stop, 'function', 'exports stop');
ok(!!Thread.STATE && Thread.STATE.PLAYING === 'playing', 'STATE enum present');

/* find the overlay the module created and plant an emblem under it so
   applyEmblemState() has a target (querySelector returns null otherwise). */
function findOverlay() {
  var q = []; q.push(doc.body);
  while (q.length) {
    var n = q.shift();
    if (n.classList && n.classList.contains('void-podcast-thread')) return n;
    (n.children || []).forEach(function (c) { q.push(c); });
  }
  return null;
}

var audio = makeAudio();
/* route emblem lookups to our planted node */
var origQS = doc.querySelector;
function withEmblem() { doc.querySelector = function (sel) { return sel === emblemSel ? emblemTarget : origQS.call(doc, sel); }; }
var emblemSel = '.vdc-target--podcast .void-emblem--podcast';

/* ---- 1. lifecycle: start + media listener -> state mapping -------------- */
withEmblem();
audio.paused = true; audio.readyState = 4; audio.ended = false;
eq(Thread.start(audio, { getGeometry: win.VoidDomains.getOrbGeometry }), true, 'start() returns true for a valid element');
ok(!!findOverlay(), 'overlay created inside root/body tree');
eq(Thread.getState(), 'paused', 'initial state mirrors mediaState() (ready + paused)');
ok(geoCalls > 0, 'start() pulls orb geometry once from the injected resolver');

audio.dispatch('loadstart'); eq(Thread.getState(), 'loading', 'loadstart -> loading');
audio.readyState = 4; audio.paused = false; audio.dispatch('playing'); eq(Thread.getState(), 'playing', 'playing -> playing');
audio.paused = true; audio.dispatch('pause'); eq(Thread.getState(), 'paused', 'pause -> paused');
audio.paused = false; audio.readyState = 2; audio.dispatch('waiting'); eq(Thread.getState(), 'buffering', 'waiting -> buffering');
audio.readyState = 4; audio.dispatch('playing'); eq(Thread.getState(), 'playing', 'rebuffer then play -> playing');
audio.ended = true; audio.dispatch('ended'); eq(Thread.getState(), 'ended', 'ended -> ended');

/* ---- 2. one error surface, visible feedback, neutral wording ------------ */
var errEvents = 0; var lastErr = null;
win.addEventListener('podcast:error', function (ev) { errEvents++; lastErr = ev.detail; });
audio.ended = false; audio.error = { code: 4 }; audio.dispatch('error');
eq(Thread.getState(), 'error', 'error -> error');
eq(errEvents, 1, 'a single podcast:error event is emitted');
ok(lastErr && typeof lastErr.message === 'string' && lastErr.message.length > 0, 'error detail carries a message');
var msg = lastErr.message.toLowerCase();
ok(msg.indexOf('cors') === -1 && msg.indexOf('network') === -1 && msg.indexOf('http') === -1,
   'message is neutral — no CORS/network diagnosis implied');

/* ---- 2b. REGRESSION (Phase 1.2 real-app finding) -------------------------
   Real Chrome fires a trailing 'pause' immediately after a media 'error'
   (the element flips to paused=true). Observed live: loadstart -> error(code4)
   -> pause, and the old pause handler downgraded ERROR back to PAUSED, so the
   overlay lost its failure look and the emblem never got is-failed. The thread
   must hold ERROR across that trailing pause, while a *genuine* pause (no
   error) still maps to PAUSED. */
audio.paused = true; audio.dispatch('pause');
eq(Thread.getState(), 'error', 'pause trailing an error must NOT downgrade to paused');
ok(emblem.classList.contains('is-failed'), 'emblem keeps is-failed after the trailing pause');
audio.error = null; audio.paused = true; audio.dispatch('pause');
eq(Thread.getState(), 'paused', 'a pause with no active error still maps to paused');

/* ---- 3. emblem/player coordination: only transient classes ------------- */
Thread.setState(Thread.STATE.PLAYING);
ok(emblem.classList.contains('is-playing') === false, 'thread never sets is-playing (the player owns it)');
Thread.setState(Thread.STATE.LOADING);
ok(emblem.classList.contains('is-loading'), 'loading state applies emblem is-loading');
Thread.setState(Thread.STATE.BUFFERING);
ok(emblem.classList.contains('is-buffering') && !emblem.classList.contains('is-loading'), 'buffering swaps emblem transient class');
Thread.setState(Thread.STATE.ERROR);
ok(emblem.classList.contains('is-failed'), 'error state applies emblem is-failed');
Thread.setState(Thread.STATE.PLAYING);
ok(!emblem.classList.contains('is-failed') && !emblem.classList.contains('is-buffering'), 'recovering clears transient emblem classes');

/* ---- 4. animation gating ------------------------------------------------ */
Thread.setState(Thread.STATE.PLAYING);
eq(Thread._test.shouldAnimate(), true, 'animates while playing, unoccluded, visible');
modal.open = true;
eq(Thread._test.shouldAnimate(), false, 'modal covering the orb freezes motion');
eq(Thread._test.isVisible(), false, 'thread reports hidden while occluded');
modal.open = false;
eq(Thread._test.shouldAnimate(), true, 'motion resumes when the dialog is dismissed mid-playback');
doc.hidden = true;
eq(Thread._test.shouldAnimate(), false, 'hidden document freezes motion');
eq(Thread._test.isVisible(), false, 'thread reports hidden while document.hidden');
doc.hidden = false;
Thread.setState(Thread.STATE.PAUSED);
eq(Thread._test.shouldAnimate(), false, 'paused is a static frame (no animation loop)');
Thread.setState(Thread.STATE.PLAYING);

/* ---- 5. no inferred amplitude from currentTime -------------------------- */
audio.error = null; audio.ended = false; audio.paused = false; audio.readyState = 4;
audio._t = 42.7; /* move the clock forward */
eq(Thread._test.mediaState(), 'playing', 'mediaState ignores elapsed time — purely element flags');
audio.paused = true;
eq(Thread._test.mediaState(), 'paused', 'mediaState still paused despite changed currentTime');
audio.paused = false;

/* ---- 6. no duplicate listeners across repeated start() ------------------ */
var beforePlaying = audio.countFor('playing');
withEmblem();
eq(Thread.start(audio, { getGeometry: win.VoidDomains.getOrbGeometry }), true, 'restart on same element is safe');
eq(audio.countFor('playing'), beforePlaying, 'no duplicate media listeners registered across episode switches');
ok(Thread._test.emblemBound(), 'emblem binding still live after restart');

/* ---- 7. clean teardown -------------------------------------------------- */
audio.dispatch('playing'); /* ensure a live state before stopping */
Thread.stop();
eq(Thread.getState(), 'idle', 'stop() resets state to idle');
eq(!!findOverlay(), false, 'stop() removes the overlay node from the tree');
ok(!emblem.classList.contains('is-loading') && !emblem.classList.contains('is-buffering') && !emblem.classList.contains('is-failed'), 'stop() clears transient emblem classes');
eq(Thread._test.shouldAnimate(), false, 'no animation after stop()');

/* stop must not throw when called again (idempotent teardown) */
var threw = false;
try { Thread.stop(); } catch (e) { threw = true; }
eq(threw, false, 'stop() is idempotent');

/* restart after a full stop re-establishes everything cleanly */
audio.error = null; audio.paused = false; audio.readyState = 4;
eq(Thread.start(audio, { getGeometry: win.VoidDomains.getOrbGeometry }), true, 'start() works again after stop()');
eq(Thread.getState(), 'playing', 'restarted thread reflects live media');
Thread.stop();

/* ---- 8. emblem rebind after constellation rebuild (Phase 1.1 fix) -------
   The thread must mutate the CURRENT emblem node, never a cached/detached one,
   exactly as the player's syncEmblem() re-queries for. */
var emblemB = makeEl('div');
emblemTarget = emblemB;                      /* constellation swapped the node */
audio.error = null; audio.paused = false; audio.readyState = 4; audio.ended = false;
eq(Thread.start(audio, { getGeometry: win.VoidDomains.getOrbGeometry }), true, 'restart for rebuild test');
Thread.setState(Thread.STATE.BUFFERING);
ok(emblemB.classList.contains('is-buffering'), 'rebuild: the CURRENT emblem node gets the transient class');
ok(!emblem.classList.contains('is-buffering'), 'rebuild: the old (detached) emblem is not mutated');
Thread.stop();
ok(!emblemB.classList.contains('is-buffering'), 'stop(): clears the CURRENT emblem, no stale class survives rebuild');
emblemTarget = emblem;

/* ---- 9. QUIET is the synthetic calm state; 'silence' is fully gone ------- */
var emblemC = makeEl('div'); emblemTarget = emblemC;
audio.paused = false; audio.readyState = 4;
Thread.start(audio, { getGeometry: win.VoidDomains.getOrbGeometry });
eq(Thread.STATE.QUIET, 'quiet', 'STATE exposes the calm state as "quiet"');
eq(Thread.STATE.SILENCE, undefined, 'no "silence" state is exported any more');
Thread.setState(Thread.STATE.QUIET);
eq(Thread.getState(), 'quiet', 'QUIET state is settable and reported');
eq(Thread._test.shouldAnimate(), true, 'QUIET is animated as a calm resting motion (still active)');
/* drive one render pass through the queued frame; render() must not throw */
if (frameQueue.length) { frameQueue[frameQueue.length - 1](1e12); }
ok(true, 'QUIET render pass executes without throwing');
Thread.stop();
ok(!emblemC.classList.contains('is-loading') && !emblemC.classList.contains('is-buffering') && !emblemC.classList.contains('is-failed'), 'QUIET teardown leaves no emblem state');
emblemTarget = emblem;

/* ---- 10. REGRESSION (Phase 1.2 real-app finding): late-settling orb -------
   On a portrait rotation the WebGL live-orb centre can settle a frame or two
   AFTER the resize event, so the one-shot resize sync latches the 0.45 fallback
   cy while the live orb is really 0.40 — a visible vertical misplacement that
   persists until the next state change. The throttled re-pull in tick() must
   heal the overlay to the settled orb centre with NO further state change. */
/* The module queues only its own tick() via requestAnimationFrame, so the last
   queued frame is always tick; drive it with rising timestamps like a browser.
   Timestamps must be epoch-scale (same clock as Date.now()/performance.now());
   otherwise the dt fps-gate is always negative and tick never renders/syncs. */
function pump(base, count, step) {
  var ts = base;
  for (var i = 0; i < count; i++) {
    ts += step;
    var f = frameQueue[frameQueue.length - 1];
    if (f) { f(ts); }
  }
  return ts;
}
var EPOCH = Date.now();
var orbState = { cx: 195, cy: 380, hole: 39 };  /* 380 = the 0.45 fallback centre */
var liveGet = function () { return { cx: orbState.cx, cy: orbState.cy, hole: orbState.hole }; };
modal.open = false; doc.hidden = false;
audio.error = null; audio.ended = false; audio.paused = false; audio.readyState = 4; audio._t = 10;
Thread.start(audio, { getGeometry: liveGet });
Thread.setState(Thread.STATE.PLAYING);
var tsNow = pump(EPOCH, 3, 300);        /* tick renders and latches the fallback centre */
eq(Thread.getState(), 'playing', 'heal test: thread is PLAYING while the orb settles');
var boxNode = findOverlay();
ok(!!boxNode, 'heal test: overlay present');
var topLatch = parseInt(boxNode.style.top, 10);
eq(topLatch, 380 - 51, 'heal test: fallback centre latched (cy 380 - half 51)');

/* Now the WebGL live geometry settles to the true (higher) portrait centre —
   an event-free correction, the exact race seen on real Chrome portrait. */
orbState.cy = 338;                    /* the live orb settles to the true centre */
var beforeHeal = parseInt(findOverlay().style.top, 10);
pump(tsNow, 1, 400);                  /* ts-lastGeoCheck>180 -> re-pull -> dirty -> sync */
var afterHeal = parseInt(findOverlay().style.top, 10);
ok(afterHeal < beforeHeal, 'late-settling orb heals WITHOUT a state change (top ' + beforeHeal + ' -> ' + afterHeal + ')');
eq(Thread.getState(), 'playing', 'the geometry heal does not disturb playback state');
eq(afterHeal, 338 - 51, 'overlay recentred to the settled orb (cy 338 - half 51)');
Thread.stop();

process.stdout.write('void-podcast-thread: ' + checks + ' assertions passed\n');
