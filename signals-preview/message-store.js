/* ======================================================================
   Void Signals — message identity + lifetime + session read state.

   Responsibility (configuration architecture §7): this module owns ONLY
   (1) message identity, (2) message lifetime, (3) session-scoped read state.
   It knows nothing about placement, appearance or rendering.

   Policy implemented here (owner-approved):
   - a message is never consumed by being read;
   - it stays available until its server-defined expiration or an
     administrative removal;
   - read state is scoped to the current site session and lives in
     sessionStorage as message IDs only — never message content;
   - nothing is written to D1, R2 or any backend: this is a preview store,
     seeded from a local deterministic demo pool.
   ====================================================================== */
(function () {
  'use strict';
  if (window.VoidSignalsStore) return;

  var SESSION_KEY = 'void-sig-session-v1';
  var READ_KEY = 'void-sig-read-v1';
  var VERSION = 1;

  /* ---------------- session-scoped storage (never throws) ---------------- */
  function ss() {
    try {
      var s = window.sessionStorage;
      s.setItem('__void_probe__', '1'); s.removeItem('__void_probe__');
      return s;
    } catch (e) { return null; }
  }
  function store2(key, value) {
    var s = ss();
    if (!s) return;
    try { s.setItem(key, value); } catch (e) { /* quota or privacy mode: stay in memory */ }
  }
  function load(key) {
    var s = ss();
    if (!s) return null;
    try { return s.getItem(key); } catch (e) { return null; }
  }

  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  var sessionId = load(SESSION_KEY) || newId('site');
  store2(SESSION_KEY, sessionId);

  var readIds = {};
  try {
    var raw = load(READ_KEY);
    if (raw) {
      var arr = JSON.parse(raw);
      if (arr && arr.length) for (var i = 0; i < arr.length; i++) readIds[String(arr[i])] = true;
    }
  } catch (e) { readIds = {}; }

  function persistRead() {
    var ids = [];
    for (var k in readIds) if (Object.prototype.hasOwnProperty.call(readIds, k)) ids.push(k);
    store2(READ_KEY, JSON.stringify(ids));
  }

  /* ---------------- demo catalogue (local, deterministic IDs) ---------------- */
  var AMBIENT = [
    'A letter reached the void|Sample ambient event. Nothing was sent, stored or read from production.',
    'Someone is listening tonight|Simulated presence pulse from the local demo generator.',
    'The queue grew by one|Demo queue activity — the real queue is untouched.',
    'A quiet star joined the field|Local visual sample used to study entrance and fade timing.',
    'Night-side visitor|Simulated visit. No counter was incremented anywhere.',
    'Aurora Drift played through|Demo completion event for the local tone, not a production track.'
  ];
  var IMPORTANT = [
    'A letter is waiting for review|Simulated owner-facing event, kept in this preview session only.',
    'Owner action requested|Demo priority signal — distinguishable by silver core and gold ring.',
    'Playback reached the far side|Local sample of a higher-weight event, for placement study only.',
    'Two signals arrived together|Simulated burst used to test separation and collision handling.'
  ];
  function hash32(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return h;
  }

  /* ---------------- the store ---------------- */
  var entries = [];
  var byId = {};
  var subs = [];
  var seq = 0;

  function emit(reason) {
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](reason); } catch (e) { /* a listener must never break the store */ }
    }
  }

  function add(msg) {
    msg = msg || {};
    var id = String(msg.id || ('m-' + (++seq)));
    var existing = byId[id];
    if (existing) return existing;
    var entry = {
      id: id,
      type: msg.type === 'important' ? 'important' : 'ambient',
      title: String(msg.title || 'Untitled demo signal'),
      body: String(msg.body || ''),
      createdAt: msg.createdAt || Date.now(),
      /* server-defined lifetime: null means "until administrative removal" */
      expiresAt: typeof msg.expiresAt === 'number' ? msg.expiresAt : null,
      demo: msg.demo !== false,
      readInSession: !!readIds[id]
    };
    byId[id] = entry;
    entries.push(entry);
    emit('add');
    return entry;
  }

  /* deterministic demo message for a spawn index: stable identity across
     reloads inside the same site session, so read state survives refresh */
  function demoFor(type, seed, k) {
    var pool = type === 'important' ? IMPORTANT : AMBIENT;
    var pick = pool[(hash32('demo' + seed + ':' + k) >>> 0) % pool.length];
    var parts = pick.split('|');
    return {
      id: 'm-' + seed + '-' + type.charAt(0) + k,
      type: type,
      title: parts[0],
      body: parts[1] || ''
    };
  }

  function get(id) { return byId[String(id)] || null; }
  function all() { return entries.slice(); }
  function isExpired(entry, now) {
    return !!(entry && entry.expiresAt !== null && entry.expiresAt <= (now || Date.now()));
  }
  function live(now) {
    var out = [], i;
    for (i = 0; i < entries.length; i++) if (!isExpired(entries[i], now)) out.push(entries[i]);
    return out;
  }
  function remove(id) {
    id = String(id);
    var entry = byId[id];
    if (!entry) return false;
    var i;
    for (i = 0; i < entries.length; i++) if (entries[i].id === id) { entries.splice(i, 1); break; }
    delete byId[id];
    delete readIds[id];
    persistRead();
    emit('remove');
    return true;
  }

  function isRead(id) { return !!readIds[String(id)]; }
  function markRead(id) {
    id = String(id);
    if (!byId[id] || readIds[id]) return false;
    readIds[id] = true;
    byId[id].readInSession = true;
    persistRead();
    emit('read');
    return true;
  }
  /* demo/administrative aid only: replay the unread look inside this session */
  function setUnread(id) {
    id = String(id);
    if (!readIds[id]) return false;
    delete readIds[id];
    if (byId[id]) byId[id].readInSession = false;
    persistRead();
    emit('unread');
    return true;
  }
  function resetSession() {
    readIds = {};
    persistRead();
    sessionId = newId('site');
    store2(SESSION_KEY, sessionId);
    for (var i = 0; i < entries.length; i++) entries[i].readInSession = false;
    emit('session');
    return sessionId;
  }
  function subscribe(fn) {
    subs.push(fn);
    return function () {
      var i = subs.indexOf(fn);
      if (i >= 0) subs.splice(i, 1);
    };
  }
  function stats() {
    var read = 0, liveCount = live().length, i;
    for (i = 0; i < entries.length; i++) if (readIds[entries[i].id]) read++;
    return { session: sessionId, version: VERSION, total: entries.length, live: liveCount, read: read, unread: liveCount - read };
  }

  window.VoidSignalsStore = {
    version: VERSION,
    sessionId: function () { return sessionId; },
    demoFor: demoFor,
    add: add,
    get: get,
    all: all,
    live: live,
    isExpired: isExpired,
    remove: remove,
    isRead: isRead,
    markRead: markRead,
    setUnread: setUnread,
    resetSession: resetSession,
    subscribe: subscribe,
    stats: stats
  };
})();
