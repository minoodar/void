/* Void Podcast — Phase 2B playback controller.
   Part 1: pure logic (UMD, Node-testable) — resume, queue, sleep, seek, formats.
   Part 2: browser controller (flag-ON only). A second hidden <audio> (no
   crossOrigin, no analyser) is hosted by the engine through the Phase 2B guest
   API (VoidMusic.hostGuest/unhostGuest): the chrome (title row, play state, arc,
   time, seek) follows this element while hosted, but Music's own playback,
   queue, remotes and visualizer are untouched — this element never becomes the
   engine's S.audio owner and never dispatches voidmusic:playing. Podcast owns
   its MediaSession while active; the engine reclaims it when music plays or the
   podcast stops. Playback is EXCLUSIVE (Phase 2B.2): starting or resuming either
   player pauses the other one's Audio Element; a paused player never reclaims
   the MediaSession merely because it has a selected episode or track.
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

  /* Episode queue (Phase 2B.4): the ids of the show's episodes, newest first,
     with the current one left in place. Older rollover and Prev/Next both walk
     this one list, so a skipped row (removed with ×) is skipped by both. When
     the current id is not in the feed at all, the queue is that id alone: an
     episode we cannot locate must not become a bridge to other episodes. */
  function queueFrom(episodes, currentId) {
    var ids = episodes.map(function (e) { return e.id; });
    return ids.indexOf(currentId) < 0 ? [currentId] : ids;
  }
  function nextInQueue(queue, currentId) {
    var i = queue.indexOf(currentId);
    return i >= 0 && i + 1 < queue.length ? queue[i + 1] : null;
  }
  /* The mirror of nextInQueue: index 0 (and an id missing from the queue) have
     no older episode, so Previous is a no-op rather than a wrap-around. */
  function prevInQueue(queue, currentId) {
    var i = queue.indexOf(currentId);
    return i > 0 ? queue[i - 1] : null;
  }
  function withoutId(queue, id) {
    return queue.filter(function (x) { return x !== id; });
  }
  /* Rows still ahead of the current episode (the UP NEXT list) — the tail the
     queue used to hold by construction. An id missing from the queue leaves
     indexOf at -1, so the whole list is ahead. */
  function upcomingFrom(queue, currentId) {
    return queue.slice(queue.indexOf(currentId) + 1);
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
    prevInQueue: prevInQueue, upcomingFrom: upcomingFrom,
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
  if (!L || !VM || typeof VM.hostGuest !== 'function' || typeof VM.unhostGuest !== 'function' || !data || !Store) { return; }
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
  /* Phase 2B.1: the engine never swaps S.audio to this element, so Music's
     volume/mute path (applyVolume) can no longer reach it. Phase 2B.4 gives
     this element its OWN volume: restored from the Podcast store here, and
     written only through the `setVol` verb below — Music's slider keeps its
     own state in void-music.js and never reaches this element. */
  audio.volume = restoreVolume();
  root.appendChild(audio);

  var current = null;                 // { episode, show }
  var active = false;
  var rate = restoreRate();
  var sleep = { choice: 'off', deadline: 0, timer: 0 };
  var lastSave = 0;
  var pendingSeek = null;
  var chip = null, ticks = [], sheet = null, sheetTick = 0;
  var sndBtn = null, sndIntercept = null;
  var retriedSrc = '', retryTimer = 0;

  function saveProgress() {
    if (!current) { return; }
    var ep = current.episode;
    store.setProgress(ep.id, audio.currentTime || 0, ep.durationSec, audio.ended === true);
    lastSave = Date.now();
  }

  /* Restore the persisted playback rate; snap unknown stored values (older
     payloads, hand-edits) to the nearest known step. */
  function restoreRate() {
    var r = Store.parseRate ? Store.parseRate(store.getRate()) : store.getRate();
    if (L.RATES.indexOf(r) >= 0) { return r; }
    var best = 1, d = Infinity;
    L.RATES.forEach(function (x) {
      var dd = Math.abs(x - r);
      if (dd < d) { d = dd; best = x; }
    });
    return best;
  }

  /* Podcast-scoped volume (Phase 2B.4). Same tolerant restore shape as
     restoreRate: an old payload (or a hand-edited one) degrades to the store's
     default instead of throwing, and nothing here ever reads Music's volume. */
  function restoreVolume() {
    return Store.parseVolume ? Store.parseVolume(store.getVolume()) : store.getVolume();
  }
  /* The one write path for this element's volume, reached only from the shared
     dock slider while the Podcast owns the session. */
  audio.setVol = function (v) {
    var vol = Store.parseVolume ? Store.parseVolume(v) : Math.max(0, Math.min(1, v));
    audio.volume = vol;
    store.setVolume(vol);
    return vol;
  };

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

  /* ---- Media Session ownership ----
     The podcast claims the OS session when playback STARTS (play() only —
     pause/resume never re-claims). The claim is recorded by the engine
     (hostGuest -> sessionOwner 'guest'); Music reclaims on its own playback
     (playId -> sessionOwner 'music') and on unhostGuest while the guest still
     owns. Exactly one writer at a time. Teardown is owner-aware (Phase 2B.1):
     after a Music takeover, stopping the podcast must not clear or overwrite
     Music's metadata or handlers. */
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
  /* Phase 2B.2: the single choke point for every genuine Podcast start/resume
     (play, transport toggle-resume, bounded retry). hostGuest is the engine's
     exclusive-playback claim: it pauses Music's element and records the guest
     as session owner; claimSession republishes the episode metadata/handlers. */
  function engageGuest() {
    if (!current) { return; }
    VM.hostGuest(audio, { title: current.episode.title, artist: current.show.title });
    claimSession();
  }
  function claimSession() {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setActionHandler !== 'function') { return; }
    var set = function (name, fn) {
      try { navigator.mediaSession.setActionHandler(name, fn); } catch (e) { /* unsupported action */ }
    };
    publishMetadata();
    set('play', function () { toggle(); });
    set('pause', function () { toggle(); });
    /* Phase 2B.4 (Option B): the OS/hardware track keys match the dock's
       Prev/Next buttons (episode steps); the ±15/±30 second jumps stay on the
       seek actions the OS shows as its own controls. */
    set('previoustrack', function () { stepEpisode(-1); });
    set('nexttrack', function () { stepEpisode(1); });
    set('seekbackward', function (d) { seekBy(-1 * ((d && d.seekOffset) || L.SKIP_BACK_SEC)); });
    set('seekforward', function (d) { seekBy((d && d.seekOffset) || L.SKIP_FWD_SEC); });
    set('seekto', function (d) { if (d && typeof d.seekTime === 'number') { seekTo(d.seekTime); } });
    set('stop', function () { stop(); });
  }
  /* Phase 2B.3 (M5): explicit, owner-safe release. The list is exactly the
     eight actions claimSession registers, so after teardown no Podcast handler
     can stay attached to navigator.mediaSession. */
  var SESSION_ACTIONS = ['play', 'pause', 'previoustrack', 'nexttrack',
    'seekbackward', 'seekforward', 'seekto', 'stop'];
  function releaseSession() {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setActionHandler !== 'function') { return; }
    SESSION_ACTIONS.forEach(function (name) {
      try { navigator.mediaSession.setActionHandler(name, null); } catch (e) { /* unsupported action */ }
    });
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
    store.setRate(r);
    try { audio.playbackRate = r; } catch (e) { /* engine clamps unsupported rates */ }
    if (chip) { chip.textContent = L.rateLabel(r); }
    if (sheet && !sheet.hidden) { renderSheet(); }
  }

  /* ---- mode enter / teardown ---- */
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
    /* Metadata is published by claimSession() right after the explicit
       hostGuest claim in play() — never before the claim. */
    syncEmblem();
    /* Synthetic Voice Thread owns the central orb only during a Podcast session.
       It never touches playback, Web Audio, crossOrigin or the Music analyser. */
    if (window.VoidPodcastThread && typeof window.VoidPodcastThread.start === 'function') {
      window.VoidPodcastThread.start(audio, { getGeometry: window.VoidDomains && window.VoidDomains.getOrbGeometry });
    }
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
    /* Phase 2B.1: only the owner clears. If Music took over while this
       episode kept playing (playId -> unhostGuest), stopping here must not
       clear or overwrite Music's MediaSession metadata.
       Phase 2B.3 (M5): when the Podcast is still the owner, releasing also
       detaches every action handler so no stale Podcast callback survives. */
    if (!(VM.sessionOwner && VM.sessionOwner() === 'music')) { clearMetadata(); releaseSession(); }
    syncEmblem();
    if (window.VoidPodcastThread && typeof window.VoidPodcastThread.stop === 'function') { window.VoidPodcastThread.stop(); }
    current = null;
    emit('podcast:episode', { episodeId: null, showId: null, active: false, playing: false });
  }

  /* Verbs from the shared dock chrome (void-music.js) while the Podcast owns
     the session. Phase 2B.4 (Option B): Prev/Next are episode steps, the ±
     second shortcuts stay seeks. arg is the engine's own delta (seconds). */
  audio.cmd = function (name, arg) {
    if (!active) { return; }
    if (name === 'nexttrack') { stepEpisode(1); }
    else if (name === 'previoustrack') { stepEpisode(-1); }
    else if (name === 'seekforward') { seekBy(typeof arg === 'number' ? Math.abs(arg) : L.SKIP_FWD_SEC); }
    else if (name === 'seekbackward') { seekBy(-1 * (typeof arg === 'number' ? Math.abs(arg) : L.SKIP_BACK_SEC)); }
  };

  function seekBy(delta) {
    var dur = isFinite(audio.duration) ? audio.duration : (current ? current.episode.durationSec : 0);
    try { audio.currentTime = L.skipTarget(audio.currentTime, delta, dur); } catch (e) { /* not seekable yet */ }
  }
  function seekTo(t) {
    var dur = isFinite(audio.duration) ? audio.duration : (current ? current.episode.durationSec : 0);
    try { audio.currentTime = Math.max(0, Math.min(t, dur > 0 ? dur : t)); } catch (e) { /* not seekable yet */ }
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
  window.addEventListener('pagehide', function () {
    if (active) { saveProgress(); }
  });

  /* ---- bounded retry: exactly one re-issue for a transient network failure ----
     MEDIA_ERR_NETWORK (2) is the only eligible class; unsupported or decode
     errors are permanent and never retried. The retry replays the SAME source
     in place: no queue change, no extra events, no state faking — if it fails
     again the audio element keeps its error and the thread shows ERROR. */
  audio.addEventListener('error', function () {
    if (!active || !current) { return; }
    var err = audio.error;
    if (!err || err.code !== 2) { return; }
    var src = audio.currentSrc || audio.src || '';
    if (!src || retriedSrc === src) { return; }
    retriedSrc = src;
    if (retryTimer) { clearTimeout(retryTimer); }
    retryTimer = setTimeout(function () {
      retryTimer = 0;
      if (!active || !current) { return; }
      try { audio.load(); } catch (e) { return; }
      engageGuest();   // Phase 2B.2: the retry is a genuine resume — pause Music, re-claim
      var pr = audio.play();
      if (pr && pr.catch) { pr.catch(function () { /* retry failed: error state stands */ }); }
    }, 1500);
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
    store.setQueue(L.queueFrom(data.episodesOf(show.id), episode.id));   // Phase 2B.4: the whole show, current left in place -> Prev has somewhere to go
    pendingSeek = start;
    retriedSrc = '';
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = 0; }
    audio.src = src;
    try { audio.playbackRate = rate; } catch (e) { /* default 1 */ }
    /* The podcast-mode UI (title row, arc, chip, sheet) lives in the engine's
       root, which only exists in music mode. Enter through the PUBLIC API —
       enter() never auto-plays local music. */
    if (!document.body.classList.contains('void-music-on') && typeof VM.enter === 'function') { VM.enter(); }
    ensureRoot();
    if (!active) { enterMode(); } else { drawTicks(); publishMetadata(); }
    /* Host the podcast as the engine's GUEST: the chrome (title row, arc,
       transport) follows this audio while hosted, and the engine pauses
       Music's OWN element (Phase 2B.2 exclusive playback). Nothing else of
       Music is touched — no S.web, no curId displacement, no remote
       deactivation, no S.audio swap (the engine reads this element via
       S.guest only, so Music's element identity, volume and the
       visualizer's getAudio() never see it), and no voidmusic:playing
       dispatch from this element, so the visualizer can never enter a
       podcast-driven cosmic session. */
    engageGuest();
    var pr = audio.play();
    if (pr && pr.catch) { pr.catch(function () { /* gesture policy: UI shows paused, play button resumes */ }); }
    emit('podcast:episode', { episodeId: episode.id, showId: show.id, active: true, playing: !audio.paused });
    return { ok: true };
  }
  function stop() {
    if (!active) { return; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = 0; }
    saveProgress();
    try { audio.pause(); } catch (e) { /* paused */ }
    teardownMode();
    /* Hand the chrome and the MediaSession back to the engine. Never resumes
       music; never touches this (already paused) audio. */
    VM.unhostGuest();
    try { audio.removeAttribute('src'); audio.load(); } catch (e) { /* release the buffer */ }
  }
  function toggle() {
    if (!active) { return; }
    if (audio.paused) {
      engageGuest();   // Phase 2B.2: resuming is a genuine start — pause Music, claim the session
      var pr = audio.play();
      if (pr && pr.catch) { pr.catch(function () { /* blocked */ }); }
    } else { audio.pause(); }
  }

  /* ---- Phase 2B.4 (Option B): Previous / Next Episode ----
     The navigation domain is the stored queue, i.e. the current show's
     episodes in feed order — so a step can never leave the show and never
     invents an episode. An unavailable step (first row, last row, or an id the
     feed no longer carries) returns a reason and changes NOTHING: the current
     episode stays loaded and playing, the MediaSession keeps its owner, and
     stop() is never reached, so the chrome and the Voice Thread survive.
     A successful step is an ordinary play() of the neighbour, which re-claims
     the session through engageGuest exactly like any other start. */
  function stepEpisode(direction) {
    if (!active || !current) { return { ok: false, reason: 'not-playing' }; }
    var dir = direction < 0 ? -1 : 1;
    var queue = store.getQueue();
    var id = dir < 0 ? L.prevInQueue(queue, current.episode.id) : L.nextInQueue(queue, current.episode.id);
    if (!id) { return { ok: false, reason: dir < 0 ? 'no-previous' : 'no-next' }; }
    var ep = findEpisode(id);
    if (!ep) { return { ok: false, reason: 'episode-missing' }; }
    var sh = data.showById(ep.showId);
    if (!sh) { return { ok: false, reason: 'show-missing' }; }
    var res = play(ep, sh);
    if (!res.ok) { return res; }
    return { ok: true, episodeId: ep.id, showId: sh.id, direction: dir };
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
    var upcoming = L.upcomingFrom(queue, current.episode.id);
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
    stepEpisode: stepEpisode,
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
        volume: audio.volume,
        queueLength: store.getQueue().length,
        sleepChoice: sleep.choice,
        sleepRemainingMs: L.sleepRemainingMs(Date.now(), sleep.deadline)
      };
    },
    logic: L,
    _test: { audio: audio, sourceFor: sourceFor, saveProgress: saveProgress, stepEpisode: stepEpisode }
  };
})();