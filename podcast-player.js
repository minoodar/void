/* Void Podcast — Stage 2B playback controller.
   Part 1: pure logic (UMD, Node-testable) — resume, queue, sleep, seek, formats.
   Part 2: browser controller (flag-ON only). A second hidden <audio> (no
   crossOrigin, no analyser) is attached through the engine's PUBLIC web-source
   API (VoidMusic.attachWeb/detachWeb), so the music engine files stay untouched:
   title row, play state, arc, time, seek and volume are driven by the engine
   from this element's own events; prev/next arrive as cmd('previoustrack'/
   'nexttrack') and become -15s/+30s. Music starting detaches us (engine calls
   onDetach), we save progress and pause — music never auto-resumes.
   Chromium 70 safe: no ?. no ?? no replaceAll, no clamp()/min()/max() in CSS. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.VoidPodcastPlayerLogic = factory(); }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
  var SLEEP_MINUTES = [15, 30, 60];
  var REWIND_SEC = 3;
  var SKIP_BACK_SEC = 15;
  var SKIP_FWD_SEC = 30;

  function clampNum(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* Resume: completed episodes start over; otherwise rewind 3s from the saved
     position (never below 0, never past the duration). */
  function resumePosition(entry, durationSec) {
    if (!entry || entry.completed) { return 0; }
    var p = typeof entry.positionSec === 'number' && isFinite(entry.positionSec) ? entry.positionSec : 0;
    if (p <= 0) { return 0; }
    var pos = p - REWIND_SEC;
    if (durationSec > 0) { pos = clampNum(pos, 0, durationSec); }
    return pos < 0 ? 0 : pos;
  }

  /* Episode queue: ids of the show's episodes (newest first) from the current
     one onward — ending an episode rolls into the next older one. */
  function queueFrom(episodes, currentId) {
    var ids = episodes.map(function (e) { return e.id; });
    var i = ids.indexOf(currentId);
    return i < 0 ? [currentId] : ids.slice(i);
  }
  function nextInQueue(queue, currentId) {
    var i = queue.indexOf(currentId);
    return i >= 0 && i + 1 < queue.length ? queue[i + 1] : null;
  }
  function withoutId(queue, id) {
    return queue.filter(function (x) { return x !== id; });
  }

  /* Sleep timer: 'end' fires on episode end (no deadline); minutes give a
     wall-clock deadline; anything else is off (null). */
  function sleepDeadline(nowMs, choice) {
    if (choice === 'end') { return null; }
    var m = typeof choice === 'number' ? choice : parseInt(choice, 10);
    if (!m || SLEEP_MINUTES.indexOf(m) < 0) { return null; }
    return nowMs + m * 60000;
  }
  function sleepRemainingMs(nowMs, deadline) {
    return deadline ? Math.max(0, deadline - nowMs) : null;
  }

  function skipTarget(currentTime, delta, durationSec) {
    var pos = (currentTime || 0) + delta;
    if (pos < 0) { return 0; }
    if (durationSec > 0 && isFinite(durationSec) && pos > durationSec) { return durationSec; }
    return pos;
  }

  function chapterIndexAt(chapters, sec) {
    if (!chapters || !chapters.length) { return -1; }
    var idx = -1;
    for (var i = 0; i < chapters.length; i++) {
      if (chapters[i].startSec <= sec) { idx = i; } else { break; }
    }
    return idx;
  }

  function fmtTime(sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return h > 0 ? h + ':' + pad(m) + ':' + pad(r) : m + ':' + pad(r);
  }
  function rateLabel(r) { return (r === 1 ? '1' : String(r)) + '\u00D7'; }

  return {
    RATES: RATES, SLEEP_MINUTES: SLEEP_MINUTES,
    REWIND_SEC: REWIND_SEC, SKIP_BACK_SEC: SKIP_BACK_SEC, SKIP_FWD_SEC: SKIP_FWD_SEC,
    resumePosition: resumePosition, queueFrom: queueFrom, nextInQueue: nextInQueue,
    withoutId: withoutId, sleepDeadline: sleepDeadline, sleepRemainingMs: sleepRemainingMs,
    skipTarget: skipTarget, chapterIndexAt: chapterIndexAt, fmtTime: fmtTime, rateLabel: rateLabel
  };
});

(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') { return; }
  if (!window.__VOID_PODCAST_FLAG__) { return; }
  var L = window.VoidPodcastPlayerLogic;
  var VM = window.VoidMusic, data = window.VoidPodcastSampleData, Store = window.VoidPodcastStore;
  if (!L || !VM || typeof VM.attachWeb !== 'function' || typeof VM.detachWeb !== 'function' || !data || !Store) { return; }
  if (window.VoidPodcastPlayer) { return; }

  /* The engine builds #void-music-root in enter(); before that we may only
     have <body>. Re-home the audio and sheet once the real root exists. */
  var root = document.getElementById('void-music-root') || document.body;
  function ensureRoot() {
    var r = document.getElementById('void-music-root');
    if (r && r !== root) {
      root = r;
      if (audio.parentNode !== root) { root.appendChild(audio); }
      if (sheet && sheet.parentNode !== root) { root.appendChild(sheet); }
    }
  }
  /* Share the window's store instance so its onChange re-renders stay live. */
  var store = (window.VoidPodcastWindow && window.VoidPodcastWindow.getStore)
    ? window.VoidPodcastWindow.getStore() : Store.create();

  /* Optional, git-ignored local test audio. Absent file = silent 404, no config. */
  try {
    var devScript = document.createElement('script');
    devScript.src = 'podcast-dev-config.local.js';
    devScript.onload = devScript.onerror = function () { /* config read lazily at play time */ };
    document.head.appendChild(devScript);
  } catch (e) { /* no dev config */ }

  function sourceFor(episode) {
    var cfg = window.VoidPodcastDevConfig;
    var url = (cfg && cfg.audio && cfg.audio[episode.id]) || (cfg && cfg.audioUrl) || episode.audioUrl;
    return typeof url === 'string' && url ? url : '';
  }
  function findEpisode(id) {
    for (var i = 0; i < data.EPISODES.length; i++) { if (data.EPISODES[i].id === id) { return data.EPISODES[i]; } }
    return null;
  }
  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* old engines */ }
  }

  /* ---- the second audio element: never crossOrigin, never analyser-tapped ---- */
  var audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.style.display = 'none';
  audio.setAttribute('aria-hidden', 'true');
  audio.__web = true;                 // engine applies volume/mute directly (void-music.js applyVolume)
  audio.tabId = 'podcast';            // engine's web-source id namespace
  root.appendChild(audio);

  var current = null;                 // { episode, show }
  var active = false;
  var rate = 1;
  var sleep = { choice: 'off', deadline: 0, timer: 0 };
  var lastSave = 0;
  var pendingSeek = null;
  var chip = null, ticks = [], sheet = null, sheetTick = 0;
  var sndBtn = null, sndIntercept = null, localGuard = null;

  function saveProgress() {
    if (!current) { return; }
    var ep = current.episode;
    store.setProgress(ep.id, audio.currentTime || 0, ep.durationSec, audio.ended === true);
    lastSave = Date.now();
  }

  /* ---- emblem is-playing (constellation may rebuild while we play) ---- */
  function syncEmblem() {
    var svg = document.querySelector('.vdc-target--podcast .void-emblem--podcast');
    if (svg) { svg.classList.toggle('is-playing', active && !audio.paused); }
  }
  var layerObs = null, bodyObs = null, watchedLayer = null;
  function watchConstellation() {
    var layer = document.querySelector('.vdc');
    if (layer === watchedLayer) { return; }
    if (layerObs) { layerObs.disconnect(); layerObs = null; }
    watchedLayer = layer;
    if (layer && window.MutationObserver) {
      layerObs = new MutationObserver(syncEmblem);
      layerObs.observe(layer, { attributes: true, attributeFilter: ['class'] });
    }
    syncEmblem();
  }
  if (window.MutationObserver) {
    bodyObs = new MutationObserver(watchConstellation);
    bodyObs.observe(document.body, { childList: true });
  }

  /* ---- Media Session: metadata only while active; engine handlers already
     route play/pause/next/prev/seek through S.audio, so none are overridden. ---- */
  function publishMetadata() {
    if (!('mediaSession' in navigator) || !window.MediaMetadata || !current) { return; }
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: current.episode.title, artist: current.show.title, album: 'Void Podcast'
      });
    } catch (e) { /* unsupported */ }
  }
  function clearMetadata() {
    if (!('mediaSession' in navigator)) { return; }
    try { navigator.mediaSession.metadata = null; } catch (e) { /* unsupported */ }
  }

  /* ---- chapter ticks on the engine's arc (own overlay nodes, removed on stop) ---- */
  function clearTicks() {
    ticks.forEach(function (n) { if (n.parentNode) { n.parentNode.removeChild(n); } });
    ticks = [];
  }
  function drawTicks() {
    clearTicks();
    if (!active || !current || !current.episode.chapters) { return; }
    var arc = root.querySelector('.vm-arc'), base = root.querySelector('.vm-arc-base');
    var dur = audio.duration;
    if (!arc || !base || !isFinite(dur) || dur <= 0 || !base.getTotalLength) { return; }
    var len = base.getTotalLength();
    current.episode.chapters.forEach(function (ch) {
      if (!(ch.startSec > 0) || ch.startSec >= dur) { return; }
      var pt = base.getPointAtLength((ch.startSec / dur) * len);
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'pw-tick');
      c.setAttribute('cx', pt.x.toFixed(1));
      c.setAttribute('cy', pt.y.toFixed(1));
      c.setAttribute('r', '2.2');
      arc.appendChild(c);
      ticks.push(c);
    });
  }

  /* ---- speed chip in place of the repeat icon (DOM swap, restored on stop) ---- */
  function enterChip() {
    var repeat = root.querySelector('.vm-repeat');
    if (!repeat || chip) { return; }
    chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'vm-repeat pw-rate';
    chip.textContent = L.rateLabel(rate);
    chip.setAttribute('aria-label', 'Playback speed · سرعت پخش');
    chip.title = 'Playback speed · سرعت پخش';
    chip.addEventListener('click', function (e) { e.stopPropagation(); openSheet('speed'); });
    repeat.style.display = 'none';
    repeat.parentNode.insertBefore(chip, repeat);
  }
  function exitChip() {
    if (chip && chip.parentNode) { chip.parentNode.removeChild(chip); }
    chip = null;
    var repeat = root.querySelector('.vm-repeat');
    if (repeat) { repeat.style.display = ''; }
  }

  /* ---- sleep timer ---- */
  function clearSleep() {
    if (sleep.timer) { clearTimeout(sleep.timer); sleep.timer = 0; }
    sleep.choice = 'off'; sleep.deadline = 0;
  }
  function sleepFire() {
    sleep.timer = 0; sleep.choice = 'off'; sleep.deadline = 0;
    saveProgress();
    try { audio.pause(); } catch (e) { /* already paused */ }
    if (sheet && !sheet.hidden) { renderSheet(); }
    emit('podcast:sleep', { fired: true });
  }
  function setSleep(choice) {
    clearSleep();
    if (choice === 'end') { sleep.choice = 'end'; }
    else {
      var dl = L.sleepDeadline(Date.now(), choice);
      if (dl) {
        sleep.choice = typeof choice === 'number' ? choice : parseInt(choice, 10);
        sleep.deadline = dl;
        sleep.timer = setTimeout(sleepFire, dl - Date.now());
      }
    }
    if (sheet && !sheet.hidden) { renderSheet(); }
  }
  function setRate(r) {
    if (L.RATES.indexOf(r) < 0) { return; }
    rate = r;
    try { audio.playbackRate = r; } catch (e) { /* engine clamps unsupported rates */ }
    if (chip) { chip.textContent = L.rateLabel(r); }
    if (sheet && !sheet.hidden) { renderSheet(); }
  }

  /* ---- mode enter / teardown ---- */
  function onLocalPlay() {
    /* Backup for any music-start path that bypasses the engine's detach:
       save podcast progress first, then hand the source back to music. */
    if (active) { stop(); }
  }
  function enterMode() {
    active = true;
    root.classList.add('vm-podcast');
    enterChip();
    drawTicks();
    sndBtn = root.querySelector('.vm-snd-open');
    if (sndBtn) {
      sndIntercept = function (e) {
        if (!active) { return; }
        e.preventDefault(); e.stopImmediatePropagation();
        openSheet();
      };
      sndBtn.addEventListener('click', sndIntercept, true);
    }
    var la = VM.getLocalAudio && VM.getLocalAudio();
    if (la && !localGuard) {
      localGuard = function () { onLocalPlay(); };
      la.addEventListener('play', localGuard, true);
    }
    publishMetadata();
    syncEmblem();
  }
  function teardownMode() {
    if (!active) { return; }
    active = false;
    clearSleep();
    closeSheet();
    exitChip();
    clearTicks();
    if (sndBtn && sndIntercept) { sndBtn.removeEventListener('click', sndIntercept, true); }
    sndBtn = null; sndIntercept = null;
    root.classList.remove('vm-podcast');
    clearMetadata();
    syncEmblem();
    current = null;
    emit('podcast:episode', { episodeId: null, showId: null, active: false, playing: false });
  }

  /* The engine calls this when local music starts (detachWeb({pauseSite:true}))
     or when we stop. Save first; pause only the podcast; never touch music. */
  audio.onDetach = function (opts) {
    saveProgress();
    if (opts && opts.pauseSite) { try { audio.pause(); } catch (e) { /* paused */ } }
    teardownMode();
  };
  audio.cmd = function (name) {
    if (!active) { return; }
    if (name === 'nexttrack') { seekBy(L.SKIP_FWD_SEC); }
    else if (name === 'previoustrack') { seekBy(L.SKIP_BACK_SEC * -1); }
  };

  function seekBy(delta) {
    var dur = isFinite(audio.duration) ? audio.duration : (current ? current.episode.durationSec : 0);
    try { audio.currentTime = L.skipTarget(audio.currentTime, delta, dur); } catch (e) { /* not seekable yet */ }
  }

  /* ---- element events ---- */
  audio.addEventListener('loadedmetadata', function () {
    if (pendingSeek !== null) {
      var dur = isFinite(audio.duration) ? audio.duration : 0;
      try { audio.currentTime = dur > 0 ? Math.min(pendingSeek, dur) : pendingSeek; } catch (e) { /* live stream */ }
      pendingSeek = null;
    }
    drawTicks();
  });
  audio.addEventListener('timeupdate', function () {
    if (!active) { return; }
    if (Date.now() - lastSave >= 5000) { saveProgress(); }
    if (sheet && !sheet.hidden && sleep.deadline) { updateSleepLine(); }
  });
  audio.addEventListener('pause', function () {
    if (active) { saveProgress(); }
    syncEmblem();
    emit('podcast:playing', { episodeId: current ? current.episode.id : null, playing: false });
  });
  audio.addEventListener('play', function () {
    syncEmblem();
    emit('podcast:playing', { episodeId: current ? current.episode.id : null, playing: true });
  });
  audio.addEventListener('seeked', function () { if (active) { saveProgress(); } });
  audio.addEventListener('ended', function () {
    if (!current) { return; }
    var ep = current.episode;
    store.setProgress(ep.id, ep.durationSec, ep.durationSec, true);
    if (sleep.choice === 'end') { clearSleep(); stop(); return; }
    var nextId = L.nextInQueue(store.getQueue(), ep.id);
    var nextEp = nextId ? findEpisode(nextId) : null;
    if (nextEp) {
      var sh = data.showById(nextEp.showId);
      if (sh) { play(nextEp, sh); return; }
    }
    stop();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && active) { saveProgress(); }
  });

  /* ---- public play / stop ---- */
  function play(episode, show) {
    if (!episode || !show) { return { ok: false, reason: 'bad-episode' }; }
    var src = sourceFor(episode);
    if (!src) { return { ok: false, reason: 'no-source' }; }
    if (active && current && current.episode.id === episode.id) { return { ok: true, already: true }; }
    if (active) { saveProgress(); }
    var start = L.resumePosition(store.getProgress(episode.id), episode.durationSec);
    current = { episode: episode, show: show };
    store.setProgress(episode.id, start, episode.durationSec);   // entry exists -> NEW dot clears
    store.setQueue(L.queueFrom(data.episodesOf(show.id), episode.id));
    pendingSeek = start;
    audio.src = src;
    try { audio.playbackRate = rate; } catch (e) { /* default 1 */ }
    /* The podcast-mode UI (title row, arc, chip, sheet) lives in the engine's
       root, which only exists in music mode. Enter through the PUBLIC API —
       enter() never auto-plays local music. */
    if (!document.body.classList.contains('void-music-on') && typeof VM.enter === 'function') { VM.enter(); }
    ensureRoot();
    if (!active) { enterMode(); } else { drawTicks(); publishMetadata(); }
    VM.attachWeb(audio, { title: episode.title, artist: show.title, art: null });
    var pr = audio.play();
    if (pr && pr.catch) { pr.catch(function () { /* gesture policy: UI shows paused, play button resumes */ }); }
    emit('podcast:episode', { episodeId: episode.id, showId: show.id, active: true, playing: !audio.paused });
    return { ok: true };
  }
  function stop() {
    if (!active) { return; }
    saveProgress();
    try { audio.pause(); } catch (e) { /* paused */ }
    teardownMode();
    VM.detachWeb({ pauseSite: true, quiet: false });   // restores music UI; never resumes music
    try { audio.removeAttribute('src'); audio.load(); } catch (e) { /* release the buffer */ }
  }
  function toggle() {
    if (!active) { return; }
    if (audio.paused) {
      var pr = audio.play();
      if (pr && pr.catch) { pr.catch(function () { /* blocked */ }); }
    } else { audio.pause(); }
  }

  /* ---- menu sheet (glass, transient) from the existing secondary button ----
     Wears .vm-sound-pop so the engine's key handler treats focus inside it as
     typing and leaves arrows/space/Esc to us (void-music.js onKey typing guard). */
  function buildSheet() {
    if (sheet) { return; }
    sheet = document.createElement('div');
    sheet.className = 'pw-sheet vm-sound-pop';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Podcast options · گزینه‌های پادکست');
    sheet.hidden = true;
    root.appendChild(sheet);
    sheet.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'Escape' || k === 'BrowserBack' || k === 'GoBack' || e.keyCode === 4 || e.keyCode === 27) {
        e.preventDefault(); e.stopPropagation(); closeSheet(); return;
      }
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight') {
        var f = sheetFocusables();
        if (!f.length) { return; }
        var i = f.indexOf(document.activeElement);
        var fwd = (k === 'ArrowDown' || k === 'ArrowRight');
        var n = i < 0 ? 0 : (i + (fwd ? 1 : -1) + f.length) % f.length;
        e.preventDefault(); e.stopPropagation();
        f[n].focus();
        return;
      }
      if (k === 'Tab') {
        var ff = sheetFocusables();
        if (!ff.length) { return; }
        var first = ff[0], last = ff[ff.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); e.stopPropagation(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); e.stopPropagation(); first.focus(); }
      }
    });
  }
  function sheetFocusables() {
    var nodes = sheet.querySelectorAll('button');
    var out = [];
    for (var i = 0; i < nodes.length; i++) { if (!nodes[i].disabled && nodes[i].getClientRects().length) { out.push(nodes[i]); } }
    return out;
  }
  function sheetBtn(label, cls, pressed, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pw-sheet__btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    if (pressed !== null) { b.setAttribute('aria-pressed', pressed ? 'true' : 'false'); }
    b.addEventListener('click', fn);
    return b;
  }
  function sheetSection(titleText, faText) {
    var sec = document.createElement('div');
    sec.className = 'pw-sheet__sec';
    var h = document.createElement('div');
    h.className = 'pw-sheet__lbl';
    h.appendChild(document.createTextNode(titleText + ' '));
    var fa = document.createElement('bdi');
    fa.dir = 'rtl'; fa.lang = 'fa'; fa.textContent = faText;
    h.appendChild(fa);
    sec.appendChild(h);
    return sec;
  }
  function updateSleepLine() {
    var line = sheet ? sheet.querySelector('.pw-sheet__sleep-line') : null;
    if (!line) { return; }
    if (sleep.deadline) {
      var rem = L.sleepRemainingMs(Date.now(), sleep.deadline);
      line.textContent = 'Stops in ' + L.fmtTime(rem / 1000) + ' · تا توقف';
    } else if (sleep.choice === 'end') {
      line.textContent = 'Stops at the end of this episode · تا پایان قسمت';
    } else {
      line.textContent = '';
    }
  }
  function renderSheet() {
    if (!sheet || !current) { return; }
    /* Rebuilding removes the focused button — remember it by label+class and
       restore focus afterwards, or Esc would fall through to the engine. */
    var prevFocus = null;
    if (sheet.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON') {
      prevFocus = { txt: document.activeElement.textContent, cls: document.activeElement.className.replace(' is-at', '') };
    }
    sheet.textContent = '';
    var head = document.createElement('div');
    head.className = 'pw-sheet__head';
    var ht = document.createElement('span');
    ht.className = 'pw-sheet__title';
    ht.textContent = 'PODCAST';
    head.appendChild(ht);
    var closeB = sheetBtn('\u00D7', 'pw-sheet__x', null, closeSheet);
    closeB.setAttribute('aria-label', 'Close · بستن');
    head.appendChild(closeB);
    sheet.appendChild(head);

    var speed = sheetSection('SPEED', 'سرعت');
    var speedRow = document.createElement('div');
    speedRow.className = 'pw-sheet__row';
    L.RATES.forEach(function (r) {
      speedRow.appendChild(sheetBtn(L.rateLabel(r), '', r === rate, function () { setRate(r); }));
    });
    speed.appendChild(speedRow);
    sheet.appendChild(speed);

    var slp = sheetSection('SLEEP', 'تایمر خواب');
    var slpRow = document.createElement('div');
    slpRow.className = 'pw-sheet__row';
    slpRow.appendChild(sheetBtn('Off', '', sleep.choice === 'off', function () { setSleep('off'); }));
    L.SLEEP_MINUTES.forEach(function (m) {
      slpRow.appendChild(sheetBtn(m + ' min', '', sleep.choice === m, function () { setSleep(m); }));
    });
    slpRow.appendChild(sheetBtn('End of episode', '', sleep.choice === 'end', function () { setSleep('end'); }));
    slp.appendChild(slpRow);
    var line = document.createElement('div');
    line.className = 'pw-sheet__sleep-line';
    line.setAttribute('role', 'status');
    slp.appendChild(line);
    sheet.appendChild(slp);
    updateSleepLine();

    if (current.episode.chapters && current.episode.chapters.length) {
      var chSec = sheetSection('CHAPTERS', 'فصل‌ها');
      var dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current.episode.durationSec;
      var at = L.chapterIndexAt(current.episode.chapters, audio.currentTime || 0);
      current.episode.chapters.forEach(function (ch, i) {
        var b = sheetBtn(ch.title + ' · ' + L.fmtTime(ch.startSec), 'pw-sheet__wide' + (i === at ? ' is-at' : ''), null, function () {
          try { audio.currentTime = L.skipTarget(0, ch.startSec, dur); } catch (e) { /* not seekable */ }
          if (audio.paused) { toggle(); }
        });
        b.dir = 'auto';
        chSec.appendChild(b);
      });
      sheet.appendChild(chSec);
    }

    var qSec = sheetSection('UP NEXT', 'در ادامه');
    var queue = store.getQueue();
    var upcoming = queue.filter(function (id) { return id !== current.episode.id; });
    if (!upcoming.length) {
      var none = document.createElement('div');
      none.className = 'pw-sheet__empty';
      none.dir = 'auto';
      none.textContent = 'Queue ends after this episode · صف پس از این قسمت تمام می‌شود';
      qSec.appendChild(none);
    }
    upcoming.forEach(function (id) {
      var ep = findEpisode(id);
      if (!ep) { return; }
      var row = document.createElement('div');
      row.className = 'pw-sheet__qrow';
      var t = document.createElement('span');
      t.className = 'pw-sheet__qtitle';
      t.dir = 'auto';
      t.textContent = ep.title;
      t.title = ep.title;
      row.appendChild(t);
      var x = sheetBtn('\u00D7', 'pw-sheet__x', null, function () {
        store.setQueue(L.withoutId(store.getQueue(), id));
        renderSheet();
      });
      x.setAttribute('aria-label', 'Remove from queue · حذف از صف — ' + ep.title);
      row.appendChild(x);
      qSec.appendChild(row);
    });
    sheet.appendChild(qSec);
    if (sleep.deadline && !sheetTick) { sheetTick = setInterval(updateSleepLine, 1000); }
    if (!sleep.deadline && sheetTick) { clearInterval(sheetTick); sheetTick = 0; }
    if (prevFocus) {
      var nodes = sheet.querySelectorAll('button'), restored = false;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].textContent === prevFocus.txt && nodes[i].className.replace(' is-at', '') === prevFocus.cls) {
          nodes[i].focus({ preventScroll: true }); restored = true; break;
        }
      }
      if (!restored) { var f = sheetFocusables(); if (f.length) { f[0].focus({ preventScroll: true }); } }
    }
  }
  var sheetOutside = null, sheetResize = null;
  function placeSheet() {
    var anchor = sndBtn ? sndBtn.getBoundingClientRect() : null;
    var w = Math.min(360, window.innerWidth - 24);
    sheet.style.width = w + 'px';
    /* Fit the whole sheet inside the viewport: cap its height (it scrolls
       internally) and clamp the top, or the lower rows become unclickable. */
    sheet.style.maxHeight = Math.max(180, window.innerHeight - 24) + 'px';
    var h = sheet.offsetHeight;
    var left = anchor ? Math.min(Math.max(12, anchor.left), window.innerWidth - w - 12) : 12;
    var top = anchor ? anchor.bottom + 10 : 60;
    top = Math.min(top, window.innerHeight - h - 12);
    if (top < 12) { top = 12; }
    sheet.style.left = left + 'px';
    sheet.style.top = top + 'px';
  }
  function openSheet(focusSection) {
    if (!active || !current) { return; }
    buildSheet();
    if (!sheet.hidden) { closeSheet(); }
    renderSheet();
    sheet.hidden = false;
    placeSheet();
    sheetOutside = function (e) {
      if (sheet.hidden) { return; }
      if (sheet.contains(e.target) || (sndBtn && sndBtn.contains(e.target))) { return; }
      closeSheet();
    };
    sheetResize = function () { if (!sheet.hidden) { placeSheet(); } };
    document.addEventListener('mousedown', sheetOutside, true);
    document.addEventListener('touchstart', sheetOutside, true);
    window.addEventListener('resize', sheetResize);
    var f = sheetFocusables();
    var pick = f[0];
    if (focusSection === 'speed' && f.length > 1) { pick = f[1]; }
    if (pick) { pick.focus({ preventScroll: true }); }
  }
  function closeSheet() {
    if (!sheet || sheet.hidden) { return; }
    sheet.hidden = true;
    if (sheetOutside) {
      document.removeEventListener('mousedown', sheetOutside, true);
      document.removeEventListener('touchstart', sheetOutside, true);
      sheetOutside = null;
    }
    if (sheetResize) { window.removeEventListener('resize', sheetResize); sheetResize = null; }
    if (sheetTick) { clearInterval(sheetTick); sheetTick = 0; }
    /* The engine closes its queue pop on the first pointerdown inside the
       sheet, so the opener may now be visibility:hidden — fall back to the
       transport play button instead of losing focus to <body>. */
    if (sndBtn && sndBtn.getClientRects().length && getComputedStyle(sndBtn).visibility === 'visible') {
      sndBtn.focus({ preventScroll: true });
    } else {
      var pb = root.querySelector('.vm-play');
      if (pb && pb.getClientRects().length) { pb.focus({ preventScroll: true }); }
    }
  }

  window.VoidPodcastPlayer = {
    play: play,
    stop: stop,
    toggle: toggle,
    setRate: setRate,
    setSleep: setSleep,
    openSheet: function () { openSheet(); },
    getState: function () {
      return {
        active: active,
        episodeId: current ? current.episode.id : null,
        showId: current ? current.show.id : null,
        playing: active && !audio.paused,
        rate: rate,
        sleepChoice: sleep.choice,
        sleepRemainingMs: L.sleepRemainingMs(Date.now(), sleep.deadline)
      };
    },
    logic: L,
    _test: { audio: audio, sourceFor: sourceFor, saveProgress: saveProgress }
  };
})();