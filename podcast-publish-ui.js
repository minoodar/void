/* Podcast Galaxy Publishing — Phase 1 UI preview: the interactive experience.
 *
 * LOCAL PREVIEW ONLY. Loaded by podcast-publish-loader.js, which itself only
 * runs behind the documented local entry point (?publishPreview=1 on a loopback
 * origin), so none of this exists in the normal production experience.
 *
 * What lives here: the publication browser, a publication's own page, the
 * publish wizard, and the Save / Follow behaviour. Every read and write goes
 * through the adapter in podcast-publish-mock.js and nothing else, which is the
 * one seam a future real API has to satisfy.
 *
 * Playback is simulated and says so on screen: this module never builds an
 * Audio element, never calls VoidPodcastPlayer, never touches MediaSession and
 * never writes to the Podcast store, so it cannot interrupt Music or a real
 * episode. The fixtures carry no audio URL on purpose.
 *
 * Chromium-70 / Android TV safe: ES5 syntax only, like the other podcast files.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.VoidPodcastPublishUI = factory(); }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var DAY = 86400000;
  var PERSIST_KEY = 'void.publishPreview.v1';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text != null) { n.textContent = String(text); }
    return n;
  }
  function add(node, kids) {
    for (var i = 0; i < kids.length; i++) { if (kids[i]) { node.appendChild(kids[i]); } }
    return node;
  }
  function btn(label, cls, fn) {
    var b = el('button', 'vgp__btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    if (fn) { b.addEventListener('click', fn); }
    return b;
  }
  function svg(inner, cls) {
    var s = el('span', cls);
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24" focusable="false">' + inner + '</svg>';
    return s;
  }
  var PATH = {
    play: '<path d="M8 5.6 18.4 12 8 18.4Z" fill="currentColor"/>',
    pause: '<path d="M8.6 5.6h2.5v12.8H8.6Zm4.3 0h2.5v12.8h-2.5Z" fill="currentColor"/>',
    back: '<path d="M14.4 6.4 8.8 12l5.6 5.6" fill="none" stroke="currentColor" stroke-width="1.6"/>'
  };

  /* ---- formatting ---- */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function clock(sec) {
    var s = Math.max(0, Math.floor(sec || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s % 60) : m + ':' + pad2(s % 60);
  }
  function left(ms) {
    if (ms <= 0) { return 'expired'; }
    var d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) { return d + 'd ' + h + 'h'; }
    if (h > 0) { return h + 'h ' + m + 'm'; }
    return m + 'm';
  }
  function ago(ms) {
    var d = Math.floor(ms / DAY);
    if (d >= 1) { return 'published ' + d + ' day' + (d === 1 ? '' : 's') + ' ago'; }
    var h = Math.floor(ms / 3600000);
    if (h >= 1) { return 'published ' + h + ' hours ago'; }
    return 'published minutes ago';
  }
  function initials(text) {
    var parts = String(text || '').replace(/[^A-Za-z ]+/g, ' ').split(' '), out = '', i;
    for (i = 0; i < parts.length && out.length < 2; i++) { if (parts[i]) { out += parts[i].charAt(0).toUpperCase(); } }
    return out || 'VG';
  }
  function markFor(pub) { return pub.initials || initials(pub.showTitle); }
  function nameOf(pub) { return pub.kind === 'show' ? pub.showTitle : (pub.episodeTitle || pub.showTitle); }
  function nameFaOf(pub) { return pub.kind === 'show' ? pub.showTitleFa : pub.episodeTitleFa; }
  function bilingual(en, fa) { return en + ' · ' + fa; }
  function deepLink(id) {
    /* The real product hands out a site URL. A preview link has to stay inside
       the preview, so it points at this page with the publication id. Only the
       path is reused: appending to the current query would double the preview
       parameters every time a link is opened from a link. */
    var base = String(location.href).split('#')[0].split('?')[0];
    return base + '?publishPreview=1&signal=' + encodeURIComponent(id);
  }
  function copyText(text, done) {
    function fin(okFlag) { if (done) { done(okFlag); } }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { fin(true); }, function () { fin(legacyCopy(text)); });
      return;
    }
    fin(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = el('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var okFlag = false;
    try { okFlag = document.execCommand('copy'); } catch (e) { okFlag = false; }
    document.body.removeChild(ta);
    return okFlag;
  }

  function create(opts) {
    opts = opts || {};
    var api = opts.api, mock = opts.mock;
    if (!api || !mock) { throw new Error('VoidPodcastPublishUI needs { api, mock }'); }

    var S = {
      view: 'library',      /* library | detail | publish */
      id: '',               /* publication the detail view is showing */
      detail: null,
      list: [],
      loading: false,
      busy: false,
      opener: null,
      wizard: null,
      sim: { playing: false, pos: 0, dur: 0, timer: 0 }
    };

    var dialog = null, titleEl = null, eyebrowEl = null, backBtn = null, bodyEl = null,
        srEl = null, chip = null, built = false, unchange = null;

    /* ======================= shell ======================= */

    function host() {
      var r = document.getElementById('void-music-root');
      return (r && !r.hidden) ? r : document.body;
    }

    function rehostSoon() {
      /* A shared link opens during page load, before the Music root exists, so
         the first mount can land on body — where Music Mode hides every body
         child it does not know. Watch briefly and move the dialog into the root
         the moment it appears; in the top layer the move itself is invisible. */
      var tries = 0;
      var t = setInterval(function () {
        tries++;
        var r = document.getElementById('void-music-root');
        if (r && dialog.parentElement !== r) { r.appendChild(dialog); }
        if ((r && dialog.parentElement === r) || tries > 20) { clearInterval(t); }
      }, 150);
    }

    function build() {
      if (built) { return; }
      built = true;

      dialog = el('dialog', 'vgp');
      dialog.id = 'vgp-modal';
      dialog.setAttribute('aria-labelledby', 'vgp-title');

      var sheen = el('div', 'vgp__sheen');
      sheen.setAttribute('aria-hidden', 'true');

      var panel = el('div', 'vgp__panel');

      backBtn = el('button', 'vgp__back');
      backBtn.type = 'button';
      backBtn.setAttribute('aria-label', bilingual('Back', 'بازگشت'));
      backBtn.appendChild(svg(PATH.back));
      backBtn.addEventListener('click', goBack);

      eyebrowEl = el('span', 'vgp__eyebrow', 'Galaxy publishing');
      titleEl = el('h2', 'vgp__title', 'Publications');
      titleEl.id = 'vgp-title';

      var closeBtn = el('button', 'vgp__close', '×');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', bilingual('Close', 'بستن'));
      closeBtn.addEventListener('click', close);

      bodyEl = el('div', 'vgp__body');
      bodyEl.setAttribute('tabindex', '-1');

      srEl = el('p', 'vgp__sr');
      srEl.setAttribute('role', 'status');
      srEl.setAttribute('aria-live', 'polite');

      add(panel, [
        add(el('div', 'vgp__head'), [backBtn, add(el('div', 'vgp__titles'), [eyebrowEl, titleEl]), closeBtn]),
        bodyEl, srEl
      ]);
      add(dialog, [sheen, panel]);

      dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
      dialog.addEventListener('click', function (e) { if (e.target === dialog) { close(); } });
      dialog.addEventListener('close', function () {
        stopSim();
        if (chip) { chip.setAttribute('aria-expanded', 'false'); }
        var f = S.opener;
        S.opener = null;
        if (f && typeof f.focus === 'function') { try { f.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
      });

      /* Music Mode keeps the dialog inside its own root so neither the
         player's stray-element sweep nor the body-child hide can take it away;
         otherwise mount on body. */
      host().appendChild(dialog);
    }

    function say(msg, isError) {
      srEl.textContent = msg;
      var live = bodyEl.querySelector('.vgp__status');
      if (live) {
        live.textContent = msg;
        live.className = 'vgp__status' + (isError ? ' is-err' : '');
      }
    }
    function setView(name) {
      S.view = name;
      backBtn.hidden = name === 'library';
      render();
    }
    function goBack() {
      if (S.view === 'detail') { openLibrary(); }
      else if (S.view === 'publish') {
        var step = S.wizard ? S.wizard.step : 'target';
        if (step === 'issued') { S.wizard.step = 'review'; render(); }
        else if (step === 'review') { S.wizard.step = 'note'; render(); }
        else { openLibrary(); }
      } else { close(); }
    }

    function show(opener) {
      build();
      if (opener) { S.opener = opener; }
      var wasNew = !dialog.open;
      /* A shared link opens during page load, before the Music root exists, so
         the first mount can land on body — where Music Mode hides every body
         child it does not know. Re-pick the host on each open, while the dialog
         is still closed and moving it is safe, and keep watching afterwards. */
      if (wasNew && dialog.parentElement !== host()) { host().appendChild(dialog); }
      if (wasNew) { rehostSoon(); }
      if (wasNew) {
        try { dialog.showModal(); }
        catch (e) { dialog.setAttribute('open', ''); dialog.className = 'vgp vgp--fallback'; }
      }
      if (chip) { chip.setAttribute('aria-expanded', 'true'); }
      /* Deferred one tick so the view rendered by the caller exists first.
         Without this the dialog opens with focus left on the page behind it. */
      if (wasNew) { setTimeout(function () { if (dialog.open) { focusFirst(); } }, 0); }
    }
    function close() {
      if (!dialog || !dialog.open) { return; }
      try { dialog.close(); } catch (e) { dialog.removeAttribute('open'); }
    }
    function focusFirst() {
      var f = bodyEl.querySelector('.vgp__card a, .vgp__card button, .vgp__btn, .vgp__chip, .vgp__textarea');
      if (f) { try { f.focus({ preventScroll: true }); } catch (e) { /* not focusable yet */ } }
    }

    /* ======================= reads ======================= */

    function openLibrary(opener) {
      show(opener);
      setView('library');
      loadList();
    }
    function openDetail(id, opener) {
      show(opener);
      S.id = id;
      S.detail = null;
      stopSim();
      setView('detail');
      loadDetail(id);
    }
    function loadList() {
      S.loading = true;
      render();
      api.list().then(function (res) {
        S.list = res.publications;
        S.loading = false;
        if (S.view === 'library') { render(); }
      }, function () {
        S.loading = false;
        if (S.view === 'library') { render(); }
      });
    }
    function loadDetail(id) {
      S.loading = true;
      render();
      api.get(id).then(function (res) {
        S.loading = false;
        if (S.view !== 'detail' || S.id !== id) { return; }
        S.detail = res;
        S.sim.dur = res.kind === 'publication' ? (res.durationSec || 0) : 0;
        S.sim.pos = 0;
        render();
      }, function () {
        S.loading = false;
        if (S.view !== 'detail' || S.id !== id) { return; }
        S.detail = { kind: 'gone', id: id };
        render();
      });
    }

    /* ======================= simulated transport =======================
       A clock and a bar. No Audio element is created, no playback API runs, so
       Music and any real Podcast episode are provably untouched. The interval
       only exists while the publication page is open. */
    function stopSim() {
      if (S.sim.timer) { clearInterval(S.sim.timer); }
      S.sim.timer = 0;
      S.sim.playing = false;
    }
    function simTick() {
      if (!S.sim.timer) { return; }
      if (S.sim.pos >= S.sim.dur) {
        S.sim.pos = S.sim.dur;
        stopSim();
        paintSim();
        say('The simulated transport reached its end. Nothing was played at any point.', false);
        return;
      }
      S.sim.pos += 1;
      paintSim();
    }
    function toggleSim() {
      if (S.sim.dur <= 0) { return; }
      if (S.sim.timer) { stopSim(); } else { S.sim.playing = true; S.sim.timer = setInterval(simTick, 1000); }
      paintSim();
    }
    function seek(deltaOrFraction) {
      if (S.sim.dur <= 0) { return; }
      S.sim.pos = Math.max(0, Math.min(S.sim.dur, deltaOrFraction));
      paintSim();
    }
    function paintSim() {
      var rail = bodyEl.querySelector('.vgp__fill');
      var now = bodyEl.querySelector('.vgp__time-now');
      var rem = bodyEl.querySelector('.vgp__time-left');
      var key = bodyEl.querySelector('.vgp__pplay');
      if (rail) { rail.style.width = (S.sim.dur > 0 ? Math.min(1, S.sim.pos / S.sim.dur) * 100 : 0).toFixed(2) + '%'; }
      if (now) { now.textContent = clock(S.sim.pos); }
      if (rem) { rem.textContent = S.sim.dur > 0 ? '−' + clock(S.sim.dur - S.sim.pos) : 'no duration'; }
      if (key) {
        key.innerHTML = '';
        key.appendChild(svg(S.sim.playing ? PATH.pause : PATH.play));
        key.setAttribute('aria-label', S.sim.playing ? bilingual('Pause simulation', 'توقف شبیه‌سازی')
                                                     : bilingual('Play simulation', 'پخش شبیه‌سازی'));
        key.className = 'vgp__btn vgp__pplay' + (S.sim.playing ? ' is-on' : '');
      }
    }

    /* ======================= personal writes ======================= */

    function toggleSave(pub) {
      var wasSaved = api.isSaved(pub.id);
      var res = wasSaved ? api.unsave(pub.id) : api.save(pub.id);
      if (res.ok) {
        say(api.isSaved(pub.id)
          ? 'Saved on this device only. It is not a Favorite and it does not follow the show.'
          : 'Removed from Saved on this device.', false);
      } else if (res.code === 'save-capacity') {
        say('Saved is full at ' + api.SAVE_CAP + '. Nothing was dropped to make room — at capacity the answer is no.', true);
      } else {
        say('This publication is no longer available.', true);
      }
      render();
    }
    function toggleFollow(pub) {
      var res = api.isFollowed(pub.showId) ? api.unfollow(pub.showId) : api.follow(pub.showId);
      if (!res.ok) { say('This show cannot be followed in the preview.', true); render(); return; }
      say(api.isFollowed(pub.showId)
        ? 'Following this show. In the preview that is local state only: nothing is fetched, and it is not the Podcast window’s Subscribe.'
        : 'No longer following this show.', false);
      render();
    }
    function report(pub) {
      api.report(pub.id).then(function () {
        say('Reported. The answer is the same whether or not this publication exists — that is the point.', false);
      });
    }
    function revoke(entry) {
      if (!entry.capability) { say('No key was kept for this preview publication, so it cannot be taken down here.', true); return; }
      api.revoke({ capability: entry.capability }).then(function (res) {
        if (!res.ok) { say('That publication could not be revoked.', true); return; }
        say('Revoked. Anything that saved it still shows the row, marked unavailable.', false);
        if (S.view === 'detail' && S.id === entry.publication.id) { loadDetail(S.id); }
        else { render(); }
      });
    }
    function mineEntryFor(id) {
      var mine = api.mine(), i;
      for (i = 0; i < mine.length; i++) { if (mine[i].publication.id === id) { return mine[i]; } }
      return null;
    }

    /* ======================= pieces ======================= */

    function label(text, count) {
      var h = el('h3', 'vgp__label');
      h.appendChild(document.createTextNode(text));
      if (count !== '' && count != null) { h.appendChild(el('span', null, ' ' + count)); }
      return h;
    }
    function hint(text) { return el('p', 'vgp__hint', text); }
    function empty(en, fa) { return el('p', 'vgp__empty', en + (fa ? ' · ' + fa : '')); }

    function lifeLine(pub) {
      var remaining = pub.expiresAt - Date.now();
      var frac = Math.max(0, Math.min(1, remaining / api.LIFETIME_MS));
      var box = el('div', 'vgp__life' + (remaining > 0 && remaining < DAY ? ' is-low' : ''));
      box.appendChild(el('span', 'vgp__life-word', remaining > 0 ? 'visible for' : 'no longer visible'));
      var rail = el('span', 'vgp__life-rail');
      var fill = el('span', 'vgp__life-fill');
      fill.style.width = (frac * 100).toFixed(2) + '%';
      rail.appendChild(fill);
      box.appendChild(rail);
      box.appendChild(el('b', null, remaining > 0 ? left(remaining) : 'expired'));
      return box;
    }

    function card(pub) {
      var box = el('div', 'vgp__card' + (pub.kind === 'show' ? ' vgp__card--show' : ''));

      var top = el('div', 'vgp__card-top');
      var art = el('div', 'vgp__mark' + (pub.kind === 'show' ? ' vgp__mark--show' : ''), markFor(pub));
      art.setAttribute('aria-hidden', 'true');

      var lines = el('div', 'vgp__lines');
      lines.appendChild(el('span', 'vgp__kind', pub.kind === 'show' ? bilingual('Show', 'نمایش')
                                                                     : bilingual('Episode', 'اپیزود')));
      var open = btn(nameOf(pub), 'vgp__open');
      var fa = nameFaOf(pub);
      if (fa) {
        open.innerHTML = '';
        open.appendChild(document.createTextNode(nameOf(pub) + ' '));
        var bdi = el('bdi', 'vgp__open-fa', fa);
        bdi.dir = 'rtl'; bdi.lang = 'fa';
        open.appendChild(bdi);
      }
      open.setAttribute('aria-label', bilingual('Open publication', 'بازکردن انتشار') + ' — ' + nameOf(pub));
      open.addEventListener('click', function () { openDetail(pub.id, open); });
      lines.appendChild(open);
      if (pub.kind !== 'show' && pub.showTitle) {
        lines.appendChild(el('span', 'vgp__show-name', pub.showTitle));
      }
      lines.appendChild(el('span', 'vgp__meta',
        ago(Date.now() - pub.createdAt) + (pub.durationSec ? ' · ' + clock(pub.durationSec) : '') +
        (pub.external ? ' · from your own subscription' : '')));
      top.appendChild(art);
      top.appendChild(lines);
      box.appendChild(top);

      if (pub.note) {
        var q = el('p', 'vgp__note');
        q.appendChild(el('span', 'vgp__quote', '“'));
        q.appendChild(document.createTextNode(pub.note));
        q.appendChild(el('span', 'vgp__quote', '”'));
        box.appendChild(q);
      }
      box.appendChild(lifeLine(pub));

      var saved = api.isSaved(pub.id);
      var following = api.isFollowed(pub.showId);
      var sb = btn(saved ? bilingual('Saved', 'ذخیره‌شده') : bilingual('Save', 'ذخیره'),
                   'vgp__btn--sm' + (saved ? ' is-on' : ''), function () { toggleSave(pub); });
      sb.setAttribute('aria-pressed', saved ? 'true' : 'false');
      var fb = btn(following ? bilingual('Following', 'دنبال‌شده') : bilingual('Follow', 'دنبال‌کردن'),
                   'vgp__btn--sm' + (following ? 'is-on' : ''), function () { toggleFollow(pub); });
      fb.setAttribute('aria-pressed', following ? 'true' : 'false');
      fb.setAttribute('aria-label', bilingual('Follow show', 'دنبال‌کردن نمایش') + ' — ' + pub.showTitle);
      box.appendChild(add(el('div', 'vgp__actions'), [sb, fb]));
      return box;
    }

    function row(title, sub, tag, tagCls, actions) {
      var box = el('div', 'vgp__row' + (tagCls === 'is-off' ? ' vgp__row--off' : ''));
      var main = el('div', 'vgp__row-main');
      main.appendChild(el('span', 'vgp__row-title', title));
      if (sub) { main.appendChild(el('span', 'vgp__row-sub', sub)); }
      box.appendChild(main);
      if (tag) { box.appendChild(el('span', 'vgp__tag' + (tagCls ? ' ' + tagCls : ''), tag)); }
      if (actions && actions.length) { box.appendChild(add(el('div', 'vgp__actions vgp__actions--tight'), actions)); }
      return box;
    }
    function openBtn(id, labelTxt) {
      return btn(labelTxt || bilingual('Open', 'بازکردن'), 'vgp__btn--sm', function () { openDetail(id, this); });
    }

    /* ======================= library view ======================= */

    function viewLibrary(frag) {
      var ribbon = el('p', 'vgp__ribbon');
      ribbon.appendChild(el('b', null, 'Local preview. '));
      ribbon.appendChild(document.createTextNode(
        'Nothing here is published, fetched, stored on a server or played. ' +
        'A publication is visible for seven days, then it stops being visible by itself.'));
      frag.appendChild(ribbon);

      var tools = add(el('div', 'vgp__actions vgp__actions--lead'), [
        btn(bilingual('Publish a show', 'انتشار یک نمایش'), 'vgp__btn--gold', function () { openPublish({ kind: 'show' }); }),
        btn(bilingual('Publish an episode', 'انتشار یک اپیزود'), 'vgp__btn--gold', function () { openPublish({ kind: 'episode' }); }),
        btn(bilingual('What changes in the galaxy', 'نشانه‌ها در کهکشان'), 'vgp__btn--quiet', function () {
          if (window.VoidPodcastPublishSignals) { window.VoidPodcastPublishSignals.pulse(api); }
          say('Signals are the three faint marks near the galaxy. They are CSS-only, they never stay, and with reduced motion they do not move.', false);
        })
      ]);

      if (S.loading) {
        frag.appendChild(tools);
        frag.appendChild(empty('Loading the preview catalogue', 'در حال بارگذاری'));
        return;
      }

      frag.appendChild(tools);
      frag.appendChild(label('In the galaxy now', S.list.length));
      if (!S.list.length) {
        frag.appendChild(empty('No publication is visible right now', 'هم‌اکنون هیچ انتشاری دیده نمی‌شود'));
      }
      for (var i = 0; i < S.list.length; i++) { frag.appendChild(card(S.list[i])); }

      var saves = api.saved();
      frag.appendChild(label('Saved on this device', saves.length));
      if (!saves.length) {
        frag.appendChild(empty('Nothing saved. Saving is private to this device and is not the Music player’s Favorite',
                              'چیزی ذخیره نشده'));
      }
      for (i = 0; i < saves.length; i++) {
        var s = saves[i], pub = s.publication;
        frag.appendChild(row(
          pub ? nameOf(pub) : s.id,
          pub ? (pub.kind === 'show' ? 'Show · نمایش' : pub.showTitle) : 'this preview no longer has it',
          s.available ? '' : 'unavailable',
          s.available ? '' : 'is-off',
          [openBtn(s.id), btn(bilingual('Remove', 'حذف'), 'vgp__btn--sm vgp__btn--quiet', (function (id) {
            return function () { api.unsave(id); say('Removed from Saved on this device.', false); render(); };
          })(s.id))]
        ));
      }
      if (saves.length) {
        frag.appendChild(hint('Saving never follows the show, never favorites a track and never removes anything. An expired save stays in the list and says unavailable.'));
      }

      var follows = api.followed();
      frag.appendChild(label('Following', follows.length));
      if (!follows.length) { frag.appendChild(empty('No shows followed', 'نمایشی دنبال نمی‌شود')); }
      for (i = 0; i < follows.length; i++) {
        var showId = follows[i], sh = api.showById(showId);
        frag.appendChild(row(
          sh ? sh.title : showId,
          sh ? (sh.external ? 'published from a feed you subscribe to' : (sh.publisher || '')) : '',
          'follow', 'vgp__tag--gold',
          [btn(bilingual('Unfollow', 'لغو دنبال‌کردن'), 'vgp__btn--sm vgp__btn--quiet', (function (id) {
            return function () { api.unfollow(id); say('No longer following this show.', false); render(); };
          })(showId))]
        ));
      }

      var mine = api.mine();
      frag.appendChild(label('Published by this device', mine.length));
      if (!mine.length) { frag.appendChild(empty('You have not published anything in the preview yet', 'هنوز چیزی منتشر نکرده‌اید')); }
      for (i = 0; i < mine.length; i++) {
        var m = mine[i];
        frag.appendChild(row(
          nameOf(m.publication),
          m.publication.kind === 'show' ? 'Show · نمایش' : m.publication.showTitle,
          m.status === 'active' ? 'live' : m.status,
          m.status === 'active' ? 'vgp__tag--gold' : 'is-off',
          [openBtn(m.publication.id),
           btn(bilingual('Retry key', 'کلید را دوباره بفرست'), 'vgp__btn--sm vgp__btn--quiet', (function (entry) {
             return function () { replayKey(entry); };
           })(m)),
           btn(bilingual('Revoke', 'پس‌گرفتن'), 'vgp__btn--sm vgp__btn--danger', (function (entry) {
             return function () { revoke(entry); };
           })(m))]
        ));
      }
      if (mine.length) {
        frag.appendChild(hint('Retry key sends the same capability again. It answers with the same publication and creates nothing, which is what makes a lost response safe.'));
      }

      frag.appendChild(label('Preview controls', ''));
      frag.appendChild(add(el('div', 'vgp__pad'), [
        btn('Fill Saved to ' + api.SAVE_CAP, 'vgp__btn--sm', function () {
          api.__preview.fillSaves(api.SAVE_CAP);
          say('Saved is at the cap now. Press Save on any card to see the refusal.', false);
          render();
        }),
        btn('Expire the newest sample', 'vgp__btn--sm', function () {
          if (!S.list.length) { say('Nothing is visible to expire yet.', true); return; }
          var gone = S.list[0];
          api.__preview.expire(gone.id);
          say('Aged “' + nameOf(gone) + '” past day seven. It left the ambient list at once.', false);
          loadList();
        }),
        btn('Hide a sample', 'vgp__btn--sm', function () {
          if (!S.list.length) { say('Nothing is visible to hide yet.', true); return; }
          var hidden = S.list[0];
          api.__preview.moderate(hidden.id, 'hide');
          lastHidden = hidden.id;
          say('“' + nameOf(hidden) + '” is hidden. Its card, its link and a republish attempt now answer the same neutral way.', false);
          loadList();
        }),
        btn('Bring the hidden one back', 'vgp__btn--sm', function () {
          if (!lastHidden) { say('Nothing has been hidden in this session.', true); return; }
          var res = api.__preview.unmoderate(lastHidden);
          if (!res.ok) { say('It cannot come back: only a hidden row can, and never past its lifetime.', true); return; }
          say('Un-hidden as ' + res.status + '. A row past its seven days returns expired, not live.', false);
          lastHidden = '';
          loadList();
        }),
        btn('Remove a sample', 'vgp__btn--sm', function () {
          if (!S.list.length) { say('Nothing is visible to remove yet.', true); return; }
          var rec = S.list[0];
          api.__preview.moderate(rec.id, 'remove');
          say('“' + nameOf(rec) + '” was removed by its publisher. A hidden row and a removed row look identical from outside.', false);
          loadList();
        }),
        btn('Reset this preview', 'vgp__btn--sm vgp__btn--quiet', function () {
          api.__preview.clearLocal();
          lastHidden = '';
          say('Saved, Following and your own publications cleared. Only ' + PERSIST_KEY + ' was touched.', false);
          loadList();
        })
      ]));
      frag.appendChild(hint('These exist so a state can be seen without inventing a production rule — the moderation threshold and the quotas are still pending. They call the preview block of the adapter, never the API surface the UI depends on.'));
      frag.appendChild(el('p', 'vgp__status'));
    }

    var lastHidden = '';

    /* ======================= detail view ======================= */

    function viewDetail(frag) {
      if (S.loading || !S.detail) {
        frag.appendChild(empty('Loading publication', 'در حال بارگذاری'));
        return;
      }
      var d = S.detail;
      if (d.kind !== 'publication') {
        var gone = el('div', 'vgp__block vgp__block--warn');
        gone.appendChild(el('h3', null, 'Nothing to show here'));
        gone.appendChild(el('p', null,
          'This publication is not available. The same answer comes back whether it expired, was withdrawn, ' +
          'was hidden, or never existed at all, so a link cannot be used to find out which.'));
        gone.appendChild(el('p', 'vgp__hint', 'id asked for: ' + d.id));
        frag.appendChild(gone);
        frag.appendChild(add(el('div', 'vgp__actions'), [btn(bilingual('Back', 'بازگشت'), '', function () { openLibrary(); })]));
        frag.appendChild(el('p', 'vgp__status'));
        return;
      }

      var isShow = d.kind === 'show';
      var head = el('div', 'vgp__card-top vgp__card-top--lg');
      var art = el('div', 'vgp__mark vgp__mark--lg' + (isShow ? ' vgp__mark--show' : ''), markFor(d));
      art.setAttribute('aria-hidden', 'true');
      var lines = el('div', 'vgp__lines');
      lines.appendChild(el('span', 'vgp__kind', isShow ? bilingual('Show', 'نمایش') : bilingual('Episode', 'اپیزود')));
      lines.appendChild(el('span', 'vgp__show-name', d.showTitle + (d.publisher ? ' · ' + d.publisher : '')));
      var nm = el('div', 'vgp__detail-title');
      nm.appendChild(document.createTextNode(isShow ? d.showTitle : d.episodeTitle));
      if (nameFaOf(d)) {
        var bdi = el('bdi', 'vgp__detail-fa', isShow ? d.showTitleFa : d.episodeTitleFa);
        bdi.dir = 'rtl'; bdi.lang = 'fa';
        nm.appendChild(el('span', null, ' '));
        nm.appendChild(bdi);
      }
      lines.appendChild(nm);
      lines.appendChild(el('span', 'vgp__meta',
        ago(Date.now() - d.createdAt) + (d.durationSec ? ' · ' + clock(d.durationSec) : '') +
        (d.external ? ' · from your own subscription' : '')));
      head.appendChild(art);
      head.appendChild(lines);
      frag.appendChild(head);

      if (d.note) {
        var q = el('p', 'vgp__note vgp__note--lg');
        q.appendChild(el('span', 'vgp__quote', '“'));
        q.appendChild(document.createTextNode(d.note));
        q.appendChild(el('span', 'vgp__quote', '”'));
        q.appendChild(el('span', 'vgp__anon', '— an anonymous publisher'));
        frag.appendChild(q);
      }
      if (d.description) {
        var desc = el('div', 'vgp__block');
        desc.appendChild(el('h3', null, 'About this episode'));
        var body = el('p', 'vgp__desc');
        var bd = el('bdi');
        bd.dir = 'auto';
        bd.appendChild(document.createTextNode(d.description));
        body.appendChild(bd);
        desc.appendChild(body);
        frag.appendChild(desc);
      }
      frag.appendChild(lifeLine(d));

      /* transport */
      var player = el('div', 'vgp__player');
      var phead = add(el('div', 'vgp__player-head'), [el('span', 'vgp__player-title', 'Transport'),
        el('span', 'vgp__sim', 'simulated')]);
      player.appendChild(phead);

      var prev = btn('−15', 'vgp__btn--sm', function () { seek(S.sim.pos - 15); });
      prev.setAttribute('aria-label', bilingual('Back fifteen seconds', 'پانزده ثانیه عقب'));
      var play = el('button', 'vgp__btn vgp__pplay');
      play.type = 'button';
      play.addEventListener('click', toggleSim);
      var next = btn('+15', 'vgp__btn--sm', function () { seek(S.sim.pos + 15); });
      next.setAttribute('aria-label', bilingual('Forward fifteen seconds', 'پانزده ثانیه جلو'));

      var track = el('div', 'vgp__ptrack');
      var rail = el('div', 'vgp__rail');
      var fill = el('span', 'vgp__fill');
      rail.appendChild(fill);
      rail.addEventListener('click', function (e) {
        var r = rail.getBoundingClientRect();
        if (r.width > 0) { seek(((e.clientX - r.left) / r.width) * S.sim.dur); }
      });
      var time = el('div', 'vgp__time');
      time.appendChild(el('span', 'vgp__time-now', clock(S.sim.pos)));
      time.appendChild(el('span', 'vgp__time-left', d.durationSec ? '−' + clock(d.durationSec) : 'no duration'));
      track.appendChild(rail);
      track.appendChild(time);

      /* A Show publication carries no single duration, so the transport has
         nothing to move. An inert-but-enabled control reads as broken; these
         say disabled and the hint below says why. */
      if (!d.durationSec) {
        prev.disabled = true;
        play.disabled = true;
        next.disabled = true;
        rail.setAttribute('aria-disabled', 'true');
      }

      player.appendChild(add(el('div', 'vgp__pmain'), [prev, play, next, track]));
      frag.appendChild(player);
      if (d.durationSec) {
        frag.appendChild(hint('Simulated transport: nothing here builds an Audio element, so Music and any real episode keep playing. The real product resolves audio from the listener’s own feed; no audio URL is ever stored on a publication.'));
      } else {
        frag.appendChild(hint('This publication covers the whole show, so there is nothing to transport. Open an episode to hear one.'));
      }

      var saved = api.isSaved(d.id);
      var following = api.isFollowed(d.showId);
      var sb = btn(saved ? bilingual('Saved', 'ذخیره‌شده') : bilingual('Save', 'ذخیره'), saved ? 'is-on' : '', function () { toggleSave(d); });
      sb.setAttribute('aria-pressed', saved ? 'true' : 'false');
      var fb = btn(following ? bilingual('Following', 'دنبال‌شده') : bilingual('Follow', 'دنبال‌کردن'), following ? 'is-on' : '', function () { toggleFollow(d); });
      fb.setAttribute('aria-pressed', following ? 'true' : 'false');
      var rb = btn(bilingual('Report', 'گزارش'), 'vgp__btn--quiet', function () { report(d); });
      frag.appendChild(add(el('div', 'vgp__actions'), [sb, fb, rb]));

      var link = deepLink(d.id);
      var linkBox = el('div', 'vgp__block');
      linkBox.appendChild(el('h3', null, 'Publication link'));
      linkBox.appendChild(el('code', 'vgp__code', link));
      linkBox.appendChild(add(el('div', 'vgp__actions'), [btn('Copy link', 'vgp__btn--sm', function () {
        copyText(link, function (okFlag) {
          say(okFlag ? 'Link copied. Opening it lands on this exact publication, never on the show list.'
                     : 'Copy failed — the link is printed above.', !okFlag);
        });
      })]));
      frag.appendChild(linkBox);

      var reveal = el('div', 'vgp__block');
      reveal.appendChild(el('h3', null, 'What this page knows'));
      var ul = el('ul');
      ul.appendChild(el('li', null, 'feed address · ' + d.feedUrl));
      ul.appendChild(el('li', null, isShow ? 'show-level publication · no single episode id' : 'episode id · ' + d.guid));
      ul.appendChild(el('li', 'is-no', 'no audio URL — none is stored or proxied'));
      ul.appendChild(el('li', 'is-no', 'no publisher name, account or device'));
      reveal.appendChild(ul);
      frag.appendChild(reveal);
      frag.appendChild(hint('Only a detail read carries the feed address; the ambient list never does. A recipient who already follows this show still lands on this exact episode — following never redirects a shared link.'));

      var entry = mineEntryFor(d.id);
      if (entry) {
        frag.appendChild(add(el('div', 'vgp__row'), [
          (function () { var m = el('div', 'vgp__row-main'); m.appendChild(el('span', 'vgp__row-title', 'Published from this device')); return m; })(),
          el('span', 'vgp__tag' + (entry.status === 'active' ? ' vgp__tag--gold' : ' is-off'), entry.status),
          add(el('div', 'vgp__actions vgp__actions--tight'), [
            btn(bilingual('Revoke', 'پس‌گرفتن'), 'vgp__btn--sm vgp__btn--danger', function () { revoke(entry); })
          ])
        ]));
      }
      frag.appendChild(el('p', 'vgp__status'));
    }

    /* ======================= publish wizard ======================= */

    function openPublish(req) {
      S.wizard = {
        step: 'target',
        kind: req.kind === 'show' ? 'show' : 'episode',
        fixtureId: req.fixtureId || '',
        external: req.external || null,
        note: '',
        ack: false,
        capability: '',
        result: null
      };
      show(null);
      setView('publish');
    }

    /* The wizard works against one described target, whether it came from the
       preview catalogue or from a real show on screen. */
    function describe(w) {
      if (w.external) {
        var x = w.external;
        return {
          kind: w.kind,
          kindLabel: w.kind === 'show' ? bilingual('Show', 'نمایش') : bilingual('Episode', 'اپیزود'),
          title: w.kind === 'show' ? (x.showTitle || x.title) : (x.title || x.showTitle),
          titleFa: w.kind === 'show' ? x.showTitleFa : x.titleFa,
          sub: w.kind === 'show' ? (x.publisher || '') : (x.showTitle || ''),
          initials: x.initials || '',
          durationSec: w.kind === 'show' ? 0 : (x.durationSec || 0),
          feedUrl: x.feedUrl || '',
          guid: x.guid || ''
        };
      }
      var list = w.kind === 'show' ? mock.SHOWS : mock.EPISODES, rec = null, i;
      for (i = 0; i < list.length; i++) { if (list[i].id === w.fixtureId) { rec = list[i]; } }
      if (!rec) { return null; }
      if (w.kind === 'show') {
        return { kind: 'show', kindLabel: bilingual('Show', 'نمایش'), title: rec.title, titleFa: rec.titleFa,
          sub: rec.publisher, initials: rec.initials, durationSec: 0, feedUrl: rec.feedUrl, guid: '' };
      }
      var sh = null;
      for (i = 0; i < mock.SHOWS.length; i++) { if (mock.SHOWS[i].id === rec.showId) { sh = mock.SHOWS[i]; } }
      return { kind: 'episode', kindLabel: bilingual('Episode', 'اپیزود'), title: rec.title, titleFa: rec.titleFa,
        sub: sh ? sh.title : '', initials: sh ? sh.initials : '', durationSec: rec.durationSec,
        feedUrl: sh ? sh.feedUrl : '', guid: rec.guid };
    }

    function replayKey(entry) {
      if (!entry.capability) { say('This preview row kept no key, so there is nothing to replay.', true); return; }
      api.publish({ capability: entry.capability, kind: entry.publication.kind, target: entry.publication.id, note: entry.publication.note })
        .then(function (res) {
          if (res.ok && res.idempotent) {
            say('Same key, same answer: ' + res.publication.id + '. A second publication was not created.', false);
          } else if (res.ok) {
            say('A new publication came back: ' + res.publication.id + '.', false);
          } else {
            say('Replay refused: ' + res.code + '.', true);
          }
          loadList();
        });
    }

    function wizardLabel(w) {
      if (w.step === 'target') { return bilingual('Continue', 'ادامه'); }
      if (w.step === 'note') { return bilingual('Review', 'بازبینی'); }
      if (w.step === 'review') { return S.busy ? 'Working…' : bilingual('Publish in the preview', 'انتشار در پیش‌نمایش'); }
      return bilingual('Open the publication', 'بازکردن انتشار');
    }

    function wizardNext() {
      var w = S.wizard;
      if (!w) { return; }
      if (w.step === 'target') {
        if (!describe(w)) { say('Choose what to publish first.', true); return; }
        w.step = 'note';
        render();
        return;
      }
      if (w.step === 'note') {
        var note = w.note.replace(/^\s+|\s+$/g, '');
        if (!note) { say('A publication carries a note in your own words.', true); return; }
        if (note.length > api.NOTE_CAP) { say('The note is longer than ' + api.NOTE_CAP + ' characters.', true); return; }
        if (!w.capability) { w.capability = mock.makeCapability(); }
        w.step = 'review';
        render();
        return;
      }
      if (w.step === 'review') {
        if (!w.ack) { say('Keep the key first. It is shown once and cannot be recovered.', true); return; }
        if (S.busy) { return; }
        S.busy = true;
        render();
        var body = { capability: w.capability, kind: w.kind, note: w.note.replace(/^\s+|\s+$/g, '') };
        if (w.external) { body.target = w.external; } else { body.target = w.fixtureId; }
        api.publish(body).then(function (res) {
          S.busy = false;
          w.result = res;
          if (res.ok) {
            w.step = 'issued';
            say(res.idempotent ? 'The same key came back with the same publication. Nothing was created twice.'
                               : 'Published inside the preview. No server was touched.', false);
          } else {
            say('Not published: ' + res.code, true);
          }
          render();
        }, function () { S.busy = false; render(); });
        return;
      }
      var res2 = w.result;
      var id = res2 && res2.publication ? res2.publication.id : '';
      S.wizard = null;
      if (id) { openDetail(id); loadList(); } else { openLibrary(); }
    }

    function targetSummary(t) {
      var box = el('div', 'vgp__card vgp__card--static');
      var top = el('div', 'vgp__card-top');
      var art = el('div', 'vgp__mark', t.initials || initials(t.title));
      art.setAttribute('aria-hidden', 'true');
      var lines = el('div', 'vgp__lines');
      lines.appendChild(el('span', 'vgp__kind', t.kindLabel));
      var nm = btn(t.title, 'vgp__open');
      nm.disabled = true;
      nm.className = 'vgp__open is-static';
      lines.appendChild(nm);
      if (t.titleFa) { var f = el('bdi', 'vgp__show-name', t.titleFa); f.dir = 'rtl'; f.lang = 'fa'; lines.appendChild(f); }
      lines.appendChild(el('span', 'vgp__meta', t.sub + (t.durationSec ? ' · ' + clock(t.durationSec) : '')));
      top.appendChild(art);
      top.appendChild(lines);
      box.appendChild(top);
      return box;
    }

    function viewPublish(frag) {
      var w = S.wizard;
      if (!w) { openLibrary(); return; }
      var t = describe(w);

      var steps = el('div', 'vgp__steps');
      var names = ['target', 'note', 'review', 'issued'];
      var words = ['What', 'Note', 'Review', 'Done'];
      var at = names.indexOf(w.step);
      for (var i = 0; i < names.length; i++) {
        steps.appendChild(el('span', 'vgp__step' + (i === at ? ' is-on' : (i < at ? ' is-past' : '')),
          (i + 1) + ' ' + words[i]));
      }
      frag.appendChild(steps);

      if (w.step === 'target') {
        var seg = el('div', 'vgp__seg');
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', bilingual('What are you publishing', 'چه چیزی منتشر می‌کنید'));
        var pairs = [['show', bilingual('A whole show', 'کل یک نمایش')], ['episode', bilingual('One episode', 'یک اپیزود')]];
        for (i = 0; i < pairs.length; i++) {
          (function (pair) {
            var on = w.kind === pair[0];
            var c = el('button', 'vgp__chip' + (on ? ' is-on' : ''), pair[1]);
            c.type = 'button';
            c.setAttribute('role', 'radio');
            c.setAttribute('aria-checked', on ? 'true' : 'false');
            c.addEventListener('click', function () { w.kind = pair[0]; w.fixtureId = ''; render(); });
            seg.appendChild(c);
          })(pairs[i]);
        }
        frag.appendChild(seg);

        var pick = el('div', 'vgp__pick');
        var src = w.kind === 'show' ? mock.SHOWS : mock.EPISODES;
        for (i = 0; i < src.length; i++) {
          (function (rec) {
            var on = w.fixtureId === rec.id;
            var row = el('button', 'vgp__pickrow' + (on ? ' is-on' : ''));
            row.type = 'button';
            row.appendChild(el('b', null, rec.title));
            if (rec.titleFa) { var f = el('em', null, rec.titleFa); f.dir = 'rtl'; f.lang = 'fa'; row.appendChild(f); }
            var sub = '';
            if (w.kind === 'show') { sub = rec.publisher; }
            else {
              var sh = null, k;
              for (k = 0; k < mock.SHOWS.length; k++) { if (mock.SHOWS[k].id === rec.showId) { sh = mock.SHOWS[k]; } }
              sub = (sh ? sh.title + ' · ' : '') + clock(rec.durationSec) + (rec.audioUrl ? ' · fixture audio exists' : ' · no fixture audio');
            }
            row.appendChild(el('em', null, sub));
            row.addEventListener('click', function () { w.fixtureId = rec.id; w.external = null; render(); });
            pick.appendChild(row);
          })(src[i]);
        }
        frag.appendChild(pick);
        frag.appendChild(hint('This list is the preview catalogue. In the Podcast window every show and every episode row carries the same Publish action, which publishes what you are looking at.'));
      } else if (!t) {
        frag.appendChild(empty('Choose what to publish first', 'اول انتخاب کنید'));
      } else {
        frag.appendChild(targetSummary(t));

        if (w.step === 'note') {
          var f2 = el('div', 'vgp__field');
          var lb = el('label', null, 'Your note');
          lb.htmlFor = 'vgp-note-input';
          f2.appendChild(lb);
          var ta = el('textarea', 'vgp__textarea');
          ta.id = 'vgp-note-input';
          ta.maxLength = api.NOTE_CAP;
          ta.placeholder = 'Why this is worth someone’s time. Anonymous, up to ' + api.NOTE_CAP + ' characters.';
          ta.value = w.note;
          ta.addEventListener('input', function () {
            w.note = ta.value;
            var c = bodyEl.querySelector('.vgp__counter');
            if (c) {
              c.textContent = ta.value.length + ' / ' + api.NOTE_CAP;
              c.className = 'vgp__counter' + (ta.value.length >= api.NOTE_CAP ? ' is-over' : '');
            }
          });
          f2.appendChild(ta);
          f2.appendChild(el('p', 'vgp__counter' + (w.note.length >= api.NOTE_CAP ? ' is-over' : ''), w.note.length + ' / ' + api.NOTE_CAP));
          frag.appendChild(f2);

          var warn = el('div', 'vgp__block vgp__block--warn');
          warn.appendChild(el('h3', null, 'Before you go on'));
          var wul = el('ul');
          wul.appendChild(el('li', null, 'A publication stores the feed address and the episode id so a listener can find this exact thing again. Those become public.'));
          wul.appendChild(el('li', null, 'It is anonymous: no name, account or device is stored, and the note carries no author.'));
          wul.appendChild(el('li', null, 'It stays visible for seven days, then it stops being visible on its own. Nothing is deleted out from under anyone.'));
          warn.appendChild(wul);
          frag.appendChild(warn);

          var priv = el('div', 'vgp__block vgp__block--warn');
          priv.appendChild(el('h3', null, 'If this feed is not meant for the public'));
          var pul = el('ul');
          pul.appendChild(el('li', null, 'A private, paid or unlisted feed can still be published from, and the people who could not read it before can read it through the link.'));
          pul.appendChild(el('li', null, 'The preview cannot tell whether a feed is public, so it always shows this warning. Do not read it as a permission check.'));
          priv.appendChild(pul);
          frag.appendChild(priv);
          frag.appendChild(hint('Source this would publish: ' + t.feedUrl + (t.guid ? ' · episode id ' + t.guid : '')));
        } else if (w.step === 'review') {
          var review = el('div', 'vgp__block vgp__block--gold');
          review.appendChild(el('h3', null, 'What others would see'));
          frag.appendChild(review);
          frag.appendChild(card({
            id: 'preview-only', kind: t.kind, showId: '', showTitle: t.sub || t.title, episodeTitle: t.title,
            episodeTitleFa: t.titleFa, showTitleFa: '', publisher: '', note: w.note.replace(/^\s+|\s+$/g, ''),
            initials: t.initials, description: '', durationSec: t.durationSec, external: false,
            createdAt: Date.now(), expiresAt: Date.now() + api.LIFETIME_MS
          }));
          frag.appendChild(el('p', 'vgp__hint', 'The card above is the whole public surface of a publication: the kind, the titles, the note and how long it stays.'));

          var store = el('div', 'vgp__block');
          store.appendChild(el('h3', null, 'Stored for seven days'));
          var sl = el('ul');
          sl.appendChild(el('li', null, 'feed address · ' + t.feedUrl));
          sl.appendChild(el('li', null, t.kind === 'show' ? 'no episode id — the whole show is the publication' : 'episode id · ' + t.guid));
          sl.appendChild(el('li', null, 'your note · ' + w.note.replace(/^\s+|\s+$/g, '').length + ' characters'));
          store.appendChild(sl);
          var sl2 = el('ul');
          sl2.appendChild(el('li', 'is-no', 'no audio file — none is stored or proxied'));
          sl2.appendChild(el('li', 'is-no', 'no name, account, device or IP address'));
          sl2.appendChild(el('li', 'is-no', 'nothing you did not put here'));
          store.appendChild(sl2);
          frag.appendChild(store);

          var cap = el('div', 'vgp__block vgp__block--warn');
          cap.appendChild(el('h3', null, 'The key that lets you take it down'));
          cap.appendChild(el('code', 'vgp__code vgp__code--cap', w.capability));
          cap.appendChild(add(el('div', 'vgp__actions'), [btn('Copy key', 'vgp__btn--sm', function () {
            copyText(w.capability, function (okFlag) {
              say(okFlag ? 'Key copied. Keep it somewhere private.' : 'Copy failed — the key is printed above.', !okFlag);
            });
          })]));
          var ack = el('label', 'vgp__ack');
          var cb = el('input');
          cb.type = 'checkbox';
          cb.checked = w.ack;
          cb.addEventListener('change', function () { w.ack = cb.checked; render(); });
          ack.appendChild(cb);
          ack.appendChild(el('span', null, 'I saved this key. It is shown once, now, and without it the publication cannot be taken down early — it simply runs its seven days.'));
          cap.appendChild(ack);
          frag.appendChild(cap);
        } else if (w.step === 'issued') {
          var res = w.result;
          if (res && res.ok) {
            var done = el('div', 'vgp__block vgp__block--gold');
            done.appendChild(el('h3', null, res.idempotent ? 'Same key, same publication' : 'Published inside the preview'));
            done.appendChild(el('p', null, res.idempotent
              ? 'The key you sent was already used, so the answer is the publication you created the first time. Nothing new exists.'
              : 'Only this device can see it. No row was written anywhere and no feed was fetched.'));
            var dl = el('ul');
            dl.appendChild(el('li', null, 'id · ' + res.publication.id));
            dl.appendChild(el('li', null, 'visible for · ' + left(res.publication.expiresAt - Date.now())));
            dl.appendChild(el('li', null, 'kind · ' + (res.publication.kind === 'show' ? 'Show' : 'Episode') + ' · ' + nameOf(res.publication)));
            done.appendChild(dl);
            frag.appendChild(done);
            frag.appendChild(add(el('div', 'vgp__actions'), [
              btn(bilingual('Open the publication', 'بازکردن انتشار'), 'vgp__btn--gold', function () {
                var id = res.publication.id;
                S.wizard = null;
                openDetail(id);
              }),
              btn(bilingual('Publish another', 'انتشار دیگری'), 'vgp__btn--quiet', function () {
                S.wizard = null;
                openLibrary();
              })
            ]));
          } else if (res) {
            var blocked = el('div', 'vgp__block vgp__block--warn');
            blocked.appendChild(el('h3', null, res.code === 'duplicate' ? 'Already published' : 'Not published'));
            blocked.appendChild(el('p', null, res.code === 'duplicate'
              ? 'An active publication already covers this exact thing, so publishing again would only make a second copy of it.'
              : 'Something already occupies this thing and it cannot be published over. Nothing else is answered — not what it is, not why.'));
            if (res.publicationId) {
              blocked.appendChild(el('p', 'vgp__hint', 'existing id · ' + res.publicationId));
            }
            frag.appendChild(blocked);
            frag.appendChild(add(el('div', 'vgp__actions'), [
              res.publicationId ? btn(bilingual('Open the existing one', 'بازکردن همان'), 'vgp__btn--gold', function () {
                var id = res.publicationId;
                S.wizard = null;
                openDetail(id);
              }) : null,
              btn(bilingual('Change the note and try again', 'تلاش دوباره'), 'vgp__btn--quiet', function () {
                w.result = null;
                w.step = 'note';
                render();
              })
            ]));
          }
        }
      }

      frag.appendChild(el('p', 'vgp__status'));
      var foot = el('div', 'vgp__actions');
      foot.appendChild(btn(bilingual('Cancel', 'انصراف'), 'vgp__btn--quiet', function () {
        S.wizard = null;
        openLibrary();
      }));
      var next2 = btn(wizardLabel(w), 'vgp__btn--gold', wizardNext);
      next2.disabled = !!S.busy;
      if (S.busy) { next2.setAttribute('aria-busy', 'true'); }
      foot.appendChild(next2);
      frag.appendChild(foot);
    }

    /* ======================= render ======================= */

    function render() {
      if (!built) { return; }
      if (S.view !== 'detail') { stopSim(); }
      var hadFocus = dialog.contains(document.activeElement);
      var frag = document.createDocumentFragment();
      if (S.view === 'library') {
        eyebrowEl.textContent = 'Galaxy publishing';
        titleEl.textContent = 'Publications';
        viewLibrary(frag);
      } else if (S.view === 'detail') {
        eyebrowEl.textContent = 'Publication';
        titleEl.textContent = S.detail && S.detail.kind === 'publication' ? nameOf(S.detail) : 'Publication';
        viewDetail(frag);
      } else {
        eyebrowEl.textContent = 'Publish';
        titleEl.textContent = 'Publish in the preview';
        viewPublish(frag);
      }
      bodyEl.textContent = '';
      bodyEl.appendChild(frag);
      if (S.view === 'detail') { paintSim(); }
      /* Replacing the body destroys whatever had focus. Without the hand-back
         the dialog loses focus to the page on every refresh, which is the same
         reason the Podcast window re-focuses after rerender(). */
      if (hadFocus && !dialog.contains(document.activeElement)) { focusFirst(); }
    }

    /* ======================= entry points ======================= */

    function mountChip() {
      var nav = document.getElementById('void-topnav');
      if (!nav || document.getElementById('vgp-chip')) { return; }
      chip = el('button', 'void-topnav__link void-topnav__link--action void-topnav__icon');
      chip.id = 'vgp-chip';
      chip.type = 'button';
      chip.setAttribute('aria-haspopup', 'dialog');
      chip.setAttribute('aria-expanded', 'false');
      chip.setAttribute('aria-label', bilingual('Galaxy publishing preview', 'پیش‌نمایش انتشار'));
      chip.title = 'Galaxy publishing preview';
      chip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path d="M12 3.4 20.6 12 12 20.6 3.4 12Z" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
        '<path d="M12 8.2 15.8 12 12 15.8 8.2 12Z" fill="currentColor"/></svg>';
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        openLibrary(chip);
      });
      var li = el('li');
      li.appendChild(chip);
      nav.appendChild(li);
    }

    /* Hooks called from the podcast window, only when this module exists. */
    function decorateShowActions(hostEl, showId, show0) {
      if (!hostEl || !showId || !show0 || !show0.feedUrl) { return; }
      var b = el('button', 'pw__pubbtn');
      b.type = 'button';
      b.textContent = bilingual('Publish show', 'انتشار نمایش');
      b.setAttribute('aria-label', bilingual('Publish this show in the preview', 'انتشار این نمایش در پیش‌نمایش'));
      b.addEventListener('click', function () {
        openPublish({ kind: 'show', external: {
          feedUrl: show0.feedUrl, showId: showId, title: show0.title, titleFa: show0.titleFa,
          publisher: show0.publisher, initials: show0.initials
        } });
      });
      hostEl.appendChild(b);
    }
    function decorateEpisodeRow(hostEl, episode, show0) {
      if (!hostEl || !episode || !show0 || !show0.feedUrl) { return; }
      var b = el('button', 'pw__epub');
      b.type = 'button';
      b.setAttribute('aria-label', bilingual('Publish this episode in the preview', 'انتشار این اپیزود در پیش‌نمایش'));
      b.title = bilingual('Publish this episode (preview)', 'انتشار این اپیزود (پیش‌نمایش)');
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path d="M12 4.4 19.6 12 12 19.6 4.4 12Z" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
        '<path d="M12 8.6v6.8M8.6 12h6.8" stroke="currentColor" stroke-width="1.3"/></svg>';
      b.addEventListener('click', function () {
        openPublish({ kind: 'episode', external: {
          feedUrl: show0.feedUrl, guid: episode.guid || episode.id, title: episode.title, titleFa: episode.titleFa,
          showId: show0.id, showTitle: show0.title, showTitleFa: show0.titleFa, publisher: show0.publisher,
          initials: show0.initials, durationSec: episode.durationSec || 0, description: episode.description || ''
        } });
      });
      hostEl.appendChild(b);
    }

    function deepLinkTarget() {
      var m = /[?&]signal=([^&#]*)/.exec(String(location.search));
      if (!m) { return ''; }
      var id = '';
      try { id = decodeURIComponent(m[1]); } catch (e) { id = m[1]; }
      return id;
    }

    unchange = api.onChange(function () {
      /* A change while the browser view is open refreshes the ambient list, so
         publishing shows up the way a real client would see it. */
      if (dialog && dialog.open && S.view === 'library' && !S.loading) { loadList(); }
    });

    return {
      state: S,
      mountChip: mountChip,
      openLibrary: openLibrary,
      openDetail: openDetail,
      openPublish: openPublish,
      close: close,
      isOpen: function () { return !!(dialog && dialog.open); },
      decorateShowActions: decorateShowActions,
      decorateEpisodeRow: decorateEpisodeRow,
      deepLinkTarget: deepLinkTarget,
      destroy: function () {
        if (unchange) { unchange(); }
        stopSim();
        close();
        if (dialog && dialog.parentNode) { dialog.parentNode.removeChild(dialog); }
        if (chip && chip.parentNode) { chip.parentNode.removeChild(chip); }
        built = false;
      }
    };
  }

  return { create: create, DAY: DAY, PERSIST_KEY: PERSIST_KEY };
});
