/* Podcast Galaxy Publishing — Phase 1 UI preview: ambient signals.
 *
 * LOCAL PREVIEW ONLY. This is the quiet part of the product: a new Show or
 * Episode that entered the Galaxy leaves a brief mark in the field, and that
 * is all. It is deliberately NOT a feed, not a timeline, not a leaderboard and
 * not a permanent constellation node, and it never renders a count of anything.
 *
 * How it stays cheap and honest:
 *   - at most three marks are alive at once, oldest leaves first;
 *   - the motion is one CSS animation per mark, so there is no second
 *     requestAnimationFrame loop next to the visualizer's own;
 *   - a mark is removed by its own timeout and never accumulates;
 *   - prefers-reduced-motion turns the marks steady instead of animated;
 *   - marks are aria-hidden and decorative: the words a screen reader gets are
 *     the ones in the panel, not these.
 *
 * Positions come from the publication id, so the same publication lands in the
 * same place on every reload, while nothing about the layout is meaningful data
 * (no position encodes popularity, recency is shown by which mark is newest).
 *
 * Chromium-70 / Android TV safe: ES5 syntax only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.VoidPodcastPublishSignals = factory(); }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var MAX = 3;            /* approved cap: never more than three at once */
  var LIFE = 7000;        /* must match the CSS animation length */
  var LAYER_ID = 'vgp-signals';

  function reduceMotion() {
    if (!window.matchMedia) { return false; }
    try { return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  /* 32-bit FNV-1a, the same construction the store uses for feed ids: stable,
     tiny, and only used here to spread marks around. */
  function hash(str) {
    var h = 2166136261, i;
    for (i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  /* A band that keeps clear of the nav rail at the top and the player chrome at
     the bottom. Two independent values from one hash. */
  function place(id) {
    var h = hash(id);
    return {
      left: 16 + (h % 68),
      top: 26 + (Math.floor(h / 68) % 40)
    };
  }
  function kindWord(pub) {
    return pub.kind === 'show' ? 'new show' : 'new episode';
  }

  function create() {
    var layer = null, alive = [], pageMode = false;

    function host() {
      var root = document.getElementById('void-music-root');
      var inRoot = !!(root && !root.hidden);
      if (layer && pageMode === !inRoot) { return layer; }
      if (layer && layer.parentNode) { layer.parentNode.removeChild(layer); }
      layer = document.createElement('div');
      layer.id = LAYER_ID;
      layer.setAttribute('aria-hidden', 'true');
      pageMode = !inRoot;
      if (pageMode) { layer.className = 'vgp-signals--page'; }
      (inRoot ? root : document.body).appendChild(layer);
      return layer;
    }

    function drop(node) {
      for (var i = 0; i < alive.length; i++) {
        if (alive[i].node === node) {
          alive.splice(i, 1);
          break;
        }
      }
      if (node && node.parentNode) { node.parentNode.removeChild(node); }
    }

    function clearAll() {
      var list = alive.slice(), i;
      alive.length = 0;
      for (i = 0; i < list.length; i++) {
        if (list[i].timer) { clearTimeout(list[i].timer); }
        if (list[i].node && list[i].node.parentNode) { list[i].node.parentNode.removeChild(list[i].node); }
      }
      if (layer && layer.parentNode) { layer.parentNode.removeChild(layer); }
      layer = null;
    }

    /* One mark. The oldest yields when the field is full, so the cap is real
       without a queue growing behind it. */
    function mark(pub) {
      if (!pub || !pub.id) { return null; }
      var field = host();
      if (alive.length >= MAX) { drop(alive[0].node); }
      var at = place(pub.id);
      var box = document.createElement('div');
      box.className = 'vgp-sig';
      box.style.left = at.left + '%';
      box.style.top = at.top + '%';
      var dot = document.createElement('span');
      dot.className = 'vgp-sig__dot';
      var label = document.createElement('span');
      label.className = 'vgp-sig__label';
      label.textContent = kindWord(pub);
      box.appendChild(dot);
      box.appendChild(label);
      field.appendChild(box);
      var entry = { id: pub.id, node: box, timer: 0 };
      entry.timer = setTimeout(function () { drop(box); }, LIFE);
      alive.push(entry);
      return box;
    }

    /* Mark the newest few that a caller just learned about. Called by the chip
       and by the panel button, never on a timer of its own. */
    function pulse(api) {
      if (!api || typeof api.list !== 'function') { return 0; }
      return api.list().then(function (res) {
        var pubs = res.publications || [], n = 0, i;
        for (i = 0; i < pubs.length && n < MAX; i++) {
          if (pubs[i].status === 'active') { mark(pubs[i]); n++; }
        }
        return n;
      });
    }

    return {
      MAX: MAX,
      LIFE: LIFE,
      mount: function () { host(); },
      mark: mark,
      pulse: pulse,
      live: function () { return alive.length; },
      reduceMotion: reduceMotion,
      clear: clearAll
    };
  }

  var singleton = null;
  function instance() {
    if (!singleton) { singleton = create(); }
    return singleton;
  }

  return {
    create: create,
    /* The loader calls these; the UI only ever asks for a pulse. */
    mount: function () { return instance().mount(); },
    mark: function (pub) { return instance().mark(pub); },
    pulse: function (api) { return instance().pulse(api); },
    live: function () { return instance().live(); },
    clear: function () { return instance().clear(); }
  };
});
