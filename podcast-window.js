/* Void Podcast — window (Stage 2A shell + 2B playback wiring). Sibling of the
   Golden Folder dialog (whose markup/CSS/JS live inline in index.html and must
   not be modified): same glass language, own DOM. Two views (Library -> Show).
   Play buttons drive window.VoidPodcastPlayer when present; without it they
   keep the 2A contract: dispatch 'podcast:play' + a placeholder note.
   Loaded dynamically from the flag-ON branch of void-domains.js. */
(function () {
  'use strict';
  if (window.VoidPodcastWindow) { return; }
  var data = window.VoidPodcastSampleData, Store = window.VoidPodcastStore;
  if (!data || !Store) { return; }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var store = Store.create();

  /* First run: seed subscriptions and a little sample listening state so the
     gold fraction line and dimmed played rows are visible. Local sample only. */
  if (!store.hasPersisted()) {
    data.SHOWS.forEach(function (sh) { store.subscribe(sh.id); });
    store.setProgress('nf-04', 1440, 2400);
    store.setProgress('so-02', 2880, 2880);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.textContent = text; }
    return n;
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ''; }
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function fmtDur(sec) { return Math.max(1, Math.round(sec / 60)) + ' min'; }
  function isTV() { return document.documentElement.classList.contains('void-tv'); }
  /* Fallback artwork is neutral graphite/silver — never the domain hues. */
  function artStyle(node) {
    node.style.background = 'radial-gradient(circle at 32% 28%, rgba(174,184,198,.34), rgba(98,106,120,.22) 58%, rgba(8,10,16,.92))';
    node.style.borderColor = 'rgba(202,210,222,.32)';
  }

  /* ---- dialog shell ---- */
  var dialog = el('dialog', 'pw');
  dialog.id = 'void-podcast-modal';
  dialog.setAttribute('aria-labelledby', 'pw-title');
  var sheen = el('div', 'pw__sheen'); sheen.setAttribute('aria-hidden', 'true');
  var panel = el('div', 'pw__panel');
  var head = el('div', 'pw__head');
  var backBtn = el('button', 'pw__back');
  backBtn.type = 'button';
  backBtn.setAttribute('aria-label', 'Back to library · بازگشت');
  backBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  backBtn.hidden = true;
  var title = el('h2', 'pw__title'); title.id = 'pw-title';
  title.appendChild(el('span', 'pw__title-en', 'PODCAST'));
  title.appendChild(el('span', 'pw__title-sep', '·'));
  var titleFa = el('bdi', 'pw__title-fa', 'پادکست'); titleFa.dir = 'rtl'; titleFa.lang = 'fa';
  title.appendChild(titleFa);
  var closeBtn = el('button', 'pw__close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close · بستن');
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  head.appendChild(backBtn); head.appendChild(title); head.appendChild(closeBtn);

  var body = el('div', 'pw__body');

  /* Library view */
  var libView = el('section', 'pw__view');
  var searchForm = el('form', 'pw__search');
  var searchInput = el('input', 'pw__input');
  searchInput.type = 'text';
  searchInput.dir = 'auto';
  searchInput.setAttribute('placeholder', 'نشانی RSS را بچسبانید یا جستجو کنید');
  searchInput.setAttribute('aria-label', 'نشانی RSS را بچسبانید یا جستجو کنید');
  searchInput.setAttribute('autocomplete', 'off');
  searchForm.appendChild(searchInput);
  var searchNote = el('p', 'pw__note');
  searchNote.setAttribute('role', 'status');
  searchNote.dir = 'auto';
  searchNote.hidden = true;
  var newSection = el('h3', 'pw__section');
  newSection.appendChild(el('span', 'pw__section-en', 'NEW'));
  var newFa = el('bdi', 'pw__section-fa', 'تازه‌ها'); newFa.dir = 'rtl'; newFa.lang = 'fa';
  newSection.appendChild(newFa);
  var newRow = el('div', 'pw__new');
  var mySection = el('h3', 'pw__section');
  mySection.appendChild(el('span', 'pw__section-en', 'MY PODCASTS'));
  var myFa = el('bdi', 'pw__section-fa', 'پادکست‌های من'); myFa.dir = 'rtl'; myFa.lang = 'fa';
  mySection.appendChild(myFa);
  var grid = el('div', 'pw__grid');
  libView.appendChild(searchForm); libView.appendChild(searchNote);
  libView.appendChild(newSection); libView.appendChild(newRow);
  libView.appendChild(mySection); libView.appendChild(grid);

  /* Show view */
  var showView = el('section', 'pw__view');
  showView.hidden = true;
  var showHead = el('div', 'pw__showhead');
  var showArt = el('span', 'pw__art pw__art--lg');
  var showMeta = el('div', 'pw__showmeta');
  var showTitle = el('h3', 'pw__showtitle');
  var showTitleFa = el('p', 'pw__showtitle-fa'); showTitleFa.dir = 'rtl'; showTitleFa.lang = 'fa';
  var showPub = el('p', 'pw__showpub');
  showMeta.appendChild(showTitle); showMeta.appendChild(showTitleFa); showMeta.appendChild(showPub);
  showHead.appendChild(showArt); showHead.appendChild(showMeta);
  var playNote = el('p', 'pw__placeholder');
  playNote.setAttribute('role', 'status');
  playNote.dir = 'auto';
  playNote.hidden = true;
  var epList = el('ul', 'pw__eps');
  showView.appendChild(showHead); showView.appendChild(playNote); showView.appendChild(epList);

  body.appendChild(libView); body.appendChild(showView);
  panel.appendChild(head); panel.appendChild(body);
  dialog.appendChild(sheen); dialog.appendChild(panel);
  document.body.appendChild(dialog);
  /* Music mode hides every body child outside its allowlist (void-music.css)
     with author !important — even a top-layer dialog. Inline !important outranks
     it, so the window stays visible while body.void-music-on is set. */
  dialog.style.setProperty('visibility', 'visible', 'important');
  dialog.style.setProperty('opacity', '1', 'important');
  dialog.style.setProperty('pointer-events', 'auto', 'important');
  /* The engine's stray-node sweep (void-music.js sweep()) marks visible body
     children with data-vm-swept, and void-music.css hides every marked node
     with display:none!important while music mode is on. The mark is the only
     hook: drop it while open (the engine's own unsweep uses the same lever)
     and the rule stops matching. Re-check on open and on any mark write. */
  function unsweepDialog() {
    if (isOpen() && dialog.hasAttribute('data-vm-swept')) { dialog.removeAttribute('data-vm-swept'); }
  }
  if (window.MutationObserver) {
    new MutationObserver(unsweepDialog).observe(dialog, { attributes: true, attributeFilter: ['data-vm-swept', 'open'] });
  }

  /* ---- state ---- */
  var view = 'library', currentShowId = null, showOpener = null, returnFocus = null, fallbackOpen = false;

  function focusables() {
    var nodes = dialog.querySelectorAll('button, input');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.disabled && n.getClientRects().length > 0) { out.push(n); }
    }
    return out;
  }
  function focusFirst() {
    var f = focusables();
    var inBody = f.filter(function (n) { return body.contains(n); });
    var pick = inBody.length ? inBody : f;
    if (pick.length) { pick[0].focus(); }
  }

  /* ---- library rendering ---- */
  /* One row, at most 6 circles, never wraps or scrolls: fit the count to the
     measured body width (item 56px + 2×5px margin; TV 72px). */
  function newCount() {
    var item = (isTV() ? 72 : 56) + 10;
    var w = body.clientWidth || 396;
    return Math.max(1, Math.min(6, Math.floor(w / item)));
  }
  function renderLibrary() {
    newRow.textContent = '';
    data.latest(newCount()).forEach(function (ep) {
      var sh = data.showById(ep.showId);
      var un = Store.isUnlistened(store.getProgress(ep.id));
      var b = el('button', 'pw__newitem');
      b.type = 'button';
      artStyle(b);
      b.appendChild(el('span', 'pw__initials', sh.initials));
      if (un) {
        var dot = el('span', 'pw__dot');
        dot.setAttribute('aria-hidden', 'true');
        b.appendChild(dot);
      }
      var label = ep.title + ' — ' + sh.title + (un ? ' · new' : '');
      b.setAttribute('aria-label', label);
      b.title = label;
      b.addEventListener('click', function () { openShow(ep.showId, b); });
      newRow.appendChild(b);
    });

    grid.textContent = '';
    var subs = store.getState().subscriptions;
    var shows = subs.map(function (id) { return data.showById(id); }).filter(function (s) { return !!s; });
    if (!shows.length) { shows = data.SHOWS; }
    shows.forEach(function (sh) {
      var b = el('button', 'pw__tile');
      b.type = 'button';
      b.setAttribute('aria-label', sh.title + ' · ' + sh.titleFa + ' — ' + sh.publisher);
      var art = el('span', 'pw__art');
      artStyle(art);
      art.appendChild(el('span', 'pw__initials', sh.initials));
      b.appendChild(art);
      b.appendChild(el('span', 'pw__tilename', sh.title));
      var tileFa = el('span', 'pw__tilefa', sh.titleFa); tileFa.dir = 'rtl'; tileFa.lang = 'fa';
      b.appendChild(tileFa);
      b.appendChild(el('span', 'pw__tilepub', sh.publisher));
      b.addEventListener('click', function () { openShow(sh.id, b); });
      grid.appendChild(b);
    });
  }

  /* ---- show rendering ---- */
  var PLAY_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8.5 5.8v12.4c0 .8.9 1.3 1.6.9l9.6-6.2c.6-.4.6-1.4 0-1.8L10.1 4.9c-.7-.4-1.6.1-1.6.9z" fill="currentColor"/></svg>';
  var PAUSE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8.5 5.5v13M15.5 5.5v13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
  function renderShow(showId) {
    var sh = data.showById(showId);
    if (!sh) { return; }
    var ps = window.VoidPodcastPlayer ? window.VoidPodcastPlayer.getState() : null;
    artStyle(showArt);
    showArt.textContent = '';
    showArt.appendChild(el('span', 'pw__initials', sh.initials));
    showTitle.textContent = sh.title;
    showTitleFa.textContent = sh.titleFa;
    showPub.textContent = sh.publisher;
    playNote.hidden = true;
    epList.textContent = '';
    data.episodesOf(showId).forEach(function (ep) {
      var prog = store.getProgress(ep.id);
      var frac = Store.listenedFraction(prog, ep.durationSec);
      var isCur = !!(ps && ps.active && ps.episodeId === ep.id);
      var isPlaying = isCur && ps.playing;
      var li = el('li', 'pw__ep' + (prog && prog.completed ? ' is-played' : '') + (isCur ? ' is-current' : ''));
      var play = el('button', 'pw__play');
      play.type = 'button';
      play.setAttribute('data-ep', ep.id);
      play.setAttribute('aria-pressed', isCur ? 'true' : 'false');
      play.setAttribute('aria-label', (isPlaying ? 'Pause · توقف' : 'Play · پخش') + ' — ' + ep.title);
      play.innerHTML = isPlaying ? PAUSE_SVG : PLAY_SVG;
      play.addEventListener('click', function () {
        var P = window.VoidPodcastPlayer;
        try {
          window.dispatchEvent(new CustomEvent('podcast:play', { detail: { episode: ep, show: sh, placeholder: !P } }));
        } catch (err) { /* CustomEvent unavailable */ }
        if (!P) {
          playNote.textContent = 'PLACEHOLDER · no audio yet — playback arrives in Stage 2B. «' + ep.title + '» — پخش در مرحلهٔ ۲B';
          playNote.hidden = false;
          return;
        }
        var st = P.getState();
        if (st.active && st.episodeId === ep.id) { P.toggle(); return; }
        var res = P.play(ep, sh);
        if (!res.ok && res.reason === 'no-source') {
          playNote.textContent = 'No audio source yet — add a git-ignored podcast-dev-config.local.js to test playback · هنوز فایل صوتی برای این قسمت نیست';
          playNote.hidden = false;
        }
      });
      var meta = el('div', 'pw__epmeta');
      var t = el('span', 'pw__eptitle');
      t.appendChild(document.createTextNode(ep.title + ' '));
      var epFa = el('bdi', 'pw__eptitle-fa', ep.titleFa); epFa.dir = 'rtl'; epFa.lang = 'fa';
      t.appendChild(epFa);
      meta.appendChild(t);
      meta.appendChild(el('span', 'pw__epsub', fmtDate(ep.publishedAt) + ' · ' + fmtDur(ep.durationSec)));
      var rail = el('span', 'pw__rail');
      rail.setAttribute('aria-hidden', 'true');
      var fill = el('span', 'pw__fill');
      fill.style.width = (frac * 100).toFixed(2) + '%';
      rail.appendChild(fill);
      li.appendChild(play); li.appendChild(meta); li.appendChild(rail);
      epList.appendChild(li);
    });
  }

  function openShow(showId, opener) {
    currentShowId = showId;
    showOpener = opener || null;
    view = 'show';
    renderShow(showId);
    libView.hidden = true;
    showView.hidden = false;
    backBtn.hidden = false;
    body.scrollTop = 0;
    backBtn.focus();
  }
  function backToLibrary() {
    view = 'library';
    currentShowId = null;
    renderLibrary();
    showView.hidden = true;
    libView.hidden = false;
    backBtn.hidden = true;
    body.scrollTop = 0;
    if (showOpener && showOpener.getClientRects().length > 0) { showOpener.focus(); }
    else { focusFirst(); }
    showOpener = null;
  }

  /* ---- open / close ---- */
  function open(opts) {
    opts = opts || {};
    if (isOpen()) {
      if (view === 'show') { backToLibrary(); }
      return;
    }
    returnFocus = opts.returnFocus || document.activeElement;
    view = 'library';
    currentShowId = null;
    renderLibrary();
    showView.hidden = true;
    libView.hidden = false;
    backBtn.hidden = true;
    searchNote.hidden = true;
    body.scrollTop = 0;
    fallbackOpen = false;
    try {
      if (typeof dialog.showModal === 'function') { dialog.showModal(); }
      else { throw new Error('no showModal'); }
    } catch (e) {
      fallbackOpen = true;
      dialog.classList.add('pw--fallback');
      dialog.setAttribute('open', '');
    }
    if (isTV()) { focusFirst(); }
    else { searchInput.focus(); }
  }
  function restoreFocus() {
    if (returnFocus && returnFocus.focus && returnFocus.getClientRects && returnFocus.getClientRects().length > 0) {
      try { returnFocus.focus(); } catch (e) { /* opener gone */ }
    }
    returnFocus = null;
  }
  function close() {
    if (!isOpen()) { return; }
    if (fallbackOpen) {
      dialog.removeAttribute('open');
      dialog.classList.remove('pw--fallback');
      fallbackOpen = false;
      restoreFocus();
    } else {
      try { dialog.close(); } catch (e) { dialog.removeAttribute('open'); restoreFocus(); }
    }
  }
  function isOpen() { return dialog.hasAttribute('open'); }

  dialog.addEventListener('close', function () { restoreFocus(); });
  dialog.addEventListener('click', function (e) { if (e.target === dialog) { close(); } });
  closeBtn.addEventListener('click', close);
  backBtn.addEventListener('click', backToLibrary);

  /* Inert search: quiet inline note, never a network request. */
  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    searchNote.textContent = 'RSS import and search are coming soon · به‌زودی';
    searchNote.hidden = false;
  });

  /* D-pad / arrow navigation + TV Back key + fallback Tab trap.
     Window capture runs BEFORE the engine's document-capture onKey
     (void-music.js), which would otherwise turn arrows into volume/seek and
     Esc into music-exit while focus is inside this dialog. Keys aimed at the
     open modal never reach the engine; unhandled defaults (Enter, typing,
     native Esc cancel) stay intact. */
  window.addEventListener('keydown', function (e) {
    if (!isOpen() || !dialog.contains(e.target)) { return; }
    var k = e.key;
    if (k === 'BrowserBack' || k === 'GoBack' || e.keyCode === 4) {
      e.preventDefault(); e.stopPropagation();
      if (view === 'show') { backToLibrary(); } else { close(); }
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight') {
      if (document.activeElement === searchInput && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.stopPropagation(); return; }
      var f = focusables();
      if (f.length) {
        var i = f.indexOf(document.activeElement);
        var fwd = (k === 'ArrowDown' || k === 'ArrowRight');
        var next = i < 0 ? 0 : (i + (fwd ? 1 : -1) + f.length) % f.length;
        e.preventDefault();
        f[next].focus();
      }
      e.stopPropagation();
      return;
    }
    if (fallbackOpen && k === 'Tab') {
      var ff = focusables();
      if (ff.length) {
        var first = ff[0], last = ff[ff.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
  }, true);

  /* Live state: progress / subscription / playback changes re-render the
     current view, keeping focus on the same episode's button when possible. */
  function rerender() {
    var active = document.activeElement;
    var hadFocus = dialog.contains(active);
    var epId = hadFocus && active.getAttribute ? active.getAttribute('data-ep') : null;
    if (view === 'show' && currentShowId) { renderShow(currentShowId); }
    else { renderLibrary(); }
    if (!hadFocus || dialog.contains(document.activeElement)) { return; }
    if (epId) {
      var again = dialog.querySelector('[data-ep="' + epId + '"]');
      if (again && again.getClientRects().length > 0) { again.focus(); return; }
    }
    focusFirst();
  }
  store.onChange(rerender);
  ['podcast:episode', 'podcast:playing'].forEach(function (name) {
    window.addEventListener(name, function () { if (isOpen()) { rerender(); } });
  });

  /* The NEW row count depends on the measured width: refit on resize while open. */
  window.addEventListener('resize', function () {
    if (isOpen() && view === 'library') { renderLibrary(); }
  });

  window.VoidPodcastWindow = {
    open: open,
    close: close,
    isOpen: isOpen,
    getView: function () { return view; },
    getStore: function () { return store; }
  };
})();