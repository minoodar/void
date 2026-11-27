/* Void — Star Studio and Signal Profiles (admin).
 *
 * The preview here is local and temporary: a slider changes only this screen. Nothing
 * reaches the worker until an explicit Save, and nothing reaches visitors until an
 * explicit Activate. That split is the worker's own model (a save bumps current_version,
 * activate moves active_version), and every control states which side of the line it is on.
 *
 * Provides the `studio` and `profiles` sections of the Void Signals module through
 * window.VoidSignalsAdminExtra, so void-signals-admin.js stays free of appearance logic.
 */
(function (global) {
  'use strict';

  var DELETE_PROFILE = 'DELETE PROFILE';
  var links = { studio: null, profiles: null };

  function seeded(n) {
    var x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  /* Same preset names as the renderer, own arithmetic: this is a sketch, not the galaxy. */
  function layout(preset, count) {
    var pts = [];
    var i, a, r, t;
    if (preset === 'circular') {
      for (i = 0; i < count; i++) {
        a = (i / count) * Math.PI * 2;
        r = 30 + (i % 3) * 5;
        pts.push({ x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r * .8 });
      }
      return pts;
    }
    if (preset === 'spiral') {
      for (i = 0; i < count; i++) {
        t = i / count;
        a = t * Math.PI * 5.2;
        r = 6 + t * 38;
        pts.push({ x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r * .8 });
      }
      return pts;
    }
    if (preset === 'geometric') {
      var side = Math.max(2, Math.ceil(Math.sqrt(count)));
      for (i = 0; i < count; i++) {
        pts.push({
          x: 16 + (i % side) * (68 / (side - 1)),
          y: 18 + Math.floor(i / side) * (64 / Math.max(1, Math.ceil(count / side) - 1))
        });
      }
      return pts;
    }
    if (preset === 'constellation') {
      for (i = 0; i < count; i++) pts.push({ x: 12 + seeded(i * 3 + 1) * 76, y: 14 + seeded(i * 3 + 2) * 70 });
      return pts;
    }
    if (preset === 'heart') {
      for (i = 0; i < count; i++) {
        a = (i / count) * Math.PI * 2;
        var hx = 16 * Math.pow(Math.sin(a), 3);
        var hy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
        pts.push({ x: 50 + hx * 2.1, y: 50 - hy * 2.1 });
      }
      return pts;
    }
    if (preset === 'star') {
      for (i = 0; i < count; i++) {
        a = (i / count) * Math.PI * 2;
        r = 34 * (1 - 0.42 * Math.abs(Math.sin(a * 2.5)));
        pts.push({ x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r });
      }
      return pts;
    }
    for (i = 0; i < count; i++) {
      var bias = seeded(i * 7 + 5);
      pts.push({ x: 8 + bias * 84, y: 14 + seeded(i * 11 + 3) * 72 - bias * 8 });
    }
    return pts;
  }

  var PALETTE = {
    gold: ['#fcd34d', '#b45309'], silver: ['#e5e7eb', '#6b7280'], white: ['#ffffff', '#94a3b8'],
    ember: ['#fb923c', '#9a3412'], ice: ['#a5d8ff', '#3b6ea5']
  };

  /* ------------------------------------------------------------------ */
  /* star studio                                                         */
  /* ------------------------------------------------------------------ */

  function studioSection(host, shell, sig) {
    var API = global.VoidSignalsApi;
    var draft = API.fullSettings({});
    var profile = null;
    var widgets = [];

    var head_ = shell.el('div', 'va-panelhead');
    var headText = shell.el('div');
    headText.appendChild(shell.el('h2', null, 'Star studio'));
    headText.appendChild(shell.el('p', null,
      'Shape how a signal profile looks. Sliders preview instantly and stay on this screen; a saved version stays private; only Activate changes what visitors see.'));
    head_.appendChild(headText);
    host.appendChild(head_);

    var bar = shell.el('div', 'vsa-studio__bar');
    var picker = document.createElement('select');
    picker.className = 'vsa-input vsa-input--pick';
    picker.setAttribute('aria-label', 'Profile being edited');
    bar.appendChild(shell.el('span', 'vsa-label', 'Profile'));
    bar.appendChild(picker);
    var newBtn = shell.el('button', 'va-btn', 'New profile');
    newBtn.type = 'button';
    bar.appendChild(newBtn);
    host.appendChild(bar);

    var status = shell.el('p', 'vsa-statusline');
    status.setAttribute('role', 'status');
    host.appendChild(status);

    var stage = shell.el('div', 'vsa-stage');
    stage.setAttribute('aria-hidden', 'true');
    host.appendChild(stage);
    var legend = shell.el('div', 'vsa-legend');
    host.appendChild(legend);

    var controls = shell.el('div', 'vsa-controls');
    host.appendChild(controls);

    var acts = shell.el('div', 'vsa-acts');
    host.appendChild(acts);

    function selectWidget(key, label, values) {
      var box = shell.el('label', 'vsa-ctl');
      box.appendChild(shell.el('span', 'vsa-ctl__name', label));
      var input = document.createElement('select');
      input.className = 'vsa-input';
      for (var i = 0; i < values.length; i++) {
        var o = document.createElement('option');
        o.value = values[i];
        o.textContent = values[i];
        input.appendChild(o);
      }
      input.addEventListener('change', function () {
        draft[key] = input.value;
        render();
      });
      box.appendChild(input);
      return {
        node: box, sync: function () { input.value = draft[key]; },
        paint: function () { input.value = draft[key]; }
      };
    }

    function rangeWidget(key, label) {
      var range = API.SETTING_RANGES[key];
      var step = key === 'glowTransitionMs' ? '10' : '0.05';
      var box = shell.el('label', 'vsa-ctl');
      var top = shell.el('div', 'vsa-ctl__top');
      top.appendChild(shell.el('span', 'vsa-ctl__name', label));
      var val = shell.el('span', 'vsa-ctl__val');
      top.appendChild(val);
      box.appendChild(top);
      var slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'vsa-range';
      slider.min = String(range[0]);
      slider.max = String(range[1]);
      slider.step = step;
      slider.setAttribute('aria-label', label);
      var num = document.createElement('input');
      num.type = 'number';
      num.className = 'vsa-num';
      num.min = String(range[0]);
      num.max = String(range[1]);
      num.step = step;
      num.setAttribute('aria-label', label + ' exact value');
      function set(raw) {
        var n = Number(raw);
        if (!isFinite(n)) return;
        n = Math.min(range[1], Math.max(range[0], n));
        draft[key] = key === 'glowTransitionMs' ? Math.round(n) : Math.round(n * 1000) / 1000;
        sync();
        render();
      }
      function sync() {
        slider.value = String(draft[key]);
        num.value = String(draft[key]);
      }
      slider.addEventListener('input', function () { set(slider.value); });
      num.addEventListener('change', function () { set(num.value); });
      box.appendChild(slider);
      box.appendChild(num);
      return {
        node: box, sync: sync,
        paint: function () { val.textContent = key === 'glowTransitionMs' ? Math.round(draft[key]) + ' ms' : String(draft[key]); }
      };
    }

    function buildControls() {
      controls.textContent = '';
      widgets = [
        selectWidget('preset', 'Arrangement', API.SETTING_ENUMS.preset),
        selectWidget('style', 'Star style', API.SETTING_ENUMS.style),
        selectWidget('color', 'Colour', API.SETTING_ENUMS.color),
        selectWidget('motion', 'Motion', API.SETTING_ENUMS.motion),
        rangeWidget('size', 'Size'),
        rangeWidget('brightness', 'Brightness'),
        rangeWidget('glow', 'Halo'),
        rangeWidget('softness', 'Softness'),
        rangeWidget('motionIntensity', 'Motion depth'),
        rangeWidget('glowTransitionMs', 'Glow transition'),
        rangeWidget('drift', 'Drift')
      ];
      for (var i = 0; i < widgets.length; i++) controls.appendChild(widgets[i].node);
    }

    function chip(key, value) {
      var c = shell.el('span', 'vsa-chip');
      c.appendChild(shell.el('b', null, key));
      c.appendChild(shell.el('span', null, value));
      legend.appendChild(c);
    }

    function paintStage() {
      stage.textContent = '';
      var pts = layout(draft.preset, 26);
      var pair = PALETTE[draft.color] || PALETTE.gold;
      var animated = draft.motion !== 'static';
      for (var i = 0; i < pts.length; i++) {
        var star = document.createElement('span');
        star.className = 'vsa-star vsa-star--' + draft.style + (animated ? ' is-live' : '');
        var size = 4 * draft.size * (0.6 + seeded(i * 5 + 2) * 0.9);
        star.style.width = size.toFixed(2) + 'px';
        star.style.height = size.toFixed(2) + 'px';
        star.style.left = pts[i].x.toFixed(2) + '%';
        star.style.top = pts[i].y.toFixed(2) + '%';
        star.style.setProperty('--vsa-core', pair[0]);
        star.style.setProperty('--vsa-rim', pair[1]);
        var lit = Math.min(1, Math.max(.16, draft.brightness));
        star.style.opacity = String(lit);
        star.style.setProperty('--vsa-base', String(lit));
        star.style.setProperty('--vsa-glow', (draft.glow * (2 + draft.size)).toFixed(2));
        star.style.setProperty('--vsa-soft', String(draft.softness));
        star.style.setProperty('--vsa-ms', String(Math.round(draft.glowTransitionMs)));
        star.style.setProperty('--vsa-depth', String(draft.motionIntensity));
        star.style.setProperty('--vsa-drift', String(draft.drift));
        if (animated) star.style.animationDelay = (-seeded(i * 9 + 1) * 4).toFixed(2) + 's';
        stage.appendChild(star);
      }
      legend.textContent = '';
      chip('preset', draft.preset);
      chip('style', draft.style);
      chip('colour', draft.color);
      chip('motion', draft.motion);
      chip('preview', 'this screen only');
    }

    function paintStatus() {
      status.textContent = '';
      if (!profile) {
        status.appendChild(shell.el('span', 'vsa-faint',
          'No profile selected. The sliders edit a local draft; pick a profile to save against one.'));
        return;
      }
      status.appendChild(shell.el('strong', 'vsa-statusline__name', profile.name));
      status.appendChild(shell.el('span', 'vsa-tag', 'saved v' + profile.current_version));
      status.appendChild(profile.published
        ? shell.el('span', 'vsa-tag vsa-tag--live', 'public v' + profile.active_version)
        : shell.el('span', 'vsa-tag vsa-tag--draft', 'nothing public yet'));
      var dirty = differs(profile);
      status.appendChild(shell.el('span', dirty ? 'vsa-tag vsa-tag--dirty' : 'vsa-faint',
        dirty ? 'unsaved preview' : 'matches saved version'));
      if (profile.scopes && profile.scopes.length) {
        status.appendChild(shell.el('span', 'vsa-faint', 'assigned to ' + profile.scopes.join(', ')));
      }
    }

    function differs(prof) {
      var saved = prof.__saved;
      if (!saved) return true;
      for (var i = 0; i < API.SETTING_KEYS.length; i++) {
        if (saved[API.SETTING_KEYS[i]] !== draft[API.SETTING_KEYS[i]]) return true;
      }
      return false;
    }

    function render() {
      for (var i = 0; i < widgets.length; i++) { widgets[i].sync(); widgets[i].paint(); }
      paintStage();
      paintStatus();
    }

    function open(id, wantVersion) {
      return sig.admin.profile(id, true).then(function (result) {
        if (!result.ok) {
          shell.toast(result.error, 'error');
          return;
        }
        profile = result.data.profile;
        profile.__saved = API.fullSettings(result.data.draft_settings);
        var source = result.data.draft_settings || result.data.active_settings;
        if (wantVersion) {
          for (var i = 0; i < result.data.versions.length; i++) {
            if (result.data.versions[i].version === wantVersion) {
              source = result.data.versions[i].settings;
              break;
            }
          }
        }
        draft = API.fullSettings(source);
        picker.value = id;
        render();
      });
    }

    picker.addEventListener('change', function () { if (picker.value) open(picker.value); });

    function refreshProfiles(keep) {
      return sig.admin.profiles().then(function (result) {
        if (!result.ok) {
          status.textContent = '';
          status.appendChild(shell.el('span', 'vsa-error', result.error));
          return;
        }
        var items = result.data.items;
        picker.textContent = '';
        var ph = document.createElement('option');
        ph.value = '';
        ph.textContent = items.length ? 'Choose a profile…' : 'No profiles yet';
        picker.appendChild(ph);
        for (var i = 0; i < items.length; i++) {
          var o = document.createElement('option');
          o.value = items[i].id;
          o.textContent = items[i].name + ' · saved v' + items[i].current_version +
            (items[i].published ? ' · public v' + items[i].active_version : ' · private');
          picker.appendChild(o);
        }
        var want = keep && picker.querySelector('option[value="' + keep + '"]') ? keep : (items[0] && items[0].id);
        if (want) open(want);
      });
    }

    newBtn.addEventListener('click', function () {
      var wrap = shell.el('div', 'vsa-ask');
      wrap.appendChild(shell.el('p', null, 'A new profile starts private. It never becomes public until you activate it.'));
      var name = document.createElement('input');
      name.className = 'vsa-input';
      name.maxLength = API.LIMITS.name;
      name.placeholder = 'Night bloom';
      name.setAttribute('aria-label', 'Profile name');
      wrap.appendChild(name);
      var copyRow = shell.el('label', 'va-field');
      copyRow.appendChild(shell.el('span', null, 'Start from'));
      var copy = document.createElement('select');
      copy.className = 'vsa-input';
      copy.setAttribute('aria-label', 'Copy settings from');
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'default look';
      copy.appendChild(blank);
      var opts = picker.querySelectorAll('option');
      for (var i = 0; i < opts.length; i++) {
        if (!opts[i].value) continue;
        var o = document.createElement('option');
        o.value = opts[i].value;
        o.textContent = opts[i].textContent;
        copy.appendChild(o);
      }
      copyRow.appendChild(copy);
      wrap.appendChild(copyRow);
      shell.prompt('Create a profile', wrap, 'Create').then(function (ok) {
        if (!ok) return;
        var payload = { name: name.value.trim() || 'Untitled profile', settings: draft };
        if (copy.value) payload.from_profile_id = copy.value;
        sig.admin.createProfile(payload).then(function (result) {
          if (!result.ok) { shell.toast(result.error, 'error'); return; }
          shell.toast('Created “' + result.data.profile.name + '” as version 1. It is private until you activate it.', 'success');
          refreshProfiles(result.data.profile.id);
        });
      });
    });

    var saveBtn = shell.el('button', 'va-btn', 'Save as new version');
    var actBtn = shell.el('button', 'va-btn va-btn--primary', 'Save and activate');
    var revertBtn = shell.el('button', 'va-btn', 'Discard preview');
    var copyBtn = shell.el('button', 'va-btn', 'Copy settings JSON');
    var publicBtn = shell.el('button', 'va-btn', 'Show public version');
    [saveBtn, actBtn, revertBtn, copyBtn, publicBtn].forEach(function (b) { b.type = 'button'; acts.appendChild(b); });

    function needProfile() {
      if (profile) return true;
      shell.toast('Choose or create a profile first.', 'error');
      return false;
    }

    function saveThen(done) {
      saveBtn.disabled = true;
      actBtn.disabled = true;
      sig.admin.saveProfile(profile.id, draft, { expected_version: profile.current_version })
        .then(function (result) {
          saveBtn.disabled = false;
          actBtn.disabled = false;
          if (!result.ok) {
            shell.toast(result.error, 'error');
            open(profile.id);
            return;
          }
          profile = result.data.profile;
          profile.__saved = API.fullSettings(result.data.settings);
          draft = API.fullSettings(result.data.settings);
          render();
          done(result.data.saved_version);
        });
    }

    saveBtn.addEventListener('click', function () {
      if (!needProfile()) return;
      saveThen(function (version) {
        shell.toast('Saved as v' + version + '. Visitors still get ' +
          (profile.published ? 'v' + profile.active_version : 'the default look') + '.', 'success');
      });
    });

    function activate(version) {
      sig.admin.activateProfile(profile.id, version).then(function (result) {
        if (!result.ok) { shell.toast(result.error, 'error'); return; }
        shell.toast('v' + result.data.active_version + ' is now the public look' +
          (result.data.previous_active_version ? ' (was v' + result.data.previous_active_version + ').' : ' (nothing was live before).'), 'success');
        open(profile.id);
      });
    }

    actBtn.addEventListener('click', function () {
      if (!needProfile()) return;
      var clean = !differs(profile);
      shell.confirm('Make this look public?',
        clean
          ? 'This activates the saved version v' + profile.current_version + ' of “' + profile.name +
            '”. Nothing new is written; visitors take it at once.'
          : 'This saves the preview as a new version and activates it. Every message that takes its appearance from “' +
            profile.name + '” changes for visitors at once.', 'Activate').then(function (yes) {
              if (!yes) return;
              if (clean) { activate(profile.current_version); return; }
              saveThen(function () { activate(profile.current_version); });
            });
    });

    revertBtn.addEventListener('click', function () {
      if (!profile) { draft = API.fullSettings({}); render(); return; }
      draft = API.fullSettings(profile.__saved);
      render();
      shell.toast('Preview reset to v' + profile.current_version + '. Nothing was sent.', 'success');
    });

    copyBtn.addEventListener('click', function () {
      var text = JSON.stringify(draft, null, 2);
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        shell.toast('This browser blocks clipboard access. Use Show public version to read the JSON.', 'error');
        return;
      }
      navigator.clipboard.writeText(text).then(function () {
        shell.toast('Settings JSON copied.', 'success');
      }, function () { shell.toast('Clipboard write was refused.', 'error'); });
    });

    publicBtn.addEventListener('click', function () {
      if (!profile) { shell.toast('Choose a profile first.', 'error'); return; }
      var box = shell.el('pre', 'vsa-json');
      if (!profile.published) {
        box.textContent = 'Nothing is public for this profile yet — visitors use the built-in default look.';
      } else {
        sig.admin.profile(profile.id, false).then(function (result) {
          box.textContent = result.ok ? JSON.stringify(result.data.active_settings, null, 2) : result.error;
        });
      }
      var wrap = shell.el('div', 'vsa-ask');
      wrap.appendChild(shell.el('p', null, 'Public version v' + (profile.active_version || 0) + ' as stored on the worker:'));
      wrap.appendChild(box);
      shell.prompt('What visitors actually get', wrap, 'Close');
    });

    buildControls();
    render();

    host.__enter = function () { refreshProfiles(profile && profile.id); };
    host.__reset = function () {
      profile = null;
      draft = API.fullSettings({});
      render();
    };
    links.studio = { open: open };
  }

  /* ------------------------------------------------------------------ */
  /* profiles, versions and manual assignment                            */
  /* ------------------------------------------------------------------ */

  function profilesSection(host, shell, sig) {
    var API = global.VoidSignalsApi;
    var items = [];
    var versionsFor = null;

    var head_ = shell.el('div', 'va-panelhead');
    var headText = shell.el('div');
    headText.appendChild(shell.el('h2', null, 'Signal profiles'));
    headText.appendChild(shell.el('p', null,
      'A profile is a named appearance with an append-only version trail. Assignment stays manual — global, per category or per weight — and only an activated version can be assigned.'));
    head_.appendChild(headText);
    host.appendChild(head_);

    var err = shell.el('p', 'vsa-error');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    host.appendChild(err);

    var wrap = shell.el('div', 'va-table-wrap');
    var table = document.createElement('table');
    table.className = 'va-table';
    table.innerHTML = '<thead><tr><th scope="col">Profile</th><th scope="col">Saved</th><th scope="col">Public</th>' +
      '<th scope="col">Messages</th><th scope="col">Assigned to</th><th scope="col">Actions</th></tr></thead><tbody></tbody>';
    wrap.appendChild(table);
    var empty = shell.el('p', 'va-empty', 'No profiles yet. The galaxy uses its built-in default look.');
    wrap.appendChild(empty);
    host.appendChild(wrap);
    var tbody = table.querySelector('tbody');

    var assignBox = shell.el('div', 'vsa-assign');
    host.appendChild(assignBox);
    var versionBox = shell.el('div', 'vsa-versions');
    host.appendChild(versionBox);

    function btn(label, cls, fn) {
      var b = shell.el('button', 'vsa-abtn' + (cls ? ' ' + cls : ''), label);
      b.type = 'button';
      b.addEventListener('click', fn);
      return b;
    }

    function profileRow(p) {
      var tr = document.createElement('tr');
      var nameCell = document.createElement('td');
      nameCell.appendChild(shell.el('div', 'vsa-strong', p.name));
      var id = shell.el('div', 'vsa-id', shell.shortId(p.id));
      id.title = p.id;
      nameCell.appendChild(id);
      tr.appendChild(nameCell);
      tr.appendChild(shell.el('td', null, 'v' + p.current_version));
      var pubCell = document.createElement('td');
      pubCell.appendChild(p.published
        ? shell.el('span', 'vsa-tag vsa-tag--live', 'v' + p.active_version)
        : shell.el('span', 'vsa-tag vsa-tag--draft', 'private'));
      tr.appendChild(pubCell);
      tr.appendChild(shell.el('td', null, p.message_count ? String(p.message_count) : 'none'));
      tr.appendChild(shell.el('td', null, p.scopes && p.scopes.length ? p.scopes.join(', ') : '—'));
      var actsCell = document.createElement('td');
      var box = shell.el('div', 'vsa-actions');
      box.appendChild(btn('Edit in studio', null, function () {
        shell.go('signals', 'studio');
        if (links.studio) links.studio.open(p.id);
      }));
      box.appendChild(btn('Versions', null, function () { showVersions(p.id); }));
      box.appendChild(btn('Duplicate', null, function () {
        sig.admin.duplicateProfile(p.id).then(function (r) {
          if (!r.ok) { shell.toast(r.error, 'error'); return; }
          shell.toast('Copied as “' + r.data.profile.name + '” — private until activated.', 'success');
          load();
        });
      }));
      box.appendChild(btn('Delete', 'is-danger', function () { deleteProfile(p); }));
      actsCell.appendChild(box);
      tr.appendChild(actsCell);
      return tr;
    }

    function deleteProfile(p) {
      shell.confirm('Delete this profile?',
        'Its versions go with it. A profile that is assigned to a scope or referenced by a message cannot be deleted, so revoke or reassign those first.',
        'Delete profile', true).then(function (yes) {
          if (!yes) return;
          var wrap_ = shell.el('div', 'vsa-ask');
          wrap_.appendChild(shell.el('p', null, 'Confirm with the exact phrase ' + DELETE_PROFILE + '.'));
          var input = document.createElement('input');
          input.className = 'vsa-input';
          input.autocomplete = 'off';
          input.setAttribute('aria-label', 'Confirmation phrase');
          wrap_.appendChild(input);
          shell.prompt('Delete profile permanently', wrap_, 'Delete').then(function (ok) {
            if (!ok) return;
            sig.admin.deleteProfile(p.id, input.value.trim()).then(function (r) {
              if (!r.ok) {
                shell.toast(r.error + (r.status === 409 ? ' Nothing was deleted.' : ''), 'error');
                load();
                return;
              }
              shell.toast('Profile deleted.', 'success');
              if (versionsFor === p.id) { versionsFor = null; versionBox.textContent = ''; }
              load();
            });
          });
        });
    }

    function renderAssign() {
      assignBox.textContent = '';
      assignBox.appendChild(shell.el('h3', 'vsa-h3', 'Manual assignment'));
      var active = items.filter(function (p) { return p.published; });
      if (!active.length) {
        assignBox.appendChild(shell.el('p', 'vsa-faint',
          'No profile has an activated version, so there is nothing to assign. Save a profile, then activate it.'));
        return;
      }
      var scopes = [{ key: 'global', label: 'Everything' }];
      var i;
      for (i = 0; i < API.CATEGORIES.length; i++) scopes.push({ key: 'category:' + API.CATEGORIES[i], label: 'Category · ' + API.CATEGORIES[i] });
      for (i = 0; i < API.IMPORTANCES.length; i++) scopes.push({ key: 'importance:' + API.IMPORTANCES[i], label: 'Weight · ' + API.IMPORTANCES[i] });

      sig.admin.assignments().then(function (result) {
        var current = {};
        if (result.ok) {
          for (var k = 0; k < result.data.items.length; k++) current[result.data.items[k].scope] = result.data.items[k].profile_id;
        }
        var grid = shell.el('div', 'vsa-assign__grid');
        for (var s = 0; s < scopes.length; s++) {
          grid.appendChild(assignRow(scopes[s], active, current));
        }
        assignBox.appendChild(grid);
        if (!result.ok) assignBox.appendChild(shell.el('p', 'vsa-error', result.error));
        assignBox.appendChild(shell.el('p', 'vsa-faint',
          'Narrowest match wins: a profile set on a message beats its category, which beats its weight, which beats Everything.'));
      });
    }

    function assignRow(scope, active, current) {
      var row = shell.el('div', 'vsa-assign__row');
      row.appendChild(shell.el('span', 'vsa-assign__label', scope.label));
      var select = document.createElement('select');
      select.className = 'vsa-input vsa-input--sm';
      select.setAttribute('aria-label', 'Profile for ' + scope.label);
      var none = document.createElement('option');
      none.value = '';
      none.textContent = 'default look';
      select.appendChild(none);
      for (var a = 0; a < active.length; a++) {
        var o = document.createElement('option');
        o.value = active[a].id;
        o.textContent = active[a].name + ' v' + active[a].active_version;
        select.appendChild(o);
      }
      select.value = current[scope.key] || '';
      var note = shell.el('span', 'vsa-assign__note', select.value ? 'assigned' : 'default');
      select.addEventListener('change', function () {
        note.textContent = 'saving…';
        sig.admin.assign(scope.key, select.value || null).then(function (r) {
          if (!r.ok) {
            note.textContent = 'refused';
            select.value = current[scope.key] || '';
            shell.toast(r.error, 'error');
            return;
          }
          current[scope.key] = select.value || null;
          note.textContent = select.value ? 'assigned' : 'cleared';
          shell.toast(scope.label + ' now uses ' + (select.value ? 'that profile' : 'the default look') + '.', 'success');
          load();
        });
      });
      row.appendChild(select);
      row.appendChild(note);
      return row;
    }

    function showVersions(id) {
      versionsFor = id;
      sig.admin.profile(id, true).then(function (result) {
        if (!result.ok) { shell.toast(result.error, 'error'); return; }
        var prof = result.data.profile;
        var name = null;
        for (var i = 0; i < items.length; i++) if (items[i].id === id) name = items[i].name;
        versionBox.textContent = '';
        versionBox.appendChild(shell.el('h3', 'vsa-h3', 'Version trail — ' + (name || prof.name)));
        versionBox.appendChild(shell.el('p', 'vsa-faint',
          'Restoring copies an older look forward as a new version. History is never rewritten, and the public version only changes if you activate.'));
        if (!result.data.versions.length) {
          versionBox.appendChild(shell.el('p', 'vsa-empty', 'This profile has no stored versions.'));
          return;
        }
        var list = shell.el('ol', 'vsa-vlist');
        for (var v = 0; v < result.data.versions.length; v++) {
          list.appendChild(versionItem(result.data.versions[v], prof, id));
        }
        versionBox.appendChild(list);
      });
    }

    function versionItem(v, prof, id) {
      var li = document.createElement('li');
      li.appendChild(shell.el('span', 'vsa-vlist__v', 'v' + v.version));
      li.appendChild(shell.el('span', 'vsa-vlist__meta', shell.fmtTime(v.created_at) + ' · ' + (v.created_by || 'system')));
      if (v.active) li.appendChild(shell.el('span', 'vsa-tag vsa-tag--live', 'public'));
      else if (v.version === prof.current_version) li.appendChild(shell.el('span', 'vsa-tag', 'latest saved'));
      var s = v.settings || {};
      li.appendChild(shell.el('span', 'vsa-vlist__sum',
        [s.preset, s.style, s.color, s.motion, 'size ' + s.size, 'glow ' + s.glow].filter(Boolean).join(' · ')));
      var box = shell.el('div', 'vsa-actions');
      box.appendChild(btn('Restore', null, function () {
        sig.admin.restoreProfile(id, v.version, false).then(function (r) {
          if (!r.ok) { shell.toast(r.error, 'error'); return; }
          shell.toast('v' + v.version + ' copied forward as v' + r.data.profile.current_version + '. Public look unchanged.', 'success');
          showVersions(id);
          load();
        });
      }));
      if (!v.active) {
        box.appendChild(btn('Restore and activate', 'vsa-abtn--publish', function () {
          shell.confirm('Make v' + v.version + ' public?',
            'Restoring copies it forward and activates it in one step. Visitors switch immediately.', 'Activate').then(function (yes) {
              if (!yes) return;
              sig.admin.restoreProfile(id, v.version, true).then(function (r) {
                if (!r.ok) { shell.toast(r.error, 'error'); return; }
                shell.toast('v' + r.data.active_version + ' is public.', 'success');
                showVersions(id);
                load();
              });
            });
        }));
      }
      box.appendChild(btn('Load into studio', null, function () {
        shell.go('signals', 'studio');
        if (links.studio) links.studio.open(id, v.version);
      }));
      li.appendChild(box);
      return li;
    }

    function load() {
      return sig.admin.profiles().then(function (result) {
        if (!result.ok) {
          err.hidden = false;
          err.textContent = result.error;
          return;
        }
        err.hidden = true;
        items = result.data.items;
        tbody.textContent = '';
        for (var i = 0; i < items.length; i++) tbody.appendChild(profileRow(items[i]));
        empty.hidden = items.length > 0;
        renderAssign();
        if (versionsFor) {
          var still = null;
          for (var k = 0; k < items.length; k++) if (items[k].id === versionsFor) still = items[k];
          if (still) showVersions(versionsFor);
          else { versionsFor = null; versionBox.textContent = ''; }
        }
      });
    }

    host.__enter = function () { load(); };
    host.__reset = function () { items = []; versionsFor = null; };
    links.profiles = { render: load };
  }

  global.VoidSignalsAdminExtra = {
    studio: studioSection,
    profiles: profilesSection
  };
})(typeof window !== 'undefined' ? window : globalThis);
