/* Golden Folder sharing — invitation links, the sharing sheet and the recipient
   card. Links carry a catalogue id (or the literal "folder"), never an audio URL.
   Playback always goes through the Golden Folder's existing request path, so the
   one audio element and the queue are untouched. */
(function () {
  'use strict';

  if (/[?&]admin=(?:1|true)(?:&|#|$)/.test(location.search)) return;

  var GOLDEN = window.VoidGolden;
  if (!GOLDEN || !GOLDEN.ready || typeof GOLDEN.ready.then !== 'function') return;

  var sheet = document.getElementById('void-golden-share');
  var invite = document.getElementById('void-invite');
  if (!sheet || !invite) return;

  var shareTitle = document.getElementById('void-golden-share-title');
  var shareMeta = document.getElementById('void-golden-share-meta');
  var shareMsg = document.getElementById('void-golden-share-msg');
  var copyBtn = document.getElementById('void-golden-share-copy');
  var nativeBtn = document.getElementById('void-golden-share-native');
  var statusEl = document.getElementById('void-golden-share-status');
  var closeBtn = document.getElementById('void-golden-share-close');

  var inviteTitle = document.getElementById('void-invite-title');
  var inviteLine = document.getElementById('void-invite-line');
  var inviteTrack = document.getElementById('void-invite-track');
  var inviteGo = document.getElementById('void-invite-go');
  var inviteClose = document.getElementById('void-invite-close');

  var COPY = {
    track: {
      title: 'You\u2019ve Been Invited to the Galaxy',
      line: 'Some music is better when shared.',
      cta: 'ENTER & LISTEN'
    },
    folder: {
      title: 'A Golden Collection Awaits You',
      line: 'Explore a collection of carefully selected music.',
      cta: 'EXPLORE GOLDEN FOLDER'
    }
  };

  /* Invitation links always lead to the official page this code runs on; on a
     local file:// copy the published origin is the only useful destination. */
  function shareBase() {
    try {
      var u = new URL('./', location.href);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    } catch (e) {}
    return 'https://minoodar.github.io/void/';
  }
  var BASE = shareBase();
  function trackLink(id) { return BASE + '?invite=' + encodeURIComponent(id); }
  function folderLink() { return BASE + '?invite=folder'; }

  function countLabel(n) { return n + (n === 1 ? ' track' : ' tracks'); }

  var currentLink = '';
  var currentPayload = null;

  function canNativeShare(payload) {
    if (!navigator.share) return false;
    if (!navigator.canShare) return true;
    try { return navigator.canShare(payload); } catch (e) { return true; }
  }

  function openShare(entry) {
    currentLink = entry ? trackLink(entry.id) : folderLink();
    currentPayload = entry ? {
      title: entry.title + ' \u2014 Void',
      text: 'Listen to ' + entry.title + (entry.artist ? ' by ' + entry.artist : '') + ' on Void.',
      url: currentLink
    } : {
      title: 'Void \u2014 Golden Folder',
      text: 'Explore a collection of carefully selected music on Void.',
      url: currentLink
    };

    shareTitle.textContent = entry ? entry.title : 'Golden Folder';
    shareMeta.textContent = entry ? (entry.artist || '') : (countLabel(GOLDEN.getTracks().length) + ' \u00b7 Golden Folder');
    shareMeta.hidden = !shareMeta.textContent;
    shareMsg.textContent = entry ? COPY.track.line : COPY.folder.line;
    statusEl.textContent = '';
    statusEl.classList.remove('is-raw');
    copyBtn.disabled = false;
    copyBtn.textContent = 'Copy invitation link';
    if (nativeBtn) nativeBtn.hidden = !canNativeShare(currentPayload);

    if (!sheet.open) {
      try { sheet.showModal(); }
      catch (e) { sheet.setAttribute('open', ''); }
    }
    try { copyBtn.focus({ preventScroll: true }); } catch (e) {}
  }

  function closeShare() {
    if (sheet.open) {
      try { sheet.close(); } catch (e) { sheet.removeAttribute('open'); }
    }
    statusEl.textContent = '';
    statusEl.classList.remove('is-raw');
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function copyInvitation() {
    return copyText(currentLink).then(function (ok) {
      statusEl.classList.toggle('is-raw', !ok);
      statusEl.textContent = ok ? 'Invitation link copied.' : currentLink;
      return ok;
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      copyInvitation().then(function (ok) {
        if (!ok) copyBtn.textContent = 'Try again';
      });
    });
  }

  if (nativeBtn) {
    nativeBtn.addEventListener('click', function () {
      if (!navigator.share || !currentPayload) return;
      navigator.share(currentPayload).then(function () {
        statusEl.classList.remove('is-raw');
        statusEl.textContent = 'Invitation shared.';
      }, function (err) {
        if (err && err.name === 'AbortError') return;
        copyInvitation().then(function () {
          statusEl.textContent = 'Native sharing is unavailable here \u2014 link copied instead.';
        });
      });
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', closeShare);
  /* The player claims Escape on document in the capture phase (Music Mode exit).
     A top-layer window must take it first, or Escape would leave Music Mode and
     leave this sheet open. Window capture runs before document capture. */
  window.addEventListener('keydown', function (e) {
    if (!sheet.open || e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    closeShare();
  }, true);
  sheet.addEventListener('cancel', function (e) {
    e.preventDefault();
    closeShare();
  });
  sheet.addEventListener('click', function (e) {
    if (e.target === sheet) closeShare();
  });

  GOLDEN.openShare = openShare;

  /* ---- Recipient invitation card ---- */

  var currentInvite = null;

  function hideInvite() {
    currentInvite = null;
    invite.hidden = true;
  }

  function paintInvite(copy, entryOrNull, trackText, cta, kind) {
    inviteTitle.textContent = copy.title;
    inviteLine.textContent = copy.line;
    inviteTrack.textContent = trackText || '';
    inviteTrack.hidden = !trackText;
    inviteGo.textContent = cta;
    inviteGo.hidden = !cta;
    currentInvite = { kind: kind, entry: entryOrNull };
    invite.hidden = false;
  }

  function showTrackInvite(entry) {
    paintInvite(
      COPY.track,
      entry,
      entry.title + (entry.artist ? ' \u00b7 ' + entry.artist : ''),
      COPY.track.cta,
      'track'
    );
  }

  function showFolderInvite() {
    paintInvite(COPY.folder, null, countLabel(GOLDEN.getTracks().length) + ' \u00b7 Golden Folder', COPY.folder.cta, 'folder');
  }

  function showUnavailable() {
    paintInvite({
      title: 'This Track Is No Longer Available',
      line: 'The invitation may be old, or the track was removed from the Golden Folder.'
    }, null, '', COPY.folder.cta, 'folder');
  }

  function inviteId() {
    var params;
    try { params = new URLSearchParams(location.search); } catch (e) { return ''; }
    var raw = params.get('invite');
    if (!raw) return '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(raw)) return '';
    return raw;
  }

  var ID = inviteId();
  if (ID) {
    inviteClose.addEventListener('click', hideInvite);

    inviteGo.addEventListener('click', function () {
      if (!currentInvite) return;
      var kind = currentInvite.kind;
      var entry = currentInvite.entry;
      hideInvite();
      if (kind === 'track' && entry) GOLDEN.play(entry.id);
      else GOLDEN.open();
    });

    /* A start from anywhere else (dock, queue, folder) also ends the invitation. */
    window.addEventListener('voidmusic:remote-state', function (e) {
      var d = e.detail || {};
      if (!currentInvite || currentInvite.kind !== 'track' || !d.url) return;
      if (d.state === 'playing' && currentInvite.entry && d.url === currentInvite.entry.url) hideInvite();
    });

    GOLDEN.ready.then(function () {
      var entry = GOLDEN.find(ID);
      if (!entry && ID === 'folder') showFolderInvite();
      else if (!entry) showUnavailable();
      else showTrackInvite(entry);
    });
  }
})();
