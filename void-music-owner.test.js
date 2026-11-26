/* void-music.js + void-music-viz.js ownership lifecycle — Phase 2B.5. These tests load
   the REAL engine over a fake DOM rich enough for enter() to actually build the chrome,
   and (section V) the REAL visualizer beside it. Covers:
   W  voidmusic:ownerchange is the one broadcast of every ownership transition, and fires
      for none of the non-transitions (re-hosting the same element, unbind);
   N  enter() is guest-safe: a guest-owned entry sends no Music wake, the metadata the
      guest claimed before the UI existed lands in the built title, Music keeps its own
      Repeat control, and the guest keeps the MediaSession controls it bound (a Music-only
      entry still rebinds and still wakes);
   V  the visualizer never builds a cosmic session for a guest-owned Music Mode entry —
      the state a Podcast started while Music was still playing — while an entry owned by
      Music (or owned by nobody in the payload) still starts it;
   R  Music keeps its own Repeat state through a Podcast hosting cycle: the 1 -> 2 -> 3 ->
      off cycle belongs to the engine, and the Podcast borrows only the control slot.
   The engine's state is driven through the real hostGuest/unhostGuest/unbindGuest APIs.
   Each boot loads the scripts with vm.runInContext: require() would hand back the cached
   IIFE and a second boot would read the first instance's state. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); checks++; }
function why(e) { return String((e && e.message) || e); }
function pointer(el, type, x) {
  (el.listeners[type] || []).slice().forEach(fn => fn({
    clientX: x, pointerId: 1, target: el,
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
  }));
}

function memStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); }
  };
}

/* The chrome is read by class and by id, so classList must be backed by className and
   setAttribute('id') must register the node — the fake DOMs of the other suites never
   build this far. */
function makeDom() {
  const byId = {};
  function clsOf(n) { return (' ' + (n.className || '') + ' ').split(' ').filter(Boolean); }
  function makeEl(tag) {
    const n = {
      tagName: String(tag || 'div').toUpperCase(), className: '', id: '', textContent: '', title: '',
      hidden: true, dataset: {}, children: [], parentNode: null, listeners: {}, attr: {},
      style: {
        setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; },
        getPropertyValue(k) { return this[k] || ''; }
      },
      classList: {
        add() { const s = clsOf(n); Array.prototype.forEach.call(arguments, x => { if (s.indexOf(x) < 0) s.push(x); }); n.className = s.join(' '); },
        remove() { const s = clsOf(n); Array.prototype.forEach.call(arguments, x => { const i = s.indexOf(x); if (i >= 0) s.splice(i, 1); }); n.className = s.join(' '); },
        toggle(c, force) { const has = this.contains(c); const on = force === undefined ? !has : !!force; if (on) this.add(c); else this.remove(c); return on; },
        contains(c) { return clsOf(n).indexOf(c) >= 0; }
      },
      setAttribute(k, v) {
        n.attr[k] = String(v);
        if (k === 'class') n.className = String(v);
        if (k === 'id') { n.id = String(v); byId[String(v)] = n; }
        if (k === 'hidden') n.hidden = true;
      },
      getAttribute(k) { return k in n.attr ? n.attr[k] : null; },
      removeAttribute(k) { delete n.attr[k]; if (k === 'hidden') n.hidden = false; },
      appendChild(c) { c.parentNode = n; n.children.push(c); if (c.id) byId[c.id] = c; return c; },
      append() { Array.prototype.forEach.call(arguments, c => n.appendChild(c)); },
      insertBefore(c, ref) {
        c.parentNode = n; const i = n.children.indexOf(ref);
        n.children.splice(i < 0 ? n.children.length : i, 0, c); if (c.id) byId[c.id] = c; return c;
      },
      removeChild(c) { const i = n.children.indexOf(c); if (i >= 0) n.children.splice(i, 1); c.parentNode = null; return c; },
      remove() { if (n.parentNode) n.parentNode.removeChild(n); },
      contains(c) { if (c === n) return true; return n.children.some(x => x.contains && x.contains(c)); },
      closest(sel) { let p = n; while (p) { if (p.matches(sel)) return p; p = p.parentNode; } return null; },
      matches(sel) { return sel[0] === '.' ? clsOf(n).indexOf(sel.slice(1)) >= 0 : n.id === sel.slice(1); },
      addEventListener(t, fn) { (n.listeners[t] = n.listeners[t] || []).push(fn); },
      removeEventListener(t, fn) { const l = n.listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
      querySelector(sel) { return find(n, sel)[0] || null; },
      querySelectorAll(sel) { return find(n, sel); },
      focus() {}, blur() {},
      click() { (n.listeners.click || []).slice().forEach(fn => fn({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} })); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 }; },
      getClientRects() { return [{ width: 100, height: 40 }]; },
      setPointerCapture() {}, releasePointerCapture() {}, scrollIntoView() {},
      animate() { return { cancel() {}, finished: Promise.resolve() }; },
      getTotalLength() { return 100; }, getPointAtLength() { return { x: 1, y: 1 }; },
      getContext() { return null; }
    };
    if (n.tagName === 'SELECT') {
      n.options = [];
      const append = n.appendChild;
      n.appendChild = function (c) { append(c); if (c.tagName === 'OPTION') n.options.push(c); return c; };
    }
    return n;
  }
  function find(scope, sel) {
    const out = [];
    const parts = sel.split(',');
    const walk = n => { n.children.forEach(c => { if (parts.some(p => c.matches && c.matches(p.trim()))) out.push(c); walk(c); }); };
    walk(scope);
    return out;
  }
  const listeners = {};
  const body = makeEl('body');
  const document = {
    readyState: 'complete', body: body, head: makeEl('head'), documentElement: makeEl('html'),
    hidden: false, title: 'void', activeElement: null,
    createElement: t => makeEl(t), createElementNS: (ns, t) => makeEl(t),
    getElementById: id => byId[id] || null,
    querySelector: sel => find(body, sel)[0] || (sel[0] === '#' ? byId[sel.slice(1)] || null : null),
    querySelectorAll: sel => find(body, sel),
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { const l = listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }) })
  };
  return { document: document, byId: byId };
}

function boot(opts) {
  const o = opts || {};
  const dom = makeDom();
  const events = [];                    // every window event, in dispatch order
  const winL = {};
  const errors = [];                    // anything a listener or a frame threw
  const ms = { handlers: {}, binds: 0 };
  function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
  const raf = fn => setTimeout(() => { try { fn(Date.now()); } catch (e) { errors.push('rAF: ' + why(e)); } }, 0);
  const win = {
    __VOID_PODCAST_FLAG__: true,
    document: dom.document,
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    addEventListener(t, fn) { (winL[t] = winL[t] || []).push(fn); },
    removeEventListener(t, fn) { const l = winL[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    dispatchEvent(ev) {
      events.push({ type: ev.type, detail: ev.detail });
      (winL[ev.type] || []).slice().forEach(fn => { try { fn(ev); } catch (e) { errors.push(ev.type + ': ' + why(e)); } });
      return true;
    },
    CustomEvent: CustomEvent,
    MediaMetadata: function (m) { Object.assign(this, m); },
    requestAnimationFrame: raf, cancelAnimationFrame: t => clearTimeout(t),
    matchMedia: () => ({ matches: false }),
    localStorage: memStorage(),
    showOpenFilePicker: () => Promise.reject({ name: 'AbortError' })
  };
  const storage = win.localStorage;
  const navigator = {
    userAgent: 'node', hardwareConcurrency: 4,
    mediaSession: {
      setActionHandler(n, fn) { ms.binds++; ms.handlers[n] = fn; },
      setPositionState() {}
    }
  };
  const ctx = vm.createContext({
    window: win, document: dom.document, navigator: navigator, localStorage: storage,
    location: { search: '' }, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    screen: { width: 1280, height: 800 },
    CustomEvent: CustomEvent, console: console,
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
    requestAnimationFrame: raf, cancelAnimationFrame: t => clearTimeout(t),
    performance: { now: () => Date.now() },
    matchMedia: win.matchMedia,
    getComputedStyle: () => ({ display: 'block', fontSize: '19px', fontFamily: 'sans-serif', visibility: 'visible' }),
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    Audio: function () {
      Object.assign(this, {
        paused: true, ended: false, currentTime: 0, duration: NaN, readyState: 0, volume: 1, src: '',
        listeners: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {},
        getAttribute() { return null; }, removeAttribute() {}, load() {},
        play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; }
      });
    },
    URL: { createObjectURL: () => 'blob:node', revokeObjectURL: () => {} },
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = i + 1; return a; } },
    Promise: Promise, Object: Object, Array: Array, String: String, Number: Number, Boolean: Boolean,
    Error: Error, TypeError: TypeError, RangeError: RangeError, SyntaxError: SyntaxError,
    Math: Math, Date: Date, JSON: JSON, RegExp: RegExp, Function: Function, Map: Map, Set: Set,
    Symbol: Symbol, isNaN: isNaN, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat,
    Infinity: Infinity, NaN: NaN, undefined: undefined,
    TextEncoder: TextEncoder, TextDecoder: TextDecoder, ArrayBuffer: ArrayBuffer, DataView: DataView,
    Float32Array: Float32Array, Uint8Array: Uint8Array, Uint32Array: Uint32Array,
    Int32Array: Int32Array, Uint16Array: Uint16Array,
    URLSearchParams: URLSearchParams
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'void-music.js'), 'utf8'), ctx, { filename: 'void-music.js' });
  const VM = win.VoidMusic;
  if (o.viz) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'void-music-viz.js'), 'utf8'), ctx, { filename: 'void-music-viz.js' });
  }
  return {
    VM: VM, viz: win.VoidMusicViz, S: VM._test.S, dom: dom, win: win, events: events, errors: errors, ms: ms,
    CustomEvent: CustomEvent,
    owners: () => events.filter(e => e.type === 'voidmusic:ownerchange').map(e => e.detail && e.detail.owner),
    types: () => events.map(e => e.type),
    el: sel => dom.document.querySelector(sel),
    audio: props => Object.assign({
      tagName: 'AUDIO', paused: true, ended: false, currentTime: 0, duration: 100, readyState: 3,
      volume: 1, playbackRate: 1, listeners: {},
      addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
      load() {}, setVol() {}, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; }
    }, props || {}),
    fire: (type, detail) => win.dispatchEvent(new CustomEvent(type, { detail: detail }))
  };
}

/* Payloads built inside the vm context keep the context's prototypes, so they are read
   field by field instead of compared as objects. */
function entry(h) {
  const at = h.events.map(e => e.type).lastIndexOf('voidmusic:mode');
  ok(at >= 0, 'harness: the entry broadcast voidmusic:mode');
  const d = h.events[at].detail || {};
  return {
    open: d.open === true,
    owner: 'owner' in d ? d.owner : 'missing',
    wakes: h.events.slice(at + 1).filter(e => e.type === 'voidmusic:playing').length
  };
}

(async function main() {
  /* ---- W: the ownership broadcast ---- */
  {
    const h = boot();
    eq(h.owners(), [], 'W: nothing claims the session at boot');
    const guest = h.audio({ paused: true });
    h.VM.hostGuest(guest, { title: 'Episode', artist: 'Show' });
    eq(h.owners(), ['guest'], 'W: hosting a guest broadcasts exactly one transition');
    h.VM.hostGuest(guest, null);
    eq(h.owners(), ['guest'], 'W: re-hosting the same element is not a transition and broadcasts nothing');
    h.VM.hostGuest(h.audio({ paused: true }), null);
    eq(h.owners(), ['guest'], 'W: swapping in another guest element unbinds the old one without a second transition');
    ok(h.S.guest && h.VM.isGuest(), 'W: the new element is the one hosted');
  }
  {
    const h = boot();
    const guest = h.audio({ paused: true });
    h.VM.hostGuest(guest, { title: 'Episode', artist: 'Show' });
    h.VM.unhostGuest();
    eq(h.owners(), ['guest', null], 'W: teardown with Music paused leaves the session unclaimed, and says so');
    h.VM.hostGuest(guest, null);
    eq(h.owners(), ['guest', null, 'guest'], 'W: the second claim broadcasts again');
  }
  {
    const h = boot();
    const guest = h.audio({ paused: true });
    h.S.audio = h.audio({ paused: false });                 // Music audible before the guest arrives
    h.S.tracks = [{ id: 't1', title: 'Song', artist: 'Singer', url: 'blob:node', duration: 100 }];
    h.S.curId = 't1';
    h.VM.hostGuest(guest, { title: 'Episode', artist: 'Show' });
    ok(h.S.audio.paused === true, 'W precondition: hosting pauses the Music element (exclusivity, Phase 2B.2)');
    h.S.audio.paused = false;                               // then Music takes playback back (what playId does)
    h.VM.unhostGuest();
    eq(h.owners(), ['guest', 'music'], 'W: teardown while Music plays claims Music');
    eq(h.errors, [], 'W: no listener threw during the ownership transitions');
  }

  /* ---- S: shared seek targets the active owner and rejects invalid duration ---- */
  {
    const h = boot();
    const music = h.audio({ paused: true, currentTime: 12, duration: 200 });
    const guest = h.audio({ paused: false, currentTime: 5, duration: 100 });
    h.S.audio = music;
    h.VM.hostGuest(guest, { title: 'Episode', artist: 'Show' });
    h.VM.enter();
    const seek = h.el('.vm-seek');
    ok(!!seek, 'S setup: the shared timeline is wired');

    /* A click is a pointerdown/pointerup at one point. */
    pointer(seek, 'pointerdown', 25);
    pointer(seek, 'pointerup', 25);
    eq(guest.currentTime, 25, 'S click: Podcast seeks to the clicked fraction');
    eq(music.currentTime, 12, 'S click: Podcast seek leaves Music untouched');

    /* Scrubbing works while paused and does not resume the Podcast. */
    guest.paused = true;
    pointer(seek, 'pointerdown', 30);
    pointer(seek, 'pointermove', 70);
    pointer(seek, 'pointerup', 70);
    eq(guest.currentTime, 70, 'S drag: Podcast seeks to the released fraction');
    ok(guest.paused, 'S drag: a paused Podcast stays paused');
    eq(music.currentTime, 12, 'S drag: Podcast drag leaves Music untouched');

    /* No metadata / live / zero-length duration cannot redirect to Music. */
    [NaN, Infinity, 0].forEach((duration, i) => {
      guest.duration = duration;
      guest.currentTime = 17 + i;
      pointer(seek, 'pointerdown', 90);
      pointer(seek, 'pointerup', 90);
      eq(guest.currentTime, 17 + i, 'S invalid duration ' + i + ': Podcast position is unchanged');
      eq(music.currentTime, 12, 'S invalid duration ' + i + ': Music position is unchanged');
    });

    /* A takeover during the drag cancels it rather than seeking either player. */
    guest.duration = 100;
    pointer(seek, 'pointerdown', 20);
    h.VM.unhostGuest();
    pointer(seek, 'pointermove', 80);
    pointer(seek, 'pointerup', 80);
    eq(guest.currentTime, 19, 'S takeover: old Podcast drag is not committed');
    eq(music.currentTime, 12, 'S takeover: ownership change cannot seek Music accidentally');

    /* Once the guest is gone, the same UI retains the original Music behavior. */
    music.duration = 100;
    pointer(seek, 'pointerdown', 40);
    pointer(seek, 'pointerup', 40);
    eq(music.currentTime, 40, 'S Music: shared seek still seeks Music');
    eq(guest.currentTime, 19, 'S Music: Music seek leaves the former Podcast untouched');
    eq(h.errors, [], 'S: shared seek scenarios throw no listener errors');
  }

  /* ---- N: enter() is guest-safe ---- */
  {
    const h = boot();
    const guest = h.audio({ paused: true });
    h.VM.hostGuest(guest, { title: 'Episode One', artist: 'Show One' });   // claim BEFORE the UI exists
    eq(h.S.built, false, 'N precondition: Music Mode was never entered');
    h.VM.enter();
    const mode = entry(h);
    ok(mode.open && mode.owner === 'guest', 'N: the entry broadcast carries the guest as the owner');
    eq(mode.wakes, 0, 'N: a guest-owned entry sends no Music wake (no zero-volume playback for the visualizer to react to)');
    eq(h.ms.binds, 0, 'N: a guest-owned entry never rebinds the MediaSession over the guest controls');
    eq(h.S.guestMeta, null, 'N: the deferred metadata is consumed, not kept stale');
    await new Promise(r => setTimeout(r, 300));        // setMeta writes the title 240 ms later (the cross-fade)
    const root = h.dom.byId['void-music-root'];
    ok(!!root && root.hidden === false, 'N: enter() built the chrome');
    eq(h.el('.vm-title') && h.el('.vm-title').textContent, 'Episode One',
      'N: the metadata the guest claimed before the build is flushed into the title');
    const row = h.el('.vm-title-row');
    const repeat = h.el('.vm-repeat');
    ok(!!repeat && !!row && row.contains(repeat), 'N: Music keeps its own Repeat control in the title row on a Podcast-initiated entry');
    eq(h.errors, [], 'N: enter() with a guest owner throws in no listener and in no frame');
  }
  {
    const h = boot();
    h.VM.enter();                                            // no guest at all
    const mode = entry(h);
    ok(mode.open && mode.owner === null, 'N: an unclaimed entry reports owner null');
    ok(mode.wakes > 0, 'N: a Music-only entry still wakes playback (Phase 2B behaviour preserved)');
    ok(h.ms.binds > 0, 'N: a Music-only entry binds the MediaSession controls');
    ok(!h.el('.vm-title') || h.el('.vm-title').textContent === '', 'N: with no guest nothing writes a title into the chrome');
  }

  /* ---- R: Music keeps its own repeat state through a Podcast cycle ----
     The Podcast speed chip borrows the Repeat SLOT, never the Repeat STATE: it is a
     sibling node the player inserts and hides the real button for. The engine holds the
     only reference to that button (els.repeat) and the only writer of S.repeat. */
  {
    const h = boot();
    h.VM.enter();
    await new Promise(r => setTimeout(r, 300));
    const repeat = h.el('.vm-repeat');
    ok(!!repeat, 'R: Music Mode builds its own Repeat control');
    const seen = [];
    for (let i = 0; i < 4; i++) { seen.push(h.S.repeat); repeat.click(); }
    eq(seen, [0, 1, 2, 3], 'R: the established Repeat cycle is 1 -> 2 -> 3 -> off');
    eq(h.S.repeat, 0, 'R: the fourth click lands back on off');
    const before = [repeat.getAttribute('aria-pressed'), h.el('.vm-repeat-n').textContent];
    const guest = h.audio({ paused: true });
    h.VM.hostGuest(guest, { title: 'Episode', artist: 'Show' });
    h.VM.unhostGuest();
    eq(h.S.repeat, 0, 'R: a full Podcast hosting cycle never changes Music\'s repeat count');
    ok(h.el('.vm-repeat') === repeat, 'R: the engine\'s Repeat node is still the one it built');
    eq([repeat.getAttribute('aria-pressed'), h.el('.vm-repeat-n').textContent], before,
      'R: and its pressed state and label come back untouched');
  }

  /* ---- V: the visualizer gate ----
     This is the state a Podcast start produced before Phase 2B.5: Music is still playing,
     the Podcast claims the session, and enter() broadcasts the open. section N proves that
     broadcast is exactly {open:true, owner:'guest'} when the guest claimed first. */
  {
    const h = boot({ viz: true });
    h.S.audio = h.audio({ paused: false });                  // Music audible at the moment of the entry
    h.S.open = true;
    const guest = h.audio({ paused: true });
    h.VM.hostGuest(guest, { title: 'Episode', artist: 'Show' });
    const music = h.S.audio;
    music.paused = false;                    // the race this phase closes: Music still audible when the open is broadcast
    const before = h.viz.debugState();
    ok(before.playing === false, 'V precondition: no cosmic session before the entry');
    h.fire('voidmusic:mode', { open: true, owner: 'guest' });
    const guestOwned = h.viz.debugState();
    ok(guestOwned.playing === false, 'V: a guest-owned Music Mode entry never starts the cosmic session');
    eq(guestOwned.aok, false, 'V: no analysis graph is built for Music while the Podcast owns the session');
    h.fire('voidmusic:mode', { open: true, owner: 'music' });
    ok(h.viz.debugState().playing === true, 'V: the same entry owned by Music still starts it');
    h.fire('voidmusic:mode', { open: true });
    ok(h.viz.debugState().playing === true, 'V: an entry payload without owner is treated as Music (only guest is suppressed)');
  }

  console.log('void-music-owner: ' + checks + ' assertions passed');
  if (checks === 0) { process.exit(1); }
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
