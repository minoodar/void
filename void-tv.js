/* ======================================================================
   Void — TV / remote-control layer.
   Loaded from <head> so the environment class exists before first paint.
   Adds no business logic: it only adapts presentation and focus movement,
   and reduces cosmetic effects when the machine cannot hold the frame rate.
   Escapes:  ?voidenv=tv|desktop|mobile|lowfx|off   (testing / kiosk override)
             ?voidperf=off                          (skip the frame sample)
             window.__VOID_ENV / window.__VOID_LOWFX (embedded override)
   ====================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var doc = document;

  function param(name) {
    try { return new URLSearchParams(location.search).get(name) || ''; } catch (e) { return ''; }
  }

  function uaLooksLikeTv() {
    var ua = navigator.userAgent || '';
    return /(Android TV|Google TV|Fire TV|AFT[0-9A-Z]{2,}|CrKey|SmartTV|Smart-TV|SMART-TV|Tizen|Web0S|webOS|NetCast|HbbTV|BRAVIA|Roku|Opera TV|Viera|VIDAA)/i.test(ua);
  }

  function detectTv() {
    var forced = param('voidenv') || window.__VOID_ENV || '';
    if (forced === 'tv') return true;
    if (forced === 'desktop' || forced === 'mobile' || forced === 'off' || forced === 'lowfx') return false;
    if (uaLooksLikeTv()) return true;

    var mm = window.matchMedia;
    if (!mm) return false;
    // A remote exposes no fine pointer. Phones are narrow; touch laptops keep
    // a fine pointer. A wide, effectively pointerless surface is a TV/kiosk.
    var noHover = mm('(hover: none)').matches;
    var coarse = mm('(pointer: coarse)').matches;
    var anyFine = mm('(any-pointer: fine)').matches;
    var touch = navigator.maxTouchPoints || 0;
    if (noHover && coarse && !anyFine && touch <= 1 &&
        window.innerWidth >= 960 && window.innerHeight >= 540) return true;
    return false;
  }

  var tv = detectTv();
  var lowfxForced = param('voidlowfx') === '1' || window.__VOID_LOWFX === true ||
                    param('voidenv') === 'lowfx';
  var lowfx = lowfxForced;
  var perfSkip = param('voidperf') === 'off' || param('voidenv') === 'off';

  if (tv) {
    root.classList.add('void-tv');
    root.setAttribute('data-void-env', 'tv');
  }

  function applyLowfx() {
    if (lowfx) return;
    lowfx = true;
    root.classList.add('void-lowfx');
    try {
      doc.dispatchEvent(new CustomEvent('void:lowfx', { detail: { reason: lowfxReason } }));
    } catch (e) {}
  }

  var lowfxReason = '';
  if (lowfxForced) {
    lowfxReason = 'forced';
    root.classList.add('void-lowfx');
  } else {
    // Capability hints only; the frame sample below confirms on its own.
    var cores = navigator.hardwareConcurrency || 0;
    var mem = navigator.deviceMemory || 0;
    if ((cores && cores <= 2) || (mem && mem <= 2)) {
      lowfxReason = 'capability';
      applyLowfx();
    }
  }

  /* One gentle frame sample after boot. Never repeats, never runs in a hidden
     tab, and tolerates a steady 30 Hz panel. */
  function sampleFrames() {
    if (perfSkip || lowfx || doc.hidden) return;
    var frames = 0, first = 0, last = 0, samples = [];
    function step(now) {
      if (doc.hidden) return;
      if (!first) first = now;
      else samples.push(now - last);
      last = now;
      frames++;
      if (frames < 76) { requestAnimationFrame(step); return; }
      samples.sort(function (a, b) { return a - b; });
      var median = samples[Math.floor(samples.length / 2)] || 16.7;
      var fps = 1000 / median;
      if (fps < 28) {
        lowfxReason = 'frames:' + Math.round(fps);
        applyLowfx();
      }
    }
    requestAnimationFrame(step);
  }

  /* ---- focus utilities (TV only) ---- */
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
                  'select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], ' +
                  '[tabindex]:not([tabindex="-1"])';

  function isEditing(el) {
    if (!el || el === doc.body) return false;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      var t = (el.type || '').toLowerCase();
      return t !== 'checkbox' && t !== 'radio' && t !== 'button' &&
             t !== 'submit' && t !== 'reset';
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function ownsArrows(el) {
    if (!el) return false;
    if (isEditing(el)) return true;
    if (el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'range') return true;
    if (el.getAttribute && el.getAttribute('role') === 'slider') return true;
    return false;
  }

  function effectiveOpacity(el) {
    var o = 1, n = el;
    while (n && n.nodeType === 1) {
      var cs = window.getComputedStyle(n);
      o *= parseFloat(cs.opacity || '1');
      if (o < 0.05) return o;
      n = n.parentElement;
    }
    return o;
  }

  function inViewport(r) {
    return r.bottom > 0 && r.top < window.innerHeight &&
           r.right > 0 && r.left < window.innerWidth;
  }

  function insideScroller(el) {
    var n = el.parentElement;
    while (n && n !== doc.body) {
      var cs = window.getComputedStyle(n);
      var oy = cs.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return true;
      n = n.parentElement;
    }
    return false;
  }

  function reachable(el, allowFade) {
    if (!el || el.disabled) return false;
    if (el.getAttribute && (el.getAttribute('aria-hidden') === 'true' ||
        el.getAttribute('aria-disabled') === 'true')) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (!allowFade && effectiveOpacity(el) < 0.05) return false;
    if (inViewport(r)) return true;
    return insideScroller(el);
  }

  function topDialog() {
    var dialogs = doc.querySelectorAll('dialog[open]');
    return dialogs.length ? dialogs[dialogs.length - 1] : null;
  }

  function activeSurface() {
    var d = topDialog();
    if (d) return d;
    var ids = ['void-god-panel', 'void-galaxy-stats-panel'];
    for (var i = 0; i < ids.length; i++) {
      var p = doc.getElementById(ids[i]);
      if (p && !p.hidden && p.classList.contains('is-on')) return p;
    }
    return null;
  }

  function listFocusables(scope, allowFade) {
    var nodes = (scope || doc).querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (reachable(nodes[i], allowFade)) out.push(nodes[i]);
    }
    return out;
  }

  function centerOf(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  function crossOverlap(dir, a, b) {
    if (dir === 'left' || dir === 'right') {
      return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    }
    return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  }

  function pick(dir, active, scope, allowFade) {
    var list = listFocusables(scope, allowFade);
    if (!list.length) return null;
    var fromRect;
    if (active && active !== doc.body && active.getBoundingClientRect) {
      fromRect = active.getBoundingClientRect();
      if (fromRect.width <= 0 || fromRect.height <= 0) fromRect = null;
    }
    if (!fromRect) {
      if (scope && scope !== doc) fromRect = scope.getBoundingClientRect();
      else fromRect = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    }
    var from = centerOf(fromRect);
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === active) continue;
      var r = el.getBoundingClientRect();
      var c = centerOf(r);
      var dx = c.x - from.x, dy = c.y - from.y;
      var primary, cross;
      if (dir === 'left') { if (dx > -4) continue; primary = -dx; cross = Math.abs(dy); }
      else if (dir === 'right') { if (dx < 4) continue; primary = dx; cross = Math.abs(dy); }
      else if (dir === 'up') { if (dy > -4) continue; primary = -dy; cross = Math.abs(dx); }
      else { if (dy < 4) continue; primary = dy; cross = Math.abs(dx); }
      var score = primary + cross * 1.25 - crossOverlap(dir, fromRect, r) * 0.9;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function focusEl(el) {
    if (!el) return false;
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { return false; } }
    var r = el.getBoundingClientRect();
    if (r.top < 8 || r.bottom > window.innerHeight - 8 ||
        r.left < 8 || r.right > window.innerWidth - 8) {
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e3) {}
    }
    return true;
  }

  function onSpatialKey(e) {
    if (!tv || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    var dir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' :
              e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : '';
    if (!dir) return;
    var active = doc.activeElement;
    if (ownsArrows(active)) return;
    var scope = activeSurface();
    var target = pick(dir, active, scope);
    /* An open panel may still be fading in when the remote's first press lands.
       The trigger sits outside that panel, so a directional press is a request
       to enter the panel, not to look elsewhere. */
    if (!target && scope && !scope.contains(active)) target = pick(dir, active, scope, true);
    if (!target) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    focusEl(target);
  }

  function isRoleButton(el) {
    if (!el || !el.getAttribute) return false;
    var role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'button') return true;
    return el.hasAttribute('tabindex') && !el.matches('button, a[href], input, select, textarea');
  }

  function onActivate(e) {
    if (!tv || e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    var el = doc.activeElement;
    if (!el) return;
    var tag = el.tagName;
    if (tag === 'INPUT') {
      var type = (el.type || '').toLowerCase();
      // Remote Enter must toggle a checkbox/radio: the browser maps Enter to
      // form submission, which the Golden Folder rows do not have.
      if ((type === 'checkbox' || type === 'radio') && e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        try { el.click(); } catch (err) {}
      }
      return;
    }
    if (tag === 'SELECT') return;
    if (e.key === 'Enter' && (tag === 'BUTTON' || (tag === 'A' && el.getAttribute('href')))) {
      // Remote/engine activation is not uniform (WebView and TV Firefox differ
      // on which key event carries the click). Own it here, once.
      e.preventDefault();
      e.stopImmediatePropagation();
      try { el.click(); } catch (err2) {}
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (tag === 'BUTTON' || tag === 'A') return;
    if (isRoleButton(el)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      try { el.click(); } catch (err3) {}
    }
  }

  /* After a remote activation opens a popover, move focus into it so the
     arrow keys can operate its slider/list without a pointer. */
  function followOpenedPop(e) {
    if (!tv) return;
    var t = e.target;
    if (!t || !t.closest || !t.closest('#void-music-root')) return;
    setTimeout(function () {
      var pop = doc.querySelector('.vm-pop.is-open');
      if (!pop || pop.contains(doc.activeElement)) return;
      var f = pop.querySelector('input:not([type="hidden"]), button, [tabindex]:not([tabindex="-1"])');
      if (f) focusEl(f);
    }, 140);
  }

  function escapeEvent() {
    try {
      return new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
        bubbles: true, cancelable: true
      });
    } catch (e) {
      var ev = doc.createEvent('KeyboardEvent');
      ev.initKeyboardEvent('keydown', true, true, window, 'Escape', 27);
      return ev;
    }
  }

  function hasMusicPop() {
    return !!(doc.querySelector('.vm-pop.is-open') ||
              doc.querySelector('.vm-sound-pop.is-open'));
  }

  /* Back closes the top surface and keeps the page. A guard history entry is
     pushed once so an open dialog cannot lose the page (and its audio) to the
     browser's Back. With nothing open, the next Back leaves as usual. */
  function closeTopSurface() {
    var dialog = topDialog();
    if (dialog) {
      var cancel = new Event('cancel', { cancelable: true, bubbles: false });
      var proceed = true;
      try { proceed = dialog.dispatchEvent(cancel); } catch (e) { proceed = true; }
      if (proceed && dialog.open) { try { dialog.close(); } catch (e2) {} }
      return true;
    }
    var ids = ['void-god-panel', 'void-galaxy-stats-panel'];
    for (var i = 0; i < ids.length; i++) {
      var p = doc.getElementById(ids[i]);
      if (p && !p.hidden && p.classList.contains('is-on')) {
        doc.dispatchEvent(escapeEvent());
        return true;
      }
    }
    if (hasMusicPop()) {
      doc.dispatchEvent(escapeEvent());
      return true;
    }
    return false;
  }

  function installBackGuard() {
    if (!tv || !window.history || !window.history.pushState) return;
    try { window.history.pushState({ voidTv: 1 }, ''); } catch (e) { return; }
    window.addEventListener('popstate', function () {
      if (closeTopSurface()) {
        try { window.history.pushState({ voidTv: 1 }, ''); } catch (e) {}
      }
    });
    // Tizen/webOS-style Back key, when the engine reports it.
    window.addEventListener('keydown', function (e) {
      if (e.key === 'GoBack' || e.keyCode === 461 || e.keyCode === 10009) {
        if (closeTopSurface()) e.preventDefault();
      }
    }, true);
  }

  if (tv) {
    window.addEventListener('keydown', onSpatialKey, true);
    window.addEventListener('keydown', onActivate, true);
    doc.addEventListener('click', followOpenedPop, true);
    installBackGuard();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', sampleFrames);
  } else {
    sampleFrames();
  }

  window.VoidTv = {
    tv: tv,
    lowfx: function () { return lowfx; },
    lowfxReason: function () { return lowfxReason; },
    surfaces: function () { var s = activeSurface(); return s ? (s.id || s.className) : null; },
    focusables: function () { return listFocusables(activeSurface()); },
    pick: pick,
    closeTopSurface: closeTopSurface,
    _test: { reachable: reachable, ownsArrows: ownsArrows, detectTv: detectTv }
  };
})();
