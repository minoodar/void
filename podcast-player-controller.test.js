/* podcast-player controller (Part 2) — Node tests with a minimal fake DOM.
   Covers Phase 2B §D: rate persistence + safe restore, bounded retry (one,
   transient-only), pagehide flush, MediaSession claim, guest hosting contract,
   ERROR-vs-PAUSED preservation and queue integrity across a retry. */
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
function fire(el, name) { (el.listeners[name] || []).slice().forEach(fn => fn()); }

function boot(opts) {
  opts = opts || {};
  const listeners = { window: {}, document: {} };
  const audio = {
    nodeType: 1, tagName: 'AUDIO', listeners: {},
    preload: '', style: {}, parentNode: null, hidden: false,
    paused: true, ended: false, duration: NaN, currentTime: 0, playbackRate: 1,
    error: null, src: '', currentSrc: '',
    setAttribute() {}, removeAttribute(k) { if (k === 'src') { this.src = ''; this.currentSrc = ''; } },
    appendChild() {},
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    removeEventListener() {},
    load() { this.currentSrc = this.src; },
    play() { this.paused = false; fire(this, 'play'); return Promise.resolve(); },
    pause() { if (!this.paused) { this.paused = true; fire(this, 'pause'); } }
  };
  function makeEl() {
    return {
      style: {}, hidden: true, listeners: {}, classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        toggle() {}, contains(c) { return this._s.has(c); }
      },
      setAttribute() {}, getAttribute() { return null; },
      querySelector() { return null; },
      appendChild() {}, addEventListener() {}, removeEventListener() {}, focus() {}
    };
  }
  const document = {
    createElement: tag => (tag === 'audio' ? audio : makeEl()),
    createElementNS: () => makeEl(),
    getElementById: () => null,
    querySelector: () => null,
    addEventListener(n, fn) { (listeners.document[n] = listeners.document[n] || []).push(fn); },
    removeEventListener() {},
    body: makeEl(),
    head: makeEl(),
    hidden: false
  };
  const storeMod = require('./podcast-store.js');
  const store = storeMod.create(memStorage(opts.seed));
  let hosted = null, enterCount = 0, unhostCount = 0, hostCount = 0;
  const vm = {
    enter() { enterCount++; },
    hostGuest(el, meta) { hosted = { el, meta }; hostCount++; },
    unhostGuest() { hosted = null; unhostCount++; },
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
  global.window = {
    __VOID_PODCAST_FLAG__: true,
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
  const emitted = [];
  global.window.dispatchEvent = ev => { emitted.push(ev); };
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
  b.audio.currentTime = 120;
  (b.listeners.window.pagehide || []).forEach(fn => fn());
  const p = b.store.getProgress('e1');
  ok(p && p.positionSec >= 120, 'pagehide: progress flushed');
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

console.log('podcast-player-controller: ' + checks + ' assertions passed');
if (checks === 0) { process.exit(1); }
