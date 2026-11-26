/* Void Podcast — Stage 3A client feed parser. Pure helpers + DOMParser-based
   extraction (RSS 2.0 + iTunes tags, basic Atom). Everything rendered from a
   feed goes through stripHtml/decodeEntities and then textContent — no feed
   string ever reaches innerHTML. Media URLs are https-only and host-checked.
   UMD: Node tests import the same module the browser loads. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.VoidPodcastFeed = factory(); }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var MAX_EPISODES = 100;
  var DESC_CAP = 600;
  var OPML_CAP = 200;

  /* FNV-1a 32-bit — deterministic, dependency-free episode/show identity. */
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function normalizeFeedUrl(u) {
    var s = String(u == null ? '' : u).trim();
    try {
      var p = new URL(s);
      p.hash = '';
      p.hostname = p.hostname.toLowerCase().replace(/\.$/, '');
      return p.toString();
    } catch (e) { return s; }
  }
  function showIdFor(feedUrl) { return 'feed-' + fnv1a(normalizeFeedUrl(feedUrl)); }
  /* guid is the stable identity; a changed guid yields a new id (the old
     progress entry is pruned later). No guid → enclosure URL. Duplicates are
     de-duplicated by id at parse time. */
  function episodeId(feedUrl, guid, enclosureUrl) {
    return 'ep-' + fnv1a(normalizeFeedUrl(feedUrl) + '|' + (guid || enclosureUrl || ''));
  }

  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeEntities(s) {
    return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, g) {
      if (g.charAt(0) === '#') {
        var code = (g.charAt(1) === 'x' || g.charAt(1) === 'X') ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        if (!isFinite(code) || code < 0 || code > 0x10FFFF) { return ' '; }
        try { return String.fromCodePoint(code); } catch (e) { return ' '; }
      }
      return Object.prototype.hasOwnProperty.call(NAMED, g) ? NAMED[g] : m;
    });
  }
  /* One decode pass only: &amp;lt;script&amp;gt; becomes the literal text
     "<script>", never a tag. Block boundaries become spaces. */
  function stripHtml(html) {
    var s = String(html == null ? '' : html);
    s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ');
    s = s.replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ');
    s = s.replace(/<!--[\s\S]*?-->/g, ' ');
    s = s.replace(/<\s*\/?\s*(br|p|div|li|h[1-6]|tr|ul|ol|blockquote|section|article)\b[^>]*>/gi, ' ');
    s = s.replace(/<[^>]*>/g, '');
    s = s.replace(/<[^>]*$/g, '');
    s = decodeEntities(s);
    return s.replace(/\s+/g, ' ').trim();
  }

  function parseDuration(v) {
    if (typeof v === 'number' && isFinite(v) && v >= 0) { return Math.round(v); }
    var s = String(v == null ? '' : v).trim();
    if (!s) { return 0; }
    if (/^\d+(\.\d+)?$/.test(s)) { return Math.round(parseFloat(s)); }
    var parts = s.split(':');
    if (parts.length < 2 || parts.length > 3) { return 0; }
    var sec = 0;
    for (var i = 0; i < parts.length; i++) {
      var n = parseFloat(parts[i]);
      if (!isFinite(n) || n < 0) { return 0; }
      sec = sec * 60 + n;
    }
    return Math.round(sec);
  }
  function parseDateMs(v) {
    var ms = Date.parse(String(v == null ? '' : v));
    return isFinite(ms) ? ms : 0;
  }
  /* Phase 2B.3 (M4): itunes:season / itunes:episode are kept only as plain
     non-negative integers. Anything else (ranges, "1 of 12", negatives, text)
     becomes 0, which every consumer reads as "the feed never said". */
  function parsePositiveInt(v) {
    var s = String(v == null ? '' : v).trim();
    if (!/^\d{1,9}$/.test(s)) { return 0; }
    var n = parseInt(s, 10);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  /* Paste classification: a URL (scheme optional) vs search text. */
  function looksLikeUrl(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s || /\s/.test(s)) { return ''; }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) { return s; }
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(s)) { return 'https://' + s; }
    return '';
  }
  /* Artwork and enclosures load directly from the publisher: https only, no
     credentials, no IP literals or private names (mixed content + SSRF hygiene).
     `base` (Phase 2B.3/M1) resolves relative references — a value that parses on
     its own is never re-resolved, so absolute URLs behave exactly as before and
     every check below still applies to the resolved result. */
  function resolveUrl(s, base) {
    if (!s) { return null; }                     /* an empty reference never resolves to the base itself */
    try { return new URL(s); } catch (e) {
      if (!base) { return null; }
      try { return new URL(s, base); } catch (e2) { return null; }
    }
  }
  function safeMediaUrl(u, base) {
    var s = String(u == null ? '' : u).trim();
    if (!s) { return ''; }
    var p = resolveUrl(s, base);
    if (!p) { return ''; }
    if (p.protocol !== 'https:' || p.username || p.password) { return ''; }
    var h = p.hostname.toLowerCase();
    if (!h || h.indexOf('.') < 0 || h === 'localhost') { return ''; }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.charAt(0) === '[') { return ''; }
    if (/\.(local|internal|localhost|home\.arpa|example|invalid|test)$/.test(h)) { return ''; }
    p.hash = '';
    return p.toString();
  }

  function initialsOf(title) {
    var words = String(title || '').trim().split(/\s+/).filter(function (w) { return !!w; });
    if (!words.length) { return '?'; }
    var out = words[0].charAt(0);
    if (words.length > 1) { out += words[1].charAt(0); }
    else if (words[0].length > 1) { out += words[0].charAt(1); }
    return out.toUpperCase();
  }
  function truncate(s, cap) {
    var t = String(s == null ? '' : s);
    return t.length > cap ? t.slice(0, cap - 1) + '…' : t;
  }
  function escapeXml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function buildOpml(shows, dateIso) {
    var lines = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<opml version="2.0">', '<head>', '<title>Void Podcast subscriptions</title>',
      '<dateCreated>' + escapeXml(dateIso || '') + '</dateCreated>', '</head>', '<body>'];
    (shows || []).forEach(function (sh) {
      if (!sh || !sh.feedUrl) { return; }
      var t = escapeXml(sh.title || sh.feedUrl);
      lines.push('<outline text="' + t + '" title="' + t + '" type="rss" xmlUrl="' + escapeXml(sh.feedUrl) + '"/>');
    });
    lines.push('</body>', '</opml>');
    return lines.join('\n');
  }
  function extractOpml(doc) {
    var out = [], seen = {};
    var nodes = doc.getElementsByTagName('outline');
    for (var i = 0; i < nodes.length && out.length < OPML_CAP; i++) {
      var url = nodes[i].getAttribute('xmlUrl') || nodes[i].getAttribute('xmlurl') || '';
      url = String(url).trim();
      if (!url || seen[url]) { continue; }
      seen[url] = true;
      out.push({ title: String(nodes[i].getAttribute('text') || nodes[i].getAttribute('title') || url), xmlUrl: url });
    }
    return out;
  }

  /* ---- DOM extraction (browser DOMParser; Node tests inject a shim) ---- */
  function textOf(node) { return node ? String(node.textContent || '').trim() : ''; }
  /* Namespaced tags must not depend on the publisher's prefix choice:
     <itunes:duration>, <it:duration> and <x xmlns="…itunes…"><duration> all match
     "itunes:duration". Bare tags stay exact (XML is case-sensitive). The Node
     shim has no localName/namespaceURI, so those branches simply never fire. */
  function tagMatches(node, tag) {
    if (!node || node.nodeType !== 1) { return false; }
    var t = node.tagName;
    if (t === tag) { return true; }
    var ci = tag.indexOf(':');
    if (ci < 0) { return false; }
    var local = tag.slice(ci + 1).toLowerCase();
    var nt = String(t).toLowerCase();
    if (nt.length > local.length && nt.charAt(nt.length - local.length - 1) === ':' &&
        nt.slice(nt.length - local.length) === local) { return true; }
    var ns = String(node.namespaceURI || '').toLowerCase();
    return ns.indexOf(tag.slice(0, ci).toLowerCase()) >= 0 &&
      String(node.localName || '').toLowerCase() === local;
  }
  /* Phase 2B.3 (M3): Atom documents are legal with any prefix — <a:feed>,
     <atom:entry>, <a:link> — while getElementsByTagName('feed') only sees the
     unprefixed spelling. Accepted forms, in order: exact tag name (what the
     unprefixed path and the Node test shim always produce), a prefix that is
     not one of the known podcast/media extension namespaces, and the parser's
     own namespaceURI + localName when it exposes them. */
  var ATOM_NS = 'http://www.w3.org/2005/Atom';
  var FOREIGN_ATOM_PREFIXES = ['itunes', 'it', 'media', 'm', 'googleplay', 'gp', 'podcast',
    'dc', 'content', 'xhtml', 'webfeeds', 'cc', 'creativecommons'];
  function isAtomTag(node, local) {
    if (!node || node.nodeType !== 1) { return false; }
    var t = String(node.tagName || '');
    if (t === local) { return true; }
    var ci = t.indexOf(':');
    if (ci > 0) {
      if (t.slice(ci + 1) !== local) { return false; }
      return FOREIGN_ATOM_PREFIXES.indexOf(t.slice(0, ci).toLowerCase()) < 0;
    }
    return String(node.namespaceURI || '') === ATOM_NS && String(node.localName || '') === local;
  }
  function atomChildEl(parent, local) {
    var n = (parent && parent.childNodes) || [];
    for (var i = 0; i < n.length; i++) {
      if (isAtomTag(n[i], local)) { return n[i]; }
    }
    return null;
  }
  function atomText(parent, local) { return textOf(atomChildEl(parent, local)); }
  /* Depth-first search for `local`, not descending into a node it already
     matched (entries never nest). Prefixed-safe replacement for
     getElementsByTagName('entry'). */
  function atomFindAll(root, local, out) {
    var n = (root && root.childNodes) || [];
    for (var i = 0; i < n.length; i++) {
      if (n[i].nodeType !== 1) { continue; }
      if (isAtomTag(n[i], local)) { out.push(n[i]); }
      else { atomFindAll(n[i], local, out); }
    }
    return out;
  }
  function atomRootOf(doc) {
    var plain = doc.getElementsByTagName('feed');
    if (plain && plain.length) { return plain[0]; }
    var de = doc.documentElement;
    return isAtomTag(de, 'feed') ? de : null;
  }
  function atomLinks(el) {
    var n = (el && el.childNodes) || [], out = [];
    for (var i = 0; i < n.length; i++) {
      if (isAtomTag(n[i], 'link')) { out.push(n[i]); }
    }
    return out;
  }
  function childEl(parent, tag) {
    var n = parent.childNodes || [];
    for (var i = 0; i < n.length; i++) {
      if (tagMatches(n[i], tag)) { return n[i]; }
    }
    return null;
  }
  function childText(parent, tag) { return textOf(childEl(parent, tag)); }
  function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
  /* Channel homepage links are plain RSS <channel><link> text. They must be
     absolute web URLs; never resolve them against the feed URL. */
  function safeSiteUrl(raw, feedUrl, resolvedFeedUrl) {
    if (typeof raw !== 'string') { return null; }
    var s = raw.trim();
    if (!s || s.length > 500) { return null; }
    try {
      var p = new URL(s);
      if ((p.protocol !== 'http:' && p.protocol !== 'https:') || p.username || p.password) { return null; }
      p.hash = '';
      var value = p.toString();
      if (value.length > 500) { return null; }
      var comparable = normalizeFeedUrl(value);
      if (comparable === normalizeFeedUrl(feedUrl || '') || comparable === normalizeFeedUrl(resolvedFeedUrl || '')) { return null; }
      return value;
    } catch (e) { return null; }
  }
  function isPlatformSiteUrl(value) {
    try {
      var host = new URL(value).hostname.toLowerCase().replace(/\.$/, '');
      return host === 'castbox.fm' || host.slice(-11) === '.castbox.fm' ||
        host === 'rss.com' || host.slice(-8) === '.rss.com';
    } catch (e) { return false; }
  }
  function rssChannelLink(channel) {
    var nodes = (channel && channel.childNodes) || [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType === 1 && node.tagName === 'link' &&
          String(node.namespaceURI || '') !== ATOM_NS && node.getAttribute('href') === null) {
        return textOf(node);
      }
    }
    return '';
  }

  function makeEpisode(feedUrl, show, raw, base) {
    var audioUrl = safeMediaUrl(raw.audioUrl, base);
    if (!audioUrl) { return null; }
    var ms = parseDateMs(raw.publishedAt);
    var bytes = parseInt(raw.audioBytes, 10);
    return {
      id: episodeId(feedUrl, raw.guid, audioUrl),
      showId: show.id,
      guid: raw.guid || '',
      title: truncate(stripHtml(raw.title), 300) || 'Untitled',
      titleFa: '',
      publishedAt: ms ? new Date(ms).toISOString() : '',
      durationSec: parseDuration(raw.duration),
      seasonNum: parsePositiveInt(raw.season),
      episodeNum: parsePositiveInt(raw.episode),
      audioUrl: audioUrl,
      audioType: String(raw.audioType || ''),
      audioBytes: isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0,
      description: truncate(stripHtml(raw.description), DESC_CAP),
      artUrl: safeMediaUrl(raw.artUrl, base) || show.artUrl,
      chaptersUrl: safeMediaUrl(raw.chaptersUrl, base) || ''
    };
  }
  function finishFeed(kind, show, episodes, resolvedFeedUrl) {
    var seen = {}, out = [];
    episodes.forEach(function (ep) {
      if (!ep || seen[ep.id]) { return; }
      seen[ep.id] = true;
      out.push(ep);
    });
    out.sort(function (a, b) {
      if (!a.publishedAt) { return 1; }
      if (!b.publishedAt) { return -1; }
      return a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0;
    });
    out = out.slice(0, MAX_EPISODES);
    var resolved = safeFeedUrl(resolvedFeedUrl) || '';
    if (resolved && show) { show.resolvedFeedUrl = resolved; }
    return { ok: true, kind: kind, show: show, episodes: out, count: out.length, resolvedFeedUrl: resolved };
  }
  /* Feed self-identification (atom rel="self", itunes:new-feed-url) must be a
     usable https URL; anything else is ignored and the requested URL stands.
     `base` lets a relative self-reference resolve, never weakening the checks. */
  function safeFeedUrl(u, base) {
    var p = resolveUrl(String(u == null ? '' : u).trim(), base);
    if (!p) { return ''; }
    return p.protocol === 'https:' && !p.username && !p.password ? p.toString() : '';
  }

  /* `effectiveUrl` (Phase 2B.3/M2) is the URL the Worker actually fetched after
     following redirects — reported as X-Void-Final-URL. It only ever acts as
     the base for relative references and as resolvedFeedUrl when the feed does
     not self-identify; identity (show/episode ids) stays keyed to the URL the
     user entered, so existing subscriptions and progress survive a move. */
  function extractFeed(doc, feedUrl, effectiveUrl) {
    var url = normalizeFeedUrl(feedUrl);
    var base = safeFeedUrl(effectiveUrl) || safeFeedUrl(url) || '';
    var reported = base && base !== url ? base : '';
    var channel = doc.getElementsByTagName('channel')[0];
    var feedEl = atomRootOf(doc);
    var show, episodes = [], i, items, it, enc, raw;

    if (channel) {
      var owner = childEl(channel, 'itunes:owner');
      var img = childEl(channel, 'itunes:image');
      var imgEl = childEl(channel, 'image');
      var link = rssChannelLink(channel);
      var resolvedUrl = safeFeedUrl(childText(channel, 'itunes:new-feed-url'), base) || reported;
      show = {
        id: showIdFor(url),
        title: truncate(stripHtml(childText(channel, 'title')), 200) || hostOf(url) || 'Podcast',
        titleFa: '',
        publisher: truncate(stripHtml(childText(channel, 'itunes:author') || (owner ? childText(owner, 'itunes:name') : '') || hostOf(link) || hostOf(url)), 120),
        feedUrl: url,
        siteUrl: safeSiteUrl(link, url, resolvedUrl),
        artUrl: safeMediaUrl(img ? img.getAttribute('href') : '', base) || safeMediaUrl(imgEl ? childText(imgEl, 'url') : '', base),
        initials: ''
      };
      show.initials = initialsOf(show.title);
      items = doc.getElementsByTagName('item');
      for (i = 0; i < items.length; i++) {
        it = items[i];
        enc = childEl(it, 'enclosure');
        var chap = childEl(it, 'podcast:chapters');
        var epImg = childEl(it, 'itunes:image');
        var audioUrl = enc ? enc.getAttribute('url') : '';
        var audioType = enc ? (enc.getAttribute('type') || '') : '';
        var audioBytes = enc ? parseInt(enc.getAttribute('length'), 10) : NaN;
        if (!safeMediaUrl(audioUrl, base)) {
          /* media:content only fills in when no usable enclosure exists; a
             valid enclosure always wins so distinct sources never merge. */
          var mc = childEl(it, 'media:content');
          var mu = mc ? mc.getAttribute('url') : '';
          if (mu) {
            audioUrl = mu;
            audioType = mc.getAttribute('type') || '';
            audioBytes = parseInt(mc.getAttribute('fileSize'), 10);
          }
        }
        raw = {
          guid: childText(it, 'guid'),
          title: childText(it, 'title'),
          publishedAt: childText(it, 'pubDate') || childText(it, 'dc:date'),
          duration: childText(it, 'itunes:duration'),
          season: childText(it, 'itunes:season'),
          episode: childText(it, 'itunes:episode'),
          audioUrl: audioUrl,
          audioType: audioType,
          audioBytes: audioBytes,
          description: childText(it, 'description') || childText(it, 'content:encoded'),
          artUrl: epImg ? epImg.getAttribute('href') : '',
          chaptersUrl: chap ? chap.getAttribute('url') : ''
        };
        episodes.push(makeEpisode(url, show, raw, base));
      }
      return finishFeed('rss', show, episodes, resolvedUrl);
    }

    if (feedEl) {
      var links = atomLinks(feedEl), altHref = '', selfHref = '';
      for (i = 0; i < links.length; i++) {
        var rel = links[i].getAttribute('rel') || '';
        var href = links[i].getAttribute('href') || '';
        if (!altHref && (rel === 'alternate' || rel === '')) { altHref = href; }
        if (!selfHref && rel === 'self') { selfHref = href; }
      }
      var author = atomChildEl(feedEl, 'author');
      var aImg = childEl(feedEl, 'itunes:image');
      show = {
        id: showIdFor(url),
        title: truncate(stripHtml(atomText(feedEl, 'title')), 200) || hostOf(url) || 'Podcast',
        titleFa: '',
        publisher: truncate(stripHtml((author ? atomText(author, 'name') : '') || hostOf(altHref) || hostOf(url)), 120),
        feedUrl: url,
        siteUrl: null,
        artUrl: safeMediaUrl(aImg ? aImg.getAttribute('href') : '', base) || safeMediaUrl(atomText(feedEl, 'logo'), base),
        initials: ''
      };
      show.initials = initialsOf(show.title);
      items = atomFindAll(feedEl, 'entry', []);
      for (i = 0; i < items.length; i++) {
        it = items[i];
        var eLinks = atomLinks(it), audio = '', atype = '', aBytes = NaN;
        for (var j = 0; j < eLinks.length; j++) {
          if ((eLinks[j].getAttribute('rel') || '') === 'enclosure') {
            audio = eLinks[j].getAttribute('href') || '';
            atype = eLinks[j].getAttribute('type') || '';
            break;
          }
        }
        if (!safeMediaUrl(audio, base)) {
          var amc = childEl(it, 'media:content');
          var amu = amc ? amc.getAttribute('url') : '';
          if (amu) {
            audio = amu;
            atype = amc.getAttribute('type') || '';
            aBytes = parseInt(amc.getAttribute('fileSize'), 10);
          }
        }
        var aChap = childEl(it, 'podcast:chapters');
        var aEpImg = childEl(it, 'itunes:image');
        raw = {
          guid: atomText(it, 'id'),
          title: atomText(it, 'title'),
          publishedAt: atomText(it, 'published') || atomText(it, 'updated'),
          duration: childText(it, 'itunes:duration'),
          season: childText(it, 'itunes:season'),
          episode: childText(it, 'itunes:episode'),
          audioUrl: audio,
          audioType: atype,
          audioBytes: aBytes,
          description: atomText(it, 'summary') || atomText(it, 'content'),
          artUrl: aEpImg ? aEpImg.getAttribute('href') : '',
          chaptersUrl: aChap ? aChap.getAttribute('url') : ''
        };
        episodes.push(makeEpisode(url, show, raw, base));
      }
      return finishFeed('atom', show, episodes, safeFeedUrl(selfHref, base) || reported);
    }

    return { ok: false, reason: 'not-feed' };
  }

  function parseFeed(xmlText, feedUrl, effectiveUrl) {
    if (typeof DOMParser === 'undefined') { return { ok: false, reason: 'no-parser' }; }
    var doc;
    try { doc = new DOMParser().parseFromString(String(xmlText == null ? '' : xmlText), 'text/xml'); }
    catch (e) { return { ok: false, reason: 'not-feed' }; }
    if (!doc || doc.getElementsByTagName('parsererror').length) { return { ok: false, reason: 'not-feed' }; }
    return extractFeed(doc, feedUrl, effectiveUrl);
  }

  var ERRORS = {
    'invalid-url': { en: 'That link is not valid.', fa: 'نشانی معتبر نیست.' },
    'not-feed': { en: 'No podcast feed found at that link.', fa: 'فید پادکستی در این نشانی پیدا نشد.' },
    'too-large': { en: 'That feed is too large.', fa: 'این فید بیش از حد بزرگ است.' },
    'unreachable': { en: 'Could not reach the feed.', fa: 'دسترسی به فید ممکن نشد.' },
    'timeout': { en: 'The feed took too long to answer.', fa: 'پاسخ فید خیلی طول کشید.' },
    'rate-limited': { en: 'Too many requests — wait a minute.', fa: 'درخواست‌ها زیاد است؛ یک دقیقه صبر کنید.' },
    'network': { en: 'Connection failed.', fa: 'اتصال برقرار نشد.' },
    'no-parser': { en: 'This browser cannot read feeds.', fa: 'مرورگر نمی‌تواند فید را بخواند.' }
  };
  function errorText(code) {
    var e = ERRORS[code] || ERRORS.unreachable;
    return e.en + ' · ' + e.fa;
  }

  return {
    MAX_EPISODES: MAX_EPISODES, DESC_CAP: DESC_CAP, OPML_CAP: OPML_CAP,
    fnv1a: fnv1a, normalizeFeedUrl: normalizeFeedUrl, showIdFor: showIdFor, episodeId: episodeId,
    decodeEntities: decodeEntities, stripHtml: stripHtml,
    parseDuration: parseDuration, parseDateMs: parseDateMs, parsePositiveInt: parsePositiveInt,
    looksLikeUrl: looksLikeUrl, safeMediaUrl: safeMediaUrl, safeFeedUrl: safeFeedUrl,
    safeSiteUrl: safeSiteUrl, isPlatformSiteUrl: isPlatformSiteUrl,
    resolveUrl: resolveUrl, isAtomTag: isAtomTag,
    initialsOf: initialsOf, truncate: truncate, escapeXml: escapeXml,
    buildOpml: buildOpml, extractOpml: extractOpml,
    extractFeed: extractFeed, parseFeed: parseFeed,
    ERRORS: ERRORS, errorText: errorText
  };
});
