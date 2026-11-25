/* Void Podcast — window (Stage 2A shell + 2B playback + 3A real feeds).
   Sibling of the Golden Folder dialog (whose markup/CSS/JS live inline in
   index.html and must not be modified): same glass language, own DOM.
   Two views (Library -> Show). Add by RSS goes through the void-podcast
   Worker, is parsed by VoidPodcastFeed and rendered as text only. Saved
   episodes are self-contained snapshots that play without a subscription.
   The sample catalogue ships only when the git-ignored dev config sets
   sample:true; otherwise the first run is a calm empty state.
   Loaded dynamically from the flag-ON branch of void-domains.js. */
(function () {
  'use strict';
  if (window.VoidPodcastWindow) { return; }
  var data = window.VoidPodcastSampleData, Store = window.VoidPodcastStore, Feed = window.VoidPodcastFeed;
  if (!data || !Store || !Feed) { return; }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SAVED_ID = 'saved';
  var REFRESH_MS = 30 * 60 * 1000;
  var FETCH_TIMEOUT_MS = 15000;
  var DEFAULT_WORKER = 'https://void-podcast.minoodar.workers.dev';
  var store = Store.create();

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
  function fmtStamp(ms) {
    var d = new Date(ms);
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
  /* Real artwork loads straight from the publisher (https, host-checked by
     the parser). Initials stay as the fallback until — and unless — it loads. */
  function fillArt(node, artUrl, initials) {
    var ini = el('span', 'pw__initials', initials || '?');
    if (artUrl) {
      var img = document.createElement('img');
      img.className = 'pw__artimg';
      img.alt = '';
      img.onload = function () { ini.hidden = true; };
      img.onerror = function () { if (img.parentNode) { img.parentNode.removeChild(img); } };
      node.appendChild(img);
      img.src = artUrl;
    }
    node.appendChild(ini);
  }

  /* ---- live catalogue ----
     The player reads data.SHOWS / data.EPISODES (findEpisode, episodesOf), so
     real feeds are registered into those same arrays. Sample entries are held
     aside and only returned when the dev config explicitly asks for them. */
  var sampleShows = data.SHOWS.slice(), sampleEpisodes = data.EPISODES.slice();
  data.SHOWS.splice(0, data.SHOWS.length);
  data.EPISODES.splice(0, data.EPISODES.length);

  function catalogSet(show, eps) {
    var i, idx = -1;
    for (i = 0; i < data.SHOWS.length; i++) { if (data.SHOWS[i].id === show.id) { idx = i; } }
    if (idx >= 0) { data.SHOWS[idx] = show; } else { data.SHOWS.push(show); }
    for (i = data.EPISODES.length - 1; i >= 0; i--) {
      if (data.EPISODES[i].showId === show.id) { data.EPISODES.splice(i, 1); }
    }
    (eps || []).forEach(function (e) { data.EPISODES.push(e); });
  }
  function catalogRemove(showId) {
    var i;
    for (i = data.SHOWS.length - 1; i >= 0; i--) { if (data.SHOWS[i].id === showId) { data.SHOWS.splice(i, 1); } }
    for (i = data.EPISODES.length - 1; i >= 0; i--) { if (data.EPISODES[i].showId === showId) { data.EPISODES.splice(i, 1); } }
  }
  /* Saved episodes live in the catalogue as a virtual show so the player can
     find and queue them; the snapshots themselves stay in the separate key. */
  var savedSig = null;
  function syncSavedCatalog() {
    var saved = store.getSaved();
    var sig = saved.map(function (s) { return s.id + ':' + s.savedAt; }).join(',');
    if (sig === savedSig) { return; }
    savedSig = sig;
    catalogRemove(SAVED_ID);
    if (!saved.length) { return; }
    data.SHOWS.push({ id: SAVED_ID, title: 'Saved', titleFa: 'ذخیره‌شده‌ها', publisher: '', feedUrl: '', artUrl: '', initials: '★' });
    saved.forEach(function (s) {
      var e = {};
      Object.keys(s).forEach(function (f) { e[f] = s[f]; });
      e.showId = SAVED_ID;
      e.titleFa = '';
      data.EPISODES.push(e);
    });
  }
  store.getState().subscriptions.forEach(function (id) {
    var sh = store.getShow(id);
    if (sh) { catalogSet(sh, store.getEpisodes(id)); }
  });
  syncSavedCatalog();

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
  searchInput.setAttribute('aria-label', 'Add by RSS link · افزودن با نشانی RSS');
  searchInput.setAttribute('autocomplete', 'off');
  var addBtn = el('button', 'pw__addbtn', 'Add · افزودن');
  addBtn.type = 'submit';
  searchForm.appendChild(searchInput); searchForm.appendChild(addBtn);
  var searchNote = el('p', 'pw__note');
  searchNote.setAttribute('role', 'status');
  searchNote.dir = 'auto';
  searchNote.hidden = true;
  var previewBox = el('div', 'pw__preview');
  previewBox.hidden = true;
  var newSection = el('h3', 'pw__section');
  newSection.appendChild(el('span', 'pw__section-en', 'NEW'));
  var newFa = el('bdi', 'pw__section-fa', 'تازه‌ها'); newFa.dir = 'rtl'; newFa.lang = 'fa';
  newSection.appendChild(newFa);
  var newRow = el('div', 'pw__new');
  var savedSection = el('h3', 'pw__section');
  savedSection.appendChild(el('span', 'pw__section-en', 'BOOKMARKS'));
  var savedFa = el('bdi', 'pw__section-fa', 'نشان‌شده‌ها'); savedFa.dir = 'rtl'; savedFa.lang = 'fa';
  savedSection.appendChild(savedFa);
  var savedRow = el('div', 'pw__saved');
  var mySection = el('h3', 'pw__section');
  mySection.appendChild(el('span', 'pw__section-en', 'MY PODCASTS'));
  var myFa = el('bdi', 'pw__section-fa', 'پادکست‌های من'); myFa.dir = 'rtl'; myFa.lang = 'fa';
  mySection.appendChild(myFa);
  var grid = el('div', 'pw__grid');
  var opmlRow = el('div', 'pw__opml');
  var exportBtn = el('button', 'pw__opmlbtn', 'Export OPML · خروجی');
  exportBtn.type = 'button';
  var importBtn = el('button', 'pw__opmlbtn', 'Import OPML · ورود');
  importBtn.type = 'button';
  var fileInput = el('input', 'pw__file');
  fileInput.type = 'file';
  fileInput.accept = '.opml,.xml,text/xml';
  fileInput.hidden = true;
  opmlRow.appendChild(exportBtn); opmlRow.appendChild(importBtn); opmlRow.appendChild(fileInput);
  libView.appendChild(searchForm); libView.appendChild(searchNote); libView.appendChild(previewBox);
  libView.appendChild(newSection); libView.appendChild(newRow);
  libView.appendChild(savedSection); libView.appendChild(savedRow);
  libView.appendChild(mySection); libView.appendChild(grid); libView.appendChild(opmlRow);

  /* Show view */
  var showView = el('section', 'pw__view');
  showView.hidden = true;
  var showHead = el('div', 'pw__showhead');
  var showArt = el('span', 'pw__art pw__art--lg');
  var showMeta = el('div', 'pw__showmeta');
  var showTitle = el('h3', 'pw__showtitle');
  var showTitleFa = el('p', 'pw__showtitle-fa'); showTitleFa.dir = 'rtl'; showTitleFa.lang = 'fa';
  var showPub = el('p', 'pw__showpub');
  var showFetch = el('p', 'pw__showfetch');
  showFetch.hidden = true;
  showMeta.appendChild(showTitle); showMeta.appendChild(showTitleFa); showMeta.appendChild(showPub);
  showMeta.appendChild(showFetch);
  showHead.appendChild(showArt); showHead.appendChild(showMeta);
  var showActions = el('div', 'pw__showactions');
  var playNote = el('p', 'pw__placeholder');
  var errorNote = '';                 /* persistent playback-error text; survives rerender */
  playNote.setAttribute('role', 'status');
  playNote.dir = 'auto';
  playNote.hidden = true;
  var epList = el('ul', 'pw__eps');
  showView.appendChild(showHead); showView.appendChild(showActions);
  showView.appendChild(playNote); showView.appendChild(epList);

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
  var preview = null, busy = false, importing = false, refreshing = false;
  var confirming = false, confirmTimer = 0;

  function focusables() {
    var nodes = dialog.querySelectorAll('button, input');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.disabled && !n.hidden && n.getClientRects().length > 0) { out.push(n); }
    }
    return out;
  }
  function focusFirst() {
    var f = focusables();
    var inBody = f.filter(function (n) { return body.contains(n); });
    var pick = inBody.length ? inBody : f;
    if (pick.length) { pick[0].focus(); }
  }
  function showNote(text) {
    searchNote.textContent = text;
    searchNote.hidden = false;
  }
  function resetConfirm() {
    confirming = false;
    if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = 0; }
  }

  /* ---- Worker access ---- */
  function feedBase() {
    var cfg = window.VoidPodcastDevConfig;
    return (cfg && typeof cfg.feedWorker === 'string' && cfg.feedWorker) || DEFAULT_WORKER;
  }
  function fetchFeedText(url) {
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) { ctrl.abort(); } }, FETCH_TIMEOUT_MS);
      var opts = { method: 'GET' };
      if (ctrl) { opts.signal = ctrl.signal; }
      fetch(feedBase() + '/feed?url=' + encodeURIComponent(url), opts).then(function (res) {
        if (!res.ok) {
          return res.json().then(function (j) {
            throw { code: (j && j.error) || 'unreachable' };
          }, function () { throw { code: 'unreachable' }; });
        }
        /* The Worker echoes validator metadata in x-void-* headers (2B §C).
           Stored per show on adopt; display-only for now — no conditional
           GET until the Worker agrees to honour it (Decision 3). */
        return res.text().then(function (text) {
          var hd = res.headers;
          var get = hd && typeof hd.get === 'function' ? hd.get : function () { return null; };
          return {
            text: text,
            etag: get.call(hd, 'x-void-etag') || '',
            lastModified: get.call(hd, 'x-void-last-modified') || '',
            /* Phase 2B.3 (M2): the URL the Worker actually reached after its
               own redirects. Absent from older Workers — then the entered URL
               keeps working as the only base. */
            finalUrl: get.call(hd, 'x-void-final-url') || ''
          };
        });
      }).then(function (fetched) {
        clearTimeout(timer);
        resolve(fetched);
      }, function (err) {
        clearTimeout(timer);
        reject(err && typeof err.code === 'string' ? err : { code: ctrl && ctrl.signal.aborted ? 'timeout' : 'network' });
      });
    });
  }
  function addFeed(url) {
    return fetchFeedText(url).then(function (fetched) {
      /* The reported final URL is client-side re-validated (https, no
         credentials) before it may act as a base; an unsafe value is dropped
         and the entered URL stands. */
      var effective = Feed.safeFeedUrl(fetched.finalUrl || '') || '';
      var parsed = Feed.parseFeed(fetched.text, url, effective);
      if (!parsed.ok) { throw { code: parsed.reason || 'not-feed' }; }
      parsed.fetchedMeta = { etag: fetched.etag, lastModified: fetched.lastModified };
      return parsed;
    });
  }
  function adoptFeed(parsed) {
    var prev = store.getShow(parsed.show.id);
    var show = parsed.show;
    show.addedAt = prev && prev.addedAt ? prev.addedAt : Date.now();
    show.lastFetchedAt = Date.now();
    catalogSet(show, parsed.episodes);
    store.registerShow(show, parsed.episodes);
    var meta = parsed.fetchedMeta || {};
    store.setFetchMeta(show.id, { lastFetchedAt: show.lastFetchedAt, etag: meta.etag || '', lastModified: meta.lastModified || '' });
    return show;
  }

  /* ---- preview (Add by RSS) ---- */
  function renderPreview() {
    previewBox.textContent = '';
    if (!preview) { previewBox.hidden = true; return; }
    previewBox.hidden = false;
    var p = preview;
    var art = el('span', 'pw__art pw__previewart');
    artStyle(art);
    fillArt(art, p.show.artUrl, p.show.initials);
    var meta = el('div', 'pw__previewmeta');
    meta.appendChild(el('div', 'pw__previewtitle', p.show.title));
    meta.appendChild(el('div', 'pw__previewpub', p.show.publisher));
    meta.appendChild(el('div', 'pw__previewcount', p.count + ' episodes · قسمت'));
    var already = store.isSubscribed(p.show.id);
    var add = el('button', 'pw__preview-add', already ? 'Update · به‌روزرسانی' : 'Add to my podcasts · افزودن');
    add.type = 'button';
    add.setAttribute('data-preview-add', '');
    add.addEventListener('click', function () {
      adoptFeed(p);
      if (!store.isSubscribed(p.show.id)) { store.subscribe(p.show.id); }
      preview = null;
      searchInput.value = '';
      showNote('Added to your podcasts · به پادکست‌هایتان اضافه شد');
      renderPreview();
      renderLibrary();
    });
    var x = el('button', 'pw__preview-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Dismiss · بستن');
    x.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    x.addEventListener('click', function () { preview = null; renderPreview(); searchInput.focus(); });
    previewBox.appendChild(art); previewBox.appendChild(meta);
    previewBox.appendChild(add); previewBox.appendChild(x);
  }

  /* ---- local library search (2B §C) ----
     Runs against registered subscriptions and cached episodes only — no
     provider API, no network (Decision 2 scope). Results reuse the preview
     box; actions are plain buttons so no new CSS is needed. */
  function localSearch(q) {
    var needle = q.toLowerCase();
    var st = store.getState();
    var shows = [], episodes = [], truncated = false;
    st.subscriptions.forEach(function (id) {
      /* تورِ جستجو باید با همان چیزی که کتابخانه نشان می‌دهد یکی باشد؛
        نمایش‌های نمونهٔ محلی (data.SHOWS) در store.shows ثبت نمی‌شوند. */
      var sh = st.shows[id] || data.showById(id);
      if (!sh) { return; }
      var shHay = ((sh.title || '') + ' ' + (sh.titleFa || '') + ' ' + (sh.publisher || '')).toLowerCase();
      if (shHay.indexOf(needle) >= 0) { shows.push(sh); }
      var eps = data.episodesOf(id);
      for (var i = 0; i < eps.length; i++) {
        var ep = eps[i];
        var epHay = ((ep.title || '') + ' ' + (ep.titleFa || '')).toLowerCase();
        if (epHay.indexOf(needle) >= 0) {
          if (episodes.length < 8) { episodes.push({ ep: ep, show: sh }); }
          else { truncated = true; }
        }
      }
    });
    if (shows.length > 6) { shows = shows.slice(0, 6); truncated = true; }
    return { shows: shows, episodes: episodes, truncated: truncated };
  }
  function playFromSearch(hit) {
    var P = window.VoidPodcastPlayer;
    try {
      window.dispatchEvent(new CustomEvent('podcast:play', { detail: { episode: hit.ep, show: hit.show, placeholder: !P } }));
    } catch (err) { /* CustomEvent unavailable */ }
    if (!P) { return; }
    var st = P.getState();
    if (st.active && st.episodeId === hit.ep.id) { P.toggle(); return; }
    P.play(hit.ep, hit.show);
  }
  function renderSearchResults(res) {
    previewBox.textContent = '';
    preview = null;
    if (!res.shows.length && !res.episodes.length) { previewBox.hidden = true; return; }
    previewBox.hidden = false;
    var list = el('div', 'pw__searchhits');
    res.shows.forEach(function (sh) {
      var b = el('button', 'pw__subbtn', sh.title + (sh.publisher ? ' — ' + sh.publisher : ''));
      b.type = 'button';
      b.addEventListener('click', function () { openShow(sh.id, b); });
      list.appendChild(b);
    });
    res.episodes.forEach(function (hit) {
      var label = hit.ep.title + (hit.show.title ? ' — ' + hit.show.title : '');
      var b = el('button', 'pw__subbtn', '▶ ' + label);
      b.type = 'button';
      b.setAttribute('dir', 'auto');
      b.addEventListener('click', function () { playFromSearch(hit); });
      list.appendChild(b);
    });
    if (res.truncated) { list.appendChild(el('p', 'pw__previewpub', 'More matches exist · نتایج بیشتری هست')); }
    previewBox.appendChild(list);
  }
  /* Same feed reachable under two URL spellings (http/https, itunes:new-feed-url
     redirect) parses to a show whose self-resolved URL matches an existing
     subscription. Same-URL re-adds keep the "Update" path via show id. */
  function resolvedDupe(parsed, typedUrl) {
    var resolved = parsed.show.resolvedFeedUrl || '';
    if (!resolved || resolved === typedUrl) { return null; }
    var st = store.getState();
    var found = null;
    st.subscriptions.forEach(function (id) {
      if (found) { return; }
      var sh = st.shows[id];
      if (sh && (sh.feedUrl === resolved || sh.resolvedFeedUrl === resolved)) { found = sh; }
    });
    return found;
  }

  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) { return; }
    var text = searchInput.value.trim();
    if (!text) { return; }
    preview = null;
    renderPreview();
    var url = Feed.looksLikeUrl(text);
    if (!url) {
      var res = localSearch(text);
      renderSearchResults(res);
      if (!res.shows.length && !res.episodes.length) {
        showNote('No matches in your library · در کتابخانه‌تان چیزی یافت نشد');
      } else {
        searchNote.hidden = true;
      }
      return;
    }
    if (!/^https:\/\//i.test(url)) { showNote(Feed.errorText('invalid-url')); return; }
    busy = true;
    addBtn.disabled = true;
    searchInput.disabled = true;
    showNote('Fetching feed… · در حال دریافت فید…');
    addFeed(url).then(function (parsed) {
      if (resolvedDupe(parsed, url)) {
        showNote('Already in your podcasts · از قبل در پادکست‌هایتان است');
        searchInput.value = '';
        return;
      }
      preview = parsed;
      renderPreview();
      searchNote.hidden = true;
      var btn = previewBox.querySelector('[data-preview-add]');
      if (btn) { btn.focus(); }
    }, function (err) {
      showNote(Feed.errorText(err && err.code));
    }).then(function () {
      busy = false;
      addBtn.disabled = false;
      searchInput.disabled = false;
    });
  });

  /* ---- library rendering ---- */
  /* One row, at most 6 circles, never wraps or scrolls: fit the count to the
     measured body width (item 56px + 2×5px margin; TV 72px). NEW dot = the
     episode published after the show was last opened AND was never started. */
  function newCount() {
    var item = (isTV() ? 72 : 56) + 10;
    var w = body.clientWidth || 396;
    return Math.max(1, Math.min(6, Math.floor(w / item)));
  }
  function renderLibrary() {
    var opened = store.getState().opened;
    newRow.textContent = '';
    var fresh = data.latest(60).filter(function (ep) {
      return ep.showId !== SAVED_ID && store.isSubscribed(ep.showId);
    }).slice(0, newCount());
    fresh.forEach(function (ep) {
      var sh = data.showById(ep.showId);
      if (!sh) { return; }
      var un = !store.getProgress(ep.id) && Feed.parseDateMs(ep.publishedAt) > (opened[ep.showId] || 0);
      var b = el('button', 'pw__newitem');
      b.type = 'button';
      artStyle(b);
      fillArt(b, sh.artUrl, sh.initials);
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
    newSection.hidden = !fresh.length;
    newRow.hidden = !fresh.length;

    var saved = store.getSaved();
    /* Bookmarks stay discoverable even when empty: the section heading and
       a quiet hint are always rendered, the row button only when it has
       something to open. */
    savedSection.hidden = false;
    savedRow.hidden = false;
    savedRow.textContent = '';
    if (saved.length) {
      var sb = el('button', 'pw__savedrow');
      sb.type = 'button';
      sb.setAttribute('aria-label', 'Bookmarks · نشان‌شده‌ها — ' + saved.length);
      var sicon = el('span', 'pw__savedicon');
      sicon.setAttribute('aria-hidden', 'true');
      sicon.innerHTML = BM_FILLED;
      sb.appendChild(sicon);
      sb.appendChild(el('span', 'pw__savedlabel', 'Bookmarks · نشان‌شده‌ها'));
      sb.appendChild(el('span', 'pw__savedcount', String(saved.length)));
      sb.addEventListener('click', function () { openShow(SAVED_ID, sb); });
      savedRow.appendChild(sb);
    } else {
      savedRow.appendChild(el('p', 'pw__bmhint',
        'Bookmark episodes with the bookmark icon · با نشان‌گذاری، قسمت‌ها اینجا می‌آیند'));
    }

    grid.textContent = '';
    var subs = store.getState().subscriptions;
    var shows = subs.map(function (id) { return data.showById(id); }).filter(function (s) { return !!s; });
    shows.forEach(function (sh) {
      var b = el('button', 'pw__tile');
      b.type = 'button';
      b.setAttribute('aria-label', sh.title + (sh.titleFa ? ' · ' + sh.titleFa : '') + ' — ' + sh.publisher);
      var art = el('span', 'pw__art');
      artStyle(art);
      fillArt(art, sh.artUrl, sh.initials);
      b.appendChild(art);
      b.appendChild(el('span', 'pw__tilename', sh.title));
      if (sh.titleFa) {
        var tileFa = el('span', 'pw__tilefa', sh.titleFa); tileFa.dir = 'rtl'; tileFa.lang = 'fa';
        b.appendChild(tileFa);
      }
      if (sh.publisher) { b.appendChild(el('span', 'pw__tilepub', sh.publisher)); }
      b.addEventListener('click', function () { openShow(sh.id, b); });
      grid.appendChild(b);
    });
    if (!shows.length) {
      grid.appendChild(el('p', 'pw__empty', isTV()
        ? 'No podcasts yet · هنوز پادکستی نیست'
        : 'No podcasts yet — paste an RSS link above · هنوز پادکستی نیست؛ نشانی RSS را بالا بچسبانید'));
    }
  }

  /* ---- show rendering ---- */
  var PLAY_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8.5 5.8v12.4c0 .8.9 1.3 1.6.9l9.6-6.2c.6-.4.6-1.4 0-1.8L10.1 4.9c-.7-.4-1.6.1-1.6.9z" fill="currentColor"/></svg>';
  var PAUSE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8.5 5.5v13M15.5 5.5v13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
  /* Bookmark (distinct from the old star) and per-episode share icons. */
  var BM_PATH = 'M6 3.6h12a.8.8 0 0 1 .8.8v15.9L12 16.2l-6.8 4.1V4.4a.8.8 0 0 1 .8-.8z';
  var BM_OUTLINE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="' + BM_PATH + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  var BM_FILLED = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="' + BM_PATH + '" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>';
  var SHARE_PATH_C = 'M17.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6.5 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z';
  var SHARE_PATH_L = 'M8.8 10.6L15.2 6.9M8.8 13.4L15.2 17.1';
  var SHARE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="' + SHARE_PATH_C + SHARE_PATH_L + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  /* ---- per-episode share (local only) ----
     A small popover owned by the Podcast window, not the global nav. It
     shares the episode's own audio link; nothing is fetched, posted or
     stored anywhere by this control.
  ---- */
  var sharePop = null, sharePopBtn = null, sharePopEp = null, sharePopShow = null;
  function sharePopIsOpenFor(id) {
    return !!(sharePop && !sharePop.hidden && sharePopEp && sharePopEp.id === id);
  }
  function sharePopClose(restore) {
    if (!sharePop) { return; }
    sharePop.hidden = true;
    if (sharePop.parentNode) { sharePop.parentNode.removeChild(sharePop); }
    dialog.scrollLeft = 0;
    dialog.scrollTop = 0;
    if (sharePopBtn) { sharePopBtn.setAttribute('aria-expanded', 'false'); }
    document.removeEventListener('click', sharePopDoc, true);
    sharePopUnwatch();
    var b = sharePopBtn;
    sharePopBtn = null; sharePopEp = null; sharePopShow = null;
    if (restore && b && b.getClientRects().length) { b.focus(); }
  }
  function sharePopDoc(e) {
    if (!sharePop || sharePop.hidden) { return; }
    if (sharePop.contains(e.target) || (sharePopBtn && sharePopBtn.contains(e.target))) { return; }
    sharePopClose(false);
  }
  function sharePopKey(e) {
    var k = e.key;
    if (k === 'Escape' || k === 'BrowserBack' || k === 'GoBack' || e.keyCode === 27) {
      e.preventDefault(); e.stopPropagation(); sharePopClose(true);
    }
  }
  function openShareUrl(u) {
    try { window.open(u, '_blank', 'noopener'); } catch (e) { /* popups blocked */ }
  }
  function shareCopyFallback(url) {
    try {
      var ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* denied */ }
      document.body.removeChild(ta);
    } catch (e) { /* no clipboard at all */ }
  }
  function shareCopy(url, btn) {
    var done = function () {
      var prev = btn.textContent;
      btn.textContent = 'Copied · کپی شد';
      setTimeout(function () { btn.textContent = prev; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { shareCopyFallback(url); done(); });
      return;
    }
    shareCopyFallback(url); done();
  }
  /* The popover is position:absolute (see .pw__sharepop), so the dialog's box is
     its containing block and left/top are dialog-local. That makes the math
     frame-independent: during the pwIn entry transform the button rect and the
     popover box are transformed together, so a rect measured in this same task
     is already the position the user will see — no probe pass, no re-based
     first paint, no settle timers. The dialog declares border:0 and padding:0,
     so its border box is also the absolute-positioning box. */
  function sharePopPlace() {
    if (!sharePop || sharePop.hidden || !sharePopBtn) { return; }
    var dr = dialog.getBoundingClientRect();
    /* Mid-open or mid-resize the dialog box can be transiently collapsed;
       placing against such a rect would strand the popover, so keep the last
       good placement and wait for the resize/scroll watcher. */
    if (dr.width < 40 || dr.height < 40) { return; }
    /* Width is now resolved against the dialog, so keep it inside the real card
       and re-measure afterwards — wrapping can change the height. */
    sharePop.style.maxWidth = Math.max(200, dr.width - 20) + 'px';
    var w = sharePop.offsetWidth || 240, h = sharePop.offsetHeight || 150;
    if (w < 40 || h < 40) { return; }
    var r = sharePopBtn.getBoundingClientRect();
    /* Fit inside the card where it is on screen: the dialog clips its overflow,
       and on short viewports the card is the tighter of the two boxes. */
    var minX = Math.max(dr.left, 0) + 10;
    var maxX = Math.min(dr.right, window.innerWidth) - w - 10;
    var minY = Math.max(dr.top, 0) + 10;
    var maxY = Math.min(dr.bottom, window.innerHeight) - h - 10;
    var left = r.left, top = r.bottom + 6;
    if (top > maxY) { top = r.top - 6 - h; }
    if (left > maxX) { left = r.right - w; }
    left = Math.max(minX, Math.min(left, maxX));
    top = Math.max(minY, Math.min(top, maxY));
    sharePop.style.left = (left - dr.left + dialog.scrollLeft) + 'px';
    sharePop.style.top = (top - dr.top + dialog.scrollTop) + 'px';
  }
  /* Keep the popover anchored to its Share button while the episode list
     scrolls or the viewport resizes (scroll does not bubble; capture catches
     the .pw__body scroller). */
  var sharePopOnMove = null;
  function sharePopWatch() {
    if (sharePopOnMove) { return; }
    var pending = false;
    sharePopOnMove = function () {
      if (pending || !sharePop || sharePop.hidden) { return; }
      pending = true;
      requestAnimationFrame(function () { pending = false; sharePopPlace(); });
    };
    dialog.addEventListener('scroll', sharePopOnMove, true);
    window.addEventListener('resize', sharePopOnMove);
  }
  function sharePopUnwatch() {
    if (!sharePopOnMove) { return; }
    dialog.removeEventListener('scroll', sharePopOnMove, true);
    window.removeEventListener('resize', sharePopOnMove);
    sharePopOnMove = null;
  }
  /* Follow hands on the PARENT FEED, never the episode audio URL. A saved
     episode lives under the pseudo-show whose feedUrl is empty, and an unsafe
     URL is dropped by the same validator the typed path uses — either way the
     row is simply absent and every other share method stays available. */
  function feedForFollow(sh) {
    if (!sh || sh.id === SAVED_ID) { return ''; }
    return Feed.safeFeedUrl(String(sh.feedUrl || ''));
  }
  function voidPageBase() {
    try {
      var u = new URL(location.href);
      if (u.protocol === 'https:' || u.protocol === 'http:') { return u.origin + u.pathname; }
    } catch (e) { /* file:// */ }
    return 'https://minoodar.github.io/void/';
  }
  function followLink(feedUrl) {
    /* origin + pathname only: the sender's own query and fragment (a feature
       flag, an #anchor, a stale follow=) must not ride along to the recipient. */
    return voidPageBase() + '?follow=' + encodeURIComponent(feedUrl);
  }
  function sharePopOpen(ep, sh, btn) {
    sharePopClose(false);
    if (!sharePop) {
      sharePop = el('div', 'pw__sharepop');
      sharePop.setAttribute('role', 'dialog');
      sharePop.setAttribute('aria-label', 'Share episode · هم‌رسانی قسمت');
      sharePop.hidden = true;
      sharePop.addEventListener('keydown', sharePopKey);
      dialog.appendChild(sharePop);
    }
    sharePopEp = ep; sharePopShow = sh; sharePopBtn = btn;
    var title = el('p', 'pw__sharepop-title');
    title.appendChild(document.createTextNode(ep.title));
    var hint = el('p', 'pw__sharepop-hint', 'Share this episode or follow its podcast · اشتراک این قسمت یا دنبال‌کردن پادکست');
    var row = el('div', 'pw__sharepop-row');
    var copyB = null;
    function shareBtn(label, fn) {
      var b = el('button', 'pw__sharepop-btn', label);
      b.type = 'button';
      b.addEventListener('click', function () { fn(); });
      row.appendChild(b);
      return b;
    }
    copyB = shareBtn('Copy link · کپی', function () { shareCopy(ep.audioUrl, copyB); });
    var text = ep.title + (sh && sh.title ? ' — ' + sh.title : '');
    shareBtn('WhatsApp', function () { openShareUrl('https://wa.me/?text=' + encodeURIComponent(text + '\n\n' + ep.audioUrl)); });
    shareBtn('Telegram', function () { openShareUrl('https://t.me/share/url?url=' + encodeURIComponent(ep.audioUrl) + '&text=' + encodeURIComponent(text)); });
    shareBtn('X', function () { openShareUrl('https://x.com/intent/tweet?text=' + encodeURIComponent(text + ' ' + ep.audioUrl)); });
    var followUrl = feedForFollow(sh);
    if (followUrl) {
      var followB = shareBtn('Follow in Void · دنبال‌کردن', function () { shareCopy(followLink(followUrl), followB); });
    }
    sharePop.textContent = '';
    sharePop.appendChild(title); sharePop.appendChild(hint); sharePop.appendChild(row);
    dialog.appendChild(sharePop);
    dialog.scrollLeft = 0;
    dialog.scrollTop = 0;
    /* Absolute, not fixed — see the .pw__sharepop rule: the dialog box is the
       containing block, so the coordinates sharePopPlace computes are
       dialog-local and stay valid for the whole frame (the pwIn entry transform
       moves the Share button and the popover together). One placement is final,
       and it lands in this task, before anything can paint. There is no
       hide-while-measuring step: the low-FX wildcard (html.void-lowfx * in
       void-tv.css) forces transition-duration onto every element, so an un-hide
       ran as a CSSTransition that reported its from-value — a computed
       visibility:hidden popover — until the next animation frame. */
    sharePop.hidden = false;
    sharePopPlace();
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', sharePopDoc, true);
    sharePopWatch();
    copyB.focus();
    dialog.scrollLeft = 0;
    dialog.scrollTop = 0;
    /* Focus can scroll the dialog; the reset above undoes that, so re-place
       synchronously against the settled geometry rather than scheduling a retry. */
    sharePopPlace();
  }
  dialog.addEventListener('cancel', function (e) {
    if (sharePop && !sharePop.hidden && sharePopEp) { e.preventDefault(); sharePopClose(true); }
  });

  function snapshotOf(ep, sh) {
    return {
      id: ep.id, guid: ep.guid || '', showId: ep.showId,
      title: ep.title, showTitle: sh.title, showFeedUrl: sh.feedUrl || '',
      audioUrl: ep.audioUrl, audioType: ep.audioType || '',
      durationSec: ep.durationSec || 0, publishedAt: ep.publishedAt || '',
      artUrl: ep.artUrl || sh.artUrl || '', description: ep.description || '',
      savedAt: Date.now()
    };
  }
  function renderShowActions(showId) {
    showActions.textContent = '';
    resetConfirm();
    if (showId === SAVED_ID) { return; }
    if (store.isSubscribed(showId)) {
      var rm = el('button', 'pw__subbtn', 'Remove · حذف');
      rm.type = 'button';
      rm.addEventListener('click', function () {
        if (!confirming) {
          confirming = true;
          rm.textContent = 'Confirm remove? · حذف شود؟';
          rm.classList.add('is-confirm');
          confirmTimer = setTimeout(function () {
            confirming = false;
            rm.textContent = 'Remove · حذف';
            rm.classList.remove('is-confirm');
          }, 3000);
          return;
        }
        resetConfirm();
        var P = window.VoidPodcastPlayer;
        var ps = P ? P.getState() : null;
        if (ps && ps.active && ps.showId === showId) { try { P.stop(); } catch (e) { /* already stopped */ } }
        catalogRemove(showId);
        store.unsubscribe(showId);
        if (view === 'show') { backToLibrary(); }
      });
      showActions.appendChild(rm);
    } else {
      var sub = el('button', 'pw__subbtn', 'Subscribe · اشتراک');
      sub.type = 'button';
      sub.addEventListener('click', function () { store.subscribe(showId); });
      showActions.appendChild(sub);
    }
  }
  function renderShow(showId) {
    var sh = data.showById(showId);
    if (!sh) { if (view === 'show') { backToLibrary(); } return; }
    var isSavedView = showId === SAVED_ID;
    /* The local publishing preview (?publishPreview=1) is the only consumer of
       these two hooks, and it is absent from every other build, so production
       never reaches past the first test. */
    var preview = window.VoidPodcastPublishPreview || null;
    var list = isSavedView
      ? store.getSaved().slice().sort(function (a, b) { return b.savedAt - a.savedAt; })
      : data.episodesOf(showId);
    var ps = window.VoidPodcastPlayer ? window.VoidPodcastPlayer.getState() : null;
    artStyle(showArt);
    showArt.textContent = '';
    fillArt(showArt, sh.artUrl, sh.initials);
    showArt.classList.toggle('is-loading', !!(ps && ps.loading && ps.showId === showId));
    showTitle.textContent = isSavedView ? 'Bookmarks' : sh.title;
    showTitleFa.textContent = isSavedView ? 'نشان‌شده‌ها' : (sh.titleFa || '');
    showTitleFa.hidden = !sh.titleFa;
    showPub.textContent = isSavedView ? (list.length + ' episodes · قسمت') : sh.publisher;
    if (!isSavedView && sh.lastFetchedAt) {
      showFetch.textContent = 'Refreshed ' + fmtStamp(sh.lastFetchedAt) + ' · آخرین به‌روزرسانی ' + fmtStamp(sh.lastFetchedAt);
      showFetch.hidden = false;
    } else {
      showFetch.hidden = true;
    }
    playNote.hidden = !errorNote;
    if (errorNote) { playNote.textContent = errorNote; }
    renderShowActions(showId);
    if (preview && preview.decorateShowActions && !isSavedView) {
      try { preview.decorateShowActions(showActions, showId, sh); } catch (e) { /* preview is optional */ }
    }
    epList.textContent = '';
    if (!list.length) {
      epList.appendChild(el('li', 'pw__empty', 'No episodes yet · هنوز قسمتی نیست'));
    }
    list.forEach(function (ep) {
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
      play.title = isPlaying ? 'Pause · توقف' : 'Play · پخش';
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
        if (st.active && st.episodeId === ep.id) {
          /* Pressing the row that is already current resumes it — a successful
             start like any other, so the same waiter arms. Arming while it is
             still paused means the player's own 'podcast:playing' event is what
             closes the dialog, so a blocked start (no event, waiter dropped by
             its own bound) leaves the window open; a pause arms nothing. */
          if (!st.playing) { closeWhenPlaying(P, ep); }
          P.toggle();
          return;
        }
        var res = P.play(ep, sh);
        if (!res.ok && res.reason === 'no-source') {
          playNote.textContent = 'No audio source yet — add a git-ignored podcast-dev-config.local.js to test playback · هنوز فایل صوتی برای این قسمت نیست';
          playNote.hidden = false;
        }
        if (res.ok) { closeWhenPlaying(P, ep); }
      });
      var meta = el('div', 'pw__epmeta');
      var t = el('span', 'pw__eptitle');
      t.appendChild(document.createTextNode(ep.title + ' '));
      if (ep.titleFa) {
        var epFa = el('bdi', 'pw__eptitle-fa', ep.titleFa); epFa.dir = 'rtl'; epFa.lang = 'fa';
        t.appendChild(epFa);
      }
      meta.appendChild(t);
      var parts = [];
      if (isSavedView && ep.showTitle) { parts.push(ep.showTitle); }
      var d = fmtDate(ep.publishedAt);
      if (d) { parts.push(d); }
      if (ep.durationSec > 0) { parts.push(fmtDur(ep.durationSec)); }
      meta.appendChild(el('span', 'pw__epsub', parts.join(' · ')));
      var bm = el('button', 'pw__bm');
      bm.type = 'button';
      var isSavedEp = store.isSaved(ep.id);
      bm.setAttribute('data-bm', ep.id);
      bm.setAttribute('aria-pressed', isSavedEp ? 'true' : 'false');
      bm.setAttribute('aria-label', (isSavedEp ? 'Remove from Bookmarks · حذف از نشان‌شده‌ها' : 'Bookmark episode · نشان‌گذاری قسمت') + ' — ' + ep.title);
      bm.title = isSavedEp ? 'Bookmarked — click to remove · نشان‌شده؛ برای حذف کلیک کنید' : 'Bookmark · نشان‌گذاری';
      bm.innerHTML = isSavedEp ? BM_FILLED : BM_OUTLINE;
      bm.addEventListener('click', function () {
        if (store.isSaved(ep.id)) { store.removeSaved(ep.id); return; }
        if (!ep.audioUrl) {
          playNote.textContent = 'No audio to bookmark yet · هنوز فایل صوتی برای نشان‌گذاری نیست';
          playNote.hidden = false;
          return;
        }
        store.saveEpisode(snapshotOf(ep, sh));
      });
      var share = el('button', 'pw__share');
      share.type = 'button';
      share.setAttribute('data-share', ep.id);
      share.setAttribute('aria-haspopup', 'dialog');
      share.setAttribute('aria-expanded', 'false');
      share.setAttribute('aria-label', 'Share episode · هم‌رسانی قسمت — ' + ep.title);
      share.title = 'Share · هم‌رسانی';
      share.innerHTML = SHARE_SVG;
      share.addEventListener('click', function () {
        if (sharePopIsOpenFor(ep.id)) { sharePopClose(true); return; }
        sharePopOpen(ep, sh, share);
      });
      var rail = el('span', 'pw__rail');
      rail.setAttribute('aria-hidden', 'true');
      var fill = el('span', 'pw__fill');
      fill.style.width = (frac * 100).toFixed(2) + '%';
      rail.appendChild(fill);
      li.appendChild(play); li.appendChild(meta); li.appendChild(bm); li.appendChild(share); li.appendChild(rail);
      if (preview && preview.decorateEpisodeRow) {
        try { preview.decorateEpisodeRow(li, ep, sh); } catch (e) { /* preview is optional */ }
      }
      epList.appendChild(li);
    });
  }

  function openShow(showId, opener) {
    resetConfirm();
    currentShowId = showId;
    showOpener = opener || null;
    view = 'show';
    /* Opening a show clears its NEW dots: from now on only episodes published
       after this moment count as new. The saved view has no opened marker. */
    if (showId !== SAVED_ID) { store.markOpened(showId); }
    renderShow(showId);
    libView.hidden = true;
    showView.hidden = false;
    backBtn.hidden = false;
    body.scrollTop = 0;
    backBtn.focus();
  }
  function backToLibrary() {
    resetConfirm();
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

  /* ---- refresh on library open (silent, max 3 concurrent) ---- */
  function refreshFeeds() {
    if (refreshing) { return; }
    var now = Date.now();
    var st = store.getState();
    var due = [];
    st.subscriptions.forEach(function (id) {
      var sh = st.shows[id];
      if (sh && sh.feedUrl && now - (sh.lastFetchedAt || 0) > REFRESH_MS) { due.push(sh.feedUrl); }
    });
    if (!due.length) { return; }
    refreshing = true;
    var idx = 0, running = 0;
    function next() {
      while (running < 3 && idx < due.length) {
        var url = due[idx++];
        running++;
        (function (u) {
          addFeed(u).then(function (parsed) { adoptFeed(parsed); }, function () { /* silent per-show failure */ })
            .then(function () { running--; next(); });
        })(url);
      }
      if (!running && idx >= due.length) { refreshing = false; }
    }
    next();
  }

  /* ---- OPML (client-side only) ---- */
  function opmlShows() {
    var st = store.getState();
    return st.subscriptions.map(function (id) { return st.shows[id]; })
      .filter(function (sh) { return sh && sh.feedUrl; });
  }
  function exportOpmlText() {
    return Feed.buildOpml(opmlShows(), new Date().toISOString());
  }
  function doExport() {
    var shows = opmlShows();
    if (!shows.length) { showNote('No RSS subscriptions to export · فید RSS برای خروجی نیست'); return; }
    try {
      var blob = new Blob([exportOpmlText()], { type: 'text/xml' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'void-podcasts.opml';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      showNote('Exported ' + shows.length + ' feeds · خروجی گرفته شد');
    } catch (e) {
      showNote('Export failed · خروجی ناموفق بود');
    }
  }
  function importOpmlText(text) {
    if (importing) { return Promise.resolve({ added: 0, failed: 0, skipped: 0 }); }
    var doc = null;
    try { doc = new DOMParser().parseFromString(String(text == null ? '' : text), 'text/xml'); } catch (e) { doc = null; }
    if (!doc || doc.getElementsByTagName('parsererror').length) {
      showNote(Feed.errorText('not-feed'));
      return Promise.resolve({ added: 0, failed: 0, skipped: 0 });
    }
    var outlines = Feed.extractOpml(doc);
    if (!outlines.length) {
      showNote('No feeds in that OPML · فیدی در این OPML نیست');
      return Promise.resolve({ added: 0, failed: 0, skipped: 0 });
    }
    importing = true;
    importBtn.disabled = true;
    var added = 0, failed = 0, skipped = 0, i = 0;
    function step() {
      if (i >= outlines.length) {
        importing = false;
        importBtn.disabled = false;
        showNote('Imported ' + added + (skipped ? ' · ' + skipped + ' already added' : '') +
          (failed ? ' · ' + failed + ' failed' : '') + ' · ورود انجام شد');
        return Promise.resolve({ added: added, failed: failed, skipped: skipped });
      }
      var o = outlines[i++];
      showNote('Importing ' + i + '/' + outlines.length + '… · در حال ورود ' + i + ' از ' + outlines.length);
      var url = Feed.looksLikeUrl(o.xmlUrl);
      if (!url || !/^https:\/\//i.test(url) || store.isSubscribed(Feed.showIdFor(url))) {
        skipped++;
        return step();
      }
      return addFeed(url).then(function (parsed) {
        adoptFeed(parsed);
        store.subscribe(parsed.show.id);
        added++;
      }, function () { failed++; }).then(step);
    }
    return step();
  }
  exportBtn.addEventListener('click', doExport);
  importBtn.addEventListener('click', function () { if (!importing) { fileInput.click(); } });
  fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) { return; }
    var r = new FileReader();
    r.onload = function () { importOpmlText(String(r.result || '')); };
    r.onerror = function () { showNote(Feed.errorText('not-feed')); };
    r.readAsText(f);
  });

  /* ---- open / close ---- */
  /* A press in the episode list hands the screen back to the minimal
     visualizer once audio is genuinely running: 'podcast:playing' is the
     player's own success signal, so a blocked or failed start leaves this
     window open with its note visible. Closing is display-only — the audio
     element, queue and progress belong to VoidPodcastPlayer, not to this
     dialog. The timeout drops a waiter that never fired. */
  var AUTO_CLOSE_MS = 8000;
  var autoClose = null;
  function cancelAutoClose() {
    if (!autoClose) { return; }
    window.removeEventListener('podcast:playing', autoClose.onState);
    clearTimeout(autoClose.timer);
    autoClose = null;
  }
  function closeWhenPlaying(P, ep) {
    cancelAutoClose();
    var st = P.getState();
    if (st.playing && st.episodeId === ep.id) { close(); return; }
    function onState(e) {
      var d = e.detail || {};
      if (d.playing && d.episodeId === ep.id) { close(); }
    }
    autoClose = { onState: onState, timer: setTimeout(cancelAutoClose, AUTO_CLOSE_MS) };
    window.addEventListener('podcast:playing', onState);
  }

  /* ?follow=<rss> arrives from a shared follow link. It passes the same
     https/no-credentials gate a typed URL uses and only pre-fills the Add
     field — subscription still needs the user's own press, so preview, dedupe
     and the existing workflow stand unchanged. */
  var pendingFollow = (function () {
    var raw = '';
    try { raw = new URLSearchParams(location.search).get('follow') || ''; } catch (e) { return ''; }
    return Feed.safeFeedUrl(String(raw).trim().slice(0, 2048));
  })();

  function open(opts) {
    opts = opts || {};
    if (isOpen()) {
      if (view === 'show') { backToLibrary(); }
      return;
    }
    returnFocus = opts.returnFocus || document.activeElement;
    view = 'library';
    currentShowId = null;
    preview = null;
    resetConfirm();
    syncSavedCatalog();
    renderLibrary();
    renderPreview();
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
    refreshFeeds();
    /* Direct entry from the player's title lands on the playing episode's show,
       where Bookmark and Share already live; audio keeps running untouched. A
       follow link is the other entry, and one opening gets one landing state. */
    if (opts.showId) { openShow(opts.showId, returnFocus); }
    else if (pendingFollow) {
      searchInput.value = pendingFollow;
      pendingFollow = '';
      showNote('Feed ready to add · فید آمادهٔ افزودن است');
      searchInput.focus();
    }
  }
  function restoreFocus() {
    if (returnFocus && returnFocus.focus && returnFocus.getClientRects && returnFocus.getClientRects().length > 0) {
      try { returnFocus.focus(); } catch (e) { /* opener gone */ }
    }
    returnFocus = null;
  }
  function close() {
    cancelAutoClose();
    if (!isOpen()) { return; }
    resetConfirm();
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

  /* Live state: progress / subscription / saved / playback changes re-render
     the current view, keeping focus on the same control when possible. */
  function rerender() {
    syncSavedCatalog();
    if (view === 'show' && currentShowId === SAVED_ID && !store.getSaved().length) {
      backToLibrary();
      return;
    }
    var active = document.activeElement;
    var hadFocus = dialog.contains(active);
    var sel = null;
    if (hadFocus && active.getAttribute) {
      var epId = active.getAttribute('data-ep');
      var starId = active.getAttribute('data-bm');
      if (epId) { sel = '[data-ep="' + epId + '"]'; }
      else if (starId) { sel = '[data-bm="' + starId + '"]'; }
      else if (active.hasAttribute('data-preview-add')) { sel = '[data-preview-add]'; }
    }
    if (view === 'show' && currentShowId) { renderShow(currentShowId); }
    else { renderLibrary(); }
    renderPreview();
    if (!hadFocus || dialog.contains(document.activeElement)) { return; }
    if (sel) {
      var again = dialog.querySelector(sel);
      if (again && again.getClientRects().length > 0) { again.focus(); return; }
    }
    focusFirst();
  }
  store.onChange(rerender);
  ['podcast:episode', 'podcast:playing'].forEach(function (name) {
    window.addEventListener(name, function () { if (isOpen()) { rerender(); } });
  });
  /* Phase 1: surface playback errors in the dialog's existing status note while
     the dialog is open (the orb overlay covers the dialog-closed case). The
     wording is deliberately neutral — it asserts no CORS or network diagnosis. */
  window.addEventListener('podcast:error', function (e) {
    errorNote = (e && e.detail && e.detail.message) ||
      'Podcast playback stopped — this episode could not be played · پخش این قسمت متوقف شد';
    if (isOpen()) { playNote.textContent = errorNote; playNote.hidden = false; }
  });
  window.addEventListener('podcast:playing', function (e) {
    if (e && e.detail && e.detail.playing) {
      errorNote = '';
      if (isOpen() && !playNote.hidden) { playNote.hidden = true; }
    }
  });
  window.addEventListener('podcast:loading', function (e) {
    var d = (e && e.detail) || {};
    if (!isOpen()) { return; }
    showArt.classList.toggle('is-loading', view === 'show' && currentShowId === d.showId && !!d.loading);
  });

  /* The NEW row count depends on the measured width: refit on resize while open. */
  window.addEventListener('resize', function () {
    if (isOpen() && view === 'library') { renderLibrary(); }
  });

  /* ---- dev config (git-ignored, local only) ----
     sample:true returns the fictional catalogue and seeds first-run state;
     feedWorker points the RSS proxy at wrangler dev. Without the file the
     window stays real-feed-only with a calm empty first run. The player
     injects the same script later; the duplicate load is cached/harmless. */
  var samplesApplied = false;
  function applyDevConfig() {
    var cfg = window.VoidPodcastDevConfig;
    if (!cfg || cfg.sample !== true || samplesApplied) { return; }
    samplesApplied = true;
    sampleShows.forEach(function (sh) { if (!data.showById(sh.id)) { data.SHOWS.push(sh); } });
    sampleEpisodes.forEach(function (ep) { data.EPISODES.push(ep); });
    if (!store.hasPersisted()) {
      sampleShows.forEach(function (sh) { store.subscribe(sh.id); });
      store.setProgress('nf-04', 1440, 2400);
      store.setProgress('so-02', 2880, 2880);
    }
    if (isOpen()) { rerender(); }
  }
  if (window.VoidPodcastDevConfig) { applyDevConfig(); }
  else {
    try {
      var devScript = document.createElement('script');
      devScript.src = 'podcast-dev-config.local.js';
      devScript.onload = devScript.onerror = function () { applyDevConfig(); };
      document.head.appendChild(devScript);
    } catch (e) { /* no dev config */ }
  }

  window.VoidPodcastWindow = {
    open: open,
    close: close,
    isOpen: isOpen,
    getView: function () { return view; },
    getStore: function () { return store; },
    exportOpml: exportOpmlText,
    importOpml: importOpmlText
  };
})();