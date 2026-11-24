/* Podcast Galaxy Publishing — Phase 1 UI preview: mock data + adapter boundary.
 *
 * LOCAL PREVIEW ONLY. Nothing here talks to a network, a Worker or a database.
 * This module is the single seam between the preview UI and the future
 * publication API: the UI only ever calls the promise-returning methods below,
 * so replacing this factory with an HTTP adapter is a one-line change in
 * podcast-publish-loader.js. The method names and result shapes mirror the
 * Phase 1 record (see ADR-DRAFT-podcast-galaxy-publishing.md in the spike):
 *   list()   -> the ambient catalogue, never carries a feed address
 *   get()    -> publication detail, the only read that carries feed + GUID
 *   publish() / report() / revoke()
 *   save()/follow() and their local reads
 *
 * Deliberately absent, and why:
 *   - No hashing, HMAC or digest of any identity. That is server-side work and
 *     unfinished; a frontend that fakes it would be misleading. Keys here are
 *     plain object keys.
 *   - No quota numbers, no report threshold, no rate limits. They are pending
 *     owner approval; `__preview.moderate()` simulates the visible consequence
 *     instead of inventing the rule.
 *   - No audio URL on any publication. Audio resolves through the existing
 *     client-side feed path; the preview never plays sound (see the UI module).
 *
 * Status model is the approved five-state one ('active', 'expired', 'revoked',
 * 'hidden', 'removed'), but every non-viewable status collapses to one
 * indistinguishable 'gone' answer, so the preview cannot become an oracle.
 *
 * Chromium-70 / TV safe: ES5 syntax only, like the other podcast modules.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.VoidPodcastPublishMock = factory(); }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* Chromium 70 has no globalThis, so window is tried first and globalThis is
     only reached behind a typeof guard. The node test path lands on globalThis. */
  var G = (typeof window !== 'undefined' && window) ? window
    : ((typeof globalThis !== 'undefined' && globalThis) ? globalThis : {});

  var DAY_MS = 86400000;
  var LIFETIME_MS = 7 * DAY_MS;         /* approved seven-day publication lifetime */
  var NOTE_CAP = 280;                   /* mirrors the probe schema's CHECK on description */
  var SAVE_CAP = 100;                   /* approved default: reject at capacity, never evict */

  /* ---- fixtures: fictional shows on reserved example domains ----
     The domains are RFC 2606 reservations, so a preview can never be mistaken
     for a real feed, and no artwork URL can resolve to somebody's content. */
  var SHOWS = [
    { id: 'nf', title: 'Night Frequencies', titleFa: 'فرکانس‌های شب', publisher: 'Void Press',
      initials: 'NF', feedUrl: 'https://feeds.example.org/night-frequencies/rss.xml' },
    { id: 'so', title: 'Slow Orbit', titleFa: 'مد آهنگ', publisher: 'Ardeshir Studio',
      initials: 'SO', feedUrl: 'https://feeds.example.org/slow-orbit/rss.xml' },
    { id: 'pl', title: 'Paper Lanterns', titleFa: 'فانوس کاغذی', publisher: 'Kaman Collective',
      initials: 'PL', feedUrl: 'https://feeds.example.org/paper-lanterns/rss.xml' },
    { id: 'ld', title: 'Long Drift', titleFa: 'رانش بلند', publisher: 'Void Press',
      initials: 'LD', feedUrl: 'https://feeds.example.org/long-drift/rss.xml' }
  ];

  function ep(id, showId, title, titleFa, agoDays, durationSec, description, hasAudio) {
    var sh = null, i;
    for (i = 0; i < SHOWS.length; i++) { if (SHOWS[i].id === showId) { sh = SHOWS[i]; } }
    return {
      id: id, showId: showId, guid: 'guid-' + id,
      title: title, titleFa: titleFa,
      agoDays: agoDays, durationSec: durationSec, description: description,
      /* One fixture carries an enclosure so the "open the real episode" path can
         be demonstrated honestly; the rest have none and say so. */
      audioUrl: hasAudio ? 'https://media.example.org/' + id + '.mp3' : '',
      artUrl: '', show: sh
    };
  }

  var EPISODES = [
    ep('nf-01', 'nf', 'Tape hiss at dawn', 'هس نوار در سپیده‌دم', 3, 1435,
      'Field recordings assembled from one night of shortwave.', false),
    ep('nf-04', 'nf', 'Signal at three in the morning', 'سیگنال در سه‌بعدازنیم‌شب', 8, 2400,
      'A carrier that appears only after midnight, and the people who listen for it.', true),
    ep('nf-05', 'nf', 'The quiet band', 'باند خاموش', 15, 1810,
      'Why the empty part of the spectrum is the busiest.', false),
    ep('so-02', 'so', 'A perigee for thinking', 'مدی برای اندیشیدن', 2, 1660,
      'Slow radio about orbits, patience and the colour of the moon at perigee.', false),
    ep('so-07', 'so', 'Notes on silence', 'یادداشت‌هایی درباره سکوت', 40, 980,
      'Six short pieces recorded in an empty building.', false),
    ep('pl-03', 'pl', 'Lanterns for the ones who left', 'فانوسی برای رفتگان', 1, 1245,
      'Readers send in the small rituals they keep.', false),
    ep('pl-06', 'pl', 'Paper weather', 'هوای کاغذی', 6, 1500,
      'Paper, moisture and the smell of a library at closing time.', false),
    ep('ld-02', 'ld', 'Drift, then arrive', 'رانش، سپس رسیدن', 12, 2130,
      'Long-form interview with a ferry radio operator.', false),
    ep('ld-09', 'ld', 'Cleared frequency', 'فرکانس آزادشده', 26, 1105,
      'A station that stopped broadcasting and what it left behind.', false)
  ];

  /* Seeded publications, expressed as ages so expiry behaves the same on any
     machine: 'agoDays' is measured against the injected now(). */
  var SEED = [
    { id: 'vgnf04', kind: 'episode', target: 'nf-04', agoDays: 2, note: 'The best twenty minutes of radio I have heard this year.' },
    { id: 'vgso02', kind: 'episode', target: 'so-02', agoDays: 6.8, note: 'For anyone who works late. Ends quietly.' },
    { id: 'vgpl03', kind: 'show', target: 'pl', agoDays: 0.5, note: 'The whole show. Short episodes, good for one walk.' },
    { id: 'vgld02', kind: 'episode', target: 'ld-02', agoDays: 9, note: 'Left published a while ago.' },
    { id: 'vgld09', kind: 'episode', target: 'ld-09', agoDays: 4, note: 'Reported and hidden by moderation.', status: 'hidden' },
    { id: 'vgpl06', kind: 'episode', target: 'pl-06', agoDays: 5, note: 'Removed by its publisher.', status: 'removed' }
  ];

  /* ---- small helpers ---- */
  function findShow(id) {
    for (var i = 0; i < SHOWS.length; i++) { if (SHOWS[i].id === id) { return SHOWS[i]; } }
    return null;
  }
  function findEpisode(id) {
    for (var i = 0; i < EPISODES.length; i++) { if (EPISODES[i].id === id) { return EPISODES[i]; } }
    return null;
  }
  function showOf(episode) { return episode ? findShow(episode.showId) : null; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v, cap) {
    var s = typeof v === 'string' ? v : '';
    return cap && s.length > cap ? s.slice(0, cap - 1) + '…' : s;
  }
  function base64url(bytes) {
    var map = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    var out = '', i;
    for (i = 0; i < bytes.length; i += 3) {
      var n0 = bytes[i], n1 = bytes[i + 1], n2 = bytes[i + 2];
      out += map[n0 >> 2];
      out += map[((n0 & 3) << 4) | ((n1 || 0) >> 4)];
      if (i + 1 < bytes.length) { out += map[((n1 & 15) << 2) | ((n2 || 0) >> 6)]; }
      if (i + 2 < bytes.length) { out += map[n2 & 63]; }
    }
    return out;
  }
  /* 32 random bytes, 43 base64url characters — the approved capability shape.
     crypto.getRandomValues where present; a plain Math.random path exists only
     so the module loads under `node --test`, which has no window crypto. */
  function makeCapability() {
    var c = G.crypto || null;
    if (c && typeof c.getRandomValues === 'function') {
      var b = new Uint8Array(32);
      c.getRandomValues(b);
      return base64url(b);
    }
    var alt = '', k;
    for (k = 0; k < 43; k++) { alt += base64url.charAt(Math.floor(Math.random() * 64)); }
    return alt;
  }
  function newId(seq) { return 'vgp-' + seq.toString(36) + '-' + Math.floor(Math.random() * 46656).toString(36); }

  /* FNV-1a over a string, same 32-bit construction the live store uses for its
     feed and episode ids, so a preview id looks like the real thing. Used only
     to name a show the user published from their own subscription. */
  function fnv1a(s) {
    var h = 2166136261, i;
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return h.toString(36);
  }
  function initialsOf(title) {
    var words = title.replace(/[^A-Za-zА-Яа-яЁё '\-]+/g, ' ').split(' '), out = '', i;
    for (i = 0; i < words.length && out.length < 2; i++) {
      if (words[i]) { out += words[i].charAt(0).toUpperCase(); }
    }
    return out || 'VG';
  }

  /* ---- visibility predicate, evaluated at read time. Correctness never
     depends on a cleanup job: an expired row is simply not active. ---- */
  function statusAt(rec, t) {
    if (!rec) { return 'unknown'; }
    if (rec.status === 'active' && t >= rec.expiresAt) { return 'expired'; }
    return rec.status;
  }


  /* A publication's local identity key: plain text, no digest, no security
     claim. In production the server derives this; the client never sees it. */
  function targetKey(rec) {
    return rec.kind === 'show' ? 'show|' + rec.feedUrl : 'episode|' + rec.feedUrl + '|' + rec.guid;
  }

  function publicView(rec) {
    return {
      id: rec.id, kind: rec.kind, status: rec.status,
      showId: rec.showId, showTitle: rec.showTitle, showTitleFa: rec.showTitleFa,
      publisher: rec.publisher, initials: rec.initials, artUrl: rec.artUrl,
      episodeId: rec.episodeId, episodeTitle: rec.episodeTitle, episodeTitleFa: rec.episodeTitleFa,
      description: rec.description, note: rec.note,
      createdAt: rec.createdAt, expiresAt: rec.expiresAt, durationSec: rec.durationSec,
      external: !!rec.external
      /* feedUrl and guid are intentionally NOT here: the ambient payload must
         never carry the feed address. */
    };
  }

  function createApi(opts) {
    opts = opts || {};
    var now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
    var store = opts.storage || null;            /* { getItem, setItem } or null for memory */
    var latency = typeof opts.latency === 'number' ? opts.latency : 110;
    var persistKey = opts.persistKey || 'void.publishPreview.v1';
    var listeners = [];
    var seq = 0;

    var local = { saves: [], follows: [], mine: [] };
    var records = {};      /* id -> record */
    var capIndex = {};     /* capability -> id */
    var keyIndex = {};     /* targetKey -> [id] */
    var extraShows = {};   /* showId -> record, for shows published from a real subscription */

    function memoryStorage() {
      var m = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
        setItem: function (k, v) { m[k] = String(v); }
      };
    }
    var bag = store || memoryStorage();

    /* ---- persistence: isolated preview key, tolerant parse, never touches
       void.podcast.v1 or void.podcast.saved.v1 ---- */
    function load() {
      var raw = null;
      try { raw = bag.getItem(persistKey); } catch (e) { raw = null; }
      var p = null;
      if (typeof raw === 'string' && raw) { try { p = JSON.parse(raw); } catch (err) { p = null; } }
      if (!isObj(p)) { return; }
      var i, rec;
      if (Array.isArray(p.mine)) {
        for (i = 0; i < p.mine.length; i++) {
          rec = p.mine[i];
          if (!isObj(rec) || typeof rec.id !== 'string' || !rec.id) { continue; }
          addRecord(rec, rec.capability || '');
          /* Reloaded rows are this device's own publications: they belong in
             the owner list as well as in the record map. */
          local.mine.push(rec.id);
          if (rec.external) { rememberShow(rec); }
        }
      }
      if (Array.isArray(p.saves)) {
        for (i = 0; i < p.saves.length; i++) {
          if (typeof p.saves[i] === 'string' && p.saves[i]) { local.saves.push(p.saves[i]); }
        }
      }
      if (Array.isArray(p.follows)) {
        for (i = 0; i < p.follows.length; i++) {
          if (typeof p.follows[i] === 'string' && p.follows[i]) { local.follows.push(p.follows[i]); }
        }
      }
    }
    function save() {
      var mine = [], i;
      for (i = 0; i < local.mine.length; i++) {
        var r = records[local.mine[i]];
        if (r) { mine.push(r); }
      }
      try {
        bag.setItem(persistKey, JSON.stringify({ v: 1, saves: local.saves, follows: local.follows, mine: mine }));
      } catch (e) { /* storage full or blocked: the preview keeps working in memory */ }
    }

    function addRecord(rec, capability) {
      records[rec.id] = rec;
      if (capability) { capIndex[capability] = rec.id; }
      var k = targetKey(rec);
      if (!keyIndex[k]) { keyIndex[k] = []; }
      if (keyIndex[k].indexOf(rec.id) < 0) { keyIndex[k].push(rec.id); }
    }

    function buildFromTarget(o) {
      var kind = o.kind === 'show' ? 'show' : 'episode';
      if (isObj(o.target)) { return buildFromExternal(o, kind); }
      var sh, e;
      if (kind === 'show') {
        sh = findShow(o.target);
        if (!sh) { return null; }
        e = null;
      } else {
        e = findEpisode(o.target);
        if (!e) { return null; }
        sh = showOf(e);
      }
      var created = o.createdAt;
      return {
        id: o.id, kind: kind, status: o.status || 'active',
        showId: sh.id, showTitle: sh.title, showTitleFa: sh.titleFa,
        publisher: sh.publisher, initials: sh.initials, artUrl: sh.artUrl,
        episodeId: e ? e.id : '', episodeTitle: e ? e.title : '', episodeTitleFa: e ? e.titleFa : '',
        description: e ? e.description : '', durationSec: e ? e.durationSec : 0,
        note: str(o.note, NOTE_CAP),
        feedUrl: sh.feedUrl, guid: e ? e.guid : '',
        createdAt: created, expiresAt: created + LIFETIME_MS,
        capability: o.capability || ''
      };
    }

    /* A show the device published from its own subscription is not in the
       fixture catalogue, so its identity is kept beside the publication. A
       show-level row describes the show; an episode-level row only borrows the
       title for the container, so the better description is never overwritten. */
    function rememberShow(rec) {
      if (findShow(rec.showId)) { return; }
      var known = extraShows[rec.showId];
      if (!known || (known.kind === 'episode' && rec.kind === 'show')) { extraShows[rec.showId] = rec; }
    }

    /* A target handed over by the podcast window: the show or episode the user
       is looking at in their own subscription. Flat and descriptive, because a
       real publish request carries exactly these identity fields. The audio URL
       is dropped on purpose — a publication stores none, and the preview never
       plays anything. */
    function buildFromExternal(o, kind) {
      var t = o.target;
      var feedUrl = str(t.feedUrl, 2048);
      if (!feedUrl) { return null; }
      var guid = kind === 'episode' ? str(t.guid, 500) : '';
      if (kind === 'episode' && !guid) { return null; }
      var showTitle = str(t.showTitle, 200) || str(t.title, 200) || 'Untitled show';
      var showId = str(t.showId, 64) || ('feed-' + fnv1a(feedUrl));
      var created = o.createdAt;
      var rec = {
        id: o.id, kind: kind, status: o.status || 'active',
        showId: showId,
        showTitle: showTitle,
        showTitleFa: kind === 'episode' ? str(t.showTitleFa, 200) : str(t.titleFa, 200),
        publisher: str(t.publisher, 120),
        initials: t.initials ? str(t.initials, 4) : initialsOf(showTitle),
        artUrl: '',
        episodeId: kind === 'episode' ? (str(t.episodeId, 64) || ('ep-' + fnv1a(feedUrl + '|' + guid))) : '',
        episodeTitle: kind === 'episode' ? (str(t.title, 300) || 'Untitled episode') : '',
        episodeTitleFa: kind === 'episode' ? str(t.titleFa, 300) : '',
        description: kind === 'episode' ? str(t.description, 600) : '',
        durationSec: kind === 'episode' && typeof t.durationSec === 'number' ? t.durationSec : 0,
        note: str(o.note, NOTE_CAP),
        feedUrl: feedUrl, guid: guid,
        createdAt: created, expiresAt: created + LIFETIME_MS,
        capability: o.capability || '',
        external: true
      };
      /* Follow has to work for a real show too, so its identity is remembered. */
      rememberShow(rec);
      return rec;
    }

    function seed() {
      var i, s, rec;
      for (i = 0; i < SEED.length; i++) {
        s = SEED[i];
        rec = buildFromTarget({
          id: s.id, kind: s.kind, target: s.target, note: s.note, status: s.status,
          createdAt: now() - Math.round(s.agoDays * DAY_MS), capability: ''
        });
        if (rec) { addRecord(rec, ''); }
      }
    }

    /* ---- visibility predicate, evaluated at read time. Correctness never
       depends on a cleanup job: an expired row is simply not active. ---- */
    function viewable(rec, t) { return statusAt(rec, t) === 'active'; }

    /* Show identity for either catalogue: the fictional fixtures, or a show this
       device published from its own subscription and therefore only knows as a
       feed address plus the publication built from it. */
    function lookupShow(showId) {
      var sh = findShow(showId), rec = extraShows[showId];
      if (sh) {
        return {
          id: sh.id, title: sh.title, titleFa: sh.titleFa, publisher: sh.publisher,
          initials: sh.initials, artUrl: sh.artUrl, feedUrl: sh.feedUrl, external: false
        };
      }
      if (rec) {
        return {
          id: rec.showId, title: rec.showTitle, titleFa: rec.showTitleFa, publisher: rec.publisher,
          initials: rec.initials, artUrl: rec.artUrl, feedUrl: rec.feedUrl, external: true
        };
      }
      return null;
    }

    function announce() {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](); } catch (e) { /* one bad listener never stops the rest */ }
      }
    }
    function later(fn) {
      /* Simulated transport time. The UI shows a busy state, so a future real
         adapter can drop this without any call-site change. */
      return new Promise(function (resolve, reject) {
        var t = latency;
        function run() {
          try { resolve(fn()); } catch (e) { reject(e); }
        }
        if (t > 0 && typeof setTimeout === 'function') { setTimeout(run, t); } else { run(); }
      });
    }

    /* The shared preview catalogue is always present; whatever this device
       published before is layered on top of it. Seeding after loading would
       make the ambient list depend on whether anything was persisted. */
    seed();
    load();

    /* ================= the adapter surface (UI may only use these) ======== */
    var api = {
      LIFETIME_MS: LIFETIME_MS, NOTE_CAP: NOTE_CAP, SAVE_CAP: SAVE_CAP,

      /* Ambient catalogue: only viewable publications, never feed addresses. */
      list: function () {
        return later(function () {
          var t = now(), out = [], id;
          for (id in records) {
            if (Object.prototype.hasOwnProperty.call(records, id) && viewable(records[id], t)) {
              out.push(publicView(records[id]));
            }
          }
          out.sort(function (a, b) { return b.createdAt - a.createdAt; });
          return { publications: out };
        });
      },

      /* Detail read. Anything not viewable answers identically, including an
         unknown id: no id, no reason, no hint of hidden versus removed. */
      get: function (id) {
        return later(function () {
          var rec = records[id];
          if (!rec || !viewable(rec, now())) {
            return { kind: 'gone', id: typeof id === 'string' ? id : '' };
          }
          var v = publicView(rec);
          v.kind = 'publication';
          v.feedUrl = rec.feedUrl;   /* detail-only, per the approved rule */
          v.guid = rec.guid;
          return v;
        });
      },

      /* Publish. Idempotent by capability, and the Q6 republish rules:
         an unexpired active duplicate names the existing id; a hidden or
         removed duplicate discloses nothing; expired/revoked release the key. */
      publish: function (req) {
        return later(function () {
          if (!isObj(req)) { return { ok: false, code: 'bad-request' }; }
          var t = now();
          var cap = typeof req.capability === 'string' ? req.capability : '';
          if (cap && capIndex[cap]) {
            var again = records[capIndex[cap]];
            return { ok: true, idempotent: true, publication: publicView(again) };
          }
          var rec = buildFromTarget({
            id: newId(++seq), kind: req.kind, target: req.target,
            note: req.note, createdAt: t, capability: cap
          });
          if (!rec) { return { ok: false, code: 'unknown-target' }; }
          if (!rec.note) { return { ok: false, code: 'note-required' }; }
          var k = targetKey(rec), i, live, st;
          if (keyIndex[k]) {
            for (i = 0; i < keyIndex[k].length; i++) {
              live = records[keyIndex[k][i]];
              st = statusAt(live, t);
              if (st === 'active') {
                return { ok: false, code: 'duplicate', publicationId: live.id };
              }
              if (st === 'hidden' || st === 'removed') {
                return { ok: false, code: 'publication-unavailable' };
              }
              /* expired and revoked release the identity key: fall through. */
            }
          }
          addRecord(rec, cap);
          local.mine.push(rec.id);
          save(); announce();
          return { ok: true, publication: publicView(rec), capability: cap };
        });
      },

      /* Report. One uniform answer for every outcome, so the endpoint can never
         become an existence or status oracle. */
      report: function (id) {
        return later(function () {
          void id;
          return { ok: true };
        });
      },

      /* Owner revoke. The capability travels as data, never in a URL. */
      revoke: function (req) {
        return later(function () {
          var cap = isObj(req) && req.capability ? req.capability : '';
          var id = capIndex[cap];
          if (!id || !records[id]) { return { ok: false, code: 'publication-unavailable' }; }
          records[id].status = 'revoked';
          save(); announce();
          return { ok: true, publicationId: id };
        });
      },

      /* ---- personal records: Save and Follow are separate and neither
         implies Favorite, Subscribe or anything else ---- */
      saved: function () {
        var t = now(), out = [], i, rec;
        for (i = 0; i < local.saves.length; i++) {
          rec = records[local.saves[i]];
          out.push({
            id: local.saves[i],
            available: !!rec && viewable(rec, t),
            publication: rec ? publicView(rec) : null
          });
        }
        return out;
      },
      isSaved: function (id) { return local.saves.indexOf(id) >= 0; },
      save: function (id) {
        var rec = records[id];
        if (!rec) { return { ok: false, code: 'publication-unavailable' }; }
        if (local.saves.indexOf(id) >= 0) { return { ok: true, already: true }; }
        if (local.saves.length >= SAVE_CAP) { return { ok: false, code: 'save-capacity' }; }
        local.saves.push(id);
        save(); announce();
        return { ok: true };
      },
      unsave: function (id) {
        var i = local.saves.indexOf(id);
        if (i >= 0) { local.saves.splice(i, 1); save(); announce(); }
        return { ok: true };
      },
      followed: function () { return local.follows.slice(); },
      isFollowed: function (showId) { return local.follows.indexOf(showId) >= 0; },
      /* Show identity for either catalogue: the fictional fixtures or a show
         this device published from its own subscription. */
      showById: function (showId) { return lookupShow(showId); },
      follow: function (showId) {
        if (!lookupShow(showId)) { return { ok: false, code: 'unknown-target' }; }
        if (local.follows.indexOf(showId) < 0) { local.follows.push(showId); save(); announce(); }
        return { ok: true };
      },
      unfollow: function (showId) {
        var i = local.follows.indexOf(showId);
        if (i >= 0) { local.follows.splice(i, 1); save(); announce(); }
        return { ok: true };
      },
      /* What this device published, with the capability it must keep. Local
         only: a production client would hold this in its own private storage. */
      mine: function () {
        var out = [], i, rec, t = now();
        for (i = 0; i < local.mine.length; i++) {
          rec = records[local.mine[i]];
          if (!rec) { continue; }
          out.push({ publication: publicView(rec), status: statusAt(rec, t), capability: rec.capability });
        }
        return out;
      },

      onChange: function (fn) {
        if (typeof fn !== 'function') { return function () {}; }
        listeners.push(fn);
        return function () {
          var i = listeners.indexOf(fn);
          if (i >= 0) { listeners.splice(i, 1); }
        };
      },

      /* ---- PREVIEW-ONLY, never part of the adapter contract the real API
         will implement. Drives states that a pending number would otherwise
         force us to invent: moderation outcomes and the Save capacity. ---- */
      __preview: {
        shows: SHOWS, episodes: EPISODES,
        recordCount: function () { return Object.keys(records).length; },
        /* Simulate the visible consequence of moderation, with no threshold. */
        moderate: function (id, action) {
          var rec = records[id];
          if (!rec) { return { ok: false }; }
          rec.status = action === 'remove' ? 'removed' : 'hidden';
          save(); announce();
          return { ok: true, status: rec.status };
        },
        unmoderate: function (id) {
          var rec = records[id];
          if (!rec) { return { ok: false }; }
          /* Only a hidden row can come back. A removed tombstone is permanent,
             and expired/revoked rows never return to active. */
          if (rec.status !== 'hidden') { return { ok: false, status: rec.status }; }
          /* Expiry-aware un-hide: a hidden row past its lifetime goes to
             expired, never back to active. */
          rec.status = now() >= rec.expiresAt ? 'expired' : 'active';
          save(); announce();
          return { ok: true, status: rec.status };
        },
        /* Age a publication past its lifetime without waiting seven days. */
        expire: function (id) {
          var rec = records[id];
          if (!rec) { return { ok: false }; }
          rec.expiresAt = now() - 1000;
          save(); announce();
          return { ok: true };
        },
        /* The 100-Save refusal needs a hundred Saves to be seen. Synthetic
           publications are created through the ordinary record path (so the
           Saved view renders them like any other row) and are dropped again by
           clearLocal, so the demo cannot leave state behind. */
        fillSaves: function (n) {
          var want = Math.min(typeof n === 'number' ? n : 0, SAVE_CAP);
          var made = 0, k = 0, rec;
          while (local.saves.length < want) {
            rec = buildFromTarget({
              id: newId(++seq) + '-syn', kind: 'episode',
              target: EPISODES[k % EPISODES.length].id,
              note: 'Preview filler ' + (k + 1),
              createdAt: now() - Math.round((k % 6) * DAY_MS), capability: ''
            });
            k++;
            if (!rec) { continue; }
            rec.synthetic = true;
            addRecord(rec, '');
            local.saves.push(rec.id);
            made++;
          }
          save(); announce();
          return { ok: true, saved: local.saves.length, made: made };
        },
        clearLocal: function () {
          var id;
          local.saves = []; local.follows = []; local.mine = [];
          for (id in records) {
            if (Object.prototype.hasOwnProperty.call(records, id) && records[id].synthetic) {
              delete records[id];
            }
          }
          /* Rebuild both indexes from the surviving records rather than
             trying to un-splice them. */
          keyIndex = {}; capIndex = {};
          for (id in records) {
            if (!Object.prototype.hasOwnProperty.call(records, id)) { continue; }
            var kid = targetKey(records[id]);
            if (!keyIndex[kid]) { keyIndex[kid] = []; }
            keyIndex[kid].push(id);
            if (records[id].capability) { capIndex[records[id].capability] = id; }
          }
          save(); announce();
          return { ok: true };
        }
      }
    };
    return api;
  }

  return {
    LIFETIME_MS: LIFETIME_MS, NOTE_CAP: NOTE_CAP, SAVE_CAP: SAVE_CAP, DAY_MS: DAY_MS,
    SHOWS: SHOWS, EPISODES: EPISODES,
    createApi: createApi, makeCapability: makeCapability,
    targetKey: targetKey, statusAt: statusAt
  };
});
