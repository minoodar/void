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

  /* Paste classification: a URL (scheme optional) vs search text. */
  function looksLikeUrl(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s || /\s/.test(s)) { return ''; }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) { return s; }
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(s)) { return 'https://' + s; }
    return '';
  }
  /* Artwork and enclosures load directly from the publisher: https only, no
     credentials, no IP literals or private names (mixed content + SSRF hygiene). */
  function safeMediaUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) { return ''; }
    var p;
    try { p = new URL(s); } catch (e) { return ''; }
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
  function childEl(parent, tag) {
    var n = parent.childNodes || [];
    for (var i = 0; i < n.length; i++) {
      if (n[i].nodeType === 1 && n[i].tagName === tag) { return n[i]; }
    }
    return null;
  }
  function childText(parent, tag) { return textOf(childEl(parent, tag)); }
  function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }

  function makeEpisode(feedUrl, show, raw) {
    var audioUrl = safeMediaUrl(raw.audioUrl);
    if (!audioUrl) { return null; }
    var ms = parseDateMs(raw.publishedAt);
    return {
      id: episodeId(feedUrl, raw.guid, audioUrl),
      showId: show.id,
      guid: raw.guid || '',
      title: truncate(stripHtml(raw.title), 300) || 'Untitled',
      titleFa: '',
      publishedAt: ms ? new Date(ms).toISOString() : '',
      durationSec: parseDuration(raw.duration),
      audioUrl: audioUrl,
      audioType: String(raw.audioType || ''),
      description: truncate(stripHtml(raw.description), DESC_CAP),
      artUrl: safeMediaUrl(raw.artUrl) || show.artUrl,
      chaptersUrl: safeMediaUrl(raw.chaptersUrl) || ''
    };
  }
  function finishFeed(kind, show, episodes) {
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
    return { ok: true, kind: kind, show: show, episodes: out, count: out.length };
  }

  function extractFeed(doc, feedUrl) {
    var url = normalizeFeedUrl(feedUrl);
    var channel = doc.getElementsByTagName('channel')[0];
    var feedEl = doc.getElementsByTagName('feed')[0];
    var show, episodes = [], i, items, it, enc, raw;

    if (channel) {
      var owner = childEl(channel, 'itunes:owner');
      var img = childEl(channel, 'itunes:image');
      var imgEl = childEl(channel, 'image');
      var link = childText(channel, 'link');
      show = {
        id: showIdFor(url),
        title: truncate(stripHtml(childText(channel, 'title')), 200) || hostOf(url) || 'Podcast',
        titleFa: '',
        publisher: truncate(stripHtml(childText(channel, 'itunes:author') || (owner ? childText(owner, 'itunes:name') : '') || hostOf(link) || hostOf(url)), 120),
        feedUrl: url,
        artUrl: safeMediaUrl(img ? img.getAttribute('href') : '') || safeMediaUrl(imgEl ? childText(imgEl, 'url') : ''),
        initials: ''
      };
      show.initials = initialsOf(show.title);
      items = doc.getElementsByTagName('item');
      for (i = 0; i < items.length; i++) {
        it = items[i];
        enc = childEl(it, 'enclosure');
        var chap = childEl(it, 'podcast:chapters');
        var epImg = childEl(it, 'itunes:image');
        raw = {
          guid: childText(it, 'guid'),
          title: childText(it, 'title'),
          publishedAt: childText(it, 'pubDate') || childText(it, 'dc:date'),
          duration: childText(it, 'itunes:duration'),
          audioUrl: enc ? enc.getAttribute('url') : '',
          audioType: enc ? enc.getAttribute('type') : '',
          description: childText(it, 'description') || childText(it, 'content:encoded'),
          artUrl: epImg ? epImg.getAttribute('href') : '',
          chaptersUrl: chap ? chap.getAttribute('url') : ''
        };
        episodes.push(makeEpisode(url, show, raw));
      }
      return finishFeed('rss', show, episodes);
    }

    if (feedEl) {
      var links = feedEl.childNodes || [], altHref = '', encHref = '';
      for (i = 0; i < links.length; i++) {
        if (links[i].nodeType !== 1 || links[i].tagName !== 'link') { continue; }
        var rel = links[i].getAttribute('rel') || '';
        var href = links[i].getAttribute('href') || '';
        if (!altHref && (rel === 'alternate' || rel === '')) { altHref = href; }
      }
      var author = childEl(feedEl, 'author');
      var aImg = childEl(feedEl, 'itunes:image');
      show = {
        id: showIdFor(url),
        title: truncate(stripHtml(childText(feedEl, 'title')), 200) || hostOf(url) || 'Podcast',
        titleFa: '',
        publisher: truncate(stripHtml((author ? childText(author, 'name') : '') || hostOf(altHref) || hostOf(url)), 120),
        feedUrl: url,
        artUrl: safeMediaUrl(aImg ? aImg.getAttribute('href') : '') || safeMediaUrl(childText(feedEl, 'logo')),
        initials: ''
      };
      show.initials = initialsOf(show.title);
      items = doc.getElementsByTagName('entry');
      for (i = 0; i < items.length; i++) {
        it = items[i];
        var eLinks = it.childNodes || [], audio = '', atype = '';
        for (var j = 0; j < eLinks.length; j++) {
          if (eLinks[j].nodeType === 1 && eLinks[j].tagName === 'link' && (eLinks[j].getAttribute('rel') || '') === 'enclosure') {
            audio = eLinks[j].getAttribute('href') || '';
            atype = eLinks[j].getAttribute('type') || '';
            break;
          }
        }
        var aChap = childEl(it, 'podcast:chapters');
        var aEpImg = childEl(it, 'itunes:image');
        raw = {
          guid: childText(it, 'id'),
          title: childText(it, 'title'),
          publishedAt: childText(it, 'published') || childText(it, 'updated'),
          duration: childText(it, 'itunes:duration'),
          audioUrl: audio,
          audioType: atype,
          description: childText(it, 'summary') || childText(it, 'content'),
          artUrl: aEpImg ? aEpImg.getAttribute('href') : '',
          chaptersUrl: aChap ? aChap.getAttribute('url') : ''
        };
        episodes.push(makeEpisode(url, show, raw));
      }
      return finishFeed('atom', show, episodes);
    }

    return { ok: false, reason: 'not-feed' };
  }

  function parseFeed(xmlText, feedUrl) {
    if (typeof DOMParser === 'undefined') { return { ok: false, reason: 'no-parser' }; }
    var doc;
    try { doc = new DOMParser().parseFromString(String(xmlText == null ? '' : xmlText), 'text/xml'); }
    catch (e) { return { ok: false, reason: 'not-feed' }; }
    if (!doc || doc.getElementsByTagName('parsererror').length) { return { ok: false, reason: 'not-feed' }; }
    return extractFeed(doc, feedUrl);
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
    parseDuration: parseDuration, parseDateMs: parseDateMs,
    looksLikeUrl: looksLikeUrl, safeMediaUrl: safeMediaUrl,
    initialsOf: initialsOf, truncate: truncate, escapeXml: escapeXml,
    buildOpml: buildOpml, extractOpml: extractOpml,
    extractFeed: extractFeed, parseFeed: parseFeed,
    ERRORS: ERRORS, errorText: errorText
  };
});