/* ======================================================================
   Void — public Signals layer (visitors)

   Renders the messages the Worker already says are eligible as ambient stars
   orbiting the Galaxy core, and opens one of them in a Void-glass surface
   where its plain-text URLs become real, safe anchors.

   Boundaries this file keeps:
   - Read-only: /signals/* only. No credential, no admin path, no ADMIN_SECRET.
   - Signal text is data, never markup. Nothing here assigns innerHTML, so a
     body cannot inject an element even if the server-side guard is bypassed.
   - Eligibility is the Worker's decision: what the feed returns is shown, what
     it stops returning is removed.
   - Star appearance comes from the assigned star profile, so the owner tunes
     it in the admin studio instead of in this file.
   ====================================================================== */
(function (global) {
  'use strict';

  if (global.VoidSignalsPublic) return global.VoidSignalsPublic;

  var doc = global.document;
  var LAYER_ID = 'void-signals-layer';
  var READ_KEY = 'voidSignals.read.v1';
  var READ_CAP = 240;
  /* Cheap and enough: /signals/version is a one-row read, and only a change
     makes the feed get fetched again. Nothing polls while the tab is hidden. */
  var POLL_MS = 90000;
  var RETRY_MS = 5 * 60000;
  var MAX_STARS = 14;
  var SEP_PX = 56;
  var EDGE_PX = 30;
  var RESIZE_DEBOUNCE_MS = 260;
  var GOLDEN = 2.399963229728653;

  /* Interactive chrome a star must never sit on. Measured, not assumed: the
     dock and rail change size with viewport, language and playback state. */
  var AVOID_SELECTORS = [
    '#void-topnav', '.vm-dock', '#void-galaxy-stats', '#void-god-quill',
    '#void-god-discover', '[data-void-signals-avoid]'
  ];

  /* RFC 3986 body characters, so a link only ends at whitespace or a quote.
     Prose punctuation is peeled off afterwards by stripTail. */
  var URL_SCAN = /(https?:\/\/[^\s<>"'`]+)/gi;

  var CATEGORY_LABEL = {
    general: 'Signal', release: 'Release', event: 'Event',
    milestone: 'Milestone', maintenance: 'Maintenance'
  };

  var COLOR_RIMS = {
    gold: ['#f6c86a', '#b8862f', '#fff8e8'],
    silver: ['#dce6f0', '#93a6bd', '#ffffff'],
    white: ['#f2f5f8', '#c3ccd6', '#ffffff'],
    ember: ['#f0b072', '#a9663a', '#ffe9cf'],
    ice: ['#cfe2ee', '#7f9db4', '#f4fbff']
  };

  /* ---------------- small helpers ---------------- */

  function el(tag, cls) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  function num(v, dflt) {
    v = Number(v);
    return isFinite(v) ? v : dflt;
  }

  /* FNV-1a: stable across sessions, so a star keeps its place and its tint. */
  function hash32(s) {
    var h = 2166136261, i;
    s = String(s);
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function unit(seed) {
    return (hash32(seed) % 100000) / 100000;
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function hasClass(node, name) {
    return (' ' + node.className + ' ').indexOf(' ' + name + ' ') >= 0;
  }

  function addClass(node, name) {
    if (!hasClass(node, name)) node.className = (node.className ? node.className + ' ' : '') + name;
  }

  function removeClass(node, name) {
    node.className = (' ' + node.className + ' ').replace(' ' + name + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }

  function ssGet() {
    try {
      return global.sessionStorage;
    } catch (e) {
      return null; /* private mode: the layer works, read marks just reset */
    }
  }

  /* ---------------- session-scoped read state ---------------- */

  var readMap = {};

  function loadRead() {
    var s = ssGet(), raw, list, i;
    if (!s) return;
    try {
      raw = s.getItem(READ_KEY);
      if (!raw) return;
      list = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!list || !list.length) return;
    for (i = 0; i < list.length; i++) {
      if (typeof list[i] === 'string' && list[i]) readMap[list[i]] = true;
    }
  }

  function saveRead() {
    var s = ssGet(), ids = [], k;
    if (!s) return;
    for (k in readMap) {
      if (Object.prototype.hasOwnProperty.call(readMap, k)) ids.push(k);
    }
    if (ids.length > READ_CAP) ids = ids.slice(ids.length - READ_CAP);
    try {
      s.setItem(READ_KEY, JSON.stringify(ids));
    } catch (e) { /* quota: read state stays in memory for this page */ }
  }

  function isRead(id) {
    return !!readMap[String(id)];
  }

  function markRead(id) {
    id = String(id);
    if (readMap[id]) return false;
    readMap[id] = true;
    saveRead();
    return true;
  }

  /* ---------------- text → safely clickable text ---------------- */

  /* A trailing . , ; : ! ? ' " & is almost always the sentence, not the address.
     A closer is judged by balance instead: one without an opener is prose, so
     "(see …/a)" loses its paren while …/Foo_(bar) keeps its. */
  var URL_TAIL = /[.,;:!?'">&]+$/;
  function stripTail(candidate) {
    var url = candidate, before, i, open, close;
    for (i = 0; i < 6; i++) {
      before = url;
      url = url.replace(URL_TAIL, '');
      if (url === before) break;
    }
    for (i = 0; i < 4; i++) {
      before = url;
      open = (url.match(/\(/g) || []).length;
      close = (url.match(/\)/g) || []).length;
      if (close > open && url.charAt(url.length - 1) === ')') url = url.slice(0, -1);
      if (url.charAt(url.length - 1) === ']' && (url.match(/\[/g) || []).length === 0) url = url.slice(0, -1);
      if (url.charAt(url.length - 1) === '>') url = url.slice(0, -1);
      if (url === before) break;
    }
    return url;
  }

  /* new URL() parses, the allowlist decides. javascript:, data:, blob: and every
     other scheme fail here even if URL_SCAN is ever widened — and a hand-typed
     "javascript:…" never matches the scan in the first place. */
  function safeUrl(raw) {
    var parsed, host;
    if (!raw) return null;
    try {
      parsed = new global.URL(raw);
    } catch (e) {
      return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    host = parsed.hostname;
    if (!host || host.length < 2) return null;
    if (host.indexOf('.') < 0 && host.charAt(0) !== '[' && host !== 'localhost') return null;
    return parsed.href;
  }

  /* One line → ordered runs of plain text and links, never a markup string.
     A character peeled off the end of a URL stays in the text run that follows
     it, so the line can be rebuilt by concatenation with nothing lost or
     doubled. */
  function splitLine(line) {
    var parts = [], last = 0, raw, url, end, m;
    line = String(line == null ? '' : line);
    URL_SCAN.lastIndex = 0;
    while ((m = URL_SCAN.exec(line)) !== null) {
      raw = m[0];
      url = stripTail(raw);
      if (!url || !safeUrl(url)) continue;
      end = m.index + url.length;
      if (m.index > last) parts.push({ kind: 'text', value: line.slice(last, m.index) });
      parts.push({ kind: 'link', value: url });
      last = end;
      URL_SCAN.lastIndex = end;
    }
    if (last < line.length) parts.push({ kind: 'text', value: line.slice(last) });
    return parts;
  }

  function linkNode(url) {
    var a = el('a', 'vs-link');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = url;
    a.setAttribute('title', 'Open in a new tab');
    return a;
  }

  function linkifyInto(node, line) {
    var parts = splitLine(line), i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i].kind === 'link') node.appendChild(linkNode(parts[i].value));
      else node.appendChild(doc.createTextNode(parts[i].value));
    }
    return node;
  }

  /* Each body line keeps its own paragraph: a two-line message reads as two
     lines, and a blank source line stays as spacing rather than vanishing. */
  function renderBodyInto(host, body) {
    var lines = String(body == null ? '' : body).replace(/\r\n?/g, '\n').split('\n');
    var i, p;
    host.textContent = '';
    for (i = 0; i < lines.length; i++) {
      p = el('p', 'vs-line');
      if (!lines[i]) {
        p.className = 'vs-line vs-line--gap';
        p.appendChild(doc.createTextNode(' '));
      } else {
        if (/^\s*([•▪‣◦*\-–])\s/.test(lines[i])) addClass(p, 'vs-line--list');
        linkifyInto(p, lines[i]);
      }
      host.appendChild(p);
    }
    return lines.length;
  }

  /* ---------------- star profile → presentation tokens ---------------- */

  function baseSettings() {
    var api = global.VoidSignalsApi;
    var d = (api && api.DEFAULTS) || {};
    return {
      preset: d.preset || 'organic', style: d.style || 'spark', color: d.color || 'gold',
      motion: d.motion || 'animated', size: num(d.size, 1), brightness: num(d.brightness, 1),
      glow: num(d.glow, 1), softness: num(d.softness, 0),
      motionIntensity: num(d.motionIntensity, 1),
      glowTransitionMs: num(d.glowTransitionMs, 900), drift: num(d.drift, 0.35)
    };
  }

  var RANGES = {
    size: [0.5, 2.2], brightness: [0.3, 1.6], glow: [0, 2], softness: [0, 1],
    motionIntensity: [0, 1.6], glowTransitionMs: [120, 2600], drift: [0, 1.2]
  };
  var ENUMS = {
    preset: ['organic', 'constellation', 'circular', 'spiral', 'geometric', 'heart', 'star'],
    style: ['spark', 'point', 'bloom', 'hairline'],
    color: ['gold', 'silver', 'white', 'ember', 'ice'],
    motion: ['animated', 'static']
  };

  /* The API module owns the contract; this local copy only runs if an older
     bundle is on the page, so a bad setting can never reach the CSS. */
  function clampSettings(settings) {
    var api = global.VoidSignalsApi, base = baseSettings(), out = {}, k, v;
    if (api && api.fullSettings) {
      try {
        return api.fullSettings(settings || {});
      } catch (e) { /* fall through to the local clamp */ }
    }
    for (k in base) {
      if (!Object.prototype.hasOwnProperty.call(base, k)) continue;
      v = settings && settings[k] !== undefined ? settings[k] : base[k];
      if (RANGES[k]) out[k] = clamp(num(v, base[k]), RANGES[k][0], RANGES[k][1]);
      else out[k] = ENUMS[k].indexOf(String(v)) >= 0 ? String(v) : base[k];
    }
    return out;
  }

  /* A message's own profile wins; otherwise the most specific assignment the
     admin made, mirroring the way profiles are scoped: category, then
     importance, then global. Only activated profiles ever reach this payload,
     so a saved-but-unactivated id simply falls through. */
  function profileFor(payload, msg) {
    var a = payload && payload.assignments, profiles = payload && payload.profiles, id;
    if (!profiles) return null;
    if (msg.profile_id && profiles[msg.profile_id]) return profiles[msg.profile_id].settings || null;
    if (!a) return null;
    id = (a.byCategory && a.byCategory[msg.category]) ||
      (a.byImportance && a.byImportance[msg.importance]) || a.global || null;
    if (!id || !profiles[id]) return null;
    return profiles[id].settings || null;
  }

  function tokenMap(settings, still) {
    var rim = COLOR_RIMS[settings.color] || COLOR_RIMS.gold;
    var intensity = still ? 1 : Math.max(0.25, settings.motionIntensity);
    return {
      '--ss-a': rim[0], '--ss-b': rim[1], '--ss-core': rim[2],
      '--ss-size': String(settings.size), '--ss-bright': String(settings.brightness),
      '--ss-glow': String(settings.glow),
      '--ss-soft': (settings.softness * 2.4).toFixed(2) + 'px',
      '--ss-motion': still ? '0' : String(settings.motionIntensity),
      '--ss-breath': (7.5 / intensity).toFixed(2) + 's',
      '--ss-glow-ms': Math.round(settings.glowTransitionMs) + 'ms',
      '--ss-drift': still ? '0.00' : settings.drift.toFixed(2)
    };
  }

  /* Same token names the Star Studio stage consumes, so what the owner tunes in
     the admin preview is literally what a visitor sees. `inherit` is the token
     map the layer already provides: a star only restates what differs. */
  function writeTokens(node, settings, still, inherit) {
    var t = tokenMap(settings, still), k;
    for (k in t) {
      if (!Object.prototype.hasOwnProperty.call(t, k)) continue;
      if (inherit && t[k] === inherit[k]) continue;
      node.style.setProperty(k, t[k]);
    }
  }

  /* ---------------- geometry ---------------- */

  function orb() {
    var vd = global.VoidDomains, g = null, w = num(global.innerWidth, 1280), h = num(global.innerHeight, 720);
    try {
      if (vd && vd.getOrbGeometry) g = vd.getOrbGeometry();
    } catch (e) {
      g = null;
    }
    if (g && isFinite(g.cx) && isFinite(g.cy) && isFinite(g.R) && g.R > 0) {
      return { cx: g.cx, cy: g.cy, R: g.R, hole: num(g.hole, 0), w: w, h: h, live: true };
    }
    /* No live visualizer (closed panel, lightweight mode, TV): the CSS orb the
       page would draw is the reference, at the same constants. */
    return { cx: w / 2, cy: h * 0.45, R: Math.min(w, h) * 0.37, hole: 0, w: w, h: h, live: false };
  }

  function reservedRects() {
    var out = [], i, nodes, j, r, k, whole;
    for (i = 0; i < AVOID_SELECTORS.length; i++) {
      nodes = doc.querySelectorAll(AVOID_SELECTORS[i]);
      for (j = 0; j < nodes.length; j++) {
        if (nodes[j].id === LAYER_ID || !nodes[j].getBoundingClientRect) continue;
        r = nodes[j].getBoundingClientRect();
        if (!r || r.width <= 0 || r.height <= 0) continue;
        out.push({
          left: r.left - 12, top: r.top - 12,
          right: r.right + 12, bottom: r.bottom + 12,
          area: (r.width + 24) * (r.height + 24)
        });
      }
    }
    /* A near-full-screen element is not chrome to route around, it already owns
       the screen; reserving it would leave nowhere to place anything. */
    whole = num(global.innerWidth, 1) * num(global.innerHeight, 1);
    for (k = out.length - 1; k >= 0; k--) {
      if (out[k].area > whole * 0.35) out.splice(k, 1);
    }
    return out;
  }

  function inRect(x, y, half, rects) {
    var i;
    for (i = 0; i < rects.length; i++) {
      if (x + half > rects[i].left && x - half < rects[i].right &&
        y + half > rects[i].top && y - half < rects[i].bottom) return true;
    }
    return false;
  }

  function tooClose(x, y, placed) {
    var i, dx, dy;
    for (i = 0; i < placed.length; i++) {
      dx = x - placed[i].x;
      dy = y - placed[i].y;
      if (dx * dx + dy * dy < SEP_PX * SEP_PX) return true;
    }
    return false;
  }

  /* Stars orbit the core rather than land on it: a golden-angle walk over an
     annulus, each candidate rejected if it would cover the disc, a control, or
     another star. Order is the sorted id list, so an unrelated arrival cannot
     reshuffle the sky. */
  function place(idList, g, rects) {
    var out = [], i, ring, inner, outer, a, r, x, y, nudge, ok, seedR, seedA, half, ox, oy, m;
    ring = Math.max(g.R, g.hole * 0.9);
    inner = ring * 1.16 + 10;
    outer = ring * 1.95;
    for (i = 0; i < idList.length; i++) {
      seedR = unit('r' + idList[i]);
      seedA = unit('a' + idList[i]);
      half = 13;
      ok = false;
      for (nudge = 0; nudge < 26 && !ok; nudge++) {
        a = (i * GOLDEN) + seedA * 0.9 + nudge * 0.235;
        r = inner + (outer - inner) * (((seedR + nudge * 0.11) % 1) * 0.82);
        /* The squash fits wide-but-short viewports, and it shortens the vertical
           radius. Pushing the offset back out to `inner` keeps the promise the
           guard is built on: no star inside the disc band. */
        ox = Math.cos(a) * r;
        oy = Math.sin(a) * r * 0.9;
        m = Math.sqrt(ox * ox + oy * oy);
        if (m < inner) {
          ox = ox * (inner / (m || 1));
          oy = oy * (inner / (m || 1));
        }
        x = g.cx + ox;
        y = g.cy + oy;
        if (x < EDGE_PX || y < EDGE_PX || x > g.w - EDGE_PX || y > g.h - EDGE_PX) continue;
        if (inRect(x, y, half, rects) || tooClose(x, y, out)) continue;
        out.push({ id: idList[i], x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
        ok = true;
      }
      /* Nowhere left on this viewport: keep the message reachable, and a resize
         will try again. */
      if (!ok) out.push({ id: idList[i], x: null, y: null });
    }
    return out;
  }

  /* ---------------- module state ---------------- */

  var state = {
    started: false, api: null, host: null, version: null, fetches: 0, polls: 0,
    errors: 0, lastError: '', skipped: '', geometry: 'none', placed: 0, booted: false,
    items: {}, order: [], nodes: {}, profile: {},
    globalSettings: baseSettings(), globalTokens: {}, motionOff: false,
    timer: 0, retryAt: 0, expiry: {}, reveal: null, revealFor: null, mount: 'none',
    lastFocus: null, layerListeners: [], revealListeners: []
  };

  function on(target, ev, fn, bucket, capture) {
    target.addEventListener(ev, fn, !!capture);
    bucket.push([target, ev, fn, capture]);
  }

  function clearBucket(bucket) {
    var i;
    for (i = 0; i < bucket.length; i++) {
      try {
        bucket[i][0].removeEventListener(bucket[i][1], bucket[i][2], !!bucket[i][3]);
      } catch (e) { /* node already detached */ }
    }
    bucket.length = 0;
  }

  /* The stars belong to the Galaxy surface: #void-music-root is fixed and inset 0 and
     already holds #void-god-galaxy. Inside that container the shell owns the ordering
     (void-domains.css gives every child z-index 2, above the disc at 0 and under the
     rail at 1100), so the layer's own 950 only decides where the body fallback sits.
     Mounting on document.body instead puts the layer under the galaxy surface, so a
     real click lands on #void-god-galaxy rather than the star — and body.void-music-on
     force-hides every direct body child outside its allowlist. */
  /* The music engine builds #void-music-root when the Galaxy view opens, which can be
     after this layer boots, so the layer starts on body if it must and moves into the
     container as soon as it exists. */
  function ensureMount() {
    var host = state.host, root;
    if (!host) return false;
    root = doc.getElementById('void-music-root');
    var want = root || doc.body;
    if (host.parentNode === want) return false;
    if (root) removeClass(host, 'vs-layer--body'); else addClass(host, 'vs-layer--body');
    want.appendChild(host);
    state.mount = root ? 'galaxy' : 'body';
    return true;
  }

  function mountHost() {
    var host = doc.getElementById(LAYER_ID);
    if (host) {
      state.host = host;
      state.mount = host.parentNode === doc.getElementById('void-music-root') ? 'galaxy' : 'body';
      return host;
    }
    var root = doc.getElementById('void-music-root');
    host = el('div', 'vs-layer' + (root ? '' : ' vs-layer--body'));
    host.id = LAYER_ID;
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', 'Void signals');
    state.mount = root ? 'galaxy' : 'body';
    (root || doc.body).appendChild(host);
    return host;
  }

  function reducedMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false; /* no matchMedia: the CSS query still applies where it exists */
    }
  }

  /* LowFX and TV-class devices get still stars; a visitor who asked for reduced
     motion gets them everywhere. */
  function forceStill() {
    var tv = global.VoidTv;
    if (tv && tv.lowfx && tv.lowfx()) return true;
    return reducedMotion();
  }

  function settingsFor(msg) {
    var own = state.profile[msg.id];
    return own || state.globalSettings;
  }

  function starLabel(msg) {
    return (isRead(msg.id) ? 'Read signal: ' : 'New signal: ') + (msg.title || 'Untitled signal');
  }

  function makeStar(msg, pos, quiet) {
    var btn = el('button', 'vs-sig vs-sig--' + (msg.importance === 'important' ? 'important' : 'ambient'));
    var core = el('span', 'vs-core');
    var glyph = el('span', 'vs-glyph');
    var still = forceStill() || settingsFor(msg).motion === 'static';
    btn.type = 'button';
    btn.setAttribute('data-signal-id', msg.id);
    btn.setAttribute('aria-label', starLabel(msg));
    btn.setAttribute('data-style', settingsFor(msg).style);
    if (still) addClass(btn, 'is-still');
    btn.style.left = pos.x + 'px';
    btn.style.top = pos.y + 'px';
    writeTokens(btn, settingsFor(msg), still, state.globalTokens);
    /* Per-star phase so a cluster never breathes in lockstep. */
    btn.style.setProperty('--vs-phase', (-unit('d' + msg.id) * 6).toFixed(2) + 's');
    btn.style.setProperty('--vs-tilt', (unit('t' + msg.id) * 44 - 22).toFixed(1) + 'deg');
    core.appendChild(glyph);
    btn.appendChild(core);
    if (isRead(msg.id)) addClass(btn, 'is-read');
    /* Only a signal that arrived during this visit gets the flourish: a first
       paint of six old messages should not flicker the whole sky at once. */
    if (quiet) {
      addClass(btn, 'is-in');
    } else {
      addClass(btn, 'is-arriving');
      global.setTimeout(function () {
        removeClass(btn, 'is-arriving');
        addClass(btn, 'is-in');
      }, 1200);
    }
    on(btn, 'click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openMessage(msg.id);
    }, state.layerListeners);
    return btn;
  }

  function syncStars() {
    var host = state.host, g, rects, ids = [], spots, i, msg, pos, node, still, id;
    if (!host) return 0;
    ensureMount();
    for (i = 0; i < state.order.length; i++) {
      if (state.items[state.order[i]]) ids.push(state.order[i]);
    }
    if (ids.length > MAX_STARS) ids = ids.slice(0, MAX_STARS);
    g = orb();
    rects = reservedRects();
    spots = place(ids, g, rects);
    state.geometry = g.live ? 'webgl' : 'fallback';
    state.placed = 0;
    for (i = 0; i < ids.length; i++) {
      id = ids[i];
      msg = state.items[id];
      pos = spots[i];
      if (pos.x === null) {
        if (state.nodes[id]) {
          host.removeChild(state.nodes[id]);
          delete state.nodes[id];
        }
        continue;
      }
      state.placed++;
      node = state.nodes[id];
      still = forceStill() || settingsFor(msg).motion === 'static';
      if (!node) {
        node = makeStar(msg, pos, !state.booted);
        state.nodes[id] = node;
        host.appendChild(node);
      } else {
        node.style.left = pos.x + 'px';
        node.style.top = pos.y + 'px';
        node.setAttribute('data-style', settingsFor(msg).style);
        if (still) addClass(node, 'is-still'); else removeClass(node, 'is-still');
        writeTokens(node, settingsFor(msg), still, state.globalTokens);
      }
      node.setAttribute('aria-label', starLabel(msg));
      /* Both directions: read state lives in sessionStorage, so a node that outlives
         its own entry (cleared elsewhere, or a fresh visit) has to brighten again. */
      if (isRead(msg.id)) addClass(node, 'is-read'); else removeClass(node, 'is-read');
    }
    for (id in state.nodes) {
      if (!Object.prototype.hasOwnProperty.call(state.nodes, id)) continue;
      if (ids.indexOf(id) >= 0) continue;
      host.removeChild(state.nodes[id]);
      delete state.nodes[id];
    }
    host.setAttribute('data-count', String(ids.length));
    host.setAttribute('data-placed', String(state.placed));
    host.setAttribute('data-geometry', state.geometry);
    return state.placed;
  }

  /* One message, one star: a repeated poll updates the node, never adds a twin. */
  function setItems(messages) {
    var seen = {}, i, id, msg, next = [], k;
    messages = messages || [];
    for (i = 0; i < messages.length; i++) {
      msg = messages[i];
      id = msg && msg.id != null ? String(msg.id) : '';
      if (!id || seen[id]) continue;
      if (typeof msg.title !== 'string' && typeof msg.body !== 'string') continue;
      seen[id] = true;
      state.items[id] = msg;
      next.push(id);
    }
    next.sort();
    state.order = next;
    for (k in state.profile) {
      if (!Object.prototype.hasOwnProperty.call(state.profile, k)) continue;
      if (!seen[k]) delete state.profile[k];
    }
    for (k in state.items) {
      if (!Object.prototype.hasOwnProperty.call(state.items, k)) continue;
      if (seen[k]) continue;
      delete state.items[k];
      if (state.expiry[k]) {
        global.clearTimeout(state.expiry[k]);
        delete state.expiry[k];
      }
      if (state.revealFor === k) closeReveal();
    }
    syncStars();
    return next.length;
  }

  function scheduleExpiry() {
    var now = Math.floor(Date.now() / 1000), i, id, msg, delay;
    for (i = 0; i < state.order.length; i++) {
      id = state.order[i];
      msg = state.items[id];
      if (!msg || !msg.expires_at || state.expiry[id]) continue;
      delay = Math.max(1000, (num(msg.expires_at, 0) - now) * 1000);
      if (delay > 2147000000) continue; /* beyond a timer's reach: the next poll covers it */
      (function (messageId) {
        state.expiry[messageId] = global.setTimeout(function () {
          delete state.expiry[messageId];
          if (!state.items[messageId]) return;
          delete state.items[messageId];
          state.order = state.order.filter(function (x) { return x !== messageId; });
          syncStars();
        }, delay);
      })(id);
    }
  }

  function applyProfile(payload) {
    var i, id, msg;
    state.globalSettings = clampSettings((payload.assignments && payload.assignments.global &&
      payload.profiles[payload.assignments.global] && payload.profiles[payload.assignments.global].settings) || {});
    state.motionOff = forceStill();
    state.globalTokens = tokenMap(state.globalSettings, state.motionOff);
    for (i = 0; i < state.order.length; i++) {
      id = state.order[i];
      msg = state.items[id];
      if (!msg) continue;
      if (payload.profiles && Object.keys(payload.profiles).length) {
        state.profile[id] = clampSettings(profileFor(payload, msg) || {});
      }
    }
    if (state.host) {
      writeTokens(state.host, state.globalSettings, state.motionOff, null);
      state.host.setAttribute('data-style', state.globalSettings.style);
      state.host.setAttribute('data-preset', state.globalSettings.preset);
      state.host.setAttribute('data-color', state.globalSettings.color);
      state.host.setAttribute('data-motion', state.motionOff ? 'static' : 'animated');
    }
    syncStars();
  }

  /* ---------------- the reveal surface ---------------- */

  function categoryLabel(msg) {
    var name = CATEGORY_LABEL[String(msg.category || 'general')] || 'Signal';
    return msg.importance === 'important' ? name + ' · needs a look' : name;
  }

  /* A fresh node every time: re-appending the same <dialog> would re-enter the
     previous message's listeners along with its old text. */
  function buildReveal(msg) {
    var dlg = el('dialog', 'vs-reveal vs-reveal--' + (msg.importance === 'important' ? 'important' : 'ambient'));
    var head = el('div', 'vs-reveal__head');
    var kind = el('span', 'vs-reveal__kind');
    var close = el('button', 'vs-reveal__close');
    var title = el('h2', 'vs-reveal__title');
    var body = el('div', 'vs-reveal__body');
    var foot = el('div', 'vs-reveal__foot');
    var dismiss = el('button', 'vs-reveal__dismiss');
    dlg.setAttribute('aria-labelledby', 'vs-reveal-title');
    var meta = msg.metadata || {};
    if (meta.lang) dlg.setAttribute('lang', String(meta.lang).slice(0, 20));
    if (meta.occasion) dlg.setAttribute('data-occasion', String(meta.occasion).slice(0, 24));
    kind.textContent = categoryLabel(msg);
    close.type = 'button';
    close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close this signal');
    dismiss.type = 'button';
    dismiss.textContent = 'Back to the galaxy';
    title.id = 'vs-reveal-title';
    title.textContent = msg.title || 'Signal';
    renderBodyInto(body, msg.body);
    head.appendChild(kind);
    head.appendChild(close);
    foot.appendChild(dismiss);
    dlg.appendChild(head);
    dlg.appendChild(title);
    dlg.appendChild(body);
    dlg.appendChild(foot);
    on(close, 'click', function () { closeReveal(); }, state.revealListeners);
    on(dismiss, 'click', function () { closeReveal(); }, state.revealListeners);
    /* Handled rather than defaulted so the close is one path, and so Escape and
       a backdrop click both land in it. */
    on(dlg, 'cancel', function (ev) {
      ev.preventDefault();
      closeReveal();
    }, state.revealListeners);
    on(dlg, 'click', function (ev) {
      if (ev.target === dlg) closeReveal();
    }, state.revealListeners);
    /* Music Mode owns a keydown router on document in the capture phase
       (void-music.js:2955 -> onKey), and a bare Escape with no pop open calls exit() and
       then stopImmediatePropagation(). Document capture runs before the event reaches the
       dialog, so left alone the first Escape leaves Music Mode, never fires cancel, and
       leaves the message open over a torn-down view. Window capture runs before document
       capture, which is how every other top-layer window on this page keeps its Escape
       (index.html:1635, void-invite.js:165, signals-preview/signals-layer.js:1149).
       Guarded by the reveal's own lifetime: bound when it opens, released by closeReveal(). */
    on(global, 'keydown', function (ev) {
      if (ev.key !== 'Escape' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      closeReveal();
    }, state.revealListeners, true);
    return dlg;
  }

  function closeReveal() {
    var dlg = state.reveal, back = state.lastFocus;
    if (!dlg) return false;
    state.reveal = null;
    state.revealFor = null;
    state.lastFocus = null;
    clearBucket(state.revealListeners);
    if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
    try {
      if (back && back.focus && doc.contains(back)) back.focus();
    } catch (e) { /* the star was removed while the message was open */ }
    return true;
  }

  function openMessage(id) {
    var msg = state.items[id], host, dlg, closeBtn;
    if (!msg) return false;
    if (state.revealFor === id && state.reveal) return true;
    closeReveal();
    markRead(id);
    /* A sibling of the star layer inside the mount container. Not inside the layer
       (it is pointer-events:none) and not on <html> or <body>: void-music.css sweeps
       the direct children of both in Music Mode (visibility/opacity/pointer-events
       with !important), which would blank the surface the visitor just opened.
       #void-music-root is allowlisted there, and is where the app keeps its own
       Galaxy-view dialogs. */
    ensureMount();
    host = (state.host && state.host.parentNode) || doc.body;
    dlg = buildReveal(msg);
    state.reveal = dlg;
    state.revealFor = id;
    state.lastFocus = doc.activeElement;
    host.appendChild(dlg);
    if (typeof dlg.showModal === 'function') {
      try {
        dlg.showModal();
      } catch (e) {
        dlg.setAttribute('open', ''); /* already-open or unsupported: still readable */
      }
    } else {
      addClass(dlg, 'vs-reveal--plain');
      dlg.setAttribute('open', '');
    }
    syncStars();
    closeBtn = dlg.querySelector('.vs-reveal__close');
    if (closeBtn && closeBtn.focus) closeBtn.focus();
    return true;
  }

  /* ---------------- data ---------------- */

  function apiClient() {
    if (state.api) return state.api;
    var api = global.VoidSignalsApi;
    if (!api || !api.forPage) return null;
    state.api = api.forPage();
    return state.api;
  }

  function noteError(text) {
    state.errors++;
    state.lastError = String(text || 'unavailable');
    state.retryAt = Date.now() + RETRY_MS;
  }

  /* Every public method already resolves; a rejection here would mean the
     fetch wrapper itself threw, which must not reach the Galaxy. */
  function loadFeed(withProfile) {
    var client = apiClient();
    if (!client) {
      state.skipped = 'no-api';
      return Promise.resolve(false);
    }
    state.fetches++;
    return (withProfile && client.state ? client.state(40) : client.feed(40)).then(function (r) {
      if (!r || !r.ok) {
        noteError(r && r.error);
        return false;
      }
      var payload = r.data || {};
      state.lastError = '';
      state.retryAt = 0;
      state.version = num(payload.version, state.version);
      setItems(payload.messages || []);
      if (payload.profiles) applyProfile(payload);
      scheduleExpiry();
      state.booted = true;
      state.polls++;
      return true;
    }, function (e) {
      noteError(e && e.message ? e.message : e);
      return false;
    });
  }

  function poll() {
    var client = apiClient();
    if (!client || doc.hidden) return;
    state.fetches++;
    client.health().then(function (r) {
      if (!r || !r.ok) {
        noteError(r && r.error);
        return;
      }
      var v = num(r.data && r.data.version, state.version);
      if (state.version !== null && v === state.version) return;
      loadFeed(true);
    });
  }

  var resizeTimer = 0;

  function onResize() {
    if (resizeTimer) global.clearTimeout(resizeTimer);
    resizeTimer = global.setTimeout(function () {
      resizeTimer = 0;
      syncStars();
    }, RESIZE_DEBOUNCE_MS);
  }

  function start(opts) {
    opts = opts || {};
    if (state.started) return state;
    var tv = global.VoidTv;
    if (!global.VoidSignalsApi) {
      state.skipped = 'no-api';
      return state;
    }
    /* On a TV the D-pad would gain a stop for every signal, and the orb is
       already the only thing a viewer can reach. */
    if (!opts.force && tv && tv.tv) {
      state.skipped = 'tv';
      return state;
    }
    state.started = true;
    state.skipped = '';
    state.host = mountHost();
    loadRead();
    applyProfile({ profiles: {}, assignments: {} });
    on(global, 'resize', onResize, state.layerListeners);
    on(global, 'online', function () { loadFeed(true); }, state.layerListeners);
    on(doc, 'visibilitychange', function () {
      if (doc.hidden) return;
      if (!state.retryAt || Date.now() >= state.retryAt) poll();
    }, state.layerListeners);
    /* The shell builds #void-music-root when the Galaxy view opens, which can be
       after this layer already mounted on the body fallback. A body-level layer
       then paints under that root (z-index 1000) and stops receiving clicks, so
       one observer moves it into the container as soon as the container exists. */
    if (global.MutationObserver && doc.body && state.mount !== 'galaxy') {
      state.galaxyWatch = new global.MutationObserver(function () {
        if (!ensureMount()) return;
        /* One job only: follow the layer into the container, then stand down. Leaving an
           observer on <body> for the whole visit would re-run on every shell mutation. */
        state.galaxyWatch.disconnect();
        state.galaxyWatch = null;
        syncStars();
      });
      try {
        state.galaxyWatch.observe(doc.body, { childList: true });
      } catch (e) {
        state.galaxyWatch = null;
      }
    }
    loadFeed(true);
    state.timer = global.setInterval(function () {
      if (state.retryAt && Date.now() < state.retryAt) return;
      poll();
    }, num(opts.pollMs, POLL_MS));
    return state;
  }

  function stop() {
    var k;
    if (state.timer) global.clearInterval(state.timer);
    state.timer = 0;
    if (resizeTimer) global.clearTimeout(resizeTimer);
    resizeTimer = 0;
    if (state.galaxyWatch) {
      state.galaxyWatch.disconnect();
      state.galaxyWatch = null;
    }
    clearBucket(state.layerListeners);
    for (k in state.expiry) {
      if (Object.prototype.hasOwnProperty.call(state.expiry, k)) global.clearTimeout(state.expiry[k]);
    }
    state.expiry = {};
    closeReveal();
    if (state.host && state.host.parentNode) state.host.parentNode.removeChild(state.host);
    state.host = null;
    state.mount = 'none';
    state.nodes = {};
    state.items = {};
    state.order = [];
    state.profile = {};
    state.started = false;
    state.booted = false;
    state.placed = 0;
    return state;
  }

  global.VoidSignalsPublic = {
    READ_KEY: READ_KEY,
    MAX_STARS: MAX_STARS,
    start: start,
    stop: stop,
    refresh: function () { return loadFeed(true); },
    open: openMessage,
    close: closeReveal,
    readState: isRead,
    instance: function () { return state; },
    counts: function () {
      return {
        eligible: state.order.length,
        placed: state.placed,
        version: state.version,
        fetches: state.fetches,
        polls: state.polls,
        errors: state.errors,
        lastError: state.lastError,
        skipped: state.skipped,
        geometry: state.geometry,
        motionOff: !!state.motionOff,
        mount: state.mount,
        revealed: state.revealFor || null
      };
    },
    __test: {
      splitLine: splitLine,
      safeUrl: safeUrl,
      stripTail: stripTail,
      renderBodyInto: renderBodyInto,
      profileFor: profileFor,
      clampSettings: clampSettings,
      tokenMap: tokenMap,
      place: place,
      orb: orb,
      reservedRects: reservedRects,
      isRead: isRead,
      markRead: markRead,
      categoryLabel: categoryLabel,
      settingsFor: settingsFor
    }
  };

  /* The layer belongs to the page, so it starts with the page: nothing has to
     remember to call start(). ?signals=0 is the opt-out, same shape as the
     ?podcast=0 flag the Voice Thread uses. */
  function autoStart() {
    try {
      if (/[?&]signals=(?:0|false)(?:&|#|$)/.test(String(global.location.search || ''))) {
        state.skipped = 'flag';
        return;
      }
    } catch (e) { /* no location.search: start anyway */ }
    start();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', autoStart);
  else autoStart();
})(typeof window !== 'undefined' ? window : globalThis);
