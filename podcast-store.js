/* Void Podcast — Stage 2B store. Subscriptions, listening progress and the
   episode queue (ids only) under one localStorage namespace (void.podcast.v1).
   Pure state helpers are exported for Node tests; every storage access is
   guarded. Loaded only from the flag-ON branch. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.VoidPodcastStore = factory(); }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var KEY = 'void.podcast.v1';
  var COMPLETE_FRACTION = 0.95;

  function defaultState() { return { subscriptions: [], progress: {}, queue: [] }; }

  function uniqueStrings(list) {
    var out = [], seen = {};
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (typeof v === 'string' && v && !seen[v]) { seen[v] = true; out.push(v); }
    }
    return out;
  }

  /* Tolerant parser: anything empty, corrupt or partially wrong degrades to
     defaults / sanitized entries, never throws. */
  function parseState(raw) {
    if (typeof raw !== 'string' || !raw) { return defaultState(); }
    var p;
    try { p = JSON.parse(raw); } catch (e) { return defaultState(); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) { return defaultState(); }
    var subs = Array.isArray(p.subscriptions) ? uniqueStrings(p.subscriptions) : [];
    var progress = {};
    if (p.progress && typeof p.progress === 'object' && !Array.isArray(p.progress)) {
      Object.keys(p.progress).forEach(function (k) {
        var e = p.progress[k];
        if (!e || typeof e !== 'object' || e.episodeId !== k) { return; }
        var pos = typeof e.positionSec === 'number' && isFinite(e.positionSec) && e.positionSec >= 0 ? e.positionSec : 0;
        progress[k] = {
          episodeId: k,
          positionSec: pos,
          completed: e.completed === true,
          updatedAt: typeof e.updatedAt === 'number' && isFinite(e.updatedAt) ? e.updatedAt : 0
        };
      });
    }
    return { subscriptions: subs, progress: progress, queue: Array.isArray(p.queue) ? uniqueStrings(p.queue) : [] };
  }

  function copyState(state) {
    var next = { subscriptions: state.subscriptions.slice(), progress: {}, queue: (state.queue || []).slice() };
    Object.keys(state.progress).forEach(function (k) {
      var e = state.progress[k];
      next.progress[k] = { episodeId: e.episodeId, positionSec: e.positionSec, completed: e.completed, updatedAt: e.updatedAt };
    });
    return next;
  }

  /* Pure mutators — return a new state, never touch the input. */
  function withSubscription(state, showId, on) {
    var next = copyState(state);
    var i = next.subscriptions.indexOf(showId);
    if (on && typeof showId === 'string' && showId && i < 0) { next.subscriptions.push(showId); }
    if (!on && i >= 0) { next.subscriptions.splice(i, 1); }
    return next;
  }
  function withProgress(state, episodeId, positionSec, durationSec, now, ended) {
    var next = copyState(state);
    var pos = typeof positionSec === 'number' && isFinite(positionSec) ? positionSec : 0;
    if (pos < 0) { pos = 0; }
    if (durationSec > 0 && pos > durationSec) { pos = durationSec; }
    next.progress[episodeId] = {
      episodeId: episodeId,
      positionSec: pos,
      completed: ended === true || (durationSec > 0 && pos >= durationSec * COMPLETE_FRACTION),
      updatedAt: typeof now === 'number' && isFinite(now) ? now : 0
    };
    return next;
  }
  function withQueue(state, ids) {
    var next = copyState(state);
    next.queue = uniqueStrings(Array.isArray(ids) ? ids : []);
    return next;
  }

  function listenedFraction(entry, durationSec) {
    if (!entry || !(durationSec > 0)) { return 0; }
    var f = entry.positionSec / durationSec;
    return f < 0 ? 0 : f > 1 ? 1 : f;
  }
  /* An entry is written the moment an episode starts, so existence = started. */
  function isUnlistened(entry) { return !entry; }

  /* Storage adapter is injectable for tests; defaults to window.localStorage. */
  function create(storage) {
    var st = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    var listeners = [];

    function read() { try { return st ? st.getItem(KEY) : null; } catch (e) { return null; } }
    function load() { return parseState(read()); }
    function persist() { try { if (st) { st.setItem(KEY, JSON.stringify(state)); } } catch (e) { /* quota / privacy mode: stay in memory */ } }
    function emit() {
      listeners.slice().forEach(function (fn) { try { fn(state); } catch (e) { /* one bad listener never breaks the rest */ } });
    }

    var state = load();

    return {
      key: KEY,
      getState: function () { return state; },
      hasPersisted: function () { return read() !== null; },
      isSubscribed: function (showId) { return state.subscriptions.indexOf(showId) >= 0; },
      subscribe: function (showId) { state = withSubscription(state, showId, true); persist(); emit(); return state; },
      unsubscribe: function (showId) { state = withSubscription(state, showId, false); persist(); emit(); return state; },
      getProgress: function (episodeId) { return state.progress[episodeId] || null; },
      setProgress: function (episodeId, positionSec, durationSec, ended) {
        state = withProgress(state, episodeId, positionSec, durationSec, Date.now(), ended);
        persist(); emit();
        return state.progress[episodeId];
      },
      getQueue: function () { return state.queue.slice(); },
      setQueue: function (ids) { state = withQueue(state, ids); persist(); emit(); return state.queue.slice(); },
      onChange: function (fn) {
        listeners.push(fn);
        return function () { var i = listeners.indexOf(fn); if (i >= 0) { listeners.splice(i, 1); } };
      },
      reload: function () { state = load(); emit(); return state; }
    };
  }

  return {
    KEY: KEY,
    COMPLETE_FRACTION: COMPLETE_FRACTION,
    create: create,
    defaultState: defaultState,
    parseState: parseState,
    withSubscription: withSubscription,
    withProgress: withProgress,
    withQueue: withQueue,
    listenedFraction: listenedFraction,
    isUnlistened: isUnlistened
  };
});