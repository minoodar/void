/* Void — Signals administration.
 *
 * The third module of the control room. Every control here calls the real
 * /admin/signals API through the shared shell transport: nothing is simulated, and a
 * write is only reported as done after the worker has answered.
 *
 * Sections: overview, messages, studio, profiles, schedule, active, history.
 * The studio and profile workspaces are provided by void-star-studio.js.
 */
(function (global) {
  'use strict';

  var DELETE_WORD = 'DELETE SIGNAL';
  var REFRESH_MS = 0; /* no polling: the operator presses Refresh */

  function build(shell) {
    var API = global.VoidSignalsApi;
    if (!API) {
      shell.toast('The signals API client did not load.', 'error');
      return;
    }
    var el = shell.el;
    var sig = API.create(function (path, options) {
      return shell.api(path, options);
    });
    var pub = API.forPage();

    var st = {
      totals: null,
      rows: [],
      filters: { status: 'all', category: 'all', importance: 'all' },
      serverTime: 0,
      version: null,
      publicIds: [],
      loaded: {},
      openRow: null,
      busy: false
    };

    /* ---------------- tiny shared pieces ---------------- */

    function pill(text, kind) {
      var span = el('span', 'vsa-pill' + (kind ? ' vsa-pill--' + kind : ''), text);
      return span;
    }

    function statusPill(row) {
      var kind = row.status === 'active' ? 'live' : row.status === 'scheduled' ? 'wait' :
        row.status === 'revoked' ? 'off' : row.status === 'expired' ? 'gone' :
          row.status === 'hidden' ? 'hidden' : 'draft';
      var label = row.status + (row.status === 'active' && !row.eligible ? ' (not eligible)' : '');
      return pill(label, kind);
    }

    function head(section, title, note, actionNode) {
      var wrap = el('div', 'va-panelhead');
      var texts = el('div');
      texts.appendChild(el('h2', null, title));
      if (note) texts.appendChild(el('p', null, note));
      wrap.appendChild(texts);
      if (actionNode) wrap.appendChild(actionNode);
      section.appendChild(wrap);
      return texts;
    }

    function busy(host, on) {
      host.classList.toggle('is-busy', !!on);
      st.busy = !!on;
    }

    function errorNote(host, result) {
      var note = host.querySelector('[data-role="error"]');
      if (!note) {
        note = el('p', 'vsa-error');
        note.setAttribute('role', 'alert');
        note.setAttribute('data-role', 'error');
        host.insertBefore(note, host.firstChild);
      }
      note.hidden = !result;
      if (result) note.textContent = result;
    }

    function when(sec) {
      if (!sec) return 'never';
      var skew = st.serverTime ? (Date.now() / 1000 - st.serverTime) : 0;
      var delta = Math.round(sec - skew - Date.now() / 1000);
      if (delta <= 0 && delta > -60) return 'now';
      var abs = Math.abs(delta);
      var unit = abs >= 86400 ? Math.round(abs / 86400) + 'd' : abs >= 3600 ? Math.round(abs / 3600) + 'h' :
        abs >= 60 ? Math.round(abs / 60) + 'm' : abs + 's';
      return (delta > 0 ? 'in ' : '') + unit + (delta > 0 ? '' : ' ago');
    }

    /* ---------------- overview ---------------- */

    function buildOverview(host) {
      head(host, 'Void Signals', 'What the galaxy is serving right now, read from the worker on demand.');
      var grid = el('div', 'vsa-grid');
      host.appendChild(grid);
      var feed = el('div', 'vsa-note-block');
      host.appendChild(feed);

      host.__render = function () {
        grid.textContent = '';
        function stat(k, v, n) {
          var box = el('div', 'va-stat');
          box.appendChild(el('span', 'va-stat__k', k));
          box.appendChild(el('span', 'va-stat__v', v));
          if (n) box.appendChild(el('span', 'va-stat__n', n));
          grid.appendChild(box);
        }
        if (st.version === null) stat('Worker', 'unreachable', 'Signals storage did not answer.');
        else stat('Storage version', String(st.version), 'Changes with every write.');
        var t = st.totals || {};
        stat('Live to visitors', String(t.active || 0), (t.active || 0) + ' active rows, max 60.');
        stat('Scheduled', String(t.scheduled || 0), 'Private until due.');
        stat('Drafts', String(t.draft || 0), 'Never public.');
        stat('Hidden', String(t.hidden || 0), 'Retired, restorable.');
        stat('Expired', String(t.expired || 0), 'Time ran out.');
        stat('Revoked', String(t.revoked || 0), 'Terminal.');

        feed.textContent = '';
        if (!st.publicIds.length) {
          feed.appendChild(el('p', 'vsa-empty', 'The public feed is empty: visitors currently see no signals.'));
          return;
        }
        feed.appendChild(el('p', 'vsa-hint', 'Public feed, read without a credential — the same ids the galaxy and the Notification Center use:'));
        var list = el('ul', 'vsa-ids');
        for (var i = 0; i < st.publicIds.length && i < 12; i++) {
          list.appendChild(el('li', null, st.publicIds[i]));
        }
        feed.appendChild(list);
        if (st.publicIds.length > 12) feed.appendChild(el('p', 'vsa-faint', (st.publicIds.length - 12) + ' more.'));
      };
    }

    /* ---------------- messages (notification management) ---------------- */

    function toolbar(host) {
      var bar = el('div', 'va-toolbar');
      bar.appendChild(select(host, bar, 'Status', ['all'].concat(API.STATUSES), st.filters, 'status'));
      bar.appendChild(select(host, bar, 'Category', ['all'].concat(API.CATEGORIES), st.filters, 'category'));
      bar.appendChild(select(host, bar, 'Importance', ['all'].concat(API.IMPORTANCES), st.filters, 'importance'));
      var count = el('span', 'va-toolbar__count');
      count.setAttribute('data-role', 'count');
      bar.appendChild(count);
      var reload = el('button', 'va-btn', 'Refresh');
      reload.type = 'button';
      reload.addEventListener('click', function () { loadRows(true); });
      bar.appendChild(reload);
      host.appendChild(bar);
      return bar;
    }

    function select(host, bar, label, values, store, key) {
      var wrap = el('label', 'va-select');
      wrap.appendChild(el('span', null, label));
      var box = document.createElement('select');
      for (var i = 0; i < values.length; i++) {
        var opt = document.createElement('option');
        opt.value = values[i];
        opt.textContent = values[i] === 'all' ? 'All' : values[i];
        box.appendChild(opt);
      }
      box.value = store[key];
      box.addEventListener('change', function () {
        store[key] = box.value;
        loadRows(true);
      });
      wrap.appendChild(box);
      return wrap;
    }

    function buildMessages(host) {
      head(host, 'Notification management',
        'Draft, edit and move signals through their lifecycle. Editing text never publishes a message.',
        composerToggle(host));
      toolbar(host);
      host.appendChild(composer(host));
      var table = el('div', 'va-table-wrap vsa-table-wrap');
      var tableEl = document.createElement('table');
      tableEl.className = 'va-table vsa-table';
      tableEl.innerHTML = '<thead><tr><th scope="col">Status</th><th scope="col">Title</th>' +
        '<th scope="col">Category</th><th scope="col">Weight</th><th scope="col">Published</th>' +
        '<th scope="col">Due</th><th scope="col">Expires</th><th scope="col"><span class="va-sr">Actions</span></th></tr></thead><tbody></tbody>';
      table.appendChild(tableEl);
      var empty = el('p', 'va-empty', 'No signals match this filter.');
      table.appendChild(empty);
      host.appendChild(table);
      host.__table = tableEl.querySelector('tbody');
      host.__empty = empty;
      host.__count = function () { return host.querySelector('[data-role="count"]'); };
    }

    function composerToggle(host) {
      var btn = el('button', 'va-btn va-btn--primary', 'New signal');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var box = host.querySelector('[data-role="composer"]');
        if (!box) return;
        box.hidden = !box.hidden;
        if (!box.hidden) {
          var first = box.querySelector('input, textarea');
          if (first) try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
        }
      });
      return btn;
    }

    function composer(host) {
      var box = el('form', 'vsa-composer');
      box.setAttribute('data-role', 'composer');
      box.hidden = true;
      box.noValidate = true;

      function field(label, tag, key, opts) {
        var wrap = el('label', 'va-field');
        wrap.appendChild(el('span', null, label));
        var input = document.createElement(tag);
        input.name = key;
        input.id = 'vsa-c-' + key;
        if (opts && opts.attrs) { for (var a in opts.attrs) if (Object.prototype.hasOwnProperty.call(opts.attrs, a)) input.setAttribute(a, opts.attrs[a]); }
        if (opts && opts.options) {
          for (var i = 0; i < opts.options.length; i++) {
            var o = document.createElement('option');
            o.value = opts.options[i];
            o.textContent = opts.options[i];
            input.appendChild(o);
          }
        }
        if (opts && opts.value) input.value = opts.value;
        wrap.appendChild(input);
        return wrap;
      }

      box.appendChild(field('Title', 'input', 'title', { attrs: { maxlength: String(API.LIMITS.title), placeholder: 'A letter reached the void', required: 'required' } }));
      var bodyField = field('Message (3–500 characters)', 'textarea', 'body', { attrs: { rows: '3', maxlength: String(API.LIMITS.body), required: 'required' } });
      box.appendChild(bodyField);
      var row = el('div', 'vsa-composer__row');
      row.appendChild(field('Category', 'select', 'category', { options: API.CATEGORIES }));
      row.appendChild(field('Importance', 'select', 'importance', { options: API.IMPORTANCES }));
      row.appendChild(field('Start as', 'select', 'status', { options: ['draft', 'scheduled', 'active'] }));
      box.appendChild(row);
      var whenRow = el('div', 'vsa-composer__row');
      whenRow.appendChild(field('Publish at (for “scheduled”)', 'input', 'scheduled_at', { attrs: { type: 'datetime-local' } }));
      whenRow.appendChild(field('Lifetime in hours (optional)', 'input', 'lifetime', { attrs: { type: 'number', min: '1', max: '8760', step: '1', placeholder: 'until removed' } }));
      box.appendChild(whenRow);
      var byRow = el('div', 'vsa-composer__row');
      byRow.appendChild(field('Author label (optional)', 'input', 'created_by', { attrs: { maxlength: String(API.LIMITS.actor), placeholder: 'owner' } }));
      box.appendChild(byRow);
      var err = el('p', 'vsa-error');
      err.setAttribute('role', 'alert');
      err.hidden = true;
      box.appendChild(err);
      var acts = el('div', 'vsa-composer__actions');
      var submit = el('button', 'va-btn va-btn--primary', 'Create signal');
      submit.type = 'submit';
      var cancel = el('button', 'va-btn', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', function () { box.hidden = true; });
      acts.appendChild(submit);
      acts.appendChild(cancel);
      box.appendChild(acts);

      box.addEventListener('submit', function (event) {
        event.preventDefault();
        var value = {};
        var elements = box.elements;
        for (var i = 0; i < elements.length; i++) {
          var node = elements[i];
          if (!node.name) continue;
          value[node.name] = node.value;
        }
        err.hidden = true;
        var payload = {
          title: value.title,
          body: value.body,
          category: value.category,
          importance: value.importance,
          status: value.status
        };
        if (value.created_by) payload.created_by = value.created_by;
        if (value.lifetime) payload.expires_in = Math.round(Number(value.lifetime) * 3600);
        if (value.scheduled_at) {
          var secs = API.inputToSec(value.scheduled_at);
          if (secs) payload.scheduled_at = secs;
        }
        if (payload.status === 'active' && (st.totals ? st.totals.active >= API.LIMITS.maxActive : false)) {
          err.hidden = false;
          err.textContent = 'The galaxy already has ' + API.LIMITS.maxActive + ' live signals. Retire one first, or start as a draft.';
          return;
        }
        submit.disabled = true;
        submit.textContent = 'Creating…';
        sig.admin.create(payload).then(function (result) {
          submit.disabled = false;
          submit.textContent = 'Create signal';
          if (!result.ok) {
            err.hidden = false;
            err.textContent = result.error;
            return;
          }
          box.hidden = true;
          box.reset();
          shell.toast('Signal created as ' + result.data.message.status + '.', 'success');
          loadRows(true);
        });
      });
      return box;
    }

    function actionButtons(row) {
      var wrap = el('div', 'vsa-actions');
      var allowed = API.NEXT[row.status] || [];
      for (var i = 0; i < allowed.length; i++) {
        var action = allowed[i];
        var meta = API.ACTIONS[action];
        var btn = el('button', 'vsa-abtn vsa-abtn--' + action, meta.label);
        btn.type = 'button';
        btn.setAttribute('data-action', action);
        btn.setAttribute('data-id', row.id);
        btn.setAttribute('data-version', String(row.state_version));
        if (meta.terminal) btn.classList.add('is-danger');
        wrap.appendChild(btn);
      }
      var del = el('button', 'vsa-abtn vsa-abtn--delete', 'Delete');
      del.type = 'button';
      del.setAttribute('data-action', 'delete');
      del.setAttribute('data-id', row.id);
      del.setAttribute('data-version', String(row.state_version));
      wrap.appendChild(del);
      return wrap;
    }

    function messageRow(row) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-id', row.id);
      function td(node) { var c = document.createElement('td'); c.appendChild(node); return c; }
      function text(value, cls) { return el('span', cls || 'vsa-cell', value || '—'); }

      var statusCell = el('td');
      statusCell.appendChild(statusPill(row));
      var idLine = el('div', 'vsa-id');
      idLine.textContent = shell.shortId(row.id);
      idLine.title = row.id;
      statusCell.appendChild(idLine);
      tr.appendChild(statusCell);

      var titleCell = el('td');
      var titleBtn = el('button', 'vsa-title', row.title);
      titleBtn.type = 'button';
      titleBtn.setAttribute('data-action', 'toggle');
      titleBtn.setAttribute('data-id', row.id);
      titleBtn.setAttribute('aria-expanded', 'false');
      titleCell.appendChild(titleBtn);
      var bodyLine = el('div', 'vsa-body-preview');
      bodyLine.hidden = true;
      bodyLine.textContent = row.body;
      titleCell.appendChild(bodyLine);
      tr.appendChild(titleCell);

      tr.appendChild(td(text(row.category, 'vsa-cell vsa-cell--muted')));
      tr.appendChild(td(pill(row.importance, row.importance === 'important' ? 'important' : 'ambient')));
      tr.appendChild(td(text(row.published_at ? shell.fmtTime(row.published_at) + ' · ' + when(row.published_at) : 'not published')));
      tr.appendChild(td(text(row.scheduled_at ? shell.fmtTime(row.scheduled_at) + ' · ' + when(row.scheduled_at) : '—')));
      tr.appendChild(td(text(row.expires_at ? shell.fmtTime(row.expires_at) + ' · ' + when(row.expires_at) : 'open ended')));
      tr.appendChild(td(actionButtons(row)));
      return tr;
    }

    function detailRow(row) {
      var tr = document.createElement('tr');
      tr.className = 'vsa-detail';
      tr.setAttribute('data-detail-for', row.id);
      tr.hidden = true;
      var td = document.createElement('td');
      td.setAttribute('colspan', '8');
      var box = el('div', 'vsa-detail__box');

      var meta = el('div', 'vsa-meta');
      function kv(k, v) {
        var item = el('span', 'vsa-meta__item');
        item.appendChild(el('b', null, k));
        item.appendChild(el('span', null, v));
        meta.appendChild(item);
      }
      kv('id', row.id);
      kv('state', row.status);
      kv('version', String(row.state_version));
      kv('created', shell.fmtTime(row.created_at));
      kv('updated', shell.fmtTime(row.updated_at));
      kv('author', row.created_by || '—');
      kv('profile', row.profile_id || 'assigned by scope rules');
      box.appendChild(meta);
      box.appendChild(el('p', 'vsa-detail__body', row.body));
      if (row.metadata && Object.keys(row.metadata).length) {
        var keys = Object.keys(row.metadata);
        var line = el('p', 'vsa-faint');
        line.textContent = 'extras: ' + keys.map(function (k) { return k + '=' + row.metadata[k]; }).join(', ');
        box.appendChild(line);
      }
      box.appendChild(editForm(row));
      td.appendChild(box);
      tr.appendChild(td);
      return tr;
    }

    function editForm(row) {
      var form = el('form', 'vsa-edit');
      form.setAttribute('data-role', 'edit');
      var title = document.createElement('input');
      title.className = 'vsa-input';
      title.name = 'title';
      title.maxLength = API.LIMITS.title;
      title.value = row.title;
      title.setAttribute('aria-label', 'Title');
      var body = document.createElement('textarea');
      body.className = 'vsa-input';
      body.name = 'body';
      body.rows = 3;
      body.maxLength = API.LIMITS.body;
      body.value = row.body;
      body.setAttribute('aria-label', 'Message body');
      var err = el('p', 'vsa-error');
      err.hidden = true;
      err.setAttribute('role', 'alert');
      var save = el('button', 'va-btn va-btn--primary', 'Save text');
      save.type = 'submit';
      form.appendChild(title);
      form.appendChild(body);
      form.appendChild(err);
      form.appendChild(save);
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        save.disabled = true;
        sig.admin.update(row.id, {
          title: title.value,
          body: body.value,
          expected_version: row.state_version
        }).then(function (result) {
          save.disabled = false;
          if (!result.ok) {
            err.hidden = false;
            err.textContent = result.error + (result.current_version !== null ? ' (now at version ' + result.current_version + ')' : '');
            if (result.current_version !== null) loadRows(true);
            return;
          }
          shell.toast('Text saved. Status stayed ' + result.data.status + '.', 'success');
          loadRows(true);
        });
      });
      return form;
    }

    function loadRows(force) {
      var host = hosts.messages;
      if (!host) return;
      if (!force && st.loaded.messages && st.rows.length) { renderRows(); return; }
      busy(host, true);
      errorNote(host, '');
      Promise.all([
        sig.admin.list(st.filters),
        pub.feed(API.LIMITS.publicMax).catch(function () { return { ok: false }; })
      ]).then(function (res) {
        busy(host, false);
        var list = res[0];
        if (!list.ok) {
          errorNote(host, list.error);
          if (list.status === 401 || list.status === 403) return;
          return;
        }
        st.rows = list.data.items;
        st.totals = list.data.total;
        st.serverTime = list.data.server_time || Math.round(Date.now() / 1000);
        st.version = list.data.version;
        var feed = res[1];
        st.publicIds = feed && feed.ok ? feed.data.messages.map(function (m) { return m.id; }) : [];
        st.loaded.messages = true;
        renderRows();
        shell.setCount('signals', (st.totals.active || 0) + (st.totals.scheduled || 0));
        if (hosts.overview && hosts.overview.__render) hosts.overview.__render();
      });
    }

    function renderRows() {
      var host = hosts.messages;
      var tbody = host.__table;
      tbody.textContent = '';
      for (var i = 0; i < st.rows.length; i++) {
        var row = st.rows[i];
        tbody.appendChild(messageRow(row));
        tbody.appendChild(detailRow(row));
      }
      host.__empty.hidden = st.rows.length > 0;
      var count = host.__count();
      if (count) {
        var t = st.totals || {};
        count.textContent = st.rows.length + ' shown · ' + (t.active || 0) + ' live · ' + (t.scheduled || 0) + ' scheduled · ' + (t.draft || 0) + ' draft';
      }
    }

    function onMessagesClick(event) {
      var btn = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var action = btn.getAttribute('data-action');
      if (!id) return;
      if (action === 'toggle') { toggleDetail(id, btn); return; }
      if (action === 'delete') { confirmDelete(id, btn); return; }
      runTransition(id, action, btn);
    }

    function toggleDetail(id, btn) {
      var host = hosts.messages;
      var detail = host.querySelector('[data-detail-for="' + id + '"]');
      if (!detail) return;
      var open = detail.hidden;
      detail.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      var body = host.querySelector('[data-id="' + id + '"] .vsa-body-preview');
      if (body) body.hidden = !open;
    }

    function runTransition(id, action, btn) {
      var meta = API.ACTIONS[action];
      var extra = { expected_version: Number(btn.getAttribute('data-version')) };

      function send(values) {
        btn.disabled = true;
        sig.admin.transition(id, action, values || extra).then(function (result) {
          btn.disabled = false;
          if (!result.ok) {
            var hint = result.error;
            if (result.allowed) hint += ' Allowed: ' + result.allowed.join(', ') + '.';
            if (result.current_version !== null) hint += ' Row is at version ' + result.current_version + '.';
            shell.toast(hint, 'error');
            loadRows(true);
            return;
          }
          shell.toast(meta.label + ': now ' + result.data.message.status + '.', 'success');
          loadRows(true);
        });
      }

      if (meta.needs.indexOf('scheduled_at') === -1 && !meta.terminal) { send(extra); return; }
      if (action === 'schedule') { askSchedule(id, extra); return; }
      shell.confirm(meta.label + ' this signal?', meta.label === 'Revoke'
        ? 'Revoking is final: the message cannot be restored, and visitors lose it immediately.'
        : 'This changes what visitors can see.', meta.label, meta.terminal).then(function (yes) {
          if (yes) send(extra);
        });
    }

    function askSchedule(id, extra) {
      var wrap = el('div', 'vsa-ask');
      wrap.appendChild(el('p', null, 'Pick when this becomes visible. The worker enforces at least 30 seconds ahead.'));
      var input = document.createElement('input');
      input.type = 'datetime-local';
      input.className = 'vsa-input';
      var soon = new Date(Date.now() + 10 * 60000 - new Date().getTimezoneOffset() * 60000);
      input.value = soon.toISOString().slice(0, 16);
      wrap.appendChild(input);
      shell.prompt('Schedule this signal', wrap, 'Set time').then(function (ok) {
        if (!ok) return;
        var secs = API.inputToSec(input.value);
        if (!secs) { shell.toast('Pick a publish time first.', 'error'); return; }
        extra.scheduled_at = secs;
        sig.admin.transition(id, 'schedule', extra).then(function (result) {
          if (!result.ok) { shell.toast(result.error, 'error'); loadRows(true); return; }
          shell.toast('Scheduled for ' + shell.fmtTime(result.data.message.scheduled_at) + '. It stays private until then.', 'success');
          loadRows(true);
        });
      });
    }

    /* dialogs come from the shell so every module shares one confirm language */

    function confirmDelete(id, btn) {
      var row = findRow(id);
      shell.confirm('Delete this signal?', 'Type ' + DELETE_WORD + ' in the next step. Deletion cannot be undone' +
        (row ? ' — “' + row.title + '” references a message that may already be open for visitors.' : '.') +
        ' Revoking keeps the row for history; deleting removes it.', 'Delete', true).then(function (yes) {
          if (!yes) return;
          var wrap = el('div', 'vsa-ask');
          wrap.appendChild(el('p', null, 'Confirm with the exact phrase ' + DELETE_WORD + '.'));
          var input = document.createElement('input');
          input.className = 'vsa-input';
          input.setAttribute('aria-label', 'Confirmation phrase');
          input.autocomplete = 'off';
          wrap.appendChild(input);
          shell.prompt('Delete permanently', wrap, 'Delete').then(function (ok) {
            if (!ok) return;
            btn.disabled = true;
            sig.admin.remove(id, input.value.trim(), Number(btn.getAttribute('data-version'))).then(function (result) {
              btn.disabled = false;
              if (!result.ok) { shell.toast(result.error, 'error'); loadRows(true); return; }
              shell.toast('Signal deleted.', 'success');
              loadRows(true);
            });
          });
        });
    }

    function findRow(id) {
      for (var i = 0; i < st.rows.length; i++) if (st.rows[i].id === id) return st.rows[i];
      return null;
    }

    /* ---------------- schedule / active / history share one table shape ---------------- */

    function simpleTable(host, title, note, columns, emptyText, actionSet) {
      head(host, title, note);
      var err = el('p', 'vsa-error');
      err.setAttribute('role', 'alert');
      err.setAttribute('data-role', 'error');
      err.hidden = true;
      host.appendChild(err);
      var wrap = el('div', 'va-table-wrap');
      var table = document.createElement('table');
      table.className = 'va-table';
      var html = '<thead><tr>';
      for (var i = 0; i < columns.length; i++) html += '<th scope="col">' + columns[i] + '</th>';
      html += '</tr></thead><tbody></tbody>';
      table.innerHTML = html;
      wrap.appendChild(table);
      var empty = el('p', 'va-empty', emptyText);
      wrap.appendChild(empty);
      host.appendChild(wrap);
      host.__tbody = table.querySelector('tbody');
      host.__empty = empty;
      host.__actions = actionSet;
      return host;
    }

    function cell(text, cls) {
      var td = document.createElement('td');
      td.className = cls || '';
      td.textContent = text === null || text === undefined || text === '' ? '—' : String(text);
      return td;
    }

    function renderInto(host, rows, map) {
      host.__tbody.textContent = '';
      for (var i = 0; i < rows.length; i++) host.__tbody.appendChild(map(rows[i]));
      host.__empty.hidden = rows.length > 0;
    }

    function rowAction(label, kind, id, action, version, danger) {
      var btn = el('button', 'vsa-abtn vsa-abtn--' + kind, label);
      btn.type = 'button';
      btn.setAttribute('data-action', action);
      btn.setAttribute('data-id', id);
      btn.setAttribute('data-version', String(version));
      if (danger) btn.classList.add('is-danger');
      return btn;
    }

    function buildSchedule(host) {
      simpleTable(host, 'Scheduling', 'Scheduled signals stay private until the worker clock reaches their time. Nothing here publishes early.',
        ['Title', 'Due', 'Lead', 'Expires', 'Status', 'Actions'], 'Nothing is waiting to be published.');
      host.__render = function () {
        var rows = st.rows.filter(function (r) { return r.status === 'scheduled' || r.status === 'draft'; });
        renderInto(host, rows, function (row) {
          var tr = document.createElement('tr');
          tr.appendChild(cell(row.title));
          tr.appendChild(cell(row.scheduled_at ? shell.fmtTime(row.scheduled_at) : 'no time set'));
          tr.appendChild(cell(row.scheduled_at ? when(row.scheduled_at) : '—'));
          tr.appendChild(cell(row.expires_at ? shell.fmtTime(row.expires_at) : 'open ended'));
          tr.appendChild(cell(''));
          tr.firstChild.appendChild(statusPill(row));
          var acts = el('td');
          var wrap = el('div', 'vsa-actions');
          if (row.status === 'draft' && row.scheduled_at) wrap.appendChild(rowAction('Move to scheduled', 'schedule', row.id, 'schedule', row.state_version));
          if (row.status === 'draft') wrap.appendChild(rowAction('Publish now', 'publish', row.id, 'publish', row.state_version));
          if (row.status === 'scheduled') wrap.appendChild(rowAction('Publish now', 'publish', row.id, 'publish', row.state_version));
          if (row.status === 'scheduled') wrap.appendChild(rowAction('Back to draft', 'reopen', row.id, 'reopen', row.state_version));
          acts.appendChild(wrap);
          tr.appendChild(acts);
          return tr;
        });
      };
    }

    function buildActive(host) {
      simpleTable(host, 'Active signals', 'What visitors can receive at this moment, cross-checked against the unauthenticated public feed.',
        ['Title', 'Weight', 'Category', 'Published', 'Expires', 'Visibility', 'Actions'], 'No live signals. Visitors see no stars right now.');
      host.__render = function () {
        var rows = st.rows.filter(function (r) { return r.status === 'active'; });
        renderInto(host, rows, function (row) {
          var tr = document.createElement('tr');
          var titleCell = cell(row.title);
          var id = el('div', 'vsa-id', shell.shortId(row.id));
          id.title = row.id;
          titleCell.appendChild(id);
          tr.appendChild(titleCell);
          tr.appendChild(cell(row.importance));
          tr.appendChild(cell(row.category));
          tr.appendChild(cell(shell.fmtTime(row.published_at)));
          tr.appendChild(cell(row.expires_at ? shell.fmtTime(row.expires_at) + ' · ' + when(row.expires_at) : 'open ended'));
          var vis = cell('');
          var inFeed = st.publicIds.indexOf(row.id) !== -1;
          vis.appendChild(pill(inFeed ? 'in public feed' : 'not in feed', inFeed ? 'live' : 'off'));
          tr.appendChild(vis);
          var acts = el('td');
          var wrap = el('div', 'vsa-actions');
          wrap.appendChild(rowAction('Hide', 'hide', row.id, 'hide', row.state_version));
          wrap.appendChild(rowAction('Revoke', 'revoke', row.id, 'revoke', row.state_version, true));
          acts.appendChild(wrap);
          tr.appendChild(acts);
          return tr;
        });
      };
    }

    function buildHistory(host) {
      head(host, 'History and recovery', 'Hidden, expired and revoked rows stay queryable, so a retired signal can be brought back until it is revoked.');
      var err = el('p', 'vsa-error');
      err.setAttribute('role', 'alert');
      err.setAttribute('data-role', 'error');
      err.hidden = true;
      host.appendChild(err);
      var wrap = el('div', 'va-table-wrap');
      var table = document.createElement('table');
      table.className = 'va-table';
      table.innerHTML = '<thead><tr><th scope="col">Title</th><th scope="col">Status</th>' +
        '<th scope="col">Updated</th><th scope="col">Expires</th><th scope="col">Actions</th></tr></thead><tbody></tbody>';
      wrap.appendChild(table);
      var empty = el('p', 'va-empty', 'No retired signals yet.');
      wrap.appendChild(empty);
      host.appendChild(wrap);
      var tbody = table.querySelector('tbody');

      host.__render = function () {
        var rows = st.rows.filter(function (r) { return r.status === 'hidden' || r.status === 'expired' || r.status === 'revoked'; });
        tbody.textContent = '';
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          var tr = document.createElement('tr');
          tr.appendChild(cell(row.title));
          var statusCell = cell('');
          statusCell.appendChild(statusPill(row));
          tr.appendChild(statusCell);
          tr.appendChild(cell(shell.fmtTime(row.updated_at)));
          tr.appendChild(cell(row.expires_at ? shell.fmtTime(row.expires_at) : 'open ended'));
          var acts = el('td');
          var box = el('div', 'vsa-actions');
          if (row.status === 'hidden') box.appendChild(rowAction('Restore to live', 'publish', row.id, 'publish', row.state_version));
          if (row.status === 'expired') box.appendChild(rowAction('Return to draft', 'reopen', row.id, 'reopen', row.state_version));
          if (row.status !== 'revoked') box.appendChild(rowAction('Revoke', 'revoke', row.id, 'revoke', row.state_version, true));
          else box.appendChild(el('span', 'vsa-faint', 'terminal — content can still be deleted'));
          var del = rowAction('Delete', 'delete', row.id, 'delete', row.state_version, true);
          box.appendChild(del);
          acts.appendChild(box);
          tr.appendChild(acts);
          tbody.appendChild(tr);
        }
        empty.hidden = rows.length > 0;
      };
    }

    /* ---------------- section loading ---------------- */

    var hosts = {};

    function ensureData(refresh) {
      if (refresh || !st.loaded.messages) return loadRows(refresh);
      if (hosts.overview && hosts.overview.__render) hosts.overview.__render();
      renderSubsections();
      return null;
    }

    function renderSubsections() {
      ['schedule', 'active', 'history'].forEach(function (key) {
        if (hosts[key] && hosts[key].__render) hosts[key].__render();
      });
    }

    /* ---------------- module registration ---------------- */

    var sections = [
      { id: 'overview', label: 'Overview', build: buildOverview },
      { id: 'messages', label: 'Notification management', build: buildMessages },
      { id: 'studio', label: 'Star studio', build: null },
      { id: 'profiles', label: 'Signal profiles', build: null },
      { id: 'schedule', label: 'Scheduling', build: buildSchedule },
      { id: 'active', label: 'Active signals', build: buildActive },
      { id: 'history', label: 'History and recovery', build: buildHistory }
    ];

    var external = global.VoidSignalsAdminExtra;
    if (external) {
      for (var s = 0; s < sections.length; s++) {
        if (!sections[s].build && external[sections[s].id]) sections[s].build = external[sections[s].id];
      }
    } else {
      sections = sections.filter(function (sec) { return !!sec.build; });
    }

    var mod = shell.registerModule({
      id: 'signals',
      label: 'Void Signals',
      icon: 'signal',
      perSection: true,
      sections: sections.map(function (sec) { return { id: sec.id, label: sec.label }; }),
      enter: function (sectionId, refresh) {
        var host = hosts[sectionId];
        if (!host) return;
        if (sectionId === 'messages') { loadRows(refresh && st.loaded.messages); return; }
        if (sectionId === 'overview' || sectionId === 'schedule' || sectionId === 'active' || sectionId === 'history') {
          ensureData(refresh && st.loaded.messages);
          return;
        }
        if (host.__enter) host.__enter(!!refresh, sig, st);
      },
      reset: function () {
        st.loaded = {};
        st.rows = [];
        st.totals = null;
        st.publicIds = [];
        st.version = null;
        for (var key in hosts) {
          if (!Object.prototype.hasOwnProperty.call(hosts, key)) continue;
          if (hosts[key].__reset) hosts[key].__reset();
        }
      }
    });
    if (!mod) return;

    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      var node = document.getElementById('va-sec-signals-' + sec.id);
      if (!node) continue;
      hosts[sec.id] = node;
      if (sec.build) sec.build(node, shell, sig);
      if (sec.id !== 'messages' && sec.id !== 'overview') {
        node.addEventListener('click', function (event) {
          var btn = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
          if (!btn || !btn.getAttribute('data-id')) return;
          if (btn.getAttribute('data-action') === 'toggle') return;
          runTransition(btn.getAttribute('data-id'), btn.getAttribute('data-action'), btn);
        });
      }
    }

    if (hosts.messages) {
      hosts.messages.addEventListener('click', function (event) {
        var btn = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
        if (btn && btn.getAttribute('data-action') === 'toggle') { toggleDetail(btn.getAttribute('data-id'), btn); }
      });
      hosts.messages.querySelector('.va-table tbody').addEventListener('click', onMessagesClick);
    }
    if (hosts.overview) {
      hosts.overview.__enter = function (refresh) {
        Promise.all([
          sig.admin.list({ limit: 1 }),
          pub.feed().catch(function () { return { ok: false }; })
        ]).then(function (res) {
          if (res[0].ok) {
            st.totals = res[0].data.total;
            st.version = res[0].data.version;
            st.serverTime = res[0].data.server_time;
          } else {
            st.version = null;
            errorNote(hosts.overview, res[0].error);
          }
          if (res[1] && res[1].ok) st.publicIds = res[1].data.messages.map(function (m) { return m.id; });
          hosts.overview.__render();
          shell.setCount('signals', (st.totals ? (st.totals.active || 0) + (st.totals.scheduled || 0) : 0));
        });
      };
    }
    shell.hydrateIcons(document.getElementById('va-panel-signals'));
  }

  global.VoidSignalsAdmin = build;
})(typeof window !== 'undefined' ? window : globalThis);
