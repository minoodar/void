/* podcast-player controller (Part 2) — Node tests with a minimal fake DOM.
   Covers Phase 2B §D: rate persistence + safe restore, bounded retry (one,
   transient-only), pagehide flush, MediaSession claim, guest hosting contract,
   ERROR-vs-PAUSED preservation and queue integrity across a retry.
   Phase 2B.4 adds: the Podcast element's own volume (persist + tolerant
   restore), stepEpisode across the show queue with safe boundary no-ops, and
   the dock/MediaSession verbs (Prev/Next = episodes, ± seconds = seeks).
   Phase 2B.5 §L adds the borrowed Music chrome: the speed chip, the chapter
   ticks, the podcast styling, the sound-button intercept and the Voice Thread
   follow the SESSION OWNER (voidmusic:ownerchange), not the loaded episode. */
'use strict';
const assert = require('assert');
const path = require('path');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); checks++; }

function memStorage(seed) {
  const map = new Map(seed ? Object.entries(seed) : []);
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); }
  };
}
function fire(el, name, ev) { (el.listeners[name] || []).slice().forEach(fn => fn(ev)); }
function ranges(end) { return { length: end > 0 ? 1 : 0, start(i) { if (i) throw new Error('range'); return 0; }, end(i) { if (i || end <= 0) throw new Error('range'); return end; } }; }
function click() {
  const e = { type: 'click', defaultPrevented: false, stopImmediate: false };
  e.preventDefault = () => { e.defaultPrevented = true; };
  e.stopPropagation = () => {};
  e.stopImmediatePropagation = () => { e.stopImmediate = true; };
  return e;
}

function boot(opts) {
  opts = opts || {};
  const listeners = { window: {}, document: {} };
  const audio = {
    nodeType: 1, tagName: 'AUDIO', listeners: {},
    preload: '', style: {}, parentNode: null, hidden: false,
    paused: true, ended: false, duration: NaN, _currentTime: 0, snapBackOnSeek: false, playbackRate: 1,
    get currentTime() { return this._currentTime; },
    set currentTime(v) { this._currentTime = this.snapBackOnSeek ? 0 : v; },
    readyState: 0, networkState: 0, seekable: ranges(0), buffered: ranges(0),
    error: null, src: '', currentSrc: '',
    setAttribute() {}, removeAttribute(k) { if (k === 'src') { this.src = ''; this.currentSrc = ''; } },
    appendChild() {},
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    removeEventListener() {},
    load() { this.currentSrc = this.src; },
    play() { this.paused = false; fire(this, 'play'); return Promise.resolve(); },
    pause() { if (!this.paused) { this.paused = true; fire(this, 'pause'); } }
  };
  /* A little more than a stub: the borrowed-chrome legs need real parent/child
     surgery (the speed chip is inserted next to the engine's Repeat) and a sheet
     that can be built and searched. Everything else still sees an empty node. */
  function makeEl(tag) {
    const n = {
      tagName: String(tag || 'div').toUpperCase(), className: '', textContent: '',
      style: {}, hidden: true, listeners: {}, attrs: {}, children: [], parentNode: null,
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        toggle(c, on) { if (on === undefined || on) { this.add(c); } else { this.remove(c); } },
        contains(c) { return this._s.has(c); }
      },
      setAttribute(k, v) { n.attrs[k] = String(v); if (k === 'class') { n.className = String(v); } },
      getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
      appendChild(c) { c.parentNode = n; n.children.push(c); return c; },
      insertBefore(c, ref) { const i = n.children.indexOf(ref); c.parentNode = n; n.children.splice(i < 0 ? n.children.length : i, 0, c); return c; },
      removeChild(c) { const i = n.children.indexOf(c); if (i >= 0) { n.children.splice(i, 1); } c.parentNode = null; return c; },
      contains(c) { if (c === n) { return true; } return n.children.some(x => x.contains(c)); },
      querySelectorAll(sel) {
        const out = [];
        n.children.forEach(c => {
          if ((sel[0] === '.' ? String(c.className).split(' ').indexOf(sel.slice(1)) >= 0 : c.tagName === sel.toUpperCase())
            || (sel.indexOf('.') > 0 && String(c.className).split(' ').indexOf(sel.split('.')[1]) >= 0)) { out.push(c); }
          if (c.querySelectorAll) { out.push.apply(out, c.querySelectorAll(sel)); }
        });
        return out;
      },
      querySelector(sel) { const hit = n.querySelectorAll(sel); return hit.length ? hit[0] : null; },
      addEventListener(t, fn) { (n.listeners[t] = n.listeners[t] || []).push(fn); },
      removeEventListener(t, fn) { const l = n.listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) { l.splice(i, 1); } },
      getBoundingClientRect() { return { left: 100, top: 40, right: 140, bottom: 60, width: 40, height: 20 }; },
      getClientRects() { return [{ width: 24, height: 24 }]; },
      getTotalLength() { return 200; },
      getPointAtLength(t) { return { x: t, y: 0 }; },
      focus() {}, offsetHeight: 200
    };
    return n;
  }
  /* The Music Mode chrome the podcast borrows, built the way the engine builds it:
     Repeat lives in the title row, the sound button and the progress arc in the root. */
  function mountChrome() {
    const root = makeEl('div');
    const row = makeEl('div'); row.className = 'vm-title-row';
    const repeat = makeEl('button'); repeat.className = 'vm-repeat'; repeat.textContent = '1x';
    row.appendChild(repeat);
    const snd = makeEl('button'); snd.className = 'vm-snd-open';
    const play = makeEl('button'); play.className = 'vm-play';
    const arc = makeEl('g'); arc.className = 'vm-arc';
    const arcBase = makeEl('path'); arcBase.className = 'vm-arc-base';
    root.appendChild(row); root.appendChild(snd); root.appendChild(play);
    root.appendChild(arc); root.appendChild(arcBase);
    return { root: root, titleRow: row, repeat: repeat, snd: snd, arc: arc, arcBase: arcBase };
  }
  /* chrome: true mounts the Music Mode root at load; 'enter' mounts it inside
     VM.enter(), the way the engine builds it on the first entry. */
  let chrome = opts.chrome === true ? mountChrome() : null;
  const chromeRoot = () => (chrome ? chrome.root : null);
  const document = {
    createElement: tag => (tag === 'audio' ? audio : makeEl(tag)),
    createElementNS: (ns, tag) => makeEl(tag),
    createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
    getElementById: id => (id === 'void-music-root' ? chromeRoot() : null),
    querySelector: () => null,
    addEventListener(n, fn) { (listeners.document[n] = listeners.document[n] || []).push(fn); },
    removeEventListener(t, fn) { const l = listeners.document[t] || []; const i = l.indexOf(fn); if (i >= 0) { listeners.document[t].splice(i, 1); } },
    body: makeEl('body'),
    head: makeEl('head'),
    hidden: false
  };
  const storeMod = require('./podcast-store.js');
  const store = storeMod.create(memStorage(opts.seed));
  let hosted = null, enterCount = 0, unhostCount = 0, hostCount = 0, ownerAtEnter = null;
  function broadcastOwner() {
    if (!opts.chrome) { return; }
    global.window.dispatchEvent(new global.window.CustomEvent('voidmusic:ownerchange', { detail: { owner: vm.owner } }));
  }
  const vm = {
    enter() { if (opts.chrome === 'enter') { chrome = mountChrome(); } enterCount++; ownerAtEnter = vm.owner; },
    hostGuest(el, meta) {
      hosted = { el, meta }; hostCount++;
      /* the real engine claims the session for the guest and broadcasts it */
      if (opts.chrome) { vm.owner = 'guest'; broadcastOwner(); }
    },
    unhostGuest() {
      hosted = null; unhostCount++;
      if (opts.chrome && vm.owner === 'guest') { vm.owner = null; broadcastOwner(); }
    },
    owner: null,   /* tests set 'music' to simulate a Music takeover (playId) */
    sessionOwner() { return vm.owner; }
  };
  const sessionWrites = [];
  const sessionHandlers = {};   /* Phase 2B.3: name -> fn while claimed, null once released */
  const metaWrites = [];   // metadata titles written to the session (null = cleared)
  let metaVal = null;
  const mediaSession = {
    setActionHandler(name, fn) { sessionWrites.push(name); sessionHandlers[name] = fn; }
  };
  Object.defineProperty(mediaSession, 'metadata', {
    configurable: true,
    get() { return metaVal; },
    set(v) { metaVal = v; metaWrites.push(v && v.title); }
  });
  const navObj = { mediaSession: mediaSession };
  const realNav = global.navigator;
  try { Object.defineProperty(global, 'navigator', { value: navObj, configurable: true }); } catch (e) { /* keep real */ }
  const thread = { starts: 0, stops: 0, start() { thread.starts++; }, stop() { thread.stops++; } };
  global.window = {
    __VOID_PODCAST_FLAG__: true,
    innerWidth: 1280, innerHeight: 800,
    VoidPodcastPlayerLogic: require('./podcast-player.js'),
    VoidMusic: vm,
    VoidPodcastSampleData: {
      EPISODES: [{
        id: 'e1', showId: 's1', guid: 'g1', title: 'Episode One', durationSec: 600,
        publishedAt: '2026-11-01T08:00:00Z', audioUrl: 'https://cdn.example.com/a.mp3',
        audioType: 'audio/mpeg', description: '', artUrl: '', chaptersUrl: '', chapters: null
      }],
      showById(id) { return id === 's1' ? { id: 's1', title: 'Show One', feedUrl: 'https://s.example.com/f.xml' } : null; },
      episodesOf(showId) { return showId === 's1' ? [this.EPISODES[0]] : []; }
    },
    VoidPodcastStore: storeMod,
    VoidPodcastWindow: { getStore: () => store },
    addEventListener(n, fn) { (listeners.window[n] = listeners.window[n] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent() {},
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    MediaMetadata: function (m) { Object.assign(this, m); }
  };
  global.document = document;
  global.getComputedStyle = () => ({ visibility: 'visible', display: 'block', fontSize: '19px', fontFamily: 'sans-serif' });
  if (opts.chrome) { global.window.VoidPodcastThread = thread; }
  const emitted = [];
  global.window.dispatchEvent = ev => {
    emitted.push(ev);
    (listeners.window[ev.type] || []).slice().forEach(fn => fn(ev));
    return true;
  };
  const ctlPath = path.join(__dirname, 'podcast-player.js');
  delete require.cache[require.resolve(ctlPath)];
  /* The controller reads `window.VoidPodcastPlayerLogic` but require() returns
     the Part-1 export only; re-require it so Part 2 sees the logic fresh. */
  require(ctlPath);
  const ctl = global.window.VoidPodcastPlayer;
  if (realNav !== undefined) { /* restore happens in unboot */ }
  return {
    ctl, audio, store, vm, listeners, sessionWrites, sessionHandlers, metaWrites, emitted,
    get hosted() { return hosted; },
    get enterCount() { return enterCount; },
    get unhostCount() { return unhostCount; },
    get hostCount() { return hostCount; },
    setOwner(v) { vm.owner = v; },
    fireOwner: broadcastOwner,
    get dom() { return chrome; },
    get ownerAtEnter() { return ownerAtEnter; },
    borrowed() { return ctl._test.chrome(); },
    thread,
    restoreNav() { try { Object.defineProperty(global, 'navigator', { value: realNav, configurable: true }); } catch (e) { /* keep stub */ } }
  };
}

const EP = { id: 'e1', showId: 's1', guid: 'g1', title: 'Episode One', audioUrl: 'https://cdn.example.com/a.mp3', durationSec: 600 };
const SHOW = { id: 's1', title: 'Show One' };

/* rate restore: persisted 1.5 -> playbackRate 1.5; garbage 1.1 snaps to 1 */
{
  const b = boot({ seed: { 'void.podcast.v1': JSON.stringify({ v: 2, rate: 1.5, subscriptions: [], progress: {}, queue: [], shows: {}, episodes: {}, opened: {} }) } });
  const r = b.ctl.play(EP, SHOW);
  ok(r.ok, 'boot: play ok');
  eq(b.audio.playbackRate, 1.5, 'boot: persisted rate restored');
  b.restoreNav();
}
{
  const b = boot({ seed: { 'void.podcast.v1': JSON.stringify({ v: 2, rate: 1.1, subscriptions: [], progress: {}, queue: [], shows: {}, episodes: {}, opened: {} }) } });
  b.ctl.play(EP, SHOW);
  eq(b.audio.playbackRate, 1, 'boot: unknown stored rate snaps to nearest step');
  b.restoreNav();
}

/* guest hosting + MediaSession claim on start; unhost on stop; no attachWeb use */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  ok(b.hosted && b.hosted.el === b.audio && b.hosted.meta.title === 'Episode One', 'session: podcast hosted via VM.hostGuest');
  ok(b.enterCount === 1, 'session: VM.enter called for the shell');
  const actions = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto', 'stop'];
  actions.forEach(a => ok(b.sessionWrites.indexOf(a) >= 0, 'session: claim set "' + a + '" handler'));
  ok(b.sessionWrites.filter(x => x === 'play').length === 1, 'session: exactly one play handler (no competing ownership)');
  b.ctl.stop();
  ok(b.unhostCount === 1, 'session: stop hands the engine back via unhostGuest');
  ok(b.hosted === null, 'session: no guest after stop');
  b.restoreNav();
}

/* ================= Phase 2B.3 (M5): explicit, owner-safe MediaSession release.
   After Podcast teardown no Podcast action handler may remain active. ======== */
const ACTIONS = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto', 'stop'];

/* M5-1 — claim attaches all eight handlers */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  ACTIONS.forEach(a => ok(a in b.sessionHandlers, 'M5-1: claim registered "' + a + '"'));
  ACTIONS.forEach(a => ok(typeof b.sessionHandlers[a] === 'function', 'M5-1: "' + a + '" is an active function handler'));
  b.restoreNav();
}

/* M5-2 — stop while the Podcast owns releases every handler and clears metadata */
{
  const b = boot();
  b.setOwner('guest');
  b.ctl.play(EP, SHOW);
  b.ctl.stop();
  ACTIONS.forEach(a => ok(b.sessionHandlers[a] === null, 'M5-2: stop detached "' + a + '"'));
  ok(b.metaWrites[b.metaWrites.length - 1] === null, 'M5-2: episode metadata cleared');
  ok(b.sessionWrites.length === 8 /* claim */ + 8 /* release */, 'M5-2: exactly one release pass per action');
  b.restoreNav();
}

/* M5-3 — stop after a Music takeover must not touch Music's session */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  const writesBefore = b.sessionWrites.length;
  const metaBefore = b.metaWrites.length;
  b.setOwner('music');            /* playId reclaimed the session mid-episode */
  b.ctl.stop();
  eq(b.sessionWrites.length, writesBefore, 'M5-3: no release writes when Music owns');
  eq(b.metaWrites.length, metaBefore, 'M5-3: Music metadata never cleared by Podcast teardown');
  ACTIONS.forEach(a => ok(typeof b.sessionHandlers[a] === 'function', 'M5-3: Podcast handlers were Music-owned all along'));
  b.restoreNav();
}

/* M5-4 — teardown of a session that never started releases nothing */
{
  const b = boot();
  b.setOwner('guest');
  b.ctl.stop();
  eq(Object.keys(b.sessionHandlers).length, 0, 'M5-4: inactive teardown writes no handlers');
  eq(b.metaWrites.length, 0, 'M5-4: inactive teardown writes no metadata');
  b.restoreNav();
}

/* M5-5 — repeated cycles leave nothing behind and never double-release */
{
  const b = boot();
  b.setOwner('guest');
  for (let i = 0; i < 3; i++) {
    b.ctl.play(EP, SHOW);
    ACTIONS.forEach(a => ok(typeof b.sessionHandlers[a] === 'function', 'M5-5: cycle ' + i + ' claimed'));
    b.ctl.stop();
    ACTIONS.forEach(a => ok(b.sessionHandlers[a] === null, 'M5-5: cycle ' + i + ' released'));
  }
  eq(b.sessionWrites.length, 48, 'M5-5: 3 cycles = 3 claims + 3 releases (6 x 8 actions), no extra writes');
  b.ctl.stop();
  eq(b.sessionWrites.length, 48, 'M5-5: stop after teardown is a no-op');
  b.restoreNav();
}

/* pause never re-claims; resume is a GENUINE start (Phase 2B.2) */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  const w0 = b.sessionWrites.length, m0 = b.metaWrites.length, h0 = b.hostCount;
  b.ctl.toggle();            // pause
  ok(b.sessionWrites.length === w0 && b.hostCount === h0, 'session: pause does not re-claim');
  b.ctl.toggle();            // resume
  ok(b.hostCount === h0 + 1, 'session: resume re-hosts the guest (Phase 2B.2 genuine resume)');
  ok(b.sessionWrites.length > w0, 'session: resume re-claims the session');
  ok(b.metaWrites.length > m0 && b.metaWrites[b.metaWrites.length - 1] === 'Episode One', 'session: resume republishes the episode metadata');
  b.restoreNav();
}

/* rate persistence through the public API */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  b.ctl.setRate(2);
  eq(b.store.getRate(), 2, 'rate: setRate persists');
  eq(b.audio.playbackRate, 2, 'rate: applies to the element');
  b.ctl.setRate(0.5);
  eq(b.store.getRate(), 2, 'rate: non-listed value rejected');
  b.restoreNav();
}

/* bounded retry: transient network error retried exactly once; permanent not */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  const queueBefore = JSON.stringify(b.store.getQueue());
  const realST = global.setTimeout;
  const timers = [];
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  b.audio.error = { code: 2, message: 'network' };
  fire(b.audio, 'error');
  ok(timers.length === 1 && timers[0].ms === 1500, 'retry: one bounded timer for MEDIA_ERR_NETWORK');
  const withTimer = timers.length;
  b.audio.error = { code: 2, message: 'network again' };
  fire(b.audio, 'error');
  ok(timers.length === withTimer, 'retry: second failure does not schedule another retry');
  timers[0].fn();
  global.setTimeout = realST;
  eq(b.audio.currentSrc, 'https://cdn.example.com/a.mp3', 'retry: load() re-issues the same source');
  eq(JSON.stringify(b.store.getQueue()), queueBefore, 'retry: queue untouched by the retry');
  ok(b.audio.error && b.audio.error.code === 2, 'retry: element error object left standing (ERROR not faked as PAUSED)');
  ok(b.ctl.getState().active === true, 'retry: session stays active through the retry');
  b.ctl.stop();
  ok(b.audio.error === null || b.unhostCount === 1, 'retry: stop still unwinds cleanly');
  b.restoreNav();
}
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  const realST = global.setTimeout;
  const timers = [];
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  b.audio.error = { code: 4, message: 'src not supported' };
  fire(b.audio, 'error');
  ok(timers.length === 0, 'retry: permanent error (MEDIA_ERR_SRC_NOT_SUPPORTED) never retried');
  global.setTimeout = realST;
  b.restoreNav();
}

/* pagehide flush */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  b.audio.duration = 600; b.audio.readyState = 4; b.audio.networkState = 1; b.audio.seekable = ranges(600);
  fire(b.audio, 'loadedmetadata');
  b.audio.currentTime = 84;
  fire(b.audio, 'seeked');
  const afterSeek = b.store.getProgress('e1');
  ok(afterSeek && afterSeek.positionSec === 84, 'seeked: podcast position is persisted after a seek');
  b.audio.currentTime = 120;
  (b.listeners.window.pagehide || []).forEach(fn => fn());
  const p = b.store.getProgress('e1');
  ok(p && p.positionSec >= 120, 'pagehide: progress flushed');
  b.restoreNav();
}

/* Seekability and resume retention: unresolved saved seeks must never turn
   into a zero write; a growing range remains unresolved during loading. */
{
  const L = require('./podcast-player.js');
  eq(L.seekability(600, 0, ranges(0)), 'unknown', 'seekability: metadata not ready remains unknown');
  eq(L.seekability(600, 4, ranges(600)), 'supported', 'seekability: full range supported');
  eq(L.seekability(600, 4, ranges(0)), 'incomplete', 'seekability: empty range awaits settling');
  eq(L.seekability(600, 4, ranges(90)), 'incomplete', 'seekability: partial range awaits settling');
  eq(L.seekability(Infinity, 4, ranges(0)), 'live', 'seekability: live source is exempt');

  const b = boot({ seed: { 'void.podcast.v1': JSON.stringify({ progress: { e1: { episodeId: 'e1', positionSec: 120, completed: false, updatedAt: 10 } } }) } });
  b.ctl.play(EP, SHOW);
  const savedBeforeMediaEvents = b.store.getProgress('e1').positionSec;
  b.audio.duration = 600; b.audio.readyState = 4; b.audio.networkState = 1; b.audio.seekable = ranges(0); b.audio.buffered = ranges(600);
  fire(b.audio, 'loadedmetadata');
  eq(b.audio.currentTime, 0, 'resume: assignment waits for seekability');
  eq(b.ctl._test.settleSeekability(), 'unsupported', 'resume: settled empty range is unsupported');
  b.audio.currentTime = 0;
  fire(b.audio, 'seeked'); fire(b.audio, 'timeupdate'); b.audio.pause();
  (b.listeners.window.pagehide || []).forEach(fn => fn());
  eq(b.store.getProgress('e1').positionSec, savedBeforeMediaEvents, 'resume: pause, seeked, timeupdate and pagehide retain saved point');
  b.restoreNav();
}
{
  const b = boot(); b.ctl.play(EP, SHOW);
  b.audio.duration = 600; b.audio.readyState = 4; b.audio.networkState = 2;
  b.audio.seekable = ranges(30); b.audio.buffered = ranges(100);
  let now = 0, timers = [], growthStayedUnknown = false, loadingStayedUnknown = false;
  const realST = global.setTimeout, realCT = global.clearTimeout;
  global.setTimeout = (fn, ms) => { timers.push({ fn, due: now + ms, cancelled: false }); return timers.length; };
  global.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].cancelled = true; };
  function tick(ms) {
    now += ms;
    let next;
    while ((next = timers.find(t => !t.cancelled && !t.done && t.due <= now))) { next.done = true; next.fn(); }
  }
  try {
    fire(b.audio, 'loadedmetadata'); tick(2000);
    b.audio.seekable = ranges(60); fire(b.audio, 'progress'); tick(2000);
    growthStayedUnknown = b.audio.seekCapability !== 'unsupported';
    tick(1000); loadingStayedUnknown = b.audio.seekCapability !== 'unsupported';
    b.audio.buffered = ranges(600); fire(b.audio, 'progress'); tick(3000);
  } finally { global.setTimeout = realST; global.clearTimeout = realCT; }
  ok(growthStayedUnknown, 'range growth: a growing incomplete range is not disabled');
  ok(loadingStayedUnknown, 'range growth: incomplete range remains enabled while bytes are loading');
  eq(b.audio.seekCapability, 'unsupported', 'settled range: fully buffered source with stable partial range disables seek');
  b.restoreNav();
}
{
  const b = boot({ seed: { 'void.podcast.v1': JSON.stringify({ progress: { e1: { episodeId: 'e1', positionSec: 120, completed: false, updatedAt: 10 } } }) } });
  b.ctl.play(EP, SHOW);
  b.audio.duration = 600; b.audio.readyState = 4; b.audio.networkState = 2; b.audio.seekable = ranges(600);
  fire(b.audio, 'loadedmetadata'); b.audio.snapBackOnSeek = true;
  b.ctl._test.seekTo(300);
  eq(b.audio.currentTime, 0, 'seek mismatch: test media snaps back to zero');
  fire(b.audio, 'seeked');
  eq(b.audio.seekCapability, 'unsupported', 'seek mismatch: seeked mismatch disables seek');
  eq(b.store.getProgress('e1').positionSec, 117, 'seek mismatch: previous resume point is not replaced by zero');
  b.restoreNav();
}
{
  const b = boot(); b.ctl.play(EP, SHOW);
  b.audio.duration = 600; b.audio.readyState = 4; b.audio.seekable = ranges(600);
  fire(b.audio, 'loadedmetadata');
  b.ctl._test.seekTo(-10);
  eq(b.audio.currentTime, 0, 'seek target: negative time clamps to zero');
  b.ctl._test.seekTo(900);
  eq(b.audio.currentTime, 600, 'seek target: time above duration clamps to end');
  b.audio.currentTime = 200;
  b.ctl._test.seekTo(NaN);
  eq(b.audio.currentTime, 200, 'seek target: NaN is ignored');
  b.ctl._test.seekBy(Infinity);
  eq(b.audio.currentTime, 200, 'seek delta: Infinity is ignored');
  b.restoreNav();
}

/* ended -> completed + queue advance is unchanged behaviour (queue integrity) */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  b.audio.ended = true;
  fire(b.audio, 'ended');
  const p = b.store.getProgress('e1');
  ok(p && p.completed === true, 'ended: episode marked completed');
  ok(b.ctl.getState().active === false, 'ended: single-episode queue unwinds to stop');
  b.restoreNav();
}

/* ---- Phase 2B.1 §3C: stop after a Music takeover must not clear Music's metadata ---- */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  ok(b.metaWrites.indexOf('Episode One') >= 0, 'claim: podcast metadata published at play (after the hostGuest claim)');
  b.setOwner('music');   /* the real engine reaches this via playId -> unhostGuest */
  b.ctl.stop();
  ok(b.metaWrites[b.metaWrites.length - 1] === 'Episode One', 'stop after takeover: Music metadata NOT cleared by the podcast teardown');
  ok(b.ctl.getState().active === false, 'stop after takeover: podcast session still closes');
  ok(b.audio.paused === true, 'stop after takeover: podcast element still stopped');
}
/* default path unchanged: stop with no takeover still clears metadata */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  b.ctl.stop();
  ok(b.metaWrites[b.metaWrites.length - 1] === null, 'stop (no takeover): metadata cleared as before 2B.1');
}
/* pause never rewrites metadata; resume republishes it (Phase 2B.2) */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  const n = b.metaWrites.length;
  b.ctl.toggle();            // pause
  ok(b.metaWrites.length === n, 'pause: metadata never rewritten');
  b.ctl.toggle();            // resume
  eq(b.metaWrites[b.metaWrites.length - 1], 'Episode One', 'resume: episode metadata republished');
}

/* ---- Phase 2B.1 §4: retry cancelled by stop during the delay ---- */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  const realST = global.setTimeout;
  const timers = [];
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  b.audio.error = { code: 2, message: 'network' };
  fire(b.audio, 'error');
  ok(timers.length === 1, 'cancel-stop: one retry timer scheduled');
  b.ctl.stop();
  ok(b.ctl.getState().active === false, 'cancel-stop: session closed while the retry waits');
  timers[0].fn();          // stale timer fires after the stop
  global.setTimeout = realST;
  ok(b.audio.paused === true && !b.audio.src, 'cancel-stop: stale retry does not resurrect playback or the source');
}
/* ---- Phase 2B.1 §4: retry cancelled by an episode change; allowance restored ---- */
{
  const b = boot();
  const sd = global.window.VoidPodcastSampleData;
  sd.EPISODES.push({ id: 'e2', showId: 's1', guid: 'g2', title: 'Episode Two', durationSec: 600,
    publishedAt: '2026-11-02T08:00:00Z', audioUrl: 'https://cdn.example.com/b.mp3', audioType: 'audio/mpeg',
    description: '', artUrl: '', chaptersUrl: '', chapters: null });
  sd.episodesOf = (showId) => (showId === 's1' ? sd.EPISODES.slice() : []);
  const EP2 = { id: 'e2', showId: 's1', guid: 'g2', title: 'Episode Two', audioUrl: 'https://cdn.example.com/b.mp3', durationSec: 600 };
  b.ctl.play(EP, SHOW);
  const realST = global.setTimeout;
  const timers = [];
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  b.audio.error = { code: 2, message: 'network' };
  fire(b.audio, 'error');
  ok(timers.length === 1, 'cancel-change: retry scheduled for the first episode');
  b.ctl.play(EP2, SHOW);   // episode change clears the pending retry
  timers[0].fn();          // stale timer flushes after the change
  eq(b.audio.currentSrc, 'https://cdn.example.com/b.mp3', 'cancel-change: stale retry replays the CURRENT episode only, never the old source');
  b.audio.error = { code: 2, message: 'network on new episode' };
  fire(b.audio, 'error');
  ok(timers.length === 2, 'cancel-change: the new episode gets a fresh retry allowance');
  global.setTimeout = realST;
}
/* ---- Phase 2B.1 §4: successful retry — the element recovers in place ---- */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  const realST = global.setTimeout;
  const timers = [];
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  b.audio.error = { code: 2, message: 'network' };
  fire(b.audio, 'error');
  timers[0].fn();
  global.setTimeout = realST;
  ok(b.audio.paused === false, 'retry-success: play() re-issued after load()');
  ok(b.ctl.getState().active === true, 'retry-success: session survives the recovery');
}

/* ---- Phase 2B.2: retry resume is a genuine resume — re-host + re-claim ---- */
{
  const b = boot();
  b.ctl.play(EP, SHOW);
  const realST = global.setTimeout;
  const timers = [];
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  b.audio.error = { code: 2, message: 'network' };
  fire(b.audio, 'error');
  const h0 = b.hostCount, w0 = b.sessionWrites.length;
  b.setOwner('music');       // Music took over while the retry waited
  timers[0].fn();            // retry fires
  global.setTimeout = realST;
  ok(b.hostCount === h0 + 1, 'retry-resume: re-hosts the guest (engine pauses Music there)');
  ok(b.sessionWrites.length > w0, 'retry-resume: re-claims the MediaSession');
  ok(b.ctl.getState().active === true && b.audio.paused === false, 'retry-resume: playback re-issued');
}

/* ---- Phase 2B.4: the Podcast element carries its OWN volume ---- */
{
  const b = boot();
  ok(b.audio.volume === 1, 'volume: a fresh element is restored to the store default');
  ok(typeof b.audio.setVol === 'function', 'volume: the element exposes the setVol verb the engine writes through');
  b.ctl.play(EP, SHOW);
  ok(b.audio.setVol(0.4) === 0.4, 'volume: setVol reports what it wrote');
  ok(b.audio.volume === 0.4, 'volume: the PODCAST element level changed');
  ok(b.store.getVolume() === 0.4, 'volume: the level went into the Podcast store (not Music localStorage)');
  ok(b.store.getState().volume === 0.4, 'volume: the stored payload carries volume');
  ok(b.ctl.getState().volume === 0.4, 'volume: getState reports the element level');
  ok(b.audio.setVol(9) === 1 && b.audio.volume === 1, 'volume: setVol clamps instead of throwing');
  ok(b.audio.setVol(-2) === 0 && b.store.getVolume() === 0, 'volume: clamped low value persisted');
}
{
  /* restore is tolerant, exactly like rate: whatever an old or hand-edited
     payload holds degrades to the default instead of poisoning playback. */
  const mk = (volume) => JSON.stringify({ v: 2, subscriptions: [], progress: {}, queue: [], shows: {}, episodes: {}, opened: {}, rate: 1.5, volume: volume });
  const kept = boot({ seed: { 'void.podcast.v1': mk(0.25) } });
  ok(kept.audio.volume === 0.25, 'volume: persisted level restored on boot');
  ok(kept.ctl.getState().rate === 1.5, 'volume: restoring volume leaves rate independent');
  const clampHigh = boot({ seed: { 'void.podcast.v1': mk(5) } });
  ok(clampHigh.audio.volume === 1, 'volume: out-of-range payload clamps on restore');
  const junk = boot({ seed: { 'void.podcast.v1': mk('loud') } });
  ok(junk.audio.volume === 1, 'volume: garbage payload restores the default');
  const preVolume = boot({ seed: { 'void.podcast.v1': JSON.stringify({ subscriptions: [], progress: {}, queue: [], shows: {}, episodes: {}, opened: {} }) } });
  ok(preVolume.audio.volume === 1, 'volume: a pre-volume payload restores the default (no migration needed)');
  preVolume.ctl.play(EP, SHOW);
  ok(preVolume.ctl.getState().rate === 1, 'volume: pre-volume payload still restores rate');
}

/* ---- Phase 2B.4 (Option B): Prev/Next step episodes inside the show ---- */
function threeEpisodeShow(b) {
  const sd = global.window.VoidPodcastSampleData;
  const mk = (id, n) => ({
    id: id, showId: 's1', guid: 'g' + n, title: 'Episode ' + n, durationSec: 600,
    publishedAt: '2026-11-0' + n + 'T08:00:00Z', audioUrl: 'https://cdn.example.com/' + id + '.mp3',
    audioType: 'audio/mpeg', description: '', artUrl: '', chaptersUrl: '', chapters: null
  });
  sd.EPISODES.length = 0;
  sd.EPISODES.push(mk('e3', 3), mk('e2', 2), mk('e1', 1));   // feed order, newest first
  sd.episodesOf = (showId) => (showId === 's1' ? sd.EPISODES.slice() : []);
  return sd;
}
{
  const b = boot();
  const sd = threeEpisodeShow(b);
  b.ctl.play(sd.EPISODES[0], SHOW);       // e3 (newest)
  eq(b.store.getQueue(), ['e3', 'e2', 'e1'], 'step: the queue is the whole show, current left in place');
  ok(b.audio.setVol(0.5) === 0.5, 'step precondition: podcast level set before stepping');

  let r = b.ctl.stepEpisode(1);
  ok(r.ok === true && r.episodeId === 'e2' && b.ctl.getState().episodeId === 'e2', 'step: Next walks to the older row');
  ok(b.audio.src === 'https://cdn.example.com/e2.mp3', 'step: the element re-sourced the new episode');
  ok(b.audio.volume === 0.5, 'step: the level survives the episode change (same element, not recreated)');
  r = b.ctl.stepEpisode(1);
  ok(r.ok === true && r.episodeId === 'e1', 'step: Next again reaches the oldest row');
  r = b.ctl.stepEpisode(1);
  ok(r.ok === false && r.reason === 'no-next', 'step: past the last row there is no next (never wraps)');
  eq([b.ctl.getState().episodeId, b.ctl.getState().active, b.ctl.getState().playing], ['e1', true, true], 'step: an unavailable Next leaves playback exactly as it was');
  r = b.ctl.stepEpisode(-1);
  ok(r.ok === true && r.episodeId === 'e2' && r.direction === -1, 'step: Previous walks back to the newer row');
  b.ctl.stepEpisode(-1);
  r = b.ctl.stepEpisode(-1);
  ok(r.ok === false && r.reason === 'no-previous' && b.ctl.getState().episodeId === 'e3', 'step: at the first row Previous is a no-op');
  ok(typeof b.sessionHandlers.nexttrack === 'function' && typeof b.sessionHandlers.previoustrack === 'function', 'step: the session handlers survive every step and every no-op');
  eq(b.metaWrites[b.metaWrites.length - 1], 'Episode 3', 'step: the published metadata follows the stepped episode');
  r = b.ctl.stepEpisode(0);
  ok(r.ok === true && r.direction === 1, 'step: a non-negative direction is forward (no garbage throws)');
}
{
  const b = boot();
  const sd = threeEpisodeShow(b);
  b.ctl.play(sd.EPISODES[1], SHOW);       // e2, paused by the user
  b.audio.pause();
  ok(b.ctl.getState().playing === false, 'step precondition: podcast paused');
  const r = b.ctl.stepEpisode(1);
  ok(r.ok === true && b.ctl.getState().episodeId === 'e1' && b.ctl.getState().playing === true, 'step: stepping while paused starts the neighbour (same rule as a library row and the end-of-episode rollover)');
  b.ctl.stop();
  eq(b.ctl.stepEpisode(1), { ok: false, reason: 'not-playing' }, 'step: nothing to step through after stop');
  ok(b.ctl.getState().active === false, 'step: stop state untouched by the refused step');
}
{
  /* the queue is the whole navigation domain: an id it does not carry is
     unreachable, and a row the feed lost is a refusal, not a silent swap. */
  const b = boot();
  const sd = threeEpisodeShow(b);
  b.ctl.play(sd.EPISODES[0], SHOW);       // e3
  b.store.setQueue(['e3', 'gone']);
  eq(b.ctl.stepEpisode(1), { ok: false, reason: 'episode-missing' }, 'step: a queue id the feed no longer carries is refused');
  ok(b.ctl.getState().episodeId === 'e3' && b.audio.paused === false, 'step: the refusal leaves the current episode playing');
  b.store.setQueue(['other']);
  eq(b.ctl.stepEpisode(1), { ok: false, reason: 'no-next' }, 'step: no advance outside the queue that holds the current row');
  eq(b.ctl.stepEpisode(-1), { ok: false, reason: 'no-previous' }, 'step: no step back outside that queue either');
  ok(b.ctl.getState().episodeId === 'e3', 'step: the current episode never moved');
}
{
  /* The verbs the dock and the OS actually call. */
  const b = boot();
  const sd = threeEpisodeShow(b);
  b.ctl.play(sd.EPISODES[0], SHOW);       // e3
  b.audio.currentTime = 100;
  b.sessionHandlers.nexttrack();
  ok(b.ctl.getState().episodeId === 'e2', 'action: MediaSession nexttrack steps the episode (Phase 2B.4, was +30s)');
  ok(b.audio.currentTime === 100, 'action: the step did not seek the new episode');
  b.audio.currentTime = 100;
  b.sessionHandlers.previoustrack();
  ok(b.ctl.getState().episodeId === 'e3', 'action: MediaSession previoustrack steps back');
  b.audio.currentTime = 100;
  b.sessionHandlers.seekforward({ seekOffset: 30 });
  ok(b.audio.currentTime === 130 && b.ctl.getState().episodeId === 'e3', 'action: seekforward keeps ±30 second seeking');
  b.sessionHandlers.seekbackward({});
  ok(b.audio.currentTime === 115, 'action: seekbackward without an offset keeps the 15 second default');
  b.audio.cmd('seekforward', 5);
  ok(b.audio.currentTime === 120, 'verb: the dock Shift+Arrow size reaches the podcast element');
  b.audio.currentTime = 20;
  b.audio.cmd('previoustrack');
  eq(b.ctl.getState().episodeId, 'e3', 'verb: dock Previous at the newest row is a safe no-op');
  ok(b.audio.currentTime === 20, 'verb: the refused step did not fall back to a −15 second seek');
  b.audio.cmd('nexttrack');
  eq(b.ctl.getState().episodeId, 'e2', 'verb: dock Next asks for the next episode');
  b.audio.cmd('unknown-verb');
  b.audio.cmd();
  ok(b.audio.currentTime === 20 && b.ctl.getState().episodeId === 'e2', 'verb: an unknown command changes nothing');
  b.ctl.stop();
  b.audio.cmd('nexttrack');
  ok(b.ctl.getState().active === false, 'verb: after teardown the element ignores dock commands');
}

/* ---- Phase 2B.5 §L: the borrowed chrome is ownership-keyed ----
   These boots mount the Music Mode root (at load, or inside VM.enter() the way the
   engine builds it), so Repeat, the arc, the sound button and the Voice Thread are
   real nodes and a Music takeover can be measured instead of asserted from the code. */
{
  const b = boot({ chrome: true });
  ok(b.ctl.play(EP, SHOW).ok, 'L: play ok');
  ok(b.borrowed() === true, 'L: a podcast that owns the session borrows the Music chrome');
  eq(b.ownerAtEnter, 'guest', 'L: the guest claim is ordered BEFORE Music Mode opens');
  eq(b.dom.titleRow.children.length, 2, 'L: the speed chip takes the seat next to Repeat');
  eq(b.dom.titleRow.children[0].className, 'vm-repeat pw-rate', 'L: the chip is the speed chip');
  eq(b.dom.repeat.style.display, 'none', 'L: Repeat is hidden only while the podcast owns playback');
  ok(b.dom.root.classList.contains('vm-podcast'), 'L: the podcast styling is on');
  eq(b.thread.starts, 1, 'L: the Voice Thread is started with the borrow');

  b.setOwner('music'); b.fireOwner();
  ok(b.borrowed() === false, 'L: a Music takeover hands the chrome back while the episode stays loaded');
  eq(b.dom.titleRow.children.length, 1, 'L: the speed chip is gone');
  eq(b.dom.repeat.style.display, '', 'L: the Music Repeat control is visible again');
  ok(!b.dom.root.classList.contains('vm-podcast'), 'L: the podcast styling is off');
  eq(b.thread.stops, 1, 'L: the Voice Thread is stopped with the borrow');
  eq(b.ctl.getState().active, true, 'L: the takeover unloads nothing');
  eq(b.audio.paused, false, 'L: giving the chrome back never pauses the podcast element');

  const mine = click();
  fire(b.dom.snd, 'click', mine);
  ok(!mine.defaultPrevented, 'L: with Music owning the session the sound button opens the Music popover, not the podcast sheet');

  b.setOwner('guest'); b.fireOwner();
  ok(b.borrowed() === true, 'L: the podcast gets the chrome back when it takes the session again');
  eq(b.thread.starts, 2, 'L: and starts the Voice Thread again');
  const theirs = click();
  fire(b.dom.snd, 'click', theirs);
  ok(theirs.defaultPrevented && theirs.stopImmediate, 'L: while the podcast owns the session the sound button is intercepted');
  const sheet = b.dom.root.querySelector('.pw-sheet');
  ok(!!sheet && sheet.hidden === false, 'L: the intercepted click opens the podcast sheet');
  b.ctl.stop();
  ok(b.borrowed() === false, 'L: teardown releases the chrome');
  eq(b.thread.stops, 2, 'L: exactly one stop per borrow');
  const afterStop = click();
  fire(b.dom.snd, 'click', afterStop);
  ok(!afterStop.defaultPrevented, 'L: the intercept is detached after teardown, not merely short-circuited');
  b.restoreNav();
}
{
  /* chapters: the ticks live on the arc of the Music Mode chrome and leave with the borrow */
  const b = boot({ chrome: 'enter' });
  b.audio.duration = 600;
  const epc = Object.assign({}, EP, { id: 'e9', title: 'Chaptered', chapters: [{ startSec: 60 }, { startSec: 300 }] });
  b.ctl.play(epc, SHOW);
  ok(b.borrowed() === true, 'L: the chrome is borrowed once enter() has built the root');
  eq(b.enterCount, 1, 'L: one entry');
  eq(b.dom.titleRow.children.length, 2, 'L: the chip sits in the built root, not in <body>');
  eq(b.dom.arc.children.length, 2, 'L: chapter ticks are drawn on the engine arc');
  b.setOwner('music'); b.fireOwner();
  eq(b.dom.arc.children.length, 0, 'L: the takeover clears the ticks with the rest of the chrome');
  b.ctl.stop();
  eq(b.dom.titleRow.children.length, 1, 'L: teardown leaves the title row with only the Repeat control it started with');
  b.restoreNav();
}

console.log('podcast-player-controller: ' + checks + ' assertions passed');
if (checks === 0) { process.exit(1); }
