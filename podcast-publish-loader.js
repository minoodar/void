/* Podcast Galaxy Publishing — Phase 1 UI preview: entry point.
 *
 * LOCAL-ONLY GATE. This file is the only preview code that index.html loads,
 * and it does nothing at all unless BOTH conditions hold:
 *
 *   1. the URL carries ?publishPreview=1
 *   2. the page is served from a loopback origin (or opened from disk)
 *
 * So the documented way to see the preview is
 *
 *   http://127.0.0.1:8765/index.html?publishPreview=1
 *
 * and a publication link shared inside the preview looks like
 *
 *   http://127.0.0.1:8765/index.html?publishPreview=1&signal=<publication-id>
 *
 * On the deployed site the flag is ignored and nothing is fetched: no CSS, no
 * JS, no dialog, no chip in the nav. The normal production experience is
 * byte-for-byte what it was before this file existed.
 *
 * The preview is independent of the podcast feature flag: ?podcast=0 still
 * shows it, because publishing is its own surface. What the Podcast window
 * gains is a Publish action on each show and each episode, added by that
 * window only when this module is present.
 *
 * Chromium-70 / Android TV safe: ES5 syntax only.
 */
(function (G) {
  'use strict';

  var VERSION = '20261123a';
  var FLAG = 'publishPreview';

  function enabled() {
    var search = String(G.location && G.location.search || '');
    /* ?publishPreview=1 is the documented form; =on/true are accepted so a
       hand-typed URL does not silently do nothing. */
    var flag = /[?&]publishPreview=(1|true|on)(&|$)/.test(search);
    if (!flag) { return false; }
    var host = String(G.location && G.location.hostname || '');
    var local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
      || host === '0.0.0.0' || host === '' || /^\[?::1\]?$/.test(host);
    return local;
  }

  if (!enabled()) { return; }
  G.__VOID_PUBLISH_PREVIEW__ = true;

  var files = ['podcast-publish.css', 'podcast-publish-mock.js', 'podcast-publish-ui.js', 'podcast-publish-signals.js'];

  function asset(name, done, fail) {
    var isCss = /\.css$/.test(name);
    var node = document.createElement(isCss ? 'link' : 'script');
    if (isCss) {
      node.rel = 'stylesheet';
      node.href = name + '?v=' + VERSION;
    } else {
      node.src = name + '?v=' + VERSION;
    }
    node.onload = function () { done(); };
    node.onerror = function () { fail(new Error('preview asset failed: ' + name)); };
    document.head.appendChild(node);
  }

  /* Sequential on purpose: the UI reads the mock module and the signals module
     reads the API the loader builds, so order matters under file:// too. */
  function loadAll(i) {
    if (i >= files.length) { boot(); return; }
    asset(files[i], function () { loadAll(i + 1); }, function (err) {
      if (G.console && G.console.warn) { G.console.warn(err.message); }
    });
  }

  function storage() {
    /* The preview persists its own three lists under one namespaced key. The
       Podcast store keys (void.podcast.v1, void.podcast.saved.v1) are never
       read or written from here. */
    try {
      if (!G.localStorage) { return null; }
      var probe = 'void.publishPreview.probe';
      G.localStorage.setItem(probe, '1');
      G.localStorage.removeItem(probe);
      return {
        getItem: function (k) { try { return G.localStorage.getItem(k); } catch (e) { return null; } },
        setItem: function (k, v) { try { G.localStorage.setItem(k, v); } catch (e) { /* quota */ } }
      };
    } catch (e) { return null; }
  }

  function boot() {
    var Mock = G.VoidPodcastPublishMock, UI = G.VoidPodcastPublishUI, Signals = G.VoidPodcastPublishSignals;
    if (!Mock || !UI) {
      if (G.console && G.console.warn) { G.console.warn('publishing preview incomplete'); }
      return;
    }
    var api = Mock.createApi({ storage: storage() });
    var ui = UI.create({ api: api, mock: Mock });
    ui.mountChip();
    if (Signals) { Signals.mount(); }

    /* One global for the app's two hook calls in podcast-window.js and for
       probing: the instance, with the adapter reachable through it. */
    ui.api = api;
    ui.signals = Signals || null;
    G.VoidPodcastPublishPreview = ui;

    /* A shared publication link opens that publication, once, on boot. */
    var id = ui.deepLinkTarget();
    if (id) { ui.openDetail(id); }

    if (G.console && G.console.info) {
      G.console.info('[void] publishing preview ON — local only, no network, nothing published. ' +
        'Chip: “Galaxy publishing preview”. Publication links: ?publishPreview=1&signal=<id>');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { loadAll(0); }, { once: true });
  } else {
    loadAll(0);
  }
})(typeof window !== 'undefined' ? window : this);
