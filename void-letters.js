/* Void Galaxy Music — «پیام‌های کهکشان».
   فاز ۲ رابط: کلیک روی ناحیهٔ کهکشان یک ستارهٔ موقت در همان نقطه می‌سازد و پیام
   را در یک پنل شیشه‌ای نشان می‌دهد؛ Copy/Share دارد و با کلیک دوبارهٔ ستاره یا
   Escape بسته می‌شود. ویژوالایزر، شیدر و منطق پخش دست‌نخورده‌اند: این ماژول هیچ
   ستاره‌ای به آرایهٔ ویژوالایزر اضافه نمی‌کند و هیچ درخواست شبکه‌ای نمی‌فرستد.
   پیام‌ها در این مرحله فقط از مجموعهٔ آزمایشیِ محلی می‌آیند؛ هیچ نوشتن/ثبتِ
   واقعی وجود ندارد و دکمهٔ X تا تأیید موفقیت واقعیِ ثبت غیرفعال است. */
(function () {
  'use strict';

  var MAX_POINTS = 500;
  var PLAYER_KEYS = { ' ': 1, k: 1, m: 1, n: 1, p: 1, f: 1, w: 1, ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1 };

  /* مجموعهٔ آزمایشی: متن‌های ثابت و واضحاً نمونه. هیچ‌کدام از کاربران واقعی نیستند
     و هیچ‌جا ذخیره نمی‌شوند. لایهٔ داده همان جایی است که فاز بک‌اند جایگزین می‌شود. */
  var DEMO_MESSAGES = [
    { id: 'demo-fa-1', lang: 'fa', text: 'به این کهکشان خوش آمدی. این پیام فقط یک نمونه است؛ ستاره‌ها هنوز نامهٔ واقعی کسی را نگه نمی‌دارند. ✨' },
    { id: 'demo-en-1', lang: 'en', text: 'Some nights the void answers back. Tonight it only says: keep a little wonder for later. 🌌' },
    { id: 'demo-fa-2', lang: 'fa', text: 'اگر جایی گم شدی، نگران نباش؛ گم‌شدن هم بخشی از سفر است. این یک پیام نمونه برای دیدنِ پنل است و ذخیره نمی‌شود.' },
    { id: 'demo-ja-1', lang: 'ja', text: '夜の銀河で、あなたの言葉を待っています。これはサンプルのメッセージです。' },
    { id: 'demo-ar-1', lang: 'ar', text: 'النجوم لا تسأل من أنت؛ فقط تستمع. هذه رسالة تجريبية ولا تُحفظ.' },
    { id: 'demo-en-2', lang: 'en', text: 'This is a longer sample so the panel has something to scroll: a handful of lines about light that takes years to arrive, about messages nobody may ever read, and about the quiet comfort of leaving something behind anyway. Nothing here is real, sent, stored, or shared unless you choose to share it yourself.' },
    { id: 'demo-emoji-1', text: '🌠 · ☾ · 🤍 · ✨' }
  ];

  /* متن ثابتِ اشتراک‌گذاری در X — هرگز متن نامه در آن نیست. */
  var X_SHARE_TEXT = 'I left a star in the galaxy. \u2728\n\nMaybe one day, if you click around the galaxy, you\u2019ll find my message.\n\nDiscover Void Galaxy Music: https://minoodar.github.io/void-galaxy-music/';

  /* لایهٔ داده. در فاز بک‌اند فقط همین شیء عوض می‌شود: kind='api'، next() از
     پیام‌های واقعی انتخاب می‌کند و submit() نامه را می‌فرستد. */
  var source = {
    kind: 'demo',
    tag: 'Demo \u00b7 no real messages yet',
    next: nextDemo,
    submit: null                                      // در این مرحله هیچ POSTی وجود ندارد
  };

  var el = null;
  var num = null;
  var hideTimer = 0;
  var showFrame = 0;

  var quillBtn = null;
  var galaxyLayer = null;
  var insetProbeEl = null;

  var panel = null;
  var panelText = null;
  var panelTag = null;
  var panelMeta = null;
  var panelCopy = null;
  var panelShare = null;
  var panelFeedback = null;
  var panelOpen = false;
  var currentMessage = null;
  var starX = 0;
  var starY = 0;
  var anchor = null;
  var ashNodes = [];
  var closeTimer = 0;
  var feedbackTimer = 0;
  var relayoutTimer = 0;

  var compose = null;
  var composeForm = null;
  var composer = null;
  var countEl = null;
  var hintEl = null;
  var ackEl = null;
  var submitBtn = null;
  var noticeEl = null;
  var successEl = null;
  var xShareBtn = null;
  var published = false;
  var sending = false;
  var guardOn = false;
  var pool = [];
  var lastPickId = null;

  function findRoot() {
    try {
      if (window.VoidMusic && typeof window.VoidMusic.getRoot === 'function') {
        var r = window.VoidMusic.getRoot();
        if (r) return r;
      }
    } catch (e) {}
    return document.getElementById('void-music-root');
  }

  function make(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function isShownBox(n) {
    if (!n) return false;
    var cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = n.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  /* ---- نشانگرِ پیام‌های فعال (فقط API؛ در این فاز همیشه پنهان است) ---- */
  function buildBadge(host) {
    if (el) return;
    el = document.createElement('div');
    el.id = 'void-galaxy-messages';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('title', 'Galaxy messages');
    el.hidden = true;
    var dot = make('span', 'vm-gm-dot');
    dot.setAttribute('aria-hidden', 'true');
    num = make('span', 'vm-gm-n');
    el.appendChild(dot);
    el.appendChild(num);
    host.appendChild(el);
  }

  function hide() {
    if (!el) return false;
    clearTimeout(hideTimer);
    if (showFrame) { cancelAnimationFrame(showFrame); showFrame = 0; }
    el.classList.remove('is-on');
    hideTimer = setTimeout(function () {
      if (el && !el.classList.contains('is-on')) el.hidden = true;
    }, 420);
    return true;
  }

  function setCount(n) {
    if (!mount()) return false;
    clearTimeout(hideTimer);
    n = Math.floor(Number(n));
    if (!isFinite(n) || n < 1) return hide();          // صفر یا نامعتبر = هیچ‌چیز، نه «0»
    num.textContent = new Intl.NumberFormat('en-US').format(n);
    el.setAttribute('aria-label', 'Galaxy messages: ' + n + ' active');
    if (el.hidden) {
      el.hidden = false;
      if (showFrame) cancelAnimationFrame(showFrame);
      showFrame = requestAnimationFrame(function () {
        showFrame = 0;
        if (el && !el.hidden) el.classList.add('is-on');
      });
    }
    return true;
  }

  /* ---- شمارشِ نقطه‌های کد (نه واحدهای UTF-16) ---- */
  function codePoints(s) {
    return Array.from(s).length;
  }

  var BAD_CHARS = /[\u202A-\u202E\u2066-\u2069]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

  function updateState() {
    if (!composer) return;
    var text = composer.value;
    var n = codePoints(text);
    var over = n > MAX_POINTS;
    countEl.textContent = n + ' / ' + MAX_POINTS;
    countEl.classList.toggle('is-over', over);
    hintEl.textContent = over
      ? (n - MAX_POINTS) + (n - MAX_POINTS === 1 ? ' code point over the limit.' : ' code points over the limit.')
      : BAD_CHARS.test(text)
        ? 'Remove invisible formatting or control characters.'
        : '';
    var ok = !over && !BAD_CHARS.test(text) && text.trim().length > 0 && !!(ackEl && ackEl.checked);
    submitBtn.disabled = !ok || sending;
  }

  function restoreFocus(primary) {
    var target = primary && document.contains(primary) ? primary : quillBtn;
    if (target) { try { target.focus({ preventScroll: true }); } catch (e) {} }
  }

  /* ==================================================================
     لایهٔ کلیکِ کهکشان
     بومِ ویژوالایزر pointer-events:none است؛ این لایه یک سطحِ شفاف است که
     داخلِ #void-music-root و پیش از داک/گوشه/عنوان قرار می‌گیرد، پس هر کنترلِ
     تعاملی که بالای آن است کلیک خودش را می‌گیرد و لایه فقط فضای خالیِ کهکشان
     را می‌گیرد. نوارِ پایینِ پلیر و جعبهٔ عنوان از پاسخ مستثنا هستند.
     ================================================================== */
  function buildGalaxy(host) {
    if (galaxyLayer) return;
    galaxyLayer = make('div', 'void-god-galaxy');
    galaxyLayer.id = 'void-god-galaxy';
    galaxyLayer.setAttribute('aria-hidden', 'true');
    host.insertBefore(galaxyLayer, host.firstChild);
    galaxyLayer.addEventListener('click', function (e) {
      if (e.button !== 0) return;
      if (!isGalaxyPoint(e.clientX, e.clientY)) return;
      openMessageAt(e.clientX, e.clientY);
    });
  }

  function insets() {
    if (!insetProbeEl) {
      var host = findRoot();
      if (!host) return { t: 0, r: 0, b: 0, l: 0 };
      insetProbeEl = make('div');
      insetProbeEl.setAttribute('aria-hidden', 'true');
      insetProbeEl.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
      host.appendChild(insetProbeEl);
    }
    var cs = getComputedStyle(insetProbeEl);
    return {
      t: parseFloat(cs.paddingTop) || 0,
      r: parseFloat(cs.paddingRight) || 0,
      b: parseFloat(cs.paddingBottom) || 0,
      l: parseFloat(cs.paddingLeft) || 0
    };
  }

  function safeTop() {
    return 10 + insets().t;
  }

  /* کفِ ناحیهٔ آزاد: بالای داک (نه روی کنترل‌های پخش). */
  function safeBottom() {
    var limit = window.innerHeight - 10 - insets().b;
    var dockEl = document.querySelector('#void-music-root .vm-dock');
    if (dockEl) {
      var r = dockEl.getBoundingClientRect();
      if (r.height > 1 && r.top < limit) limit = r.top - 10;
    }
    return limit;
  }

  function isGalaxyPoint(x, y) {
    if (y > safeBottom()) return false;
    var meta = document.querySelector('#void-music-root .vm-meta');
    if (meta && isShownBox(meta)) {
      var r = meta.getBoundingClientRect();
      if (x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8) return false;
    }
    return true;
  }

  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function overlapArea(a, b) {
    var w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }

  /* کنترل‌هایی که ستاره/پنل نباید رویشان بنشیند. وزن ۱۰ کنترلِ تعاملی است
     (هرگز پوشانده نمی‌شود) و وزن ۱ اطلاعاتِ غیرتعاملی (عنوان/وضعیت) که فقط
     اگر جا باشد کنار گذاشته می‌شود. */
  function obstacleRects() {
    var out = [];
    function add(sel, pad, weight) {
      var nodes = document.querySelectorAll(sel);
      for (var k = 0; k < nodes.length; k++) {
        var n = nodes[k];
        if (!isShownBox(n)) continue;
        if (sel === '#void-golden-status' && n.getAttribute('aria-hidden') === 'true') continue;
        var cs = getComputedStyle(n);
        if (parseFloat(cs.opacity) < 0.05) continue;
        var r = n.getBoundingClientRect();
        out.push({
          left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad,
          weight: sel === '#void-golden-status' && !n.classList.contains('is-action') ? 1 : weight
        });
      }
    }
    add('#void-topnav .void-topnav__link', 10, 10);
    add('#void-god-quill', 10, 10);
    add('.vm-corner', 10, 10);
    add('#void-counter', 10, 10);
    add('#void-golden-status', 10, 10);
    add('#void-music-root .vm-meta', 8, 1);
    return out;
  }

  /* نوار وضعیت «Playing» بیرون از ریشه و روی پنل کشیده می‌شود، پس اگر پنل در
     باند افقی‌اش بنشیند متنِ بالای پنل زیرش گم می‌شود؛ تا جای ممکن پایین‌تر از آن
     قرار می‌گیرد. */
  function statusPillBand() {
    var pill = document.querySelector('#void-golden-status');
    if (!isShownBox(pill)) return null;
    if (pill.getAttribute('aria-hidden') === 'true') return null;
    if (pill.classList.contains('is-action')) return null;
    if (parseFloat(getComputedStyle(pill).opacity) < 0.05) return null;
    var r = pill.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top - 8, bottom: r.bottom + 8 };
  }

  function anchorPoint(x, y) {
    var R = 22, m = 8, top = safeTop(), bottom = safeBottom();
    var bx = clamp(x, m + R, window.innerWidth - m - R);
    var by = clamp(y, top + R, Math.max(top + R, bottom - R));
    var obs = obstacleRects();
    var offsets = [[0, 0], [-78, 0], [78, 0], [0, -78], [0, 78], [-78, -60], [78, 60], [0, -140], [0, 140], [78, -140], [-78, 140]];
    for (var i = 0; i < offsets.length; i++) {
      var cx = clamp(bx + offsets[i][0], m + R, window.innerWidth - m - R);
      var cy = clamp(by + offsets[i][1], top + R, Math.max(top + R, bottom - R));
      var rect = { left: cx - R, top: cy - R, right: cx + R, bottom: cy + R };
      var hit = false;
      for (var j = 0; j < obs.length; j++) if (overlaps(rect, obs[j])) { hit = true; break; }
      if (!hit) return { x: cx, y: cy };
    }
    return { x: bx, y: by };
  }

  function nextDemo() {
    if (!pool.length) pool = DEMO_MESSAGES.slice();
    var pick = null;
    for (var guard = 0; guard < 8 && pool.length; guard++) {
      var i = Math.floor(Math.random() * pool.length);
      pick = pool.splice(i, 1)[0];
      if (pick.id !== lastPickId || !pool.length) break;
      pool.push(pick);                                  // بی‌درنگ تکرار نشود
      pick = null;
    }
    if (!pick) pick = pool.pop() || DEMO_MESSAGES[0];
    lastPickId = pick.id;
    return pick;
  }

  /* ---- ستارهٔ موقت ---- */
  function buildAnchorAt(x, y) {
    anchor = make('button', 'void-god-anchor');
    anchor.id = 'void-god-anchor';
    anchor.type = 'button';
    anchor.title = 'Close this message';
    anchor.setAttribute('aria-label', 'Close this message');
    anchor.setAttribute('aria-controls', 'void-god-panel');
    anchor.setAttribute('aria-expanded', 'true');
    var glow = make('span', 'void-god-anchor__glow');
    glow.setAttribute('aria-hidden', 'true');
    var core = make('span', 'void-god-anchor__core');
    core.setAttribute('aria-hidden', 'true');
    anchor.appendChild(glow);
    anchor.appendChild(core);
    anchor.style.left = x + 'px';
    anchor.style.top = y + 'px';
    findRoot().appendChild(anchor);
    anchor.addEventListener('click', function (e) {
      e.stopPropagation();
      var byKeyboard = e.detail === 0;
      closePanel({ dissolve: true, focus: byKeyboard });
    });
  }

  function removeAnchorNow() {
    if (anchor && anchor.parentNode) anchor.parentNode.removeChild(anchor);
    anchor = null;
    var root = findRoot();
    if (root) {
      var dying = root.querySelectorAll('.void-god-anchor');
      for (var k = 0; k < dying.length; k++) if (dying[k].parentNode) dying[k].parentNode.removeChild(dying[k]);
    }
    for (var i = 0; i < ashNodes.length; i++) if (ashNodes[i].parentNode) ashNodes[i].parentNode.removeChild(ashNodes[i]);
    ashNodes = [];
    clearTimeout(closeTimer);
  }

  function spawnAsh(x, y) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var host = findRoot();
    if (!host) return;
    var ash = make('div', 'void-god-ash');
    ash.style.left = x + 'px';
    ash.style.top = y + 'px';
    ash.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 12; i++) {
      var bit = make('span');
      var a = Math.random() * Math.PI * 2;
      var d = 14 + Math.random() * 26;
      bit.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
      bit.style.setProperty('--dy', (Math.sin(a) * d).toFixed(1) + 'px');
      bit.style.setProperty('--d', (Math.random() * 0.12).toFixed(2) + 's');
      ash.appendChild(bit);
    }
    host.appendChild(ash);
    ashNodes.push(ash);
    setTimeout(function () {
      if (ash.parentNode) ash.parentNode.removeChild(ash);
      var idx = ashNodes.indexOf(ash);
      if (idx >= 0) ashNodes.splice(idx, 1);
    }, 760);
  }

  /* ---- پنل پیام ---- */
  function buildPanel(host) {
    panel = make('div', 'void-god-panel');
    panel.id = 'void-god-panel';
    panel.hidden = true;
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'void-god-panel-title');
    panel.setAttribute('aria-describedby', 'void-god-panel-text void-god-panel-meta');
    panel.setAttribute('aria-hidden', 'true');

    var head = make('div', 'void-god-head');
    var titles = make('div', 'void-god-titles');
    var h = make('h2', 'void-god-msg-title', 'A message from the galaxy');
    h.id = 'void-god-panel-title';
    panelTag = make('span', 'void-god-msg-tag', source.tag);
    panelTag.id = 'void-god-panel-tag';
    titles.appendChild(h);
    titles.appendChild(panelTag);
    var x = make('button', 'void-god-x', '\u00D7');
    x.type = 'button';
    x.id = 'void-god-panel-close';
    x.setAttribute('aria-label', 'Close message');
    head.appendChild(titles);
    head.appendChild(x);

    panelText = make('p', 'void-god-msg-text');
    panelText.id = 'void-god-panel-text';
    panelText.setAttribute('dir', 'auto');

    panelMeta = make('p', 'void-god-msg-meta');
    panelMeta.id = 'void-god-panel-meta';

    var actions = make('div', 'void-god-panel__actions');
    panelCopy = make('button', 'void-god-btn', 'Copy');
    panelCopy.type = 'button';
    panelCopy.id = 'void-god-copy';
    panelShare = make('button', 'void-god-btn', 'Share');
    panelShare.type = 'button';
    panelShare.id = 'void-god-share';
    actions.appendChild(panelCopy);
    actions.appendChild(panelShare);

    panelFeedback = make('p', 'void-god-panel__status');
    panelFeedback.id = 'void-god-copy-status';
    panelFeedback.setAttribute('role', 'status');
    panelFeedback.setAttribute('aria-live', 'polite');
    panelFeedback.hidden = true;

    panel.appendChild(head);
    panel.appendChild(panelText);
    panel.appendChild(panelMeta);
    panel.appendChild(actions);
    panel.appendChild(panelFeedback);
    host.appendChild(panel);

    x.addEventListener('click', function () {
      closePanel({ dissolve: true, focus: true });
    });
    panelCopy.addEventListener('click', onCopy);
    panelShare.addEventListener('click', onShare);
  }

  function renderMessage(msg) {
    panelText.textContent = msg.text;
    if (msg.lang) panelText.setAttribute('lang', msg.lang);
    else panelText.removeAttribute('lang');
    panelTag.textContent = source.tag;
    panelMeta.textContent = 'Sample message from the local demo set \u2014 no real messages have arrived yet. Nothing is sent or stored.';
    clearTimeout(feedbackTimer);
    panelFeedback.hidden = true;
    panelFeedback.textContent = '';
    panelCopy.textContent = 'Copy';
    var canShare = !!(navigator.share && typeof navigator.share === 'function');
    panelShare.disabled = false;
    panelShare.title = canShare
      ? 'Share this message'
      : 'Sharing is not available in this browser \u2014 the message will be copied instead';
    panelShare.setAttribute('aria-label', canShare
      ? 'Share this message'
      : 'Share unavailable \u2014 copy the message instead');
  }

  function layoutPanel(x, y, focus) {
    var top = safeTop();
    var bottom = safeBottom();
    panel.hidden = false;
    panel.classList.remove('is-on');
    panel.style.left = '0px';
    panel.style.top = '0px';
    var cap = Math.min(380, window.innerHeight * 0.56, Math.max(120, bottom - top));
    var W = panel.offsetWidth;
    var R = 24, m = 12, gap = 26;
    var starRect = { left: x - R, top: y - R, right: x + R, bottom: y + R };
    var obs = obstacleRects();
    var pill = statusPillBand();
    var maxLeft = Math.max(m, window.innerWidth - m - W);
    /* Try the natural height first; when the panel cannot sit clear of the site
       column/status pill at that height, shrink it (it scrolls internally) until
       a placement with no interactive-control overlap exists and the temporary
       star stays visible. The play dock is excluded by safeBottom() and never
       covered. */
    function better(a, b) {
      if (!b) return true;
      if (a.hard !== b.hard) return a.hard < b.hard;
      if (a.star !== b.star) return a.star < b.star;
      if (a.pill !== b.pill) return a.pill < b.pill;
      if (a.info !== b.info) return a.info < b.info;
      return a.score < b.score;
    }
    var chosen = null, chosenRank = null;
    for (var f = 1; f >= 0.3; f -= 0.05) {
      var capH = Math.max(120, Math.round(cap * f));
      panel.style.maxHeight = capH + 'px';
      var H = Math.min(panel.offsetHeight, capH);
      var cands = [
        { left: x + gap, top: y - H / 2 },
        { left: x - gap - W, top: y - H / 2 },
        { left: x - W / 2, top: y + gap },
        { left: x - W / 2, top: y - gap - H }
      ];
      var best = null, bestRank = null;
      for (var i = 0; i < cands.length; i++) {
        var left = clamp(cands[i].left, m, maxLeft);
        var topY = clamp(cands[i].top, top, Math.max(top, bottom - H));
        /* slide down out of the status-pill band when the safe area allows it */
        if (pill && left < pill.right && left + W > pill.left &&
            topY < pill.bottom && topY + H > pill.top) {
          var slid = Math.min(pill.bottom, Math.max(top, bottom - H));
          if (slid > topY) topY = slid;
        }
        var rect = { left: left, top: topY, right: left + W, bottom: topY + H };
        var hard = 0, info = 0;
        for (var j = 0; j < obs.length; j++) {
          var area = overlapArea(rect, obs[j]);
          if (obs[j].weight >= 10) hard += area;
          else info += area;
        }
        var starArea = overlapArea(rect, starRect);
        var rank = {
          hard: hard,
          star: starArea,
          pill: pill ? overlapArea(rect, pill) : 0,
          info: info,
          score: info + starArea * 4 +
            (Math.abs(left - cands[i].left) + Math.abs(topY - cands[i].top)) * 2
        };
        if (better(rank, bestRank)) { bestRank = rank; best = rect; }
      }
      if (!best) {
        best = { left: m, top: top, right: m + W, bottom: top + H };
        bestRank = { hard: 0, star: 0, pill: 0, info: 0, score: 0 };
      }
      if (bestRank.hard <= 0 && bestRank.star <= 0 && bestRank.pill <= 0) {
        chosen = best; chosenRank = bestRank; break;
      }
      if (better(bestRank, chosenRank)) { chosen = best; chosenRank = bestRank; }
    }
    if (!chosen) chosen = { left: m, top: top, right: m + W, bottom: top + cap };
    panel.style.maxHeight = Math.round(chosen.bottom - chosen.top) + 'px';
    panel.style.left = chosen.left + 'px';
    panel.style.top = chosen.top + 'px';
    panel.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () {
      if (panelOpen) panel.classList.add('is-on');
    });
    if (focus) { try { panel.focus({ preventScroll: true }); } catch (e) {} }
  }

  function openMessageAt(x, y) {
    if (!ensureMounted()) return;
    clearScene();
    var msg = source.next();
    if (!msg) return;
    currentMessage = msg;
    panelOpen = true;
    renderMessage(msg);
    var p = anchorPoint(x, y);
    starX = p.x;
    starY = p.y;
    buildAnchorAt(starX, starY);
    layoutPanel(starX, starY, true);
  }

  function hidePanelNow() {
    panelOpen = false;
    if (!panel) return;
    panel.classList.remove('is-on');
    panel.setAttribute('aria-hidden', 'true');
    panel.hidden = true;
    clearTimeout(closeTimer);
  }

  function closePanel(opts) {
    opts = opts || {};
    if (!panelOpen) return;
    panelOpen = false;
    currentMessage = null;
    panel.classList.remove('is-on');
    panel.setAttribute('aria-hidden', 'true');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      if (!panelOpen && panel) panel.hidden = true;
    }, 180);
    if (opts.dissolve && anchor) {
      var ax = starX, ay = starY;
      var dying = anchor;
      dying.classList.add('is-closing');
      dying.setAttribute('aria-expanded', 'false');
      spawnAsh(ax, ay);
      anchor = null;
      setTimeout(function () {
        if (dying.parentNode) dying.parentNode.removeChild(dying);
      }, 520);
    } else {
      removeAnchorNow();
    }
    if (opts.focus) restoreFocus(quillBtn);
  }

  function clearScene() {
    hidePanelNow();
    removeAnchorNow();
    currentMessage = null;
  }

  function relayout() {
    if (!panelOpen) return;
    var p = anchorPoint(starX, starY);
    starX = p.x;
    starY = p.y;
    if (anchor) {
      anchor.style.left = starX + 'px';
      anchor.style.top = starY + 'px';
    }
    layoutPanel(starX, starY, false);
  }

  /* ---- کپی و اشتراک‌گذاری ---- */
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
    document.body.appendChild(ta);
    var ok = false;
    try { ta.select(); ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function feedback(label, copied) {
    if (!panelFeedback) return;
    clearTimeout(feedbackTimer);
    panelFeedback.textContent = label;
    panelFeedback.hidden = false;
    panelCopy.textContent = copied ? 'Copied' : 'Copy';
    feedbackTimer = setTimeout(function () {
      if (!panelFeedback) return;
      panelFeedback.hidden = true;
      panelFeedback.textContent = '';
      panelCopy.textContent = 'Copy';
    }, 2200);
  }

  function onCopy() {
    if (!currentMessage) return;
    var text = currentMessage.text;
    copyText(text).then(function () {
      feedback('Copied to clipboard.', true);
    }, function () {
      feedback('Could not copy automatically \u2014 select the message text and copy it.', false);
    });
  }

  function onShare() {
    if (!currentMessage) return;
    var msg = currentMessage;
    if (!navigator.share) { shareFallback(msg); return; }
    var payload = { title: 'A message from the Void Galaxy', text: msg.text };
    navigator.share(payload).then(function () {
      feedback('Shared.', false);
    }, function (err) {
      if (err && err.name === 'AbortError') return;      // لغوِ کاربر خطا نیست
      shareFallback(msg);
    });
  }

  function shareFallback(msg) {
    copyText(msg.text).then(function () {
      feedback('Sharing is unavailable \u2014 the message was copied instead.', true);
    }, function () {
      feedback('Could not share or copy \u2014 select the message text and copy it.', false);
    });
  }

  /* ==================================================================
     پنجرهٔ نوشتنِ نامه + مسیر آمادهٔ ثبت و اشتراک در X
     هیچ بک‌اندی وجود ندارد: submit جا ندارد، پس هیچ موفقیتی هم ساخته
     نمی‌شود. onPublished فقط از پاسخِ واقعیِ source.submit صدا زده می‌شود.
     ================================================================== */
  function closeCompose() {
    if (!compose || !compose.open) return;
    compose.close();
    if (quillBtn) quillBtn.setAttribute('aria-expanded', 'false');
    restoreFocus(quillBtn);
  }

  function openCompose() {
    closePanel({ dissolve: false, focus: false });
    try {
      if (window.VoidMusic && typeof window.VoidMusic.enter === 'function' &&
          (!window.VoidMusic.isOpen || !window.VoidMusic.isOpen())) window.VoidMusic.enter();
    } catch (e) {}
    if (!ensureMounted()) return;
    if (compose.open) return;
    composeForm.classList.remove('is-published');
    successEl.hidden = true;
    xShareBtn.disabled = true;
    published = false;
    sending = false;
    ackEl.checked = false;
    noticeEl.hidden = true;
    noticeEl.textContent = '';
    updateState();
    try { compose.showModal(); }
    catch (e) { compose.setAttribute('open', ''); }
    if (quillBtn) quillBtn.setAttribute('aria-expanded', 'true');
    try { composer.focus({ preventScroll: true }); } catch (e) {}
  }

  function buildCompose(host) {
    compose = make('dialog', 'void-god-dialog');
    compose.id = 'void-god-dialog';
    compose.setAttribute('aria-labelledby', 'void-god-title');
    compose.setAttribute('aria-describedby', 'void-god-intro void-god-demo');

    composeForm = make('form', 'void-god-form');
    composeForm.setAttribute('novalidate', '');

    var head = make('div', 'void-god-head');
    var titles = make('div', 'void-god-titles');
    var h = make('h2', 'void-god-title', 'Message to God');
    h.id = 'void-god-title';
    var fa = make('span', 'void-god-title-fa', 'نامه به خدا');
    fa.lang = 'fa';
    fa.dir = 'rtl';
    titles.appendChild(h);
    titles.appendChild(fa);
    var x = make('button', 'void-god-x', '\u00D7');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close without submitting');
    head.appendChild(titles);
    head.appendChild(x);

    var intro = make('p', 'void-god-intro',
      'A letter becomes a small star in the galaxy: anonymous, public, and temporary. Write with care \u2014 once it leaves, it cannot be taken back.');
    intro.id = 'void-god-intro';

    var demo = make('p', 'void-god-demo', 'Local preview only \u2014 this phase does not send or store anything. X sharing stays locked until real publishing exists.');
    demo.id = 'void-god-demo';

    var label = make('label', 'void-god-label', 'Your letter');
    label.setAttribute('for', 'void-god-text');

    composer = make('textarea', 'void-god-text');
    composer.id = 'void-god-text';
    composer.setAttribute('rows', '6');
    composer.setAttribute('dir', 'auto');
    composer.setAttribute('placeholder', 'Write a few lines\u2026');
    composer.setAttribute('spellcheck', 'true');
    composer.setAttribute('autocomplete', 'off');
    composer.setAttribute('aria-describedby', 'void-god-count void-god-hint');

    var meta = make('div', 'void-god-count-row');
    countEl = make('span', 'void-god-count', '0 / 500');
    countEl.id = 'void-god-count';
    hintEl = make('span', 'void-god-hint', '');
    hintEl.id = 'void-god-hint';
    hintEl.setAttribute('aria-live', 'polite');
    meta.appendChild(countEl);
    meta.appendChild(hintEl);

    var fs = make('fieldset', 'void-god-exp');
    fs.appendChild(make('legend', 'void-god-legend', 'Fades after'));
    var row = make('div', 'void-god-exp-row');
    var opts = [['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days']];
    for (var i = 0; i < opts.length; i++) {
      var opt = make('label', 'void-god-exp-opt');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'void-god-expiry';
      radio.value = opts[i][0];
      radio.checked = opts[i][0] === '7d';
      opt.appendChild(radio);
      opt.appendChild(make('span', '', opts[i][1]));
      row.appendChild(opt);
    }
    fs.appendChild(row);

    var ackLab = make('label', 'void-god-ack');
    ackEl = document.createElement('input');
    ackEl.type = 'checkbox';
    ackEl.id = 'void-god-ack';
    ackLab.appendChild(ackEl);
    ackLab.appendChild(make('span', '',
      'I understand letters are anonymous and public, cannot be edited or deleted after submission, and may be seen or saved before they expire.'));

    noticeEl = make('p', 'void-god-notice');
    noticeEl.id = 'void-god-notice';
    noticeEl.setAttribute('role', 'status');
    noticeEl.hidden = true;

    var foot = make('div', 'void-god-foot');
    var cancel = make('button', 'void-god-btn', 'Cancel');
    cancel.type = 'button';
    submitBtn = make('button', 'void-god-btn void-god-btn--primary', 'Submit letter');
    submitBtn.type = 'submit';
    submitBtn.disabled = true;
    foot.appendChild(cancel);
    foot.appendChild(submitBtn);

    /* نمای موفقیت: فقط پس از پاسخِ واقعیِ ثبت آشکار می‌شود. */
    successEl = make('div', 'void-god-published');
    successEl.id = 'void-god-published';
    successEl.hidden = true;
    successEl.tabIndex = -1;
    successEl.setAttribute('role', 'status');
    successEl.appendChild(make('p', 'void-god-published__title', 'Your letter is in the galaxy'));
    successEl.appendChild(make('p', 'void-god-published__note',
      'It will fade after 7 days. Sharing on X is optional and never includes your letter text.'));
    var okFoot = make('div', 'void-god-foot');
    xShareBtn = make('button', 'void-god-btn', 'Share on X');
    xShareBtn.type = 'button';
    xShareBtn.id = 'void-god-x-share';
    xShareBtn.disabled = true;
    xShareBtn.title = 'Available after your letter is published';
    var done = make('button', 'void-god-btn void-god-btn--primary', 'Done');
    done.type = 'button';
    okFoot.appendChild(xShareBtn);
    okFoot.appendChild(done);
    successEl.appendChild(okFoot);

    composeForm.appendChild(head);
    composeForm.appendChild(intro);
    composeForm.appendChild(demo);
    composeForm.appendChild(label);
    composeForm.appendChild(composer);
    composeForm.appendChild(meta);
    composeForm.appendChild(fs);
    composeForm.appendChild(ackLab);
    composeForm.appendChild(noticeEl);
    composeForm.appendChild(foot);
    composeForm.appendChild(successEl);
    compose.appendChild(composeForm);
    host.appendChild(compose);

    composer.addEventListener('input', updateState);
    ackEl.addEventListener('change', updateState);
    x.addEventListener('click', closeCompose);
    cancel.addEventListener('click', closeCompose);
    done.addEventListener('click', closeCompose);
    xShareBtn.addEventListener('click', onShareX);
    compose.addEventListener('cancel', function (e) {
      e.preventDefault();
      closeCompose();
    });
    /* Backdrop clicks deliberately do not close the composer: an accidental click
       must not discard a draft. Cancel and the close button are the exits. */
    composeForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submitBtn.disabled || sending) return;
      if (typeof source.submit !== 'function') {
        noticeEl.textContent = 'Publication will be enabled in a later phase. Nothing was sent or stored \u2014 this is a local preview.';
        noticeEl.hidden = false;
        return;
      }
      submitLetter();
    });
  }

  function currentExpiry() {
    var checked = composeForm && composeForm.querySelector('input[name="void-god-expiry"]:checked');
    return checked ? checked.value : '7d';
  }

  function submitLetter() {
    if (sending || typeof source.submit !== 'function') return;
    sending = true;
    updateState();
    noticeEl.hidden = true;
    var payload = { text: composer.value, expiry: currentExpiry() };
    source.submit(payload).then(function (result) {
      sending = false;
      updateState();
      if (!result || result.ok !== true || !result.id) { onPublishError(); return; }
      onPublished(result);
    }, function () {
      sending = false;
      updateState();
      onPublishError();
    });
  }

  function onPublished() {
    published = true;
    xShareBtn.disabled = false;
    xShareBtn.title = 'Share the galaxy on X';
    xShareBtn.setAttribute('aria-label', 'Share on X');
    composeForm.classList.add('is-published');
    successEl.hidden = false;
    noticeEl.hidden = true;
    try { successEl.focus({ preventScroll: true }); } catch (e) {}
  }

  function onPublishError() {
    published = false;
    xShareBtn.disabled = true;
    noticeEl.textContent = 'Could not publish your letter. Nothing was sent or stored \u2014 please try again.';
    noticeEl.hidden = false;
  }

  /* اشتراک در X: فقط با اقدام صریحِ کاربر و فقط پس از ثبت واقعی. متنِ ثابت است
     و هرگز متن نامه را در بر نمی‌گیرد. */
  function onShareX() {
    if (!published) return;
    var url = 'https://x.com/intent/post?text=' + encodeURIComponent(X_SHARE_TEXT);
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) {}
  }

  /* ---- دکمهٔ قلم ---- */
  function svgNode(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function buildQuill(host) {
    quillBtn = make('button', 'void-god-quill');
    quillBtn.id = 'void-god-quill';
    quillBtn.type = 'button';
    quillBtn.setAttribute('aria-label', 'Message to God');
    quillBtn.setAttribute('title', 'Message to God');
    quillBtn.setAttribute('aria-haspopup', 'dialog');
    quillBtn.setAttribute('aria-expanded', 'false');
    quillBtn.setAttribute('aria-controls', 'void-god-dialog');
    var svg = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    svg.appendChild(svgNode('path', { d: 'M21 3c0 7.8-4.7 12.5-12.5 12.5H7.1L4.8 19.8' }));
    svg.appendChild(svgNode('path', { d: 'M17.2 3.4c-1.3 5-4.3 8-9.3 9.3' }));
    svg.appendChild(svgNode('path', { d: 'M12.4 4.9c-.4 2.9-1.5 5-3.6 6.9' }));
    quillBtn.appendChild(svg);
    host.appendChild(quillBtn);
    quillBtn.addEventListener('click', openCompose);
  }

  function buildUi(host) {
    if (compose) return;
    buildQuill(host);
    buildGalaxy(host);
    buildPanel(host);
    buildCompose(host);
  }

  function onGuardKey(e) {
    var open = (compose && compose.open) || panelOpen;
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (compose && compose.open) closeCompose();
      else closePanel({ dissolve: true, focus: true });
      return;
    }
    /* Let the dialog own arrows/space (radios, buttons); only keep the player's
       document-capture shortcuts from firing underneath the open surface. */
    if (!e.ctrlKey && !e.metaKey && !e.altKey && PLAYER_KEYS[e.key]) e.stopPropagation();
  }

  function bindKeys() {
    if (guardOn) return;
    guardOn = true;
    window.addEventListener('keydown', onGuardKey, true);
    window.addEventListener('resize', function () {
      clearTimeout(relayoutTimer);
      relayoutTimer = setTimeout(relayout, 90);
    });
    window.addEventListener('voidmusic:mode', function (e) {
      if (e && e.detail && e.detail.open === false) clearScene();
    });
  }

  function ensureMounted() {
    if (compose) return true;
    var host = findRoot();
    if (!host) return false;
    buildBadge(host);
    buildUi(host);
    return true;
  }

  function mount() {
    if (el) return true;
    var host = findRoot();
    if (!host) return false;
    buildBadge(host);
    buildUi(host);
    return true;
  }

  function start() {
    bindKeys();
    if (mount()) return;
    var tries = 0;
    (function retry() {
      if (mount() || ++tries > 120) return;            // ~۲ ثانیه صبر برای ساختِ ریشهٔ پلیر
      setTimeout(retry, 16);
    })();
  }

  window.VoidLetters = { setCount: setCount, hide: hide };

  if (document.readyState === 'complete') requestAnimationFrame(start);
  else window.addEventListener('load', function () { requestAnimationFrame(start); }, { once: true });
})();
