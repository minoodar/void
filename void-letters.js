/* Void — «پیام‌های کهکشان».
   کلیک روی ناحیهٔ کهکشان یک ستارهٔ موقت در همان نقطه می‌سازد و نامه را در یک
   پنل شیشه‌ای نشان می‌دهد؛ Copy/Share on X دارد و با کلیک دوبارهٔ ستاره یا Escape
   بسته می‌شود. ویژوالایزر، شیدر و منطق پخش دست‌نخورده‌اند: این ماژول هیچ
   ستاره‌ای به آرایهٔ ویژوالایزر اضافه نمی‌کند. منبع داده و ثبتِ نامه از
   void-letters-api.js می‌آید. مجموعهٔ آزمایشی فقط با
   window.VoidLettersDevDemo === true فعال می‌شود و پیش‌فرض خاموش است. */
(function () {
  'use strict';

  var MAX_POINTS = 500;
  var DAY_SEC = 86400;
  var MAX_LIFETIME_SEC = 7776000;
  var MIN_REMAINING_SEC = 3600;
  var VOTES_KEY = 'voidLetters.votes.v1';
  var PLAYER_KEYS = { ' ': 1, k: 1, m: 1, n: 1, p: 1, f: 1, w: 1, ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1 };

  var api = window.VoidLettersApi || null;
  var DEV_DEMO = window.VoidLettersDevDemo === true;
  /* The Worker stores the language of the letter itself, not of the interface. */
  var ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  var LATIN_SCRIPT = /[A-Za-z\u00C0-\u024F]/;

  function detectLang(text) {
    if (ARABIC_SCRIPT.test(text)) return 'fa';
    if (LATIN_SCRIPT.test(text)) return 'en';
    return null;
  }

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
  var X_LETTER_TEXT = 'I left a star in the galaxy. \u2726 Read it before it fades:';
  var X_LETTER_TEXT_FA = '\u0633\u062a\u0627\u0631\u0647\u200c\u0627\u06cc \u062f\u0631 \u06a9\u0647\u06a9\u0634\u0627\u0646 \u062c\u0627 \u06af\u0630\u0627\u0634\u062a\u0645. \u2726 \u062a\u0627 \u0645\u062d\u0648 \u0646\u0634\u062f\u0647 \u0628\u062e\u0648\u0627\u0646\u06cc\u062f\u0634:';
  /* متنِ پنلِ خواندنِ نامهٔ دیگران؛ کوتاه می‌ماند تا با لینک زیرِ سقفِ ۲۸۰ کاراکترِ X
     جا شود. متنِ نامه هرگز در توییت نمی‌رود. */
  var X_PANEL_TEXT = 'A star is burning in the Void. \u2726 Read it before it fades:';
  var X_PANEL_TEXT_FA = '\u0633\u062a\u0627\u0631\u0647\u200c\u0627\u06cc \u062f\u0631 \u06a9\u0647\u06a9\u0634\u0627\u0646 \u0645\u06cc\u200c\u062f\u0631\u062e\u0634\u062f. \u2726 \u067e\u06cc\u0634 \u0627\u0632 \u0622\u0646\u06a9\u0647 \u0645\u062d\u0648 \u0634\u0648\u062f \u0628\u062e\u0648\u0627\u0646\u06cc\u062f\u0634:';
  var X_INTENT = 'https://twitter.com/intent/tweet?text=';
  var X_SHARE_COPY = {
    en: { panel: X_PANEL_TEXT, letter: X_LETTER_TEXT, likes: "Every like adds 24 hours to this message's life. Help keep it alive in the galaxy." },
    fa: { panel: X_PANEL_TEXT_FA, letter: X_LETTER_TEXT_FA, likes: 'هر لایک ۲۴ ساعت به عمر این پیام اضافه می‌کند. کمک کنید در کهکشان زنده بماند.' },
    ar: { panel: 'نجم يضيء في الفراغ. ✦ اقرأ الرسالة قبل أن تتلاشى:', letter: 'تركت نجمة في المجرة. ✦ اقرأها قبل أن تتلاشى:', likes: 'كل إعجاب يضيف ٢٤ ساعة إلى عمر هذه الرسالة. ساعد في إبقائها حية في المجرة.' },
    es: { panel: 'Una estrella brilla en el Vacío. ✦ Lee el mensaje antes de que se desvanezca:', letter: 'Dejé una estrella en la galaxia. ✦ Léela antes de que se desvanezca:', likes: 'Cada Me gusta añade 24 horas a la vida de este mensaje. Ayuda a mantenerlo vivo en la galaxia.' },
    fr: { panel: 'Une étoile brille dans le Vide. ✦ Lisez le message avant qu’il ne s’efface :', letter: 'J’ai laissé une étoile dans la galaxie. ✦ Lisez-la avant qu’elle ne s’efface :', likes: 'Chaque J’aime ajoute 24 heures à la vie de ce message. Aidez à le garder vivant dans la galaxie.' },
    de: { panel: 'Ein Stern leuchtet im Void. ✦ Lies die Nachricht, bevor sie verblasst:', letter: 'Ich habe einen Stern in der Galaxie hinterlassen. ✦ Lies ihn, bevor er verblasst:', likes: 'Jedes Like schenkt dieser Nachricht 24 Stunden mehr. Hilf, sie in der Galaxie am Leben zu halten.' },
    it: { panel: 'Una stella brilla nel Vuoto. ✦ Leggi il messaggio prima che svanisca:', letter: 'Ho lasciato una stella nella galassia. ✦ Leggila prima che svanisca:', likes: 'Ogni Mi piace aggiunge 24 ore alla vita di questo messaggio. Aiuta a mantenerlo vivo nella galassia.' },
    pt: { panel: 'Uma estrela brilha no Vazio. ✦ Leia a mensagem antes que desapareça:', letter: 'Deixei uma estrela na galáxia. ✦ Leia antes que desapareça:', likes: 'Cada curtida acrescenta 24 horas à vida desta mensagem. Ajude a mantê-la viva na galáxia.' },
    ru: { panel: 'В Пустоте горит звезда. ✦ Прочитайте послание, пока оно не исчезло:', letter: 'Я оставил звезду в галактике. ✦ Прочитайте её, пока она не исчезла:', likes: 'Каждый лайк добавляет этому сообщению 24 часа жизни. Помогите ему жить в галактике.' },
    ja: { panel: 'ヴォイドで星が輝いています。✦ 消える前にこのメッセージを読んでください：', letter: '銀河に星を残しました。✦ 消える前に読んでください：', likes: 'いいね1つにつき、このメッセージの寿命が24時間延びます。銀河で生き続けられるよう、力を貸してください。' },
    zh: { panel: '虚空中有一颗星星正在燃烧。✦ 趁它消逝前读读这条消息：', letter: '我在银河中留下一颗星。✦ 趁它消逝前读读它：', likes: '每个点赞都会为这条消息增加24小时寿命。帮它在银河中延续下去。' },
    ko: { panel: '공허 속에서 별이 빛나고 있어요. ✦ 사라지기 전에 이 메시지를 읽어 보세요:', letter: '은하에 별 하나를 남겼어요. ✦ 사라지기 전에 읽어 보세요:', likes: '좋아요 하나마다 이 메시지의 수명이 24시간 늘어납니다. 은하에서 계속 살아남도록 도와주세요.' }
  };
  var SHARE_WORDS = {
    ar: ['مرحبا', 'السلام', 'عليكم', 'هذا', 'هذه', 'في', 'على', 'كل', 'الرسالة', 'المجرة', 'رسالة', 'النجوم', 'انا', 'انت'],
    es: ['hola', 'mensaje', 'estrella', 'galaxia', 'ayuda', 'cada', 'vida', 'leer', 'antes', 'que', 'una', 'para'],
    fr: ['bonjour', 'message', 'etoile', 'galaxie', 'aidez', 'chaque', 'vie', 'lire', 'avant', 'une', 'pour'],
    de: ['hallo', 'nachricht', 'stern', 'galaxie', 'hilf', 'jedes', 'leben', 'lies', 'bevor', 'eine', 'und'],
    it: ['ciao', 'messaggio', 'stella', 'galassia', 'aiuta', 'ogni', 'vita', 'leggi', 'prima', 'una', 'che'],
    pt: ['ola', 'mensagem', 'estrela', 'galaxia', 'ajude', 'cada', 'vida', 'leia', 'antes', 'uma', 'que'],
    ru: ['привет', 'сообщение', 'звезда', 'галактике', 'помогите', 'каждый', 'жизни', 'прочитайте', 'пока', 'это']
  };

  function detectShareLang(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    var value = text.toLowerCase();
    var scriptWords = value.replace(/[،؛؟.!:;()«»"'…]/g, ' ').split(/\s+/);
    if (/[\u3040-\u30ff]/.test(value)) return 'ja';
    if (/[\uac00-\ud7af]/.test(value)) return 'ko';
    if (/[\u3400-\u9fff]/.test(value)) return 'zh';
    var faScore = 0;
    for (var f = 0; f < scriptWords.length; f++) if (['به', 'برای', 'این', 'است', 'که', 'را', 'یک', 'پیام', 'ستاره', 'کهکشان'].indexOf(scriptWords[f]) >= 0) faScore++;
    if (/[\u067e\u0686\u0698\u06af\u06a9\u06cc]/.test(value) || faScore >= 2) return 'fa';
    if (/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/.test(value)) {
      var arScore = 0;
      for (var a = 0; a < scriptWords.length; a++) if (SHARE_WORDS.ar.indexOf(scriptWords[a]) >= 0) arScore++;
      return arScore >= 2 || (arScore === 1 && scriptWords.length <= 4) ? 'ar' : null;
    }
    if (/[\u0400-\u04ff]/.test(value)) {
      var cyrillic = scriptWords.filter(function (word) { return /[\u0400-\u04ff]/.test(word); });
      var ruScore = 0;
      for (var c = 0; c < cyrillic.length; c++) if (SHARE_WORDS.ru.indexOf(cyrillic[c]) >= 0) ruScore++;
      return ruScore >= 2 || (ruScore === 1 && cyrillic.length <= 4) ? 'ru' : null;
    }
    var normalized = value.normalize ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : value;
    var words = normalized.match(/[a-z]+/g) || [];
    var best = null, bestScore = 0, nextScore = 0;
    Object.keys(SHARE_WORDS).filter(function (lang) { return lang !== 'ru'; }).forEach(function (lang) {
      var score = 0;
      for (var i = 0; i < words.length; i++) if (SHARE_WORDS[lang].indexOf(words[i]) >= 0) score++;
      if (score > bestScore) { nextScore = bestScore; bestScore = score; best = lang; }
      else if (score > nextScore) nextScore = score;
    });
    return best && bestScore >= 2 && bestScore > nextScore ? best : null;
  }

  function xShareText(text, kind) {
    var copy = X_SHARE_COPY[detectShareLang(text)] || X_SHARE_COPY.en;
    return (kind === 'letter' ? copy.letter : copy.panel) + ' ' + copy.likes;
  }

  /* لایهٔ داده. مسیر production از API واقعی می‌خواند؛ مجموعهٔ آزمایشی فقط با
     فلگ صریح توسعه فعال است و هرگز با دادهٔ production مخلوط نمی‌شود. */
  var source = DEV_DEMO
    ? {
        kind: 'demo',
        tag: 'Demo \u00b7 no real messages yet',
        next: nextDemo,
        submit: null
      }
    : {
        kind: 'api',
        tag: 'From the galaxy',
        next: nextRemote,
        submit: submitRemote
      };

  var el = null;
  var num = null;
  var hideTimer = 0;
  var showFrame = 0;
  var statsPanel = null;
  var statsRead = null;
  var statsOpen = false;
  var statsHoverTimer = 0;
  var pillShown = false;
  var visitorsN = null;
  var rowVisitors = null;
  var rowSessions = null;
  var rowReturned = null;
  var rowLetters = null;
  var letterTotal = null;
  var visitorsStarted = false;

  var quillBtn = null;
  var galaxyLayer = null;
  var insetProbeEl = null;

  var panel = null;
  var panelText = null;
  var panelTag = null;
  var panelMeta = null;
  var panelLifespan = null;
  var panelVotes = null;
  var panelLike = null;
  var panelDislike = null;
  var likeCount = null;
  var dislikeCount = null;
  var panelCopy = null;
  var panelShare = null;
  var panelFeedback = null;
  var panelPrevious = null;
  var panelNext = null;
  var lifespanTimer = 0;
  var voteBusy = false;
  var panelOpen = false;
  var panelClosing = false;
  var readerMusicSnapshot = null;
  var pendingMusicSnapshot = null;
  var pendingMusicSnapshotTimer = 0;
  var panelRequestToken = 0;
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
  var shareUrl = null;
  var publishedBase = '';
  var publishedLang = null;
  var sending = false;
  var guardOn = false;
  var pool = [];
  var lastPickId = null;
  var feed = null;
  var remoteStarted = false;
  var successTitle = null;
  var successNote = null;
  var cooldownTimer = 0;
  var cooldownUntil = 0;
  var discoveryBtn = null;
  var toolsHideTimer = 0;
  var toolsRevealed = false;
  var letterHistory = [];
  var historyIndex = -1;
  var uncertainSubmission = null;
  var connectionTimer = 0;

  function hideToolPalette() {
    clearTimeout(toolsHideTimer);
    toolsHideTimer = 0;
    toolsRevealed = false;
    if (document.body) document.body.classList.remove('is-tools-revealed');
    if (discoveryBtn) {
      discoveryBtn.setAttribute('aria-expanded', 'false');
      discoveryBtn.setAttribute('aria-label', 'Show tools; activate again to discover a letter');
      discoveryBtn.title = 'Show tools; activate again to discover a letter';
    }
  }

  function showToolPalette() {
    if (panelOpen || (compose && compose.open)) return;
    toolsRevealed = true;
    if (document.body) document.body.classList.add('is-tools-revealed');
    if (discoveryBtn) {
      discoveryBtn.setAttribute('aria-expanded', 'true');
      discoveryBtn.setAttribute('aria-label', 'Tools shown; activate again to discover a letter');
      discoveryBtn.title = 'Tools shown; activate again to discover a letter';
    }
    clearTimeout(toolsHideTimer);
    toolsHideTimer = setTimeout(function hideWhenIdle() {
      var nav = document.getElementById('void-topnav');
      var active = document.activeElement;
      if ((nav && active && nav.contains(active)) ||
          (discoveryBtn && active === discoveryBtn && discoveryBtn.matches(':focus-visible'))) {
        toolsHideTimer = setTimeout(hideWhenIdle, 1200);
        return;
      }
      hideToolPalette();
    }, 4200);
  }

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

  function setReadingMode(active) {
    if (document.body) {
      document.body.classList.toggle('is-reading', !!active);
      document.body.classList.toggle('is-letter-reading', !!active);
    }
  }

  function readMusicPresentation() {
    var root = document.getElementById('void-music-root');
    return {
      quiet: !!(root && root.classList.contains('is-quiet')),
      bodyQuiet: !!(document.body && document.body.classList.contains('vm-quiet')),
      clockLive: !!(root && root.classList.contains('vm-clock-live'))
    };
  }

  function rememberMusicPresentation() {
    if (panelOpen) return;
    pendingMusicSnapshot = readMusicPresentation();
    clearTimeout(pendingMusicSnapshotTimer);
    pendingMusicSnapshotTimer = setTimeout(function () {
      pendingMusicSnapshot = null;
      pendingMusicSnapshotTimer = 0;
    }, 1500);
  }

  function restoreMusicPresentation() {
    if (!readerMusicSnapshot) return;
    var root = document.getElementById('void-music-root');
    if (root) {
      root.classList.toggle('is-quiet', readerMusicSnapshot.quiet);
      root.classList.toggle('vm-clock-live', readerMusicSnapshot.clockLive);
    }
    if (document.body) document.body.classList.toggle('vm-quiet', readerMusicSnapshot.bodyQuiet);
    readerMusicSnapshot = null;
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

  /* ---- تبلتِ آمار کهکشان: بازدیدکننده‌ها و نامه‌ها -------------------------
     هر سه عدد بازدید از همان ورکرِ نامه‌ها می‌آید (/visitors/hit و
     /visitors/stats) و تعداد نامه‌ها از /letters/count. هیچ دامنهٔ دیگری
     فراخوانی نمی‌شود. */
  function fmt(n) {
    return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(Number(n) || 0)));
  }

  function positionStatsIndicator() {
    if (!el) return;
    var safeLeft = Math.max(8, insets().l);
    var safeTop = parseFloat(window.getComputedStyle(el).getPropertyValue('--void-gs-safe-top')) || 8;
    el.style.left = Math.round(safeLeft) + 'px';
    el.style.top = Math.round(safeTop) + 'px';
  }

  function statRow(label, value) {
    var row = make('div', 'vm-gs-row');
    var b = make('b', null, value);
    row.appendChild(b);
    row.appendChild(make('span', null, label));
    return { row: row, value: b };
  }

  function buildBadge(host) {
    if (el) return;
    el = document.createElement('button');
    el.id = 'void-galaxy-stats';
    el.className = 'vm-gs';
    el.type = 'button';
    el.hidden = true;
    el.setAttribute('aria-haspopup', 'dialog');
    el.setAttribute('aria-expanded', 'false');
    el.setAttribute('aria-controls', 'void-galaxy-stats-panel');
    el.setAttribute('aria-label', 'Galaxy statistics');
    el.setAttribute('title', 'Galaxy statistics');
    var people = make('span', 'vm-gs__fig');
    visitorsN = make('span', 'vm-gs__n', '\u2014');
    people.appendChild(visitorsN);
    people.appendChild(make('span', 'vm-gs__l', 'explorers'));
    var sep = make('span', 'vm-gs__sep');
    sep.textContent = '\u00b7';
    sep.setAttribute('aria-hidden', 'true');
    var letters = make('span', 'vm-gs__fig');
    num = make('span', 'vm-gs__n', '\u2014');
    letters.appendChild(num);
    letters.appendChild(make('span', 'vm-gs__l', 'letters'));
    el.appendChild(people);
    el.appendChild(sep);
    el.appendChild(letters);
    host.appendChild(el);
    updateStatsLabel();

    statsPanel = make('div', 'vm-gs-panel');
    statsPanel.id = 'void-galaxy-stats-panel';
    statsPanel.hidden = true;
    statsPanel.setAttribute('role', 'dialog');
    statsPanel.setAttribute('aria-modal', 'false');
    statsPanel.setAttribute('aria-label', 'Galaxy statistics');
    var r1 = statRow('explorers', '\u2014');
    var r2 = statRow('sessions', '\u2014');
    var r3 = statRow('returned', '\u2014');
    var r4 = statRow('letters', '\u2014');
    rowVisitors = r1.value;
    rowSessions = r2.value;
    rowReturned = r3.value;
    rowLetters = r4.value;
    statsPanel.appendChild(r1.row);
    statsPanel.appendChild(r2.row);
    statsPanel.appendChild(r3.row);
    statsPanel.appendChild(r4.row);
    statsRead = make('button', 'void-god-btn vm-gs-read', 'No letters yet');
    statsRead.type = 'button';
    statsRead.disabled = true;
    statsPanel.appendChild(statsRead);
    host.appendChild(statsPanel);

    el.addEventListener('click', function () {
      if (statsOpen) closeStats(false);
      else openStats();
    });
    el.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'touch') return;
      if (!statsOpen) return;
      clearTimeout(statsHoverTimer);
      statsHoverTimer = setTimeout(function () { closeStats(false); }, 1200);
    });
    statsPanel.addEventListener('pointerenter', function () {
      clearTimeout(statsHoverTimer);
    });
    statsPanel.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'touch') return;
      clearTimeout(statsHoverTimer);
      statsHoverTimer = setTimeout(function () { closeStats(false); }, 1200);
    });
    statsRead.addEventListener('click', readNewest);
    window.addEventListener('resize', function () {
      positionStatsIndicator();
      if (statsOpen) placeStats();
    });
    document.addEventListener('pointerdown', function (e) {
      if (!statsOpen) return;
      if (el.contains(e.target) || statsPanel.contains(e.target)) return;
      closeStats(false);
    }, true);
    showPill();
  }

  function showPill() {
    if (!el || pillShown) return;
    pillShown = true;
    el.hidden = false;
    positionStatsIndicator();
    if (showFrame) cancelAnimationFrame(showFrame);
    showFrame = requestAnimationFrame(function () {
      showFrame = 0;
      if (el && !el.hidden) el.classList.add('is-on');
    });
  }

  /* پنل آمار به دکمه می‌چسبد ولی جای‌گذاری‌اش مثل پنلِ نامه است: بین چند
     کاندید، آن جایی انتخاب می‌شود که کمترین هم‌پوشانی با کنترل‌های صفحه
     (ستون آیکن‌ها، قلم، گوشه‌ها، خودِ دکمه) را دارد. */
  function placeStats() {
    if (!statsPanel || !el) return;
    var r = el.getBoundingClientRect();
    var W = statsPanel.offsetWidth, H = statsPanel.offsetHeight;
    var m = 10, gap = 8;
    var maxLeft = Math.max(m, window.innerWidth - m - W);
    var maxTop = Math.max(m, window.innerHeight - m - H);
    var cands = [
      { left: r.right - W, top: r.top - H - gap },
      { left: r.right - W, top: r.bottom + gap },
      { left: r.left, top: r.top - H - gap },
      { left: r.left, top: r.bottom + gap },
      { left: r.left - W - gap, top: r.bottom - H },
      { left: r.right + gap, top: r.bottom - H }
    ];
    var obs = obstacleRects();
    obs.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, weight: 10 });
    var best = null, bestArea = Infinity, bestOff = Infinity;
    for (var i = 0; i < cands.length; i++) {
      var left = clamp(cands[i].left, m, maxLeft);
      var top = clamp(cands[i].top, m, maxTop);
      var rect = { left: left, top: top, right: left + W, bottom: top + H };
      var area = 0;
      for (var j = 0; j < obs.length; j++) area += overlapArea(rect, obs[j]);
      var off = Math.abs(left - cands[i].left) + Math.abs(top - cands[i].top);
      if (area < bestArea - 0.5 || (area <= bestArea + 0.5 && off < bestOff)) {
        bestArea = area;
        bestOff = off;
        best = { left: left, top: top };
      }
    }
    if (!best) best = { left: maxLeft, top: maxTop };
    statsPanel.style.left = Math.round(best.left) + 'px';
    statsPanel.style.top = Math.round(best.top) + 'px';
  }

  function openStats() {
    if (!statsPanel || statsOpen) return;
    statsOpen = true;
    clearTimeout(statsHoverTimer);
    clearTimeout(hideTimer);
    statsPanel.hidden = false;
    el.setAttribute('aria-expanded', 'true');
    placeStats();
    requestAnimationFrame(function () {
      if (statsOpen && statsPanel) statsPanel.classList.add('is-on');
    });
    refreshCount();
  }

  function closeStats(focus) {
    clearTimeout(statsHoverTimer);
    if (!statsOpen) return;
    statsOpen = false;
    statsPanel.classList.remove('is-on');
    el.setAttribute('aria-expanded', 'false');
    setTimeout(function () {
      if (!statsOpen && statsPanel) statsPanel.hidden = true;
    }, 180);
    if (focus) { try { el.focus({ preventScroll: true }); } catch (e) {} }
  }

  function holeCenter() {
    try {
      var V = window.VoidMusicViz && window.VoidMusicViz._test && window.VoidMusicViz._test.V;
      if (V && V.ok && isFinite(V.cx) && isFinite(V.cy)) {
        return { x: Number(V.cx), y: Number(V.cy) };
      }
    } catch (e) {}
    return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight * 0.45) };
  }

  function readNewest() {
    if (!letterTotal) return;
    closeStats(true);
    var c = holeCenter();
    openMessageAt(c.x, c.y);
  }

  function hide() {
    if (!el) return false;
    pillShown = false;
    closeStats(false);
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
    var ok = isFinite(n) && n >= 0;
    letterTotal = ok ? n : null;
    num.textContent = ok ? fmt(n) : '\u2014';
    if (rowLetters) rowLetters.textContent = num.textContent;
    if (statsRead) {
      var can = ok && n > 0;
      statsRead.disabled = !can;
      statsRead.textContent = can ? 'Read the newest letter' : 'No letters yet';
      statsRead.title = can ? 'Open the newest letter' : 'The galaxy has no letters yet';
    }
    updateStatsLabel();
    showPill();
    return true;
  }

  function updateStatsLabel() {
    if (!el) return;
    var explorers = visitorsN ? visitorsN.textContent : '\u2014';
    var letters = num ? num.textContent : '\u2014';
    el.setAttribute('aria-label', 'Galaxy statistics: ' + explorers + ' explorers, ' + letters + ' letters');
  }

  function setVisitors(s) {
    if (!s) return;
    var u = Number(s.u), t = Number(s.t), r = Number(s.r);
    if (!isFinite(u) || u < 0) return;
    if (visitorsN) visitorsN.textContent = fmt(u);
    if (rowVisitors) rowVisitors.textContent = fmt(u);
    if (rowSessions) rowSessions.textContent = isFinite(t) && t >= 0 ? fmt(t) : '\u2014';
    if (rowReturned) {
      rowReturned.textContent = isFinite(r) ? Math.round(Math.min(1, Math.max(0, r)) * 100) + '%' : '\u2014';
    }
    updateStatsLabel();
    showPill();
  }

  /* یک hit در هر نشستِ مرورگر و بعد stats. احترام به DNT/GPC مثل شمارندهٔ
     قبلی: در آن حالت فقط آمار خوانده می‌شود. اعداد هرگز به موفقیتِ نوشتن
     وابسته نیستند. */
  var VISIT_COUNTED = 'vgm-counted';
  var VISIT_RETURNING = 'vgm-visitor';

  function readSession(key, persistent) {
    try {
      var store = persistent ? window.localStorage : window.sessionStorage;
      return store ? store.getItem(key) : null;
    } catch (e) { return null; }
  }

  function writeSession(key, value, persistent) {
    try {
      var store = persistent ? window.localStorage : window.sessionStorage;
      if (store) store.setItem(key, value);
    } catch (e) {}
  }

  function startVisitors() {
    if (visitorsStarted || !api || typeof api.recordVisit !== 'function' ||
        typeof api.visitorStats !== 'function') return;
    visitorsStarted = true;
    var nav = window.navigator || {};
    var skipHit = nav.doNotTrack === '1' || nav.globalPrivacyControl === true ||
      readSession(VISIT_COUNTED, false) === '1';
    var hit = skipHit ? Promise.resolve(false) : api.recordVisit(readSession(VISIT_RETURNING, true) === '1');
    hit.then(function () {
      if (!skipHit) {
        writeSession(VISIT_COUNTED, '1', false);
        writeSession(VISIT_RETURNING, '1', true);
      }
      return api.visitorStats();
    }).then(function (s) {
      if (s) setVisitors(s);
    });
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
    syncSubmit();
  }

  function fmtLeft(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m > 0 ? m + ':' + (s < 10 ? '0' + s : s) : s + 's';
  }

  /* The Worker's retry_after is a whole number of seconds. */
  function startCooldown(seconds) {
    var s = Number(seconds);
    if (!isFinite(s) || s <= 0) return;
    cooldownUntil = Date.now() + Math.min(s, 3600) * 1000;
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(function () {
      if (Date.now() >= cooldownUntil) {
        clearInterval(cooldownTimer);
        cooldownTimer = 0;
        cooldownUntil = 0;
      }
      syncSubmit();
    }, 1000);
    syncSubmit();
  }

  function syncSubmit() {
    if (!submitBtn) return;
    submitBtn.setAttribute('aria-busy', sending ? 'true' : 'false');
    var left = Math.ceil((cooldownUntil - Date.now()) / 1000);
    if (sending) {
      submitBtn.textContent = 'Sending\u2026';
      submitBtn.disabled = true;
      return;
    }
    if (left > 0) {
      submitBtn.textContent = 'Try again in ' + fmtLeft(left);
      submitBtn.disabled = true;
      return;
    }
    submitBtn.textContent = uncertainSubmission ? 'Check submission' : 'Submit letter';
    if (published) { submitBtn.disabled = true; return; }
    var text = composer.value;
    var ok = codePoints(text) <= MAX_POINTS && !BAD_CHARS.test(text) &&
      text.trim().length > 0 && !!(ackEl && ackEl.checked);
    submitBtn.disabled = !ok;
  }

  function notice(text) {
    noticeEl.textContent = text;
    noticeEl.hidden = false;
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
    var dockEl = document.body.classList.contains('is-letter-reading')
      ? null
      : document.querySelector('#void-music-root .vm-dock');
    if (dockEl) {
      var r = dockEl.getBoundingClientRect();
      if (r.height > 1 && r.top < limit) limit = r.top - 10;
    }
    return limit;
  }

  /* The clickable region is the black hole sphere itself, not its bounding
     rectangle or the surrounding galaxy. void-music-viz.js draws that disk at
     (uCenter) with R = uHoleR * uScale, where uHoleR is HOLE_R and uScale is
     V.scale scaled by the camera breath. Reading the same live values keeps the
     circle aligned across viewport sizes and while the camera breathes; without
     a rendered hole (no WebGL / not initialised) the gate stays closed. */
  var HOLE_R = 0.11;

  function holeCircle() {
    try {
      var viz = window.VoidMusicViz;
      var V = viz && viz._test && viz._test.V;
      if (!V || !V.ok) return null;
      var cx = Number(V.cx), cy = Number(V.cy), scale = Number(V.scale);
      if (!isFinite(cx) || !isFinite(cy) || !isFinite(scale) || scale <= 0) return null;
      var b = V.breath || {};
      var mix = isFinite(Number(b.mix)) ? clamp(Number(b.mix), 0, 1) : 0;
      var zoom = isFinite(Number(b.zoom)) ? Number(b.zoom) : 1;
      return { cx: cx, cy: cy, r: HOLE_R * scale * (1 + (zoom - 1) * mix) };
    } catch (e) { return null; }
  }

  function isGalaxyPoint(x, y) {
    var hole = holeCircle();
    if (!hole) return false;
    var dx = x - hole.cx, dy = y - hole.cy;
    return dx * dx + dy * dy <= hole.r * hole.r;
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
    add('#void-god-discover', 8, 10);
    add('.vm-corner', 10, 10);
    add('#void-music-root .vm-btn', 10, 10);
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
    var nav = make('div', 'void-god-nav');
    panelPrevious = make('button', 'void-god-nav__button', '\u2190');
    panelPrevious.type = 'button';
    panelPrevious.disabled = true;
    panelPrevious.setAttribute('aria-label', 'Previous letter');
    panelPrevious.title = 'Previous letter';
    panelNext = make('button', 'void-god-nav__button', '\u2192');
    panelNext.type = 'button';
    panelNext.disabled = source.kind !== 'api';
    panelNext.setAttribute('aria-label', 'Next letter');
    panelNext.title = 'Next letter';
    nav.appendChild(panelPrevious);
    nav.appendChild(panelNext);
    nav.setAttribute('role', 'group');
    nav.setAttribute('aria-label', 'Letter navigation');
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

    panelLifespan = make('time', 'void-god-msg-lifespan');
    panelLifespan.id = 'void-god-panel-lifespan';
    panelLifespan.hidden = true;

    panelVotes = make('div', 'void-god-votes');
    panelVotes.id = 'void-god-votes';
    panelVotes.hidden = true;
    panelLike = make('button', 'void-god-btn void-god-vote');
    panelLike.type = 'button';
    panelLike.id = 'void-god-like';
    panelLike.setAttribute('aria-pressed', 'false');
    panelLike.setAttribute('aria-label', 'Like this letter');
    var voteIconPath = 'M14 9V5a3 3 0 0 0-3-3L7 9v12h11.28a2 2 0 0 0 1.97-1.65l1.38-8A2 2 0 0 0 19.66 9H14zM7 21H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3';
    var likeIcon = svgNode('svg', { viewBox: '0 0 24 24', class: 'void-god-vote__icon', 'aria-hidden': 'true', focusable: 'false' });
    likeIcon.appendChild(svgNode('path', { d: voteIconPath }));
    panelLike.appendChild(likeIcon);
    panelLike.appendChild(make('span', 'void-god-vote__label', 'Like'));
    likeCount = make('span', 'void-god-vote__count', '0');
    panelLike.appendChild(likeCount);
    panelDislike = make('button', 'void-god-btn void-god-vote');
    panelDislike.type = 'button';
    panelDislike.id = 'void-god-dislike';
    panelDislike.setAttribute('aria-pressed', 'false');
    panelDislike.setAttribute('aria-label', 'Dislike this letter');
    var dislikeIcon = svgNode('svg', { viewBox: '0 0 24 24', class: 'void-god-vote__icon void-god-vote__icon--down', 'aria-hidden': 'true', focusable: 'false' });
    var dislikeShape = svgNode('g', { transform: 'rotate(180 12 12)' });
    dislikeShape.appendChild(svgNode('path', { d: voteIconPath }));
    dislikeIcon.appendChild(dislikeShape);
    panelDislike.appendChild(dislikeIcon);
    panelDislike.appendChild(make('span', 'void-god-vote__label', 'Dislike'));
    dislikeCount = make('span', 'void-god-vote__count', '0');
    panelDislike.appendChild(dislikeCount);
    panelVotes.appendChild(panelLike);
    panelVotes.appendChild(panelDislike);

    var actions = make('div', 'void-god-panel__actions');
    panelCopy = make('button', 'void-god-btn', 'Copy');
    panelCopy.type = 'button';
    panelCopy.id = 'void-god-copy';
    panelShare = make('button', 'void-god-btn', 'Share on X');
    panelShare.type = 'button';
    panelShare.id = 'void-god-share';
    actions.appendChild(nav);
    actions.appendChild(panelCopy);
    actions.appendChild(panelShare);

    panelFeedback = make('p', 'void-god-panel__status');
    panelFeedback.id = 'void-god-copy-status';
    panelFeedback.setAttribute('role', 'status');
    panelFeedback.setAttribute('aria-live', 'polite');
    panelFeedback.hidden = true;

    panel.appendChild(head);
    panel.appendChild(panelText);
    panel.appendChild(panelLifespan);
    panel.appendChild(panelMeta);
    panel.appendChild(panelVotes);
    panel.appendChild(actions);
    panel.appendChild(panelFeedback);
    host.appendChild(panel);

    x.addEventListener('click', function () {
      closePanel({ dissolve: true, focus: true });
    });
    panelCopy.addEventListener('click', onCopy);
    panelShare.addEventListener('click', onShare);
    panelLike.addEventListener('click', function () { onVote('like'); });
    panelDislike.addEventListener('click', function () { onVote('dislike'); });
    panelPrevious.addEventListener('click', function () { navigateLetter(-1); });
    panelNext.addEventListener('click', function () { navigateLetter(1); });
  }

  function renderMessage(msg) {
    voteBusy = false;
    panelText.textContent = msg.text;
    if (msg.lang) panelText.setAttribute('lang', msg.lang);
    else panelText.removeAttribute('lang');
    panelTag.textContent = source.tag;
    panelMeta.textContent = source.kind === 'demo'
      ? 'Sample message from the local demo set \u2014 no real messages have arrived yet. Nothing is sent or stored.'
      : 'Anonymous public letter';
    clearTimeout(feedbackTimer);
    panelFeedback.hidden = true;
    panelFeedback.textContent = '';
    panelCopy.textContent = 'Copy';
    panelCopy.disabled = false;
    var canShare = !!messageLink(msg);
    panelShare.disabled = !canShare;
    panelShare.title = canShare
      ? 'Share this letter on X'
      : 'This message has no public link \u2014 use Copy instead';
    panelShare.setAttribute('aria-label', canShare
      ? 'Share this letter on X'
      : 'Sharing unavailable \u2014 copy the message instead');
    renderLifespan(msg.expires_at);
    renderVotes(msg);
  }

  function clearLifespanTimer() {
    clearInterval(lifespanTimer);
    lifespanTimer = 0;
  }

  function lifespanLabel(expiresAt) {
    var ms = Number(expiresAt) * 1000 - Date.now();
    if (!isFinite(ms) || ms <= 0) return 'Fading now';
    var mins = Math.ceil(ms / 60000);
    if (mins < 60) return mins + (mins === 1 ? ' minute remaining' : ' minutes remaining');
    var hours = Math.ceil(ms / 3600000);
    if (hours < 48) return hours + ' hours remaining';
    var days = Math.ceil(ms / 86400000);
    return days + (days === 1 ? ' day remaining' : ' days remaining');
  }

  /* The countdown is local and quiet: it re-renders once a minute while the
     panel is open and is always replaced by the server value after a vote. */
  function renderLifespan(expiresAt, bump) {
    clearLifespanTimer();
    if (!panelLifespan) return;
    var has = source.kind === 'api' && Number(expiresAt) > 0;
    panelLifespan.hidden = !has;
    if (!has) {
      panelLifespan.textContent = '';
      panelLifespan.removeAttribute('datetime');
      return;
    }
    panelLifespan.textContent = lifespanLabel(expiresAt);
    panelLifespan.setAttribute('datetime', new Date(Number(expiresAt) * 1000).toISOString());
    lifespanTimer = setInterval(function () {
      if (!panelOpen || !currentMessage) { clearLifespanTimer(); return; }
      panelLifespan.textContent = lifespanLabel(currentMessage.expires_at);
    }, 30000);
    if (bump) {
      panelLifespan.classList.remove('is-bumped', 'is-dipped');
      void panelLifespan.offsetWidth;
      panelLifespan.classList.add(bump === 'like' ? 'is-bumped' : 'is-dipped');
      setTimeout(function () {
        if (panelLifespan) panelLifespan.classList.remove('is-bumped', 'is-dipped');
      }, 800);
    }
  }

  function voteStore() {
    try { return window.sessionStorage || null; } catch (e) { return null; }
  }

  function loadVotes() {
    var s = voteStore();
    if (!s) return {};
    try {
      var raw = s.getItem(VOTES_KEY);
      var map = raw ? JSON.parse(raw) : null;
      return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    } catch (e) { return {}; }
  }

  function saveVote(id, type) {
    var s = voteStore();
    if (!s) return;
    var map = loadVotes();
    if (Object.keys(map).length > 200) map = {};
    map[id] = type;
    try { s.setItem(VOTES_KEY, JSON.stringify(map)); } catch (e) {}
  }

  function forgetVote(id) {
    var s = voteStore();
    if (!s) return;
    var map = loadVotes();
    delete map[id];
    try { s.setItem(VOTES_KEY, JSON.stringify(map)); } catch (e) {}
  }

  function renderVotes(msg) {
    if (!panelVotes) return;
    var id = msg && typeof msg.id === 'string' ? msg.id : '';
    var canVote = source.kind === 'api' && !!id && !!api &&
      typeof api.vote === 'function' && !msg.faded;
    panelVotes.hidden = !canVote;
    if (!canVote) {
      panelLike.disabled = true;
      panelDislike.disabled = true;
      return;
    }
    var voted = loadVotes()[id] || null;
    likeCount.textContent = String(Number(msg.votes_like) || 0);
    dislikeCount.textContent = String(Number(msg.votes_dislike) || 0);
    panelLike.disabled = !!voted || voteBusy;
    panelDislike.disabled = !!voted || voteBusy;
    panelLike.classList.toggle('is-voted', voted === 'like');
    panelDislike.classList.toggle('is-voted', voted === 'dislike');
    panelLike.setAttribute('aria-pressed', voted === 'like' ? 'true' : 'false');
    panelDislike.setAttribute('aria-pressed', voted === 'dislike' ? 'true' : 'false');
    panelLike.title = voted
      ? 'You already voted on this letter in this session'
      : 'Like this letter and add one day';
    panelDislike.title = voted
      ? 'You already voted on this letter in this session'
      : 'Dislike this letter and remove one day';
  }

  function projectedExpiry(msg, type) {
    var exp = Number(msg.expires_at) || 0;
    if (!exp) return exp;
    if (type === 'like') {
      var cap = (Number(msg.created_at) || exp) + MAX_LIFETIME_SEC;
      return Math.min(exp + DAY_SEC, cap);
    }
    return Math.min(exp, Math.max(exp - DAY_SEC, Math.floor(Date.now() / 1000) + MIN_REMAINING_SEC));
  }

  /* Optimistic: the count and the countdown move at once, then the server
     reply replaces them. Any failure restores the previous numbers. */
  function onVote(type) {
    if (!currentMessage || voteBusy) return;
    var msg = currentMessage;
    var id = msg && typeof msg.id === 'string' ? msg.id : '';
    if (!id || source.kind !== 'api' || !api || typeof api.vote !== 'function') return;
    if (loadVotes()[id]) return;

    var before = { expires_at: msg.expires_at, likes: msg.votes_like, dislikes: msg.votes_dislike };
    voteBusy = true;
    saveVote(id, type);
    msg.expires_at = projectedExpiry(msg, type);
    if (type === 'like') msg.votes_like = (Number(msg.votes_like) || 0) + 1;
    else msg.votes_dislike = (Number(msg.votes_dislike) || 0) + 1;
    renderVotes(msg);
    renderLifespan(msg.expires_at, type);
    feedback(type === 'like'
      ? 'The star grows brighter\u2026'
      : 'The star grows dimmer\u2026', false);

    function restore() {
      forgetVote(id);
      msg.expires_at = before.expires_at;
      msg.votes_like = before.likes;
      msg.votes_dislike = before.dislikes;
      renderLifespan(msg.expires_at);
    }

    api.vote(id, type).then(function (res) {
      voteBusy = false;
      if (res.status === 'ok') {
        msg.expires_at = res.letter.expires_at || msg.expires_at;
        msg.votes_like = res.letter.votes_like;
        msg.votes_dislike = res.letter.votes_dislike;
        renderLifespan(msg.expires_at, type);
        feedback(res.capped
          ? (type === 'like'
            ? 'This star already shines at its brightest.'
            : 'This letter is already as close to fading as it can get.')
          : (type === 'like'
            ? 'A day was added to this star.'
            : 'A day was taken from this star.'), false);
      } else if (res.status === 'already') {
        saveVote(id, res.type);
        msg.expires_at = res.letter.expires_at || msg.expires_at;
        msg.votes_like = res.letter.votes_like;
        msg.votes_dislike = res.letter.votes_dislike;
        renderLifespan(msg.expires_at);
        feedback('You already voted on this letter in this session.', false);
      } else if (res.status === 'not_found') {
        forgetVote(id);
        msg.faded = true;
        msg.expires_at = 0;
        msg.votes_like = before.likes;
        msg.votes_dislike = before.dislikes;
        renderLifespan(0);
        feedback('This letter has already faded.', false);
      } else {
        restore();
        feedback(res.status === 'rate'
          ? 'Too many votes for now \u2014 nothing was changed.'
          : 'Could not reach the galaxy \u2014 nothing was changed.', false);
      }
      renderVotes(msg);
    }, function () {
      voteBusy = false;
      restore();
      renderVotes(msg);
      feedback('Could not reach the galaxy \u2014 nothing was changed.', false);
    });
  }

  function fadeInLabel(expiresAt) {
    var ms = Number(expiresAt) * 1000 - Date.now();
    if (!isFinite(ms) || ms <= 60000) return 'soon';
    var mins = Math.round(ms / 60000);
    if (mins < 90) return 'in about ' + Math.max(1, mins) + ' min';
    var hours = Math.round(mins / 60);
    if (hours < 36) return 'in about ' + hours + ' hours';
    return 'in about ' + Math.round(hours / 24) + ' days';
  }

  /* Panel states reuse the existing tag/text/meta elements so the layout and
     styling stay untouched while the feed loads, is empty, or fails. */
  function showPanelState(state) {
    currentMessage = null;
    voteBusy = false;
    clearLifespanTimer();
    panelTag.textContent = source.tag;
    panelCopy.disabled = true;
    panelShare.disabled = true;
    if (panelLifespan) {
      panelLifespan.hidden = true;
      panelLifespan.textContent = '';
      panelLifespan.removeAttribute('datetime');
      panelLifespan.classList.remove('is-bumped', 'is-dipped');
    }
    if (panelVotes) panelVotes.hidden = true;
    if (panelLike) {
      panelLike.disabled = true;
      panelDislike.disabled = true;
      panelLike.classList.remove('is-voted');
      panelDislike.classList.remove('is-voted');
    }
    clearTimeout(feedbackTimer);
    panelFeedback.hidden = true;
    panelFeedback.textContent = '';
    if (state === 'empty') {
      panelText.textContent = 'No letters in the galaxy yet.';
      panelMeta.textContent = 'Be the first to leave one \u2014 the quill is on the right.';
    } else if (state === 'gone') {
      panelText.textContent = 'This letter has faded.';
      panelMeta.textContent = 'Shared letters disappear when their time runs out. The galaxy keeps the others.';
    } else if (state === 'error') {
      panelText.textContent = 'The galaxy is out of reach right now.';
      panelMeta.textContent = 'Could not load letters. The send form still works.';
    } else {
      panelText.textContent = 'Looking for a letter\u2026';
      panelMeta.textContent = 'Loading the newest letters.';
    }
  }

  function nextRemote() {
    if (!api) return Promise.reject(new Error('api missing'));
    if (!feed) feed = api.createFeed();
    return feed.next().then(function (res) {
      if (res.status === 'ok') return res.letter;
      if (res.status === 'error') throw new Error('feed');
      return null;
    });
  }

  /* Feed and counter load independently: either can fail without blocking the
     other or the composer. */
  function refreshCount() {
    if (!api) return;
    api.count().then(function (n) {
      if (n !== null) setCount(n);
    });
  }

  function startRemote() {
    if (remoteStarted || source.kind !== 'api' || !api) return;
    remoteStarted = true;
    if (!feed) feed = api.createFeed();
    feed.prefetch();
    refreshCount();
    startVisitors();
  }

  function layoutPanel(x, y, focus) {
    var top = safeTop();
    var bottom = safeBottom();
    clearTimeout(closeTimer);
    panelClosing = false;
    panel.classList.remove('is-closing');
    panel.removeAttribute('inert');
    panel.hidden = false;
    panel.classList.remove('is-on');
    panel.style.left = '0px';
    panel.style.top = '0px';
    var mobileCap = window.matchMedia && window.matchMedia('(max-width: 520px)').matches ? 0.76 : 0.56;
    var cap = Math.min(380, window.innerHeight * mobileCap, Math.max(120, bottom - top));
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
    /* One pixel of headroom: rounding the border box down would otherwise
       turn a content-fitting panel into a scroll container. */
    panel.style.maxHeight = (Math.round(chosen.bottom - chosen.top) + 1) + 'px';
    panel.style.left = chosen.left + 'px';
    panel.style.top = chosen.top + 'px';
    panel.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () {
      if (panelOpen) panel.classList.add('is-on');
    });
    if (focus) { try { panel.focus({ preventScroll: true }); } catch (e) {} }
  }

  function openMessageAt(x, y, load) {
    hideToolPalette();
    if (!ensureMounted()) {
      hidePanelNow();
      return;
    }
    if (!panelOpen && !readerMusicSnapshot) {
      readerMusicSnapshot = pendingMusicSnapshot || readMusicPresentation();
      pendingMusicSnapshot = null;
      clearTimeout(pendingMusicSnapshotTimer);
      pendingMusicSnapshotTimer = 0;
    }
    clearScene(true);
    var requestToken = ++panelRequestToken;
    panelClosing = false;
    setReadingMode(true);
    panelOpen = true;
    var p = anchorPoint(x, y);
    starX = p.x;
    starY = p.y;
    buildAnchorAt(starX, starY);
    layoutPanel(starX, starY, true);
    showPanelState('loading');
    panel.classList.add('is-loading-letter');
    if (panelPrevious) panelPrevious.disabled = true;
    if (panelNext) panelNext.disabled = true;
    Promise.resolve().then(function () { return load ? load() : source.next(); }).then(function (msg) {
      if (!panelOpen || requestToken !== panelRequestToken) return;
      panel.classList.remove('is-loading-letter');
      if (msg && msg.state) { showPanelState(msg.state); layoutPanel(starX, starY, false); return; }
      if (!msg) { showPanelState('empty'); layoutPanel(starX, starY, false); return; }
      letterHistory = [msg];
      historyIndex = 0;
      currentMessage = msg;
      renderMessage(msg);
      updateNavigation();
      layoutPanel(starX, starY, false);
    }, function () {
      if (!panelOpen || requestToken !== panelRequestToken) return;
      panel.classList.remove('is-loading-letter');
      showPanelState('error');
      layoutPanel(starX, starY, false);
    });
  }

  function updateNavigation() {
    if (!panelPrevious || !panelNext) return;
    panelPrevious.disabled = historyIndex <= 0;
    panelNext.disabled = !currentMessage || (historyIndex >= letterHistory.length - 1 && source.kind !== 'api');
  }

  function navigateLetter(direction) {
    if (!panelOpen || !panel || panel.classList.contains('is-loading-letter')) return;
    var target = historyIndex + direction;
    if (target >= 0 && target < letterHistory.length) {
      historyIndex = target;
      currentMessage = letterHistory[historyIndex];
      renderMessage(currentMessage);
      updateNavigation();
      layoutPanel(starX, starY, false);
      return;
    }
    if (direction < 0 || source.kind !== 'api') return;
    var requestToken = ++panelRequestToken;
    panel.classList.add('is-loading-letter');
    showPanelState('loading');
    source.next().then(function (msg) {
      if (!panelOpen || requestToken !== panelRequestToken) return;
      panel.classList.remove('is-loading-letter');
      if (!msg || msg.state) {
        showPanelState(msg && msg.state ? msg.state : 'empty');
        updateNavigation();
        layoutPanel(starX, starY, false);
        return;
      }
      letterHistory = letterHistory.slice(0, historyIndex + 1);
      letterHistory.push(msg);
      historyIndex = letterHistory.length - 1;
      currentMessage = msg;
      renderMessage(msg);
      updateNavigation();
      layoutPanel(starX, starY, false);
    }, function () {
      if (!panelOpen || requestToken !== panelRequestToken) return;
      panel.classList.remove('is-loading-letter');
      showPanelState('error');
      updateNavigation();
      layoutPanel(starX, starY, false);
    });
  }

  /* اشتراک‌گذاری با لینک مستقیم: ?letter=<id> در آدرس صفحه. فقط شناسه‌ای که خودِ
     API معتبر بداند پذیرفته می‌شود؛ نامهٔ منقضی همان «محو شده» را نشان می‌دهد. */
  function sharedLetterId() {
    if (source.kind !== 'api' || !api || typeof api.letterUrl !== 'function') return null;
    var id = null;
    try { id = new URLSearchParams(window.location.search).get('letter'); } catch (e) { id = null; }
    return id && api.letterUrl(id) ? id : null;
  }

  function openSharedLetter(id) {
    var c = holeCenter();
    openMessageAt(c.x, c.y, function () {
      return api.getLetter(id).then(function (res) {
        if (res.status === 'ok') return res.letter;
        if (res.status === 'not_found') return { state: 'gone' };
        throw new Error('letter');
      });
    });
  }

  var deepLinkDone = false;

  function openDeepLink() {
    if (deepLinkDone) return;
    var id = sharedLetterId();
    if (!id) return;
    deepLinkDone = true;
    /* دو فریم صبر تا بوم و مرکز سیاه‌چاله جای خود را بگیرند. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { openSharedLetter(id); });
    });
  }

  function hidePanelNow(preserveReaderState) {
    panelOpen = false;
    panelClosing = false;
    panelRequestToken++;
    setReadingMode(false);
    if (!preserveReaderState) restoreMusicPresentation();
    voteBusy = false;
    clearLifespanTimer();
    clearTimeout(closeTimer);
    if (!panel) return;
    panel.classList.remove('is-on', 'is-closing', 'is-loading-letter');
    panel.setAttribute('inert', '');
    panel.setAttribute('aria-hidden', 'true');
    panel.hidden = true;
  }

  function closePanel(opts) {
    opts = opts || {};
    if (!panelOpen) { setReadingMode(false); restoreMusicPresentation(); return; }
    panelOpen = false;
    panelClosing = true;
    panelRequestToken++;
    setReadingMode(false);
    restoreMusicPresentation();
    currentMessage = null;
    voteBusy = false;
    clearLifespanTimer();
    panel.classList.remove('is-on', 'is-loading-letter');
    panel.classList.add('is-closing');
    panel.setAttribute('inert', '');
    panel.setAttribute('aria-hidden', 'true');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      if (!panelOpen && panel) {
        panel.hidden = true;
        panel.classList.remove('is-closing');
        panelClosing = false;
      }
    }, 360);
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

  function clearScene(preserveReaderState) {
    hidePanelNow(!!preserveReaderState);
    removeAnchorNow();
    currentMessage = null;
  }

  function relayoutSoon() {
    requestAnimationFrame(function () { relayout(); });
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
    relayoutSoon();
    feedbackTimer = setTimeout(function () {
      if (!panelFeedback) return;
      panelFeedback.hidden = true;
      panelFeedback.textContent = '';
      panelCopy.textContent = 'Copy';
      relayoutSoon();
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

  /* اشتراک در X با همان روشِ دکمهٔ «Share on X» پس از ثبت: یک لینکِ مستقیمِ
     intent که هیچ اپِ نصب‌شده‌ای لازم ندارد. navigator.share عمداً کنار گذاشته
     شد چون در ویندوز پنجرهٔ اشتراکِ سیستم را باز می‌کند که X در آن نیست. */
  function messageLink(msg) {
    if (!msg || typeof msg.id !== 'string' || !api || typeof api.letterUrl !== 'function') return null;
    return api.letterUrl(msg.id) || null;
  }

  function onShare() {
    if (!currentMessage) return;
    var link = messageLink(currentMessage);
    if (!link) { shareFallback(); return; }
    var text = xShareText(currentMessage.text, 'panel');
    var url = X_INTENT + encodeURIComponent(text) + '&url=' + encodeURIComponent(link);
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) {}
  }

  function shareFallback() {
    if (!currentMessage) return;
    copyText(currentMessage.text).then(function () {
      feedback('This message has no public link yet \u2014 it was copied instead.', true);
    }, function () {
      feedback('Could not copy \u2014 select the message text and copy it.', false);
    });
  }

  /* ==================================================================
     پنجرهٔ نوشتنِ نامه + مسیر ثبت و اشتراک در X
     submit فقط از پاسخِ واقعیِ source.submit (Worker) صدا زده می‌شود.
     ================================================================== */
  function closeCompose() {
    if (!compose || !compose.open) return;
    compose.close();
    if (quillBtn) quillBtn.setAttribute('aria-expanded', 'false');
    restoreFocus(quillBtn);
  }

  function openCompose() {
    hideToolPalette();
    closePanel({ dissolve: false, focus: false });
    setReadingMode(false);
    if (panelClosing) hidePanelNow();
    try {
      if (window.VoidMusic && typeof window.VoidMusic.enter === 'function' &&
          (!window.VoidMusic.isOpen || !window.VoidMusic.isOpen())) window.VoidMusic.enter();
    } catch (e) {}
    if (!ensureMounted()) return;
    if (compose.open) return;
    if (!uncertainSubmission && api && typeof api.loadPending === 'function') {
      var saved = api.loadPending();
      if (saved && (saved.state === 'ambiguous' || saved.state === 'in_flight')) {
        composer.value = saved.text;
        var savedExpiry = composeForm.querySelectorAll('input[name="void-god-expiry"]');
        for (var si = 0; si < savedExpiry.length; si++) savedExpiry[si].checked = savedExpiry[si].value === saved.expiry;
        ackEl.checked = true;
        setUncertainSubmission(saved);
      }
    }
    composeForm.classList.remove('is-published');
    successEl.hidden = true;
    xShareBtn.disabled = true;
    published = false;
    shareUrl = null;
    publishedBase = '';
    publishedLang = null;
    sending = false;
    if (!uncertainSubmission) ackEl.checked = false;
    noticeEl.hidden = !uncertainSubmission;
    noticeEl.textContent = '';
    if (uncertainSubmission) notice('We could not confirm whether your letter arrived. Press Check submission to safely try again.');
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
    var h = make('h2', 'void-god-title', '\u2726 Message to Galaxy');
    h.id = 'void-god-title';
    var fa = make('span', 'void-god-title-fa', '\u0646\u0627\u0645\u0647 \u0628\u0647 \u06a9\u0647\u06a9\u0634\u0627\u0646');
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
      'Leave a thought among the stars. It becomes a small star in the galaxy: anonymous, public, and temporary. Write with care \u2014 once it leaves, it cannot be taken back.');
    intro.id = 'void-god-intro';

    var demo = make('p', 'void-god-demo', 'Your letter is stored anonymously on the public sky until it fades. Pressing Submit is final \u2014 it cannot be edited or deleted afterwards.');
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
    successTitle = make('p', 'void-god-published__title', 'Your letter is in the galaxy');
    successEl.appendChild(successTitle);
    successNote = make('p', 'void-god-published__note', '');
    successEl.appendChild(successNote);
    var okFoot = make('div', 'void-god-foot');
    xShareBtn = make('button', 'void-god-btn', 'Share on X');
    xShareBtn.type = 'button';
    xShareBtn.id = 'void-god-x-share';
    xShareBtn.disabled = true;
    xShareBtn.title = 'Sharing unlocks once the letter has its public page';
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
        notice('Sending is unavailable right now. Nothing was sent.');
        return;
      }
      submitLetter();
    });
  }

  function currentExpiry() {
    var checked = composeForm && composeForm.querySelector('input[name="void-god-expiry"]:checked');
    return checked ? checked.value : '7d';
  }

  function submitRemote(payload) {
    if (!api) return Promise.resolve({ kind: 'network' });
    var pending = uncertainSubmission || api.begin(payload.text, payload.expiry, detectLang(payload.text));
    return api.submit(pending);
  }

  function setUncertainSubmission(pending) {
    uncertainSubmission = pending || null;
    if (composer) composer.readOnly = !!uncertainSubmission;
    if (composeForm) {
      var options = composeForm.querySelectorAll('input[name="void-god-expiry"]');
      for (var i = 0; i < options.length; i++) options[i].disabled = !!uncertainSubmission;
    }
    if (ackEl) ackEl.disabled = !!uncertainSubmission;
    updateState();
  }

  function submitLetter() {
    if (sending || typeof source.submit !== 'function') return;
    sending = true;
    updateState();
    noticeEl.hidden = true;
    clearTimeout(connectionTimer);
    connectionTimer = setTimeout(function () {
      if (sending) notice('Connecting to the galaxy\u2026 Please wait.');
    }, 900);
    var payload = { text: composer.value, expiry: currentExpiry() };
    source.submit(payload).then(function (result) {
      clearTimeout(connectionTimer);
      sending = false;
      if (result && result.ambiguous) setUncertainSubmission(result.pending || (api && api.loadPending ? api.loadPending() : null));
      else if (result && result.kind !== 'busy') setUncertainSubmission(null);
      handleSubmitResult(result || { kind: 'error' });
    }, function () {
      clearTimeout(connectionTimer);
      sending = false;
      setUncertainSubmission(api && api.loadPending ? api.loadPending() : null);
      handleSubmitResult({ kind: 'network', ambiguous: true });
    });
  }

  var REASON_TEXT = {
    short: 'The letter is too short \u2014 at least 3 characters.',
    long: 'The letter is longer than 500 characters.',
    links: 'Links, domains and addresses are not allowed in a letter.',
    unicode: 'The letter contains characters that are not allowed.',
    control: 'The letter contains characters that are not allowed.',
    expiry: 'That fade time is not valid. Please pick another one.',
    request_id: 'The request could not be accepted. Please press Submit again.',
    body: 'The letter could not be read. Please try again.'
  };

  function handleSubmitResult(result) {
    if (result.kind === 'created' || result.kind === 'recovered') {
      onPublished(result);
      return;
    }
    if (result.kind === 'busy') return;
    if (result.kind === 'storage_unavailable') {
      notice('Your browser could not safely save this submission. Nothing was sent. Please enable session storage and try again.');
    } else if (result.kind === 'unresolved_submission') {
      notice('A previous submission could not be checked safely. Keep this letter unchanged and restore browser storage before trying again.');
    } else if (result.kind === 'already') {
      var when = result.next_allowed_at
        ? new Date(result.next_allowed_at * 1000).toLocaleString()
        : '';
      notice('You already have an active letter.' + (when ? ' You can send a new one from ' + when + '.' : ''));
    } else if (result.kind === 'expired') {
      notice('The previous letter has expired. Press Submit again to send this one as a new letter.');
    } else if (result.kind === 'rate') {
      startCooldown(result.retry_after);
      notice('The galaxy is limiting submissions for now. Your draft is saved; the same request will be checked safely when you try again.');
    } else if (result.kind === 'invalid') {
      notice(REASON_TEXT[result.reason] || 'The letter or its settings are not valid. Please check it and try again.');
    } else if (result.kind === 'timeout') {
      notice('The galaxy is taking longer than expected. Your letter may have arrived; press Check submission to safely confirm.');
    } else if (result.kind === 'network' || result.kind === 'response' || result.ambiguous) {
      notice('We could not confirm whether your letter arrived. Press Check submission to safely try again.');
    } else if (result.kind === 'server' || result.kind === 'unavailable') {
      notice('The galaxy could not save your letter right now. Your draft is still here; please try again.');
    } else if (result.kind === 'http') {
      notice('The galaxy returned an unexpected response (' + result.status + '). Your draft is still here.');
    } else {
      notice('The service is temporarily unavailable. Your letter is still here \u2014 try again in a moment.');
    }
    syncSubmit();
  }

  function onPublished(result) {
    setUncertainSubmission(null);
    published = true;
    shareUrl = null;
    publishedLang = detectShareLang(composer.value);
    xShareBtn.disabled = true;
    xShareBtn.title = 'Sharing unlocks once the letter has its public page';
    xShareBtn.setAttribute('aria-label', 'Sharing is not available yet');
    successTitle.textContent = result.kind === 'recovered'
      ? 'This letter was already sent'
      : 'Your letter is in the galaxy';
    publishedBase = (result.kind === 'recovered' ? 'It was saved earlier, so nothing new was added. ' : '') +
      (result.expires_at ? 'It will fade ' + fadeInLabel(result.expires_at) + '. ' : '');
    shareNote(false);
    composeForm.classList.add('is-published');
    successEl.hidden = false;
    noticeEl.hidden = true;
    composer.value = '';
    ackEl.checked = false;
    refreshCount();
    if (api) {
      feed = api.createFeed();
      feed.prefetch();
      unlockShare(result.id);
    }
    updateState();
    try { successEl.focus({ preventScroll: true }); } catch (e) {}
  }

  function shareNote(unlocked) {
    successNote.textContent = publishedBase + (unlocked
      ? 'Share it on X so someone can find it.'
      : 'Sharing on X unlocks once the live service can serve this letter.');
  }

  /* لینک فقط وقتی باز می‌شود که خودِ سرویس همان نامه را با همین شناسه برگرداند.
     ورکرِ منتشرنشده ۴۰۴ می‌دهد و دکمه قفل می‌ماند تا لینک مرده ساخته نشود. */
  function unlockShare(id) {
    if (!api || typeof api.getLetter !== 'function' || typeof api.letterUrl !== 'function') return;
    var url = api.letterUrl(id);
    if (!url) return;
    api.getLetter(id).then(function (res) {
      if (!published || res.status !== 'ok' || res.letter.id !== id) return;
      shareUrl = url;
      shareNote(true);
      xShareBtn.disabled = false;
      xShareBtn.title = 'Share this letter on X';
      xShareBtn.setAttribute('aria-label', 'Share this letter on X');
    }, function () {});
  }

  /* اشتراک در X: فقط با اقدام صریحِ کاربر و فقط پس از ثبت واقعی. متنِ ثابت است
     و هرگز متن نامه را در بر نمی‌گیرد؛ فقط زبانِ نامه انتخابش می‌کند. */
  function onShareX() {
    if (!published || !shareUrl) return;
    var copy = X_SHARE_COPY[publishedLang] || X_SHARE_COPY.en;
    var text = copy.letter + ' ' + copy.likes;
    var url = X_INTENT + encodeURIComponent(text) + '&url=' + encodeURIComponent(shareUrl);
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
    quillBtn.setAttribute('aria-label', 'Message to Galaxy');
    quillBtn.setAttribute('title', 'Message to Galaxy');
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
    discoveryBtn = make('button', 'void-god-discover');
    discoveryBtn.id = 'void-god-discover';
    discoveryBtn.type = 'button';
    discoveryBtn.setAttribute('aria-label', 'Discover a letter');
    discoveryBtn.title = 'Discover a letter';
    discoveryBtn.setAttribute('aria-expanded', 'false');
    discoveryBtn.setAttribute('aria-controls', 'void-topnav');
    discoveryBtn.appendChild(make('span', 'void-god-discover__core'));
    host.appendChild(discoveryBtn);
    discoveryBtn.addEventListener('click', function () {
      if (!toolsRevealed) {
        showToolPalette();
        return;
      }
      hideToolPalette();
      var c = holeCenter();
      openMessageAt(c.x, c.y);
    });
    positionStatsIndicator();
  }

  function buildUi(host) {
    if (compose) return;
    buildQuill(host);
    buildGalaxy(host);
    buildPanel(host);
    buildCompose(host);
    startRemote();
  }

  function onGuardKey(e) {
    if (panelOpen && !e.altKey && !e.ctrlKey && !e.metaKey) {
      var target = e.target;
      var belongsToReader = !!(panel && target && panel.contains(target));
      var interactive = false;
      if (belongsToReader && target && typeof target.closest === 'function') {
        interactive = !!target.closest('input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="textbox"], [tabindex]:not([tabindex="-1"])');
      }
      if (belongsToReader && !interactive && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault(); e.stopPropagation(); navigateLetter(e.key === 'ArrowRight' ? 1 : -1); return;
      }
    }
    var open = (compose && compose.open) || panelOpen || statsOpen;
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (compose && compose.open) closeCompose();
      else if (panelOpen) closePanel({ dissolve: true, focus: true });
      else closeStats(true);
      return;
    }
    /* Let the dialog own arrows/space (radios, buttons); only keep the player's
       document-capture shortcuts from firing underneath the open surface. */
    if (!e.ctrlKey && !e.metaKey && !e.altKey && PLAYER_KEYS[e.key]) e.stopPropagation();
  }

  function bindKeys() {
    if (guardOn) return;
    guardOn = true;
    window.addEventListener('pointerdown', rememberMusicPresentation, true);
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') rememberMusicPresentation();
      if (e.key === 'Tab' && !panelOpen && !(compose && compose.open) &&
          (e.target === document.body || (e.target && e.target.closest && e.target.closest('#void-topnav, #void-god-discover, #void-god-quill')))) {
        showToolPalette();
      }
    }, true);
    window.addEventListener('click', function () {
      setTimeout(function () {
        pendingMusicSnapshot = null;
        clearTimeout(pendingMusicSnapshotTimer);
        pendingMusicSnapshotTimer = 0;
      }, 0);
    }, true);
    window.addEventListener('keydown', onGuardKey, true);
    window.addEventListener('resize', function () {
      clearTimeout(relayoutTimer);
      relayoutTimer = setTimeout(relayout, 90);
    });
    window.addEventListener('voidmusic:mode', function (e) {
      if (e && e.detail && e.detail.open === false) { hideToolPalette(); clearScene(); }
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
    if (mount()) { openDeepLink(); return; }
    var tries = 0;
    (function retry() {
      if (mount()) { openDeepLink(); return; }
      if (++tries > 120) return;            // ~۲ ثانیه صبر برای ساختِ ریشهٔ پلیر
      setTimeout(retry, 16);
    })();
  }

  window.VoidLetters = { setCount: setCount, hide: hide };

  if (document.readyState === 'complete') requestAnimationFrame(start);
  else window.addEventListener('load', function () { requestAnimationFrame(start); }, { once: true });
})();
