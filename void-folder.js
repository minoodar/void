/* Golden Folder — a list-only selector on top of the one shared player. Selected
   tracks go through VoidMusic.add (same queue, same native streaming); there is
   no second player, no custom buffer and no parallel queue. */
(function () {
  'use strict';

  if (/[?&]admin=(?:1|true)(?:&|#|$)/.test(location.search)) return;

  /* GET /tracks is the only inventory. There is deliberately no hardcoded
     fallback: a failed load says so instead of showing a second catalogue. */
  var DATA = [];
  var CATALOGUE = [];
  var URLS = new Set();
  var fetching = false;
  /* Recovery state: a terminal failure earns one deferred attempt; every
     later attempt needs a real trigger (event or the manual button) and the
     throttle, so a dead route never turns into polling. */
  var catalogueFailed = false;
  var lastCatalogueAttempt = 0;
  var deferredRecoveryTimer = 0;
  var lastAttemptWasDeferred = false;
  var RECOVERY_THROTTLE_MS = 15 * 1000;
  var DEFERRED_RECOVERY_MS = 30 * 1000;
  function indexUrls() {
    URLS.clear();
    for (var i = 0; i < DATA.length; i++) if (DATA[i] && DATA[i].url) URLS.add(DATA[i].url);
  }
  indexUrls();

  var link = document.getElementById('void-golden-folder');
  var chip = document.getElementById('void-golden-status');
  var dialog = document.getElementById('void-golden-modal');
  var listEl = document.getElementById('void-golden-list');
  var countEl = document.getElementById('void-golden-count');
  var totalEl = document.getElementById('void-golden-total');
  var allBtn = document.getElementById('void-golden-select-all');
  var playBtn = document.getElementById('void-golden-play');
  var cancelBtn = document.getElementById('void-golden-cancel');
  if (!link || !chip || !dialog || !listEl || !countEl || !totalEl || !allBtn || !playBtn || !cancelBtn) return;

  var textEl = chip.querySelector('.void-golden-status__text');
  var actionEl = chip.querySelector('.void-golden-status__action');
  var boxes = [];
  var rows = [];

  var busy = false;
  var hideTimer = 0;
  var actionKind = '';
  var activeToken = 0;
  var terminalToken = 0;
  var lastEntries = null;
  var retryEntry = null;

  function playerState() {
    try { return window.VoidMusic && window.VoidMusic.getState ? window.VoidMusic.getState() : null; } catch (e) { return null; }
  }
  function playingUrl() {
    var st = playerState();
    if (!st || !st.playing || !st.currentUrl) return '';
    var a = null;
    try { a = window.VoidMusic.getAudio ? window.VoidMusic.getAudio() : null; } catch (e) {}
    /* play() flips `paused` before any sound exists; require buffered playback so a
       failure is never mistaken for a recovery (or the reverse). */
    if (a && (a.error || a.readyState < 3)) return '';
    return st.currentUrl;
  }
  function notePlaying(url) {
    retryEntry = null; terminalToken = 0; setBusy(false);
    show('playing', 'Playing · ' + titleFor(url), '', '', 6000);
  }

  function entryFor(url) {
    for (var i = 0; i < DATA.length; i++) if (DATA[i].url === url) return DATA[i];
    return null;
  }

  /* Inline glyphs only: a beamed note for idle rows, three bars that animate while
     that very track is streaming. */
  var ICON_SVG =
    '<svg class="void-golden-modal__note" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
      '<path d="M5.9 11.05V4.75l7.2-1.6v6.05" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="4.35" cy="11.05" r="1.55" fill="currentColor"/>' +
      '<circle cx="11.55" cy="9.2" r="1.55" fill="currentColor"/>' +
    '</svg>' +
    '<svg class="void-golden-modal__eq" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
      '<rect x="2.4" y="6" width="2.2" height="8" rx="1.1" fill="currentColor"/>' +
      '<rect x="6.9" y="2.4" width="2.2" height="11.6" rx="1.1" fill="currentColor"/>' +
      '<rect x="11.4" y="4.6" width="2.2" height="9.4" rx="1.1" fill="currentColor"/>' +
    '</svg>';
  /* Same thin-stroke family as the note glyph: three nodes, two links. */
  var SHARE_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<circle cx="12.1" cy="3.6" r="1.7"/>' +
      '<circle cx="3.9" cy="8" r="1.7"/>' +
      '<circle cx="12.1" cy="12.4" r="1.7"/>' +
      '<path d="M5.4 7.25 10.6 4.35M5.4 8.75l5.2 2.9"/>' +
    '</svg>';

  function openShare(entry) {
    var api = window.VoidGolden;
    if (api && typeof api.openShare === 'function') api.openShare(entry);
  }

  function buildList() {
    listEl.textContent = '';
    boxes = [];
    rows = [];
    for (var i = 0; i < DATA.length; i++) {
      (function (entry) {
        var li = document.createElement('li');
        li.className = 'void-golden-modal__row';
        var label = document.createElement('label');
        label.className = 'void-golden-modal__pick';
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.value = entry.id;
        box.addEventListener('change', syncSelection);
        var icon = document.createElement('span');
        icon.className = 'void-golden-modal__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = ICON_SVG;
        var name = document.createElement('span');
        name.className = 'void-golden-modal__label';
        name.textContent = entry.title;
        label.appendChild(box);
        label.appendChild(icon);
        label.appendChild(name);
        li.appendChild(label);
        var share = document.createElement('button');
        share.type = 'button';
        share.className = 'void-golden-modal__share';
        share.setAttribute('aria-label', 'Share ' + entry.title);
        share.title = 'Share';
        share.innerHTML = SHARE_SVG;
        share.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          openShare(entry);
        });
        li.appendChild(share);
        var now = document.createElement('span');
        now.className = 'void-golden-modal__now';
        li.appendChild(now);
        listEl.appendChild(li);
        boxes.push(box);
        rows.push(li);
      })(DATA[i]);
    }
    totalEl.textContent = DATA.length + (DATA.length === 1 ? ' track' : ' tracks');
    if (!DATA.length) {
      var empty = document.createElement('li');
      empty.className = 'void-golden-modal__empty';
      empty.textContent = 'No tracks available.';
      listEl.appendChild(empty);
      allBtn.disabled = true;
    }
  }

  function selected() {
    var out = [];
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) out.push(DATA[i]);
    return out;
  }

  function syncSelection() {
    var n = 0;
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) n++;
    countEl.textContent = n + ' selected';
    countEl.classList.toggle('is-active', n > 0);
    playBtn.disabled = busy || n === 0;
    allBtn.textContent = (n > 0 && n === boxes.length) ? 'Clear all' : 'Select all';
    allBtn.disabled = boxes.length === 0;
  }

  /* The row marker uses the same "really playing" test as the chip, so a paused,
     buffering or failed source never keeps a gold bar alive. */
  function syncPlaying() {
    var url = playingUrl();
    for (var i = 0; i < rows.length; i++) {
      var on = !!url && DATA[i].url === url;
      if (rows[i].classList.contains('is-playing') === on) continue;
      rows[i].classList.toggle('is-playing', on);
      if (on) rows[i].setAttribute('aria-current', 'true');
      else rows[i].removeAttribute('aria-current');
      var now = rows[i].querySelector('.void-golden-modal__now');
      if (now) now.textContent = on ? 'Now playing' : '';
    }
  }

  function setBusy(on) {
    busy = !!on;
    link.setAttribute('aria-busy', busy ? 'true' : 'false');
    syncSelection();
  }

  function clearHide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
  }
  function hideChip() {
    clearHide();
    chip.className = '';
    chip.setAttribute('aria-hidden', 'true');
    /* A hidden pill must not keep a live action behind it. */
    actionKind = '';
    actionEl.hidden = true;
    chip.removeAttribute('aria-label');
  }
  function show(state, message, actionLabel, kind, autoHideMs) {
    clearHide();
    chip.className = 'is-on is-' + state + (actionLabel ? ' is-action' : '');
    textEl.textContent = message;
    actionKind = kind || '';
    if (actionLabel) {
      actionEl.hidden = false;
      actionEl.textContent = actionLabel;
      chip.setAttribute('aria-label', message + ' — ' + actionLabel);
    } else {
      actionEl.hidden = true;
      chip.removeAttribute('aria-label');
    }
    chip.setAttribute('aria-hidden', 'false');
    if (autoHideMs) hideTimer = setTimeout(hideChip, autoHideMs);
  }

  function restoreOpenerFocus() {
    try { link.focus({ preventScroll: true }); } catch (e) {}
    if (document.activeElement === link) return;
    var handle = document.getElementById('void-topnav-handle');
    if (handle) { try { handle.focus({ preventScroll: true }); } catch (e) {} }
  }

  function openDialog() {
    /* Every open starts unchecked, even if a Golden Folder track is playing. */
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
    syncSelection();
    syncPlaying();
    if (!dialog.open) {
      try { dialog.showModal(); }
      catch (e) { dialog.setAttribute('open', ''); }
    }
    link.setAttribute('aria-expanded', 'true');
    var first = boxes.length ? boxes[0] : cancelBtn;
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) {} }
  }

  function closeDialog() {
    if (!dialog.open) return;
    dialog.close();
    link.setAttribute('aria-expanded', 'false');
    restoreOpenerFocus();
  }

  function requestPlay(entries, force) {
    var VM = window.VoidMusic;
    if (!VM || typeof VM.add !== 'function') {
      show('error', 'The player is not ready. Reload the page.', '', '', 0);
      return;
    }
    if (busy && !force) return;
    if (!entries || !entries.length) return;
    try { if (!VM.isOpen()) VM.enter(); } catch (e) {}
    var before = null;
    try { before = VM.getState ? VM.getState() : null; } catch (e) {}
    /* The player intentionally leaves an already-playing first track untouched, so
       no state event will follow: report that real state, not a stalled "Connecting…". */
    var alreadyPlaying = !force && !!(before && before.playing && before.currentUrl === entries[0].url);
    setBusy(true);
    retryEntry = null;
    lastEntries = entries.map(function (t) {
      return { url: t.url, title: t.title, artist: t.artist || '', artwork: t.artwork_url || null, golden: true };
    });
    if (alreadyPlaying) show('playing', 'Playing · ' + entries[0].title, '', '', 6000);
    else show('loading', entries.length === 1 ? 'Connecting… · ' + entries[0].title : 'Connecting…', '', '', 0);
    var p;
    try { p = VM.add(lastEntries, { playFirst: true, force: !!force }); }
    catch (e) {
      setBusy(false);
      /* The chip sits under the modal's top layer; close it so Retry is reachable. */
      closeDialog();
      show('error', 'Could not start the track', 'Retry', 'retry', 0);
      return;
    }
    if (p && typeof p.then === 'function') {
      p.then(function () {
        setBusy(false);
        closeDialog();
      }, function () {
        setBusy(false);
        closeDialog();
        show('error', 'Could not start the track', 'Retry', 'retry', 0);
      });
    } else {
      setBusy(false);
      closeDialog();
    }
  }

  function titleFor(url) {
    var entry = entryFor(url);
    return (entry && entry.title) || 'Golden Folder';
  }

  /* Managed playlist. A stale worker (404), a missing table (503) or any
     network failure keeps the static bytes above; a real 200 response,
     including an intentionally empty list, wins. */
  function resolveMedia(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      var u = new URL(value, location.href);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
    } catch (e) { return null; }
  }

  function normalizeTracks(payload) {
    if (!payload || payload.ok !== true || !Array.isArray(payload.tracks)) return null;
    var out = [];
    var seenIds = Object.create(null);
    for (var i = 0; i < payload.tracks.length; i++) {
      var row = payload.tracks[i];
      if (!row || typeof row.title !== 'string' || typeof row.audio_url !== 'string') continue;
      if (typeof row.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(row.id) || seenIds[row.id]) return null;
      seenIds[row.id] = true;
      var audio = resolveMedia(row.audio_url);
      if (!audio) continue;
      out.push({
        id: row.id,
        title: row.title,
        artist: typeof row.artist === 'string' ? row.artist : '',
        url: audio,
        artwork_url: resolveMedia(row.artwork_url),
        duration: typeof row.duration === 'number' ? row.duration : null,
        tags: Array.isArray(row.tags) ? row.tags.filter(function (t) { return typeof t === 'string'; }) : []
      });
    }
    return out;
  }

  /* A failed load is stated plainly; it never stands in a second, stale
     catalogue. Retry re-runs the same request. */
  function renderNotice(message, withRetry) {
    listEl.textContent = '';
    boxes = [];
    rows = [];
    var li = document.createElement('li');
    li.className = 'void-golden-modal__empty';
    li.textContent = message;
    if (withRetry) {
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'void-golden-modal__retry';
      retry.textContent = 'Try again';
      retry.addEventListener('click', function () { loadManagedTracks(); });
      li.appendChild(document.createElement('br'));
      li.appendChild(retry);
    }
    listEl.appendChild(li);
    syncSelection();
  }

  function showLoading() {
    totalEl.textContent = 'Loading\u2026';
    renderNotice('Loading the Golden Folder\u2026', false);
  }

  function showFailure() {
    DATA = [];
    CATALOGUE = [];
    indexUrls();
    totalEl.textContent = 'Unavailable';
    renderNotice('The Golden Folder could not be loaded.', true);
  }

  function applyTracks(list, isFilteredView) {
    var checked = {};
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) checked[boxes[i].value] = true;
    if (!isFilteredView) CATALOGUE = list.slice();
    DATA = list;
    indexUrls();
    buildList();
    for (var j = 0; j < boxes.length; j++) if (checked[boxes[j].value]) boxes[j].checked = true;
    syncSelection();
    syncPlaying();
    settleCatalogue();
    /* The statistics pill mirrors this list. Announce every successful
       update so a retry can refresh its count without a reload; the
       one-shot readiness promise above stays untouched. */
    try {
      document.dispatchEvent(new CustomEvent('void:catalogue', {
        detail: { count: DATA.length }
      }));
    } catch (e) {}
  }

  var TRACK_RETRY_DELAY = 1200;

  function delayTrackRetry(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /* Retry-After is delay-seconds or an HTTP-date on a 429 or 5xx response.
     The effective wait stays between 1.2 s and 5 s; a missing, invalid or
     expired value falls back to TRACK_RETRY_DELAY. */
  function retryAfterMs(res) {
    if (!res) return 0;
    var status = Number(res.status);
    if (!(status === 429 || (status >= 500 && status < 600))) return 0;
    var raw = '';
    try { raw = res.headers && res.headers.get ? res.headers.get('Retry-After') || '' : ''; } catch (e) { raw = ''; }
    raw = String(raw).replace(/^\s+|\s+$/g, '');
    if (!raw) return 0;
    if (/^\d+$/.test(raw)) {
      var secs = parseInt(raw, 10);
      if (!isFinite(secs) || secs <= 0) return 0;
      return Math.max(TRACK_RETRY_DELAY, Math.min(secs * 1000, 5000));
    }
    var when = Date.parse(raw);
    if (!isFinite(when)) return 0;
    var now = Date.now();
    try {
      var stamped = Date.parse(res.headers.get('Date') || '');
      if (isFinite(stamped)) now = stamped;
    } catch (e) {}
    var left = when - now;
    if (!isFinite(left) || left <= 0) return 0;
    return Math.max(TRACK_RETRY_DELAY, Math.min(left, 5000));
  }

  /* One attempt, one AbortController, one 8 s deadline. `cache: 'no-store'`
     keeps a retry from being answered by a still-fresh disk copy. */
  function requestTracksOnce(url) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = 0;
    if (controller) timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, 8000);
    return new Promise(function (resolve) {
      function finish(outcome) {
        clearTimeout(timer);
        resolve(outcome);
      }
      try {
        window.fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          signal: controller ? controller.signal : undefined
        }).then(function (res) {
          if (!res) return finish({ ok: false, kind: 'network' });
          if (!res.ok) {
            return finish({
              ok: false,
              kind: 'http',
              status: res.status,
              retryAfter: retryAfterMs(res)
            });
          }
          res.json().then(function (payload) {
            var list = normalizeTracks(payload);
            finish(list ? { ok: true, list: list } : { ok: false, kind: 'invalid' });
          }, function (err) {
            /* The deadline can fire after the headers arrived; the abort then
               surfaces on the body read. That is a timeout, not bad JSON. */
            if (err && err.name === 'AbortError') finish({ ok: false, kind: 'network', timedOut: true });
            else finish({ ok: false, kind: 'invalid' });
          });
        }, function (err) {
          finish({
            ok: false,
            kind: 'network',
            timedOut: !!(err && err.name === 'AbortError')
          });
        });
      } catch (e) {
        finish({ ok: false, kind: 'network' });
      }
    });
  }

  function retryableTracksFailure(r) {
    if (!r || r.ok) return false;
    if (r.kind === 'network') return true;
    return r.kind === 'http' && (r.status === 429 || r.status >= 500);
  }

  function clearDeferredRecovery() {
    if (deferredRecoveryTimer) {
      clearTimeout(deferredRecoveryTimer);
      deferredRecoveryTimer = 0;
    }
  }

  function scheduleDeferredRecovery() {
    clearDeferredRecovery();
    deferredRecoveryTimer = setTimeout(function () {
      deferredRecoveryTimer = 0;
      if (!catalogueFailed || fetching) return;
      if (Date.now() - lastCatalogueAttempt < RECOVERY_THROTTLE_MS) return;
      lastAttemptWasDeferred = true;
      loadManagedTracks();
    }, DEFERRED_RECOVERY_MS);
  }

  /* The GET result, never navigator.onLine, decides whether the catalogue
     is healthy. Throttled and single-flight, so bursts of events collapse. */
  function maybeRecoverCatalogue() {
    if (!catalogueFailed || fetching) return;
    if (Date.now() - lastCatalogueAttempt < RECOVERY_THROTTLE_MS) return;
    loadManagedTracks();
  }

  function loadManagedTracks() {
    if (fetching) return;
    fetching = true;
    var wasDeferred = lastAttemptWasDeferred;
    lastAttemptWasDeferred = false;
    lastCatalogueAttempt = Date.now();
    clearDeferredRecovery();
    showLoading();
    if (typeof window.fetch !== 'function') {
      fetching = false;
      showFailure();
      settleCatalogue();
      return;
    }
    var api = window.VoidLettersApi;
    var base = api && typeof api.base === 'string' ? api.base : 'https://void-galaxy-letters.minoodar.workers.dev';
    var url = String(base).replace(/\/+$/, '') + '/tracks';

    requestTracksOnce(url).then(function (first) {
      if (first.ok) { applyTracks(first.list); return true; }
      /* One retry, only for transient failures. A malformed 200 or an
         ordinary 4xx is settled immediately. */
      if (!retryableTracksFailure(first)) return false;
      return delayTrackRetry(first.retryAfter || TRACK_RETRY_DELAY).then(function () {
        return requestTracksOnce(url);
      }).then(function (second) {
        if (second.ok) { applyTracks(second.list); return true; }
        return false;
      });
    }).then(function (ok) {
      if (!ok) {
        catalogueFailed = true;
        showFailure();
        settleCatalogue();
        /* One deferred chance per failure episode; the deferred attempt
           itself never re-arms, so an outage cannot become a poll loop. */
        if (!wasDeferred) scheduleDeferredRecovery();
      } else {
        catalogueFailed = false;
        clearDeferredRecovery();
      }
    }).then(function () {
      fetching = false;
    }, function () {
      /* An unexpected exception must not freeze the catalogue at "Loading…":
         show the existing failure state and release the guard for a retry. */
      catalogueFailed = true;
      try {
        showFailure();
        settleCatalogue();
      } catch (e) {}
      if (!wasDeferred) scheduleDeferredRecovery();
      fetching = false;
    });
  }

  /* One read-only window onto the settled catalogue for the invitation layer.
     `ready` settles on a 200, a failure, a malformed payload or the 8 s abort;
     `find` accepts the managed `gf-<id>` form and the static `<id>` fallback,
     and returns null rather than guessing another track. */
  var catalogueSettled = false;
  var catalogueResolve = null;
  var catalogueReady = new Promise(function (resolve) { catalogueResolve = resolve; });
  function snapshotTracks() {
    return DATA.map(function (t) {
      return { id: t.id, title: t.title, artist: t.artist || '', url: t.url, artwork_url: t.artwork_url || null };
    });
  }
  function settleCatalogue() {
    if (catalogueSettled) return;
    catalogueSettled = true;
    catalogueResolve(snapshotTracks());
  }
  function findTrack(id) {
    if (typeof id !== 'string' || !id) return null;
    var candidates = [id];
    if (id.indexOf('gf-') === 0) candidates.push(id.slice(3));
    else candidates.push('gf-' + id);
    for (var c = 0; c < candidates.length; c++) {
      for (var i = 0; i < DATA.length; i++) {
        if (DATA[i] && DATA[i].id === candidates[c]) return DATA[i];
      }
    }
    return null;
  }
  window.VoidGolden = {
    ready: catalogueReady,
    getTracks: snapshotTracks,
    replaceTracks: function (tracks) {
      if (!Array.isArray(tracks)) return false;
      var available = Object.create(null);
      for (var i = 0; i < CATALOGUE.length; i++) available[CATALOGUE[i].id] = CATALOGUE[i];
      var next = [], seen = Object.create(null);
      for (var j = 0; j < tracks.length; j++) {
        var item = tracks[j];
        if (!item || typeof item.id !== 'string' || !available[item.id] || seen[item.id]) return false;
        seen[item.id] = true;
        next.push(available[item.id]);
      }
      applyTracks(next, true);
      return true;
    },
    find: findTrack,
    play: function (id) {
      var tr = findTrack(id);
      if (!tr) return false;
      requestPlay([tr], false);
      return true;
    },
    open: function () {
      /* Re-opening clears the checks; an already-open window keeps its selection. */
      if (!dialog.open) openDialog();
    }
  };

  showLoading();
  loadManagedTracks();
  window.addEventListener('online', maybeRecoverCatalogue);
  window.addEventListener('pageshow', maybeRecoverCatalogue);
  window.addEventListener('focus', maybeRecoverCatalogue);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') maybeRecoverCatalogue();
  });

  link.addEventListener('click', function (e) {
    e.preventDefault();
    openDialog();
  });

  allBtn.addEventListener('click', function () {
    var all = boxes.length > 0;
    for (var i = 0; i < boxes.length; i++) if (!boxes[i].checked) all = false;
    for (var j = 0; j < boxes.length; j++) boxes[j].checked = !all;
    syncSelection();
  });

  cancelBtn.addEventListener('click', closeDialog);

  var folderShareBtn = document.getElementById('void-golden-share-folder');
  if (folderShareBtn) folderShareBtn.addEventListener('click', function () { openShare(null); });

  playBtn.addEventListener('click', function () {
    if (busy) return;
    var picked = selected();
    if (!picked.length) return;
    requestPlay(picked, false);
  });

  actionEl.addEventListener('click', function (e) {
    e.preventDefault();
    if (actionKind === 'retry') {
      var one = retryEntry ? [retryEntry] : lastEntries;
      if (!one || !one.length) { hideChip(); return; }
      /* Already recovered while the failure was still on screen: report the real
         state instead of restarting a track that is playing. */
      if (playingUrl() === one[0].url) {
        notePlaying(one[0].url);
        return;
      }
      requestPlay(one, true);
    } else if (actionKind === 'play') {
      var st = playerState();
      if (st && st.playing) { hideChip(); return; }
      try { window.VoidMusic.toggle(); }
      catch (err) { show('error', 'Could not start the track', 'Retry', 'retry', 0); }
    } else {
      hideChip();
    }
  });

  dialog.addEventListener('close', function () {
    link.setAttribute('aria-expanded', 'false');
  });
  dialog.addEventListener('cancel', function (e) {
    e.preventDefault();
    closeDialog();
  });
  /* The panel fills the dialog box, so a click that targets the dialog itself
     is a click on the ::backdrop. */
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) closeDialog();
  });

  /* While the window is open, the player's document-capture shortcuts must not
     reach playback controls. Space/Enter/Tab stay untouched: checkboxes already
     pass the player's own typing guard and the backdrop is inert. */
  var PLAYER_KEYS = { k: 1, m: 1, n: 1, p: 1, f: 1, w: 1, ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1 };
  window.addEventListener('keydown', function (e) {
    if (!dialog.open) return;
    /* The share sheet is a second top-layer window: it owns Escape and its own
       focus, but player shortcuts must stay blocked while it is open. */
    var shareDialog = document.getElementById('void-golden-share');
    if (shareDialog && shareDialog.open) {
      if (PLAYER_KEYS[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
      return;
    }
    if (PLAYER_KEYS[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation();
  }, true);

  window.addEventListener('voidmusic:remote-state', function (e) {
    var d = e.detail || {};
    syncPlaying();
    if (!d || !d.url || !URLS.has(d.url)) return;
    var title = d.title || titleFor(d.url);
    /* Another source took over (local file, web player, removed track, stop):
       a stale "Connecting…" must never stay behind. */
    if (d.state === 'inactive') { activeToken = 0; terminalToken = 0; retryEntry = null; setBusy(false); hideChip(); return; }
    if (d.state === 'loading') {
      /* play() may reject before the native loadstart task lands; a late loadstart
         of the same attempt must not turn a visible block/error back into "Connecting…". */
      if (d.token && d.token === terminalToken) return;
      activeToken = d.token || 0;
      show('loading', 'Connecting… · ' + title, '', '', 0);
      return;
    }
    /* Playing is checked before the token guard: real playback is the strongest
       signal, and adopting its token stops a late failure from an older attempt
       from replacing "Playing" with a Retry that nothing would clear. */
    if (d.state === 'playing') {
      if (activeToken && d.token && d.token < activeToken) return;
      activeToken = d.token || activeToken;
      notePlaying(d.url);
      return;
    }
    /* A late event from an older attempt (same URL, older token) must not
       overwrite the status of the attempt that is running now. */
    if (activeToken && d.token && d.token !== activeToken) return;
    if (d.state === 'buffering' || d.state === 'stalled') {
      show('buffering', 'Buffering… · ' + title, '', '', 0);
    } else if (d.state === 'paused') {
      // Ignore the pause caused by swapping a local source out; only a real mid-track pause shows.
      if ((d.readyState || 0) >= 2) {
        terminalToken = 0; setBusy(false);
        show('paused', 'Paused · ' + title, 'Play', 'play', 0);
      }
    } else if (d.state === 'ended') {
      terminalToken = 0; setBusy(false);
      show('ended', 'Ended · ' + title, '', '', 4000);
    } else if (d.state === 'blocked') {
      if (playingUrl() === d.url) {
        if (actionKind === 'play' || chip.className.indexOf('is-blocked') >= 0) notePlaying(d.url);
        return;
      }
      terminalToken = d.token || 0; retryEntry = entryFor(d.url); setBusy(false);
      show('blocked', 'Playback needs a tap · ' + title, 'Play', 'play', 0);
    } else if (d.state === 'error') {
      /* The failure is history if this very URL is already playing again. */
      if (playingUrl() === d.url) {
        if (actionKind === 'retry' || chip.className.indexOf('is-error') >= 0) notePlaying(d.url);
        return;
      }
      terminalToken = d.token || 0; retryEntry = entryFor(d.url); setBusy(false);
      show('error', 'Couldn\u2019t load · ' + title, retryEntry ? 'Retry' : '', retryEntry ? 'retry' : '', 0);
    }
  });

  /* Recovery can reach the player without a matching remote-state event (its own
     play control, a filtered late event). Reconcile the chip with the real state
     so a Retry/Play pill never outlives the failure it described. */
  window.addEventListener('voidmusic:playing', function (e) {
    syncPlaying();
    if (!e.detail || !e.detail.playing) return;
    if (actionKind !== 'retry' && actionKind !== 'play' && chip.className.indexOf('is-error') < 0) return;
    var url = playingUrl();
    if (!url || !URLS.has(url)) return;
    notePlaying(url);
  });
})();
