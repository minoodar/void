/* ======================================================================
   Void Signals — Phase B preview instrument (isolated demo console).
   Permanently visible control region for the visual experiment. Removing
   signals-preview/ removes this entirely; no production UI is altered.
   ====================================================================== */
(function () {
  'use strict';
  var api = window.VoidSignalsPreview;
  if (!api) return;
  var host = document.getElementById('signals-root');
  if (!host || host.querySelector('.signals-instrument')) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function group(label) {
    var g = el('div', 'sig-group');
    g.appendChild(el('div', 'sig-group__label', label));
    return g;
  }
  function button(row, text, cls, fn) {
    var b = el('button', 'sig-btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', fn);
    row.appendChild(b);
    return b;
  }
  function slider(parent, name, min, max, step, get, set, fmt) {
    var wrap = el('div', 'sig-ctl');
    var top = el('div', 'sig-ctl__top');
    top.appendChild(el('span', 'sig-ctl__name', name));
    var val = el('span', 'sig-ctl__val');
    top.appendChild(val);
    wrap.appendChild(top);
    var input = document.createElement('input');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
    input.setAttribute('aria-label', name);
    wrap.appendChild(input);
    function paint() { input.value = String(get()); val.textContent = fmt ? fmt(get()) : String(get()); }
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      set(v);
      val.textContent = fmt ? fmt(v) : String(v);
    });
    parent.appendChild(wrap);
    return { paint: paint, input: input };
  }
  function select(parent, name, options, get, set) {
    var wrap = el('div', 'sig-ctl');
    var top = el('div', 'sig-ctl__top');
    top.appendChild(el('span', 'sig-ctl__name', name));
    wrap.appendChild(top);
    var s = document.createElement('select');
    s.setAttribute('aria-label', name);
    for (var i = 0; i < options.length; i++) {
      var o = document.createElement('option');
      o.value = options[i][0]; o.textContent = options[i][1];
      s.appendChild(o);
    }
    s.addEventListener('change', function () { set(s.value); });
    wrap.appendChild(s);
    parent.appendChild(wrap);
    return { paint: function () { s.value = get(); }, input: s };
  }
  function toggle(parent, name, get, set) {
    var lab = el('label', 'sig-toggle');
    lab.appendChild(el('span', 'sig-toggle__name', name));
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', name);
    var track = el('span', 'sig-toggle__track');
    lab.appendChild(input);
    lab.appendChild(track);
    input.addEventListener('change', function () { set(input.checked); });
    parent.appendChild(lab);
    return { paint: function () { input.checked = !!get(); }, input: input };
  }

  var panel = el('aside', 'signals-instrument');
  panel.setAttribute('aria-label', 'Void Signals preview instrument');
  var head = el('div', 'signals-instrument__head');
  var title = el('div', 'signals-instrument__title');
  title.innerHTML = '<b>Void Signals</b><span>preview</span>';
  head.appendChild(title);
  head.appendChild(el('div', 'signals-instrument__sub', 'Isolated visual experiment on the live Void galaxy. Simulated local events only — no production data, no notifications, no backend.'));
  head.appendChild(el('span', 'signals-instrument__chip', 'experimental geometry'));
  var hideBtn = el('button', 'signals-instrument__hide', '–');
  hideBtn.type = 'button';
  hideBtn.setAttribute('aria-label', 'Hide preview instrument');
  head.appendChild(hideBtn);
  panel.appendChild(head);

  var scroll = el('div', 'signals-instrument__scroll');
  panel.appendChild(scroll);
  var controls = [];

  /* ---- signals ---- */
  var g1 = group('Signal events');
  var row1 = el('div', 'sig-row');
  button(row1, 'Ambient', 'sig-btn--gold', function () { api.spawn('ambient'); });
  button(row1, 'Important', 'sig-btn--silver', function () { api.spawn('important'); });
  g1.appendChild(row1);
  var row2 = el('div', 'sig-row');
  button(row2, 'Open first message', '', function () {
    var s = api.state.signals[0] || api.state.held[0];
    if (s) api.openMessage(s.msgId);
    else { var m = api.liveMessages()[0]; if (m) api.openMessage(m.id); else api.spawn('ambient'); }
  });
  button(row2, 'Close window', '', function () { api.closeReveal(); });
  g1.appendChild(row2);
  var row2b = el('div', 'sig-row');
  button(row2b, 'Clear field', 'sig-btn--danger', function () { api.clear(); });
  row2b.appendChild(el('span', 'sig-row__note', 'stars only — messages stay available'));
  g1.appendChild(row2b);
  var row3 = el('div', 'sig-row');
  var toneBtn = button(row3, 'Play demo tone', '', function () { startTone(); });
  g1.appendChild(row3);
  controls.push(toggle(g1, 'Experiment on', function () { return api.config.enabled; }, function (v) { api.setConfig({ enabled: v }); }));
  scroll.appendChild(g1);

  /* ---- notification center: the same messages, the same identity ---- */
  var gNc = group('Notification Center · same messages');
  var ncList = el('div', 'sig-nc');
  ncList.id = 'signals-nc-list';
  gNc.appendChild(ncList);
  var ncNote = el('div', 'sig-read__note');
  gNc.appendChild(ncNote);
  var rowNc = el('div', 'sig-row');
  button(rowNc, 'Mark all unread', '', function () {
    api.messages().forEach(function (m) { api.markUnread(m.id); });
    paint();
  });
  button(rowNc, 'New site session', '', function () { api.resetSession(); paint(); });
  gNc.appendChild(rowNc);
  scroll.appendChild(gNc);

  function renderCenter() {
    ncList.textContent = '';
    var msgs = api.liveMessages();
    if (!msgs.length) {
      ncList.appendChild(el('div', 'sig-nc__empty', 'No messages yet in this site session. Spawn a signal above — reading one never removes it here.'));
      ncNote.textContent = '';
      return;
    }
    for (var i = 0; i < msgs.length; i++) {
      (function (m) {
        var sig = null, all = api.state.signals.concat(api.state.held);
        for (var j = 0; j < all.length; j++) if (all[j].msgId === m.id) sig = all[j];
        var row = el('div', 'sig-nc__row' + (api.readState(m.id) ? ' is-read' : ''));
        row.appendChild(el('span', 'sig-nc__pip sig-nc__pip--' + m.type));
        var txt = el('div', 'sig-nc__txt');
        txt.appendChild(el('span', 'sig-nc__title', m.title));
        txt.appendChild(el('span', 'sig-nc__meta', m.id + ' · ' +
          (api.readState(m.id) ? 'read this session' : 'unread') + ' · ' +
          (sig ? (sig.held ? 'held' : 'star #' + sig.k) : 'no star in the field')));
        row.appendChild(txt);
        if (api.revealed() === m.id) row.appendChild(el('span', 'sig-nc__badge', 'open'));
        else if (api.readState(m.id)) row.appendChild(el('span', 'sig-nc__badge sig-nc__badge--dim', 'dim'));
        var b1 = el('button', 'sig-btn sig-btn--mini', 'Open'); b1.type = 'button';
        b1.addEventListener('click', function () { api.openMessage(m.id); });
        var b2 = el('button', 'sig-btn sig-btn--mini', 'Unread'); b2.type = 'button';
        b2.addEventListener('click', function () { api.markUnread(m.id); paint(); });
        var b3 = el('button', 'sig-btn sig-btn--mini sig-btn--danger', 'Remove'); b3.type = 'button';
        b3.addEventListener('click', function () { api.removeMessage(m.id); paint(); });
        row.appendChild(b1); row.appendChild(b2); row.appendChild(b3);
        ncList.appendChild(row);
      })(msgs[i]);
    }
    var st = api.store ? api.store.stats() : {};
    ncNote.textContent = 'Session ' + (st.session || '—') + ' · ' + st.live + ' live · ' + st.read + ' read this session · ' +
      st.unread + ' unread. Same identity, same lifetime as the Galaxy signals: reading from here dims the star, it never consumes the message.';
  }

  /* ---- placement ---- */
  var g2 = group('Placement experiment');
  var ruleOpts = (api.data() ? api.data().rules : []).map(function (r) { return [r.id, r.id + ' · ' + r.label]; });
  var ruleCtl = select(g2, 'Exclusion rule', ruleOpts, function () { return api.config.rule; }, function (v) { api.setConfig({ rule: v }); });
  controls.push(ruleCtl);
  function fillRules() {
    var data = api.data();
    if (!data || ruleCtl.input.options.length) return;
    for (var i = 0; i < data.rules.length; i++) {
      var o = document.createElement('option');
      o.value = data.rules[i].id;
      o.textContent = data.rules[i].id + ' · ' + data.rules[i].label;
      ruleCtl.input.appendChild(o);
    }
    ruleCtl.input.value = api.config.rule;
  }
  controls.push(slider(g2, 'Brightness threshold', 0.05, 0.30, 0.05, function () { return api.config.thr; }, function (v) { api.setConfig({ thr: v }); }, function (v) { return v.toFixed(2); }));
  controls.push(slider(g2, 'Min separation', 32, 148, 2, function () { return api.config.separation; }, function (v) { api.setConfig({ separation: v }); }, function (v) { return v + ' px'; }));
  controls.push(slider(g2, 'Signal size', 14, 56, 1, function () { return api.config.size; }, function (v) { api.setConfig({ size: v }); }, function (v) { return v + ' px'; }));
  controls.push(slider(g2, 'Galaxy centre guard', 0, 0.5, 0.01, function () { return api.config.centreGuard; }, function (v) { api.setConfig({ centreGuard: v }); }, function (v) { return v.toFixed(2) + ' × scale'; }));
  controls.push(select(g2, 'No-position fallback', [['hold', 'Hold in instrument (quiet)'], ['shelf', 'Hold on edge shelf']], function () { return api.config.fallback; }, function (v) { api.setConfig({ fallback: v }); }));
  controls.push(select(g2, 'Candidate order', [['ring', 'Ring around the galaxy'], ['far', 'Darkest corners first'], ['audit', 'A1 audit order']], function () { return api.config.order; }, function (v) { api.setConfig({ order: v }); }));
  controls.push(toggle(g2, 'Cluster companions', function () { return api.config.companions; }, function (v) { api.setConfig({ companions: v }); }));
  controls.push(toggle(g2, 'Reserve dormant rail', function () { return api.config.railReserve; }, function (v) { api.setConfig({ railReserve: v }); }));
  controls.push(toggle(g2, 'Show footprint boxes', function () { return api.config.showBoxes; }, function (v) { api.setConfig({ showBoxes: v }); }));
  controls.push(toggle(g2, 'Show centre guard', function () { return api.config.showCentre; }, function (v) { api.setConfig({ showCentre: v }); }));
  scroll.appendChild(g2);

  /* ---- motion ---- */
  var g3 = group('Light & motion');
  controls.push(slider(g3, 'Entrance', 200, 2000, 50, function () { return api.config.enterMs; }, function (v) { api.setConfig({ enterMs: v }); }, function (v) { return v + ' ms'; }));
  controls.push(slider(g3, 'Ambient glyph lifetime', 0, 40, 1, function () { return Math.round(api.config.lifeMs / 1000); }, function (v) { api.setConfig({ lifeMs: v * 1000 }); }, function (v) { return v === 0 ? 'persistent' : v + ' s'; }));
  controls.push(slider(g3, 'Important glyph lifetime', 0, 60, 1, function () { return Math.round(api.config.importantLifeMs / 1000); }, function (v) { api.setConfig({ importantLifeMs: v * 1000 }); }, function (v) { return v === 0 ? 'persistent' : v + ' s'; }));
  controls.push(slider(g3, 'Glow', 0, 2, 0.05, function () { return api.config.glow; }, function (v) { api.setConfig({ glow: v }); }, function (v) { return v.toFixed(2); }));
  controls.push(toggle(g3, 'Reduced motion', function () { return api.config.reducedMotion; }, function (v) { api.setConfig({ reducedMotion: v }); }));
  controls.push(toggle(g3, 'Auto demo', function () { return api.config.autoDemo; }, function (v) { api.setConfig({ autoDemo: v }); }));
  g3.appendChild(el('div', 'sig-read__note', 'Lifetime controls fade the glyph only. The message itself stays in the Notification Center and reopens from its star — 0 s keeps both.'));
  scroll.appendChild(g3);

  /* ---- star appearance (live mirror of Void Star Studio) ---- */
  var g6 = group('Star appearance · preview only');
  var starMeta = (function () {
    var S = window.VoidStarConfig;
    return S ? S.meta : null;
  })();
  function starGet(k) { var c = api.star(); return c ? c[k] : ''; }
  function starSet(patch) { api.setStar(patch); }
  if (starMeta) {
    controls.push(select(g6, 'Arrangement preset', starMeta.presets.filter(function (p) { return !p.disabled; }).map(function (p) { return [p.id, p.label]; }), function () { return starGet('preset'); }, function (v) { starSet({ preset: v }); api.reStar(); }));
    controls.push(select(g6, 'Star style', starMeta.styles.map(function (s) { return [s.id, s.label]; }), function () { return starGet('style'); }, function (v) { starSet({ style: v }); }));
    controls.push(select(g6, 'Palette', starMeta.colors.map(function (c) { return [c.id, c.label]; }), function () { return starGet('color'); }, function (v) { starSet({ color: v }); }));
    controls.push(select(g6, 'Motion', starMeta.motions.map(function (m) { return [m.id, m.label]; }), function () { return starGet('motion'); }, function (v) { starSet({ motion: v }); }));
    controls.push(slider(g6, 'Star size', 0.5, 2.2, 0.05, function () { return starGet('size'); }, function (v) { starSet({ size: v }); api.reStar(); }, function (v) { return v.toFixed(2) + ' ×'; }));
    controls.push(slider(g6, 'Brightness', 0.3, 1.6, 0.05, function () { return starGet('brightness'); }, function (v) { starSet({ brightness: v }); }, function (v) { return v.toFixed(2); }));
    controls.push(slider(g6, 'Glow intensity', 0, 2, 0.05, function () { return starGet('glow'); }, function (v) { starSet({ glow: v }); }, function (v) { return v.toFixed(2); }));
    controls.push(slider(g6, 'Softness', 0, 1, 0.05, function () { return starGet('softness'); }, function (v) { starSet({ softness: v }); }, function (v) { return v.toFixed(2); }));
    controls.push(slider(g6, 'Movement intensity', 0, 1.6, 0.05, function () { return starGet('motionIntensity'); }, function (v) { starSet({ motionIntensity: v }); }, function (v) { return v.toFixed(2); }));
    controls.push(slider(g6, 'Glow transition', 120, 2600, 20, function () { return starGet('glowTransitionMs'); }, function (v) { starSet({ glowTransitionMs: v }); }, function (v) { return Math.round(v) + ' ms'; }));
    controls.push(toggle(g6, 'Experimental appearance', function () { return !!starGet('experimental'); }, function (v) { api.setExperimental(v); api.reStar(); }));
    var starRow = el('div', 'sig-row');
    button(starRow, 'Reset appearance', '', function () { api.resetStar(); api.reStar(); paint(); });
    starRow.appendChild(el('span', 'sig-row__note', 'Void Star Studio · ?admin=true'));
    g6.appendChild(starRow);
    var starNote = el('div', 'sig-read__note');
    starNote.id = 'signals-star-note';
    g6.appendChild(starNote);
  }
  scroll.appendChild(g6);

  /* ---- session ---- */
  var g4 = group('Session');
  var row4 = el('div', 'sig-row');
  button(row4, 'Reset', '', function () { api.reset(); });
  button(row4, 'Randomize', '', function () { api.randomize(); });
  g4.appendChild(row4);
  var row5 = el('div', 'sig-row');
  button(row5, 'Export JSON', '', function () { api.exportJSON(); });
  button(row5, 'Sample perf', '', function () { api.sampleMetrics(); paint(); });
  g4.appendChild(row5);
  var row6 = el('div', 'sig-row');
  button(row6, 'Compare with A1 audit', '', function () { runAudit(); });
  g4.appendChild(row6);
  var seedNote = el('div', 'sig-read__note');
  g4.appendChild(seedNote);
  scroll.appendChild(g4);

  /* ---- readout ---- */
  var g5 = group('Live readout');
  var read = el('div', 'sig-read');
  var grid = el('div', 'sig-read__grid');
  var cells = {};
  [['placed', 'In field', 'ok'], ['held', 'Held', 'warn'], ['msgs', 'Messages live', 'info'], ['open', 'Window', ''],
   ['rejects', 'Rejected', 'bad'], ['collisions', 'Collisions', 'bad'],
   ['fps', 'Galaxy fps', 'info'], ['cpu', 'Galaxy cpu', 'info'], ['viewport', 'Viewport', ''], ['scale', 'Scale', '']].forEach(function (c) {
    var cell = el('div', 'sig-read__cell');
    cell.appendChild(el('span', 'sig-read__k', c[1]));
    var v = el('span', 'sig-read__v' + (c[2] ? ' sig-read__v--' + c[2] : ''), '—');
    cell.appendChild(v);
    grid.appendChild(cell);
    cells[c[0]] = v;
  });
  read.appendChild(grid);
  var readNote = el('div', 'sig-read__note');
  read.appendChild(readNote);
  g5.appendChild(read);
  var auditNote = el('div', 'sig-read__note');
  g5.appendChild(auditNote);
  var logBox = el('div', 'sig-log');
  g5.appendChild(logBox);
  scroll.appendChild(g5);

  host.appendChild(panel);
  var tab = el('button', 'signals-tab', 'Signals preview');
  tab.type = 'button';
  tab.hidden = true;
  host.appendChild(tab);

  hideBtn.addEventListener('click', function () { panel.hidden = true; tab.hidden = false; api.revalidate(); });
  tab.addEventListener('click', function () { panel.hidden = false; tab.hidden = true; api.revalidate(); });
  /* phone: the galaxy owns the small screen, so the instrument opens from its tab */
  if (window.matchMedia && window.matchMedia('(max-width: 620px)').matches) { panel.hidden = true; tab.hidden = false; }

  /* ---- demo tone: local simulated audio through the public player API ---- */
  var toneStarted = false;
  function startTone() {
    if (toneStarted) return;
    if (!window.VoidMusic || typeof window.VoidMusic.add !== 'function') { toneBtn.textContent = 'Player unavailable'; return; }
    toneBtn.textContent = 'Loading tone…';
    var url = location.origin + '/__sim/audio/demo-tone.wav';
    Promise.resolve(window.VoidMusic.add([{ url: url, name: 'demo-tone.wav' }], {})).then(function () {
      toneStarted = true;
      toneBtn.textContent = 'Demo tone playing';
      toneBtn.disabled = true;
      api.revalidate();
      paint();
    }).catch(function () { toneBtn.textContent = 'Tone failed'; });
  }

  /* ---- audit comparison ---- */
  function runAudit() {
    if (!api.data()) return;
    var rows = api.auditCompare();
    var same = 0, diff = 0, lines = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.auditK1 === null) continue;
      if (r.auditK1 === r.livePlaced) same++;
      else { diff++; if (lines.length < 6) lines.push(r.rule + '@' + r.thr + ' live ' + r.livePlaced + ' vs audit ' + r.auditK1); }
    }
    auditNote.textContent = 'A1 cross-check: ' + same + ' identical, ' + diff + ' different (live DOM chrome + centre guard + resampled mask vs the audit’s fixed chrome set).' + (lines.length ? ' e.g. ' + lines.join('; ') : '');
    paint();
  }

  /* ---- paint ---- */
  function paint() {
    fillRules();
    for (var i = 0; i < controls.length; i++) controls[i].paint();
    renderCenter();
    var sn = document.getElementById('signals-star-note');
    if (sn) {
      var c = api.star();
      sn.textContent = 'Active: ' + c.preset + ' · ' + c.style + ' · ' + c.color + ' · ' + c.motion +
        ' (profile ' + c.activeProfile + '). Preview only — nothing reaches the Worker, D1 or production defaults.';
    }
    var c2 = api.state.counters, g = api.state.geom || api.geometry();
    var rejects = c.edge + c.chrome + c.centre + c.bright + c.separation + c.capacity;
    cells.placed.textContent = String(api.state.signals.length) + '/' + api.config.maxSignals;
    cells.held.textContent = String(api.state.held.length);
    cells.msgs.textContent = String(api.liveMessages().length);
    cells.open.textContent = api.revealed() ? 'open' : 'closed';
    cells.rejects.textContent = String(rejects);
    cells.collisions.textContent = String(c.chrome + c.centre + c.bright);
    var m = api.state.metrics;
    cells.fps.textContent = m && isFinite(m.fps) ? String(Math.round(m.fps)) : '—';
    cells.cpu.textContent = m && isFinite(m.cpuMs) ? m.cpuMs.toFixed(1) + ' ms' : '—';
    cells.viewport.textContent = api.state.vp + ' ' + g.w + '×' + g.h;
    cells.scale.textContent = Math.round(g.scale) + ' px' + (g.live ? '' : ' (formula)');
    var rule = null, data = api.data();
    if (data) for (var r = 0; r < data.rules.length; r++) if (data.rules[r].id === api.config.rule) rule = data.rules[r];
    readNote.textContent = api.config.rule + ' @ ' + api.config.thr.toFixed(2) + (rule ? ' — ' + rule.note : '') +
      ' · seed ' + api.config.seed + ' · ' + api.state.candidates.length + ' candidates · geometry ' + (g.live ? 'live from renderer' : 'formula fallback') +
      '. Experimental: not approved production geometry.';
    seedNote.textContent = 'Seed ' + api.config.seed + ' · deterministic candidate field · production files untouched.';
    logBox.textContent = '';
    if (!api.state.log.length) logBox.appendChild(el('div', 'sig-log__empty', 'No events yet.'));
    for (var j = 0; j < Math.min(api.state.log.length, 24); j++) {
      var L = api.state.log[j];
      var row = el('div', 'sig-log__row');
      row.appendChild(el('span', 'sig-log__tag sig-log__tag--' + L.kind, L.kind));
      row.appendChild(el('span', '', L.text));
      logBox.appendChild(row);
    }
  }
  api.onchange = paint;
  api.onlog = paint;

  /* wait for the placement data, then paint and seed a first impression */
  var tries = 0;
  (function wait() {
    if (api.data() && api.state.ready) {
      paint();
      if (!api.state.signals.length && !api.state.held.length && api.config.enabled) {
        api.spawn('ambient');
        setTimeout(function () { api.spawn('ambient'); }, 900);
        setTimeout(function () { api.spawn('important'); }, 1900);
      }
      return;
    }
    if (tries++ > 90) { paint(); return; }
    setTimeout(wait, 200);
  })();
})();