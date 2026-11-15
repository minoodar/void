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
  /* فاصلهٔ تلاش‌های تأییدِ خواندنِ نامه پس از ثبت؛ اولین تلاش بی‌درنگ است. */
  var SHARE_VERIFY_DELAYS = [0, 2000, 6000];
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
  var statsReadSub = null;
  var statsWrite = null;
  var statsOpen = false;
  var statsHoverTimer = 0;
  var statsCloseTimer = 0;
  var statsHovered = false;
  var lastPointerType = 'mouse';
  var keyboardFocus = false;
  var suppressFocusOpen = false;
  var pillShown = false;
  var visitorsN = null;
  var returningN = null;
  var rowVisitors = null;
  var rowSessions = null;
  var rowReturned = null;
  var rowLetters = null;
  var rowTracks = null;
  var letterTotal = null;
  var trackTotal = 0;
  var visitorsStarted = false;
  var siteStatsTimer = 0;
  var siteStatsRefreshPromise = null;
  var siteStatsRefreshQueued = false;
  var liveDotEl = null;
  var statsStale = false;
  var statsStaleReason = '';
  /* Last valid value per metric, memory only. A missing sub-metric keeps its
     own slot instead of invalidating the others. */
  var statsLastGood = { letters: null, visitors: null, sessions: null, returning: null };
  var catalogueEventsBound = false;

  /* One server-reported quota drives every surface: the quill, the Write action
     in the statistics panel, and the strip inside the composer. Unknown means
     unknown — nothing is drawn and no number is shown. */
  var quota = null;
  var quotaState = 'idle';
  var quotaFetchedAt = 0;
  var quotaPromise = null;
  var quotaGen = 0;
  var quotaTick = 0;
  var dropMeters = [];
  var quillDrops = null;
  var quotaPop = null;
  var quotaPopAnchor = null;
  var quotaPopTimer = 0;
  var quotaPopHideTimer = 0;
  var quotaPopText = null;
  var quotaPopNext = null;
  var composeQuota = null;
  var composeQuotaText = null;

  var quillBtn = null;
  var galaxyLayer = null;
  var insetProbeEl = null;

  var panel = null;
  var panelText = null;
  var panelPresence = null;
  var panelPresenceValue = 'none';
  var PRESENCE_LABELS = { human: 'Human', moon: 'Moon', root: 'Root', unknown: 'Unknown' };
  var UNRESOLVED_STATES = { in_flight: true, ambiguous: true, retryable: true };
  var panelTag = null;
  var panelMeta = null;
  var panelLifespan = null;
  var panelVotes = null;
  var panelLike = null;
  var panelDislike = null;
  var likeCount = null;
  var dislikeCount = null;
  var panelShareMenu = null;
  var panelShare = null;
  var sharePop = null;
  var sharePopItems = [];
  var sharePopOpen = false;
  var sharePopTimer = 0;

  /* Translation state is memory-only: nothing about a letter is persisted,
     and the server copy is never touched. */
  var panelTranslate = null;
  var translatePop = null;
  var translatePopOpen = false;
  var translatePopTimer = 0;
  var translateNote = null;
  var translateDefaultItem = null;
  var translateDefaultLabel = null;
  var translateOriginalItem = null;
  var translateRetryItem = null;
  var translateList = null;
  var translateLangItems = [];
  var translateState = 'original';
  var translateBusy = false;
  var translateReady = false;
  var translateSourceLang = null;
  var translateTargetLang = null;
  var translateDefaultTarget = null;
  var translateDefaultAvail = null;
  var translateOriginalLang = null;
  var translateToken = 0;
  var translatePrepToken = 0;
  var translatePendingKey = '';
  var translateCache = {};
  var translators = {};
  var translatorPending = {};
  var translatorGen = 0;
  var langDetector = null;
  var langDetectorPromise = null;

  var panelFeedback = null;
  var panelPrevious = null;
  var panelNext = null;
  var secretHint = null;
  var secretMode = false;
  var secretRevealed = false;
  var secretHintSeen = false;
  var secretFullText = '';
  var maskSegmenter = null;
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
  var presenceNone = null;
  var countEl = null;
  var hintEl = null;
  var ackEl = null;
  var secretEl = null;
  var submitBtn = null;
  var noticeEl = null;
  var successEl = null;
  var xShareBtn = null;
  var publicShareBtn = null;
  var publishedShareMenu = null;
  var publishedShareItems = [];
  var publishedShareStatus = null;
  var publishedShareOpen = false;
  var publishedShareTimer = 0;
  var publishedText = '';
  var published = false;
  var shareVerifySeq = 0;
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
  var toolsIntro = false;
  var letterHistory = [];
  var historyIndex = -1;
  var uncertainSubmission = null;
  var connectionTimer = 0;

  function hideToolPalette() {
    clearTimeout(toolsHideTimer);
    toolsHideTimer = 0;
    toolsRevealed = false;
    toolsIntro = false;
    hideQuotaPop();
    if (document.body) document.body.classList.remove('is-tools-revealed');
    if (discoveryBtn) {
      discoveryBtn.setAttribute('aria-expanded', 'false');
      discoveryBtn.setAttribute('aria-label', 'Show tools; activate again to discover a letter');
      discoveryBtn.title = 'Show tools; activate again to discover a letter';
    }
    if (quillBtn) {
      quillBtn.setAttribute('aria-label', 'Message to Galaxy');
      quillBtn.title = 'Message to Galaxy';
    }
  }

  function showToolPalette(initialIntro) {
    if (panelOpen || (compose && compose.open)) return;
    toolsRevealed = true;
    if (initialIntro === true) toolsIntro = true;
    else if (initialIntro === false) toolsIntro = false;
    if (document.body) document.body.classList.add('is-tools-revealed');
    if (discoveryBtn) {
      discoveryBtn.setAttribute('aria-expanded', 'true');
      discoveryBtn.setAttribute('aria-label', 'Tools shown; activate again to discover a letter');
      discoveryBtn.title = 'Tools shown; activate again to discover a letter';
    }
    if (quillBtn) {
      quillBtn.setAttribute('aria-label', 'Tools shown; activate again to write a message');
      quillBtn.title = 'Tools shown; activate again to write a message';
    }
    clearTimeout(toolsHideTimer);
    // Touch users need time to choose the second action; keep the palette open
    // until the quill or discovery control is activated again.
    if (!initialIntro && window.matchMedia && window.matchMedia('(hover: none)').matches) {
      toolsHideTimer = 0;
      return;
    }
    toolsHideTimer = setTimeout(function hideWhenIdle() {
      var nav = document.getElementById('void-topnav');
      var active = document.activeElement;
      var hovered = false;
      try {
        hovered = !!((nav && nav.matches(':hover')) || (quillBtn && quillBtn.matches(':hover')) ||
          (discoveryBtn && discoveryBtn.matches(':hover')));
      } catch (e) {}
      if (hovered || (nav && active && nav.contains(active)) ||
          (quillBtn && active === quillBtn && quillBtn.matches(':focus-visible')) ||
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

  function statRow(icon, label, value) {
    var row = make('div', 'vm-gs-row');
    var b = make('b', null, value);
    row.appendChild(b);
    var key = make('span', null);
    var ico = make('i', null, icon);
    ico.setAttribute('aria-hidden', 'true');
    key.appendChild(ico);
    key.appendChild(document.createTextNode(label));
    row.appendChild(key);
    return { row: row, value: b };
  }

  function glyph(ch) {
    var n = make('span', 'vm-gs__i', ch);
    n.setAttribute('aria-hidden', 'true');
    return n;
  }

  function sepGlyph() {
    var n = make('span', 'vm-gs__sep', '\u00b7');
    n.setAttribute('aria-hidden', 'true');
    return n;
  }

  /* ---- سهمیهٔ نامه: همان عددِ سرور برای قلم، دکمهٔ نوشتن و پنجرهٔ نوشتن ---- */
  function meterDrop() {
    var s = svgNode('svg', { viewBox: '0 0 12 14', 'aria-hidden': 'true', focusable: 'false' });
    s.setAttribute('class', 'vm-meter__d');
    s.appendChild(svgNode('path', { d: 'M6 1.1c1.9 3 3.4 5.3 3.4 7.2a3.4 3.4 0 1 1-6.8 0c0-1.9 1.5-4.2 3.4-7.2Z' }));
    return s;
  }

  function buildMeter(host, className) {
    var root = make('span', 'vm-meter' + (className ? ' ' + className : ''));
    root.setAttribute('aria-hidden', 'true');
    host.appendChild(root);
    var meter = { root: root, dots: [], limit: -1 };
    dropMeters.push(meter);
    syncMeter(meter);
    return meter;
  }

  function syncMeter(m) {
    var ready = quotaState === 'ready' && !!quota;
    var limit = ready ? quota.limit : 3;
    if (m.limit !== limit) {
      while (m.root.firstChild) m.root.removeChild(m.root.firstChild);
      m.dots = [];
      for (var i = 0; i < limit; i++) {
        var d = meterDrop();
        m.root.appendChild(d);
        m.dots.push(d);
      }
      m.limit = limit;
    }
    var remaining = ready ? quota.remaining : -1;
    for (var j = 0; j < m.dots.length; j++) {
      var full = remaining > 0 && j >= limit - remaining;
      m.dots[j].classList.toggle('is-full', full);
      m.dots[j].classList.toggle('is-empty', remaining >= 0 && !full);
    }
    m.root.classList.toggle('is-unknown', remaining < 0);
    m.root.classList.toggle('is-exhausted', remaining === 0);
  }

  function quotaLeftSec() {
    if (!quota || !quota.retry_after) return 0;
    var left = Math.ceil((quotaFetchedAt + quota.retry_after * 1000 - Date.now()) / 1000);
    return left > 0 ? left : 0;
  }

  function quotaWait(sec) {
    sec = Math.max(0, Math.ceil(Number(sec) || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    if (h > 0) return h + ' h' + (m ? ' ' + m + ' m' : '');
    if (m > 0) return m + ' m';
    return sec + ' s';
  }

  function quotaExhaustedNow() {
    if (quotaState !== 'ready' || !quota || quota.remaining > 0) return false;
    if (quota.retry_after > 0 && quotaLeftSec() === 0) return false;
    return true;
  }

  function quotaStateText() {
    if (quotaState !== 'ready' || !quota) return '';
    if (quota.remaining > 0) return quota.remaining + ' of ' + quota.limit + ' letters available today';
    var wait = quotaLeftSec();
    return 'No letters left today' + (wait > 0 ? '. Next letter in ' + quotaWait(wait) : '');
  }

  function renderQuota() {
    for (var i = 0; i < dropMeters.length; i++) syncMeter(dropMeters[i]);
    var sr = document.getElementById('void-god-quota-sr');
    if (sr) sr.textContent = quotaStateText();
    if (quotaState === 'ready' && quota) {
      if (composeQuota) {
        composeQuota.hidden = false;
        composeQuota.classList.toggle('is-exhausted', quota.remaining === 0);
        var left = quotaLeftSec();
        composeQuotaText.textContent = quota.remaining > 0
          ? quota.remaining + ' of ' + quota.limit + ' inks left'
          : 'No ink left' + (left > 0 ? ' \u00b7 next in ' + quotaWait(left) : '');
      }
    } else if (composeQuota) {
      composeQuota.hidden = true;
    }
    updateQuotaPop();
  }

  function setQuota(q) {
    quota = q || null;
    quotaState = q ? 'ready' : 'unavailable';
    quotaFetchedAt = q ? Date.now() : quotaFetchedAt;
    renderQuota();
    scheduleQuotaTick();
  }

  function refreshQuota(force) {
    if (DEV_DEMO || !api || typeof api.quota !== 'function') {
      quotaState = 'unavailable';
      renderQuota();
      return Promise.resolve(null);
    }
    if (quotaPromise) return quotaPromise;
    if (!force && quota && Date.now() - quotaFetchedAt < 30000) {
      renderQuota();
      return Promise.resolve(quota);
    }
    if (!quota) {
      quotaState = 'loading';
      renderQuota();
    }
    // A publication can land while this read is in flight; its answer predates
    // the new letter, so it must not overwrite the newer local count.
    var gen = quotaGen;
    quotaPromise = api.quota().then(function (q) {
      quotaPromise = null;
      if (gen !== quotaGen) return quota;
      setQuota(q);
      return quota;
    }, function () {
      quotaPromise = null;
      if (gen !== quotaGen) return quota;
      setQuota(null);
      return null;
    });
    return quotaPromise;
  }

  /* The 429 body owns retry_after; mirror it until the next server reply. */
  function noteQuotaRate(seconds) {
    var s = Number(seconds);
    if (!isFinite(s) || s <= 0) return;
    quotaGen++;
    if (quotaState === 'ready' && quota) {
      quota.used = quota.limit;
      quota.remaining = 0;
      quota.retry_after = Math.floor(s);
      quotaFetchedAt = Date.now();
      renderQuota();
      scheduleQuotaTick();
      return;
    }
    refreshQuota(true);
  }

  function noteQuotaPublished() {
    var inFlight = quotaPromise;
    quotaGen++;
    if (quotaState === 'ready' && quota && quota.remaining > 0) {
      quota.remaining -= 1;
      quota.used += 1;
      quotaFetchedAt = Date.now();
      renderQuota();
    }
    refreshQuota(true);
    if (inFlight) inFlight.then(function () { refreshQuota(true); });
  }

  function scheduleQuotaTick() {
    clearInterval(quotaTick);
    quotaTick = 0;
    if (quotaState !== 'ready' || !quota || quota.remaining > 0 || quota.retry_after <= 0) return;
    quotaTick = setInterval(function () {
      if (quotaLeftSec() === 0) {
        clearInterval(quotaTick);
        quotaTick = 0;
        refreshQuota(true);
        return;
      }
      renderQuota();
    }, 15000);
  }

  function placeQuotaPop(anchorEl) {
    if (!quotaPop || !anchorEl) return;
    var r = anchorEl.getBoundingClientRect();
    var W = quotaPop.offsetWidth, H = quotaPop.offsetHeight;
    var m = 8, gap = 10;
    var left;
    if (r.right + gap + W <= window.innerWidth - m) left = r.right + gap;
    else if (r.left - gap - W >= m) left = r.left - gap - W;
    else left = clamp(r.left + r.width / 2 - W / 2, m, Math.max(m, window.innerWidth - m - W));
    var top = clamp(r.top + r.height / 2 - H / 2, m, Math.max(m, window.innerHeight - m - H));
    quotaPop.style.left = Math.round(left) + 'px';
    quotaPop.style.top = Math.round(top) + 'px';
  }

  function updateQuotaPop() {
    if (!quotaPop) return;
    var ready = quotaState === 'ready' && !!quota;
    if (!ready) {
      quotaPopText.textContent = '';
      quotaPopNext.hidden = true;
      if (quotaPopAnchor) hideQuotaPop();
      return;
    }
    quotaPop.classList.toggle('is-exhausted', quota.remaining === 0);
    quotaPopText.textContent = quota.remaining + ' / ' + quota.limit + ' available today';
    var left = quotaLeftSec();
    quotaPopNext.hidden = quota.remaining > 0 || left === 0;
    quotaPopNext.textContent = quota.remaining === 0 && left > 0 ? 'Next letter in ' + quotaWait(left) : '';
  }

  function showQuotaPop(anchorEl, touch) {
    if (!quotaPop || !anchorEl || quotaState !== 'ready' || !quota) return;
    clearTimeout(quotaPopHideTimer);
    quotaPopHideTimer = 0;
    clearTimeout(quotaPopTimer);
    quotaPopTimer = 0;
    quotaPopAnchor = anchorEl;
    quotaPop.hidden = false;
    updateQuotaPop();
    placeQuotaPop(anchorEl);
    requestAnimationFrame(function () {
      if (quotaPop && !quotaPop.hidden && quotaPopAnchor === anchorEl) quotaPop.classList.add('is-on');
    });
    if (touch) {
      quotaPopTimer = setTimeout(function () {
        quotaPopTimer = 0;
        hideQuotaPop();
      }, 3600);
    }
  }

  function hideQuotaPop() {
    clearTimeout(quotaPopTimer);
    quotaPopTimer = 0;
    clearTimeout(quotaPopHideTimer);
    quotaPopHideTimer = 0;
    quotaPopAnchor = null;
    if (!quotaPop || quotaPop.hidden) return;
    quotaPop.classList.remove('is-on');
    setTimeout(function () {
      if (quotaPop && !quotaPop.classList.contains('is-on')) quotaPop.hidden = true;
    }, 220);
  }

  function scheduleQuotaPopHide() {
    clearTimeout(quotaPopHideTimer);
    quotaPopHideTimer = setTimeout(function () {
      quotaPopHideTimer = 0;
      hideQuotaPop();
    }, 140);
  }

  function touchPointer() {
    try { return !!(window.matchMedia && window.matchMedia('(hover: none)').matches); } catch (e) { return false; }
  }

  function canHoverExpand() {
    try {
      return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
    } catch (e) { return false; }
  }

  /* مرحلهٔ سوم: اگر نشانگر روی تبلت بماند، پنلِ کامل بدونِ کلیک باز می‌شود. */
  function armHoverOpen() {
    if (statsOpen || !canHoverExpand()) return;
    statsHovered = true;
    clearTimeout(statsHoverTimer);
    statsHoverTimer = setTimeout(function () {
      statsHoverTimer = 0;
      if (statsHovered) openStats();
    }, 320);
  }

  function disarmHover() {
    statsHovered = false;
    clearTimeout(statsHoverTimer);
    statsHoverTimer = 0;
  }

  /* مهلتِ کوتاه برای عبورِ نشانگر از تبلت به پنل؛ بدونِ آن لبه‌ها می‌لرزند. */
  function armHoverClose() {
    clearTimeout(statsCloseTimer);
    if (!statsOpen) return;
    statsCloseTimer = setTimeout(function () {
      statsCloseTimer = 0;
      if (!statsHovered) closeStats(false);
    }, 320);
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
    var liveDot = make('span', 'vm-gs__dot');
    liveDot.setAttribute('aria-hidden', 'true');
    liveDotEl = liveDot;
    people.appendChild(liveDot);
    people.appendChild(glyph('\ud83c\udf0c'));
    visitorsN = make('span', 'vm-gs__n', '\u2014');
    people.appendChild(visitorsN);
    people.appendChild(make('span', 'vm-gs__l', 'explorers'));
    /* Stage two: the two figures that only fit once the pointer rests on the
       pill. Compact tiers never show this block; the panel carries the detail. */
    var more = make('span', 'vm-gs__more');
    more.appendChild(sepGlyph());
    var letters = make('span', 'vm-gs__fig');
    letters.appendChild(glyph('\u2709\ufe0e'));
    num = make('span', 'vm-gs__n', '\u2014');
    letters.appendChild(num);
    letters.appendChild(make('span', 'vm-gs__l', 'letters'));
    more.appendChild(letters);
    more.appendChild(sepGlyph());
    var back = make('span', 'vm-gs__fig');
    back.appendChild(glyph('\u21bb'));
    returningN = make('span', 'vm-gs__n', '\u2014');
    back.appendChild(returningN);
    back.appendChild(make('span', 'vm-gs__l', 'returning'));
    more.appendChild(back);
    el.appendChild(people);
    el.appendChild(more);
    host.appendChild(el);
    updateStatsLabel();

    statsPanel = make('div', 'vm-gs-panel');
    statsPanel.id = 'void-galaxy-stats-panel';
    statsPanel.hidden = true;
    statsPanel.setAttribute('role', 'dialog');
    statsPanel.setAttribute('aria-modal', 'false');
    statsPanel.setAttribute('aria-label', 'Galaxy statistics');
    var r1 = statRow('\ud83c\udf0c', 'explorers', '\u2014');
    var r2 = statRow('\u2709\ufe0e', 'letters', '\u2014');
    var r3 = statRow('\u25f7', 'sessions', '\u2014');
    var r4 = statRow('\u21bb', 'returning', '\u2014');
    rowVisitors = r1.value;
    rowLetters = r2.value;
    rowSessions = r3.value;
    rowReturned = r4.value;
    statsPanel.appendChild(r1.row);
    statsPanel.appendChild(r2.row);
    statsPanel.appendChild(r3.row);
    statsPanel.appendChild(r4.row);
    var divider = make('div', 'vm-gs-div');
    divider.setAttribute('role', 'presentation');
    statsPanel.appendChild(divider);
    var r5 = statRow('\u266b', 'Golden Folder tracks', '\u2014');
    rowTracks = r5.value;
    statsPanel.appendChild(r5.row);
    var acts = make('div', 'vm-gs-acts');
    statsRead = make('button', 'vm-gs-act vm-gs-act--read');
    statsRead.type = 'button';
    statsRead.disabled = true;
    var readIco = make('span', 'vm-gs-act__ico');
    readIco.appendChild(mailSvg('vm-gs-act__svg'));
    statsRead.appendChild(readIco);
    var readTxt = make('span', 'vm-gs-act__txt');
    readTxt.appendChild(make('b', null, 'Read'));
    statsReadSub = make('small', null, 'newest letter');
    readTxt.appendChild(statsReadSub);
    // Same 9px the Write meter occupies, so both titles share one baseline.
    var readPad = make('span', 'vm-gs-act__pad');
    readPad.setAttribute('aria-hidden', 'true');
    readTxt.appendChild(readPad);
    statsRead.appendChild(readTxt);
    statsRead.setAttribute('aria-label', 'No letters yet');

    statsWrite = make('button', 'vm-gs-act vm-gs-act--write');
    statsWrite.type = 'button';
    statsWrite.title = 'Write an anonymous letter';
    statsWrite.setAttribute('aria-label', 'Write an anonymous letter');
    statsWrite.setAttribute('aria-describedby', 'void-god-quota-sr');
    var writeIco = make('span', 'vm-gs-act__ico');
    writeIco.appendChild(quillSvg(19, 'vm-gs-act__quill'));
    statsWrite.appendChild(writeIco);
    var writeTxt = make('span', 'vm-gs-act__txt');
    writeTxt.appendChild(make('b', null, 'Write'));
    writeTxt.appendChild(make('small', null, 'anonymous letter'));
    buildMeter(writeTxt, 'vm-gs-act__meter');
    statsWrite.appendChild(writeTxt);
    acts.appendChild(statsRead);
    acts.appendChild(statsWrite);
    statsPanel.appendChild(acts);
    host.appendChild(statsPanel);

    setTracks(readTrackCount());
    watchCatalogue();

    el.addEventListener('pointerdown', function (e) {
      lastPointerType = e.pointerType || 'mouse';
      keyboardFocus = false;
    });
    el.addEventListener('pointerenter', function (e) {
      lastPointerType = e.pointerType || 'mouse';
      if (lastPointerType === 'touch') return;
      clearTimeout(statsCloseTimer);
      statsCloseTimer = 0;
      if (statsOpen) statsHovered = true;
      else armHoverOpen();
    });
    el.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'touch') return;
      disarmHover();
      armHoverClose();
    });
    el.addEventListener('focus', function () {
      if (!keyboardFocus || suppressFocusOpen || statsOpen) return;
      openStats();
    });
    el.addEventListener('click', function (e) {
      if (lastPointerType === 'touch') {
        if (statsOpen) closeStats(false);
        else openStats();
        return;
      }
      /* ماوس/قلم: هاور خودش باز می‌کند؛ کلیک فقط بازشدن را کامل می‌کند
         (Enter/Space هم همین مسیر را دارند). */
      openStats();
    });
    statsPanel.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'touch') return;
      statsHovered = true;
      clearTimeout(statsHoverTimer);
      statsHoverTimer = 0;
      clearTimeout(statsCloseTimer);
      statsCloseTimer = 0;
    });
    statsPanel.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'touch') return;
      statsHovered = false;
      armHoverClose();
    });
    document.addEventListener('focusin', function (e) {
      if (!statsOpen) return;
      if (el.contains(e.target) || statsPanel.contains(e.target)) return;
      closeStats(false);
    });
    window.addEventListener('keydown', function () { keyboardFocus = true; }, true);
    window.addEventListener('pointerdown', function () { keyboardFocus = false; }, true);
    statsRead.addEventListener('click', readNewest);
    statsWrite.addEventListener('click', writeFromStats);
    statsWrite.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'touch') return;
      showQuotaPop(statsWrite, false);
    });
    statsWrite.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'touch') return;
      scheduleQuotaPopHide();
    });
    statsWrite.addEventListener('focus', function () { showQuotaPop(statsWrite, false); });
    statsWrite.addEventListener('blur', function () { scheduleQuotaPopHide(); });
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
    /* پنل از همان گوشه‌ای باز می‌شود که به تبلت نزدیک است تا بازشدن
       شبیهِ بازشدنِ خودِ تبلت دیده شود، نه یک پنجرهٔ جدا. */
    var ox = best.left + W / 2 > r.left + r.width / 2 ? 'left' : 'right';
    var oy = best.top + H / 2 > r.top + r.height / 2 ? 'top' : 'bottom';
    statsPanel.style.transformOrigin = ox + ' ' + oy;
  }

  function openStats() {
    if (!statsPanel || statsOpen) return;
    statsOpen = true;
    clearTimeout(statsHoverTimer);
    statsHoverTimer = 0;
    clearTimeout(statsCloseTimer);
    statsCloseTimer = 0;
    clearTimeout(hideTimer);
    statsPanel.hidden = false;
    el.setAttribute('aria-expanded', 'true');
    placeStats();
    requestAnimationFrame(function () {
      if (statsOpen && statsPanel) statsPanel.classList.add('is-on');
    });
    refreshCount();
    refreshQuota(false);
  }

  function closeStats(focus) {
    clearTimeout(statsHoverTimer);
    statsHoverTimer = 0;
    clearTimeout(statsCloseTimer);
    statsCloseTimer = 0;
    statsHovered = false;
    if (!statsOpen) return;
    statsOpen = false;
    statsPanel.classList.remove('is-on');
    el.setAttribute('aria-expanded', 'false');
    setTimeout(function () {
      if (!statsOpen && statsPanel) statsPanel.hidden = true;
    }, 300);
    if (focus) {
      suppressFocusOpen = true;
      try { el.focus({ preventScroll: true }); } catch (e) {}
      setTimeout(function () { suppressFocusOpen = false; }, 0);
    }
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

  /* The same composer as the quill: no second form, no second submit path. */
  function writeFromStats() {
    if (quotaExhaustedNow()) {
      showQuotaPop(statsWrite, touchPointer());
      refreshQuota(true);
      return;
    }
    hideQuotaPop();
    closeStats(true);
    openCompose();
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

  /* A failed refresh must not look like a fresh one: the dot stops breathing
     and dims, and the tooltip says why in plain words. Values already on
     screen stay untouched. */
  function setStatsStale(stale, reason) {
    stale = !!stale;
    statsStale = stale;
    statsStaleReason = stale ? (reason || 'unavailable') : '';
    if (liveDotEl) {
      liveDotEl.style.background = stale ? 'rgba(235, 240, 245, .42)' : '';
      liveDotEl.style.boxShadow = stale ? 'none' : '';
      liveDotEl.style.animation = stale ? 'none' : '';
      liveDotEl.style.opacity = stale ? '.8' : '';
      liveDotEl.style.transform = stale ? 'none' : '';
    }
    if (el) {
      el.title = !stale ? 'Galaxy statistics'
        : reason === 'partial' ? 'Galaxy statistics \u2014 some statistics unavailable'
        : reason === 'offline' ? 'Galaxy statistics \u2014 connection lost, retrying'
        : 'Galaxy statistics \u2014 service unavailable, retrying';
    }
    updateStatsLabel();
  }

  function pctText(ratio) {
    return ratio === null ? '\u2014' : Math.round(ratio * 100) + '%';
  }

  /* Fill only what is still unavailable; a value already on screen is never
     replaced by an older one. */
  function restoreLastGood() {
    if (statsLastGood.letters !== null && letterTotal === null) {
      setCount(statsLastGood.letters);
    }
    if (statsLastGood.visitors !== null && visitorsN && visitorsN.textContent === '\u2014') {
      visitorsN.textContent = fmt(statsLastGood.visitors);
      if (rowVisitors) rowVisitors.textContent = fmt(statsLastGood.visitors);
    }
    if (statsLastGood.sessions !== null && rowSessions && rowSessions.textContent === '\u2014') {
      rowSessions.textContent = fmt(statsLastGood.sessions);
    }
    if (statsLastGood.returning !== null) {
      var pct = pctText(statsLastGood.returning);
      if (returningN && returningN.textContent === '\u2014') returningN.textContent = pct;
      if (rowReturned && rowReturned.textContent === '\u2014') rowReturned.textContent = pct;
    }
    updateStatsLabel();
  }

  function setCount(n) {
    if (!mount()) return false;
    if (n === null || n === undefined) return false;
    n = Math.floor(Number(n));
    if (!isFinite(n) || n < 0) return false;
    clearTimeout(hideTimer);
    letterTotal = n;
    statsLastGood.letters = n;
    num.textContent = fmt(n);
    if (rowLetters) rowLetters.textContent = num.textContent;
    if (statsRead) {
      var can = n > 0;
      statsRead.disabled = !can;
      if (statsReadSub) statsReadSub.textContent = can ? 'newest letter' : 'no letters yet';
      statsRead.title = can ? 'Read the newest letter' : 'The galaxy has no letters yet';
      statsRead.setAttribute('aria-label', can ? 'Read the newest letter' : 'No letters yet');
    }
    updateStatsLabel();
    showPill();
    return true;
  }

  function updateStatsLabel() {
    if (!el) return;
    var explorers = visitorsN ? visitorsN.textContent : '\u2014';
    var letters = num ? num.textContent : '\u2014';
    var tracks = trackTotal > 0 ? fmt(trackTotal) : '\u2014';
    el.setAttribute('aria-label',
      'Galaxy statistics: ' + explorers + ' explorers, ' + letters +
      ' letters, ' + tracks + ' tracks in the Golden Folder' +
      (statsStale
        ? (statsStaleReason === 'partial'
          ? ', some statistics unavailable'
          : ', statistics unavailable')
        : ''));
  }

  /* Each metric is merged on its own: an absent or invalid sessions/returning
     value keeps the previous one on screen instead of blanking it. */
  function setVisitors(s) {
    if (!s) return;
    var changed = false;
    var u = s.u === null || s.u === undefined ? NaN : Number(s.u);
    if (isFinite(u) && u >= 0) {
      statsLastGood.visitors = u;
      if (visitorsN) visitorsN.textContent = fmt(u);
      if (rowVisitors) rowVisitors.textContent = fmt(u);
      changed = true;
    }
    var t = s.t === null || s.t === undefined ? NaN : Number(s.t);
    if (isFinite(t) && t >= 0) {
      statsLastGood.sessions = Math.floor(t);
      changed = true;
    }
    var r = s.r === null || s.r === undefined ? NaN : Number(s.r);
    if (isFinite(r)) {
      statsLastGood.returning = Math.min(1, Math.max(0, r));
      changed = true;
    }
    if (!changed) return;
    if (rowSessions) {
      rowSessions.textContent = statsLastGood.sessions === null
        ? '\u2014' : fmt(statsLastGood.sessions);
    }
    var pct = pctText(statsLastGood.returning);
    if (returningN) returningN.textContent = pct;
    if (rowReturned) rowReturned.textContent = pct;
    updateStatsLabel();
    showPill();
  }

  /* The Golden Folder catalogue lives on the page (static file first, then the
     managed list). The card only mirrors it; it never fetches a second time. */
  function readTrackCount() {
    try {
      var g = window.VoidGolden;
      var list = g && typeof g.getTracks === 'function' ? g.getTracks() : null;
      return Array.isArray(list) ? list.length : 0;
    } catch (e) { return 0; }
  }

  function setTracks(n) {
    if (n === null || n === undefined) return;
    n = Math.floor(Number(n));
    trackTotal = isFinite(n) && n > 0 ? n : 0;
    if (rowTracks) rowTracks.textContent = trackTotal ? fmt(trackTotal) : '\u2014';
    updateStatsLabel();
  }

  /* The catalogue also announces every later successful update (including a
     retry), which the one-shot promise cannot carry. Bind once; read the
     current snapshot on bind so an early-settled catalogue still lands. */
  function bindCatalogueEvents() {
    if (catalogueEventsBound) return;
    catalogueEventsBound = true;
    document.addEventListener('void:catalogue', function (e) {
      var n = e && e.detail ? e.detail.count : null;
      setTracks(typeof n === 'number' ? n : readTrackCount());
    });
    setTracks(readTrackCount());
  }

  function watchCatalogue() {
    bindCatalogueEvents();
    var g = window.VoidGolden;
    if (!g || !g.ready || typeof g.ready.then !== 'function') return;
    g.ready.then(function (list) {
      setTracks(Array.isArray(list) ? list.length : readTrackCount());
    }, function () {
      setTracks(readTrackCount());
    });
  }

  /* یک hit در هر نشستِ مرورگر با یک شناسهٔ پایدار؛ هر تلاش دوباره همان شناسه
     را می‌فرستد تا Worker نتواند نشست را دوبار بشمارد. `vgm-counted` فقط بعد
     از تأیید Worker نوشته می‌شود. احترام به DNT/GPC مثل شمارندهٔ قبلی: در آن
     حالت فقط آمار خوانده می‌شود. اعداد هرگز به موفقیتِ نوشتن وابسته نیستند. */
  var visitRegistrar = null;

  function startVisitors() {
    if (visitorsStarted || !api || typeof api.createVisitRegistrar !== 'function') return;
    visitorsStarted = true;
    var nav = window.navigator || {};
    visitRegistrar = api.createVisitRegistrar({
      sessionStore: window.sessionStorage,
      persistentStore: window.localStorage,
      isOnline: function () { return window.navigator.onLine !== false; },
      isSuppressed: function () {
        return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
      },
      onConfirmed: function () { refreshSiteStats(); }
    });
    visitRegistrar.start();
    window.addEventListener('online', function () {
      if (visitRegistrar) visitRegistrar.retryNow();
    });
    window.addEventListener('pageshow', function () {
      if (visitRegistrar) visitRegistrar.retryNow();
    });
    document.addEventListener('visibilitychange', function () {
      if (visitRegistrar && document.visibilityState === 'visible') visitRegistrar.retryNow();
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
    submitBtn.textContent = uncertainSubmission ? 'Check submission' : "Let's go";
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
    var nav = make('div', 'void-god-panel__actions');
    panelPrevious = make('button', 'void-god-nav__button');
    panelPrevious.type = 'button';
    panelPrevious.disabled = true;
    panelPrevious.setAttribute('aria-label', 'Previous letter');
    panelPrevious.title = 'Previous letter';
    var previousArrow = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    previousArrow.appendChild(svgNode('path', { d: 'M14.5 5.5 8 12l6.5 6.5' }));
    panelPrevious.appendChild(previousArrow);
    panelNext = make('button', 'void-god-nav__button');
    panelNext.type = 'button';
    panelNext.disabled = source.kind !== 'api';
    panelNext.setAttribute('aria-label', 'Next letter');
    panelNext.title = 'Next letter';
    var nextArrow = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    nextArrow.appendChild(svgNode('path', { d: 'M9.5 5.5 16 12l-6.5 6.5' }));
    panelNext.appendChild(nextArrow);
    var x = make('button', 'void-god-x', '\u00D7');
    x.type = 'button';
    x.id = 'void-god-panel-close';
    x.setAttribute('aria-label', 'Close message');

    panelTranslate = make('button', 'void-god-translate');
    panelTranslate.type = 'button';
    panelTranslate.id = 'void-god-panel-translate';
    panelTranslate.disabled = true;
    panelTranslate.setAttribute('aria-label', 'Translate letter');
    panelTranslate.title = 'Translate letter';
    panelTranslate.setAttribute('aria-haspopup', 'menu');
    panelTranslate.setAttribute('aria-expanded', 'false');
    panelTranslate.setAttribute('aria-controls', 'void-god-translate-pop');
    panelTranslate.setAttribute('aria-pressed', 'false');
    var translateRing = make('span', 'void-god-translate__ring');
    var translateGlyph = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    translateGlyph.appendChild(svgNode('circle', { cx: '12', cy: '12', r: '8.2' }));
    translateGlyph.appendChild(svgNode('path', { d: 'M3.8 12h16.4' }));
    translateGlyph.appendChild(svgNode('path', { d: 'M12 3.8c2.3 2.4 3.5 5.3 3.5 8.2s-1.2 5.8-3.5 8.2c-2.3-2.4-3.5-5.3-3.5-8.2S9.7 6.2 12 3.8Z' }));
    translateRing.appendChild(translateGlyph);
    panelTranslate.appendChild(translateRing);

    head.appendChild(panelTranslate);
    /* The writer's chosen glyph, not the viewer's state: decorative, inert,
       and reset for every letter before it is shown. */
    panelPresence = make('span', 'void-god-msg-presence');
    panelPresence.hidden = true;
    head.appendChild(panelPresence);
    head.appendChild(titles);
    head.appendChild(x);

    panelText = make('p', 'void-god-msg-text');
    panelText.id = 'void-god-panel-text';
    panelText.setAttribute('dir', 'auto');
    var messageBody = make('div', 'void-god-msg-wrap');
    panelShareMenu = make('button', 'void-god-reader-icon void-god-share-trigger');
    panelShareMenu.type = 'button';
    panelShareMenu.id = 'void-god-share-menu';
    panelShareMenu.setAttribute('aria-label', 'Share this letter');
    panelShareMenu.title = 'Share this letter';
    panelShareMenu.setAttribute('aria-haspopup', 'menu');
    panelShareMenu.setAttribute('aria-expanded', 'false');
    panelShareMenu.setAttribute('aria-controls', 'void-god-share-pop');
    var shareGlyph = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    shareGlyph.appendChild(svgNode('circle', { cx: '17', cy: '6', r: '2.2' }));
    shareGlyph.appendChild(svgNode('circle', { cx: '7', cy: '12', r: '2.2' }));
    shareGlyph.appendChild(svgNode('circle', { cx: '17', cy: '18', r: '2.2' }));
    shareGlyph.appendChild(svgNode('path', { d: 'M8.9 10.9 15.1 7.1M8.9 13.1 15.1 16.9' }));
    panelShareMenu.appendChild(shareGlyph);
    messageBody.appendChild(panelText);
    secretHint = make('p', 'void-god-secret-hint', 'Tap the stars to reveal');
    secretHint.id = 'void-god-secret-hint';
    secretHint.hidden = true;
    secretHint.setAttribute('aria-hidden', 'true');
    messageBody.appendChild(secretHint);

    panelMeta = make('p', 'void-god-msg-meta');
    panelMeta.id = 'void-god-panel-meta';

    panelLifespan = make('time', 'void-god-msg-lifespan');
    panelLifespan.id = 'void-god-panel-lifespan';
    panelLifespan.hidden = true;

    panelVotes = make('div', 'void-god-votes');
    panelVotes.id = 'void-god-votes';
    panelVotes.hidden = true;
    panelLike = make('button', 'void-god-vote');
    panelLike.type = 'button';
    panelLike.id = 'void-god-like';
    panelLike.setAttribute('aria-pressed', 'false');
    panelLike.setAttribute('aria-label', 'Like this letter');
    var voteIconPath = 'M14 9V5a3 3 0 0 0-3-3L7 9v12h11.28a2 2 0 0 0 1.97-1.65l1.38-8A2 2 0 0 0 19.66 9H14zM7 21H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3';
    var likeIcon = svgNode('svg', { viewBox: '0 0 24 24', class: 'void-god-vote__icon', 'aria-hidden': 'true', focusable: 'false' });
    likeIcon.appendChild(svgNode('path', { d: voteIconPath }));
    panelLike.appendChild(likeIcon);
    likeCount = make('span', 'void-god-vote__count', '0');
    likeCount.setAttribute('aria-hidden', 'true');
    panelLike.appendChild(likeCount);
    panelDislike = make('button', 'void-god-vote');
    panelDislike.type = 'button';
    panelDislike.id = 'void-god-dislike';
    panelDislike.setAttribute('aria-pressed', 'false');
    panelDislike.setAttribute('aria-label', 'Dislike this letter');
    var dislikeIcon = svgNode('svg', { viewBox: '0 0 24 24', class: 'void-god-vote__icon void-god-vote__icon--down', 'aria-hidden': 'true', focusable: 'false' });
    var dislikeShape = svgNode('g', { transform: 'rotate(180 12 12)' });
    dislikeShape.appendChild(svgNode('path', { d: voteIconPath }));
    dislikeIcon.appendChild(dislikeShape);
    panelDislike.appendChild(dislikeIcon);
    dislikeCount = make('span', 'void-god-vote__count', '0');
    dislikeCount.setAttribute('aria-hidden', 'true');
    panelDislike.appendChild(dislikeCount);
    panelVotes.appendChild(panelLike);
    panelVotes.appendChild(panelDislike);

    panelShare = make('button', 'void-god-reader-icon void-god-share-icon');
    panelShare.type = 'button';
    panelShare.id = 'void-god-share';
    panelShare.setAttribute('aria-label', 'Share on X');
    panelShare.title = 'Share on X';
    var xIcon = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    xIcon.appendChild(svgNode('path', { d: 'M18.901 1.153h3.68L14.54 10.356 24 22.846h-7.406l-5.8-7.584-6.636 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932Zm-1.29 19.495h2.039L6.486 3.235H4.298z' }));
    panelShare.appendChild(xIcon);
    nav.setAttribute('role', 'group');
    nav.setAttribute('aria-label', 'Letter navigation and actions');
    nav.appendChild(panelPrevious);
    nav.appendChild(panelShareMenu);
    nav.appendChild(panelVotes);
    nav.appendChild(panelShare);
    nav.appendChild(panelNext);

    panelFeedback = make('p', 'void-god-panel__status');
    panelFeedback.id = 'void-god-copy-status';
    panelFeedback.setAttribute('role', 'status');
    panelFeedback.setAttribute('aria-live', 'polite');
    panelFeedback.hidden = true;

    panel.appendChild(head);
    panel.appendChild(messageBody);
    panel.appendChild(panelLifespan);
    panel.appendChild(panelMeta);
    panel.appendChild(nav);
    panel.appendChild(panelFeedback);
    host.appendChild(panel);

    x.addEventListener('click', function () {
      closePanel({ dissolve: true, focus: true });
    });
    panelTranslate.addEventListener('click', function () {
      if (panelTranslate.disabled || translateBusy) return;
      if (translatePopOpen) { closeTranslatePop(true); return; }
      if (translateState === 'translated') { showOriginalLetter(); return; }
      openTranslatePop();
    });
    panelShareMenu.addEventListener('click', function () {
      if (sharePopOpen) closeSharePop(true);
      else openSharePop();
    });
    panelShare.addEventListener('click', onShare);
    panelLike.addEventListener('click', function () { onVote('like'); });
    panelDislike.addEventListener('click', function () { onVote('dislike'); });
    panelPrevious.addEventListener('click', function () { navigateLetter(-1); });
    panelNext.addEventListener('click', function () { navigateLetter(1); });
    panelText.addEventListener('click', onSecretTextClick);
    panelText.addEventListener('keydown', onSecretTextKey);
  }

  /* ---- Secret Ink: grapheme-safe masking, revealed in place ----
     The Worker always stores and serves the original text; this surface only
     decides what is painted. Whitespace and line breaks survive masking so the
     shape of a paragraph still reads as a paragraph. */
  function secretGraphemes(text) {
    try {
      if (!maskSegmenter && typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        maskSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      }
      if (maskSegmenter) {
        return Array.from(maskSegmenter.segment(text), function (part) { return part.segment; });
      }
    } catch (e) {}
    return Array.from(text);
  }

  function maskSecretText(text) {
    var parts = secretGraphemes(typeof text === 'string' ? text : '');
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      out += /^\s+$/.test(parts[i]) ? parts[i] : '\u2022';
    }
    return out;
  }

  function paintPanelText() {
    if (!panelText) return;
    var concealed = secretMode && !secretRevealed;
    var top = panelText.scrollTop;
    panelText.textContent = concealed ? maskSecretText(secretFullText) : secretFullText;
    panelText.scrollTop = top;
    panelText.classList.toggle('is-secret-ink', secretMode);
    panelText.classList.toggle('is-concealed', concealed);
    if (secretMode) {
      panelText.tabIndex = 0;
      panelText.setAttribute('role', 'button');
      panelText.setAttribute('aria-pressed', concealed ? 'false' : 'true');
      panelText.setAttribute('aria-label', concealed
        ? 'Whispered letter, hidden. Activate to reveal.'
        : 'Whispered letter revealed. Activate to hide.');
    } else {
      panelText.removeAttribute('tabindex');
      panelText.removeAttribute('role');
      panelText.removeAttribute('aria-pressed');
      panelText.removeAttribute('aria-label');
    }
    if (secretHint) secretHint.hidden = !concealed || secretHintSeen;
    paintPresence();
  }

  /* One dot stands in for every non-none mark while Secret Ink is concealed,
     so the glyph, the label, the title, and the class names never reveal which
     presence was chosen. The actual name only reaches the DOM after reveal. */
  function presenceDotSvg() {
    var svg = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    svg.appendChild(svgNode('circle', { cx: '12', cy: '12', r: '3.2', fill: 'currentColor', stroke: 'none' }));
    return svg;
  }

  function paintPresence() {
    if (!panelPresence) return;
    var known = Object.prototype.hasOwnProperty.call(PRESENCE_LABELS, panelPresenceValue);
    var kind = known ? panelPresenceValue : 'none';
    while (panelPresence.firstChild) panelPresence.removeChild(panelPresence.firstChild);
    panelPresence.classList.remove('is-concealed');
    panelPresence.removeAttribute('title');
    if (kind === 'none') {
      panelPresence.hidden = true;
      panelPresence.removeAttribute('role');
      panelPresence.removeAttribute('aria-label');
      return;
    }
    panelPresence.hidden = false;
    panelPresence.setAttribute('role', 'img');
    if (secretMode && !secretRevealed) {
      panelPresence.classList.add('is-concealed');
      panelPresence.setAttribute('aria-label', 'Presence concealed');
      panelPresence.appendChild(presenceDotSvg());
      return;
    }
    panelPresence.setAttribute('aria-label', 'Symbolic presence: ' + PRESENCE_LABELS[kind]);
    panelPresence.title = PRESENCE_LABELS[kind] + ' presence';
    panelPresence.appendChild(presenceSvg(kind));
  }

  function setPresenceValue(value) {
    panelPresenceValue = typeof value === 'string' && Object.prototype.hasOwnProperty.call(PRESENCE_LABELS, value)
      ? value : 'none';
    paintPresence();
  }

  function setPanelText(text, secret) {
    secretFullText = typeof text === 'string' ? text : '';
    secretMode = secret === true;
    secretRevealed = false;
    secretHintSeen = false;
    paintPanelText();
  }

  /* Translation replaces what is shown, not whether it is hidden. */
  function updatePanelText(text) {
    secretFullText = typeof text === 'string' ? text : '';
    paintPanelText();
  }

  function clearSecretText() {
    secretMode = false;
    secretRevealed = false;
    secretHintSeen = false;
    secretFullText = '';
    panelPresenceValue = 'none';
    if (panelText) {
      panelText.classList.remove('is-secret-ink', 'is-concealed');
      panelText.removeAttribute('tabindex');
      panelText.removeAttribute('role');
      panelText.removeAttribute('aria-pressed');
      panelText.removeAttribute('aria-label');
    }
    if (secretHint) secretHint.hidden = true;
    paintPresence();
  }

  function toggleSecretReveal() {
    if (!secretMode) return;
    secretRevealed = !secretRevealed;
    if (secretRevealed) secretHintSeen = true;
    paintPanelText();
  }

  function onSecretTextClick(e) {
    if (!secretMode) return;
    var sel = window.getSelection ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && panelText && panelText.contains(sel.anchorNode)) return;
    e.stopPropagation();
    toggleSecretReveal();
  }

  function onSecretTextKey(e) {
    if (!secretMode) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'Space' || e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      toggleSecretReveal();
    }
  }

  function renderMessage(msg) {
    resetTranslation();
    voteBusy = false;
    setPresenceValue(msg.presence);
    setPanelText(msg.text, msg.secret_ink === true);
    if (msg.lang) panelText.setAttribute('lang', msg.lang);
    else panelText.removeAttribute('lang');
    translateOriginalLang = msg.lang || null;
    if (panelTranslate) panelTranslate.disabled = false;
    panelTag.textContent = source.tag;
    panelMeta.textContent = source.kind === 'demo'
      ? 'Sample message from the local demo set \u2014 no real messages have arrived yet. Nothing is sent or stored.'
      : '';
    clearTimeout(feedbackTimer);
    panelFeedback.hidden = true;
    panelFeedback.textContent = '';
    closeSharePop(false);
    panelShareMenu.disabled = false;
    panelShareMenu.setAttribute('aria-label', 'Share this letter');
    panelShareMenu.title = 'Share this letter';
    var canShare = !!messageLink(msg);
    panelShare.disabled = !canShare;
    panelShare.title = canShare
      ? 'Share this letter on X'
      : 'This message has no public link \u2014 use Share instead';
    panelShare.setAttribute('aria-label', canShare
      ? 'Share this letter on X'
      : 'Sharing unavailable \u2014 share the message instead');
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

  function messageVote(msg, id) {
    return msg && Object.prototype.hasOwnProperty.call(msg, 'my_vote')
      ? msg.my_vote
      : loadVotes()[id] || null;
  }

  function renderVotes(msg) {
    if (!panelVotes) return;
    var id = msg && typeof msg.id === 'string' ? msg.id : '';
    var canVote = source.kind === 'api' && !!id && !!api &&
      typeof api.vote === 'function' && typeof api.retractVote === 'function' && !msg.faded;
    panelVotes.hidden = !canVote;
    if (!canVote) {
      panelLike.disabled = true;
      panelDislike.disabled = true;
      return;
    }
    var voted = messageVote(msg, id);
    likeCount.textContent = String(Number(msg.votes_like) || 0);
    dislikeCount.textContent = String(Number(msg.votes_dislike) || 0);
    panelLike.setAttribute('aria-label', 'Like this letter, ' + likeCount.textContent + ' votes');
    panelDislike.setAttribute('aria-label', 'Dislike this letter, ' + dislikeCount.textContent + ' votes');
    panelLike.disabled = voteBusy;
    panelDislike.disabled = voteBusy;
    panelLike.classList.toggle('is-voted', voted === 'like');
    panelDislike.classList.toggle('is-voted', voted === 'dislike');
    panelLike.setAttribute('aria-pressed', voted === 'like' ? 'true' : 'false');
    panelDislike.setAttribute('aria-pressed', voted === 'dislike' ? 'true' : 'false');
    panelLike.title = voted === 'like'
      ? 'Remove your like'
      : voted === 'dislike'
        ? 'Change your vote to like'
      : 'Like this letter and add one day';
    panelDislike.title = voted === 'dislike'
      ? 'Remove your dislike'
      : voted === 'like'
        ? 'Change your vote to dislike'
      : 'Dislike this letter and remove one day';
  }

  function projectedExpiry(msg, netDelta) {
    var exp = Number(msg.expires_at) || 0;
    if (!exp) return exp;
    var cap = (Number(msg.created_at) || exp) + MAX_LIFETIME_SEC;
    var floor = Math.floor(Date.now() / 1000) + MIN_REMAINING_SEC;
    return Math.min(cap, Math.max(floor, exp + DAY_SEC * netDelta));
  }

  /* Optimistic: the count and the countdown move at once, then the server
     reply replaces them. Any failure restores the previous numbers. */
  function onVote(type) {
    if (!currentMessage || voteBusy) return;
    var msg = currentMessage;
    var id = msg && typeof msg.id === 'string' ? msg.id : '';
    if (!id || source.kind !== 'api' || !api || typeof api.vote !== 'function' ||
        typeof api.retractVote !== 'function') return;
    var previousVote = messageVote(msg, id);
    var nextVote = previousVote === type ? null : type;
    var score = function (vote) { return vote === 'like' ? 1 : vote === 'dislike' ? -1 : 0; };
    var netDelta = score(nextVote) - score(previousVote);
    var before = {
      expires_at: msg.expires_at,
      likes: msg.votes_like,
      dislikes: msg.votes_dislike,
      my_vote: previousVote
    };
    voteBusy = true;
    msg.my_vote = nextVote;
    msg.expires_at = projectedExpiry(msg, netDelta);
    msg.votes_like = (Number(msg.votes_like) || 0) - (previousVote === 'like' ? 1 : 0) + (nextVote === 'like' ? 1 : 0);
    msg.votes_dislike = (Number(msg.votes_dislike) || 0) - (previousVote === 'dislike' ? 1 : 0) + (nextVote === 'dislike' ? 1 : 0);
    renderVotes(msg);
    renderLifespan(msg.expires_at, netDelta > 0 ? 'like' : netDelta < 0 ? 'dislike' : null);
    feedback(nextVote === null
      ? 'Removing your vote\u2026'
      : previousVote
        ? 'Changing your vote\u2026'
        : (type === 'like' ? 'The star grows brighter\u2026' : 'The star grows dimmer\u2026'), false);

    function restore() {
      msg.expires_at = before.expires_at;
      msg.votes_like = before.likes;
      msg.votes_dislike = before.dislikes;
      msg.my_vote = before.my_vote;
      renderLifespan(msg.expires_at);
    }

    var request = nextVote === null ? api.retractVote(id) : api.vote(id, nextVote);
    request.then(function (res) {
      voteBusy = false;
      if (res.status === 'ok') {
        msg.expires_at = res.letter.expires_at || msg.expires_at;
        msg.votes_like = res.letter.votes_like;
        msg.votes_dislike = res.letter.votes_dislike;
        msg.my_vote = res.type;
        if (res.type) saveVote(id, res.type);
        else forgetVote(id);
        renderLifespan(msg.expires_at, netDelta > 0 ? 'like' : netDelta < 0 ? 'dislike' : null);
        feedback(!res.changed
          ? (res.type ? 'Your vote is already set.' : 'You have no active vote to remove.')
          : !res.type
            ? 'Your vote was removed.'
            : previousVote
              ? 'Your vote was changed.'
              : res.capped
                ? (res.type === 'like'
                  ? 'This star already shines at its brightest.'
                  : 'This letter is already as close to fading as it can get.')
                : (res.type === 'like'
                  ? 'A day was added to this star.'
                  : 'A day was taken from this star.'), false);
      } else if (res.status === 'already') {
        msg.my_vote = res.type;
        saveVote(id, res.type);
        msg.expires_at = res.letter.expires_at || msg.expires_at;
        msg.votes_like = res.letter.votes_like;
        msg.votes_dislike = res.letter.votes_dislike;
        renderLifespan(msg.expires_at);
        feedback('You already voted on this letter in this session.', false);
      } else if (res.status === 'not_found') {
        forgetVote(id);
        msg.my_vote = null;
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
    resetTranslation();
    clearSecretText();
    currentMessage = null;
    voteBusy = false;
    clearLifespanTimer();
    panelTag.textContent = source.tag;
    closeSharePop(false);
    if (panelTranslate) panelTranslate.disabled = true;
    panelShareMenu.disabled = true;
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

  function refreshSiteStats() {
    if (!api) return Promise.resolve();
    /* Nothing can be fresh without a connection; show the existing subtle stale
       state instead of leaving the pill looking live. Values stay untouched. */
    if (window.navigator && window.navigator.onLine === false) {
      setStatsStale(true, 'offline');
      return Promise.resolve();
    }
    if (document.visibilityState === 'hidden') return Promise.resolve();
    refreshQuota(false);
    if (siteStatsRefreshPromise) {
      siteStatsRefreshQueued = true;
      return siteStatsRefreshPromise;
    }
    siteStatsRefreshQueued = false;
    /* The fallback reads each endpoint on its own so one failing source never
       blocks the other. Freshness is reported per source. */
    function fallbackStats() {
      var lettersOk = false;
      var visitorsOk = false;
      var a = api.count().then(function (n) {
        if (n !== null) { setCount(n); lettersOk = true; }
      }, function () {});
      var b = api.visitorStats().then(function (s) {
        if (s) { setVisitors(s); visitorsOk = true; }
      }, function () {});
      return Promise.all([a, b]).then(function () {
        return { letters: lettersOk, visitors: visitorsOk };
      });
    }
    function failureReason() {
      if (window.navigator && window.navigator.onLine === false) return 'offline';
      try {
        var f = api && typeof api.lastFailure === 'function' ? api.lastFailure() : null;
        if (f && (f.kind === 'network' || f.kind === 'timeout')) return 'offline';
      } catch (e) {}
      return 'unavailable';
    }
    var update = feed && typeof feed.refreshLatest === 'function'
      ? feed.refreshLatest().then(function (result) {
          if (result && result.status === 'ok') {
            var lettersOk = false;
            if (result.count !== null) { setCount(result.count); lettersOk = true; }
            if (result.visitors) setVisitors(result.visitors);
            return { letters: lettersOk, visitors: !!result.visitors };
          }
          return fallbackStats();
        })
      : fallbackStats();
    var settled = update.then(function (fresh) {
      var lettersOk = !!(fresh && fresh.letters);
      var visitorsOk = !!(fresh && fresh.visitors);
      var complete = lettersOk && visitorsOk;
      /* One failing source is not a total outage: keep the healthy metrics
         looking fresh and use neutral wording for the rest. */
      if (!complete) restoreLastGood();
      setStatsStale(!complete, complete ? '' : lettersOk || visitorsOk ? 'partial' : failureReason());
      return complete;
    }, function () {
      restoreLastGood();
      setStatsStale(true, failureReason());
      return false;
    });
    function finishRefresh() {
      siteStatsRefreshPromise = null;
      if (!siteStatsRefreshQueued) return;
      siteStatsRefreshQueued = false;
      return refreshSiteStats();
    }
    siteStatsRefreshPromise = settled.then(finishRefresh, finishRefresh);
    return siteStatsRefreshPromise;
  }

  function scheduleSiteStatsRefresh() {
    if (siteStatsTimer) return;
    siteStatsTimer = setInterval(refreshSiteStats, 60 * 1000);
    window.addEventListener('pageshow', refreshSiteStats);
    window.addEventListener('online', refreshSiteStats);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refreshSiteStats();
    });
  }

  function startRemote() {
    if (remoteStarted || source.kind !== 'api' || !api) return;
    remoteStarted = true;
    if (!feed) feed = api.createFeed();
    feed.prefetch();
    refreshQuota(true);
    refreshSiteStats();
    startVisitors();
    scheduleSiteStatsRefresh();
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
    var isCompactTouchLandscape = window.matchMedia && window.matchMedia(
      '(orientation: landscape) and (hover: none) and (pointer: coarse) and (max-height: 520px)'
    ).matches;
    var isMobileViewport = window.matchMedia && window.matchMedia('(max-width: 520px)').matches;
    var availableHeight = Math.max(120, bottom - top);
    var cap = isCompactTouchLandscape
      ? Math.min(window.innerHeight * 0.94, availableHeight)
      : isMobileViewport
        ? Math.min(window.innerHeight * 0.9, availableHeight)
      : Math.min(380, window.innerHeight * 0.56, Math.max(120, bottom - top));
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
    closeSharePop(false);
    resetTranslation({ release: true });
    setReadingMode(false);
    if (!preserveReaderState) restoreMusicPresentation();
    secretRevealed = false;
    paintPresence();
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
    closeSharePop(false);
    resetTranslation({ release: true });
    setReadingMode(false);
    restoreMusicPresentation();
    currentMessage = null;
    /* The reveal state is per letter. Closing returns the mark to the shared
       concealed dot without repainting the text during the dissolve. */
    secretRevealed = false;
    paintPresence();
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

  function feedback(label, duration) {
    if (!panelFeedback) return;
    clearTimeout(feedbackTimer);
    feedbackTimer = 0;
    panelFeedback.textContent = label;
    panelFeedback.hidden = false;
    relayoutSoon();
    var ms = typeof duration === 'number' ? duration : 2200;
    if (ms <= 0) return;
    feedbackTimer = setTimeout(function () {
      if (!panelFeedback) return;
      panelFeedback.hidden = true;
      panelFeedback.textContent = '';
      relayoutSoon();
    }, ms);
  }

  /* ---- منوی اشتراک: یک کارتِ شیشه‌ایِ کوچک، بیرون از پنلِ اسکرول‌شدنی در برابرِ بریده‌شدن ---- */
  var SHARE_ITEMS = [
    { key: 'copy-link', label: 'Copy Link', icon: 'link', needsLink: true },
    { key: 'copy-text', label: 'Copy Text', icon: 'text', needsLink: false },
    { key: 'whatsapp', label: 'WhatsApp', icon: 'chat', needsLink: true },
    { key: 'telegram', label: 'Telegram', icon: 'send', needsLink: true },
    { key: 'native', label: 'More', icon: 'more', needsLink: false, nativeOnly: true }
  ];

  function shareIconNode(kind) {
    var s = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    if (kind === 'link') {
      s.appendChild(svgNode('path', { d: 'M10.6 13.4a4.4 4.4 0 0 0 6.2 0l2.1-2.1a4.4 4.4 0 0 0-6.2-6.2l-1.2 1.2' }));
      s.appendChild(svgNode('path', { d: 'M13.4 10.6a4.4 4.4 0 0 0-6.2 0l-2.1 2.1a4.4 4.4 0 0 0 6.2 6.2l1.2-1.2' }));
    } else if (kind === 'text') {
      s.appendChild(svgNode('path', { d: 'M8 4h8a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2Z' }));
      s.appendChild(svgNode('path', { d: 'M9.5 9.5h5M9.5 13h5' }));
    } else if (kind === 'chat') {
      s.appendChild(svgNode('path', { d: 'M21 11.4a8.4 8.4 0 0 1-8.4 8.4H5.2l1.9-3A8.4 8.4 0 1 1 21 11.4Z' }));
    } else if (kind === 'send') {
      s.appendChild(svgNode('path', { d: 'M21.5 2.5 10.8 13.2' }));
      s.appendChild(svgNode('path', { d: 'M21.5 2.5 14.8 21l-4-7.8-7.8-4 18.5-6.7Z' }));
    } else {
      s.appendChild(svgNode('path', { d: 'M12 15V4M8 8l4-4 4 4M5 14v5h14v-5' }));
    }
    return s;
  }

  function buildShareItem(spec) {
    var item = make('button', 'void-god-share-pop__item');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '-1');
    item.setAttribute('data-share', spec.key);
    if (spec.nativeOnly) item.setAttribute('data-native', '1');
    var ico = make('span', 'void-god-share-pop__ico');
    ico.appendChild(shareIconNode(spec.icon));
    item.appendChild(ico);
    item.appendChild(make('span', 'void-god-share-pop__label', spec.label));
    return item;
  }

  function buildSharePop(host) {
    if (sharePop || !host) return;
    sharePop = make('div', 'void-god-share-pop');
    sharePop.id = 'void-god-share-pop';
    sharePop.hidden = true;
    sharePop.setAttribute('role', 'menu');
    sharePop.setAttribute('aria-label', 'Share this letter');
    for (var i = 0; i < SHARE_ITEMS.length; i++) {
      var item = buildShareItem(SHARE_ITEMS[i]);
      sharePopItems.push(item);
      sharePop.appendChild(item);
    }
    sharePop.addEventListener('click', function (e) {
      var item = e.target && e.target.closest ? e.target.closest('[data-share]') : null;
      if (item) shareMenuAction(item.getAttribute('data-share'));
    });
    sharePop.addEventListener('keydown', onSharePopKey);
    host.appendChild(sharePop);
  }

  function shareFocusable() {
    var list = [];
    for (var i = 0; i < sharePopItems.length; i++) {
      var el = sharePopItems[i];
      if (!el.disabled && !el.hidden) list.push(el);
    }
    return list;
  }

  function syncShareMenu() {
    var link = messageLink(currentMessage);
    var canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    for (var i = 0; i < sharePopItems.length; i++) {
      var item = sharePopItems[i];
      var spec = SHARE_ITEMS[i];
      if (spec.nativeOnly) item.hidden = !canNative;
      var blocked = (spec.needsLink && !link) || (spec.nativeOnly && !canNative);
      item.disabled = blocked;
      item.setAttribute('aria-disabled', blocked ? 'true' : 'false');
      item.title = blocked ? 'No public link for this letter' : '';
    }
  }

  function placeSharePop() {
    var r = panelShareMenu.getBoundingClientRect();
    var w = sharePop.offsetWidth;
    var h = sharePop.offsetHeight;
    var left = Math.round(r.left + r.width / 2 - w / 2);
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    var top = Math.round(r.top - h - 8);
    if (top < 8) top = Math.round(Math.min(r.bottom + 8, window.innerHeight - h - 8));
    sharePop.style.left = left + 'px';
    sharePop.style.top = top + 'px';
  }

  function openSharePop() {
    if (!sharePop || !panelShareMenu || !currentMessage || sharePopOpen || panelShareMenu.disabled) return;
    closeTranslatePop(false);
    syncShareMenu();
    sharePopOpen = true;
    clearTimeout(sharePopTimer);
    sharePop.hidden = false;
    placeSharePop();
    panelShareMenu.classList.add('is-open');
    panelShareMenu.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onSharePointer, true);
    window.addEventListener('scroll', onShareDismiss, true);
    window.addEventListener('resize', onShareDismiss);
    requestAnimationFrame(function () {
      if (!sharePopOpen) return;
      sharePop.classList.add('is-on');
      var first = shareFocusable()[0];
      if (first) first.focus({ preventScroll: true });
    });
  }

  function closeSharePop(restoreFocus) {
    if (!sharePopOpen) return;
    sharePopOpen = false;
    clearTimeout(sharePopTimer);
    document.removeEventListener('pointerdown', onSharePointer, true);
    window.removeEventListener('scroll', onShareDismiss, true);
    window.removeEventListener('resize', onShareDismiss);
    if (sharePop) sharePop.classList.remove('is-on');
    if (panelShareMenu) {
      panelShareMenu.classList.remove('is-open');
      panelShareMenu.setAttribute('aria-expanded', 'false');
    }
    sharePopTimer = setTimeout(function () {
      if (!sharePopOpen && sharePop) sharePop.hidden = true;
    }, 180);
    if (restoreFocus && panelShareMenu && !panelShareMenu.disabled) {
      panelShareMenu.focus({ preventScroll: true });
    }
  }

  function onSharePointer(e) {
    if (!sharePopOpen) return;
    if (sharePop && sharePop.contains(e.target)) return;
    if (panelShareMenu && panelShareMenu.contains(e.target)) return;
    closeSharePop(false);
  }

  function onShareDismiss() {
    closeSharePop(false);
  }

  function onSharePopKey(e) {
    var list = shareFocusable();
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSharePop(true);
      return;
    }
    if (e.key === 'Tab') { closeSharePop(false); return; }
    var i = list.indexOf(document.activeElement);
    var next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next >= 0 && list[next]) {
      e.preventDefault();
      list[next].focus({ preventScroll: true });
    }
  }

  function shareMenuAction(key) {
    var msg = currentMessage;
    if (!msg) return;
    var link = messageLink(msg);
    if (key === 'copy-link') {
      if (!link) return;
      copyText(link).then(function () {
        closeSharePop(true);
        feedback('Link copied.');
      }, function () {
        closeSharePop(true);
        feedback('Could not copy the link \u2014 select the URL and copy it.');
      });
    } else if (key === 'copy-text') {
      copyText(msg.text).then(function () {
        closeSharePop(true);
        feedback('Copied to clipboard.');
      }, function () {
        closeSharePop(true);
        feedback('Could not copy automatically \u2014 select the message text and copy it.');
      });
    } else if (key === 'whatsapp') {
      if (!link) return;
      shareWindow('https://wa.me/?text=' + encodeURIComponent(msg.text + '\n\n' + link));
    } else if (key === 'telegram') {
      if (!link) return;
      shareWindow('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(msg.text));
    } else if (key === 'native') {
      shareNative(msg, link);
    }
  }

  function shareWindow(url) {
    closeSharePop(true);
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) {}
  }

  function shareNative(msg, link) {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return;
    var payload = { title: 'A message from the galaxy', text: xShareText(msg.text, 'panel') };
    if (link) payload.url = link;
    try {
      navigator.share(payload).then(function () {
        closeSharePop(true);
      }, function (err) {
        closeSharePop(true);
        if (!err || err.name !== 'AbortError') {
          feedback('Sharing was not available \u2014 copy the link instead.');
        }
      });
    } catch (e) { closeSharePop(true); }
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
    var text = secretMode && !secretRevealed ? maskSecretText(secretFullText) : currentMessage.text;
    copyText(text).then(function () {
      feedback('This message has no public link yet \u2014 it was copied instead.', true);
    }, function () {
      feedback('Could not copy \u2014 select the message text and copy it.', false);
    });
  }

  /* ---- اشتراکِ عمومیِ نامهٔ تازه‌نوشته: همان آیتم‌ها و رفتارهای منوی پنل،
     اما با لینک/متنِ همان نامه‌ای که همین حالا ثبت شده. ---- */
  function publishedShareFocusable() {
    var list = [];
    for (var i = 0; i < publishedShareItems.length; i++) {
      var item = publishedShareItems[i];
      if (!item.disabled && !item.hidden) list.push(item);
    }
    return list;
  }

  function syncPublishedShareMenu() {
    var canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    for (var i = 0; i < publishedShareItems.length; i++) {
      var item = publishedShareItems[i];
      var spec = SHARE_ITEMS[i];
      if (spec.nativeOnly) item.hidden = !canNative;
      var blocked = (spec.needsLink && !shareUrl) || (spec.nativeOnly && !canNative);
      item.disabled = blocked;
      item.setAttribute('aria-disabled', blocked ? 'true' : 'false');
      item.title = blocked ? 'No public link for this letter' : '';
    }
  }

  function openPublishedShare() {
    if (!publishedShareMenu || !publicShareBtn || !published || !shareUrl || publishedShareOpen) return;
    syncPublishedShareMenu();
    publishedShareOpen = true;
    clearTimeout(publishedShareTimer);
    publishedShareMenu.hidden = false;
    publicShareBtn.setAttribute('aria-expanded', 'true');
    /* click, not pointerdown: the menu is in flow, so closing it on press moves
       the footer buttons before release and swallows a click on Share on X. */
    document.addEventListener('click', onPublishedSharePointer, true);
    requestAnimationFrame(function () {
      if (!publishedShareOpen) return;
      var first = publishedShareFocusable()[0];
      if (first) first.focus({ preventScroll: true });
    });
  }

  function closePublishedShare(restoreFocus) {
    if (!publishedShareOpen) return;
    publishedShareOpen = false;
    document.removeEventListener('click', onPublishedSharePointer, true);
    if (publishedShareMenu) publishedShareMenu.hidden = true;
    if (publicShareBtn) {
      publicShareBtn.setAttribute('aria-expanded', 'false');
      if (restoreFocus) {
        try { publicShareBtn.focus({ preventScroll: true }); } catch (e) {}
      }
    }
  }

  function onPublishedSharePointer(e) {
    if (!publishedShareOpen) return;
    if (publishedShareMenu && publishedShareMenu.contains(e.target)) return;
    if (publicShareBtn && publicShareBtn.contains(e.target)) return;
    closePublishedShare(false);
  }

  function onPublishedShareKey(e) {
    var list = publishedShareFocusable();
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePublishedShare(true);
      return;
    }
    if (e.key === 'Tab') { closePublishedShare(false); return; }
    var i = list.indexOf(document.activeElement);
    var next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next >= 0 && list[next]) {
      e.preventDefault();
      list[next].focus({ preventScroll: true });
    }
  }

  function publishedShareFeedback(label) {
    if (!publishedShareStatus) return;
    clearTimeout(publishedShareTimer);
    publishedShareStatus.textContent = label;
    publishedShareStatus.hidden = false;
    publishedShareTimer = setTimeout(function () {
      publishedShareTimer = 0;
      if (!publishedShareStatus) return;
      publishedShareStatus.hidden = true;
      publishedShareStatus.textContent = '';
    }, 2600);
  }

  function publishedShareWindow(url) {
    closePublishedShare(false);
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) {}
  }

  function sharePublishedNative() {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || !shareUrl) return;
    var payload = { title: 'A letter from the galaxy', text: xShareText(publishedText, 'letter'), url: shareUrl };
    try {
      navigator.share(payload).then(function () {
        closePublishedShare(false);
      }, function (err) {
        closePublishedShare(false);
        if (!err || err.name !== 'AbortError') {
          publishedShareFeedback('Sharing was not available \u2014 copy the link instead.');
        }
      });
    } catch (e) { closePublishedShare(false); }
  }

  function publishedShareAction(key) {
    if (!published || !shareUrl) return;
    var body = publishedText ? publishedText + '\n\n' : '';
    if (key === 'copy-link') {
      copyText(shareUrl).then(function () {
        closePublishedShare(false);
        publishedShareFeedback('Link copied.');
      }, function () {
        closePublishedShare(false);
        publishedShareFeedback('Could not copy the link \u2014 select the URL and copy it.');
      });
    } else if (key === 'copy-text') {
      if (!publishedText) {
        closePublishedShare(false);
        publishedShareFeedback('The letter text is no longer in this window \u2014 copy the link instead.');
        return;
      }
      copyText(publishedText).then(function () {
        closePublishedShare(false);
        publishedShareFeedback('Copied to clipboard.');
      }, function () {
        closePublishedShare(false);
        publishedShareFeedback('Could not copy automatically \u2014 select the letter text and copy it.');
      });
    } else if (key === 'whatsapp') {
      if (!shareUrl) return;
      publishedShareWindow('https://wa.me/?text=' + encodeURIComponent(body + shareUrl));
    } else if (key === 'telegram') {
      if (!shareUrl) return;
      publishedShareWindow('https://t.me/share/url?url=' + encodeURIComponent(shareUrl) + '&text=' + encodeURIComponent(publishedText));
    } else if (key === 'native') {
      sharePublishedNative();
    }
  }

  /* ==================================================================
     ترجمهٔ نامه — فقط روی دستگاه، با Translator و LanguageDetector بومیِ
     کروم. متن نامه هیچ‌گاه به سروری فرستاده نمی‌شود و هیچ‌جا ذخیره نمی‌شود؛
     فقط در حافظهٔ همین صفحه می‌ماند.
     ================================================================== */
  var TRANSLATE_LANGS = [
    { code: 'ar', name: 'Arabic' },
    { code: 'bg', name: 'Bulgarian' },
    { code: 'bn', name: 'Bengali' },
    { code: 'cs', name: 'Czech' },
    { code: 'da', name: 'Danish' },
    { code: 'de', name: 'German' },
    { code: 'el', name: 'Greek' },
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fi', name: 'Finnish' },
    { code: 'fr', name: 'French' },
    { code: 'he', name: 'Hebrew' },
    { code: 'hi', name: 'Hindi' },
    { code: 'hr', name: 'Croatian' },
    { code: 'hu', name: 'Hungarian' },
    { code: 'id', name: 'Indonesian' },
    { code: 'it', name: 'Italian' },
    { code: 'ja', name: 'Japanese' },
    { code: 'kn', name: 'Kannada' },
    { code: 'ko', name: 'Korean' },
    { code: 'lt', name: 'Lithuanian' },
    { code: 'mr', name: 'Marathi' },
    { code: 'nl', name: 'Dutch' },
    { code: 'pl', name: 'Polish' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ro', name: 'Romanian' },
    { code: 'ru', name: 'Russian' },
    { code: 'sk', name: 'Slovak' },
    { code: 'sl', name: 'Slovenian' },
    { code: 'sv', name: 'Swedish' },
    { code: 'ta', name: 'Tamil' },
    { code: 'te', name: 'Telugu' },
    { code: 'th', name: 'Thai' },
    { code: 'tr', name: 'Turkish' },
    { code: 'uk', name: 'Ukrainian' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'zh-Hans', name: 'Chinese (Simplified)' },
    { code: 'zh-Hant', name: 'Chinese (Traditional)' }
  ];
  var TRANSLATE_NAME = {};
  (function () {
    for (var i = 0; i < TRANSLATE_LANGS.length; i++) TRANSLATE_NAME[TRANSLATE_LANGS[i].code] = TRANSLATE_LANGS[i].name;
  })();

  function hasTranslator() {
    return typeof window.Translator !== 'undefined' && window.Translator &&
      typeof window.Translator.availability === 'function' &&
      typeof window.Translator.create === 'function';
  }

  function hasDetector() {
    return typeof window.LanguageDetector !== 'undefined' && window.LanguageDetector &&
      typeof window.LanguageDetector.create === 'function';
  }

  function supportedLangCode(tag) {
    if (!tag || typeof tag !== 'string') return null;
    var low = tag.toLowerCase().replace(/_/g, '-');
    if (low.indexOf('zh') === 0 || low.indexOf('zh-') === 0) {
      return /(?:^|-)hant(?:-|$)|-(?:tw|hk|mo)(?:-|$)/.test(low) ? 'zh-Hant' : 'zh-Hans';
    }
    var base = low.split('-')[0];
    if (base === 'iw') base = 'he';
    else if (base === 'in') base = 'id';
    return TRANSLATE_NAME[base] ? base : null;
  }

  function preferredTargetCodes(source) {
    var nav = window.navigator || {};
    var prefs = nav.languages && nav.languages.length
      ? Array.prototype.slice.call(nav.languages)
      : (nav.language ? [nav.language] : []);
    var out = [];
    for (var i = 0; i < prefs.length && out.length < 3; i++) {
      var code = supportedLangCode(prefs[i]);
      if (code && code !== source && out.indexOf(code) < 0) out.push(code);
    }
    return out;
  }

  function ensureDetector() {
    if (langDetector) return Promise.resolve(langDetector);
    if (langDetectorPromise) return langDetectorPromise;
    if (!hasDetector()) return Promise.reject(new Error('detector_unsupported'));
    var gen = translatorGen;
    langDetectorPromise = Promise.resolve().then(function () {
      return window.LanguageDetector.create();
    }).then(function (det) {
      langDetectorPromise = null;
      if (gen !== translatorGen) {
        try { det.destroy(); } catch (e) {}
        throw new Error('cancelled');
      }
      langDetector = det;
      return det;
    }, function (err) {
      langDetectorPromise = null;
      throw err;
    });
    return langDetectorPromise;
  }

  function detectLetterLanguage(text) {
    var settled = false;
    var timer = 0;
    var work = ensureDetector().then(function (det) {
      return det.detect(text);
    }).then(function (results) {
      var best = results && results[0];
      if (!best || !best.detectedLanguage) return null;
      return {
        code: String(best.detectedLanguage),
        confidence: typeof best.confidence === 'number' ? best.confidence : null
      };
    });
    /* A detector still fetching its model can stay pending indefinitely;
       surface the existing retry instead of an endless "Checking…". */
    return new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('detect_timeout'));
      }, 15000);
      work.then(function (value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function pairAvailability(source, target) {
    try {
      return Promise.resolve(window.Translator.availability({
        sourceLanguage: source,
        targetLanguage: target
      })).then(function (value) {
        return typeof value === 'string' ? value : 'unavailable';
      }, function () { return 'unavailable'; });
    } catch (e) { return Promise.resolve('unavailable'); }
  }

  function translateIconNode(kind) {
    var s = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    if (kind === 'globe') {
      s.appendChild(svgNode('circle', { cx: '12', cy: '12', r: '8.4' }));
      s.appendChild(svgNode('path', { d: 'M3.6 12h16.8' }));
      s.appendChild(svgNode('path', { d: 'M12 3.6c2.3 2.4 3.5 5.3 3.5 8.4s-1.2 6-3.5 8.4c-2.3-2.4-3.5-5.3-3.5-8.4S9.7 6 12 3.6Z' }));
    } else if (kind === 'undo') {
      s.appendChild(svgNode('path', { d: 'M8 4.8 4.4 8.4 8 12' }));
      s.appendChild(svgNode('path', { d: 'M4.4 8.4h8.9a5.3 5.3 0 0 1 0 10.6h-4' }));
    } else {
      s.appendChild(svgNode('path', { d: 'M19.4 12a7.4 7.4 0 1 1-2.2-5.2' }));
      s.appendChild(svgNode('path', { d: 'M19.3 3.7v4.6h-4.6' }));
    }
    return s;
  }

  function translateMenuItem(action, icon, label) {
    var item = make('button', 'void-god-translate-pop__item');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '-1');
    item.setAttribute('data-tx', action);
    var ico = make('span', 'void-god-translate-pop__ico');
    ico.appendChild(translateIconNode(icon));
    item.appendChild(ico);
    item.appendChild(make('span', 'void-god-translate-pop__label-text', label));
    return item;
  }

  function buildTranslatePop(host) {
    if (translatePop || !host) return;
    translatePop = make('div', 'void-god-translate-pop');
    translatePop.id = 'void-god-translate-pop';
    translatePop.hidden = true;
    translatePop.setAttribute('role', 'menu');
    translatePop.setAttribute('aria-label', 'Translate letter');

    translateNote = make('p', 'void-god-translate-pop__note');
    translateNote.id = 'void-god-translate-note';
    translateNote.setAttribute('role', 'status');
    translateNote.setAttribute('aria-live', 'polite');
    translateNote.hidden = true;
    translatePop.appendChild(translateNote);

    translateDefaultItem = translateMenuItem('translate', 'globe', 'Translate');
    translateDefaultLabel = translateDefaultItem.querySelector('.void-god-translate-pop__label-text');
    translateDefaultItem.hidden = true;
    translateOriginalItem = translateMenuItem('original', 'undo', 'Show original letter');
    translateOriginalItem.hidden = true;
    translateRetryItem = translateMenuItem('retry', 'retry', 'Try again');
    translateRetryItem.hidden = true;
    translatePop.appendChild(translateDefaultItem);
    translatePop.appendChild(translateOriginalItem);
    translatePop.appendChild(translateRetryItem);

    var sep = make('div', 'void-god-translate-pop__sep');
    sep.setAttribute('aria-hidden', 'true');
    var listLabel = make('p', 'void-god-translate-pop__label', 'Choose another language');
    listLabel.setAttribute('aria-hidden', 'true');
    translateList = make('div', 'void-god-translate-pop__list');
    translateList.setAttribute('role', 'group');
    translateList.setAttribute('aria-label', 'Choose another language');
    for (var i = 0; i < TRANSLATE_LANGS.length; i++) {
      var spec = TRANSLATE_LANGS[i];
      var item = make('button', 'void-god-translate-pop__item void-god-translate-pop__lang');
      item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('tabindex', '-1');
      item.setAttribute('aria-checked', 'false');
      item.setAttribute('data-lang', spec.code);
      item.appendChild(make('span', 'void-god-translate-pop__label-text', spec.name));
      translateList.appendChild(item);
      translateLangItems.push(item);
    }
    translatePop.appendChild(sep);
    translatePop.appendChild(listLabel);
    translatePop.appendChild(translateList);

    translatePop.addEventListener('click', onTranslatePopClick);
    translatePop.addEventListener('keydown', onTranslatePopKey);
    host.appendChild(translatePop);
  }

  function setTranslateNote(text) {
    if (!translateNote) return;
    translateNote.textContent = text || '';
    translateNote.hidden = !text;
    if (translatePopOpen) placeTranslatePop();
  }

  function syncTranslateButton() {
    if (!panelTranslate) return;
    var on = translateState === 'translated';
    panelTranslate.classList.toggle('is-on', on);
    panelTranslate.classList.toggle('is-busy', translateBusy);
    panelTranslate.setAttribute('aria-busy', translateBusy ? 'true' : 'false');
    panelTranslate.setAttribute('aria-pressed', on ? 'true' : 'false');
    var label = translateBusy
      ? 'Translating letter\u2026'
      : on ? 'Show the original letter' : 'Translate letter';
    panelTranslate.title = label;
    panelTranslate.setAttribute('aria-label', label);
  }

  function syncTranslatePop() {
    if (!translatePop) return;
    if (translateDefaultItem) {
      translateDefaultItem.hidden = !translateDefaultTarget;
      translateDefaultItem.disabled = translateBusy || !translateReady;
      if (translateDefaultTarget && translateDefaultLabel) {
        translateDefaultLabel.textContent = 'Translate to ' + (TRANSLATE_NAME[translateDefaultTarget] || translateDefaultTarget);
      }
    }
    if (translateOriginalItem) {
      translateOriginalItem.hidden = translateState !== 'translated';
      translateOriginalItem.disabled = translateBusy;
    }
    if (translateRetryItem) translateRetryItem.disabled = translateBusy;
    for (var i = 0; i < translateLangItems.length; i++) {
      var item = translateLangItems[i];
      var code = item.getAttribute('data-lang');
      item.hidden = !!translateSourceLang && code === translateSourceLang;
      item.disabled = translateBusy || !translateReady;
      var current = translateState === 'translated' && translateTargetLang === code;
      item.classList.toggle('is-current', current);
      item.setAttribute('aria-checked', current ? 'true' : 'false');
    }
  }

  function translateFocusable() {
    var list = [translateDefaultItem, translateOriginalItem, translateRetryItem];
    for (var i = 0; i < translateLangItems.length; i++) list.push(translateLangItems[i]);
    var out = [];
    for (var j = 0; j < list.length; j++) {
      var item = list[j];
      if (item && !item.hidden && !item.disabled) out.push(item);
    }
    return out;
  }

  function focusTranslateFirst() {
    if (!translatePopOpen) return;
    /* Detection can resolve before the opening frame applies .is-on; focus()
       would be dropped while the popover is still visibility:hidden. */
    if (translatePop && !translatePop.classList.contains('is-on')) {
      requestAnimationFrame(focusTranslateFirst);
      return;
    }
    var active = document.activeElement;
    if (active && active !== panelTranslate && active !== document.body) return;
    var first = translateFocusable()[0];
    if (first) first.focus({ preventScroll: true });
  }

  function placeTranslatePop() {
    if (!translatePop || !translatePopOpen || !panelTranslate) return;
    var r = panelTranslate.getBoundingClientRect();
    translatePop.style.maxHeight = '';
    translatePop.style.overflowY = '';
    var w = translatePop.offsetWidth;
    var h = translatePop.offsetHeight;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    if (h > vh - 16) {
      translatePop.style.maxHeight = (vh - 16) + 'px';
      translatePop.style.overflowY = 'auto';
      h = Math.min(translatePop.offsetHeight, vh - 16);
    }
    var left = Math.round(r.left);
    left = Math.max(8, Math.min(left, vw - w - 8));
    var top = Math.round(r.bottom + 8);
    if (top + h > vh - 8) {
      var above = Math.round(r.top - h - 8);
      top = above >= 8 ? above : Math.max(8, vh - h - 8);
    }
    translatePop.style.left = left + 'px';
    translatePop.style.top = top + 'px';
  }

  function openTranslatePop() {
    if (!translatePop || !panelTranslate || !currentMessage || translatePopOpen || panelTranslate.disabled) return;
    closeSharePop(false);
    translatePopOpen = true;
    clearTimeout(translatePopTimer);
    translatePop.hidden = false;
    panelTranslate.classList.add('is-open');
    panelTranslate.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onTranslatePointer, true);
    window.addEventListener('scroll', onTranslateScroll, true);
    window.addEventListener('resize', onTranslateDismiss);

    if (translateState === 'translated' && translateSourceLang) {
      translateReady = true;
      translateDefaultTarget = null;
      setTranslateNote('');
      if (translateRetryItem) translateRetryItem.hidden = true;
      syncTranslatePop();
      placeTranslatePop();
      requestAnimationFrame(function () {
        if (!translatePopOpen) return;
        translatePop.classList.add('is-on');
        focusTranslateFirst();
      });
      return;
    }

    translateReady = false;
    translateDefaultTarget = null;
    translateDefaultAvail = null;
    if (translateOriginalItem) translateOriginalItem.hidden = true;
    if (translateRetryItem) translateRetryItem.hidden = true;
    setTranslateNote('Checking translation support\u2026');
    syncTranslatePop();
    placeTranslatePop();
    requestAnimationFrame(function () {
      if (translatePopOpen) translatePop.classList.add('is-on');
    });
    prepareTranslation();
  }

  function closeTranslatePop(restoreFocus) {
    if (!translatePopOpen) return;
    translatePopOpen = false;
    clearTimeout(translatePopTimer);
    document.removeEventListener('pointerdown', onTranslatePointer, true);
    window.removeEventListener('scroll', onTranslateScroll, true);
    window.removeEventListener('resize', onTranslateDismiss);
    if (translatePop) translatePop.classList.remove('is-on');
    if (panelTranslate) {
      panelTranslate.classList.remove('is-open');
      panelTranslate.setAttribute('aria-expanded', 'false');
    }
    translatePopTimer = setTimeout(function () {
      if (!translatePopOpen && translatePop) translatePop.hidden = true;
    }, 180);
    if (restoreFocus && panelTranslate && !panelTranslate.disabled) {
      panelTranslate.focus({ preventScroll: true });
    }
  }

  function onTranslatePointer(e) {
    if (!translatePopOpen) return;
    if (translatePop && translatePop.contains(e.target)) return;
    if (panelTranslate && panelTranslate.contains(e.target)) return;
    closeTranslatePop(false);
  }

  function onTranslateScroll(e) {
    if (!translatePopOpen) return;
    if (e && e.target && translatePop && translatePop.contains(e.target)) return;
    closeTranslatePop(false);
  }

  function onTranslateDismiss() {
    closeTranslatePop(false);
  }

  function onTranslatePopKey(e) {
    var list = translateFocusable();
    if (e.key === 'Tab') { closeTranslatePop(false); return; }
    var i = list.indexOf(document.activeElement);
    var next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next >= 0 && list[next]) {
      e.preventDefault();
      list[next].focus({ preventScroll: true });
    }
  }

  function onTranslatePopClick(e) {
    var target = e.target && e.target.closest ? e.target.closest('[data-tx],[data-lang]') : null;
    if (!target || target.disabled || target.hidden) return;
    var lang = target.getAttribute('data-lang');
    if (lang) { startTranslation(lang); return; }
    var action = target.getAttribute('data-tx');
    if (action === 'translate' && translateDefaultTarget) startTranslation(translateDefaultTarget);
    else if (action === 'original') showOriginalLetter();
    else if (action === 'retry') prepareTranslation();
  }

  function prepareTranslation() {
    var token = ++translatePrepToken;
    var msg = currentMessage;
    translateSourceLang = null;
    translateDefaultTarget = null;
    translateDefaultAvail = null;
    translateReady = false;
    if (translateDefaultItem) translateDefaultItem.hidden = true;
    if (translateOriginalItem) translateOriginalItem.hidden = translateState !== 'translated';
    if (translateRetryItem) translateRetryItem.hidden = true;
    setTranslateNote('Checking translation support\u2026');
    syncTranslatePop();
    if (!msg || !translatePopOpen) return;
    if (!hasTranslator() || !hasDetector()) {
      setTranslateNote('Translation is not supported in this browser.');
      return;
    }
    detectLetterLanguage(msg.text).then(function (result) {
      if (token !== translatePrepToken || !translatePopOpen) return;
      if (!result || !result.code) { showTranslateProblem('Could not detect this letter\u2019s language.'); return; }
      if (result.confidence !== null && result.confidence < 0.35) {
        showTranslateProblem('Could not confidently detect this letter\u2019s language.');
        return;
      }
      var src = supportedLangCode(result.code) || result.code;
      translateSourceLang = src;
      var prefs = preferredTargetCodes(src);
      if (!prefs.length) {
        var name = TRANSLATE_NAME[src];
        translateReady = !!name;
        setTranslateNote(name ? 'This letter is already in ' + name + '.' : '');
        syncTranslatePop();
        focusTranslateFirst();
        return;
      }
      return chooseDefaultTarget(src, prefs, token);
    }).catch(function (err) {
      if (token !== translatePrepToken || !translatePopOpen) return;
      if (err && err.message === 'detect_timeout') {
        showTranslateProblem('Could not detect this letter\u2019s language.');
        return;
      }
      showTranslateProblem('Translation is not supported in this browser.');
    });
  }

  function showTranslateProblem(note) {
    translateReady = false;
    translateDefaultTarget = null;
    setTranslateNote(note);
    if (translateRetryItem) translateRetryItem.hidden = false;
    syncTranslatePop();
  }

  function chooseDefaultTarget(src, prefs, token) {
    var i = 0;
    function next() {
      if (token !== translatePrepToken || !translatePopOpen) return;
      if (i >= prefs.length) {
        translateReady = true;
        translateDefaultTarget = null;
        setTranslateNote('Translation unavailable for this language pair.');
        syncTranslatePop();
        return;
      }
      var target = prefs[i++];
      return pairAvailability(src, target).then(function (av) {
        if (token !== translatePrepToken || !translatePopOpen) return;
        if (av === 'unavailable') return next();
        translateReady = true;
        translateDefaultTarget = target;
        translateDefaultAvail = av;
        setTranslateNote('');
        syncTranslatePop();
        focusTranslateFirst();
      });
    }
    return next();
  }

  function ensureTranslator(src, target, token) {
    var key = src + '|' + target;
    if (translators[key]) return Promise.resolve(translators[key]);
    if (translatorPending[key]) return translatorPending[key];
    var gen = translatorGen;
    var promise = Promise.resolve().then(function () {
      var options = { sourceLanguage: src, targetLanguage: target };
      options.monitor = function (monitor) {
        if (!monitor || typeof monitor.addEventListener !== 'function') return;
        monitor.addEventListener('downloadprogress', function (e) {
          if (token !== translateToken || !translateBusy) return;
          var loaded = Number(e && e.loaded);
          var total = Number(e && e.total);
          var text = 'Downloading language model\u2026';
          if (total > 0 && loaded >= 0) {
            text += ' ' + Math.max(1, Math.min(100, Math.round((loaded / total) * 100))) + '%';
          }
          feedback(text, 0);
        });
      };
      return window.Translator.create(options);
    }).then(function (translator) {
      delete translatorPending[key];
      if (gen !== translatorGen || token !== translateToken) {
        try { translator.destroy(); } catch (e) {}
        throw new Error('cancelled');
      }
      var keys = Object.keys(translators);
      if (keys.length >= 3) {
        try { translators[keys[0]].destroy(); } catch (e) {}
        delete translators[keys[0]];
      }
      translators[key] = translator;
      return translator;
    }, function (err) {
      delete translatorPending[key];
      throw err;
    });
    translatorPending[key] = promise;
    return promise;
  }

  function applyTranslation(text, target, msg, token) {
    if (token !== translateToken || !panelOpen || !msg || currentMessage !== msg) return;
    translateBusy = false;
    translatePendingKey = '';
    translateCache[msg.id + '|' + target] = text;
    translateState = 'translated';
    translateTargetLang = target;
    if (!translateOriginalLang) translateOriginalLang = msg.lang || null;
    updatePanelText(text);
    panelText.setAttribute('lang', target);
    syncTranslateButton();
    syncTranslatePop();
    feedback('Translated to ' + (TRANSLATE_NAME[target] || target) + '.', 2400);
    relayoutSoon();
  }

  function failTranslation(token, error) {
    if (token !== translateToken) return;
    translateBusy = false;
    translatePendingKey = '';
    syncTranslateButton();
    syncTranslatePop();
    var name = error && error.name;
    var label;
    if (error === 'pair' || name === 'NotSupportedError') {
      label = 'Translation unavailable for this language pair.';
    } else if (name === 'NotAllowedError') {
      label = 'Translation needs another tap \u2014 try again.';
    } else {
      label = 'Translation failed. Please try again.';
    }
    feedback(label, 4200);
  }

  function startTranslation(target) {
    if (!target || !currentMessage || translateBusy) return;
    var msg = currentMessage;
    var src = translateSourceLang;
    if (!src) return;
    var key = msg.id + '|' + src + '|' + target;
    if (translatePendingKey === key) return;
    var token = ++translateToken;
    var avail = target === translateDefaultTarget ? translateDefaultAvail : null;
    translatePendingKey = key;
    translateBusy = true;
    translateTargetLang = target;
    closeTranslatePop(true);
    syncTranslateButton();
    syncTranslatePop();

    var cached = translateCache[msg.id + '|' + target];
    if (cached) { applyTranslation(cached, target, msg, token); return; }

    feedback('Preparing language model\u2026', 0);
    function run(availability) {
      if (token !== translateToken) return;
      if (availability === 'unavailable') { failTranslation(token, 'pair'); return; }
      feedback(availability === 'available' ? 'Translating letter\u2026' : 'Preparing language model\u2026', 0);
      ensureTranslator(src, target, token).then(function (translator) {
        if (token !== translateToken) return;
        feedback('Translating letter\u2026', 0);
        return Promise.resolve(translator.translate(msg.text)).then(function (out) {
          if (token !== translateToken) return;
          if (typeof out !== 'string' || !out) throw new Error('empty');
          applyTranslation(out, target, msg, token);
        });
      }).catch(function (err) {
        if (token !== translateToken) return;
        failTranslation(token, err);
      });
    }
    if (avail !== null) run(avail);
    else pairAvailability(src, target).then(run);
  }

  function showOriginalLetter() {
    if (!currentMessage || translateState !== 'translated') return;
    closeTranslatePop(true);
    updatePanelText(currentMessage.text);
    if (translateOriginalLang) panelText.setAttribute('lang', translateOriginalLang);
    else panelText.removeAttribute('lang');
    translateState = 'original';
    syncTranslateButton();
    syncTranslatePop();
    feedback('Showing the original letter.', 2200);
    relayoutSoon();
  }

  function releaseTranslationEngine() {
    translatorGen++;
    var keys = Object.keys(translators);
    for (var i = 0; i < keys.length; i++) {
      try { translators[keys[i]].destroy(); } catch (e) {}
    }
    translators = {};
    translatorPending = {};
    if (langDetector) {
      try { langDetector.destroy(); } catch (e) {}
    }
    langDetector = null;
    langDetectorPromise = null;
  }

  function resetTranslation(opts) {
    opts = opts || {};
    translateToken++;
    translatePrepToken++;
    closeTranslatePop(false);
    translateBusy = false;
    translatePendingKey = '';
    translateState = 'original';
    translateTargetLang = null;
    translateDefaultTarget = null;
    translateDefaultAvail = null;
    translateSourceLang = null;
    translateOriginalLang = null;
    translateReady = false;
    translateCache = {};
    if (translateDefaultItem) translateDefaultItem.hidden = true;
    if (translateOriginalItem) translateOriginalItem.hidden = true;
    if (translateRetryItem) translateRetryItem.hidden = true;
    syncTranslateButton();
    syncTranslatePop();
    if (opts.release) releaseTranslationEngine();
  }

  /* ==================================================================
     پنجرهٔ نوشتنِ نامه + مسیر ثبت و اشتراک در X
     submit فقط از پاسخِ واقعیِ source.submit (Worker) صدا زده می‌شود.
     ================================================================== */
  function closeCompose() {
    if (!compose || !compose.open) return;
    closePublishedShare(false);
    clearTimeout(publishedShareTimer);
    publishedShareTimer = 0;
    if (publishedShareStatus) {
      publishedShareStatus.hidden = true;
      publishedShareStatus.textContent = '';
    }
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
      if (saved && UNRESOLVED_STATES[saved.state] === true) {
        composer.value = saved.text;
        if (secretEl) secretEl.checked = saved.secret_ink === true;
        var savedExpiry = composeForm.querySelectorAll('input[name="void-god-expiry"]');
        for (var si = 0; si < savedExpiry.length; si++) savedExpiry[si].checked = savedExpiry[si].value === saved.expiry;
        var savedPresence = composeForm.querySelectorAll('input[name="void-god-presence"]');
        for (var spi = 0; spi < savedPresence.length; spi++) {
          savedPresence[spi].checked = savedPresence[spi].value === saved.presence;
        }
        ackEl.checked = true;
        setUncertainSubmission(saved);
      }
    }
    composeForm.classList.remove('is-published');
    successEl.hidden = true;
    xShareBtn.disabled = true;
    publicShareBtn.disabled = true;
    publicShareBtn.setAttribute('aria-expanded', 'false');
    publicShareBtn.setAttribute('aria-label', 'Sharing is not available yet');
    publicShareBtn.title = 'Public sharing unlocks once the letter has its public page';
    closePublishedShare(false);
    clearTimeout(publishedShareTimer);
    publishedShareTimer = 0;
    if (publishedShareStatus) {
      publishedShareStatus.hidden = true;
      publishedShareStatus.textContent = '';
    }
    publishedText = '';
    published = false;
    shareUrl = null;
    publishedBase = '';
    publishedLang = null;
    sending = false;
    syncSubmissionLock();
    if (!uncertainSubmission) ackEl.checked = false;
    if (!uncertainSubmission && secretEl) secretEl.checked = false;
    if (!uncertainSubmission && presenceNone) presenceNone.checked = true;
    noticeEl.hidden = !uncertainSubmission;
    noticeEl.textContent = '';
    if (uncertainSubmission) notice('We could not confirm whether your letter arrived. Press Check submission to safely try again.');
    updateState();
    try { compose.showModal(); }
    catch (e) { compose.setAttribute('open', ''); }
    if (quillBtn) quillBtn.setAttribute('aria-expanded', 'true');
    refreshQuota(false);
    try { composer.focus({ preventScroll: true }); } catch (e) {}
  }

  /* Five original line-art presences on one shared grid: a thin contour and a
     single filled point. The mark is a writing-side identity choice, not a
     profile and not published metadata. */
  function presenceSvg(kind) {
    var svg = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    if (kind === 'none') {
      svg.appendChild(svgNode('circle', { cx: '12', cy: '12', r: '6.4', 'stroke-dasharray': '1.6 3.4' }));
      svg.appendChild(svgNode('circle', { cx: '12', cy: '12', r: '1.1', fill: 'currentColor', stroke: 'none' }));
    } else if (kind === 'human') {
      svg.appendChild(svgNode('circle', { cx: '12', cy: '8.1', r: '3.1' }));
      svg.appendChild(svgNode('path', { d: 'M5.6 19.4c.7-3.4 3.2-5.4 6.4-5.4s5.7 2 6.4 5.4' }));
      svg.appendChild(svgNode('circle', { cx: '12', cy: '15.7', r: '.9', fill: 'currentColor', stroke: 'none' }));
    } else if (kind === 'moon') {
      svg.appendChild(svgNode('path', { d: 'M15.9 4.6a7.4 7.4 0 1 0 3.5 12.6 6.1 6.1 0 0 1-3.5-12.6Z' }));
      svg.appendChild(svgNode('circle', { cx: '16.6', cy: '9.3', r: '.9', fill: 'currentColor', stroke: 'none' }));
    } else if (kind === 'root') {
      svg.appendChild(svgNode('path', { d: 'M12 5.2v9.8' }));
      svg.appendChild(svgNode('path', { d: 'M12 5.2c-2.4 1.7-3.6 3.7-3.6 5.9M12 5.2c2.4 1.7 3.6 3.7 3.6 5.9' }));
      svg.appendChild(svgNode('path', { d: 'M12 14.6c-1.7.7-3 2-3.9 3.9M12 14.6c1.7.7 3 2 3.9 3.9' }));
      svg.appendChild(svgNode('circle', { cx: '12', cy: '15', r: '.9', fill: 'currentColor', stroke: 'none' }));
    } else {
      svg.appendChild(svgNode('path', { d: 'M12 5.2a6.8 6.8 0 0 1 4.4 11.9M9.9 18.2a6.8 6.8 0 0 1-2.3-10.4' }));
      svg.appendChild(svgNode('circle', { cx: '12', cy: '12', r: '.9', fill: 'currentColor', stroke: 'none' }));
    }
    return svg;
  }

  function buildCompose(host) {
    compose = make('dialog', 'void-god-dialog');
    compose.id = 'void-god-dialog';
    compose.setAttribute('aria-labelledby', 'void-god-title');
    compose.setAttribute('aria-describedby', 'void-god-ack-text');

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

    /* The mark is chosen with symbols, not a form fieldset: five line-art
       presences, one selected state, no identity attached. */
    var presence = make('fieldset', 'void-god-presence');
    var presenceLegend = make('legend', 'void-god-presence__legend', 'Presence');
    presenceLegend.appendChild(make('span', 'void-god-presence__optional', 'optional'));
    presence.appendChild(presenceLegend);
    var presenceRow = make('div', 'void-god-presence__row');
    var presenceOpts = [
      ['none', 'None'],
      ['human', 'Human'],
      ['moon', 'Moon'],
      ['root', 'Root'],
      ['unknown', 'Unknown']
    ];
    for (var pi = 0; pi < presenceOpts.length; pi++) {
      var pOpt = make('label', 'void-god-presence__opt');
      pOpt.title = presenceOpts[pi][0] === 'none' ? 'No presence' : 'A ' + presenceOpts[pi][0] + ' presence';
      var pRadio = document.createElement('input');
      pRadio.type = 'radio';
      pRadio.name = 'void-god-presence';
      pRadio.value = presenceOpts[pi][0];
      pRadio.checked = presenceOpts[pi][0] === 'none';
      var pGlyph = make('span', 'void-god-presence__glyph');
      pGlyph.appendChild(presenceSvg(presenceOpts[pi][0]));
      pOpt.appendChild(pRadio);
      pOpt.appendChild(pGlyph);
      pOpt.appendChild(make('span', 'void-god-presence__name', presenceOpts[pi][1]));
      presenceRow.appendChild(pOpt);
      if (presenceOpts[pi][0] === 'none') presenceNone = pRadio;
    }
    presence.appendChild(presenceRow);

    /* The composer carries the same meter as the quill: three ink drops, filled
       while the server still allows a letter today. */
    composeQuota = make('div', 'void-god-quota');
    composeQuota.id = 'void-god-quota';
    composeQuota.hidden = true;
    buildMeter(composeQuota, 'void-god-quota__meter');
    composeQuotaText = make('span', 'void-god-quota__text', '');
    composeQuota.appendChild(composeQuotaText);

    composer = make('textarea', 'void-god-text');
    composer.id = 'void-god-text';
    composer.setAttribute('rows', '7');
    composer.setAttribute('dir', 'auto');
    composer.setAttribute('placeholder', 'Write freely. Let the silence hold your words\u2026');
    composer.setAttribute('spellcheck', 'true');
    composer.setAttribute('autocomplete', 'off');
    composer.setAttribute('aria-describedby', 'void-god-count void-god-hint');
    composer.setAttribute('aria-label', 'Your letter');

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

    /* Secret Ink stays inside the fade fieldset as a quiet switch: the visible
       label is the whole hit area, the explanation lives in a screen-reader note
       and the switch carries the state. */
    var secretLab = make('label', 'void-god-secret');
    secretLab.title = 'Readers can reveal your words with one click.';
    secretEl = document.createElement('input');
    secretEl.type = 'checkbox';
    secretEl.id = 'void-god-secret-ink';
    secretEl.setAttribute('role', 'switch');
    secretEl.setAttribute('aria-label', 'Whisper Ink');
    secretEl.setAttribute('aria-describedby', 'void-god-secret-compose-hint');
    secretLab.appendChild(secretEl);
    var secretCopy = make('span', 'void-god-secret__copy');
    secretCopy.appendChild(make('span', 'void-god-secret__title', 'Whisper Ink'));
    secretCopy.appendChild(make('span', 'void-god-secret__sub', 'Hidden until a reader taps to reveal.'));
    secretLab.appendChild(secretCopy);
    var secretSwitch = make('span', 'void-god-switch');
    secretSwitch.setAttribute('aria-hidden', 'true');
    secretSwitch.appendChild(make('span', 'void-god-switch__track'));
    secretLab.appendChild(secretSwitch);
    var secretNote = make('span', 'void-god-sr', 'Whisper Ink hides the letter behind a reveal tap in the reader.');
    secretNote.id = 'void-god-secret-compose-hint';
    secretLab.appendChild(secretNote);
    fs.appendChild(secretLab);

    var ackLab = make('label', 'void-god-ack');
    ackEl = document.createElement('input');
    ackEl.type = 'checkbox';
    ackEl.id = 'void-god-ack';
    ackLab.appendChild(ackEl);
    var ackText = make('span', 'void-god-ack__text',
      'I understand letters are anonymous and public, cannot be edited or deleted after submission, and may be seen or saved before they expire.');
    ackText.id = 'void-god-ack-text';
    ackLab.appendChild(ackText);

    noticeEl = make('p', 'void-god-notice');
    noticeEl.id = 'void-god-notice';
    noticeEl.setAttribute('role', 'status');
    noticeEl.hidden = true;

    /* Release footer: the quiet act of letting go on one side, the single
       primary action on the other. */
    var foot = make('div', 'void-god-foot');
    var release = make('span', 'void-god-release');
    release.appendChild(make('span', 'void-god-release__micro', 'Let it go.'));
    var actions = make('div', 'void-god-actions');
    var cancel = make('button', 'void-god-btn', 'Cancel');
    cancel.type = 'button';
    submitBtn = make('button', 'void-god-btn void-god-btn--primary', "Let's go");
    submitBtn.type = 'submit';
    submitBtn.disabled = true;
    actions.appendChild(cancel);
    actions.appendChild(submitBtn);
    foot.appendChild(release);
    foot.appendChild(actions);

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
    publishedShareMenu = make('div', 'void-god-published__menu');
    publishedShareMenu.id = 'void-god-published-share';
    publishedShareMenu.hidden = true;
    publishedShareMenu.setAttribute('role', 'menu');
    publishedShareMenu.setAttribute('aria-label', 'Public share');
    for (var pi = 0; pi < SHARE_ITEMS.length; pi++) {
      var pitem = buildShareItem(SHARE_ITEMS[pi]);
      publishedShareItems.push(pitem);
      publishedShareMenu.appendChild(pitem);
    }
    successEl.appendChild(publishedShareMenu);
    publishedShareStatus = make('p', 'void-god-published__status', '');
    publishedShareStatus.id = 'void-god-published-status';
    publishedShareStatus.setAttribute('role', 'status');
    publishedShareStatus.setAttribute('aria-live', 'polite');
    publishedShareStatus.hidden = true;
    successEl.appendChild(publishedShareStatus);
    var okFoot = make('div', 'void-god-foot');
    publicShareBtn = make('button', 'void-god-btn', 'Public share');
    publicShareBtn.type = 'button';
    publicShareBtn.id = 'void-god-public-share';
    publicShareBtn.disabled = true;
    publicShareBtn.setAttribute('aria-haspopup', 'menu');
    publicShareBtn.setAttribute('aria-expanded', 'false');
    publicShareBtn.setAttribute('aria-label', 'Sharing is not available yet');
    publicShareBtn.title = 'Public sharing unlocks once the letter has its public page';
    xShareBtn = make('button', 'void-god-btn', 'Share on X');
    xShareBtn.type = 'button';
    xShareBtn.id = 'void-god-x-share';
    xShareBtn.disabled = true;
    xShareBtn.title = 'Sharing unlocks once the letter has its public page';
    var done = make('button', 'void-god-btn void-god-btn--primary', 'Done');
    done.type = 'button';
    okFoot.appendChild(publicShareBtn);
    okFoot.appendChild(xShareBtn);
    okFoot.appendChild(done);
    successEl.appendChild(okFoot);

    composeForm.appendChild(head);
    composeForm.appendChild(presence);
    composeForm.appendChild(composeQuota);
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
    publicShareBtn.addEventListener('click', function () {
      if (publishedShareOpen) closePublishedShare(true);
      else openPublishedShare();
    });
    publishedShareMenu.addEventListener('click', function (e) {
      var item = e.target && e.target.closest ? e.target.closest('[data-share]') : null;
      if (item) publishedShareAction(item.getAttribute('data-share'));
    });
    publishedShareMenu.addEventListener('keydown', onPublishedShareKey);
    compose.addEventListener('cancel', function (e) {
      e.preventDefault();
      if (publishedShareOpen) { closePublishedShare(true); return; }
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

  function currentPresence() {
    var checked = composeForm && composeForm.querySelector('input[name="void-god-presence"]:checked');
    return checked ? checked.value : 'none';
  }

  function submitRemote(payload) {
    if (!api) return Promise.resolve({ kind: 'network' });
    var pending = uncertainSubmission || api.begin(
      payload.text, payload.expiry, detectLang(payload.text), payload.secret_ink === true,
      payload.presence
    );
    return api.submit(pending);
  }

  /* Locks every submission control while a request is in flight and while its
     outcome is unresolved. Definitive results clear the pending record and
     unlock; the Presence mark follows the same rule as expiry and Secret Ink. */
  function syncSubmissionLock() {
    var locked = sending || !!uncertainSubmission;
    if (composer) composer.readOnly = locked;
    if (!composeForm) return;
    var fields = composeForm.querySelectorAll(
      'input[name="void-god-expiry"], input[name="void-god-presence"], #void-god-ack, #void-god-secret-ink'
    );
    for (var i = 0; i < fields.length; i++) fields[i].disabled = locked;
  }

  function setUncertainSubmission(pending) {
    uncertainSubmission = pending || null;
    syncSubmissionLock();
    updateState();
  }

  function submitLetter() {
    if (sending || typeof source.submit !== 'function') return;
    sending = true;
    syncSubmissionLock();
    updateState();
    noticeEl.hidden = true;
    clearTimeout(connectionTimer);
    connectionTimer = setTimeout(function () {
      if (sending) notice('Connecting to the galaxy\u2026 Please wait.');
    }, 900);
    var payload = {
      text: composer.value,
      expiry: currentExpiry(),
      secret_ink: !!(secretEl && secretEl.checked),
      presence: currentPresence()
    };
    source.submit(payload).then(function (result) {
      clearTimeout(connectionTimer);
      sending = false;
      var pending = api && api.loadPending ? api.loadPending() : null;
      if (pending && UNRESOLVED_STATES[pending.state] === true) setUncertainSubmission(pending);
      else if (result && result.kind !== 'busy') setUncertainSubmission(null);
      else syncSubmissionLock();
      handleSubmitResult(result || { kind: 'error' });
    }, function () {
      clearTimeout(connectionTimer);
      sending = false;
      var pending = api && api.loadPending ? api.loadPending() : null;
      setUncertainSubmission(pending && UNRESOLVED_STATES[pending.state] === true ? pending : null);
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
      noteQuotaRate(result.retry_after);
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
      notice('The galaxy returned an unexpected response (' + result.status + '). Keep the letter unchanged and check the submission.');
    } else {
      notice('The service is temporarily unavailable. Your letter is still here \u2014 try again in a moment.');
    }
    syncSubmit();
  }

  function onPublished(result) {
    setUncertainSubmission(null);
    published = true;
    shareUrl = null;
    publishedText = composer.value;
    publishedLang = detectShareLang(composer.value);
    closePublishedShare(false);
    clearTimeout(publishedShareTimer);
    publishedShareTimer = 0;
    if (publishedShareStatus) {
      publishedShareStatus.hidden = true;
      publishedShareStatus.textContent = '';
    }
    xShareBtn.disabled = true;
    xShareBtn.title = 'Sharing unlocks once the letter has its public page';
    xShareBtn.setAttribute('aria-label', 'Sharing is not available yet');
    publicShareBtn.disabled = true;
    publicShareBtn.setAttribute('aria-expanded', 'false');
    publicShareBtn.setAttribute('aria-label', 'Sharing is not available yet');
    publicShareBtn.title = 'Public sharing unlocks once the letter has its public page';
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
    if (result.kind === 'created') noteQuotaPublished();
    else refreshQuota(true);
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
      ? 'Share it publicly or on X so someone can find it.'
      : 'Sharing unlocks once the live service can serve this letter.');
  }

  /* لینک فقط وقتی باز می‌شود که خودِ سرویس همان نامه را با همین شناسه برگرداند.
     ورکرِ منتشرنشده ۴۰۴ می‌دهد و دکمه قفل می‌ماند تا لینک مرده ساخته نشود.
     خواندنِ بلافاصله ممکن است پیش از دیده‌شدنِ نامه یا در شبکهٔ کند شکست بخورد؛
     پس سه تلاش با فاصله انجام می‌شود و قفل فقط پس از شکستِ هر سه می‌ماند. */
  function unlockShare(id) {
    if (!api || typeof api.getLetter !== 'function' || typeof api.letterUrl !== 'function') return;
    var url = api.letterUrl(id);
    if (!url) return;
    var token = ++shareVerifySeq;
    var attempt = 0;
    function verify() {
      if (!published || shareUrl || token !== shareVerifySeq || !api) return;
      api.getLetter(id).then(function (res) {
        if (!published || shareUrl || token !== shareVerifySeq) return;
        if (res.status === 'ok' && res.letter.id === id) {
          shareUrl = url;
          shareNote(true);
          xShareBtn.disabled = false;
          xShareBtn.title = 'Share this letter on X';
          xShareBtn.setAttribute('aria-label', 'Share this letter on X');
          publicShareBtn.disabled = false;
          publicShareBtn.title = 'Share this letter publicly';
          publicShareBtn.setAttribute('aria-label', 'Share this letter publicly');
          return;
        }
        retry();
      }, retry);
    }
    function retry() {
      attempt += 1;
      if (attempt >= SHARE_VERIFY_DELAYS.length) return;
      setTimeout(verify, SHARE_VERIFY_DELAYS[attempt]);
    }
    verify();
  }

  /* اشتراک در X: فقط با اقدام صریحِ کاربر و فقط پس از ثبت واقعی. متنِ ثابت است
     و هرگز متن نامه را در بر نمی‌گیرد؛ فقط زبانِ نامه انتخابش می‌کند. */
  function onShareX() {
    if (!published || !shareUrl) return;
    closePublishedShare(false);
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

  /* A writing instrument, not a leaf: closed vane, thin silver strokes, barbs,
     and a metal nib that catches the same light as the player's glass. */
  var quillSvgSeq = 0;
  function quillSvg(size, className) {
    var id = 'void-quill-nib-' + (++quillSvgSeq);
    var svg = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    if (className) svg.setAttribute('class', className);
    if (size) { svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); }

    var defs = svgNode('defs');
    var grad = svgNode('linearGradient', {
      id: id, gradientUnits: 'userSpaceOnUse',
      x1: '9.9', y1: '15.1', x2: '5.2', y2: '21.6'
    });
    grad.appendChild(svgNode('stop', { offset: '0', 'stop-color': '#f8fbff' }));
    grad.appendChild(svgNode('stop', { offset: '.5', 'stop-color': '#c7d1dc' }));
    grad.appendChild(svgNode('stop', { offset: '1', 'stop-color': '#7f8b98' }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    var feather = svgNode('g', {
      fill: 'none', stroke: 'currentColor', 'stroke-width': '1.25',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    });
    feather.appendChild(svgNode('path', {
      d: 'M20.4 3.6c.5 6.3-3.1 10.6-10 11.6-1 .1-1.9-.1-2.6-.5.1-1.8.8-3.4 2.1-4.7 2.7-2.8 6.5-4.9 10.5-6.4Z'
    }));
    feather.appendChild(svgNode('path', { d: 'M20.4 3.6 10.4 15.9' }));
    feather.appendChild(svgNode('path', { d: 'M16.8 8.1c-1.8.4-3.5 1.4-5 2.9' }));
    feather.appendChild(svgNode('path', { d: 'M13.8 11.4c-1.1.7-2 1.7-2.7 3' }));
    svg.appendChild(feather);

    svg.appendChild(svgNode('path', {
      class: 'void-quill__nib',
      d: 'M9.9 15.1 11.6 16.8 5.2 21.6 4.3 19.4Z',
      fill: 'url(#' + id + ')',
      stroke: 'currentColor', 'stroke-opacity': '.45',
      'stroke-width': '.7', 'stroke-linejoin': 'round'
    }));
    svg.appendChild(svgNode('path', {
      class: 'void-quill__slit',
      d: 'M9.6 16.5 6.3 19.8',
      stroke: '#0b0e13', 'stroke-opacity': '.55',
      'stroke-width': '.7', 'stroke-linecap': 'round'
    }));
    return svg;
  }

  function mailSvg(className) {
    var svg = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    if (className) svg.setAttribute('class', className);
    var g = svgNode('g', {
      fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    });
    g.appendChild(svgNode('path', { d: 'M4.2 6.4h15.6a1 1 0 0 1 1 1v9.2a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V7.4a1 1 0 0 1 1-1Z' }));
    g.appendChild(svgNode('path', { d: 'M3.6 7.2 12 13l8.4-5.8' }));
    svg.appendChild(g);
    return svg;
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
    quillBtn.setAttribute('aria-describedby', 'void-god-quota-sr');
    quillBtn.appendChild(quillSvg(20, 'void-god-quill__icon'));
    quillDrops = buildMeter(quillBtn, 'void-god-quill__drops');
    host.appendChild(quillBtn);
    quillBtn.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'touch') return;
      showQuotaPop(quillBtn, false);
    });
    quillBtn.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'touch') return;
      scheduleQuotaPopHide();
    });
    quillBtn.addEventListener('focus', function () { showQuotaPop(quillBtn, false); });
    quillBtn.addEventListener('blur', function () { scheduleQuotaPopHide(); });
    quillBtn.addEventListener('click', function () {
      /* On a TV the tools are always visible (void-tv.css), so the first remote
         activation must act instead of spending a press on the reveal intro. */
      var tvRemote = document.documentElement.classList.contains('void-tv');
      if (!tvRemote && (!toolsRevealed || toolsIntro)) {
        toolsIntro = false;
        showToolPalette();
        if (touchPointer()) showQuotaPop(quillBtn, true);
        return;
      }
      if (quotaExhaustedNow()) {
        showQuotaPop(quillBtn, touchPointer());
        refreshQuota(true);
        return;
      }
      hideQuotaPop();
      hideToolPalette();
      openCompose();
    });
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
      var tvRemote = document.documentElement.classList.contains('void-tv');
      if (!tvRemote && (!toolsRevealed || toolsIntro)) {
        toolsIntro = false;
        showToolPalette();
        return;
      }
      hideToolPalette();
      var c = holeCenter();
      openMessageAt(c.x, c.y);
    });
    positionStatsIndicator();
  }

  /* One compact glass tooltip serves both entry points. It is not permanent:
     it appears on hover/focus, on the first touch tap that reveals the tools,
     or when an exhausted action is activated. */
  function buildQuotaPop(host) {
    if (quotaPop) return;
    quotaPop = make('div', 'void-god-quota-pop');
    quotaPop.id = 'void-god-quota-pop';
    quotaPop.setAttribute('role', 'tooltip');
    quotaPop.hidden = true;
    var top = make('div', 'void-god-quota-pop__top');
    var qi = make('span', 'void-god-quota-pop__quill');
    qi.appendChild(quillSvg(18));
    top.appendChild(qi);
    buildMeter(top, 'void-god-quota-pop__meter');
    quotaPop.appendChild(top);
    quotaPopText = make('span', 'void-god-quota-pop__text', '');
    quotaPop.appendChild(quotaPopText);
    quotaPopNext = make('span', 'void-god-quota-pop__next', '');
    quotaPopNext.hidden = true;
    quotaPop.appendChild(quotaPopNext);
    host.appendChild(quotaPop);

    var sr = make('span', 'void-god-sr', '');
    sr.id = 'void-god-quota-sr';
    host.appendChild(sr);

    document.addEventListener('pointerdown', function (e) {
      if (!quotaPop || quotaPop.hidden) return;
      if (quotaPopAnchor && quotaPopAnchor.contains(e.target)) return;
      hideQuotaPop();
    }, true);
    window.addEventListener('resize', function () {
      if (quotaPopAnchor) placeQuotaPop(quotaPopAnchor);
    });
  }

  function buildUi(host) {
    if (compose) return;
    buildQuill(host);
    buildGalaxy(host);
    buildPanel(host);
    buildSharePop(host);
    buildTranslatePop(host);
    buildCompose(host);
    buildQuotaPop(host);
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
      if (translatePopOpen) closeTranslatePop(true);
      else if (sharePopOpen) closeSharePop(true);
      else if (publishedShareOpen) closePublishedShare(true);
      else if (compose && compose.open) closeCompose();
      else if (panelOpen) closePanel({ dissolve: true, focus: true });
      else closeStats(true);
      return;
    }
    /* The capture guard runs before the popover's own keydown handler, so
       popover navigation has to be forwarded here instead of swallowed. */
    var keyTarget = e.target;
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (translatePopOpen && translatePop && keyTarget && translatePop.contains(keyTarget)) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
          e.stopPropagation();
          onTranslatePopKey(e);
          return;
        }
      }
      if (keyTarget === panelTranslate && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        e.stopPropagation();
        openTranslatePop();
        return;
      }
      if (sharePopOpen && sharePop && keyTarget && sharePop.contains(keyTarget) &&
          (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.stopPropagation();
        onSharePopKey(e);
        return;
      }
      if (keyTarget === panelShareMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        e.stopPropagation();
        openSharePop();
        return;
      }
    }
    /* Let the dialog own arrows/space (radios, buttons); only keep the player's
       document-capture shortcuts from firing underneath the open surface. */
    if (!e.ctrlKey && !e.metaKey && !e.altKey && PLAYER_KEYS[e.key]) e.stopPropagation();
  }

  function bindKeys() {
    if (guardOn) return;
    guardOn = true;
    window.addEventListener('pointerdown', function (e) {
      rememberMusicPresentation();
      if (toolsIntro && e && e.target && e.target.closest &&
          e.target.closest('#void-topnav, #void-god-quill, #void-god-discover, #void-music-root')) {
        showToolPalette(true);
      }
    }, true);
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
    if (mount()) { showToolPalette(true); openDeepLink(); return; }
    var tries = 0;
    (function retry() {
      if (mount()) { showToolPalette(true); openDeepLink(); return; }
      if (++tries > 120) return;            // ~۲ ثانیه صبر برای ساختِ ریشهٔ پلیر
      setTimeout(retry, 16);
    })();
  }

  window.VoidLetters = { setCount: setCount, hide: hide };

  if (document.readyState === 'complete') requestAnimationFrame(start);
  else window.addEventListener('load', function () { requestAnimationFrame(start); }, { once: true });
})();
