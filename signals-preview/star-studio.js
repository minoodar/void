/* ======================================================================
   Void Star Studio — preview-only visual configuration for Galaxy Signals.
   Injected at serve time into the existing control room (?admin=true) as an
   extra tab. No production file is modified; nothing here is sent to a
   Worker, D1 or R2 — the model persists in sessionStorage only.

   Scope (owner-approved, iteration 2): appearance, motion and arrangement
   presets for the Galaxy's signals. It is a configuration system, not a
   collection of hard-coded effects: the renderer consumes tokens, and a new
   preset is added by extending the shape table, never by editing the event
   engine. Message content and message lifetime are out of scope here and are
   owned by the message store.
   ====================================================================== */
(function () {
  'use strict';
  var CFG = window.VoidStarConfig;
  if (!CFG) return;
  if (!/[?&]admin=(?:1|true)/.test(location.search)) return;

  var SHAPES = window.VoidStarShapes || null;
  var STORE = window.VoidSignalsStore || null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function btn(parent, cls, text, fn, attrs) {
    var b = el('button', 'vss-btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', fn);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) b.setAttribute(k, attrs[k]);
    parent.appendChild(b);
    return b;
  }

  /* ---------------- host tab + panel ---------------- */
  var tab = null, panel = null, mounted = false;

  function mount() {
    var app = document.getElementById('va-app');
    var tabsBar = app && app.querySelector('.va-tabs');
    var panelLetters = document.getElementById('va-panel-letters');
    if (!app || !tabsBar || !panelLetters) return false;
    if (document.getElementById('vss-panel')) { sync(); return true; }

    tab = el('button', 'va-tab vss-tab', '');
    tab.type = 'button';
    tab.id = 'vss-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'vss-panel');
    tab.setAttribute('aria-selected', 'false');
    tab.appendChild(el('span', 'vss-tab__pip'));
    tab.appendChild(el('span', '', 'Void Star Studio'));
    tab.appendChild(el('span', 'va-tab__count vss-tab__count', 'preview'));
    tabsBar.appendChild(tab);

    panel = el('section', 'va-panel vss-panel');
    panel.id = 'vss-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', 'vss-tab');
    panel.hidden = true;
    app.appendChild(panel);
    panelLetters.parentNode.insertBefore(panel, panelLetters.nextSibling);

    tab.addEventListener('click', showStudio);
    /* The production tab logic only knows Music and Letters, and it hard-hides
       both panels on every setView(). Rather than editing void-admin.js, watch
       the production panels: whichever of them becomes visible means the user
       left the studio, so the studio steps out of the way. */
    if (window.MutationObserver) {
      var pm = document.getElementById('va-panel-music');
      var pl = document.getElementById('va-panel-letters');
      var back = function () {
        if (switching) return;
        var m = document.getElementById('va-panel-music'), l = document.getElementById('va-panel-letters');
        if ((m && !m.hidden) || (l && !l.hidden)) hideStudio();
      };
      if (pm) new MutationObserver(back).observe(pm, { attributes: true, attributeFilter: ['hidden'] });
      if (pl) new MutationObserver(back).observe(pl, { attributes: true, attributeFilter: ['hidden'] });
    }
    build(panel);
    mounted = true;
    return true;
  }
  var switching = false;
  function sync() {
    if (!tab || !panel) return;
    var studio = !panel.hidden;
    tab.setAttribute('aria-selected', studio ? 'true' : 'false');
    tab.tabIndex = studio ? 0 : -1;
  }
  function showStudio() {
    switching = true;
    var pm = document.getElementById('va-panel-music'), pl = document.getElementById('va-panel-letters');
    if (pm) pm.hidden = true;
    if (pl) pl.hidden = true;
    panel.hidden = false;
    setTimeout(function () { switching = false; }, 0);
    sync();
    render();
  }
  function hideStudio() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    sync();
  }

  /* ---------------- layout of the panel ---------------- */
  var refs = {};
  function build(root) {
    root.textContent = '';

    var head = el('div', 'vss-head');
    head.appendChild(el('h2', 'vss-title', 'Void Star Studio'));
    head.appendChild(el('p', 'vss-sub',
      'Central control over the visual language of Galaxy Signals: how a signal looks, moves and is arranged. ' +
      'These are presentation presets, not message categories — a message keeps its identity, lifetime and read state no matter what is chosen here.'));
    var badges = el('div', 'vss-badges');
    badges.appendChild(el('span', 'vss-badge vss-badge--warn', 'Preview only'));
    badges.appendChild(el('span', 'vss-badge', 'sessionStorage · cleared when the tab closes'));
    badges.appendChild(el('span', 'vss-badge', 'no Worker, no D1, no R2, no production config'));
    head.appendChild(badges);
    root.appendChild(head);

    var grid = el('div', 'vss-grid');
    root.appendChild(grid);

    /* ---- live preview stage ---- */
    var stageCard = el('section', 'vss-card vss-card--stage');
    var stageHead = el('div', 'vss-card__head');
    stageHead.appendChild(el('h3', '', 'Live preview'));
    stageHead.appendChild(el('span', 'vss-card__note', 'updates as you change anything'));
    refs.stageState = el('span', 'vss-pill');
    stageHead.appendChild(refs.stageState);
    stageCard.appendChild(stageHead);
    refs.stage = el('div', 'vss-stage');
    refs.stage.setAttribute('aria-label', 'Live preview of the current star appearance');
    stageCard.appendChild(refs.stage);
    var legend = el('div', 'vss-legend');
    [['fresh', 'Unread — initial brightness'], ['awake', 'Being read — window open'], ['read', 'Read this session — dim, still clickable']]
      .forEach(function (l) {
        var item = el('span', 'vss-legend__item');
        item.appendChild(el('i', 'vss-legend__dot vss-legend__dot--' + l[0]));
        item.appendChild(el('span', '', l[1]));
        legend.appendChild(item);
      });
    stageCard.appendChild(legend);
    var stageRow = el('div', 'vss-row');
    btn(stageRow, 'vss-btn--ghost', 'Preview selected style', function () { pulse(); });
    btn(stageRow, 'vss-btn--ghost', 'Compare arrangements', function () { refs.compare.hidden = !refs.compare.hidden; paintCompare(); });
    stageCard.appendChild(stageRow);
    refs.compare = el('div', 'vss-compare');
    refs.compare.hidden = true;
    stageCard.appendChild(refs.compare);
    grid.appendChild(stageCard);

    /* ---- controls column ---- */
    var ctrl = el('section', 'vss-card vss-card--ctrl');
    var ctrlHead = el('div', 'vss-card__head');
    ctrlHead.appendChild(el('h3', '', 'Appearance'));
    ctrlHead.appendChild(el('span', 'vss-card__note', 'star style · light · palette'));
    ctrl.appendChild(ctrlHead);
    refs.scope = el('div', 'vss-scope');
    ctrl.appendChild(refs.scope);
    refs.style = el('div', 'vss-seg');
    ctrl.appendChild(row('Star visual style', refs.style));
    refs.color = el('div', 'vss-swatches');
    ctrl.appendChild(row('Colour', refs.color));
    ctrl.appendChild(row('Arrangement', refs.presets = el('div', 'vss-presets')));
    grid.appendChild(ctrl);

    var ctrl2 = el('section', 'vss-card vss-card--ctrl');
    var ctrl2Head = el('div', 'vss-card__head');
    ctrl2Head.appendChild(el('h3', '', 'Motion & light'));
    ctrl2Head.appendChild(el('span', 'vss-card__note', 'restrained, interruptible, reduced-motion aware'));
    ctrl2.appendChild(ctrl2Head);
    refs.motion = el('div', 'vss-seg');
    ctrl2.appendChild(row('Motion', refs.motion));
    refs.sliders = el('div', 'vss-sliders');
    ctrl2.appendChild(refs.sliders);
    var rmNote = el('p', 'vss-note', 'A visitor with reduced motion enabled sees the same arrangement at rest: brightness and colour are preserved, movement and the awakening transition are not.');
    ctrl2.appendChild(rmNote);
    grid.appendChild(ctrl2);

    /* ---- extensibility / actions ---- */
    var acts = el('section', 'vss-card');
    var actsHead = el('div', 'vss-card__head');
    actsHead.appendChild(el('h3', '', 'Profiles & export'));
    actsHead.appendChild(el('span', 'vss-card__note', 'structure for later iterations'));
    acts.appendChild(actsHead);
    refs.exp = el('label', 'vss-switch');
    refs.expInput = document.createElement('input');
    refs.expInput.type = 'checkbox';
    refs.exp.appendChild(refs.expInput);
    refs.exp.appendChild(el('span', 'vss-switch__track'));
    refs.exp.appendChild(el('span', 'vss-switch__name', 'Experimental appearance (off = the shipped gold spark, always)'));
    refs.expInput.addEventListener('change', function () {
      CFG.setExperimental(refs.expInput.checked);
      render();
    });
    acts.appendChild(refs.exp);
    var actRow = el('div', 'vss-row');
    btn(actRow, 'vss-btn--ghost', 'Reset to default', function () { CFG.reset(); render(); });
    btn(actRow, 'vss-btn--ghost', 'Copy JSON', function () { copyJson(); });
    var open = el('a', 'vss-btn vss-btn--link', 'Open the galaxy preview');
    open.href = 'index.html?preview=studio';
    open.target = '_blank';
    open.rel = 'noopener';
    actRow.appendChild(open);
    acts.appendChild(actRow);
    refs.json = el('pre', 'vss-json');
    acts.appendChild(refs.json);
    refs.reserved = el('p', 'vss-note');
    acts.appendChild(refs.reserved);
    if (STORE) {
      refs.msgs = el('p', 'vss-note vss-note--msg');
      acts.appendChild(refs.msgs);
    }
    grid.appendChild(acts);

    var foot = el('p', 'vss-foot');
    foot.textContent = 'Boundaries: this studio changes how signals look only. It cannot publish a notification, touch a real message, ' +
      'change a lifetime, or write to production. Message identity and session read state live in the signals layer and the message store.';
    root.appendChild(foot);
  }

  function row(label, control) {
    var wrap = el('div', 'vss-field');
    wrap.appendChild(el('span', 'vss-field__label', label));
    wrap.appendChild(control);
    return wrap;
  }
  function slider(parent, name, key, min, max, step, fmt) {
    var wrap = el('div', 'vss-slider');
    var top = el('div', 'vss-slider__top');
    top.appendChild(el('span', 'vss-slider__name', name));
    var val = el('span', 'vss-slider__val');
    top.appendChild(val);
    wrap.appendChild(top);
    var input = document.createElement('input');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
    input.setAttribute('aria-label', name);
    input.addEventListener('input', function () {
      var patch = {}; patch[key] = parseFloat(input.value);
      apply(patch);
    });
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return {
      input: input, val: val,
      paint: function (v) { input.value = String(v); val.textContent = fmt ? fmt(v) : String(v); }
    };
  }

  function apply(patch) {
    var scope = refs.scopeValue || 'global';
    if (scope === 'ambient' || scope === 'important') CFG.setForType(scope, patch);
    else CFG.setGlobal(patch);
    render();
  }

  /* ---------------- painting ---------------- */
  function paintSliders() {
    if (refs.sliderCtl) return;
    refs.sliderCtl = {
      size: slider(refs.sliders, 'Star size', 'size', 0.5, 2.2, 0.05, function (v) { return v.toFixed(2) + ' ×'; }),
      brightness: slider(refs.sliders, 'Brightness', 'brightness', 0.3, 1.6, 0.05, function (v) { return v.toFixed(2); }),
      glow: slider(refs.sliders, 'Glow intensity', 'glow', 0, 2, 0.05, function (v) { return v.toFixed(2); }),
      softness: slider(refs.sliders, 'Softness / sharpness', 'softness', 0, 1, 0.05, function (v) { return v <= 0.02 ? 'crisp' : v.toFixed(2); }),
      motionIntensity: slider(refs.sliders, 'Animation intensity', 'motionIntensity', 0, 1.6, 0.05, function (v) { return v.toFixed(2); }),
      glowTransitionMs: slider(refs.sliders, 'Glow transition', 'glowTransitionMs', 120, 2600, 20, function (v) { return Math.round(v) + ' ms'; }),
      drift: slider(refs.sliders, 'Subtle movement', 'drift', 0, 1.2, 0.05, function (v) { return v.toFixed(2); })
    };
  }

  function segButtons(container, list, active, onPick) {
    container.textContent = '';
    for (var i = 0; i < list.length; i++) {
      (function (item) {
        var b = el('button', 'vss-seg__btn' + (item.id === active ? ' is-on' : ''), item.label);
        b.type = 'button';
        if (item.disabled) { b.disabled = true; b.title = item.note || 'Reserved for a later iteration'; }
        else b.addEventListener('click', function () { onPick(item.id); });
        if (item.note) b.title = item.note;
        container.appendChild(b);
      })(list[i]);
    }
  }

  function render() {
    var tk = CFG.tokens();
    var c = tk.cfg, d = tk.data;
    if (!refs.sliderCtl) paintSliders();
    /* scope selector (global default vs per event type) */
    refs.scope.textContent = '';
    [['global', 'Global default'], ['ambient', 'Ambient signals'], ['important', 'Important signals']].forEach(function (s) {
      var b = el('button', 'vss-scope__btn' + ((refs.scopeValue || 'global') === s[0] ? ' is-on' : ''), s[1]);
      b.type = 'button';
      b.addEventListener('click', function () { refs.scopeValue = s[0]; render(); });
      refs.scope.appendChild(b);
    });
    if (refs.scopeValue && refs.scopeValue !== 'global') {
      refs.scope.appendChild(el('span', 'vss-scope__note', 'editing the ' + refs.scopeValue + ' profile — the global default stays underneath it'));
    }
    var eff = CFG.effective(refs.scopeValue && refs.scopeValue !== 'global' ? refs.scopeValue : null);

    segButtons(refs.style, CFG.meta.styles.map(function (s) { return { id: s.id, label: s.label, note: s.note }; }), eff.style, function (id) { apply({ style: id }); });
    segButtons(refs.motion, CFG.meta.motions.map(function (m) { return { id: m.id, label: m.label }; }), eff.motion, function (id) { apply({ motion: id }); });

    refs.color.textContent = '';
    CFG.meta.colors.forEach(function (col) {
      var b = el('button', 'vss-swatch' + (eff.color === col.id ? ' is-on' : ''));
      b.type = 'button';
      b.title = col.label;
      b.setAttribute('aria-label', 'Palette: ' + col.label);
      b.style.background = 'radial-gradient(circle at 38% 34%, ' + col.core + ' 0%, ' + col.a + ' 42%, ' + col.b + ' 78%)';
      b.addEventListener('click', function () { apply({ color: col.id }); });
      refs.color.appendChild(b);
    });

    segButtons(refs.presets, CFG.meta.presets.map(function (p) { return { id: p.id, label: p.label, note: p.note, disabled: !!p.disabled }; }), eff.preset, function (id) { apply({ preset: id }); });

    for (var k in refs.sliderCtl) {
      if (Object.prototype.hasOwnProperty.call(refs.sliderCtl, k)) refs.sliderCtl[k].paint(eff[k]);
    }
    refs.expInput.checked = !!c.experimental;
    refs.stageState.textContent = d.preset + ' · ' + d.style + ' · ' + d.color + ' · ' + (d.motion === 'static' ? 'at rest' : 'moving');
    paintStage();
    if (!refs.compare.hidden) paintCompare();
    refs.json.textContent = JSON.stringify(CFG.raw(), null, 1);
    refs.reserved.textContent = 'Reserved shapes already modelled, not evaluated in this iteration: profiles.occasion (' +
      Object.keys(CFG.raw().profiles.occasion || {}).length + ' entry/entries), profiles.timeBased (' +
      Object.keys(CFG.raw().profiles.timeBased || {}).length + '), activeProfile = ' + c.activeProfile +
      '. The event engine and the placement rules read none of these, so adding a preset later needs no engine change.';
    if (refs.msgs && STORE) {
      var st = STORE.stats();
      refs.msgs.textContent = 'Message identity, owned elsewhere: site session ' + st.session + ' holds ' + st.live +
        ' live message(s), ' + st.read + ' read this session, ' + st.unread + ' unread. Reading dims a star and never consumes a message; ' +
        'no appearance value from this studio is written into a message, and no message value is stored here.';
    }
  }

  function tokenStyle(node, type) {
    var tk = CFG.tokens(type === 'global' ? null : type);
    for (var k in tk.tokens) if (Object.prototype.hasOwnProperty.call(tk.tokens, k)) node.style.setProperty(k, tk.tokens[k]);
    node.dataset.style = tk.data.style;
    node.dataset.preset = tk.data.preset;
    node.dataset.color = tk.data.color;
    node.dataset.motion = tk.data.motion;
    node.dataset.soft = tk.data.soft;
    return tk;
  }

  function glyph(style) {
    if (style === 'point' || style === 'bloom') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="vss-pip" cx="12" cy="12" r="' + (style === 'bloom' ? 5 : 3.4) + '"/></svg>';
    if (style === 'hairline') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="vss-hair" d="M12 1.4 V22.6 M1.4 12 H22.6"/><circle class="vss-pip" cx="12" cy="12" r="1.1"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="vss-hair" d="M12 1 V23 M1 12 H23" opacity=".22"/>' +
      '<path class="vss-spark" d="M12 1.7 L13.45 9.15 L21.3 12 L13.45 14.85 L12 22.3 L10.55 14.85 L2.7 12 L10.55 9.15 Z"/><circle class="vss-pip" cx="12" cy="12" r="1.05"/></svg>';
  }

  function cluster(stage, preset, x, y, k, cls) {
    var wrap = el('div', 'vss-star' + (cls ? ' ' + cls : ''));
    wrap.style.left = x + '%';
    wrap.style.top = y + '%';
    var S = 9, A = 17;
    var pts = SHAPES ? SHAPES.presetPoints(preset, S, A, k) : [{ dx: 0, dy: 0, size: A }];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var dot = el('span', i === 0 ? 'vss-star__primary' : 'vss-star__comp');
      var px = Math.max(2, (i === 0 ? A : p.size) * 0.5);
      dot.style.width = px + 'px';
      dot.style.height = px + 'px';
      dot.style.margin = (-px / 2) + 'px 0 0 ' + (-px / 2) + 'px';
      dot.style.transform = 'translate(' + p.dx.toFixed(1) + 'px,' + p.dy.toFixed(1) + 'px)';
      if (i === 0) dot.innerHTML = glyph(stage.dataset.style || 'spark');
      wrap.appendChild(dot);
    }
    var halo = el('span', 'vss-star__halo');
    wrap.insertBefore(halo, wrap.firstChild);
    stage.appendChild(wrap);
    return wrap;
  }

  function paintStage() {
    var stage = refs.stage;
    stage.textContent = '';
    tokenStyle(stage, refs.scopeValue && refs.scopeValue !== 'global' ? refs.scopeValue : 'global');
    var preset = stage.dataset.preset;
    cluster(stage, preset, 22, 34, 3, 'is-fresh');
    cluster(stage, preset, 50, 22, 11, 'is-awake');
    cluster(stage, preset, 74, 44, 27, 'is-read');
    cluster(stage, preset, 36, 68, 41, 'is-read');
    cluster(stage, preset, 66, 76, 57, 'is-fresh');
    var dust = el('span', 'vss-stage__dust');
    stage.appendChild(dust);
    var tag = el('span', 'vss-stage__tag', 'demo clusters · simulated text-free light · nothing is published');
    stage.appendChild(tag);
  }

  function pulse() {
    var stars = refs.stage.querySelectorAll('.vss-star');
    for (var i = 0; i < stars.length; i++) {
      stars[i].classList.remove('is-pulse');
      void stars[i].offsetWidth;
      stars[i].classList.add('is-pulse');
    }
  }

  function paintCompare() {
    var box = refs.compare;
    box.textContent = '';
    box.appendChild(el('div', 'vss-compare__label', 'Available arrangements at the current appearance — click one to apply'));
    var row = el('div', 'vss-compare__row');
    CFG.meta.presets.forEach(function (p) {
      var card = el('button', 'vss-tile' + (p.id === 'custom' ? ' is-disabled' : ''));
      card.type = 'button';
      card.disabled = !!p.disabled;
      var mini = el('div', 'vss-tile__mini');
      mini.dataset.style = refs.stage.dataset.style;
      tokenStyle(mini, 'global');
      mini.dataset.preset = p.id === 'custom' ? 'organic' : p.id;
      var S = 6, A = 11;
      var pts = SHAPES ? SHAPES.presetPoints(mini.dataset.preset, S, A, 7) : [];
      for (var i = 0; i < pts.length; i++) {
        var d = el('span', 'vss-tile__dot');
        var px = Math.max(1.5, (i === 0 ? A : pts[i].size) * 0.42);
        d.style.width = px + 'px'; d.style.height = px + 'px';
        d.style.left = 'calc(50% + ' + pts[i].dx.toFixed(1) + 'px)';
        d.style.top = 'calc(50% + ' + pts[i].dy.toFixed(1) + 'px)';
        mini.appendChild(d);
      }
      card.appendChild(mini);
      card.appendChild(el('span', 'vss-tile__name', p.label));
      card.appendChild(el('span', 'vss-tile__note', p.note || ''));
      if (!p.disabled) card.addEventListener('click', function () { apply({ preset: p.id }); });
      row.appendChild(card);
    });
    box.appendChild(row);
  }

  function copyJson() {
    var text = JSON.stringify(CFG.raw(), null, 1);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(refs.json, 'copied'); }, function () { flash(refs.json, 'copy blocked'); });
    } else flash(refs.json, 'clipboard unavailable');
  }
  function flash(node, text) {
    var old = node.textContent;
    node.textContent = text;
    setTimeout(function () { node.textContent = old; }, 900);
  }

  /* ---------------- boot ---------------- */
  var tries = 0;
  (function wait() {
    if (mount()) { CFG.subscribe(function () { render(); }); return; }
    if (tries++ > 160) return;
    setTimeout(wait, 120);
  })();
})();
