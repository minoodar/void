/* void-music.js guest API — Phase 2B.1 §3 + Phase 2B.2 exclusivity. Node tests
   that load the REAL engine (no stubbed hostGuest/unhostGuest) and exercise the
   guest contract directly. Covers the acceptance scenarios:
   A  Music -> Podcast: hosting a playing podcast pauses the MUSIC element;
      element identity, position, src, volume, track, queue and history are
      preserved,
   B  podcast pause/resume leaves Music paused and untouched (ownership stays
      guest),
   X  repeated transitions: the two elements are never simultaneously unpaused,
   C  Podcast -> Music: the takeover pauses the podcast; with Music paused at
      teardown the session is left UNCLAIMED; the real MediaSession resume
      handler then claims it back; teardown/no-op paths never clobber it,
   D  MediaSession ownership follows ACTUAL playback: paused music with a
      selected track never reclaims on unhost; resuming claims + restores
      metadata; a paused podcast never reclaims when Music stops,
   E  teardown idempotence + listener unbind (double stop/unhost is a no-op),
   V  Phase 2B.4 volume: the shared slider writes the PODCAST element while the
      podcast owns the session — no Music element is created, no Music volume
      is written, M is a no-op, and the reported level follows the owner after
      a takeover in both directions,
   K  Phase 2B.4 verbs: Prev/Next hand the episode step to the guest and the
      ± second shortcuts hand seeks; after a Music takeover both go back to
      Music and nothing reaches the hosted-but-not-owned podcast element.
   The engine's MUSIC element is marked _silent: the real onPlayState writes the
   built chrome (browser-verified), so Node reads el.paused directly instead of
   firing element events. */
'use strict';
const assert = require('assert');
const path = require('path');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); checks++; }
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

function memStorage(seed) {
  const map = new Map(seed ? Object.entries(seed) : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); }
  };
}
function fire(el, name) { (el.listeners[name] || []).slice().forEach((fn) => fn()); }

function FakeAudio() {
  this.tagName = 'AUDIO';
  this.listeners = {};
  this.preload = '';
  this.paused = true;
  this.ended = false;
  this.duration = NaN;
  this.currentTime = 0;
  this.volume = 1;
  this.muted = false;
  this.playbackRate = 1;
  this.readyState = 0;
  this.crossOrigin = null;
  this.src = '';
  this.currentSrc = '';
  this.error = null;
  this.style = {};
  this._attrs = {};
}
FakeAudio.prototype.addEventListener = function (n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); };
FakeAudio.prototype.removeEventListener = function (n, fn) {
  const l = this.listeners[n] || []; const i = l.indexOf(fn); if (i >= 0) { l.splice(i, 1); }
};
FakeAudio.prototype.setAttribute = function (k, v) { this._attrs[k] = v; if (k === 'src') { this.src = v; } };
FakeAudio.prototype.getAttribute = function (k) { return k in this._attrs ? this._attrs[k] : null; };
FakeAudio.prototype.removeAttribute = function (k) { delete this._attrs[k]; if (k === 'src') { this.src = ''; this.currentSrc = ''; } };
FakeAudio.prototype.load = function () { this.currentSrc = this.src; };
/* Phase 2B.4: the Podcast player attaches a setVol verb to its OWN element and
   the engine writes guest volume only through it, so the verb has to exist on
   the fake to be observable (and the counter proves it was the path taken). */
FakeAudio.prototype.setVol = function (v) { this._volWrites = (this._volWrites || 0) + 1; this.volume = v; return v; };
FakeAudio.prototype.play = function () { this.paused = false; if (!this._silent) { fire(this, 'play'); } return Promise.resolve(); };
FakeAudio.prototype.pause = function () { if (!this.paused) { this.paused = true; if (!this._silent) { fire(this, 'pause'); } } };
FakeAudio.prototype.appendChild = function () {};

function bootEngine() {
  const handlers = {};
  const msWrites = [];
  let metaVal = null, stateVal = '';
  const mediaSession = {};
  Object.defineProperty(mediaSession, 'metadata', {
    configurable: true,
    get() { return metaVal; },
    set(v) { metaVal = v; msWrites.push({ kind: 'metadata', title: v && v.title }); }
  });
  Object.defineProperty(mediaSession, 'playbackState', {
    configurable: true,
    get() { return stateVal; },
    set(v) { stateVal = v; msWrites.push({ kind: 'state', v: v }); }
  });
  mediaSession.setActionHandler = function (name, fn) {
    handlers[name] = fn;
    msWrites.push({ kind: 'handler', name: name, fn: fn === null ? null : 'set' });
  };
  mediaSession.setPositionState = function (st) { msWrites.push({ kind: 'position', st: st }); };
  const navStub = { mediaSession: mediaSession };

  const winEvents = [];
  const window = {
    __VOID_PODCAST_FLAG__: true,
    /* pickFiles is reached when the MediaSession play key fires with no
       tracks; the stub aborts so the flow returns after ensureAudio(). */
    showOpenFilePicker: function () { return Promise.reject({ name: 'AbortError' }); },
    addEventListener(n) { winEvents.push(n); },
    removeEventListener() {},
    dispatchEvent() {},
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    MediaMetadata: function (m) { Object.assign(this, m); }
  };
  const makeEl = () => ({
    style: {}, listeners: {}, children: [], hidden: true,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle() {}, contains(c) { return this._s.has(c); } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {}, querySelector() { return null; },
    textContent: '', title: '', id: '', focus() {}
  });
  const document = {
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => makeEl(),
    createElementNS: () => makeEl(),
    addEventListener() {}, removeEventListener() {},
    body: makeEl(),
    head: makeEl(),
    documentElement: makeEl(),
    hidden: false
  };

  global.window = window;
  global.document = document;
  /* Electron-as-Node exposes navigator/location as getter-only globals */
  try { Object.defineProperty(global, 'navigator', { value: navStub, configurable: true }); } catch (e) { /* keep */ }
  try { Object.defineProperty(global, 'location', { value: { search: '' }, configurable: true }); } catch (e) { global.location = { search: '' }; }
  global.localStorage = memStorage();
  global.matchMedia = () => ({ matches: false });
  global.Audio = FakeAudio;
  global.URL.createObjectURL = () => 'blob:guest-test';
  global.URL.revokeObjectURL = () => {};
  /* the engine resolves these as bare globals (browser: window === global) */
  global.MediaMetadata = window.MediaMetadata;
  global.CustomEvent = window.CustomEvent;

  const enginePath = path.join(__dirname, 'void-music.js');
  delete require.cache[require.resolve(enginePath)];
  require(enginePath);
  const VM = global.window.VoidMusic;
  ok(!!VM && typeof VM.hostGuest === 'function' && typeof VM.sessionOwner === 'function', 'boot: real engine loaded with guest + sessionOwner API');
  return { VM, handlers, msWrites, winEvents, navStub, mediaSession };
}

/* setVolume/applyVolume are private; setOutputGain() is the public path that
   runs applyVolume() against S.audio. S.vol is set through _test.S. */
function setVol(b, v) {
  b.VM._test.S.vol = v;
  b.VM.setOutputGain(null);
}

/* Create the engine's OWN music element through the engine's real path:
   bindSession's play handler runs ensureAudio(). bindSession only runs after
   a host->unhost cycle in an unbuilt page, so prime with a throwaway guest.
   The element is marked _silent: firing its play/pause events would reach the
   real onPlayState, which writes the built chrome the Node harness lacks. */
function primeMusicElement(b) {
  const throwaway = new FakeAudio();
  b.VM.hostGuest(throwaway, { title: 'x', artist: 'y' });
  b.VM.unhostGuest();          // installs the MediaSession handlers (bindSession)
  ok(typeof b.handlers.play === 'function', 'prime: MediaSession play handler installed by the engine');
  b.handlers.play();           // real play key -> ensureAudio() creates the element
  const el = b.VM.getLocalAudio();
  ok(!!el && el.tagName === 'AUDIO' && b.VM.getAudio() === el, 'prime: engine created its own music element (S.audio === S.localAudio)');
  el._silent = true;
  return el;
}

/* "Music already playing" precondition, without firing element events
   (the real onPlayState writes unbuilt chrome; browser scenario covers it). */
function startMusic(b, opts) {
  opts = opts || {};
  const el = primeMusicElement(b);
  setVol(b, opts.volume != null ? opts.volume : 0.6);
  el.src = opts.src || 'http://127.0.0.1:8766/music.wav';
  el.currentSrc = el.src;
  el.currentTime = opts.currentTime != null ? opts.currentTime : 12.5;
  el.duration = 30;
  el.paused = false;
  return el;
}

function snapshot(el) {
  return { self: el, src: el.src, paused: el.paused, currentTime: el.currentTime, volume: el.volume, muted: el.muted, crossOrigin: el.crossOrigin, error: el.error };
}
function sameSnapshot(before, after, msg) {
  eq(after.self, before.self, msg + ': element identity unchanged');
  eq(after.src, before.src, msg + ': src unchanged');
  eq(after.paused, before.paused, msg + ': paused unchanged');
  eq(after.currentTime, before.currentTime, msg + ': currentTime unchanged');
  eq(after.volume, before.volume, msg + ': volume unchanged');
  eq(after.muted, before.muted, msg + ': muted unchanged');
  eq(after.crossOrigin, before.crossOrigin, msg + ': crossOrigin unchanged');
  eq(after.error, before.error, msg + ': error unchanged');
}
function lastMeta(b) {
  const metas = b.msWrites.filter((w) => w.kind === 'metadata');
  return metas.length ? metas[metas.length - 1].title : undefined;
}
function seedTrack(b) {
  b.VM._test.S.tracks = [{ id: 't1', name: 't.mp3', title: 'Take One', artist: 'Music', url: 'https://cdn.example.com/t.mp3' }];
  b.VM._test.S.curId = 't1';
  b.VM._test.S.bag = ['t2'];
  b.VM._test.S.history = ['t0'];
}

/* ---- A: Music -> Podcast — hosting a playing podcast pauses MUSIC ---- */
{
  const b = bootEngine();
  const music = startMusic(b);
  const before = snapshot(music);
  ok(before.paused === false && before.volume === 0.6, 'A precondition: music playing at its own volume');

  const pod = new FakeAudio();
  pod.src = 'https://cdn.example.com/ep.mp3';
  pod.currentSrc = pod.src;
  pod.currentTime = 340;
  pod.paused = false;          // the podcast is actively playing when hosted
  b.VM.hostGuest(pod, { title: 'Episode Nine', artist: 'Void Show' });

  ok(b.VM.isGuest() === true, 'A: guest hosted');
  ok(b.VM.sessionOwner() === 'guest', 'A: hosting is the explicit guest claim');
  ok(b.VM.getAudio() === music, 'A: getAudio() still returns MUSIC element');
  ok(b.VM.getLocalAudio() === music, 'A: getLocalAudio unchanged');
  ok(music.paused === true, 'A EXCLUSIVE: hosting a playing podcast pauses the MUSIC element');
  ok(music.currentTime === before.currentTime && music.src === before.src && music.volume === before.volume && music.crossOrigin === before.crossOrigin && music.muted === before.muted, 'A: music position/src/volume/crossOrigin/muted preserved (no reset)');
  ok(b.VM.getState().playing === false, 'A: getState().playing follows the MUSIC element (now paused)');
  ok(pod.paused === false, 'A: podcast keeps playing');

  /* volume path must never reach the guest element */
  setVol(b, 0.3);
  ok(music.volume === 0.3, 'A: volume path applies to MUSIC');
  ok(pod.volume === 1, 'A: volume path NEVER touches the podcast element');

  /* borrowed transport during guest: toggle acts on the guest only */
  b.VM.toggle();
  ok(pod.paused === true, 'A: shared toggle drives the GUEST (borrowed display)');
  ok(music.paused === true, 'A: toggle did not touch the music element');
  b.VM.toggle();
  ok(pod.paused === false, 'A: second toggle resumes the guest');
  ok(music.paused === true && b.VM.getAudio() === music, 'A: music stays paused through both directions of guest transport');
}

/* ---- A2: Music -> Podcast — track, queue and history preserved ---- */
{
  const b = bootEngine();
  const music = startMusic(b);
  seedTrack(b);
  const tracksBefore = b.VM._test.S.tracks.map((t) => t.id).join(',');
  const bagBefore = b.VM._test.S.bag.join(',');
  const histBefore = b.VM._test.S.history.join(',');
  const pod = new FakeAudio();
  pod.paused = false;
  b.VM.hostGuest(pod, { title: 'Ep', artist: 'Show' });
  eq(b.VM.getState().current, 't1', 'A2: current track preserved');
  eq(b.VM._test.S.tracks.map((t) => t.id).join(','), tracksBefore, 'A2: track list preserved');
  eq(b.VM._test.S.bag.join(','), bagBefore, 'A2: shuffle bag preserved');
  eq(b.VM._test.S.history.join(','), histBefore, 'A2: history preserved');
  ok(music.paused === true && music.currentTime === 12.5, 'A2: music paused with its position untouched');
}

/* ---- B: podcast pause/resume leaves Music paused and untouched ---- */
{
  const b = bootEngine();
  const music = startMusic(b);
  const pod = new FakeAudio();
  pod.paused = false;
  b.VM.hostGuest(pod, { title: 'Episode Nine', artist: 'Void Show' });
  const pausedByHost = snapshot(music);

  pod.pause();
  sameSnapshot(pausedByHost, snapshot(music), 'B pause');
  pod.play();
  sameSnapshot(pausedByHost, snapshot(music), 'B resume');
  ok(music.paused === true, 'B: music stayed paused through guest pause/resume (no wake)');
  ok(b.VM.sessionOwner() === 'guest', 'B: pause/resume does not change ownership');
}

/* ---- X: repeated transitions — never both elements unpaused ---- */
{
  const b = bootEngine();
  const music = startMusic(b);
  const pod = new FakeAudio();
  pod.src = 'https://cdn.example.com/ep.mp3';
  pod.currentSrc = pod.src;
  pod.currentTime = 50;
  pod.paused = false;
  let overlaps = 0;
  function sample(tag) { if (!music.paused && !pod.paused) { overlaps++; } ok(!(music.paused === false && pod.paused === false), 'X ' + tag + ': elements never both unpaused'); }
  for (let i = 0; i < 3; i++) {
    pod.play();                              // podcast (re)starts
    b.VM.hostGuest(pod, { title: 'Ep ' + i, artist: 'Show' });
    sample('cycle ' + i + ' podcast-start');
    ok(music.paused === true, 'X cycle ' + i + ': podcast start paused music');
    pod.pause();                             // == pauseGuestElement on music start
    b.VM.unhostGuest();
    music.paused = false;                    // music (re)starts
    sample('cycle ' + i + ' music-start');
    ok(pod.paused === true, 'X cycle ' + i + ': music start paused podcast');
  }
  eq(overlaps, 0, 'X: zero samples with both elements unpaused across 3 cycles');
}

/* ---- C: Podcast -> Music takeover + MediaSession resume claim ---- */
(async function () {
  {
    const b = bootEngine();
    const music = startMusic(b);
    const pod = new FakeAudio();
    pod.src = 'https://cdn.example.com/ep.mp3';
    pod.currentSrc = pod.src;
    pod.currentTime = 340;
    pod.paused = false;
    b.VM.hostGuest(pod, { title: 'Ep', artist: 'Show' });
    ok(b.VM.sessionOwner() === 'guest', 'C: guest owns');
    ok(music.paused === true, 'C: hosting paused Music (exclusive)');

    seedTrack(b);
    /* playId's real takeover order: pause the guest, unhost, then claim+play.
       Here Music is still paused at the unhost instant, so the session must be
       left unclaimed — never handed to a paused player. */
    pod.pause();                             // == pauseGuestElement (browser verifies the real call)
    b.VM.unhostGuest();
    ok(pod.paused === true, 'C: takeover paused the podcast element');
    ok(b.VM.isGuest() === false, 'C: takeover unhosted the guest');
    eq(pod.currentTime, 340, 'C: podcast position preserved by the takeover');
    eq(pod.src, 'https://cdn.example.com/ep.mp3', 'C: podcast episode source preserved by the takeover');
    ok(b.VM.sessionOwner() === null, 'C: unhost while Music is paused leaves the session UNCLAIMED');
    eq(lastMeta(b), null, 'C: metadata cleared (not stale episode, not a paused-track claim)');

    /* genuine Music start through the engine's real MediaSession resume path */
    b.handlers.play();
    await tick();
    ok(music.paused === false, 'C: MediaSession play resumed the MUSIC element');
    ok(b.VM.sessionOwner() === 'music', 'C: genuine Music start claims ownership');
    eq(lastMeta(b), 'Take One', 'C: resume published MUSIC metadata (not the episode)');

    /* late teardown attempts from the old player write nothing */
    const writesBefore = b.msWrites.length;
    b.VM.unhostGuest();
    b.VM.unhostGuest();
    ok(b.msWrites.length === writesBefore, 'C: late teardowns without a guest write NOTHING');
    ok(b.VM.sessionOwner() === 'music', 'C: ownership unchanged by no-op teardowns');
    ok(music.paused === false, 'C: music keeps playing through the no-op teardowns');
  }

  /* ---- D: ownership follows ACTUAL playback, not a selected track ---- */
  {
    const b = bootEngine();
    const music = startMusic(b);
    music.paused = true;                     // selected track, paused player
    seedTrack(b);

    const pod = new FakeAudio();
    pod.paused = true;                       // podcast starts paused in this scene
    b.VM.hostGuest(pod, { title: 'Ep', artist: 'Show' });
    ok(b.VM.sessionOwner() === 'guest', 'D: guest claimed after paused music');
    b.VM.unhostGuest();
    ok(b.VM.sessionOwner() === null, 'D: PAUSED music with a current track does NOT reclaim ownership');
    eq(lastMeta(b), null, 'D: no stale metadata from the paused reclaim');

    /* resuming Music claims and restores its metadata */
    b.handlers.play();
    await tick();
    ok(music.paused === false && b.VM.sessionOwner() === 'music', 'D: resuming Music claims ownership');
    eq(lastMeta(b), 'Take One', 'D: resume restored MUSIC metadata with the current track');

    /* a paused/dormant podcast never reclaims when Music stops */
    const writesBefore = b.msWrites.length;
    b.VM.toggle();                           // music pause
    ok(music.paused === true && b.VM.sessionOwner() === 'music', 'D: music pause keeps ownership (podcast inactive, no reclaim)');
    ok(b.msWrites.length === writesBefore, 'D: music pause writes nothing to MediaSession');
    b.VM.unhostGuest();
    ok(b.VM.sessionOwner() === 'music', 'D: dormant podcast teardown cannot take ownership back');
    eq(lastMeta(b), 'Take One', 'D: active player metadata never cleared by the dormant player');
  }

  /* D2: no current track -> teardown leaves the session unclaimed, never stale */
  {
    const b = bootEngine();
    primeMusicElement(b);
    setVol(b, 0.5);
    const pod = new FakeAudio();
    b.VM.hostGuest(pod, { title: 'Ep', artist: 'Show' });
    ok(b.VM.sessionOwner() === 'guest', 'D2: guest claimed (no track)');
    b.VM.unhostGuest();
    ok(b.VM.sessionOwner() === null, 'D2: no track -> ownership unclaimed');
    eq(lastMeta(b), null, 'D2: metadata cleared, no stale podcast title left');
  }

  /* ---- E: teardown idempotence + unbind removes the engine's guest listeners ---- */
  {
    const b = bootEngine();
    primeMusicElement(b);
    setVol(b, 0.5);
    const music = b.VM.getLocalAudio();
    const pod = new FakeAudio();
    b.VM.hostGuest(pod, { title: 'Ep', artist: 'Show' });
    ok((pod.listeners.play || []).length > 0 && (pod.listeners.pause || []).length > 0, 'E: engine bound its own listeners to the guest element');
    b.VM.unhostGuest();
    const writesAfterFirst = b.msWrites.length;
    b.VM.unhostGuest();
    b.VM.unhostGuest();
    ok(b.msWrites.length === writesAfterFirst, 'E: repeated unhost after the first writes nothing');
    ok(b.VM.isGuest() === false, 'E: triple unhost stays unhosted');
    ok(b.VM.getLocalAudio() === music && music.paused === true, 'E: music element untouched by teardowns');
    ok((pod.listeners.play || []).length === 0 && (pod.listeners.pause || []).length === 0, 'E: engine listeners removed from the guest element (no ghost updates)');
    const writesBefore = b.msWrites.length;
    pod.pause();
    pod.play();
    ok(b.msWrites.length === writesBefore, 'E: detached guest element drives NOTHING (no MediaSession writes, no chrome updates)');
  }

  /* ---- dismiss (full stop) is owner-aware during a guest session ---- */
  {
    const b = bootEngine();
    const music = startMusic(b);
    const pod = new FakeAudio();
    pod.paused = false;
    b.VM.hostGuest(pod, { title: 'Ep', artist: 'Show' });
    ok(music.paused === true, 'dismiss precondition: hosting paused music');
    const handlersBefore = b.msWrites.filter((w) => w.kind === 'handler').length;
    b.VM.dismiss();
    ok(music.paused === true, 'dismiss: full stop leaves MUSIC stopped');
    ok(music.src === '', 'dismiss: music source cleared');
    ok(pod.paused === false, 'dismiss: podcast element never paused from this path');
    ok(b.VM.sessionOwner() === 'guest', 'dismiss: guest still owns the session');
    const handlerWrites = b.msWrites.filter((w) => w.kind === 'handler').length;
    ok(handlerWrites === handlersBefore, 'dismiss: no MediaSession unbind while the guest owns');
    ok(b.VM.isGuest() === true, 'dismiss: hosting survives a music stop');
    ok(b.VM.getState().playing === false, 'dismiss: music truth is stopped');
  }

  /* ---- F: Phase 2B.3 — exclusivity asserted AT the playback boundary, not by
     the early return alone (H3). Both guards are reachable through real entry
     points when the other player wakes up inside an await window. ---- */

  /* F1: repeat-on-ended pauses a live guest before restarting Music */
  {
    const b = bootEngine();
    const music = startMusic(b);            // Music playing
    seedTrack(b);
    const pod = new FakeAudio();
    pod.src = 'https://cdn.example.com/ep.mp3';
    pod.currentSrc = pod.src;
    pod.paused = false;                     // a guest that is still running
    b.VM.hostGuest(pod, { title: 'Episode Nine', artist: 'Void Show' });
    ok(music.paused === true, 'F1 precondition: hosting paused Music');
    /* the state the guard defends against: Music running with a live guest */
    b.VM._test.S.sessionOwner = 'music';
    music.paused = false;
    b.VM._test.S.repeat = 1;
    fire(music, 'ended');                   // the engine's own ended listener
    ok(pod.paused === true, 'F1 EXCLUSIVE: repeat-on-ended paused the live guest at the boundary');
    eq(music.currentTime, 0, 'F1: Music restarts from zero');
    ok(music.paused === false, 'F1: Music keeps playing');
    eq(b.VM._test.S.repeat, 0, 'F1: repeat counter consumed by this replay');
  }

  /* F1b: with repeat off, end delegates to next() — and while a Podcast guest
     owns the transport, next/prev route to the guest instead of starting
     Music (playId needs the built UI in Node; the browser run covers it). */
  {
    const b = bootEngine();
    const music = startMusic(b);
    seedTrack(b);
    const calls = [];
    const pod = new FakeAudio();
    pod.src = 'https://cdn.example.com/ep.mp3';
    pod.currentSrc = pod.src;
    pod.currentTime = 340;
    pod.paused = false;
    pod.cmd = function (name) { calls.push(name); };
    b.VM.hostGuest(pod, { title: 'Episode Nine', artist: 'Void Show' });
    music.paused = false;                   // the state the guard defends against
    b.VM._test.S.repeat = 0;
    fire(music, 'ended');
    eq(calls, ['nexttrack'], 'F1b: end-without-repeat hands advance to the podcast guest');
    eq(music.currentTime, 12.5, 'F1b: Music never seeked or restarted by the advance');
    b.VM.next();
    b.VM.prev();
    eq(calls, ['nexttrack', 'nexttrack', 'previoustrack'], 'F1b: shared next/prev delegate to the guest while hosted');
    ok(b.VM.sessionOwner() === 'guest', 'F1b: ownership stays with the guest that is actually playing');
    eq(lastMeta(b), null, 'F1b: no Music metadata published over the episode (last write is the prime-time clear)');
  }

  /* F2: a Podcast that starts while claimPlayback() is pending is still paused
     when the Music resume callback lands (toggle's early return could not know) */
  {
    const b = bootEngine();
    const music = startMusic(b);
    seedTrack(b);
    music.paused = true;                    // Music selected but paused, no guest yet
    ok(b.VM.isGuest() === false, 'F2 precondition: no guest hosted at press time');
    b.VM.toggle();                          // early return not taken; claim is pending
    const pod = new FakeAudio();
    pod.src = 'https://cdn.example.com/ep.mp3';
    pod.currentSrc = pod.src;
    pod.paused = false;
    b.VM.hostGuest(pod, { title: 'Late Episode', artist: 'Late Show' });   // race lands mid-await
    ok(b.VM.sessionOwner() === 'guest', 'F2: the late podcast claimed the session');
    await tick();
    ok(pod.paused === true, 'F2 EXCLUSIVE: the pending Music resume paused the guest that started mid-await');
    ok(music.paused === false, 'F2: Music resumes as the user asked');
    ok(b.VM.sessionOwner() === 'music', 'F2: ownership ends with the player that actually plays');
  }

  /* F3: MediaSession Music play with a live guest claims back exclusively */
  {
    const b = bootEngine();
    const music = startMusic(b);
    seedTrack(b);
    music.paused = true;
    const pod = new FakeAudio();
    pod.paused = false;
    b.VM.hostGuest(pod, { title: 'Episode', artist: 'Show' });
    b.handlers.play();                      // real MediaSession play handler
    await tick();
    ok(pod.paused === true && music.paused === false, 'F3: system Media key resumes Music and pauses the podcast');
    ok(b.VM.sessionOwner() === 'music', 'F3: ownership moved with the audible player');
  }

  /* ---- V: Phase 2B.4 — Podcast-scoped volume on the shared dock slider ----
     The shipped defect: setVolume()/toggleMute() opened with ensureAudio(), so
     during a Podcast session the slider moved a Music element that never made
     a sound (and M created one). Both paths must now follow the owner. */
  {
    const b = bootEngine();
    const pod = new FakeAudio();
    pod.src = 'https://cdn.example.com/ep.mp3'; pod.currentSrc = pod.src;
    pod.volume = 1; pod.paused = false;
    b.VM.hostGuest(pod, { title: 'Episode Nine', artist: 'Void Show' });
    ok(b.VM.sessionOwner() === 'guest' && b.VM.getAudio() === null, 'V precondition: podcast owns, Music has no element');

    ok(b.VM.setVolume(0.35) === true, 'V: the slider succeeds through the guest path');
    ok(pod.volume === 0.35 && pod._volWrites === 1, 'V: the PODCAST element volume is what changed (via its own verb)');
    ok(b.VM.getAudio() === null && b.VM.getLocalAudio() === null, 'V: the guest volume path creates no Music element');
    ok(global.localStorage.getItem('voidMusic.volume') === null, 'V: Music volume setting not written to storage');
    ok(b.VM._test.S.vol === 0.8 && b.VM._test.S.muted === false, 'V: Music own volume/mute state untouched');
    ok(b.VM.volume() === 0.35 && b.VM.getState().vol === 0.35 && b.VM.getState().musicAudio === false, 'V: the chrome reports the owner level');

    ok(b.VM.toggleMute() === false, 'V: M while the podcast owns playback is a no-op');
    ok(b.VM.getAudio() === null, 'V: M created no Music element');
    ok(pod.volume === 0.35 && pod.muted === false && pod.paused === false && pod._volWrites === 1, 'V: M left the podcast playing at its own level, no extra write');

    ok(b.VM.setVolume('loud') === false && b.VM.setVolume(NaN) === false && b.VM.setVolume(undefined) === false, 'V: garbage refused on the guest path too');
    ok(pod.volume === 0.35 && pod._volWrites === 1, 'V: a refused set leaves the podcast level alone');
    ok(b.VM.setVolume(0) === true && pod.volume === 0 && b.VM.volume() === 0, 'V: podcast silence = its own element at 0');
  }

  /* V2: with BOTH elements alive, the slider follows the owner and never
     crosses over in either direction. */
  {
    const b = bootEngine();
    const music = startMusic(b, { volume: 0.6 });
    const lsBefore = global.localStorage.getItem('voidMusic.volume');
    seedTrack(b);
    const pod = new FakeAudio(); pod.paused = false; pod.volume = 1;
    b.VM.hostGuest(pod, { title: 'Episode Nine', artist: 'Void Show' });
    const before = snapshot(music);

    b.VM.setVolume(0.2);
    ok(pod.volume === 0.2 && pod._volWrites === 1, 'V2: podcast level written');
    sameSnapshot(before, snapshot(music), 'V2: the guest path never reaches the MUSIC element');
    ok(b.VM._test.S.vol === 0.6 && global.localStorage.getItem('voidMusic.volume') === lsBefore, 'V2: Music volume state and setting kept');

    b.handlers.play();                        // real takeover: Music claims the session back
    await tick();
    ok(b.VM.sessionOwner() === 'music' && music.paused === false && pod.paused === true, 'V2: Music took the session and paused the podcast');
    ok(b.VM.setVolume(0.5) === true, 'V2: the slider now takes the Music path');
    ok(music.volume === 0.5 && b.VM._test.S.vol === 0.5, 'V2: with Music owning, the slider writes MUSIC');
    ok(pod.volume === 0.2 && pod._volWrites === 1, 'V2: and NEVER the podcast element');
    ok(global.localStorage.getItem('voidMusic.volume') === '0.5', 'V2: Music volume setting persisted on the Music path');
    ok(b.VM.volume() === 0.5 && b.VM.getState().vol === 0.5, 'V2: chrome follows the new owner');
    ok(b.VM.toggleMute() === true && music.muted === true && pod.volume === 0.2, 'V2: M belongs to Music again, podcast untouched');
  }

  /* ---- K: Phase 2B.4 — dock verbs: Prev/Next step episodes, ± seconds seek ---- */
  {
    const b = bootEngine();
    const music = startMusic(b);
    seedTrack(b);
    const calls = [];
    const pod = new FakeAudio(); pod.paused = false;
    pod.cmd = function (name, arg) { calls.push([name, arg]); };
    b.VM.hostGuest(pod, { title: 'Episode Nine', artist: 'Void Show' });

    b.VM.next(); b.VM.prev();
    eq(calls.map(function (c) { return c[0]; }), ['nexttrack', 'previoustrack'], 'K: shared Prev/Next hand the step to the guest (episode steps live there)');
    calls.length = 0;

    music.currentTime = 12.5;
    b.VM._test.seekBy(15);
    b.VM._test.seekBy(-5);
    eq(calls, [['seekforward', 15], ['seekbackward', 5]], 'K: ± second shortcuts become guest seeks (Shift+Arrow sizes pass through)');
    ok(music.currentTime === 12.5, 'K: no ± second write reaches the MUSIC element while the podcast owns playback');
    calls.length = 0;

    b.handlers.play();                        // takeover: the guest stays hosted but stops owning
    await tick();
    ok(b.VM.sessionOwner() === 'music' && pod.paused === true, 'K precondition: Music owns, guest still hosted');
    music.currentTime = 12.5;
    b.VM.prev();
    eq(music.currentTime, 0, 'K: with Music owning, Prev is Music rewind (not an episode step)');
    b.VM._test.seekBy(15);
    eq(music.currentTime, 15, 'K: ± seconds go back to the MUSIC element when Music owns');
    eq(calls, [], 'K: nothing is sent to the hosted-but-not-owned podcast verbs');
    ok(pod.paused === true && pod.volume === 1, 'K: the podcast element stays paused and untouched');
  }

  console.log('void-music-guest: ' + checks + ' assertions passed');
  if (checks === 0) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
