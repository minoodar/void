/* Focused tests for the Podcast UX polish (A auto-close, B follow link,
   C title re-entry). Nothing is reimplemented here: each tested function is
   lifted verbatim out of the shipped source and executed in a vm against
   stubs, with the real VoidPodcastFeed validator for URL safety. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const WIN = read('podcast-window.js');
const PLAYER = read('podcast-player.js');
const DOMAINS = read('void-domains.js');
const Feed = require('../podcast-feed.js');

/* A whole function declaration, braces balanced. */
function fn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' exists in source');
  const i = src.indexOf('{', src.indexOf(')', at));
  let depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') { depth++; }
    else if (src[j] === '}') { depth--; if (!depth) { break; } }
  }
  assert.ok(depth === 0, name + ' body closes');
  return src.slice(at, j + 1);
}
/* Source between two unique markers, inclusive. */
function block(src, first, last) {
  const a = src.indexOf(first);
  assert.ok(a >= 0, 'block starts with: ' + first);
  const b = src.indexOf(last, a);
  assert.ok(b > a, 'block ends with: ' + last);
  return src.slice(a, b + last.length);
}
const occurrences = (hay, needle) => hay.split(needle).length - 1;

test('podcast homepage links are limited to the desktop show header', () => {
  const render = fn(WIN, 'renderShow');
  assert.match(render, /if \(!siteUrl \|\| isTV\(\)\) \{ return; \}/, 'missing sites and TV keep plain header elements');
  assert.match(render, /showArtLink\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(render, /showArtLink\.tabIndex = -1/);
  assert.match(render, /showTitleLink\.setAttribute\('aria-label', \(Feed\.isPlatformSiteUrl\(siteUrl\) \? 'Podcast page: ' : 'Podcast website: '\) \+ title\)/);
  assert.equal((render.match(/show(?:Art|Title)Link\.addEventListener/g) || []).length, 0, 'header anchors have no playback or navigation handlers');
  const css = read('podcast-window.css');
  assert.match(css, /\.pw__showtitle-link::after \{ content: " ↗"/);
  assert.match(css, /\.pw__showtitle-link:focus-visible \{ outline: 2px solid/);
});

/* ================= A — auto-close after a successful start ================= */

function windowHarness() {
  const listeners = {};
  const closed = [];
  const timers = [];
  const ctx = vm.createContext({
    window: {
      addEventListener: function (n, f) { (listeners[n] = listeners[n] || []).push(f); },
      removeEventListener: function (n, f) {
        const a = listeners[n] || [];
        const i = a.indexOf(f);
        if (i >= 0) { a.splice(i, 1); }
      }
    },
    setTimeout: function (f, ms) { const t = { f: f, ms: ms, cleared: false }; timers.push(t); return t; },
    clearTimeout: function (t) { if (t) { t.cleared = true; } },
    AUTO_CLOSE_MS: 8000
  });
  vm.runInContext(
    'var autoClose = null;\n' + fn(WIN, 'cancelAutoClose') + '\n' + fn(WIN, 'closeWhenPlaying'),
    ctx, { filename: 'autoclose-extract' }
  );
  /* podcast-window.js:1180 — close() starts with cancelAutoClose(), so the stub
     mirrors that instead of pretending the dialog disappears on its own. */
  ctx.close = function () { closed.push(1); vm.runInContext('cancelAutoClose()', ctx); };
  return {
    closed: closed,
    timers: timers,
    waiters: () => (listeners['podcast:playing'] || []).length,
    fire: (detail) => (listeners['podcast:playing'] || []).slice().forEach((f) => f({ detail: detail })),
    arm: (epId, state) => vm.runInContext(
      'closeWhenPlaying({ getState: function () { return ' + JSON.stringify(state) +
      '; } }, { id: ' + JSON.stringify(epId) + ' })', ctx)
  };
}

test('A: the window closes only when the player reports this episode playing', () => {
  const h = windowHarness();
  h.arm('ep-1', { playing: false, episodeId: null });
  assert.equal(h.closed.length, 0, 'no close before audio actually starts');
  assert.equal(h.waiters(), 1, 'one waiter registered');

  h.fire({ playing: true, episodeId: 'ep-other' });
  assert.equal(h.closed.length, 0, 'another episode starting does not close it');
  h.fire({ playing: false, episodeId: 'ep-1' });
  assert.equal(h.closed.length, 0, 'a pause is not a start');

  h.fire({ playing: true, episodeId: 'ep-1' });
  assert.equal(h.closed.length, 1, 'closed on the real start');
  assert.equal(h.waiters(), 0, 'waiter removed once it fires');
  assert.equal(h.timers.length, 1, 'one give-up timer was armed');
  assert.equal(h.timers[0].cleared, true, 'closing cancels it');
});

test('A: a blocked start never closes the window, and the wait is bounded', () => {
  const h = windowHarness();
  h.arm('ep-2', { playing: false, episodeId: null });
  h.fire({ playing: false, episodeId: 'ep-2' });
  assert.equal(h.closed.length, 0, 'blocked or paused keeps the window open');
  assert.equal(h.timers.length, 1, 'give-up timer armed');
  assert.equal(h.timers[0].ms, 8000, 'the waiter is dropped after the timeout, not fired');
  assert.equal(h.waiters(), 1, 'still waiting at 8s');
  h.timers[0].f();                       /* what the real timer calls at 8s */
  assert.equal(h.closed.length, 0, 'expiry does not close the window');
  assert.equal(h.waiters(), 0, 'expiry unregisters the waiter');
  h.fire({ playing: true, episodeId: 'ep-2' });
  assert.equal(h.closed.length, 0, 'a late start after expiry does not close it either');

  h.arm('ep-3', { playing: false, episodeId: null });
  assert.equal(h.waiters(), 1, 're-arming replaces the previous waiter');
});

test('A: an already-playing episode closes at once and arms no waiter', () => {
  const h = windowHarness();
  h.arm('ep-4', { playing: true, episodeId: 'ep-4' });
  assert.equal(h.closed.length, 1, 'immediate close');
  assert.equal(h.waiters(), 0, 'no listener needed');
});

test('A: closing is display-only — it cannot reach the player or the audio', () => {
  for (const name of ['close', 'closeWhenPlaying', 'cancelAutoClose']) {
    assert.doesNotMatch(fn(WIN, name), /VoidPodcastPlayer|P\.play|\.stop\(|\.pause\(|\baudio\b|\.src\b/,
      name + ' never touches playback');
  }
  assert.match(fn(WIN, 'close'), /dialog\.close\(\)|dialog\.removeAttribute/, 'the existing dialog teardown is reused');
  assert.match(fn(WIN, 'close'), /cancelAutoClose\(\);/, 'close also drops any pending waiter');
  assert.equal(occurrences(WIN, 'closeWhenPlaying'), 3, 'one definition and two arm sites (new start, resume)');
});

test('A: only the episode play press arms the close', () => {
  const handler = block(WIN, "play.addEventListener('click', function () {", 'if (res.ok) { closeWhenPlaying(P, ep); }');
  assert.match(handler, /var res = P\.play\(ep, sh\);/, 'plays through the existing player');
  assert.match(handler, /if \(st\.active && st\.episodeId === ep\.id\) \{/, 'the current row has its own branch');
  assert.match(handler, /playNote\.hidden = false;[\s\S]*if \(res\.ok\) \{ closeWhenPlaying\(P, ep\); \}/,
    'the failure note stays and only a successful start is armed');
  assert.equal(occurrences(handler, 'closeWhenPlaying'), 2, 'armed once on a new start, once on a resume');
  /* Nothing else in the file may close the dialog: browsing, searching,
     opening a show, refreshing feeds and sharing all stay open. */
  const auto = fn(WIN, 'closeWhenPlaying');
  assert.equal((WIN.match(/(^|[^.\w])close\(\)(?!\s*\{)/g) || []).length,
    (auto.match(/(^|[^.\w])close\(\)(?!\s*\{)/g) || []).length + 2,
    'exactly two closes exist outside closeWhenPlaying');
  for (const name of ['openShow', 'backToLibrary', 'renderLibrary', 'renderShowActions',
    'refreshFeeds', 'adoptFeed', 'open', 'sharePopOpen', 'showNote']) {
    assert.doesNotMatch(fn(WIN, name), /closeWhenPlaying|(^|[^.\w])close\(\)(?!\s*\{)/, name + ' never auto-closes');
  }
  assert.equal(occurrences(fn(WIN, 'renderShow'), 'closeWhenPlaying'), 2, 'the row renderer arms both start paths');
});

test('A: the two pre-existing user dismissals are unchanged', () => {
  const head = execFileSync('git', ['-C', ROOT, 'show', 'HEAD:podcast-window.js'], { encoding: 'utf8' })
    .replace(/\r\n/g, '\n');
  assert.equal((head.match(/if \(e\.target === dialog\) \{ close\(\); \} \}\)/g) || []).length, 1,
    'HEAD had one backdrop dismissal');
  assert.equal((head.match(/if \(view === 'show'\) \{ backToLibrary\(\); \} else \{ close\(\); \}/g) || []).length, 1,
    'HEAD had one Escape dismissal');
  assert.match(head, /if \(e\.target === dialog\) \{ close\(\); \} \}\)/, 'a backdrop click closed the dialog before this change');
  assert.match(head, /if \(view === 'show'\) \{ backToLibrary\(\); \} else \{ close\(\); \}/, 'Escape did too');
  assert.match(WIN, /if \(e\.target === dialog\) \{ close\(\); \} \}\)/, 'backdrop close kept, byte-identical');
  assert.match(WIN, /if \(view === 'show'\) \{ backToLibrary\(\); \} else \{ close\(\); \}/, 'Escape close kept, byte-identical');
});

/* ================= B — follow the podcast by its real RSS ================= */

const EP = { id: 'ep-9', title: 'Episode nine', audioUrl: 'https://cdn.example.org/ep9.mp3?token=abc%2F1' };

function followHarness(sh, href) {
  const rows = [];
  const copied = [];
  const ctx = vm.createContext({
    SAVED_ID: 'saved', Feed: Feed, URL: URL, encodeURIComponent: encodeURIComponent,
    location: { href: href || 'https://minoodar.github.io/void/' },
    sh: sh, ep: EP,
    shareBtn: function (label, f) { const b = { label: label, click: f }; rows.push(b); return b; },
    shareCopy: function (url, btn) { copied.push({ url: url, btn: btn }); }
  });
  vm.runInContext(
    [fn(WIN, 'feedForFollow'), fn(WIN, 'voidPageBase'), fn(WIN, 'followLink'),
      block(WIN, 'var followUrl = feedForFollow(sh);', '\n    }')].join('\n'),
    ctx, { filename: 'follow-extract' }
  );
  return { rows: rows, copied: copied, ctx: ctx };
}

test('B: Follow hands on the parent RSS feed, never the episode audio URL', () => {
  const rss = 'https://feeds.example.org/show.xml?src=void';
  const h = followHarness({ id: 'feed-1', title: 'Show', feedUrl: rss });
  assert.equal(h.rows.length, 1, 'Follow row exists when the feed is usable');
  assert.match(h.rows[0].label, /Follow/, 'labelled as the follow action');
  h.rows[0].click();
  assert.equal(h.copied.length, 1, 'clicking copies the follow link');
  const url = h.copied[0].url;
  assert.equal(url, 'https://minoodar.github.io/void/?follow=' + encodeURIComponent(rss));
  assert.equal(new URL(url).searchParams.get('follow'), rss, 'the RSS URL survives, query and all');
  assert.equal(url.indexOf(EP.audioUrl), -1, 'the audio URL is not the follow target');
  assert.equal(url.indexOf('ep9.mp3'), -1, 'no episode media leaks into the link');
  assert.equal(h.copied[0].btn, h.rows[0], 'copy feedback lands on the Follow button itself');
});

test('B: a missing or unusable feed hides Follow while every other row stays', () => {
  const cases = [
    ['no show object', undefined],
    ['bookmarked snapshot with no feed', { id: 'snap-1', feedUrl: '' }],
    ['saved pseudo-show', { id: 'saved', feedUrl: 'https://feeds.example.org/show.xml' }],
    ['plain http feed', { id: 'feed-2', feedUrl: 'http://feeds.example.org/show.xml' }],
    ['credentials in the feed URL', { id: 'feed-3', feedUrl: 'https://user:pass@feeds.example.org/x.xml' }],
    ['script URL', { id: 'feed-4', feedUrl: 'javascript:alert(1)' }],
    ['relative feed', { id: 'feed-5', feedUrl: '/shows/feed.xml' }],
    ['not a URL', { id: 'feed-6', feedUrl: 'not a feed' }]
  ];
  for (const [label, sh] of cases) {
    const h = followHarness(sh);
    assert.equal(h.rows.length, 0, label + ' — no Follow row');
    assert.equal(h.copied.length, 0, label + ' — nothing copied');
  }
  /* The four original rows are built before the guard, so Listen/Copy always work. */
  const pop = block(WIN, "copyB = shareBtn('Copy link", 'sharePop.textContent = ');
  const before = pop.slice(0, pop.indexOf('var followUrl = feedForFollow(sh);'));
  const after = pop.slice(pop.indexOf('var followUrl = feedForFollow(sh);'));
  assert.equal(occurrences(before, 'shareBtn('), 4, 'Copy, WhatsApp, Telegram and X are unconditional');
  assert.equal(occurrences(before, 'followUrl'), 0, 'none of them depends on the feed');
  assert.equal(occurrences(after, 'shareBtn('), 1, 'only the Follow row is conditional');
  assert.match(after, /if \(followUrl\) \{[\s\S]*shareBtn\(/, 'the guard wraps it');
});

test('B: the link resolves against the running page, with the published fallback', () => {
  const rss = 'https://feeds.example.org/show.xml';
  const onSite = followHarness({ id: 'feed-7', feedUrl: rss }, 'https://minoodar.github.io/void/index.html');
  onSite.rows[0].click();
  assert.equal(onSite.copied[0].url,
    'https://minoodar.github.io/void/index.html?follow=' + encodeURIComponent(rss), 'same page, param appended');

  const local = followHarness({ id: 'feed-8', feedUrl: rss }, 'file:///E:/void/index.html');
  local.rows[0].click();
  assert.equal(local.copied[0].url,
    'https://minoodar.github.io/void/?follow=' + encodeURIComponent(rss), 'a local copy hands out the public link');

  const keyed = followHarness({ id: 'feed-9', feedUrl: rss }, 'https://example.test/void/index.html?podcast=0&follow=old#open');
  keyed.rows[0].click();
  assert.equal(keyed.copied[0].url,
    'https://example.test/void/index.html?follow=' + encodeURIComponent(rss),
    'only the follow param travels — a sender flag, stale param or hash is not inherited');
});

test('B: the popover hint describes both actions', () => {
  assert.match(WIN, /'Share this episode or follow its podcast · اشتراک این قسمت یا دنبال‌کردن پادکست'/,
    'hint names sharing and following');
  assert.doesNotMatch(WIN, /Shares this episode/, 'the audio-only hint is gone');
  assert.match(WIN, /el\('p', 'pw__sharepop-hint'/, 'still the same hint element, one line of copy');
});

test('B: ?follow= is validated on arrival and only pre-fills the Add field', () => {
  const readParam = block(WIN, 'var pendingFollow = (function () {', '})();');
  const prefill = block(WIN, 'if (pendingFollow) {', 'searchInput.focus();');
  assert.match(readParam, /Feed\.safeFeedUrl/, 'the value passes the same validator a typed URL uses');
  assert.match(prefill, /searchInput\.value = pendingFollow;/, 'it only fills the field');
  assert.match(prefill, /pendingFollow = '';/, 'consumed once, so reopening does not re-fill');
  assert.doesNotMatch(prefill, /addFeed|adoptFeed|store\.subscribe|searchForm\.requestSubmit/, 'nothing subscribes on its own');
  assert.match(prefill, /showNote\(/, 'the visitor is told the feed is ready');

  for (const [raw, want] of [
    ['https://feeds.example.org/show.xml', 'https://feeds.example.org/show.xml'],
    ['http://feeds.example.org/show.xml', ''],
    ['https://user:pass@feeds.example.org/x.xml', ''],
    ['javascript:alert(1)', ''],
    ['../relative.xml', '']
  ]) {
    const ctx = vm.createContext({
      Feed: Feed, URLSearchParams: URLSearchParams,
      location: { search: '?follow=' + encodeURIComponent(raw) }
    });
    vm.runInContext(readParam, ctx, { filename: 'follow-param' });
    assert.equal(vm.runInContext('pendingFollow', ctx), want, 'arriving with ' + raw);
  }

  assert.match(DOMAINS, /if\(\/\[\?&\]follow=\[\^&#\]\/\.test\(location\.search\)\)\{openPodcastWindow\(null\);\}/,
    'the deep link opens the window directly, not through the four-icon selector');
  assert.equal(occurrences(DOMAINS, 'openPodcastWindow(null)'), 1, 'exactly one auto-open site');
  assert.doesNotMatch(block(DOMAINS, "if(/[?&]follow=", 'openPodcastWindow(null);}'), /selectDomain|constellation/,
    'the auto-open path never routes through the Golden Folder selector');
});

/* ========== release candidate: changed bytes must carry new cache keys ========== */

test('keys: every changed asset is keyed away from its HEAD key', () => {
  const from = (src, re) => { const m = src.match(re); assert.ok(m, 'key found for ' + re); return m[1]; };
  const head = (f) => execFileSync('git', ['-C', ROOT, 'show', 'HEAD:' + f], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
  const pairs = [
    ['podcast-store.js', read('void-domains.js'), head('void-domains.js'), /podcast-store\.js\?v=([^"']+)/],
    ['podcast-window.js', read('void-domains.js'), head('void-domains.js'), /podcast-window\.js\?v=([^"']+)/]
  ];
  for (const [file, here, before, re] of pairs) {
    assert.notEqual(from(here, re), from(before, re), file + ' ships new bytes under the old key');
  }
  /* Unchanged podcast assets must keep their keys — no needless re-download. */
  const dom = read('void-domains.js'), domHead = head('void-domains.js');
  for (const re of [/podcast-window\.css\?v=([^"']+)/, /podcast-feed\.js\?v=([^"']+)/,
    /podcast-sample-data\.js\?v=([^"']+)/,
    /void-podcast-thread\.js\?v=([^"']+)/, /podcast-thread\.css\?v=([^"']+)/]) {
    assert.equal(from(dom, re), from(domHead, re), 'unchanged asset keeps its key');
  }
});

/* ================= C — the title row is the way back ================= */

function fakeTitleNode() {
  return {
    listeners: {}, attrs: {},
    addEventListener: function (n, f) { (this.listeners[n] = this.listeners[n] || []).push(f); },
    removeEventListener: function (n, f) {
      const a = this.listeners[n] || [];
      const i = a.indexOf(f);
      if (i >= 0) { a.splice(i, 1); }
    },
    setAttribute: function (n, v) { this.attrs[n] = v; },
    getAttribute: function (n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    removeAttribute: function (n) { delete this.attrs[n]; },
    fire: function (n, ev) { (this.listeners[n] || []).slice().forEach((f) => f(ev)); }
  };
}
/* Stands in for the real MutationObserver: armTitleOpen must keep its own
   bookkeeping (observe on arm, disconnect on disarm) and the callback must be
   re-entrant-safe, because writing the attributes fires it again. */
function fakeObserverSink() {
  const sink = { targets: [], disconnected: 0, current: null };
  sink.MutationObserver = function (cb) {
    const self = this;
    this.observe = function (node) { sink.targets.push(node); sink.current = self; self.__cb = cb; };
    this.disconnect = function () { sink.disconnected++; sink.current = null; };
    this.takeRecords = function () { return []; };
  };
  sink.trigger = function () { if (sink.current) { sink.current.__cb([]); } };
  return sink;
}
function playerHarness(current, builtTitle, sink, noObserver) {
  const node = fakeTitleNode();
  const obs = sink || fakeObserverSink();
  const opened = [];
  const label = (PLAYER.match(/var TITLE_LABEL = '([^']+)';/) || [])[1];
  assert.ok(label, 'TITLE_LABEL found in the shipped player');
  const attrDecl = (PLAYER.match(/var TITLE_ATTRS = \[[^\]]*\];/) || [])[0];
  assert.ok(attrDecl, 'TITLE_ATTRS found in the shipped player');
  const MO = noObserver ? undefined : obs.MutationObserver;
  const ctx = vm.createContext({
    root: { querySelector: function (sel) { return sel === '.vm-title' && builtTitle !== false ? node : null; } },
    current: current,
    MutationObserver: MO,
    window: { VoidPodcastWindow: { open: function (o) { opened.push(o); } }, MutationObserver: MO }
  });
  vm.runInContext(
    'var titleNode = null, titleClick = null, titleKey = null, titleObs = null, titlePrev = null;\n' +
    attrDecl + '\n' +
    'var TITLE_LABEL = ' + JSON.stringify(label) + ';\n' +
    fn(PLAYER, 'ensureTitleAttrs') + '\n' +
    fn(PLAYER, 'openOwnWindow') + '\n' + fn(PLAYER, 'onTitleClick') + '\n' +
    fn(PLAYER, 'onTitleKey') + '\n' + fn(PLAYER, 'armTitleOpen'),
    ctx, { filename: 'title-extract' }
  );
  return {
    node: node, opened: opened, obs: obs,
    arm: (on) => vm.runInContext('armTitleOpen(' + on + ')', ctx),
    armed: () => (node.listeners.click || []).length > 0,
    ev: () => ({
      prevented: false, stopped: false,
      preventDefault: function () { this.prevented = true; },
      stopPropagation: function () { this.stopped = true; },
      stopImmediatePropagation: function () { this.stopped = 'immediate'; }
    })
  };
}

test('C: clicking the active title opens the existing window on the playing show', () => {
  const h = playerHarness({ show: { id: 'feed-11' }, episode: { id: 'ep-11' } });
  h.arm(true);
  assert.equal(h.armed(), true, 'click handler attached while the Podcast owns the chrome');
  assert.deepEqual([h.node.attrs.tabindex, h.node.attrs.role], ['0', 'button'], 'reachable by keyboard and D-pad');
  assert.match(h.node.attrs['aria-label'], /Open Podcast/, 'announced as the podcast entry point');
  const ev = h.ev();
  h.node.fire('click', ev);
  assert.equal(h.opened.length, 1, 'exactly one open call');
  assert.equal(h.opened[0].showId, 'feed-11', 'lands on the playing show');
  assert.equal(h.opened[0].returnFocus, h.node, 'focus returns to the title when the window closes');
  assert.equal(ev.prevented, true, 'default suppressed');
  assert.equal(ev.stopped, 'immediate', 'Music\'s same-node listener cannot also fire');

  h.arm(false);
  assert.equal(h.armed(), false, 'handlers removed when Music reclaims the session');
  assert.deepEqual(Object.keys(h.node.attrs), [], 'injected attributes removed');
  h.node.fire('click', h.ev());
  assert.equal(h.opened.length, 1, 'a disarmed title opens nothing');
  h.arm(false);
  assert.equal(h.armed(), false, 'disarming twice is safe');
});

test('C: Enter/Space reopen too, and re-entry never restarts playback', () => {
  const h = playerHarness({ show: { id: 'feed-12' }, episode: { id: 'ep-12' } });
  h.arm(true);
  h.node.fire('keydown', Object.assign(h.ev(), { key: 'Escape' }));
  assert.equal(h.opened.length, 0, 'Escape is not an open');
  h.node.fire('keydown', Object.assign(h.ev(), { key: 'Enter' }));
  assert.equal(h.opened.length, 1, 'Enter opens');
  h.node.fire('keydown', Object.assign(h.ev(), { key: ' ' }));
  assert.equal(h.opened.length, 2, 'Space opens');
  assert.deepEqual(h.opened.map(function (o) { return o.showId; }), ['feed-12', 'feed-12'],
    'keyboard entry lands on the same show as the mouse');

  const h2 = playerHarness(null);
  h2.arm(true);
  h2.node.fire('click', h2.ev());
  assert.equal(h2.opened.length, 1, 'a bare title still opens the window');
  assert.equal(h2.opened[0].showId, null, 'with no episode loaded the plain library opens');
  assert.equal(h2.opened[0].returnFocus, h2.node, 'focus still returns to the title');
  for (const name of ['openOwnWindow', 'onTitleClick', 'onTitleKey', 'armTitleOpen']) {
    assert.doesNotMatch(fn(PLAYER, name), /\.play\(|\.stop\(|\.pause\(|\baudio\b|VoidPodcastPlayer/,
      name + ' cannot restart or stop playback');
  }
  const apply = fn(PLAYER, 'applyChrome');
  assert.match(apply, /armSndIntercept\(true\);\s*armTitleOpen\(true\);/, 'armed with the rest of the borrowed chrome');
  assert.match(apply, /armSndIntercept\(false\);\s*armTitleOpen\(false\);/, 'removed with the rest of the borrowed chrome');
  assert.match(apply, /if \(want === borrowed\) \{ armTitleOpen\(want\); return; \}/,
    're-armed when the chrome is built after the ownership claim');
});

test('C: the window restores the show view through the existing renderer', () => {
  const open = fn(WIN, 'open');
  assert.match(open, /if \(opts\.showId\) \{ openShow\(opts\.showId, returnFocus\); \}/, 'showId lands on the show view');
  assert.match(open, /returnFocus\); \}\s*else if \(pendingFollow\) \{/, 'one opening has one landing state');
  assert.doesNotMatch(open, /showId:[^n]/, 'showId is read from opts only, never invented');
  const show = fn(WIN, 'openShow');
  assert.doesNotMatch(show, /VoidPodcastPlayer|\.play\(|\.stop\(|\.pause\(|audio/, 'openShow is render-only');
  assert.match(show, /renderShow\(showId\);/, 'the existing renderer is reused');
  assert.match(WIN, /var isCur = !!\(ps && ps\.active && ps\.episodeId === ep\.id\);/, 'the playing row is marked current');
  assert.doesNotMatch(fn(WIN, 'open'), /VoidPodcastPlayer|\.play\(/, 'open never reaches the player');
  /* Bookmark and Share live in that row, so they are one screen away. */
  assert.match(WIN, /bm\.setAttribute\('data-bm', ep\.id\);/, 'Bookmark on the row');
  assert.match(WIN, /share\.setAttribute\('data-share', ep\.id\);/, 'Share on the row');
  assert.match(WIN, /sharePopOpen\(ep, sh, share\);/, 'Share opens the existing popover');
});

test('C: Music keeps its own title behaviour outside podcast mode', () => {
  assert.equal(occurrences(read('void-music.js'), 'armTitleOpen'), 0, 'the engine is untouched');
  assert.match(read('void-music.js'), /els\.title\.addEventListener\('mouseenter', artTitleEnter\);/, 'Music hover path intact');
  assert.match(read('void-music.js'), /els\.title\.addEventListener\('keydown', function \(e\) \{[\s\S]*?replayArtwork\(\);/, 'Music keyboard path intact');
  const css = read('podcast-window.css');
  const titleRules = css.split('\n').filter(function (l) {
    return l.charAt(0) === '#' && l.indexOf('.vm-title') > 0;
  });
  assert.equal(titleRules.length, 3, 'three title selectors: reachable, hover, focus');
  assert.ok(titleRules.every(function (l) { return l.indexOf('#void-music-root.vm-podcast') === 0; }),
    'every one is scoped to podcast mode');
  assert.doesNotMatch(css, /\.vm-podcast[^{\n]*\.vm-title[^{\n]*\{[^}]*position: ?fixed/, 'no layout change to the row');
  const music = read('void-music.css');
  assert.match(music, /#void-music-root\.is-quiet \.vm-meta \.vm-title[^{]*\{ pointer-events: none; \}/,
    'Music quiet-mode rule unchanged, so podcast rules must not outrank it');
});

/* D1 — measured in real Chrome: with only a cursor rule the clicks landed on
   #void-god-galaxy, which paints above the in-flow .vm-meta row. */
test('C: the title row is actually reachable above the galaxy layer', () => {
  const css = read('podcast-window.css');
  const letters = read('void-letters.css');
  assert.match(letters, /#void-god-galaxy \{[^}]*position: absolute;[^}]*z-index: 0/, 'the layer that covered it (untouched)');
  const meta = css.match(/#void-music-root\.vm-podcast:not\(\.is-quiet\) \.vm-meta \{ ([^}]+) \}/);
  assert.ok(meta, 'the row is lifted while the Podcast owns the chrome');
  assert.match(meta[1], /position: relative/, 'lifted out of the in-flow stacking context');
  assert.match(meta[1], /z-index: 2/, 'above the galaxy layer, matching Music\'s own .is-art lift');
  const title = css.match(/#void-music-root\.vm-podcast:not\(\.is-quiet\) \.vm-meta \.vm-title \{ ([^}]+) \}/);
  assert.ok(title, 'the title itself receives the clicks');
  assert.match(title[1], /pointer-events: auto/, 'the parent row is pointer-events:none');
  assert.match(title[1], /cursor: pointer/, 'and looks pressable');
  assert.equal(occurrences(css, ':not(.is-quiet)'), 2, 'quiet mode keeps Music\'s own pointer-events:none');
  assert.equal(occurrences(css, 'vm-podcast:not(.is-quiet) .vm-meta'), 2, 'both lift rules carry the guard');
});

/* D2 — measured in real Chrome: Music's setMeta() → setTitleArt(false) strips
   role/tabindex/title about a second after a start, deleting the borrowed
   button underneath the user. */
test('C: the borrowed title button survives Music rewriting the row', () => {
  const h = playerHarness({ show: { id: 'feed-13' }, episode: { id: 'ep-13' } });
  h.arm(true);
  assert.equal(h.obs.targets.length, 1, 'one observer while the chrome is borrowed');
  h.arm(true);
  assert.equal(h.obs.targets.length, 1, 're-arming the same node adds no second observer');
  /* what Music does: drop the button attributes, as setTitleArt(false) does */
  ['tabindex', 'role', 'title', 'aria-label'].forEach((a) => h.node.removeAttribute(a));
  assert.equal(h.node.attrs.role, undefined, 'the row really was cleared');
  h.obs.trigger();
  assert.deepEqual([h.node.attrs.tabindex, h.node.attrs.role, h.node.attrs.title], ['0', 'button', 'Open Podcast · پادکست'],
    'the guard puts them back');
  const ev = h.ev();
  h.node.fire('click', ev);
  assert.equal(h.opened.length, 1, 'and the restored row still opens the window');
  h.arm(false);
  assert.equal(h.obs.disconnected, 1, 'observer gone with the session');
  h.obs.trigger();
  assert.equal(h.opened.length, 1, 'a late callback cannot reopen anything');
  const h2 = playerHarness({ show: { id: 'feed-13' } }, false);
  h2.arm(true);
  assert.equal(h2.armed(), false, 'a title that is not built yet arms nothing');
  const h3 = playerHarness({ show: { id: 'feed-13' } }, true, null, true);
  h3.arm(true);
  assert.equal(h3.armed(), true, 'no MutationObserver is not a fatal case');
  h3.node.fire('click', h3.ev());
  assert.equal(h3.opened.length, 1, 'click entry works without the observer');
  h3.arm(false);
  assert.equal(h3.armed(), false, 'and disarming is clean');
});

test('C: releasing the chrome hands Music back the row it had', () => {
  const h = playerHarness({ show: { id: 'feed-14' }, episode: { id: 'ep-14' } });
  h.node.setAttribute('role', 'button');
  h.node.setAttribute('tabindex', '0');
  h.node.setAttribute('title', 'دفترچه موسیقی');
  h.node.setAttribute('aria-label', 'Track — دفترچه موسیقی');
  h.arm(true);
  assert.equal(h.node.attrs.title, 'Open Podcast · پادکست', 'borrowed while the Podcast owns the session');
  h.arm(false);
  assert.deepEqual(
    ['role', 'tabindex', 'title', 'aria-label'].map((a) => h.node.attrs[a]),
    ['button', '0', 'دفترچه موسیقی', 'Track — دفترچه موسیقی'],
    'Music\'s own artwork-button attributes come back verbatim');
  /* and a row Music never buttoned is returned bare, not half-styled */
  const h2 = playerHarness({ show: { id: 'feed-15' } });
  h2.arm(true);
  h2.arm(false);
  assert.deepEqual(Object.keys(h2.node.attrs), [], 'nothing is left behind');
});

/* ===== D4 — resuming the current episode closes the window like a new start =====
   Measured in real Chrome (ux5b.log, 74/76): both round-5 failures were "the
   reopened window did not auto-close on resume", because the current-episode
   branch called P.toggle() and returned before any waiter was armed. The shipped
   row click handler is lifted verbatim and run against the shipped auto-close
   machinery, so a press drives the real code, not a copy of it. */

const ROW_CLICK = block(WIN,
  "play.addEventListener('click', function () {",
  'if (res.ok) { closeWhenPlaying(P, ep); }') + '\n      });';

function rowHarness(state, playRes, noPlayer) {
  const presses = [];
  const closed = [];
  const listeners = {};
  const timers = [];
  let handler = null;
  let st = state;
  const ctx = vm.createContext({
    play: { addEventListener: function (n, f) { handler = f; } },
    ep: { id: 'ep-7', title: 'Seven' },
    sh: { id: 'feed-7', title: 'Show seven', feedUrl: 'https://feeds.example.org/s7.xml' },
    playNote: { textContent: '', hidden: true },
    window: {
      dispatchEvent: function () {},
      addEventListener: function (n, f) { (listeners[n] = listeners[n] || []).push(f); },
      removeEventListener: function (n, f) {
        const a = listeners[n] || []; const i = a.indexOf(f); if (i >= 0) { a.splice(i, 1); }
      },
      VoidPodcastPlayer: noPlayer ? undefined : {
        getState: function () { return st; },
        play: function () { presses.push('play'); return playRes || { ok: true }; },
        toggle: function () { presses.push('toggle'); },
        stop: function () { presses.push('stop'); },
        pause: function () { presses.push('pause'); }
      }
    },
    CustomEvent: function () {},
    setTimeout: function (f, ms) { const t = { f: f, ms: ms, cleared: false }; timers.push(t); return t; },
    clearTimeout: function (t) { if (t) { t.cleared = true; } },
    AUTO_CLOSE_MS: 8000
  });
  /* close() without the DOM teardown, but with the same first statement. */
  ctx.close = function () { closed.push(1); vm.runInContext('cancelAutoClose()', ctx); };
  vm.runInContext(
    'var autoClose = null;\n' +
    fn(WIN, 'cancelAutoClose') + '\n' +
    fn(WIN, 'closeWhenPlaying') + '\n' +
    'var __arms = [];\nvar __realArm = closeWhenPlaying;\n' +
    'closeWhenPlaying = function (P, e) { __arms.push(e.id); __realArm(P, e); };\n' +
    ROW_CLICK,
    ctx, { filename: 'row-click-extract' }
  );
  return {
    press: function (nextState) { if (nextState) { st = nextState; } handler(); },
    arms: () => Array.prototype.slice.call(vm.runInContext('__arms', ctx)),
    presses: presses, closed: closed, timers: timers,
    note: ctx.playNote,
    waiters: () => (listeners['podcast:playing'] || []).length,
    fire: (detail) => (listeners['podcast:playing'] || []).slice().forEach((f) => f({ detail: detail }))
  };
}

const CUR_PAUSED = { active: true, episodeId: 'ep-7', playing: false };
const CUR_PLAYING = { active: true, episodeId: 'ep-7', playing: true };
const OTHER = { active: true, episodeId: 'ep-6', playing: true };

test('D4: resuming the current episode arms the same waiter and closes on playback', () => {
  const h = rowHarness(CUR_PAUSED);
  h.press();
  assert.deepEqual(h.presses, ['toggle'], 'resumes through the existing player, no second play()');
  assert.deepEqual(h.arms(), ['ep-7'], 'the resume path arms the close');
  assert.equal(h.waiters(), 1, 'one player listener registered');
  assert.equal(h.closed.length, 0, 'still open: audio has not started yet');
  h.fire({ playing: true, episodeId: 'ep-7' });
  assert.equal(h.closed.length, 1, 'the window closes when the player reports it playing');
  assert.equal(h.waiters(), 0, 'waiter removed once it fires');
  assert.deepEqual(h.presses, ['toggle'], 'closing never stops or pauses the audio');
});

test('D4: pausing must not close, and the arm precedes toggle() in source', () => {
  const h = rowHarness(CUR_PLAYING);
  h.press();
  assert.deepEqual(h.presses, ['toggle'], 'the row toggled');
  assert.deepEqual(h.arms(), [], 'a pause arms nothing');
  assert.equal(h.waiters(), 0, 'no listener registered on a pause');
  h.fire({ playing: false, episodeId: 'ep-7' });
  assert.equal(h.closed.length, 0, 'the pause event itself closes nothing');
  const branch = block(WIN, 'if (st.active && st.episodeId === ep.id) {', 'P.toggle();');
  assert.ok(branch.indexOf('closeWhenPlaying') < branch.indexOf('P.toggle()'),
    'armed first, so a start that fires synchronously cannot be missed');
  assert.match(branch, /if \(!st\.playing\) \{ closeWhenPlaying\(P, ep\); \}/, 'only a stopped row arms');
});

test('D4: repeated presses leave one waiter and no stale timer', () => {
  const h = rowHarness(CUR_PAUSED);
  h.press();                                   /* resume → arms */
  h.press(CUR_PLAYING);                        /* pause → must not arm again */
  h.press(CUR_PAUSED);                         /* resume → replaces, never stacks */
  assert.deepEqual(h.arms(), ['ep-7', 'ep-7'], 'armed once per resume, never on the pause');
  assert.equal(h.waiters(), 1, 'exactly one podcast:playing listener exists');
  assert.equal(h.timers.length, 2, 'each arm carried its own bounded wait');
  assert.equal(h.timers.filter((t) => t.cleared).length, 1, 'the superseded wait is cancelled, the live one stays pending');
  h.fire({ playing: true, episodeId: 'ep-7' });
  assert.equal(h.closed.length, 1, 'one close, not one per press');
  assert.equal(h.timers.filter((t) => t.cleared).length, 2, 'and closing cancels the remaining timer too');
  h.fire({ playing: true, episodeId: 'ep-7' });
  assert.equal(h.closed.length, 1, 'a repeat event cannot close it twice');
});

test('D4: a blocked, rejected or placeholder start leaves the window open', () => {
  const rejected = rowHarness(OTHER, { ok: false, reason: 'no-source' });
  rejected.press();
  assert.deepEqual(rejected.presses, ['play'], 'a different episode still goes through play()');
  assert.deepEqual(rejected.arms(), [], 'a rejected start arms nothing');
  assert.equal(rejected.note.hidden, false, 'the failure note is shown instead');

  const blocked = rowHarness(CUR_PAUSED);
  blocked.press();                             /* armed for the resume */
  blocked.fire({ playing: false, episodeId: 'ep-7' });
  assert.equal(blocked.closed.length, 0, 'a blocked resume stays open');
  blocked.timers[0].f();                       /* the 8s bound expires */
  assert.equal(blocked.closed.length, 0, 'expiry does not close it either');
  assert.equal(blocked.waiters(), 0, 'expiry unregisters the waiter');

  const noPlayer = rowHarness(OTHER, null, true);
  noPlayer.press();
  assert.deepEqual(noPlayer.arms(), [], 'the placeholder note path never arms a close');
  assert.equal(noPlayer.closed.length, 0, 'and never closes the window');
});

test('D4: the new-episode path is unchanged and one press arms once', () => {
  const h = rowHarness(OTHER);
  h.press();
  assert.deepEqual(h.presses, ['play'], 'a new episode goes through play()');
  assert.deepEqual(h.arms(), ['ep-7'], 'armed once');
  h.fire({ playing: true, episodeId: 'ep-6' });
  assert.equal(h.closed.length, 0, 'another episode starting does not close this waiter');
  h.fire({ playing: true, episodeId: 'ep-7' });
  assert.equal(h.closed.length, 1, 'this episode starting does');
  /* the search route predates this fix and was deliberately left alone */
  const search = block(WIN, 'function playFromSearch', 'P.play(hit.ep, hit.show);');
  assert.doesNotMatch(search, /closeWhenPlaying|close\(\)/, 'a search press still never auto-closes');
});

/* ===== D3 — the popover lands where it is drawn, on the first frame =====
   Measured in real Chrome: the released code wrote the same
   left:541.32px; top:301.68px through the whole 60/260/520ms settle window, and
   that box painted at viewport (0,0) until the compositor caught up, so Follow
   was not clickable where it was drawn for roughly a second. */

function rect(x, y, w, h) {
  return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h };
}
function placeHarness(o) {
  o = o || {};
  const dr = o.dr || rect(420, 244, 440, 312);
  const br = o.br || rect(700, 300, 24, 24);
  const dlg = {
    getBoundingClientRect: function () { return dr; },
    scrollLeft: o.scrollLeft || 0, scrollTop: o.scrollTop || 0
  };
  const pop = { hidden: false, offsetWidth: o.w || 264, offsetHeight: o.h || 165, style: {} };
  const ctx = vm.createContext({
    dialog: dlg, sharePop: pop, sharePopBtn: { getBoundingClientRect: function () { return br; } },
    window: { innerWidth: o.vw || 1280, innerHeight: o.vh || 800 }
  });
  vm.runInContext(fn(WIN, 'sharePopPlace') + '\nsharePopPlace();', ctx, { filename: 'shareplace-extract' });
  const left = parseFloat(pop.style.left), top = parseFloat(pop.style.top);
  return {
    left: left, top: top, style: pop.style, pop: pop, dr: dr, br: br,
    /* what Chrome paints once the dialog box is the containing block */
    viewLeft: dr.left - (o.scrollLeft || 0) + left,
    viewTop: dr.top - (o.scrollTop || 0) + top
  };
}

test('D3: placement is dialog-local and paints at the intended viewport spot', () => {
  const h = placeHarness({});
  assert.equal(h.viewLeft, 460, 'right-aligned inside the card (700 + 24 - 264)');
  assert.equal(h.viewTop, 330, '6px under the Share button');
  assert.equal(h.left, 40, 'dialog-local coordinates, not viewport ones');
  assert.equal(h.top, 86, 'dialog-local coordinates, not viewport ones');
  assert.equal(h.style.maxWidth, '420px', 'the card box drives the width clamp');
  assert.ok(h.viewLeft >= h.dr.left && h.viewLeft + h.pop.offsetWidth <= h.dr.right,
    'fully inside the card that clips it');
  assert.ok(h.viewTop >= h.dr.top && h.viewTop + h.pop.offsetHeight <= h.dr.bottom, 'and vertically too');
});

test('D3: the same layout anywhere on screen yields the same local box', () => {
  const a = placeHarness({});
  const b = placeHarness({ dr: rect(620, 364, 440, 312), br: rect(900, 420, 24, 24) });
  assert.equal(b.left, a.left, 'dialog moved 200px right, 120px down: local left unchanged');
  assert.equal(b.top, a.top, 'local top unchanged');
  assert.equal(b.viewLeft, 660, 'it renders with the dialog, not where a probe once read it');
  assert.equal(b.viewTop, 450, 'no viewport-absolute residue');
  const scrolled = placeHarness({ scrollTop: 40 });
  assert.equal(scrolled.top, a.top + 40, 'a scrolled dialog is compensated, so the box rides the card');
  assert.equal(scrolled.viewTop, a.viewTop, 'and painting stays put');
});

test('D3: it stays inside the card at flip, narrow and short geometries', () => {
  const flip = placeHarness({ br: rect(700, 520, 24, 24) });
  assert.equal(flip.viewTop, 520 - 6 - 165, 'flips above a button near the card bottom');
  assert.ok(flip.viewTop + flip.pop.offsetHeight <= flip.dr.bottom, 'still inside the card');
  const narrow = placeHarness({ dr: rect(20, 100, 220, 312), br: rect(180, 140, 24, 24), w: 200 });
  assert.ok(narrow.viewLeft >= 30 && narrow.viewLeft + 200 <= 240, 'clamped inside a 220px card');
  const low = placeHarness({ dr: rect(420, 480, 440, 312), br: rect(700, 660, 24, 24), vh: 700 });
  assert.equal(low.viewTop, 490, 'the visible part of the card bounds it, not the card that overflows');
  assert.ok(low.viewTop + low.pop.offsetHeight <= 700 - 10, 'kept on screen when the viewport is tighter');
  assert.equal(low.left, 40, 'the horizontal clamp does not move with the vertical one');
  const collapsed = placeHarness({ dr: rect(420, 244, 10, 10) });
  assert.equal(collapsed.style.left, undefined, 'a transiently collapsed card is not placed against');
});

test('D3: no probe pass, no timers, no polling — one synchronous placement', () => {
  const place = fn(WIN, 'sharePopPlace');
  assert.doesNotMatch(place, /offsetParent/, 'the containing block is known, not guessed');
  assert.doesNotMatch(place, /style\.left = '0px'|style\.top = '0px'/, 'no self-measuring probe');
  for (const name of ['setTimeout', 'setInterval', 'requestAnimationFrame']) {
    assert.doesNotMatch(place, new RegExp(name), name + ' does not belong in placement');
  }
  assert.equal(occurrences(WIN, 'sharePopSettle'), 0, 'the settle retries are gone');
  assert.equal(occurrences(WIN, 'sharePopScheduleSettle'), 0, 'their call site too');
  assert.equal(occurrences(WIN, 'sharePopTimers'), 0, 'no timer bookkeeping left');
  assert.equal(occurrences(WIN, 'setInterval'), 0, 'no polling loop was introduced');
  assert.equal(occurrences(WIN, 'requestAnimationFrame'), 1, 'the one rAF is the pre-existing scroll/resize watcher');
  const open = fn(WIN, 'sharePopOpen');
  assert.equal(occurrences(open, 'sharePopPlace()'), 2, 'placed before the reveal and again after focus settles');
  assert.equal(occurrences(WIN, 'sharePop.style.visibility'), 0,
    'no hide-while-measuring: the un-hide was a transition that held the popover hidden for a frame');
});

test('D3: the popover is a positioned child of the dialog, styled exactly as before', () => {
  const css = read('podcast-window.css');
  const rule = css.match(/\.pw__sharepop \{([\s\S]*?)\}/);
  assert.ok(rule, 'the rule exists');
  const decls = rule[1].replace(/\/\*[\s\S]*?\*\//g, '');   /* the comment names the old mode on purpose */
  assert.match(decls, /position: absolute/, 'the dialog box is the containing block, frame after frame');
  assert.doesNotMatch(decls, /position: fixed/, 'the mode that let Chrome re-base the coordinates is gone');
  assert.match(decls, /max-width: calc\(100% - 16px\)/, 'responsive to the card, not to the viewport');
  assert.doesNotMatch(css, /\.pw__sharepop[^{]*\{[^}]*animation:/, 'the popover itself is not animated');
  assert.match(css, /#void-podcast-modal \.pw__sharepop \{ transition: none !important; \}/,
    'and it is not transitioned either, whatever html.void-lowfx * forces on every element');
  const headCss = execFileSync('git', ['-C', ROOT, 'show', 'HEAD:podcast-window.css'], { encoding: 'utf8' })
    .replace(/\r\n/g, '\n');
  const headRule = headCss.match(/\.pw__sharepop \{([\s\S]*?)\}/)[1];
  for (const decl of ['z-index: 2147483000', 'width: 264px', 'padding: 10px 12px 4px',
    'border-radius: 12px', 'backdrop-filter: blur(14px)']) {
    assert.ok(headRule.indexOf(decl) >= 0 && rule[1].indexOf(decl) >= 0, decl + ' kept — the design is unchanged');
  }
  const headJs = execFileSync('git', ['-C', ROOT, 'show', 'HEAD:podcast-window.js'], { encoding: 'utf8' })
    .replace(/\r\n/g, '\n');
  /* What this fix must not have touched: the sharing targets themselves. */
  for (const [sig, what] of [
    ["'https://wa.me/?text='", 'WhatsApp intent'],
    ["'https://t.me/share/url?url='", 'Telegram intent'],
    ['shareCopy(ep.audioUrl, copyB)', 'the Copy link row']
  ]) {
    assert.ok(WIN.indexOf(sig) >= 0 && headJs.indexOf(sig) >= 0, what + ' survives this fix byte-identical');
  }
  assert.ok(WIN.indexOf('shareCopy(followLink(followUrl), followB)') >= 0, 'the Follow prefill row is preserved');
  assert.ok(WIN.indexOf('https://x.com/intent/tweet?text=') >= 0, 'X still shares through the approved intent host');
  assert.ok(headJs.indexOf('https://x.com/intent/tweet?text=') >= 0,
    'the existing X host remains unchanged');
});
