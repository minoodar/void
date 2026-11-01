/* Void — data layer for the "Message to God" Worker.
   Transport and request state only: no DOM access beyond sessionStorage.
   The panel and composer keep their existing UI; this file decides what is
   sent, which request_id is reused, and how a response is classified. */
(function (global) {
  'use strict';

  var BASE = 'https://void-galaxy-letters.minoodar.workers.dev';
  var PAGE_SIZE = 20;
  var TIMEOUT_MS = 15000;
  var PENDING_KEY = 'voidLetters.pending.v1';
  var EXPIRY_VALUES = { '24h': true, '7d': true, '30d': true, '90d': true };
  var UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var LETTER_ID_REGEX = /^[0-9a-f]{32}$/;
  var SHARE_FALLBACK = 'https://minoodar.github.io/void/';
  /* Share links follow the page's own directory so a repo rename does not
     leave tweet links pointing at the old GitHub Pages path. */
  function shareBase() {
    try {
      var loc = global.location;
      if (!loc || typeof loc.href !== 'string') return SHARE_FALLBACK;
      var url = new URL('./', loc.href);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch (e) {}
    return SHARE_FALLBACK;
  }
  var SHARE_BASE = shareBase();
  /* The Worker serves GET /letters/:id, so a shared link can be built from an
     id. Only ids that match the Worker's own format are ever turned into URLs. */
  var HAS_PUBLIC_LETTER_ROUTE = true;

  function storage() {
    try { return global.sessionStorage || null; } catch (e) { return null; }
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function countOf(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function newRequestId() {
    var c = global.crypto;
    if (c && typeof c.randomUUID === 'function') {
      var id = c.randomUUID();
      if (UUID_V4_REGEX.test(id)) return id;
    }
    var bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
    else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = '';
    for (var j = 0; j < 16; j++) hex += (bytes[j] + 256).toString(16).slice(1);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
      hex.slice(16, 20) + '-' + hex.slice(20);
  }

  /* One request = one attempt. Errors carry a small transport classification;
     POST failures remain ambiguous because the Worker may already have saved. */
  function request(url, options) {
    var init = {};
    if (options) for (var k in options) if (Object.prototype.hasOwnProperty.call(options, k)) init[k] = options[k];
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = 0;
    if (controller) {
      init.signal = controller.signal;
      timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, TIMEOUT_MS);
    }
    var started;
    var beganAt = Date.now();
    try {
      started = global.fetch(url, init);
    } catch (e) {
      clearTimeout(timer);
      return Promise.reject({ kind: 'network', duration_ms: Date.now() - beganAt, ambiguous: init.method === 'POST' });
    }
    return started.then(function (res) {
      return res.text().then(function (raw) {
        clearTimeout(timer);
        var data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
        return { status: res.status, data: data, duration_ms: Date.now() - beganAt, malformed: !!raw && data === null };
      }, function (err) {
        clearTimeout(timer);
        throw {
          kind: err && err.name === 'AbortError' ? 'timeout' : 'response',
          duration_ms: Date.now() - beganAt,
          ambiguous: init.method === 'POST'
        };
      });
    }, function (err) {
      clearTimeout(timer);
      var timedOut = !!(err && err.name === 'AbortError');
      throw { kind: timedOut ? 'timeout' : 'network', duration_ms: Date.now() - beganAt, ambiguous: init.method === 'POST' };
    });
  }

  var REASON_MAP = [
    [/request_id/i, 'request_id'],
    [/expiry/i, 'expiry'],
    [/too short/i, 'short'],
    [/500 codepoints/i, 'long'],
    [/link|domain|protocol/i, 'links'],
    [/Unicode|surrogate/i, 'unicode'],
    [/control|bidi/i, 'control'],
    [/JSON/i, 'body'],
    [/payload/i, 'body']
  ];

  function reasonOf(data) {
    var msg = data && typeof data.error === 'string' ? data.error : '';
    if (!msg || msg.length > 120) return null;
    for (var i = 0; i < REASON_MAP.length; i++) if (REASON_MAP[i][0].test(msg)) return REASON_MAP[i][1];
    return null;
  }

  function isDefinitive(kind) {
    return kind === 'created' || kind === 'recovered' || kind === 'already' ||
      kind === 'expired' || kind === 'invalid';
  }

  function classify(status, data) {
    var ok = !!(data && data.ok === true);
    if ((status === 201 || (status === 200 && data && data.recovered === true)) && ok && typeof data.id === 'string' && LETTER_ID_REGEX.test(data.id) &&
        num(data.created_at) > 0 && num(data.expires_at) > num(data.created_at)) {
      return {
        kind: status === 200 ? 'recovered' : 'created',
        id: data.id,
        created_at: num(data.created_at),
        expires_at: num(data.expires_at)
      };
    }
    if (status === 409 && data && data.error === 'already_submitted') {
      return { kind: 'already', next_allowed_at: num(data.next_allowed_at) };
    }
    if (status === 410 && data && data.error === 'expired') return { kind: 'expired' };
    if (status === 429) {
      var after = Number(data && data.retry_after);
      return { kind: 'rate', retry_after: isFinite(after) && after > 0 ? after : null };
    }
    if (status === 400) return { kind: 'invalid', reason: reasonOf(data) };
    if (status >= 500) return { kind: 'unavailable', status: status };
    return { kind: 'http', status: status };
  }

  function readPending() {
    var s = storage();
    if (!s) return { available: false, pending: null };
    try {
      var raw = s.getItem(PENDING_KEY);
      if (!raw) return { available: true, pending: null };
      var p = JSON.parse(raw);
      if (!p || typeof p.text !== 'string' || !EXPIRY_VALUES[p.expiry]) return { available: false, pending: null };
      if (typeof p.request_id !== 'string' || !UUID_V4_REGEX.test(p.request_id)) return { available: false, pending: null };
      return { available: true, pending: {
        request_id: p.request_id,
        text: p.text,
        expiry: p.expiry,
        lang: typeof p.lang === 'string' ? p.lang : null,
        state: typeof p.state === 'string' ? p.state : 'prepared'
      } };
    } catch (e) { return { available: false, pending: null }; }
  }

  function loadPending() {
    return readPending().pending;
  }

  function pendingStorageReady(pending) {
    var s = storage();
    if (!s) return false;
    try {
      var serialized = JSON.stringify(pending);
      s.setItem(PENDING_KEY, serialized);
      return s.getItem(PENDING_KEY) === serialized;
    } catch (e) { return false; }
  }

  function savePending(p) {
    var s = storage();
    if (!s) return;
    try { s.setItem(PENDING_KEY, JSON.stringify(p)); } catch (e) {}
  }

  function clearPending() {
    var s = storage();
    if (!s) return;
    try { s.removeItem(PENDING_KEY); } catch (e) {}
  }

  function setPendingState(pending, state) {
    savePending({
      request_id: pending.request_id,
      text: pending.text,
      expiry: pending.expiry,
      lang: pending.lang || null,
      state: state
    });
  }

  /* Reuses the stored UUID only for the exact same payload; any edit is a new
     letter and gets a new id. The record is written before the request starts
     so a reload in the same tab can still retry safely. */
  function begin(text, expiry, lang) {
    var normalizedLang = typeof lang === 'string' && lang ? lang : null;
    var read = readPending();
    if (!read.available) return { kind: 'storage_unavailable' };
    var stored = read.pending;
    if (stored && stored.text === text && stored.expiry === expiry && stored.lang === normalizedLang) return stored;
    if (stored && (stored.state === 'ambiguous' || stored.state === 'in_flight')) return { kind: 'unresolved_submission' };
    var pending = { request_id: newRequestId(), text: text, expiry: expiry, lang: normalizedLang, state: 'prepared' };
    if (!pendingStorageReady(pending)) return { kind: 'storage_unavailable' };
    return pending;
  }

  var inFlight = false;

  function submit(pending) {
    if (inFlight) return Promise.resolve({ kind: 'busy' });
    if (pending && pending.kind) return Promise.resolve({ kind: pending.kind });
    if (!pending || !UUID_V4_REGEX.test(pending.request_id || '') || !pendingStorageReady({
      request_id: pending.request_id, text: pending.text, expiry: pending.expiry,
      lang: pending.lang || null, state: 'in_flight'
    })) return Promise.resolve({ kind: 'storage_unavailable' });
    inFlight = true;
    setPendingState(pending, 'in_flight');
    var payload = { text: pending.text, expiry: pending.expiry, request_id: pending.request_id };
    if (pending.lang) payload.lang = pending.lang;
    return request(BASE + '/letters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      inFlight = false;
      var out = res.malformed && (res.status === 200 || res.status === 201)
        ? { kind: 'response', ambiguous: true }
        : classify(res.status, res.data);
      out.duration_ms = res.duration_ms;
      if ((res.status === 200 || res.status === 201) && !isDefinitive(out.kind)) {
        out = { kind: 'response', ambiguous: true, duration_ms: res.duration_ms };
      }
      if (res.status === 429 || res.status >= 500) out.ambiguous = true;
      if (out.kind === 'response') out.ambiguous = true;
      if (out.ambiguous) out.pending = pending;
      if (isDefinitive(out.kind)) clearPending();
      else setPendingState(pending, out.ambiguous ? 'ambiguous' : 'retryable');
      if (out.ambiguous) out.pending = loadPending() || pending;
      return out;
    }, function (err) {
      inFlight = false;
      setPendingState(pending, 'ambiguous');
      return {
        kind: err && err.kind || 'network',
        duration_ms: err && err.duration_ms || 0,
        ambiguous: true,
        pending: loadPending() || pending
      };
    });
  }

  /* Newest-first buffer. Pages append, ids are deduplicated, and taking a
     letter removes it so the reader never shows the same one twice. */
  function createFeed() {
    var items = [];
    var seen = {};
    var nextBefore = null;
    var hasMore = true;
    var loading = null;

    function appendPage(list) {
      for (var i = 0; i < list.length; i++) {
        var letter = list[i];
        if (!letter || typeof letter.id !== 'string' || typeof letter.body !== 'string') continue;
        if (seen[letter.id]) continue;
        seen[letter.id] = true;
        items.push({
          id: letter.id,
          lang: typeof letter.lang === 'string' ? letter.lang : null,
          text: letter.body,
          created_at: num(letter.created_at),
          expires_at: num(letter.expires_at),
          votes_like: countOf(letter.votes_like),
          votes_dislike: countOf(letter.votes_dislike)
        });
      }
    }

    function fetchPage() {
      var url = BASE + '/letters?limit=' + PAGE_SIZE +
        (nextBefore === null ? '' : '&before=' + encodeURIComponent(String(nextBefore)));
      loading = request(url, { method: 'GET' }).then(function (res) {
        loading = null;
        if (res.status !== 200 || !res.data || !Array.isArray(res.data.letters)) return { status: 'error' };
        appendPage(res.data.letters);
        var nb = res.data.next_before;
        if (nb === null || nb === undefined || !isFinite(Number(nb))) {
          nextBefore = null;
          hasMore = false;
        } else {
          nextBefore = Number(nb);
        }
        return { status: items.length ? 'ok' : 'empty' };
      }, function () {
        loading = null;
        return { status: 'error' };
      });
      return loading;
    }

    function next() {
      if (items.length) return Promise.resolve({ status: 'ok', letter: items.shift() });
      if (loading) {
        return loading.then(function (res) {
          if (items.length) return { status: 'ok', letter: items.shift() };
          return { status: res.status === 'error' ? 'error' : 'empty' };
        });
      }
      if (!hasMore) return Promise.resolve({ status: 'empty' });
      return fetchPage().then(function (res) {
        if (items.length) return { status: 'ok', letter: items.shift() };
        return { status: res.status === 'error' ? 'error' : 'empty' };
      });
    }

    function prefetch() {
      if (loading || !hasMore) return loading || Promise.resolve({ status: items.length ? 'ok' : 'empty' });
      return fetchPage();
    }

    return {
      next: next,
      prefetch: prefetch,
      size: function () { return items.length; },
      hasMore: function () { return hasMore; }
    };
  }

  function count() {
    return request(BASE + '/letters/count', { method: 'GET' }).then(function (res) {
      var n = res.status === 200 && res.data ? Number(res.data.active) : NaN;
      return isFinite(n) && n >= 0 ? n : null;
    }, function () { return null; });
  }

  /* Single letter behind a share link. An expired or unknown id is the same
     not_found, exactly like the Worker. Malformed ids never leave the browser. */
  function getLetter(id) {
    if (typeof id !== 'string' || !LETTER_ID_REGEX.test(id)) {
      return Promise.resolve({ status: 'not_found' });
    }
    return request(BASE + '/letters/' + id, { method: 'GET' }).then(function (res) {
      var raw = res.status === 200 && res.data ? res.data : null;
      if (raw && raw.id === id && typeof raw.text === 'string') {
        return {
          status: 'ok',
          letter: {
            id: raw.id,
            lang: typeof raw.lang === 'string' ? raw.lang : null,
            text: raw.text,
            created_at: num(raw.created_at),
            expires_at: num(raw.expires_at),
            votes_like: countOf(raw.votes_like),
            votes_dislike: countOf(raw.votes_dislike)
          }
        };
      }
      if (res.status === 404) return { status: 'not_found' };
      return { status: 'error' };
    }, function () {
      return { status: 'error' };
    });
  }

  function letterUrl(id) {
    if (!HAS_PUBLIC_LETTER_ROUTE) return null;
    if (typeof id !== 'string' || !LETTER_ID_REGEX.test(id)) return null;
    return SHARE_BASE + '?letter=' + id;
  }

  function voteState(d, id) {
    return {
      id: id,
      expires_at: num(d.expires_at),
      remaining_seconds: num(d.remaining_seconds),
      votes_like: countOf(d.votes_like),
      votes_dislike: countOf(d.votes_dislike)
    };
  }

  /* Vote state is owned by the Worker. PUT sets or changes it; DELETE retracts
     it. Malformed ids and unknown vote types never leave the browser. */
  function voteRequest(id, method, type) {
    if (typeof id !== 'string' || !LETTER_ID_REGEX.test(id) ||
        (method === 'PUT' && type !== 'like' && type !== 'dislike')) {
      return Promise.resolve({ status: 'invalid' });
    }
    var options = { method: method };
    if (method === 'PUT') {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ type: type });
    }
    return request(BASE + '/letters/' + id + '/vote', options).then(function (res) {
      var d = res.data;
      if (res.status === 200 && d && d.ok === true && d.id === id &&
          (d.type === 'like' || d.type === 'dislike' || d.type === null) &&
          typeof d.changed === 'boolean' && Number(d.expires_at) > 0 &&
          Number(d.votes_like) >= 0 && Number(d.votes_dislike) >= 0) {
        return {
          status: 'ok',
          type: d.type,
          changed: d.changed,
          letter: voteState(d, id),
          capped: d.capped === true
        };
      }
      if (res.status === 409 && d && d.error === 'already_voted') {
        return {
          status: 'already',
          type: d.type === 'dislike' ? 'dislike' : 'like',
          letter: voteState(d, id)
        };
      }
      if (res.status === 404) return { status: 'not_found' };
      if (res.status === 429) {
        var after = Number(d && d.retry_after);
        return { status: 'rate', retry_after: isFinite(after) && after > 0 ? after : null };
      }
      if (res.status === 400) return { status: 'invalid' };
      return { status: 'error', code: res.status };
    }, function () {
      return { status: 'network' };
    });
  }

  function vote(id, type) {
    return voteRequest(id, 'PUT', type);
  }

  function retractVote(id) {
    return voteRequest(id, 'DELETE', null);
  }

  /* Visitor counting rides the same Worker and database as the letters. A hit
     is fire-and-forget: the stats request is what fills the pill, so a blocked
     or failed write can never hide the numbers. `returning` is advisory; the
     Worker decides from its own hashed row. */
  function recordVisit(returning) {
    return request(BASE + '/visitors/hit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returning: !!returning })
    }).then(function (res) {
      return res.status === 200 && !!res.data && res.data.ok === true;
    }, function () { return false; });
  }

  /* Returns {u, t, r} — explorers, sessions, and returning share in 0..1 — or
     null when the service cannot answer. */
  function visitorStats() {
    return request(BASE + '/visitors/stats', { method: 'GET' }).then(function (res) {
      var d = res.status === 200 && res.data && res.data.ok === true ? res.data : null;
      if (!d) return null;
      var u = Number(d.unique_visitors);
      var t = Number(d.total_sessions);
      var r = Number(d.returning_ratio);
      if (!isFinite(u) || u < 0) return null;
      return {
        u: Math.floor(u),
        t: isFinite(t) && t >= 0 ? Math.floor(t) : 0,
        r: isFinite(r) && r >= 0 ? Math.min(1, r) : 0
      };
    }, function () { return null; });
  }

  global.VoidLettersApi = {
    base: BASE,
    pageSize: PAGE_SIZE,
    hasPublicLetterRoute: HAS_PUBLIC_LETTER_ROUTE,
    newRequestId: newRequestId,
    begin: begin,
    submit: submit,
    clearPending: clearPending,
    loadPending: loadPending,
    createFeed: createFeed,
    count: count,
    getLetter: getLetter,
    vote: vote,
    retractVote: retractVote,
    letterUrl: letterUrl,
    recordVisit: recordVisit,
    visitorStats: visitorStats
  };
})(typeof window !== 'undefined' ? window : globalThis);
