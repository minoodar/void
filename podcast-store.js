/* Void Podcast — Stage 3A store. Two localStorage keys:
     void.podcast.v1        subscriptions, show metadata, cached episode lists,
                            progress (capped/pruned), queue, last-opened times
     void.podcast.saved.v1  saved-episode snapshots — self-contained, independent
                            of subscriptions; never dropped by quota fallbacks
   Pure state helpers are exported for Node tests; every storage access is
   guarded. exportPayload() is the future Void Key shape (schemaVersion 1):
   one versioned JSON object, metadata only — audio files are never part of it.
   Loaded only from the flag-ON branch. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.VoidPodcastStore = factory(); }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var KEY = 'void.podcast.v1';
  var SAVED_KEY = 'void.podcast.saved.v1';
  var COMPLETE_FRACTION = 0.95;
  var PROGRESS_CAP = 500;
  var PROGRESS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  var EPISODE_CAP = 100;
  var DESC_CAP = 600;
  /* Stored-payload version. v1 = pre-2B payload (no v field, no rate, no
     resolvedFeedUrl). v2 adds those fields additively. The saved-episodes key
     is self-contained and unchanged, so it carries no version of its own.
     `volume` is additive on top of v2: parseState supplies its default for any
     payload that predates it, so no migration step (and no version bump) is
     needed — the same way a nullable setting is introduced. */
  var SCHEMA_VERSION = 2;
  var RATE_MIN = 0.25;
  var RATE_MAX = 4;
  /* Playback volume of the Podcast Audio Element only — Music keeps its own
     volume in void-music.js and the two never meet. Kept as a 0…1 number;
     unlike rate it is continuous, so it is clamped instead of snapped. */
  var VOLUME_DEFAULT = 1;

  function defaultState() {
    return { subscriptions: [], progress: {}, queue: [], shows: {}, episodes: {}, opened: {}, rate: 1, volume: VOLUME_DEFAULT };
  }

  function uniqueStrings(list) {
    var out = [], seen = {};
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (typeof v === 'string' && v && !seen[v]) { seen[v] = true; out.push(v); }
    }
    return out;
  }
  function str(v, cap) {
    var s = typeof v === 'string' ? v : '';
    if (cap && s.length > cap) { s = s.slice(0, cap - 1) + '…'; }
    return s;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function sanitizeSiteUrl(raw, feedUrl, resolvedFeedUrl) {
    if (typeof raw !== 'string') { return null; }
    var s = raw.trim();
    if (!s || s.length > 500) { return null; }
    try {
      var p = new URL(s);
      if ((p.protocol !== 'http:' && p.protocol !== 'https:') || p.username || p.password) { return null; }
      p.hash = '';
      var value = p.toString();
      if (value.length > 500) { return null; }
      function canonical(u) {
        try {
          var parsed = new URL(String(u || '').trim());
          parsed.hash = '';
          parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
          return parsed.toString();
        }
        catch (e) { return ''; }
      }
      if (canonical(value) === canonical(feedUrl) || canonical(value) === canonical(resolvedFeedUrl)) { return null; }
      return value;
    } catch (e) { return null; }
  }

  function sanitizeShow(id, s) {
    if (!isObj(s)) { return null; }
    return {
      id: id,
      title: str(s.title, 200),
      titleFa: str(s.titleFa, 200),
      publisher: str(s.publisher, 120),
      feedUrl: str(s.feedUrl, 2048),
      resolvedFeedUrl: str(s.resolvedFeedUrl, 2048),
      siteUrl: sanitizeSiteUrl(s.siteUrl, s.feedUrl, s.resolvedFeedUrl),
      artUrl: str(s.artUrl, 2048),
      initials: str(s.initials, 4),
      addedAt: num(s.addedAt),
      lastFetchedAt: num(s.lastFetchedAt),
      etag: str(s.etag, 200),
      lastModified: str(s.lastModified, 100)
    };
  }
  function sanitizeEpisode(showId, e) {
    if (!isObj(e) || typeof e.id !== 'string' || !e.id) { return null; }
    return {
      id: e.id,
      showId: showId,
      guid: str(e.guid, 500),
      title: str(e.title, 300),
      titleFa: str(e.titleFa, 300),
      publishedAt: str(e.publishedAt, 40),
      durationSec: Math.max(0, num(e.durationSec)),
      seasonNum: Math.max(0, Math.floor(num(e.seasonNum))),
      episodeNum: Math.max(0, Math.floor(num(e.episodeNum))),
      audioUrl: str(e.audioUrl, 2048),
      audioType: str(e.audioType, 100),
      description: str(e.description, DESC_CAP),
      artUrl: str(e.artUrl, 2048),
      chaptersUrl: str(e.chaptersUrl, 2048)
    };
  }
  function sanitizeSnapshot(s) {
    if (!isObj(s) || typeof s.id !== 'string' || !s.id || typeof s.audioUrl !== 'string' || !s.audioUrl) { return null; }
    return {
      id: s.id,
      guid: str(s.guid, 500),
      showId: str(s.showId, 100),
      title: str(s.title, 300),
      showTitle: str(s.showTitle, 200),
      showFeedUrl: str(s.showFeedUrl, 2048),
      audioUrl: str(s.audioUrl, 2048),
      audioType: str(s.audioType, 100),
      durationSec: Math.max(0, num(s.durationSec)),
      publishedAt: str(s.publishedAt, 40),
      artUrl: str(s.artUrl, 2048),
      description: str(s.description, DESC_CAP),
      savedAt: num(s.savedAt)
    };
  }

  /* Tolerant parser: anything empty, corrupt or partially wrong degrades to
     defaults / sanitized entries, never throws. Accepts a raw JSON string or an
     already-parsed object (the migration runner hands one over). */
  function parseState(raw) {
    var p = raw;
    if (typeof raw === 'string') {
      if (!raw) { return defaultState(); }
      try { p = JSON.parse(raw); } catch (e) { return defaultState(); }
    }
    if (!isObj(p)) { return defaultState(); }
    var subs = Array.isArray(p.subscriptions) ? uniqueStrings(p.subscriptions) : [];
    var progress = {};
    if (isObj(p.progress)) {
      Object.keys(p.progress).forEach(function (k) {
        var e = p.progress[k];
        if (!isObj(e) || e.episodeId !== k) { return; }
        var pos = num(e.positionSec);
        progress[k] = {
          episodeId: k,
          positionSec: pos < 0 ? 0 : pos,
          completed: e.completed === true,
          updatedAt: num(e.updatedAt)
        };
      });
    }
    var shows = {}, episodes = {}, opened = {};
    if (isObj(p.shows)) {
      Object.keys(p.shows).forEach(function (k) {
        var s = sanitizeShow(k, p.shows[k]);
        if (s) { shows[k] = s; }
      });
    }
    if (isObj(p.episodes)) {
      Object.keys(p.episodes).forEach(function (k) {
        if (!Array.isArray(p.episodes[k])) { return; }
        var list = [];
        p.episodes[k].forEach(function (e) {
          var ep = sanitizeEpisode(k, e);
          if (ep && list.length < EPISODE_CAP) { list.push(ep); }
        });
        episodes[k] = list;
      });
    }
    if (isObj(p.opened)) {
      Object.keys(p.opened).forEach(function (k) { opened[k] = num(p.opened[k]); });
    }
    return {
      subscriptions: subs, progress: progress,
      queue: Array.isArray(p.queue) ? uniqueStrings(p.queue) : [],
      shows: shows, episodes: episodes, opened: opened,
      rate: parseRate(p.rate), volume: parseVolume(p.volume)
    };
  }
  function parseSaved(raw) {
    if (typeof raw !== 'string' || !raw) { return { saved: [] }; }
    var p;
    try { p = JSON.parse(raw); } catch (e) { return { saved: [] }; }
    var list = Array.isArray(p) ? p : (isObj(p) && Array.isArray(p.saved) ? p.saved : []);
    var out = [], seen = {};
    list.forEach(function (s) {
      var snap = sanitizeSnapshot(s);
      if (snap && !seen[snap.id]) { seen[snap.id] = true; out.push(snap); }
    });
    return { saved: out };
  }

  function copyState(state) {
    var next = {
      subscriptions: state.subscriptions.slice(), progress: {},
      queue: (state.queue || []).slice(), shows: {}, episodes: {}, opened: {},
      rate: parseRate(state.rate), volume: parseVolume(state.volume)
    };
    Object.keys(state.progress).forEach(function (k) {
      var e = state.progress[k];
      next.progress[k] = { episodeId: e.episodeId, positionSec: e.positionSec, completed: e.completed, updatedAt: e.updatedAt };
    });
    Object.keys(state.shows || {}).forEach(function (k) {
      var s = state.shows[k], o = {};
      Object.keys(s).forEach(function (f) { o[f] = s[f]; });
      next.shows[k] = o;
    });
    Object.keys(state.episodes || {}).forEach(function (k) {
      next.episodes[k] = state.episodes[k].map(function (e) {
        var o = {}; Object.keys(e).forEach(function (f) { o[f] = e[f]; }); return o;
      });
    });
    Object.keys(state.opened || {}).forEach(function (k) { next.opened[k] = state.opened[k]; });
    return next;
  }

  /* Pure mutators — return a new state, never touch the input. */
  function parseRate(v) {
    var n = typeof v === 'number' && isFinite(v) ? v : NaN;
    if (!isFinite(n)) { return 1; }
    return n < RATE_MIN ? RATE_MIN : n > RATE_MAX ? RATE_MAX : n;
  }
  function withRate(state, r) {
    var next = copyState(state);
    next.rate = parseRate(r);
    return next;
  }
  /* Anything unusable degrades to the default, exactly like parseRate does. */
  function parseVolume(v) {
    var n = typeof v === 'number' && isFinite(v) ? v : NaN;
    if (!isFinite(n)) { return VOLUME_DEFAULT; }
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }
  function withVolume(state, v) {
    var next = copyState(state);
    next.volume = parseVolume(v);
    return next;
  }
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
  function withShow(state, show) {
    var next = copyState(state);
    if (show && typeof show.id === 'string' && show.id) {
      next.shows[show.id] = sanitizeShow(show.id, show);
    }
    return next;
  }
  /* Unsubscribe/remove: drops the show, its cached episodes, its queue ids and
     its opened marker. Progress and saved snapshots are NEVER touched here. */
  function withoutShow(state, showId) {
    var next = copyState(state);
    var gone = {};
    (next.episodes[showId] || []).forEach(function (e) { gone[e.id] = true; });
    delete next.shows[showId];
    delete next.episodes[showId];
    delete next.opened[showId];
    next.subscriptions = next.subscriptions.filter(function (id) { return id !== showId; });
    next.queue = next.queue.filter(function (id) { return !gone[id]; });
    return next;
  }
  function withEpisodes(state, showId, eps) {
    var next = copyState(state);
    var list = [];
    (Array.isArray(eps) ? eps : []).forEach(function (e) {
      var ep = sanitizeEpisode(showId, e);
      if (ep && list.length < EPISODE_CAP) { list.push(ep); }
    });
    next.episodes[showId] = list;
    return next;
  }
  function withOpened(state, showId, now) {
    var next = copyState(state);
    if (typeof showId === 'string' && showId) { next.opened[showId] = num(now); }
    return next;
  }
  function withFetchMeta(state, showId, meta) {
    var next = copyState(state);
    var s = next.shows[showId];
    if (s && isObj(meta)) {
      if (typeof meta.lastFetchedAt === 'number') { s.lastFetchedAt = meta.lastFetchedAt; }
      if (typeof meta.etag === 'string') { s.etag = meta.etag; }
      if (typeof meta.lastModified === 'string') { s.lastModified = meta.lastModified; }
    }
    return next;
  }
  function withSaved(savedState, snap) {
    var clean = sanitizeSnapshot(snap);
    var list = (savedState.saved || []).slice();
    if (!clean) { return { saved: list }; }
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === clean.id) { list[i] = clean; return { saved: list }; }
    }
    list.push(clean);
    return { saved: list };
  }
  function withoutSaved(savedState, id) {
    return { saved: (savedState.saved || []).filter(function (s) { return s.id !== id; }) };
  }
  /* Hygiene: keep saved ids and in-progress entries forever; drop anything
     older than ~90 days that is neither; then cap at the newest 500. */
  function pruneProgress(progress, savedIds, now) {
    var saved = {};
    (savedIds || []).forEach(function (id) { saved[id] = true; });
    var kept = [];
    Object.keys(progress).forEach(function (k) {
      var e = progress[k];
      var inProgress = e.positionSec > 0 && !e.completed;
      var fresh = now - e.updatedAt <= PROGRESS_MAX_AGE_MS;
      if (saved[k] || inProgress || fresh) { kept.push(e); }
    });
    kept.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    var out = {};
    kept.slice(0, PROGRESS_CAP).forEach(function (e) { out[e.episodeId] = e; });
    return out;
  }

  function listenedFraction(entry, durationSec) {
    if (!entry || !(durationSec > 0)) { return 0; }
    var f = entry.positionSec / durationSec;
    return f < 0 ? 0 : f > 1 ? 1 : f;
  }
  /* An entry is written the moment an episode starts, so existence = started. */
  function isUnlistened(entry) { return !entry; }

  function isQuotaError(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || '')));
  }

  /* ---- schema migration ----
     Pure, deterministic, idempotent: a v2 payload runs zero steps; a v1 payload
     runs 1→2 once. The write happens only after the migrated object is fully
     computed, so an interrupted run leaves the old payload untouched and the
     next boot simply migrates again. A payload written by a FUTURE version is
     passed through untouched (tolerant read, never downgraded). */
  var MIGRATIONS = {
    1: function (p) {
      /* v1 → v2: additive. resolvedFeedUrl arrives through sanitizeShow when a
         feed self-identifies; rate gets an explicit default here. */
      var next = isObj(p) ? p : defaultState();
      next.rate = parseRate(next.rate);
      return next;
    }
  };
  function migratePayload(p) {
    if (!isObj(p)) { return { state: defaultState(), from: 0, to: SCHEMA_VERSION, changed: false }; }
    var from = typeof p.v === 'number' && isFinite(p.v) && p.v >= 1 ? Math.floor(p.v) : 1;
    if (from > SCHEMA_VERSION) {
      return { state: p, from: from, to: from, future: true, changed: false };
    }
    var state = p, step = from;
    while (step < SCHEMA_VERSION) {
      var run = MIGRATIONS[step];
      state = run ? run(state) : state;
      step++;
    }
    state.v = SCHEMA_VERSION;            // the returned payload is exactly what
                                         // would be persisted, so re-running
                                         // migratePayload on it is a no-op
    return { state: state, from: from, to: SCHEMA_VERSION, changed: step !== from };
  }

  /* Storage adapter is injectable for tests; defaults to window.localStorage. */
  function create(storage) {
    var st = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    var listeners = [];

    function read(k) { try { return st ? st.getItem(k) : null; } catch (e) { return null; } }
    function readObj(k) {
      var raw = read(k);
      if (typeof raw !== 'string' || !raw) { return null; }
      try { return JSON.parse(raw); } catch (e) { return null; }
    }
    function emit() {
      listeners.slice().forEach(function (fn) { try { fn(state); } catch (e) { /* one bad listener never breaks the rest */ } });
    }
    function loadMain() {
      var parsed = readObj(KEY);
      if (parsed === null) { return defaultState(); }
      return parseState(migratePayload(parsed).state);
    }

    var savedState = parseSaved(read(SAVED_KEY));
    var state = loadMain();
    state.progress = pruneProgress(state.progress, savedState.saved.map(function (s) { return s.id; }), Date.now());

    /* Quota fallback order: cached episode lists go first; saved snapshots
       (separate key) are never dropped. Still failing → stay in memory. */
    function persistMain() {
      if (!st) { return; }
      var payload = copyState(state);
      payload.v = SCHEMA_VERSION;          // written on every persist, so a
                                           // crashed migration self-heals on
                                           // the next boot
      try { st.setItem(KEY, JSON.stringify(payload)); return; } catch (e) {
        if (!isQuotaError(e)) { return; }
      }
      payload.episodes = {};
      try { st.setItem(KEY, JSON.stringify(payload)); } catch (e2) { /* memory only */ }
    }
    function persistSaved() {
      if (!st) { return; }
      try { st.setItem(SAVED_KEY, JSON.stringify(savedState)); return; } catch (e) {
        if (!isQuotaError(e)) { return; }
      }
      var smaller = { saved: savedState.saved.map(function (s) {
        var o = {}; Object.keys(s).forEach(function (f) { o[f] = s[f]; });
        o.description = str(s.description, 300);
        return o;
      }) };
      try { st.setItem(SAVED_KEY, JSON.stringify(smaller)); } catch (e2) { /* memory only */ }
    }
    function savedIds() { return savedState.saved.map(function (s) { return s.id; }); }

    return {
      key: KEY,
      savedKey: SAVED_KEY,
      getState: function () { return state; },
      hasPersisted: function () { return read(KEY) !== null; },
      isSubscribed: function (showId) { return state.subscriptions.indexOf(showId) >= 0; },
      subscribe: function (showId) { state = withSubscription(state, showId, true); persistMain(); emit(); return state; },
      unsubscribe: function (showId) { state = withoutShow(state, showId); persistMain(); emit(); return state; },
      getProgress: function (episodeId) { return state.progress[episodeId] || null; },
      setProgress: function (episodeId, positionSec, durationSec, ended) {
        state = withProgress(state, episodeId, positionSec, durationSec, Date.now(), ended);
        state.progress = pruneProgress(state.progress, savedIds(), Date.now());
        persistMain(); emit();
        return state.progress[episodeId];
      },
      getQueue: function () { return state.queue.slice(); },
      setQueue: function (ids) { state = withQueue(state, ids); persistMain(); emit(); return state.queue.slice(); },
      getRate: function () { return parseRate(state.rate); },
      setRate: function (r) { state = withRate(state, r); persistMain(); emit(); return state.rate; },
      getVolume: function () { return parseVolume(state.volume); },
      setVolume: function (v) { state = withVolume(state, v); persistMain(); emit(); return state.volume; },
      getShow: function (showId) { return state.shows[showId] || null; },
      getEpisodes: function (showId) { return (state.episodes[showId] || []).slice(); },
      registerShow: function (show, eps) {
        state = withEpisodes(withShow(state, show), show && show.id, eps);
        persistMain(); emit();
        return state;
      },
      setEpisodes: function (showId, eps) { state = withEpisodes(state, showId, eps); persistMain(); emit(); return state; },
      markOpened: function (showId) { state = withOpened(state, showId, Date.now()); persistMain(); emit(); return state; },
      setFetchMeta: function (showId, meta) { state = withFetchMeta(state, showId, meta); persistMain(); emit(); return state; },
      getSaved: function () { return savedState.saved.slice(); },
      isSaved: function (episodeId) {
        for (var i = 0; i < savedState.saved.length; i++) { if (savedState.saved[i].id === episodeId) { return true; } }
        return false;
      },
      saveEpisode: function (snap) {
        savedState = withSaved(savedState, snap);
        persistSaved(); emit();
        return savedState.saved.slice();
      },
      removeSaved: function (episodeId) { savedState = withoutSaved(savedState, episodeId); persistSaved(); emit(); return savedState.saved.slice(); },
      /* Future Void Key payload (Stage 3C): one versioned JSON object.
         Metadata only — audio files are never part of it. schemaVersion is the
         export contract, independent of the local SCHEMA_VERSION. */
      exportPayload: function () {
        return {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          subscriptions: state.subscriptions.slice(),
          shows: JSON.parse(JSON.stringify(state.shows)),
          episodes: JSON.parse(JSON.stringify(state.episodes)),
          opened: JSON.parse(JSON.stringify(state.opened)),
          queue: state.queue.slice(),
          progress: JSON.parse(JSON.stringify(state.progress)),
          saved: savedState.saved.slice(),
          rate: parseRate(state.rate)
        };
      },
      onChange: function (fn) {
        listeners.push(fn);
        return function () { var i = listeners.indexOf(fn); if (i >= 0) { listeners.splice(i, 1); } };
      },
      reload: function () {
        savedState = parseSaved(read(SAVED_KEY));
        state = loadMain();
        state.progress = pruneProgress(state.progress, savedIds(), Date.now());
        emit();
        return state;
      }
    };
  }

  return {
    KEY: KEY,
    SAVED_KEY: SAVED_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    COMPLETE_FRACTION: COMPLETE_FRACTION,
    PROGRESS_CAP: PROGRESS_CAP,
    PROGRESS_MAX_AGE_MS: PROGRESS_MAX_AGE_MS,
    EPISODE_CAP: EPISODE_CAP,
    DESC_CAP: DESC_CAP,
    VOLUME_DEFAULT: VOLUME_DEFAULT,
    create: create,
    defaultState: defaultState,
    parseState: parseState,
    parseSaved: parseSaved,
    parseRate: parseRate,
    parseVolume: parseVolume,
    migratePayload: migratePayload,
    withSubscription: withSubscription,
    withProgress: withProgress,
    withQueue: withQueue,
    withRate: withRate,
    withVolume: withVolume,
    withShow: withShow,
    withoutShow: withoutShow,
    withEpisodes: withEpisodes,
    withOpened: withOpened,
    withFetchMeta: withFetchMeta,
    withSaved: withSaved,
    withoutSaved: withoutSaved,
    pruneProgress: pruneProgress,
    listenedFraction: listenedFraction,
    isUnlistened: isUnlistened
  };
});
