/* Void · Domain Emblems — artwork constants (approved reference geometry, v2.3).
   Static trusted markup. Transparent background, no ids, no filters, no gradients, no text.
   Colors, widths and opacities come from domain-constellation.css (.vem tokens). */
(function (global) {
  'use strict';
  var NS = global.VoidDomains = global.VoidDomains || {};
  NS.DOMAIN_ORDER = ['inner', 'flow', 'beyond'];
  NS.DOMAIN_EMBLEMS = {
    inner: {
      id: 'inner', name: 'INNER', nameFa: 'درون', descEn: 'Calm & contemplation', descFa: 'آرامش و تأمل',
      ariaLabel: 'INNER, درون. Calm and contemplation, آرامش و تأمل',
      svg: '<svg class="vem vem-inner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><g class="vem-detail"><circle cx="60" cy="58" r="46" stroke-dasharray="1 5"/><circle class="vem-dot" cx="22" cy="22" r="0.9"/><circle class="vem-dot" cx="100" cy="24" r="0.9"/><circle class="vem-dot" cx="18" cy="98" r="0.9"/><circle class="vem-dot" cx="102" cy="96" r="0.9"/><circle class="vem-dot" cx="60" cy="112" r="0.9"/></g><g class="vem-line"><path d="M13 62 C16.2 58.0 24.2 46.0 32 38 C39.8 30.0 50.7 14.0 60 14 C69.3 14.0 80.2 30.0 88 38 C95.8 46.0 103.8 58.0 107 62"/><path d="M60 90 Q33.9 80.3 13 62"/><path d="M60 90 Q42.5 65.9 32 38"/><path d="M60 90 L60 14"/><path d="M60 90 Q77.5 65.9 88 38"/><path d="M60 90 Q86.1 80.3 107 62"/></g><g class="vem-nodes"><circle class="vem-star" cx="60" cy="14" r="3.2"/><circle class="vem-star" cx="32" cy="38" r="2.5"/><circle class="vem-star" cx="88" cy="38" r="2.5"/><circle class="vem-star" cx="13" cy="62" r="2.3"/><circle class="vem-star" cx="107" cy="62" r="2.3"/><circle class="vem-star" cx="60" cy="90" r="3.0"/><circle class="vem-glow vem-glow-2" cx="60" cy="58" r="12.9"/><circle class="vem-glow vem-glow-1" cx="60" cy="58" r="8.0"/><circle class="vem-star-hi" cx="60" cy="58" r="3.8"/></g><circle class="vem-halo" cx="60" cy="58" r="8"/><circle class="vem-dust vem-dust-a" cx="8" cy="12" r="1.1"/><circle class="vem-dust vem-dust-b" cx="112" cy="20" r="1.1"/><circle class="vem-dust vem-dust-c" cx="6" cy="108" r="1.1"/><circle class="vem-dust vem-dust-d" cx="114" cy="100" r="1.1"/></svg>'
    },
    flow: {
      id: 'flow', name: 'FLOW', nameFa: 'جریان', descEn: 'Rhythm & movement', descFa: 'حرکت و رقص',
      ariaLabel: 'FLOW, جریان. Rhythm and movement, حرکت و رقص',
      svg: '<svg class="vem vem-flow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><g class="vem-detail"><ellipse cx="60" cy="58" rx="54" ry="19" transform="rotate(-28 60 58)"/><circle class="vem-dot" cx="103" cy="38" r="2"/><circle class="vem-dot" cx="14" cy="100" r="0.9"/><circle class="vem-dot" cx="92" cy="106" r="0.9"/><circle class="vem-dot" cx="8" cy="36" r="0.9"/></g><g class="vem-line"><path d="M106 98 C106.8 93.0 112.5 78.0 111 68 C109.5 58.0 104.2 45.8 97 38 C89.8 30.2 77.5 22.5 68 21 C58.5 19.5 47.3 23.8 40 29 C32.7 34.2 25.3 44.2 24 52 C22.7 59.8 26.7 70.3 32 76 C37.3 81.7 48.5 86.5 56 86 C63.5 85.5 74.0 78.5 77 73 C80.0 67.5 76.5 56.5 74 53 C71.5 49.5 64.0 52.2 62 52"/><path d="M40 29 C38.3 27.2 33.7 20.5 30 18 C26.3 15.5 20.0 14.7 18 14"/></g><g class="vem-nodes"><circle class="vem-star" cx="106" cy="98" r="1.7"/><circle class="vem-star" cx="111" cy="68" r="2.2"/><circle class="vem-star" cx="97" cy="38" r="2.6"/><circle class="vem-star" cx="68" cy="21" r="3.0"/><circle class="vem-star" cx="40" cy="29" r="2.5"/><circle class="vem-star" cx="24" cy="52" r="2.9"/><circle class="vem-star" cx="32" cy="76" r="2.3"/><circle class="vem-star" cx="56" cy="86" r="3.0"/><circle class="vem-star" cx="77" cy="73" r="2.4"/><circle class="vem-star" cx="74" cy="53" r="2.1"/><circle class="vem-glow vem-glow-2" cx="62" cy="52" r="12.9"/><circle class="vem-glow vem-glow-1" cx="62" cy="52" r="8.0"/><circle class="vem-star-hi" cx="62" cy="52" r="3.8"/><circle class="vem-star" cx="18" cy="14" r="1.7"/></g><circle class="vem-dust vem-dust-a" cx="8" cy="12" r="1.1"/><circle class="vem-dust vem-dust-b" cx="112" cy="20" r="1.1"/><circle class="vem-dust vem-dust-c" cx="6" cy="108" r="1.1"/><circle class="vem-dust vem-dust-d" cx="114" cy="100" r="1.1"/></svg>'
    },
    beyond: {
      id: 'beyond', name: 'BEYOND', nameFa: 'فراسو', descEn: 'Transcendence & Sama', descFa: 'تعالی و سماع',
      ariaLabel: 'BEYOND, فراسو. Transcendence and Sama, تعالی و سماع',
      svg: '<svg class="vem vem-beyond" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><g class="vem-detail"><path d="M12 78 C10 100 34 116 62 114"/><path d="M12 78 C10 100 34 116 62 114" transform="rotate(180 60 62)"/><circle class="vem-dot" cx="20" cy="20" r="0.9"/><circle class="vem-dot" cx="100" cy="16" r="0.9"/><circle class="vem-dot" cx="106" cy="100" r="0.9"/><circle class="vem-dot" cx="14" cy="108" r="0.9"/></g><g class="vem-line"><path d="M60 106 C56.0 103.8 41.2 99.0 36 93 C30.8 87.0 28.7 77.2 29 70 C29.3 62.8 35.2 57.2 38 50 C40.8 42.8 44.7 30.8 46 27"/><path d="M60 106 C64.5 103.5 81.8 97.7 87 91 C92.2 84.3 92.3 73.8 91 66 C89.7 58.2 83.0 50.8 79 44 C75.0 37.2 69.8 30.8 67 25 C64.2 19.2 62.8 11.7 62 9"/><path d="M60 106 L60 76"/></g><g class="vem-nodes"><circle class="vem-star" cx="36" cy="93" r="2.2"/><circle class="vem-star" cx="29" cy="70" r="2.6"/><circle class="vem-star" cx="38" cy="50" r="2.3"/><circle class="vem-star" cx="46" cy="27" r="2.6"/><circle class="vem-star" cx="87" cy="91" r="2.4"/><circle class="vem-star" cx="91" cy="66" r="2.8"/><circle class="vem-star" cx="79" cy="44" r="2.4"/><circle class="vem-star" cx="67" cy="25" r="2.2"/><circle class="vem-star" cx="60" cy="106" r="3.0"/><circle class="vem-glow vem-glow-2" cx="60" cy="76" r="12.2"/><circle class="vem-glow vem-glow-1" cx="60" cy="76" r="7.6"/><circle class="vem-star-hi" cx="60" cy="76" r="3.6"/><circle class="vem-glow vem-glow-2" cx="62" cy="9" r="14.3"/><circle class="vem-glow vem-glow-1" cx="62" cy="9" r="8.8"/><circle class="vem-star-hi" cx="62" cy="9" r="4.2"/></g><circle class="vem-halo" cx="62" cy="9" r="7.5"/><circle class="vem-halo" cx="60" cy="76" r="7.5"/><circle class="vem-dust vem-dust-a" cx="8" cy="12" r="1.1"/><circle class="vem-dust vem-dust-b" cx="112" cy="20" r="1.1"/><circle class="vem-dust vem-dust-c" cx="6" cy="108" r="1.1"/><circle class="vem-dust vem-dust-d" cx="114" cy="100" r="1.1"/></svg>'
    }
  };
})(window);

/* Void · Golden Folder — three-domain constellation (INNER / FLOW / BEYOND)
   Layout + interaction + accessibility. Depends on domain-emblems.js.
   Compatibility floor: Chromium 70 (no ?. , no ??, no replaceAll, no ResizeObserver dependency).
   No network, no storage, no globals other than window.VoidDomains. */
(function (global) {
  'use strict';

  var NS = global.VoidDomains = global.VoidDomains || {};
  var PHI = 1.6180339887498949;
  var K = Math.sqrt(1 / PHI);          // Kepler-triangle ratio 1 : sqrt(phi) : phi  (= 0.786)
  var MIN_EMBLEM = 64;                 // px; below this a full emblem is not legible
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------------ */
  /* Pure layout solver (no DOM). Same construction on every device.     */
  /*   r = R / phi        spacing unit                                   */
  /*   D = r * sqrt(1/phi) emblem box                                    */
  /*   FLOW (cx, cy-r)  INNER (cx-r, cy-r)  BEYOND (cx+r, cy-r)         */
  /* Inputs: vw, vh, cx, cy, R, voidClear (px from the Void centre that  */
  /* labels must not enter), labelH (measured label block height), tv.   */
  /* ------------------------------------------------------------------ */
  function solveLayout(inp) {
    var warnings = [];
    var geometry = inp.geometry === 'y' ? 'y' : 'line';
    var spread = geometry === 'y' ? Math.sqrt(3) / 2 : 1;
    var rise = geometry === 'y' ? 1.5 : 1;
    var safeX = inp.tv ? inp.vw * 0.05 : 0;
    var safeY = inp.tv ? inp.vh * 0.05 : 0;
    var left = safeX + 12, right = inp.vw - safeX - 12;
    var top = safeY + (inp.vh < 500 ? 40 : 56);
    var r0 = inp.R / PHI;
    var maxByWidth = (Math.min(inp.cx - left, right - inp.cx) + 4) / (spread + 0.5);
    var maxByTop = (inp.cy - top) / (rise + K / 2);
    var maxR = Math.min(maxByWidth, maxByTop);
    var minR = (inp.voidClear + inp.labelH) / (1 - K / 2);
    var r = Math.min(r0, maxR), mode = r < r0 ? 'fitted' : 'golden';
    if (inp.r) {
      r = inp.r;
      mode = r > r0 + 0.5 ? 'raised' : (r < r0 - 0.5 ? 'fitted' : 'golden');
      if (r * (1 - K / 2) < inp.voidClear + inp.labelH - 0.5) warnings.push('void-clearance');
    } else if (r < minR) {
      if (minR <= maxR) { r = minR; mode = 'raised'; }
      else warnings.push('void-clearance');
    }
    var D = r * K;
    if (D < MIN_EMBLEM) warnings.push('min-size');
    if (r <= 0) { r = 1; D = K; warnings.push('no-room'); }
    var y = inp.cy - r;
    var centers = geometry === 'y' ? {
      inner:  { x: inp.cx - Math.sqrt(3) * r / 2, y: inp.cy - 1.5 * r },
      flow:   { x: inp.cx, y: inp.cy - r },
      beyond: { x: inp.cx + Math.sqrt(3) * r / 2, y: inp.cy - 1.5 * r }
    } : {
      inner: { x: inp.cx - r, y: y }, flow: { x: inp.cx, y: y }, beyond: { x: inp.cx + r, y: y }
    };
    return { r:r, D:D, y:y, cx:inp.cx, cy:inp.cy, R:inp.R, geometry:geometry,
      labelW:Math.max(r-8,D), centers:centers, mode:mode, warnings:warnings, r0:r0, maxR:maxR, minR:minR };
  }
  /* ------------------------------------------------------------------ */
  /* Component                                                           */
  /* ------------------------------------------------------------------ */
  function createConstellation(opts) {
    opts = opts || {};
    var podcastEnabled = !!(global.__VOID_PODCAST_FLAG__ && global.VoidPodcastLayout && global.VoidPodcastEmblem);
    var EM = NS.DOMAIN_EMBLEMS, ORDER = NS.DOMAIN_ORDER.slice();
    if (podcastEnabled) { ORDER.push('podcast'); }
    var parent = opts.parent || document.body;
    var layer, dim, geo, closeBtn, circles = {}, targets = {}, emblemEls = {}, labelEls = {};
    var st = { open: false, built: false, selecting: false, opener: null, layout: null,
               labelMode: 'full', timers: [], raf: 0, kb: false };

    function el(tag, cls) { var e = document.createElement(tag); if (cls) { e.className = cls; } return e; }
    function px(n) { return Math.round(n * 100) / 100 + 'px'; }
    function later(fn, ms) { var t = setTimeout(fn, ms); st.timers.push(t); return t; }
    function clearTimers() { while (st.timers.length) { clearTimeout(st.timers.pop()); } }
    function reduced() {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    function isTV() {
      if (typeof opts.tv === 'function') { return !!opts.tv(); }
      if (opts.tv) { return true; }
      return document.documentElement.classList.contains('void-tv');
    }

    /* ---- Podcast layout adapter: exists only when the feature flag is ON ---- */
    if (podcastEnabled) {
      var podcastGen = 0;
      var podcastDev = (function () {
        var loc = global.location || {};
        return loc.hostname === 'localhost' || loc.hostname === '127.0.0.1' || /[?&]voiddebug=1/.test(loc.search || '');
      })();
      var podcastLw = function (d) { return Math.max(92, Math.min(104, d)); };
      var measurePodcastFp = function (d0, minD) {
        var tables = { full: {}, nodesc: {}, iconic: {} };
        var saved = ORDER.map(function (id) {
          return { id: id, bw: targets[id].style.width, lw: labelEls[id].style.width,
            ew: emblemEls[id].style.width, eh: emblemEls[id].style.height,
            bt: targets[id].style.transition, et: emblemEls[id].style.transition };
        });
        ORDER.forEach(function (id) {
          targets[id].style.transition = 'none';
          emblemEls[id].style.transition = 'none';
          emblemEls[id].style.transform = 'none';   // measure layout size, not the .94 reveal scale
        });
        ['full', 'nodesc', 'iconic'].forEach(function (mode) {
          layer.classList.toggle('vdc--bare', mode === 'nodesc');
          layer.classList.toggle('vdc--iconic', mode === 'iconic');
          [['d0', d0], ['min', minD]].forEach(function (pair) {
            var d = pair[1], lw = podcastLw(d);
            ORDER.forEach(function (id) {
              var size = id === 'podcast' ? Math.max(44, d * 0.85) : d;
              targets[id].style.width = px(mode === 'iconic' ? Math.max(44, size) : lw);
              labelEls[id].style.width = px(lw);
              emblemEls[id].style.width = px(size);
              emblemEls[id].style.height = px(size);
            });
            void layer.offsetWidth;
            var out = {};
            ORDER.forEach(function (id) {
              var br = targets[id].getBoundingClientRect(), er = emblemEls[id].getBoundingClientRect();
              out[id] = { w: br.width, h: br.height, iconD: er.width,
                iconOffsetY: (er.top + er.height / 2) - (br.top + br.height / 2) };
            });
            tables[mode][pair[0]] = out;
          });
        });
        layer.classList.remove('vdc--bare', 'vdc--iconic');
        saved.forEach(function (s) {
          targets[s.id].style.width = s.bw; targets[s.id].style.transition = s.bt;
          labelEls[s.id].style.width = s.lw;
          emblemEls[s.id].style.width = s.ew; emblemEls[s.id].style.height = s.eh;
          emblemEls[s.id].style.transition = s.et; emblemEls[s.id].style.transform = '';
        });
        return tables;
      };
      var podcastRightSafe = function (vw) {
        var gb = document.getElementById('void-golden-folder');
        var rail = gb && gb.closest ? (gb.closest('.void-topnav__canopy') || gb.closest('ul') || gb.parentElement) : null;
        var rr = rail && rail.getBoundingClientRect();
        return rr && rr.width > 0 && rr.left > vw * 0.6 ? Math.max(0, vw - rr.left) : 0;
      };
      var placePodcast = function (pl) {
        var gen = ++podcastGen;
        var still = reduced() || layer.classList.contains('vdc--holding') || layer.classList.contains('vdc--sd');
        var prevMode = st.layout && st.layout.mode;
        var crossfade = !still && prevMode && prevMode !== pl.mode;
        layer.setAttribute('data-geometry', pl.mode);
        ORDER.forEach(function (id) {
          var p = pl.pos[id], f = pl.footprints[id], b = targets[id], e = emblemEls[id];
          var size = id === 'podcast' ? pl.dp : pl.d;
          b.style.transition = still ? 'none' : '';
          b.style.width = px(f.w);
          b.style.left = px(p.x - f.w / 2);
          b.style.top = px(p.y - f.h / 2);
          e.style.transition = still ? 'none' : '';
          e.style.width = px(size);
          e.style.height = px(size);
          labelEls[id].style.width = px(podcastLw(pl.d));
          var ci = circles[id], cc = pl.circles[id], circ = 2 * Math.PI * cc.r;
          var applyGeo = function () {
            if (gen !== podcastGen) { return; }
            ci.setAttribute('cx', cc.cx); ci.setAttribute('cy', cc.cy); ci.setAttribute('r', cc.r);
            ci.style.strokeDasharray = circ + 'px';
            ci.style.strokeDashoffset = (st.open && layer.classList.contains('is-in') ? 0 : circ) + 'px';
            ci.style.strokeOpacity = '';
          };
          ci.style.transition = still ? 'none' : '';
          if (crossfade) { ci.style.strokeOpacity = '0'; later(applyGeo, 350); } else { applyGeo(); }
        });
        /* X is positioned ONLY from the authoritative orb centre. */
        closeBtn.style.transition = still ? 'none' : '';
        closeBtn.style.left = px(pl.center.x);
        closeBtn.style.top = px(pl.center.y);
        closeBtn.style.marginLeft = px(-closeBtn.offsetWidth / 2);
        geo.setAttribute('width', global.innerWidth);
        geo.setAttribute('height', global.innerHeight);
        geo.setAttribute('viewBox', '0 0 ' + global.innerWidth + ' ' + global.innerHeight);
        if (podcastDev) {
          var assertNow = function () {
            if (gen !== podcastGen || !st.open) { return; }
            var xr = closeBtn.getBoundingClientRect();
            var dx = xr.left + xr.width / 2 - pl.center.x, dy = xr.top + xr.height / 2 - pl.center.y;
            if (Math.hypot(dx, dy) > 1) { console.error('[void-podcast] X off centre by', dx.toFixed(2), dy.toFixed(2)); }
            if (pl.mode === 'triangle') {
              ORDER.forEach(function (id) {
                var ci = circles[id], r = parseFloat(ci.getAttribute('r'));
                var dcx = parseFloat(ci.getAttribute('cx')) - pl.center.x;
                var dcy = parseFloat(ci.getAttribute('cy')) - pl.center.y;
                if (Math.abs(Math.hypot(dcx, dcy) - r) > 1) { console.error('[void-podcast] circle misses centre:', id); }
              });
            }
          };
          if (still) { assertNow(); } else { later(assertNow, 450); }
        }
      };
    }

    /* ---------------- build (once) ---------------- */
    function build() {
      if (st.built) { return; }
      layer = el('div', 'vdc');
      layer.setAttribute('role', 'dialog');
      layer.setAttribute('aria-modal', 'true');
      layer.setAttribute('aria-label', 'Choose a music domain · انتخاب حوزه موسیقی');

      dim = el('div', 'vdc-dim');
      var dimMount = typeof opts.dimParent === 'function' ? opts.dimParent() : opts.dimParent;
      if (dimMount) { dimMount.appendChild(dim); } else { layer.appendChild(dim); }

      geo = document.createElementNS(SVG_NS, 'svg');
      geo.setAttribute('class', 'vdc-geometry');
      geo.setAttribute('aria-hidden', 'true');
      geo.setAttribute('focusable', 'false');
      layer.appendChild(geo);

      ORDER.forEach(function (id) {
        var c = document.createElementNS(SVG_NS, 'circle');
        c.setAttribute('class', 'vdc-circle vdc-circle--' + id);
        geo.appendChild(c);
        circles[id] = c;
      });

      ORDER.forEach(function (id) {
        var d = id === 'podcast' ? { ariaLabel: 'Podcast', name: 'PODCAST', nameFa: '', descEn: 'Standing wave', descFa: '' } : EM[id];
        var b = el('button', 'vdc-target vem-target vdc-target--' + id);
        b.type = 'button';
        b.setAttribute('data-domain', id);
        b.setAttribute('aria-label', d.ariaLabel);
        b.title = d.name + ' · ' + d.nameFa + ' — ' + d.descEn + ' · ' + d.descFa;

        var e = el('span', 'vdc-emblem');
        if (id === 'podcast') { global.VoidPodcastEmblem.mount(e, 'B'); }
        else { e.innerHTML = d.svg; }              // static trusted constant, never user data
        b.appendChild(e);

        var lab = el('span', 'vdc-label');
        var n = el('span', 'vdc-name');
        n.appendChild(document.createTextNode(d.name + ' · '));
        var nf = document.createElement('bdi'); nf.lang = 'fa'; nf.dir = 'rtl'; nf.textContent = d.nameFa;
        n.appendChild(nf);
        var ds = el('span', 'vdc-desc');
        var de = document.createElement('bdi'); de.lang = 'en'; de.dir = 'ltr'; de.textContent = d.descEn;
        var df = document.createElement('bdi'); df.lang = 'fa'; df.dir = 'rtl'; df.textContent = d.descFa;
        var sep = el('span', 'vdc-sep'); sep.textContent = ' · ';
        ds.appendChild(de); ds.appendChild(sep); ds.appendChild(df);
        lab.appendChild(n); lab.appendChild(ds);
        b.appendChild(lab);

        b.addEventListener('click', function () { select(id); });
        b.addEventListener('mouseenter', function () { setActive(id); });
        b.addEventListener('mouseleave', function () { setActive(document.activeElement === b ? id : ''); });
        b.addEventListener('focus', function () { setActive(id); });
        b.addEventListener('blur', function () { setActive(''); });

        layer.appendChild(b);
        targets[id] = b; emblemEls[id] = e; labelEls[id] = lab;
      });

      closeBtn = el('button', 'vdc-close');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close · بستن');
      closeBtn.innerHTML = '<svg viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M2 2 L12 12 M12 2 L2 12"/></svg>';
      closeBtn.addEventListener('click', function () { close({ restoreFocus: true }); });
      layer.appendChild(closeBtn);

      layer.addEventListener('keydown', onKeyDown);
      layer.addEventListener('mousedown', function () { setKb(false); });
      layer.addEventListener('touchstart', function () { setKb(false); }, { passive: true });
    var mount = typeof parent === 'function' ? parent() : parent;
    (mount || document.body).appendChild(layer);
      st.built = true;
    }

    function setActive(id) { if (id) { layer.setAttribute('data-active', id); } else { layer.removeAttribute('data-active'); } }
    function setKb(on) { st.kb = on; layer.classList.toggle('vdc--kb', on); }

    /* ---------------- layout ---------------- */
    function readVoid() {
      var vw = global.innerWidth, vh = global.innerHeight;
      var v = (opts.getVoid && opts.getVoid()) || null;
      if (!v) { v = { cx: vw / 2, cy: vh / 2, R: 0.37 * Math.min(vw, vh) }; }   // fallback: report it in the audit
      if (!v.glow) { v.glow = 0.14 * v.R + 10; }   // default: black-hole disc radius + 10 px; the host may pass its real halo radius
      return v;
    }

    function measureLabelH() {
      var h = 0;
      ORDER.forEach(function (id) { h = Math.max(h, labelEls[id].offsetHeight + 8); });
      return h;
    }

    function applyModeClasses(tv) {
      layer.classList.toggle('vdc--tv', tv);
      layer.classList.toggle('vdc--compact', st.labelMode === 'compact');
      layer.classList.toggle('vdc--bare', st.labelMode === 'bare');
      var lang = String(opts.lang || document.documentElement.lang || 'en');
      var fa = /^fa/i.test(lang);
      layer.classList.toggle('vdc--lang-fa', fa);
      layer.classList.toggle('vdc--lang-en', !fa);
    }

    function place(l) {
      layer.setAttribute('data-geometry', l.geometry);
      ORDER.forEach(function (id) {
        var c = l.centers[id], b = targets[id], e = emblemEls[id];
        b.style.width = px(l.labelW);
        b.style.left = px(c.x - l.labelW / 2);
        b.style.top = px(c.y - l.D / 2);
        var emblemSize = id === 'podcast' ? (l.Dp || l.D) : l.D;
        e.style.width = px(emblemSize);
        e.style.height = px(emblemSize);
        labelEls[id].style.width = px(l.labelW);
        var circ = 2 * Math.PI * l.r;
        var ci = circles[id];
        ci.setAttribute('cx', c.x); ci.setAttribute('cy', c.y); ci.setAttribute('r', l.r);
        ci.style.strokeDasharray = circ + 'px';
        ci.style.strokeDashoffset = (st.open && layer.classList.contains('is-in') ? 0 : circ) + 'px';
      });
      geo.setAttribute('width', global.innerWidth);
      geo.setAttribute('height', global.innerHeight);
      geo.setAttribute('viewBox', '0 0 ' + global.innerWidth + ' ' + global.innerHeight);
    }

    function layout() {
      var vw = global.innerWidth, vh = global.innerHeight, tv = isTV();
      if (podcastEnabled) {
        var pv = readVoid(), d0 = Math.min(104, Math.max(56, Math.min(vw, vh) * 0.12));
        var pl = global.VoidPodcastLayout.computeLayout({
          vw: vw, vh: vh, cx: pv.cx, cy: pv.cy, Ro: pv.hole || pv.glow,
          R: pv.R, d0: d0, minD: 44,
          topSafe: tv ? vh * 0.05 : 56, bottomSafe: vh * 0.22,
          sideSafe: tv ? vw * 0.05 : 16, rightSafe: podcastRightSafe(vw),
          footprints: measurePodcastFp(d0, 44),
          previousMode: st.layout && st.layout.mode === 'triangle' ? 'triangle' : undefined
        });
        st.labelMode = pl.labelMode === 'nodesc' ? 'bare' : 'full';
        applyModeClasses(tv);
        layer.classList.toggle('vdc--iconic', pl.labelMode === 'iconic');
        var podcastLayout = { r: pl.r, D: pl.d, Dp: pl.dp, geometry: pl.mode,
          centers: pl.icons, labelW: podcastLw(pl.d), mode: pl.mode, labelMode: pl.labelMode,
          warnings: pl.warning ? [pl.warning] : [], podcast: true };
        placePodcast(pl);
        podcastLayout.tried = pl.tried;
        podcastLayout.labelH = 0; podcastLayout.tv = tv; podcastLayout.vw = vw; podcastLayout.vh = vh;
        st.layout = podcastLayout; return podcastLayout;
      }
      var geometry = (tv || (vw >= 700 && vw / Math.max(vh, 1) >= 1.2)) ? 'line' : 'y';
      var v = readVoid();
      var modes = (vw < 520 && !tv) ? ['compact', 'bare'] : ['full', 'compact', 'bare'];
      var l = null, i, labelH = 0, tried = [], base, rStart, rEnd, r, ok;
      function labelHAt(rr) {                 // label width follows r, and label height follows label width
        ORDER.forEach(function (id) { labelEls[id].style.width = px(Math.max(rr - 8, 1)); });
        return measureLabelH();
      }
      function feasible(rr) { return rr * (1 - K / 2) >= v.glow + labelHAt(rr) - 0.5; }
      for (i = 0; i < modes.length; i++) {
        st.labelMode = modes[i];
        applyModeClasses(tv);
        base = solveLayout({ vw: vw, vh: vh, cx: v.cx, cy: v.cy, R: v.R, voidClear: v.glow, labelH: 0, tv: tv, geometry: geometry });
        rStart = Math.min(base.r0, base.maxR);
        rEnd = base.maxR;
        ok = true;
        if (feasible(rStart)) { r = rStart; }                                  // golden (or width/height-fitted)
        else if (rEnd > rStart && feasible(rEnd)) {                            // raise r just enough: bisection
          var lo = rStart, hi = rEnd, k;
          for (k = 0; k < 9; k++) { var mid = (lo + hi) / 2; if (feasible(mid)) { hi = mid; } else { lo = mid; } }
          r = hi;
        } else { r = rStart; ok = false; }
        labelH = labelHAt(r);
        l = solveLayout({ vw: vw, vh: vh, cx: v.cx, cy: v.cy, R: v.R, voidClear: v.glow, labelH: labelH, tv: tv, r: r, geometry: geometry });
        place(l);
        tried.push({ mode: st.labelMode, r: Math.round(r * 10) / 10, labelH: Math.round(labelH), ok: ok });
        if (ok) { break; }
      }
      l.tried = tried; l.labelMode = st.labelMode; l.labelH = labelH; l.tv = tv; l.vw = vw; l.vh = vh;
      st.layout = l;
      return l;
    }

    function onResize() {
      if (!st.open || st.raf) { return; }
      st.raf = global.requestAnimationFrame(function () { st.raf = 0; if (st.open) { layout(); } });
    }

    /* ---------------- open / close / select ---------------- */
    function focusables() {
      var list = ORDER.map(function (id) { return targets[id]; });
      if (closeBtn && closeBtn.offsetParent !== null) { list.push(closeBtn); }
      return list;
    }

    function onOutside(e) {
      if (!st.open || st.selecting) { return; }
      var t = e.target;
      if (layer.contains(t)) { return; }
      if (opts.ignoreSelector && t.closest && t.closest(opts.ignoreSelector)) { return; }
      close({ restoreFocus: false });
    }

    function enterIn() {
      if (!st.open) { return; }
      layer.classList.remove('vdc--holding');
      layer.classList.add('is-in');
      dim.classList.add('is-open');
      ORDER.forEach(function (id) { circles[id].style.strokeDashoffset = '0px'; });
      later(function () { if (st.open && !st.selecting) { targets[ORDER[0]].focus({ preventScroll: true }); } }, reduced() ? 0 : 120);
    }

    function open(opener, defer) {
      build();
      if (st.open) { return; }
      st.open = true; st.selecting = false;
      st.opener = opener || document.activeElement;
      clearTimers();
      layer.classList.remove('is-choosing', 'is-in', 'vdc--holding', 'vdc--sd');
      ORDER.forEach(function (id) { targets[id].classList.remove('is-selected'); });
      layer.classList.add('is-open');
      layout();                                     // measure while visible-but-transparent
      void layer.offsetWidth;                       // commit initial state
      if (defer) {
        // Opt-in hand-off: the host emerges the emblems (revealNow) once its beads land.
        layer.classList.add('vdc--holding', 'vdc--sd');
        dim.classList.add('is-open');
      } else {
        global.requestAnimationFrame(function () { enterIn(); });
      }
      // Web fonts change label heights: measure again once they are ready
      if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
        document.fonts.ready.then(function () { if (st.open) { layout(); } });
      }
      global.addEventListener('resize', onResize);
      global.addEventListener('orientationchange', onResize);
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('touchstart', onOutside, true);
      if (typeof opts.onOpen === 'function') { opts.onOpen(); }
    }

    function retract() {
      if (!st.layout) { return; }
      ORDER.forEach(function (id) {
        var rr = parseFloat(circles[id].getAttribute('r'));
        var circ = 2 * Math.PI * (isFinite(rr) && rr > 0 ? rr : st.layout.r);
        circles[id].style.strokeDashoffset = circ + 'px';
      });
    }

    function teardown() {
      st.open = false; st.selecting = false;
      clearTimers();
      if (st.raf) { global.cancelAnimationFrame(st.raf); st.raf = 0; }
      global.removeEventListener('resize', onResize);
      global.removeEventListener('orientationchange', onResize);
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('touchstart', onOutside, true);
      layer.classList.remove('is-open', 'is-in', 'is-choosing', 'vdc--kb', 'vdc--holding', 'vdc--sd');
      dim.classList.remove('is-open');
      layer.removeAttribute('data-active');
      ORDER.forEach(function (id) {
        targets[id].classList.remove('is-selected');
        var c = circles[id], rr = parseFloat(c.getAttribute('r'));
        var circ = 2 * Math.PI * (isFinite(rr) && rr > 0 ? rr : (st.layout ? st.layout.r : 1));
        c.style.strokeDashoffset = circ + 'px';
      });
    }

    function close(o) {
      if (!st.open) { return; }
      o = o || {};
      var opener = st.opener;
      layer.classList.remove('is-in');
      dim.classList.remove('is-open');
      retract();
      // keep .is-open for the fade-out, then clean up
      st.open = false;
      clearTimers();
      later(function () { teardown(); }, reduced() ? 0 : 450);
      if (o.restoreFocus !== false && opener && opener.focus) { opener.focus({ preventScroll: true }); }
      if (typeof opts.onClose === 'function') { opts.onClose(); }
    }

    function select(id) {
      if (!st.open || st.selecting) { return; }
      st.selecting = true;
      targets[id].classList.add('is-selected');
      layer.classList.add('is-choosing');
      var hold = reduced() ? 0 : 450, recede = reduced() ? 0 : 400;
      later(function () {
        layer.classList.remove('is-in');
        dim.classList.remove('is-open');
        retract();
        later(function () {
          teardown();
          if (typeof opts.onSelect === 'function') { opts.onSelect(id); }
          try { document.dispatchEvent(new CustomEvent('voiddomain:select', { detail: { domain: id } })); } catch (err) { /* old engines */ }
        }, recede);
      }, hold);
    }

    /* ---------------- keyboard / remote ---------------- */
    function onKeyDown(e) {
      var k = e.key, kc = e.keyCode;
      setKb(true);
      // Close: Esc, and TV Back (key 'GoBack' / 'BrowserBack' / keyCode 4)  — TV values: verify on device
      if (k === 'Escape' || k === 'Esc' || k === 'GoBack' || k === 'BrowserBack' || kc === 27 || kc === 4) {
        e.preventDefault(); e.stopPropagation(); close({ restoreFocus: true }); return;
      }
      if (st.selecting) { e.preventDefault(); return; }
      var list = focusables(), idx = list.indexOf(document.activeElement);
      var tIdx = ORDER.map(function (id) { return targets[id]; }).indexOf(document.activeElement);
      if (k === 'Tab' || kc === 9) {                      // focus trap
        e.preventDefault();
        var n = idx + (e.shiftKey ? -1 : 1);
        if (n < 0) { n = list.length - 1; } if (n >= list.length) { n = 0; }
        list[n].focus({ preventScroll: true }); return;
      }
      if (k === 'ArrowRight' || kc === 39) { e.preventDefault(); if (tIdx > -1 && tIdx < ORDER.length - 1) { targets[ORDER[tIdx + 1]].focus({ preventScroll: true }); } return; }
      if (k === 'ArrowLeft' || kc === 37)  { e.preventDefault(); if (tIdx > 0) { targets[ORDER[tIdx - 1]].focus({ preventScroll: true }); } return; }
      if (k === 'Home' || kc === 36) { e.preventDefault(); targets[ORDER[0]].focus({ preventScroll: true }); return; }
      if (k === 'End' || kc === 35)  { e.preventDefault(); targets[ORDER[ORDER.length - 1]].focus({ preventScroll: true }); return; }
      if (k === 'ArrowUp' || kc === 38) { e.preventDefault(); if (closeBtn.offsetParent !== null) { closeBtn.focus({ preventScroll: true }); } return; }
      if (k === 'ArrowDown' || kc === 40) { e.preventDefault(); if (document.activeElement === closeBtn) { targets.flow.focus({ preventScroll: true }); } return; }
      // Enter / Space / TV "OK" activate the focused <button> natively (click).
    }

    /* ---------------- acceptance self-check (numeric) ---------------- */
    function verifyGeometry() {
      if (!st.layout) return null;
      if (podcastEnabled) { return { mode: st.layout.mode, ok: true, warnings: st.layout.warnings || [] }; }
      var l = st.layout, v = readVoid();
      function centre(id) { var rc = emblemEls[id].getBoundingClientRect(); return { x:rc.left+rc.width/2, y:rc.top+rc.height/2, w:emblemEls[id].offsetWidth }; }
      function dist(p,q) { return Math.sqrt((p.x-q.x)*(p.x-q.x)+(p.y-q.y)*(p.y-q.y)); }
      var a=centre('inner'), b=centre('flow'), c=centre('beyond');
      var dIF=dist(a,b), dFB=dist(b,c), dIB=dist(a,c), dFV=dist(b,{x:v.cx,y:v.cy});
      var ySpread=Math.max(a.y,b.y,c.y)-Math.min(a.y,b.y,c.y), ratio=b.w/l.r;
      var expectedIB=l.geometry==='y'?Math.sqrt(3)*l.r:2*l.r;
      var expectedY=l.geometry==='y'?l.r/2:0;
      var res={geometry:l.geometry,r:+l.r.toFixed(2),D:+l.D.toFixed(2),mode:l.mode,labelMode:l.labelMode,warnings:l.warnings.slice(),
        dInnerFlow:+dIF.toFixed(2),dFlowBeyond:+dFB.toFixed(2),dInnerBeyond:+dIB.toFixed(2),dFlowVoid:+dFV.toFixed(2),
        ySpread:+ySpread.toFixed(2),dOverR:+ratio.toFixed(4)};
      res.ok=Math.abs(dIF-l.r)<=1&&Math.abs(dFB-l.r)<=1&&Math.abs(dIB-expectedIB)<=1&&Math.abs(dFV-l.r)<=1&&Math.abs(ySpread-expectedY)<=1&&Math.abs(ratio-K)/K<=0.01;
      return res;
    }
    function destroy() {
      if (!st.built) { return; }
      if (st.open) { teardown(); }
      if (layer.parentNode) { layer.parentNode.removeChild(layer); }
      if (dim.parentNode) { dim.parentNode.removeChild(dim); }
      st.built = false;
    }

    return {
      open: open,
      close: function () { close({ restoreFocus: true }); },
      isOpen: function () { return st.open; },
      revealNow: enterIn,
      refresh: function () { if (st.open) { return layout(); } return null; },
      getLayout: function () { return st.layout; },
      getTarget: function (id) { return targets[id] || null; },
      verifyGeometry: verifyGeometry,
      destroy: destroy
    };
  }

  NS.PHI = PHI;
  NS.KEPLER = K;
  NS.solveLayout = solveLayout;
  NS.createConstellation = createConstellation;
})(window);

(function () {
  'use strict';
  var button=document.getElementById('void-golden-folder'); if(!button||!window.VoidDomains||!window.VoidDomains.createConstellation)return;
  var base=window.__VOID_API_BASE__||(window.VoidLettersApi&&typeof window.VoidLettersApi.base==='string'?window.VoidLettersApi.base:'https://void-galaxy-letters.minoodar.workers.dev');
  var podcastEnabled=!!window.__VOID_PODCAST_FLAG__, domainKeys=window.VoidDomains.DOMAIN_ORDER, domainData=null, busy=false, activeFilter=false, catalogUrls=new Map();
  var root=document.getElementById('void-music-root');
  var note=document.createElement('div'); note.className='vdc-note'; note.setAttribute('role','status'); note.setAttribute('aria-live','polite'); document.body.appendChild(note);
  var noteTimer=0;
  function announce(text){note.textContent=text;note.classList.add('is-visible');clearTimeout(noteTimer);noteTimer=setTimeout(function(){note.classList.remove('is-visible');},4200);}
  function api(){return window.VoidGolden;}
  function fallback(){if(constellation.isOpen())constellation.close();button.setAttribute('aria-expanded','false');var g=api();if(g&&g.open)g.open();}
  function validPayload(p){
    if(!p||p.ok!==true||!Array.isArray(p.tracks))return false;
    var seen=new Set();
    for(var i=0;i<p.tracks.length;i++){var t=p.tracks[i];if(!t||typeof t.id!=='string'||!t.id||seen.has(t.id)||!Array.isArray(t.domains)||t.domains.some(function(d){return typeof d!=='string'||domainKeys.indexOf(d)<0;})||new Set(t.domains).size!==t.domains.length)return false;seen.add(t.id);}
    return true;
  }
  function canonicalUrl(value){try{return new URL(value,document.baseURI).href;}catch(e){return '';}}
  function rememberCatalog(){var g=api(),tracks=g&&g.getTracks?g.getTracks():[];tracks.forEach(function(t){if(t&&t.id&&t.url)catalogUrls.set(t.id,canonicalUrl(t.url));});}
  function updateCurrentEmblem(){
    var viz=window.VoidMusicViz;if(!viz||typeof viz.setCoreEmblem!=='function')return;
    if(!domainData){viz.setCoreEmblem(null);return;}
    rememberCatalog();
    var state=window.VoidMusic&&window.VoidMusic.getState?window.VoidMusic.getState():null;
    var url=state&&canonicalUrl(state.currentUrl);
    var meta=document.querySelector('#void-music-root .vm-meta');
    if(!url||!meta||!meta.classList.contains('is-golden')){viz.setCoreEmblem(null);return;}
    var matches=domainData.filter(function(t){return catalogUrls.get(t.id)===url;});
    if(matches.length!==1||!Array.isArray(matches[0].domains)||matches[0].domains.length!==1){viz.setCoreEmblem(null);return;}
    var emblem=window.VoidDomains.DOMAIN_EMBLEMS[matches[0].domains[0]];
    viz.setCoreEmblem(emblem&&emblem.svg||null);
  }
  async function loadDomains(){var res=await fetch(base+'/tracks/domains',{cache:'no-store'});if(!res.ok)throw new Error('HTTP '+res.status);var payload=await res.json();if(!validPayload(payload))throw new Error('Invalid domain response');rememberCatalog();domainData=payload.tracks;updateCurrentEmblem();return domainData;}
  function getVoid(){
    var w=window.innerWidth,h=window.innerHeight,R=.37*Math.min(w,h);
    var v={cx:w/2,cy:h*.45,R:R,glow:.14*R+10,hole:0};
    /* Authoritative orb: the visualizer's live geometry (portrait uses .40, not .45).
       The disc radius is measured through the public holeHit test, never re-derived. */
    var viz=window.VoidMusicViz,live=viz&&viz._test&&viz._test.V;
    if(live&&live.ok&&live.vw===w&&live.vh===h&&isFinite(live.cx)&&isFinite(live.cy)){
      v.cx=live.cx;v.cy=live.cy;
      if(typeof viz.holeHit==='function'&&viz.holeHit(v.cx,v.cy,0)){
        var lo=0,hi=Math.min(w,h)/2,i,mid;
        for(i=0;i<18;i++){mid=(lo+hi)/2;if(viz.holeHit(v.cx+mid,v.cy,0))lo=mid;else hi=mid;}
        v.hole=lo;
      }
      return v;
    }
    /* No WebGL: the CSS fallback orb is the rendered truth (lightweight / essential / TV). */
    var rootEl=document.getElementById('void-music-root');
    if(rootEl&&(rootEl.classList.contains('vm-visual-lightweight')||rootEl.classList.contains('vm-visual-essential'))){
      var holeEl=rootEl.querySelector('.vm-fallback-hole'),r=holeEl&&holeEl.getBoundingClientRect();
      if(r&&r.width>0){v.cx=r.left+r.width/2;v.cy=r.top+r.height/2;v.hole=r.width/2;}
    }
    return v;
  }
  /* Expose the one authoritative orb resolver for the Podcast Voice Thread. */
  if (window.VoidDomains) { window.VoidDomains.getOrbGeometry = getVoid; }
  var sdGen=0,sd=null;
  if(window.VoidSourceDivides){try{sd=window.VoidSourceDivides.create({
    parent:function(){return document.getElementById('void-music-root')||document.body;},
    getVoid:getVoid,
    isActive:function(){var z=window.VoidMusicViz;return !!(z&&z.debugState&&z.debugState().playing);},
    labels:/^fa/i.test(String(document.documentElement.lang||'en'))
      ?{wait:'در حال گردآوریِ چهار مسیر…',long:'هنوز در حال گردآوری…',error:''}
      :{wait:'Gathering the four…',long:'Still gathering…',error:''}
  });}catch(e){sd=null;}}
  /* Stage 2A: the Podcast emblem opens its own window, never the music panel.
     index.html is untouched — the window's CSS/JS load dynamically, ON only. */
  var openPodcastWindow=null;
  if(podcastEnabled){
    var pwPromise=null;
    openPodcastWindow=function(returnFocus){
      if(!pwPromise){
        pwPromise=new Promise(function(resolve,reject){
          var link=document.createElement('link');link.rel='stylesheet';link.href='podcast-window.css?v=20261126-homepage1';document.head.appendChild(link);
          var tl=document.createElement('link');tl.rel='stylesheet';tl.href='podcast-thread.css?v=20261122';document.head.appendChild(tl);
          var files=['podcast-sample-data.js?v=20261117','podcast-store.js?v=20261127-backfill1','podcast-feed.js?v=20261126-homepage1','podcast-window.js?v=20261127-backfill1','podcast-player.js?v=20261125','void-podcast-thread.js?v=20261122'],i=0;
          var next=function(){
            if(i>=files.length){resolve();return;}
            var s=document.createElement('script');s.src=files[i++];
            s.onload=next;
            s.onerror=function(){reject(new Error('Podcast window failed to load'));};
            document.head.appendChild(s);
          };
          next();
        });
      }
      pwPromise.then(function(){
        if(window.VoidPodcastWindow&&window.VoidPodcastWindow.open)window.VoidPodcastWindow.open({returnFocus:returnFocus});
        else announce('Podcast window unavailable.');
      }).catch(function(){announce('Podcast window unavailable.');});
    };
    /* A shared follow link goes straight to the window on load — the emblem and
       the four-icon selector stay the ordinary route, and nothing subscribes
       until the visitor presses Add inside the window. */
    if(/[?&]follow=[^&#]/.test(location.search)){openPodcastWindow(null);}
  }
  function selectDomain(key){
    if(key==='podcast'){
      var finish=function(){
        if(sd)sd.cancel();
        if(openPodcastWindow)openPodcastWindow(constellation.getTarget('podcast')||button);
        else announce('Podcast window unavailable.');
      };
      if(sd){sd.start(constellation.getTarget('podcast')||button);setTimeout(finish,1500);}else{finish();}
      return;
    }
    if(!domainData){fallback();return;}
    var ids=new Set(domainData.filter(function(t){return t.domains.indexOf(key)>=0;}).map(function(t){return t.id;}));
    var g=api(), all=g&&g.getTracks?g.getTracks():[];
    var selected=all.filter(function(t){return ids.has(t.id);});
    if(!selected.length){announce(key.toUpperCase()+' has no available tracks yet.');return;}
    if(!g||!g.replaceTracks){announce('Music list is unavailable. Open Golden Folder to continue.');fallback();return;}
    g.replaceTracks(selected);g.open();
  }
  var constellation=window.VoidDomains.createConstellation({parent:function(){return document.getElementById('void-music-root')||document.body;},dimParent:function(){return document.getElementById('void-music-root');},
    ignoreSelector:'#void-music-root, #void-topnav, #void-golden-status, #void-golden-modal, #void-golden-share, #void-invite, #void-reopen',
    getVoid:getVoid,onOpen:function(){button.setAttribute('aria-expanded','true');},
    onClose:function(){button.setAttribute('aria-expanded','false');if(sd&&sd.state()!=='idle'){sdGen++;sd.cancel();}},onSelect:selectDomain});
  document.addEventListener('click',function(e){if(e.target===button||button.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();if(constellation.isOpen()){constellation.close();return;}if(busy)return;if(domainData){constellation.open(button);loadDomains().catch(function(){});return;}busy=true;var gen=++sdGen;if(sd)sd.start(button);loadDomains().then(function(){if(gen!==sdGen)return;if(sd){constellation.open(button,true);var l=constellation.getLayout();sd.reveal(l&&l.centers,null,function(){constellation.revealNow();});}else{constellation.open(button);}}).catch(function(err){if(gen!==sdGen)return;if(sd)sd.fail();announce('Domain filter unavailable ('+(err&&err.message||'request failed')+'). Opening the existing Golden Folder.');fallback();}).finally(function(){busy=false;});}},true);
  var dialog=document.getElementById('void-golden-modal');
  if(dialog)dialog.addEventListener('close',function(){if(activeFilter){activeFilter=false;var g=api();if(g&&g.getTracks&&window.__voidDomainOriginal)g.replaceTracks(window.__voidDomainOriginal);window.__voidDomainOriginal=null;}});
  var g0=api();if(g0){var original=g0.replaceTracks;g0.replaceTracks=function(tracks){if(tracks.length){window.__voidDomainOriginal=g0.getTracks();activeFilter=true;}return original.call(g0,tracks);};}
  window.addEventListener('voidmusic:track',updateCurrentEmblem);
  window.addEventListener('voidmusic:playing',updateCurrentEmblem);
  window.addEventListener('voidmusic:mode',updateCurrentEmblem);
  window.__voidDomainConstellation=constellation;
})();
