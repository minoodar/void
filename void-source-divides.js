/* Void · The Source Divides — host-agnostic waiting/hand-off controller.
   No network, no storage. Hooks are injected by the host (void-domains.js).
   Chromium 70 safe: no ?. no ?? no replaceAll, no Animation.finished. */
(function (g) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', ORDER = ['inner', 'flow', 'beyond'];
  var STAR = { inner: '#E1E5FF', flow: '#D7FBF6', beyond: '#FFF1CE' };
  function mk(n, a) { var e = document.createElementNS(NS, n), k; for (k in a) { e.setAttribute(k, a[k]); } return e; }

  function create(o) {
    o = o || {};
    var labels = o.labels || { wait: 'Gathering the three…', long: 'Still gathering…', error: '' };
    var st = 'idle', timers = [], svg, root, halo, ring, glow, pt, drift, dot, beads = {}, note, geo = null, onVis;

    function later(f, ms) { var t = setTimeout(f, ms); timers.push(t); return t; }
    function clearT() { timers.forEach(clearTimeout); timers = []; }
    function reduced() { return !!(o.reduced ? o.reduced() : (g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches)); }
    function isActive() { try { return !!(o.isActive && o.isActive()); } catch (e) { return false; } }
    function say(t, on) { note.textContent = t || ''; note.className = 'sd-note' + (on && t ? ' is-on' : ''); }

    function build() {
      if (svg) { return; }
      svg = mk('svg', { 'class': 'sd', 'aria-hidden': 'true', focusable: 'false' });
      var defs = mk('defs', {}), rg = mk('radialGradient', { id: 'sd-grad' });
      rg.appendChild(mk('stop', { offset: '0', 'stop-color': '#E8C46A', 'stop-opacity': '.35' }));
      rg.appendChild(mk('stop', { offset: '1', 'stop-color': '#E8C46A', 'stop-opacity': '0' }));
      defs.appendChild(rg); svg.appendChild(defs);
      root = mk('g', {}); halo = mk('circle', { 'class': 'sd-halo' }); ring = mk('circle', { 'class': 'sd-ring' });
      glow = mk('circle', { 'class': 'sd-glow' }); pt = mk('circle', { 'class': 'sd-pt', r: 2.2 });
      drift = mk('g', { 'class': 'sd-drift' }); dot = mk('circle', { r: 2 }); drift.appendChild(dot);
      root.appendChild(glow); root.appendChild(halo); root.appendChild(ring); root.appendChild(drift); root.appendChild(pt);
      ORDER.forEach(function (id) { beads[id] = mk('circle', { 'class': 'sd-bead', r: 2.6 }); beads[id].style.fill = STAR[id]; root.appendChild(beads[id]); });
      svg.appendChild(root);
      note = document.createElement('div'); note.className = 'sd-note'; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
      var parent = (o.parent && o.parent()) || document.body;
      parent.appendChild(svg); parent.appendChild(note);
      onVis = function () { svg.setAttribute('class', svg.getAttribute('class').replace(' sd-paused', '') + (document.hidden ? ' sd-paused' : '')); };
      document.addEventListener('visibilitychange', onVis);
      g.addEventListener('resize', function () {
        if (st === 'idle') { return; }
        place();
        /* the visualizer re-measures ~120 ms after resize; follow its final orb */
        later(function () { if (st !== 'idle') { place(); } }, 180);
      });
    }
    function cls(add, rem) {
      var c = (svg.getAttribute('class') || '').split(' ').filter(function (x) { return x && (rem || []).indexOf(x) < 0; });
      (add || []).forEach(function (x) { if (c.indexOf(x) < 0) { c.push(x); } });
      svg.setAttribute('class', c.join(' '));
    }
    function place() {
      var v = o.getVoid(), rr = (v.hole > 0 ? v.hole : v.glow) + 8, circ = 2 * Math.PI * rr, a = geo ? geo.a : -90;
      geo = { cx: v.cx, cy: v.cy, rr: rr, circ: circ, a: a };
      root.setAttribute('transform', 'translate(' + v.cx + ' ' + v.cy + ')');
      [halo, ring].forEach(function (c) { c.setAttribute('r', rr); });
      glow.setAttribute('r', rr * 1.7);
      ring.style.strokeDasharray = circ + 'px';
      ring.setAttribute('transform', 'rotate(' + a + ')');
      svg.style.setProperty('--sd-gap', (circ * 0.07) + 'px');
      if (st === 'ignite') { ring.style.strokeDashoffset = circ + 'px'; }
      pt.setAttribute('cx', rr * Math.cos(a * Math.PI / 180)); pt.setAttribute('cy', rr * Math.sin(a * Math.PI / 180));
      dot.setAttribute('cx', rr); dot.setAttribute('cy', 0);
      drift.style.setProperty('--sd-a0', a + 'deg');
      note.style.left = v.cx + 'px'; note.style.top = (v.cy + rr + 26) + 'px'; note.style.transform = 'translate(-50%,0)';
    }

    /* start(originEl): call at the click, same tick as the request begins. */
    function start(originEl) {
      build(); clearT();
      var v = o.getVoid(), ang = -90;
      if (originEl && originEl.getBoundingClientRect) {
        var b = originEl.getBoundingClientRect();
        ang = Math.atan2(b.top + b.height / 2 - v.cy, b.left + b.width / 2 - v.cx) * 180 / Math.PI;
      }
      geo = { a: ang }; st = 'ignite';
      svg.setAttribute('class', 'sd sd-on ' + (isActive() ? 'sd-active' : 'sd-dormant') + (reduced() ? ' sd-rm' : ''));
      say('', false); place();
      ring.style.transition = 'none'; ring.style.strokeDashoffset = geo.circ + 'px'; void ring.getBoundingClientRect(); ring.style.transition = '';
      ORDER.forEach(function (id) { beads[id].style.transition = 'none'; });
      later(function () {                                   // RING (skipped if the data already arrived)
        if (st !== 'ignite') { return; }
        st = 'ring'; cls(['sd-ringon']); ring.style.strokeDashoffset = '0px';
      }, 120);
      later(function () { if (st === 'ring') { st = 'wait'; cls(['sd-wait']); } }, 620);
      later(function () { if (st === 'wait') { say(labels.wait, true); } }, 2500);
      later(function () { if (st === 'wait') { cls(['sd-long']); say(labels.long, true); } }, 12000);  // slows down, NEVER fails by itself
    }

    function hide(ms) {
      later(function () { clearT(); st = 'idle'; if (svg) { svg.setAttribute('class', 'sd'); } say('', false); }, ms || 0);
    }

    /* reveal(centers, done, onLand): centers = {inner:{x,y},flow:{x,y},beyond:{x,y}} in viewport px,
       taken from the REAL constellation layout. Starts from whatever phase we are in.
       onLand fires when the first bead reaches its destination — the host emerges the emblems then. */
    function reveal(centers, done, onLand) {
      if (st === 'idle' || st === 'divide') { if (onLand) { onLand(); } if (done) { done(); } return; }
      clearT(); st = 'divide'; say('', false);
      if (reduced() || !centers) {
        if (onLand) { onLand(); }
        cls(['sd-out']); later(function () { st = 'idle'; svg.setAttribute('class', 'sd'); if (done) { done(); } }, 380); return;
      }
      ORDER.forEach(function (id, i) {
        var d = centers[id], dx = d.x - geo.cx, dy = d.y - geo.cy, ang = Math.atan2(dy, dx);
        var sx = geo.rr * Math.cos(ang), sy = geo.rr * Math.sin(ang), b = beads[id];
        b.style.transition = 'none'; b.setAttribute('class', 'sd-bead'); b.style.transform = 'translate(' + sx + 'px,' + sy + 'px)';
        void b.getBoundingClientRect();
        var delay = [0, 140, 226][i];
        b.style.transition = ''; b.style.transitionDelay = delay + 'ms,' + delay + 'ms';
        later(function () { b.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; }, 0);
        later(function () { b.setAttribute('class', 'sd-bead sd-land'); b.style.transitionDelay = '0ms'; }, 480 + delay - 60);
      });
      cls(['sd-divide']);
      later(function () { if (onLand) { onLand(); } }, 420);
      later(function () { st = 'idle'; svg.setAttribute('class', 'sd'); if (done) { done(); } }, 480 + 226 + 300);
    }

    /* fail(): the existing error path stays in charge; this only closes the ring gracefully. */
    function fail() {
      if (st === 'idle') { return; }
      clearT(); st = 'error'; cls(['sd-error']); say(labels.error, true); hide(1100);
    }
    function cancel() { clearT(); st = 'idle'; if (svg) { svg.setAttribute('class', 'sd'); say('', false); } }

    return { start: start, reveal: reveal, fail: fail, cancel: cancel, state: function () { return st; } };
  }
  g.VoidSourceDivides = { create: create };
})(window);