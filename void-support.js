/* Void — Support panel.
   The triangular rail mark opens a compact glass window with three methods:
   Donito (the original payment URL, unchanged) and two BEP20 crypto options
   that share one deposit address. QR codes are generated locally by the
   vendored encoder (void-qr.js) as crisp white-on-black vectors; nothing here
   touches the player, the galaxy, the letters system or any backend. The
   dialog mounts inside #void-music-root while Music Mode is active so the
   player's stray-element sweep never hides it (same home as the letter
   composer); when the player is closed it mounts on body, where no sweep runs. */
(function () {
  'use strict';

  var ADDRESS = '0x3C9e8a1Ae29755154516695683d82e5e02589346';
  var DONITO_URL = 'https://donito.me/u-b8wjr';
  var NETWORK = 'BNB Smart Chain (BEP20)';
  var WARNING = 'Only send this asset through BNB Smart Chain (BEP20). Deposits through other networks may result in permanent loss of funds.';

  var icon = document.getElementById('void-topnav-support');
  if (!icon) return;

  /* Thin-stroke marks in the rail's own line family. Decorative only: the
     visible names and the network chip carry the meaning. */
  var SVG = {
    donito: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19.6C7.2 15.7 4.6 12.9 4.6 9.9c0-2.2 1.7-3.9 3.9-3.9 1.5 0 2.8.8 3.5 2 .7-1.2 2-2 3.5-2 2.2 0 3.9 1.7 3.9 3.9 0 3-2.6 5.8-7.4 9.7Z"/></svg>',
    btc: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.6 6.2v11.6M9.6 6.2h3.6a2.9 2.9 0 0 1 0 5.8H9.6M9.6 12h4a2.9 2.9 0 0 1 0 5.8H9.6M11.2 4.4v1.8M11.2 17.8v1.8M13.6 4.4v1.8M13.6 17.8v1.8"/></svg>',
    usdt: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.4 6.4h9.2M12 6.4v11.4M8.6 11.2h6.8"/></svg>',
    network: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.6l7.4 4.2v8.4L12 20.4l-7.4-4.2V7.8Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8.4" y="8.4" width="10.2" height="10.2" rx="2"/><path d="M5.4 15.6V7.4a2 2 0 0 1 2-2h8.2"/></svg>',
    copied: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5.5 12.5l4 4 9-9.5"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 5.5h4.5V10M18.5 5.5L11 13M16.5 12.5v5a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 17.5V9a1.5 1.5 0 0 1 1.5-1.5h5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4.8l8.4 14.4H3.6ZM12 10v3.6M12 16.4h.01"/></svg>'
  };

  var METHODS = [
    { key: 'donito', name: 'Donito', sub: 'Rial · Online', asset: 'Donito', mark: 'donito' },
    { key: 'btc', name: 'Bitcoin', sub: 'BEP20', asset: 'Bitcoin (BTC)', mark: 'btc' },
    { key: 'usdt', name: 'Tether', sub: 'BEP20', asset: 'Tether (USDT)', mark: 'usdt' }
  ];

  var dialog = null, panel = null, detail = null, srStatus = null, closeBtn = null;
  var methodBtns = [];
  var selected = 'donito';
  var built = false;
  var qrMarkup = '';
  var copyTimer = 0;

  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function mark(markup, cls) {
    var n = mk('span', cls);
    n.innerHTML = markup;
    return n;
  }
  function methodByKey(key) {
    for (var i = 0; i < METHODS.length; i++) if (METHODS[i].key === key) return METHODS[i];
    return METHODS[0];
  }
  function selectedIndex() {
    for (var i = 0; i < methodBtns.length; i++) if (methodBtns[i].getAttribute('aria-checked') === 'true') return i;
    return 0;
  }

  /* One QR for the shared address: white modules on a black field with a
     four-module quiet zone, drawn as a single vector path so it stays crisp at
     any size. The gold frame sits outside the quiet zone and never overlaps a
     module. Both assets render their own copy under their own label. */
  function buildQr() {
    if (qrMarkup) return qrMarkup;
    var q = window.qrcode(0, 'M');
    q.addData(ADDRESS, 'Byte');
    q.make();
    var n = q.getModuleCount(), quiet = 4, size = n + quiet * 2, path = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (q.isDark(r, c)) path += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
      }
    }
    qrMarkup = '<svg viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-hidden="true" focusable="false">' +
      '<rect width="' + size + '" height="' + size + '" fill="#000000"/>' +
      '<path d="' + path + '" fill="#ffffff"/></svg>';
    return qrMarkup;
  }

  function renderDonito() {
    var view = mk('div', 'void-support__view void-support__donito');
    view.appendChild(mk('p', 'void-support__lede', 'Support Void in Iranian Rial through Donito’s secure online payment page.'));
    var cta = mk('a', 'void-support__cta');
    cta.href = DONITO_URL;
    cta.target = '_blank';
    cta.rel = 'noopener noreferrer';
    cta.appendChild(mark(SVG.external));
    cta.appendChild(document.createTextNode('Open Donito'));
    view.appendChild(cta);
    view.appendChild(mk('p', 'void-support__hint', 'Opens donito.me in a new tab.'));
    return view;
  }

  function renderCrypto(m) {
    var view = mk('div', 'void-support__view void-support__crypto');

    var asset = mk('div', 'void-support__asset');
    asset.appendChild(mark(SVG[m.mark], 'void-support__asset-icon'));
    var atext = mk('div', 'void-support__asset-text');
    atext.appendChild(mk('span', 'void-support__asset-name', m.asset));
    var net = mk('span', 'void-support__network');
    net.appendChild(mark(SVG.network));
    net.appendChild(document.createTextNode(NETWORK));
    atext.appendChild(net);
    asset.appendChild(atext);
    view.appendChild(asset);

    var frame = mk('div', 'void-support__qr-frame');
    var qr = mk('div', 'void-support__qr');
    qr.setAttribute('role', 'img');
    qr.setAttribute('aria-label', 'QR code: ' + m.asset + ' deposit address on ' + NETWORK);
    qr.innerHTML = buildQr();
    frame.appendChild(qr);
    view.appendChild(frame);

    var block = mk('div', 'void-support__addr-block');
    block.appendChild(mk('span', 'void-support__addr-label', 'Deposit address'));
    var row = mk('div', 'void-support__addr-row');
    row.appendChild(mk('code', 'void-support__addr', ADDRESS));
    var copy = mk('button', 'void-support__copy');
    copy.type = 'button';
    copy.setAttribute('aria-label', 'Copy ' + m.asset + ' deposit address');
    var copyIcon = mark(SVG.copy);
    var copyLabel = mk('span', 'void-support__copy-label', 'Copy');
    copy.appendChild(copyIcon);
    copy.appendChild(copyLabel);
    row.appendChild(copy);
    block.appendChild(row);
    var status = mk('span', 'void-support__copied');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    block.appendChild(status);
    view.appendChild(block);

    copy.addEventListener('click', function () { copyAddress(copy, copyIcon, copyLabel, status); });

    var warn = mk('p', 'void-support__warn');
    warn.appendChild(mark(SVG.warn));
    warn.appendChild(mk('span', null, WARNING));
    view.appendChild(warn);
    return view;
  }

  function renderDetail() {
    detail.textContent = '';
    var m = methodByKey(selected);
    detail.appendChild(m.key === 'donito' ? renderDonito() : renderCrypto(m));
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { ta.setSelectionRange(0, text.length); } catch (e) {}
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copyAddress(btn, iconEl, labelEl, statusEl) {
    clearTimeout(copyTimer);
    function finish(ok) {
      btn.classList.toggle('is-copied', ok);
      iconEl.innerHTML = ok ? SVG.copied : SVG.copy;
      labelEl.textContent = ok ? 'Copied' : 'Copy';
      statusEl.classList.toggle('is-error', !ok);
      statusEl.classList.add('is-on');
      statusEl.textContent = ok ? 'Address copied' : 'Copy failed — select the address above manually.';
      copyTimer = setTimeout(function () {
        btn.classList.remove('is-copied');
        iconEl.innerHTML = SVG.copy;
        labelEl.textContent = 'Copy';
        statusEl.classList.remove('is-on', 'is-error');
        statusEl.textContent = '';
      }, 2200);
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
      navigator.clipboard.writeText(ADDRESS).then(function () { finish(true); }, function () { finish(legacyCopy(ADDRESS)); });
    } else {
      finish(legacyCopy(ADDRESS));
    }
  }

  function select(key, moveFocus) {
    selected = key;
    for (var i = 0; i < methodBtns.length; i++) {
      var on = methodBtns[i].getAttribute('data-method') === key;
      methodBtns[i].setAttribute('aria-checked', on ? 'true' : 'false');
      methodBtns[i].tabIndex = on ? 0 : -1;
      if (on && moveFocus) { try { methodBtns[i].focus({ preventScroll: true }); } catch (e) {} }
    }
    renderDetail();
    var m = methodByKey(key);
    srStatus.textContent = m.key === 'donito'
      ? 'Donito selected. Online payment in Iranian Rial.'
      : m.asset + ' selected. Network ' + NETWORK + '.';
  }

  var NAV_KEYS = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Home: 1, End: 1 };
  function navigate(key, active) {
    var i = methodBtns.indexOf(active);
    if (i < 0) i = selectedIndex();
    var n = methodBtns.length, next;
    if (key === 'ArrowRight' || key === 'ArrowDown') next = (i + 1) % n;
    else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (i - 1 + n) % n;
    else if (key === 'Home') next = 0;
    else next = n - 1;
    select(methodBtns[next].getAttribute('data-method'), true);
  }

  function findHost() {
    var root = document.getElementById('void-music-root');
    /* Music Mode active → root is visible and sweep-exempt: mount there. Player
       closed → root is hidden and no sweep runs: mount on body. */
    return (root && !root.hidden) ? root : document.body;
  }

  function build() {
    if (built) return;
    built = true;

    dialog = mk('dialog', 'void-support');
    dialog.id = 'void-support-modal';
    dialog.setAttribute('aria-labelledby', 'void-support-title');

    var sheen = mk('div', 'void-support__sheen');
    sheen.setAttribute('aria-hidden', 'true');

    panel = mk('div', 'void-support__panel');

    var head = mk('div', 'void-support__head');
    var titles = mk('div', 'void-support__titles');
    titles.appendChild(mk('span', 'void-support__eyebrow', 'Support'));
    var h = mk('h2', 'void-support__title', 'Support Void');
    h.id = 'void-support-title';
    titles.appendChild(h);
    closeBtn = mk('button', 'void-support__close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close support panel');
    head.appendChild(titles);
    head.appendChild(closeBtn);

    var group = mk('div', 'void-support__methods');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Support method');
    METHODS.forEach(function (m) {
      var b = mk('button', 'void-support__method');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('data-method', m.key);
      b.setAttribute('aria-checked', m.key === selected ? 'true' : 'false');
      b.tabIndex = m.key === selected ? 0 : -1;
      b.appendChild(mark(SVG[m.mark], 'void-support__method-icon'));
      b.appendChild(mk('span', 'void-support__method-name', m.name));
      b.appendChild(mk('span', 'void-support__method-sub', m.sub));
      b.addEventListener('click', function () { select(m.key, false); });
      group.appendChild(b);
      methodBtns.push(b);
    });

    detail = mk('div', 'void-support__detail');
    detail.id = 'void-support-detail';
    detail.setAttribute('role', 'region');
    detail.setAttribute('aria-label', 'Support details');

    srStatus = mk('span', 'void-support__sr');
    srStatus.setAttribute('role', 'status');
    srStatus.setAttribute('aria-live', 'polite');

    panel.appendChild(head);
    panel.appendChild(group);
    panel.appendChild(detail);
    panel.appendChild(srStatus);
    dialog.appendChild(sheen);
    dialog.appendChild(panel);

    closeBtn.addEventListener('click', close);
    dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    dialog.addEventListener('click', function (e) { if (e.target === dialog) close(); });
    /* The native close algorithm restores focus to the pre-showModal element
       before firing 'close'; focusing the icon here lands after that restore so
       the rail mark reliably regains focus however the panel was dismissed. */
    dialog.addEventListener('close', function () {
      icon.setAttribute('aria-expanded', 'false');
      try { icon.focus({ preventScroll: true }); } catch (e) {}
    });

    renderDetail();
  }

  function open() {
    build();
    var host = findHost();
    if (dialog.parentNode !== host) host.appendChild(dialog);
    if (!dialog.open) {
      try { dialog.showModal(); }
      catch (e) { dialog.setAttribute('open', ''); }
    }
    icon.setAttribute('aria-expanded', 'true');
    var b = methodBtns[selectedIndex()];
    if (b) { try { b.focus({ preventScroll: true }); } catch (e) {} }
  }

  function close() {
    if (!dialog || !dialog.open) return;
    try { dialog.close(); }
    catch (e) { dialog.removeAttribute('open'); }
    icon.setAttribute('aria-expanded', 'false');
    try { icon.focus({ preventScroll: true }); } catch (e) {}
  }

  icon.addEventListener('click', function (e) { e.preventDefault(); open(); });

  /* Capture-phase guard: option navigation runs before the player's document
     shortcuts, and playback keys never reach the player while the panel is
     open. Space stays live on buttons (their native activation); elsewhere it
     is swallowed so it cannot toggle playback. */
  var PLAYER_KEYS = { k: 1, m: 1, n: 1, p: 1, f: 1, w: 1, ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1 };
  window.addEventListener('keydown', function (e) {
    if (!dialog || !dialog.open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t0 = e.target;
    var inGroup = t0 && t0.classList && t0.classList.contains('void-support__method');
    if (inGroup && NAV_KEYS[e.key]) { e.preventDefault(); e.stopPropagation(); navigate(e.key, t0); return; }
    if (e.key === ' ' && !(t0 && t0.tagName === 'BUTTON')) { e.preventDefault(); e.stopPropagation(); return; }
    if (PLAYER_KEYS[e.key]) e.stopPropagation();
  }, true);
})();