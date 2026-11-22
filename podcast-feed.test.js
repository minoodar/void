// Node tests for podcast-feed.js — pure helpers plus DOM extraction through a
// minimal XML DOM shim (the browser path uses DOMParser; same extractFeed code).
const test = require('node:test');
const assert = require('node:assert/strict');
const Feed = require('./podcast-feed.js');

/* ---- tiny XML DOM shim: childNodes/nodeType/tagName/getAttribute/textContent/
   getElementsByTagName — exactly the surface extractFeed/extractOpml use ---- */
function decode(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') {
      const c = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return isFinite(c) && c >= 0 && c <= 0x10FFFF ? String.fromCodePoint(c) : ' ';
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[g] || m;
  });
}
function makeEl(tag, attrs) {
  const node = {
    nodeType: 1, tagName: tag, attrs: attrs || {}, childNodes: [], parentNode: null,
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    get textContent() { return this.childNodes.map(c => c.textContent).join(''); },
    getElementsByTagName(t) {
      const out = [];
      const walk = n => { n.childNodes.forEach(c => { if (c.nodeType === 1) { if (c.tagName === t) { out.push(c); } walk(c); } }); };
      walk(this);
      return out;
    }
  };
  return node;
}
function miniDom(xml) {
  const doc = makeEl('#document', {});
  doc.nodeType = 9;
  const stack = [doc];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/)?([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>|([^<]+)/g;
  let m;
  while ((m = re.exec(String(xml)))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.childNodes.push({ nodeType: 3, textContent: m[1] }); continue; }
    if (m[2]) {
      for (let i = stack.length - 1; i > 0; i--) { if (stack[i].tagName === m[3]) { stack.length = i; break; } }
      continue;
    }
    if (m[6]) { top.childNodes.push({ nodeType: 3, textContent: decode(m[6]) }); continue; }
    if (m[3] !== undefined) {
      const attrs = {};
      const ar = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = ar.exec(m[4] || ''))) { attrs[a[1]] = decode(a[3] !== undefined ? a[3] : a[4]); }
      const el = makeEl(m[3], attrs);
      el.parentNode = top;
      top.childNodes.push(el);
      if (!m[5]) { stack.push(el); }
      continue;
    }
  }
  doc.documentElement = doc.childNodes.find(c => c.nodeType === 1) || null;
  return doc;
}

const FEED_URL = 'https://feeds.example.com/show.xml';
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel>
  <title>Night &amp; Day</title>
  <link>https://show.example.com</link>
  <description>A show about &lt;b&gt;radio&lt;/b&gt;</description>
  <itunes:author>Orbital Radio</itunes:author>
  <itunes:image href="https://img.example.com/art.jpg"/>
  <item>
    <title>Episode &lt;i&gt;Two&lt;/i&gt;</title>
    <guid>guid-2</guid>
    <pubDate>Tue, 04 Nov 2026 10:00:00 GMT</pubDate>
    <itunes:duration>1:02:03</itunes:duration>
    <enclosure url="https://cdn.example.com/e2.mp3" type="audio/mpeg" length="123"/>
    <description><![CDATA[<p>Hello <script>alert(1)</script> world</p>&amp; more]]></description>
    <podcast:chapters url="https://cdn.example.com/e2.json" type="application/json+chapters"/>
  </item>
  <item>
    <title>Episode One</title>
    <guid>guid-1</guid>
    <pubDate>Mon, 03 Nov 2026 10:00:00 GMT</pubDate>
    <itunes:duration>600</itunes:duration>
    <enclosure url="https://cdn.example.com/e1.mp3" type="audio/mpeg"/>
    <itunes:image href="https://img.example.com/e1.jpg"/>
  </item>
  <item><title>No audio</title><guid>guid-x</guid></item>
  <item>
    <title>Duplicate guid</title>
    <guid>guid-2</guid>
    <enclosure url="https://cdn.example.com/dup.mp3" type="audio/mpeg"/>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <title>Atom Show</title>
  <link rel="alternate" href="https://atom.example.com"/>
  <author><name>Atom Author</name></author>
  <entry>
    <id>urn:uuid:1</id>
    <title>First entry</title>
    <published>2026-11-01T08:00:00Z</published>
    <itunes:duration>02:03</itunes:duration>
    <link rel="enclosure" href="https://cdn.example.com/a1.mp3" type="audio/mpeg"/>
    <summary>&lt;p&gt;Summary text&lt;/p&gt;</summary>
  </entry>
  <entry><id>urn:uuid:2</id><title>No enclosure</title></entry>
</feed>`;

/* ---- identity ---- */
test('fnv1a is deterministic 8-hex; ids hash feedUrl+guid with enclosure fallback', () => {
  assert.match(Feed.fnv1a('x'), /^[0-9a-f]{8}$/);
  assert.equal(Feed.fnv1a('abc'), Feed.fnv1a('abc'));
  assert.notEqual(Feed.fnv1a('abc'), Feed.fnv1a('abd'));
  const a = Feed.episodeId(FEED_URL, 'g1', 'https://cdn.example.com/a.mp3');
  assert.equal(a, Feed.episodeId(FEED_URL, 'g1', 'https://cdn.example.com/other.mp3'));
  assert.notEqual(a, Feed.episodeId(FEED_URL, 'g2', 'https://cdn.example.com/a.mp3'));
  const noGuid = Feed.episodeId(FEED_URL, '', 'https://cdn.example.com/a.mp3');
  assert.equal(noGuid, Feed.episodeId(FEED_URL, null, 'https://cdn.example.com/a.mp3'));
  assert.notEqual(noGuid, Feed.episodeId(FEED_URL, '', 'https://cdn.example.com/b.mp3'));
  assert.equal(Feed.showIdFor(FEED_URL), Feed.showIdFor(FEED_URL + '#frag'));
  assert.equal(Feed.normalizeFeedUrl('https://FEEDS.Example.com/show.xml#x'), FEED_URL);
});

/* ---- text hygiene ---- */
test('stripHtml neutralizes scripts, styles, comments, tags and entities', () => {
  assert.equal(Feed.stripHtml('<p>Hello <script>alert(1)</script> world</p>'), 'Hello world');
  assert.equal(Feed.stripHtml('<style>x{}</style>A<br>B'), 'A B');
  assert.equal(Feed.stripHtml('<!-- hidden -->Visible'), 'Visible');
  assert.equal(Feed.stripHtml('a &amp; b &lt; c &#65; &#x42;'), 'a & b < c A B');
  assert.equal(Feed.stripHtml('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
  assert.equal(Feed.stripHtml('one<p>two</p><div>three</div>'), 'one two three');
  assert.equal(Feed.stripHtml('tail <img src="x"'), 'tail');
  assert.equal(Feed.stripHtml(null), '');
  assert.equal(Feed.stripHtml('  a\n\t b  '), 'a b');
});

test('parseDuration handles HH:MM:SS, MM:SS, seconds and garbage', () => {
  assert.equal(Feed.parseDuration('1:02:03'), 3723);
  assert.equal(Feed.parseDuration('02:03'), 123);
  assert.equal(Feed.parseDuration('3600'), 3600);
  assert.equal(Feed.parseDuration(3600.4), 3600);
  assert.equal(Feed.parseDuration(''), 0);
  assert.equal(Feed.parseDuration('abc'), 0);
  assert.equal(Feed.parseDuration('1:2:3:4'), 0);
  assert.equal(Feed.parseDuration('-5'), 0);
});

test('parseDateMs handles RFC822 and ISO, rejects garbage', () => {
  assert.equal(Feed.parseDateMs('Tue, 04 Nov 2026 10:00:00 GMT'), Date.parse('2026-11-04T10:00:00Z'));
  assert.equal(Feed.parseDateMs('2026-11-01T08:00:00Z'), Date.parse('2026-11-01T08:00:00Z'));
  assert.equal(Feed.parseDateMs('not a date'), 0);
  assert.equal(Feed.parseDateMs(null), 0);
});

/* ---- paste classification + media URLs ---- */
test('looksLikeUrl separates URLs from search text', () => {
  assert.equal(Feed.looksLikeUrl('https://x.com/f.xml'), 'https://x.com/f.xml');
  assert.equal(Feed.looksLikeUrl('feeds.example.com/show.xml'), 'https://feeds.example.com/show.xml');
  assert.equal(Feed.looksLikeUrl('http://x.com/f'), 'http://x.com/f');
  assert.equal(Feed.looksLikeUrl('dark matter diaries'), '');
  assert.equal(Feed.looksLikeUrl(''), '');
  assert.equal(Feed.looksLikeUrl('  https://x.com/f  '), 'https://x.com/f');
});

test('safeMediaUrl is https-only and rejects private hosts', () => {
  assert.equal(Feed.safeMediaUrl('https://cdn.example.com/a.mp3'), 'https://cdn.example.com/a.mp3');
  assert.equal(Feed.safeMediaUrl('http://cdn.example.com/a.mp3'), '');
  assert.equal(Feed.safeMediaUrl('javascript:alert(1)'), '');
  assert.equal(Feed.safeMediaUrl('https://user:pass@cdn.example.com/a.mp3'), '');
  assert.equal(Feed.safeMediaUrl('https://127.0.0.1/a.mp3'), '');
  assert.equal(Feed.safeMediaUrl('https://localhost/a.mp3'), '');
  assert.equal(Feed.safeMediaUrl('https://[::1]/a.mp3'), '');
  assert.equal(Feed.safeMediaUrl('https://x.local/a.mp3'), '');
  assert.equal(Feed.safeMediaUrl('https://cdn.example.com/a.mp3#t=1'), 'https://cdn.example.com/a.mp3');
  assert.equal(Feed.safeMediaUrl(''), '');
});

test('initials, truncate and XML escaping', () => {
  assert.equal(Feed.initialsOf('Night Frequencies'), 'NF');
  assert.equal(Feed.initialsOf('Solo'), 'SO');
  assert.equal(Feed.initialsOf(''), '?');
  assert.equal(Feed.truncate('abcdef', 4), 'abc…');
  assert.equal(Feed.truncate('abc', 4), 'abc');
  assert.equal(Feed.escapeXml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
});

/* ---- OPML ---- */
test('OPML export/import round trip, escaping and 200 cap', () => {
  const shows = [
    { title: 'A & B', feedUrl: 'https://a.example.com/f.xml' },
    { title: 'No feed', feedUrl: '' },
    { title: 'C', feedUrl: 'https://c.example.com/f.xml' }
  ];
  const opml = Feed.buildOpml(shows, '2026-11-17T00:00:00Z');
  assert.ok(opml.indexOf('<opml version="2.0">') >= 0);
  assert.ok(opml.indexOf('xmlUrl="https://a.example.com/f.xml"') >= 0);
  assert.ok(opml.indexOf('text="A &amp; B"') >= 0);
  assert.equal(opml.match(/<outline /g).length, 2);
  const back = Feed.extractOpml(miniDom(opml));
  assert.deepEqual(back.map(o => o.xmlUrl), ['https://a.example.com/f.xml', 'https://c.example.com/f.xml']);
  assert.equal(back[0].title, 'A & B');
  let many = '<opml version="2.0"><body>';
  for (let i = 0; i < 250; i++) { many += '<outline text="s' + i + '" xmlUrl="https://f' + i + '.example.com/x"/>'; }
  many += '</body></opml>';
  assert.equal(Feed.extractOpml(miniDom(many)).length, Feed.OPML_CAP);
});

/* ---- RSS extraction ---- */
test('extractFeed parses RSS 2.0 + iTunes, strips HTML, dedupes, sorts, skips no-audio', () => {
  const r = Feed.extractFeed(miniDom(RSS), FEED_URL);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'rss');
  assert.equal(r.show.title, 'Night & Day');
  assert.equal(r.show.publisher, 'Orbital Radio');
  assert.equal(r.show.artUrl, 'https://img.example.com/art.jpg');
  assert.equal(r.show.id, Feed.showIdFor(FEED_URL));
  assert.equal(r.count, 2);
  const e2 = r.episodes[0];
  assert.equal(e2.title, 'Episode Two');
  assert.equal(e2.id, Feed.episodeId(FEED_URL, 'guid-2', 'https://cdn.example.com/e2.mp3'));
  assert.equal(e2.publishedAt, '2026-11-04T10:00:00.000Z');
  assert.equal(e2.durationSec, 3723);
  assert.equal(e2.audioUrl, 'https://cdn.example.com/e2.mp3');
  assert.equal(e2.audioType, 'audio/mpeg');
  assert.equal(e2.description, 'Hello world & more');
  assert.equal(e2.chaptersUrl, 'https://cdn.example.com/e2.json');
  assert.equal(e2.artUrl, 'https://img.example.com/art.jpg');
  const e1 = r.episodes[1];
  assert.equal(e1.durationSec, 600);
  assert.equal(e1.artUrl, 'https://img.example.com/e1.jpg');
  assert.equal(e1.guid, 'guid-1');
});

test('changed guid yields a new id; duplicate guids collapse to one episode', () => {
  const r = Feed.extractFeed(miniDom(RSS), FEED_URL);
  const ids = r.episodes.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  const changed = RSS.replace('<guid>guid-2</guid>', '<guid>guid-2b</guid>');
  const r2 = Feed.extractFeed(miniDom(changed), FEED_URL);
  assert.notEqual(r2.episodes[0].id, r.episodes[0].id);
});

test('episode list is capped at 100 and descriptions at 600 chars', () => {
  let xml = '<rss version="2.0"><channel><title>Big</title>';
  const long = 'x'.repeat(900);
  for (let i = 0; i < 120; i++) {
    xml += '<item><title>E' + i + '</title><guid>g' + i + '</guid><pubDate>Mon, 03 Nov 2026 10:00:00 GMT</pubDate>' +
      '<enclosure url="https://cdn.example.com/' + i + '.mp3" type="audio/mpeg"/><description>' + long + '</description></item>';
  }
  xml += '</channel></rss>';
  const r = Feed.extractFeed(miniDom(xml), FEED_URL);
  assert.equal(r.count, Feed.MAX_EPISODES);
  r.episodes.forEach(e => assert.ok(e.description.length <= Feed.DESC_CAP));
});

test('insecure enclosure URLs are dropped, not rendered', () => {
  const xml = '<rss version="2.0"><channel><title>T</title><item><title>E</title><guid>g</guid>' +
    '<enclosure url="http://cdn.example.com/e.mp3" type="audio/mpeg"/></item></channel></rss>';
  const r = Feed.extractFeed(miniDom(xml), FEED_URL);
  assert.equal(r.count, 0);
});

/* ---- Atom extraction ---- */
test('extractFeed parses basic Atom with enclosure links', () => {
  const r = Feed.extractFeed(miniDom(ATOM), 'https://atom.example.com/feed');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'atom');
  assert.equal(r.show.title, 'Atom Show');
  assert.equal(r.show.publisher, 'Atom Author');
  assert.equal(r.count, 1);
  const e = r.episodes[0];
  assert.equal(e.title, 'First entry');
  assert.equal(e.guid, 'urn:uuid:1');
  assert.equal(e.audioUrl, 'https://cdn.example.com/a1.mp3');
  assert.equal(e.durationSec, 123);
  assert.equal(e.description, 'Summary text');
  assert.equal(e.publishedAt, '2026-11-01T08:00:00.000Z');
});

test('non-feed documents are rejected', () => {
  assert.equal(Feed.extractFeed(miniDom('<html><body>hi</body></html>'), FEED_URL).reason, 'not-feed');
  assert.equal(Feed.extractFeed(miniDom('plain text'), FEED_URL).reason, 'not-feed');
});

/* ---- parseFeed wrapper ---- */
test('parseFeed uses DOMParser when present and reports parsererror', () => {
  assert.equal(Feed.parseFeed(RSS, FEED_URL).reason, 'no-parser');
  global.DOMParser = function () { this.parseFromString = s => miniDom(s); };
  const r = Feed.parseFeed(RSS, FEED_URL);
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  global.DOMParser = function () {
    this.parseFromString = () => ({ getElementsByTagName: t => (t === 'parsererror' ? [{}] : []) });
  };
  assert.equal(Feed.parseFeed('<broken', FEED_URL).reason, 'not-feed');
  delete global.DOMParser;
});

test('errorText is bilingual for every worker code', () => {
  ['invalid-url', 'not-feed', 'too-large', 'unreachable', 'timeout', 'rate-limited', 'network'].forEach(c => {
    const t = Feed.errorText(c);
    assert.ok(t.indexOf('·') > 0, c);
    assert.ok(/[؀-ۿ]/.test(t), c);
  });
  assert.ok(Feed.errorText('unknown-code').length > 0);
});
/* ---- Phase 2B §A: canonical feed URL, media:content fallback, length, ns prefixes ---- */
function domShim() { global.DOMParser = function () { this.parseFromString = s => miniDom(s); }; }
test('Atom rel="self" link becomes resolvedFeedUrl (result + show)', () => {
  domShim();
  const xml = ATOM.replace('<link rel="alternate" href="https://atom.example.com"/>',
    '<link rel="alternate" href="https://atom.example.com"/>\n  <link rel="self" href="https://atom.example.com/canonical.xml"/>');
  const r = Feed.parseFeed(xml, 'https://atom.example.com/feed.xml');
  assert.equal(r.ok, true);
  assert.equal(r.resolvedFeedUrl, 'https://atom.example.com/canonical.xml');
  assert.equal(r.show.resolvedFeedUrl, 'https://atom.example.com/canonical.xml');
});

test('itunes:new-feed-url becomes resolvedFeedUrl; non-https is ignored', () => {
  domShim();
  const xml = RSS.replace('</channel>',
    '  <itunes:new-feed-url>https://new.example.com/moved.xml</itunes:new-feed-url>\n</channel>');
  const r = Feed.parseFeed(xml, FEED_URL);
  assert.equal(r.resolvedFeedUrl, 'https://new.example.com/moved.xml');
  assert.equal(r.show.resolvedFeedUrl, 'https://new.example.com/moved.xml');
  const bad = RSS.replace('</channel>',
    '  <itunes:new-feed-url>http://insecure.example.com/moved.xml</itunes:new-feed-url>\n</channel>');
  const rb = Feed.parseFeed(bad, FEED_URL);
  assert.equal(rb.resolvedFeedUrl, '');
  assert.equal(rb.show.resolvedFeedUrl, undefined);
});

test('feeds without self-identification leave resolvedFeedUrl empty', () => {
  domShim();
  const r = Feed.parseFeed(RSS, FEED_URL);
  assert.equal(r.resolvedFeedUrl, '');
  assert.equal(r.show.resolvedFeedUrl, undefined);
  const a = Feed.parseFeed(ATOM, 'https://atom.example.com/feed.xml');
  assert.equal(a.resolvedFeedUrl, '');
});

test('media:content is used only when no usable enclosure exists', () => {
  domShim();
  const onlyMedia = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>M</title>
<item><title>E1</title><guid>m1</guid>
<media:content url="https://cdn.example.com/m1.mp3" type="audio/mpeg" fileSize="4567"/>
</item></channel></rss>`;
  const r1 = Feed.parseFeed(onlyMedia, FEED_URL);
  assert.equal(r1.ok, true);
  assert.equal(r1.count, 1);
  assert.equal(r1.episodes[0].audioUrl, 'https://cdn.example.com/m1.mp3');
  assert.equal(r1.episodes[0].audioType, 'audio/mpeg');
  assert.equal(r1.episodes[0].audioBytes, 4567);
  const both = onlyMedia.replace('<item><title>E1</title><guid>m1</guid>',
    '<item><title>E1</title><guid>m1</guid>\n<enclosure url="https://cdn.example.com/enc.mp3" type="audio/mpeg" length="99"/>');
  const r2 = Feed.parseFeed(both, FEED_URL);
  assert.equal(r2.episodes[0].audioUrl, 'https://cdn.example.com/enc.mp3');
  assert.equal(r2.episodes[0].audioBytes, 99);
  const unusableEnc = onlyMedia.replace('<item><title>E1</title><guid>m1</guid>',
    '<item><title>E1</title><guid>m1</guid>\n<enclosure url="http://cdn.example.com/insecure.mp3" type="audio/mpeg"/>');
  const r3 = Feed.parseFeed(unusableEnc, FEED_URL);
  assert.equal(r3.episodes[0].audioUrl, 'https://cdn.example.com/m1.mp3');
  const neither = onlyMedia.replace(/<media:content[^>]*\/>/, '');
  const r4 = Feed.parseFeed(neither, FEED_URL);
  assert.equal(r4.count, 0);
});

test('enclosure length is captured as audioBytes (0 when absent/garbage)', () => {
  domShim();
  const r = Feed.parseFeed(RSS, FEED_URL);
  const e2 = r.episodes.find(e => e.guid === 'guid-2');
  const e1 = r.episodes.find(e => e.guid === 'guid-1');
  assert.equal(e2.audioBytes, 123);
  assert.equal(e1.audioBytes, 0);
});

test('namespaced tags match under a different prefix (it:duration, m:content)', () => {
  domShim();
  const xml = `<?xml version="1.0"?>
<rss version="2.0" xmlns:it="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:m="http://search.yahoo.com/mrss/">
<channel><title>Prefixed</title>
<item><title>Alt prefix</title><guid>p1</guid>
<it:duration>12:34</it:duration>
<m:content url="https://cdn.example.com/p1.mp3" type="audio/mpeg" fileSize="777"/>
</item></channel></rss>`;
  const r = Feed.parseFeed(xml, FEED_URL);
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.episodes[0].durationSec, 754);
  assert.equal(r.episodes[0].audioUrl, 'https://cdn.example.com/p1.mp3');
  assert.equal(r.episodes[0].audioBytes, 777);
});

test('duplicates merge only within one identity; distinct guids never merge', () => {
  domShim();
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>D</title>
<item><title>A</title><guid>g</guid><enclosure url="https://cdn.example.com/1.mp3"/></item>
<item><title>A repeat</title><guid>g</guid><enclosure url="https://cdn.example.com/2.mp3"/></item>
<item><title>B</title><guid>h</guid><enclosure url="https://cdn.example.com/1.mp3"/></item>
</channel></rss>`;
  const r = Feed.parseFeed(xml, FEED_URL);
  assert.equal(r.count, 2);
  assert.deepEqual(r.episodes.map(e => e.guid).sort(), ['g', 'h']);
});

test('empty and malformed feeds report cleanly', () => {
  domShim();
  const empty = `<?xml version="1.0"?><rss version="2.0"><channel><title>E</title></channel></rss>`;
  const r = Feed.parseFeed(empty, FEED_URL);
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
  assert.deepEqual(r.episodes, []);
  assert.equal(Feed.parseFeed('<html><body>not a feed</body></html>', FEED_URL).reason, 'not-feed');
  assert.equal(Feed.parseFeed('   ', FEED_URL).reason, 'not-feed');
  assert.equal(Feed.parseFeed(null, FEED_URL).reason, 'not-feed');
});

/* ================= Phase 2B.3: M1 relative references, M2 effective URL,
   M3 prefixed Atom, M4 season/episode numbers ================= */

test('safeMediaUrl resolves relative references only against a base', () => {
  const B = 'https://feeds.example.com/paths/show.xml';
  assert.equal(Feed.safeMediaUrl('audio/e1.mp3', B), 'https://feeds.example.com/paths/audio/e1.mp3');
  assert.equal(Feed.safeMediaUrl('./e1.mp3', B), 'https://feeds.example.com/paths/e1.mp3');
  assert.equal(Feed.safeMediaUrl('../e1.mp3', B), 'https://feeds.example.com/e1.mp3');
  assert.equal(Feed.safeMediaUrl('/e1.mp3', B), 'https://feeds.example.com/e1.mp3');
  assert.equal(Feed.safeMediaUrl('//cdn.example.com/e1.mp3', B), 'https://cdn.example.com/e1.mp3');
  /* absolute values never touch the base */
  assert.equal(Feed.safeMediaUrl('https://cdn.example.com/e1.mp3', B), 'https://cdn.example.com/e1.mp3');
  /* without a base, relative stays unusable — exactly the pre-2B.3 behaviour */
  assert.equal(Feed.safeMediaUrl('audio/e1.mp3'), '');
  assert.equal(Feed.safeMediaUrl('', B), '');
  assert.equal(Feed.safeMediaUrl('audio/e1.mp3', 'not a url'), '');
});

test('relative resolution never weakens the URL rules', () => {
  const B = 'https://feeds.example.com/show.xml';
  /* a non-https base is refused outright — relative never upgrades to https */
  assert.equal(Feed.safeMediaUrl('audio/e1.mp3', 'http://feeds.example.com/show.xml'), '');
  assert.equal(Feed.safeMediaUrl('e1.mp3', '//insecure.example.com/show.xml'), '');
  assert.equal(Feed.safeMediaUrl('javascript:alert(1)', B), '');
  assert.equal(Feed.safeMediaUrl('ftp://cdn.example.com/e.mp3', B), '');
  assert.equal(Feed.safeMediaUrl('u:e1.mp3', B), '');
  assert.equal(Feed.safeMediaUrl('https://127.0.0.1/e.mp3', B), '');
  assert.equal(Feed.safeMediaUrl('e.mp3', 'https://127.0.0.1:8766/feed.xml'), '');
  assert.equal(Feed.safeMediaUrl('e.mp3', 'https://x.local/feed.xml'), '');
  assert.equal(Feed.safeMediaUrl('user:pass@host.example.com/e.mp3', B), '');
  assert.equal(Feed.safeMediaUrl('../../e.mp3', 'https://feeds.example.com/a/b/show.xml'), 'https://feeds.example.com/e.mp3');
});

test('safeFeedUrl takes an optional base and keeps rejecting non-https', () => {
  const B = 'https://feeds.example.com/paths/show.xml';
  assert.equal(Feed.safeFeedUrl('canonical.xml', B), 'https://feeds.example.com/paths/canonical.xml');
  assert.equal(Feed.safeFeedUrl('https://new.example.com/x.xml', B), 'https://new.example.com/x.xml');
  assert.equal(Feed.safeFeedUrl('http://new.example.com/x.xml', B), '');
  assert.equal(Feed.safeFeedUrl('', B), '');
  assert.equal(Feed.safeFeedUrl('relative.xml'), '');
});

test('a redirected base resolves relative enclosures, artwork and chapters', () => {
  domShim();
  const xml = `<?xml version="1.0"?><rss version="2.0"
    xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
    xmlns:podcast="https://podcastindex.org/namespace/1.0">
    <channel><title>Moved</title>
    <itunes:image href="art/cover.jpg"/>
    <item><title>R1</title><guid>r1</guid><pubDate>Mon, 03 Nov 2026 10:00:00 GMT</pubDate>
    <itunes:duration>600</itunes:duration>
    <enclosure url="audio/r1.mp3" type="audio/mpeg"/>
    <itunes:image href="art/r1.jpg"/>
    <podcast:chapters url="chapters/r1.json" type="application/json+chapters"/>
    </item></channel></rss>`;
  const entered = 'https://old.example.com/feed.xml';
  const effective = 'https://cdn.example.com/feeds/new.xml';
  const r = Feed.parseFeed(xml, entered, effective);
  assert.equal(r.ok, true);
  const e = r.episodes[0];
  assert.equal(e.audioUrl, 'https://cdn.example.com/feeds/audio/r1.mp3');
  assert.equal(e.artUrl, 'https://cdn.example.com/feeds/art/r1.jpg');
  assert.equal(e.chaptersUrl, 'https://cdn.example.com/feeds/chapters/r1.json');
  assert.equal(r.show.artUrl, 'https://cdn.example.com/feeds/art/cover.jpg');
  /* identity stays keyed to the URL the user entered, so an existing
     subscription and its saved progress survive the move */
  assert.equal(r.show.id, Feed.showIdFor(entered));
  assert.equal(e.id, Feed.episodeId(entered, 'r1', 'https://cdn.example.com/feeds/audio/r1.mp3'));
  assert.equal(e.audioBytes, 0);
});

test('the effective URL becomes resolvedFeedUrl only when the feed does not self-identify', () => {
  domShim();
  const entered = 'https://old.example.com/feed.xml';
  const effective = 'https://cdn.example.com/new.xml';
  const moved = Feed.parseFeed(RSS, entered, effective);
  assert.equal(moved.resolvedFeedUrl, effective);
  assert.equal(moved.show.resolvedFeedUrl, effective);
  /* self-identification wins over the transport-level final URL */
  const selfId = RSS.replace('</channel>', '<itunes:new-feed-url>https://final.example.com/feed.xml</itunes:new-feed-url></channel>');
  assert.equal(Feed.parseFeed(selfId, entered, effective).resolvedFeedUrl, 'https://final.example.com/feed.xml');
  /* no redirect reported (older Worker) → unchanged behaviour */
  assert.equal(Feed.parseFeed(RSS, entered).resolvedFeedUrl, '');
  /* a base that equals the entered URL is not a move */
  assert.equal(Feed.parseFeed(RSS, FEED_URL, FEED_URL).resolvedFeedUrl, '');
  /* an unsafe reported URL is ignored and the entered URL keeps its role */
  const unsafe = Feed.parseFeed(RSS, entered, 'http://cdn.example.com/new.xml');
  assert.equal(unsafe.resolvedFeedUrl, '');
  assert.equal(unsafe.count, 2);
  assert.equal(unsafe.episodes[0].audioUrl, 'https://cdn.example.com/e2.mp3');
});

test('a new-feed-url may be relative to the effective feed URL', () => {
  domShim();
  const xml = RSS.replace('</channel>', '<itunes:new-feed-url>moved.xml</itunes:new-feed-url></channel>');
  const r = Feed.parseFeed(xml, 'https://old.example.com/feeds/feed.xml', 'https://cdn.example.com/feeds/live.xml');
  assert.equal(r.resolvedFeedUrl, 'https://cdn.example.com/feeds/moved.xml');
});

test('Atom parses under a foreign prefix: a:feed, a:entry, a:link', () => {
  domShim();
  const xml = `<?xml version="1.0"?>
<a:feed xmlns:a="http://www.w3.org/2005/Atom"
        xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
        xmlns:media="http://search.yahoo.com/mrss/">
  <a:title>Prefixed Atom</a:title>
  <a:link rel="alternate" href="https://px.example.com"/>
  <a:link rel="self" href="https://px.example.com/live.atom"/>
  <a:author><a:name>Prefix Author</a:name></a:author>
  <a:entry>
    <a:id>px-1</a:id>
    <a:title>Prefixed entry</a:title>
    <a:published>2026-11-02T08:00:00Z</a:published>
    <a:updated>2026-11-03T08:00:00Z</a:updated>
    <itunes:duration>12:34</itunes:duration>
    <a:link rel="enclosure" href="audio/px1.mp3" type="audio/mpeg"/>
    <media:content url="https://other.example.com/x.mp3" type="audio/mpeg" fileSize="9"/>
    <a:summary>&lt;p&gt;Prefixed summary&lt;/p&gt;</a:summary>
  </a:entry>
  <a:entry><a:id>px-2</a:id><a:title>No enclosure</a:title><a:content>x</a:content></a:entry>
</a:feed>`;
  const r = Feed.parseFeed(xml, 'https://px.example.com/feed', 'https://px.example.com/feeds/live.atom');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'atom');
  assert.equal(r.show.title, 'Prefixed Atom');
  assert.equal(r.show.publisher, 'Prefix Author');
  assert.equal(r.resolvedFeedUrl, 'https://px.example.com/live.atom');
  assert.equal(r.count, 1);
  const e = r.episodes[0];
  assert.equal(e.title, 'Prefixed entry');
  assert.equal(e.guid, 'px-1');
  assert.equal(e.durationSec, 754);
  assert.equal(e.description, 'Prefixed summary');
  assert.equal(e.publishedAt, '2026-11-02T08:00:00.000Z');
  assert.equal(e.audioUrl, 'https://px.example.com/feeds/audio/px1.mp3');
});

test('a foreign prefix never satisfies an Atom element lookup', () => {
  domShim();
  const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
      xmlns:media="http://search.yahoo.com/mrss/">
  <title>NS Atom</title>
  <entry>
    <id>n1</id>
    <itunes:title>Not the entry title</itunes:title>
    <media:content url="https://cdn.example.com/n1.mp3" type="audio/mpeg"/>
    <media:rating>not-summary</media:rating>
  </entry>
</feed>`;
  const r = Feed.parseFeed(xml, 'https://atom.example.com/feed');
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.episodes[0].title, 'Untitled');
  assert.equal(r.episodes[0].description, '');
  assert.equal(r.episodes[0].audioUrl, 'https://cdn.example.com/n1.mp3');
  /* media:content under a foreign prefix is still found by the enclosure fallback */
  assert.equal(r.episodes[0].audioType, 'audio/mpeg');
});

test('Atom elements in the default namespace match by localName when prefixed lookups are needed', () => {
  /* Real XML parsers expose namespaceURI/localName; a node whose tagName is
     prefixed with an Atom-namespace declaration must match by namespace too. */
  const atomNs = 'http://www.w3.org/2005/Atom';
  const node = { nodeType: 1, tagName: 'a:entry', namespaceURI: atomNs, localName: 'entry', childNodes: [], getAttribute: () => null };
  assert.equal(Feed.isAtomTag(node, 'entry'), true);
  assert.equal(Feed.isAtomTag(node, 'link'), false);
  assert.equal(Feed.isAtomTag({ nodeType: 1, tagName: 'itunes:image', namespaceURI: 'http://www.itunes.com/dtds/podcast-1.0.dtd', localName: 'image' }, 'image'), false);
  assert.equal(Feed.isAtomTag({ nodeType: 1, tagName: 'b:entry', localName: 'entry' }, 'entry'), true);
  assert.equal(Feed.isAtomTag({ nodeType: 1, tagName: 'entry' }, 'entry'), true);
  assert.equal(Feed.isAtomTag({ nodeType: 3, textContent: 'entry' }, 'entry'), false);
  assert.equal(Feed.isAtomTag(null, 'entry'), false);
});

test('itunes:season and itunes:episode are parsed as plain integers', () => {
  domShim();
  const xml = `<?xml version="1.0"?><rss version="2.0"
    xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Series</title>
    <item><title>With numbers</title><guid>s1</guid>
      <itunes:season>3</itunes:season><itunes:episode>12</itunes:episode>
      <enclosure url="https://cdn.example.com/s1.mp3" type="audio/mpeg"/></item>
    <item><title>Padded and zero</title><guid>s2</guid>
      <itunes:season>02</itunes:season><itunes:episode>0</itunes:episode>
      <enclosure url="https://cdn.example.com/s2.mp3" type="audio/mpeg"/></item>
    <item><title>Garbage numbers</title><guid>s3</guid>
      <itunes:season>S03</itunes:season><itunes:episode>1 of 12</itunes:episode>
      <enclosure url="https://cdn.example.com/s3.mp3" type="audio/mpeg"/></item>
    <item><title>Negative and float</title><guid>s4</guid>
      <itunes:season>-1</itunes:season><itunes:episode>2.5</itunes:episode>
      <enclosure url="https://cdn.example.com/s4.mp3" type="audio/mpeg"/></item>
    <item><title>No numbers</title><guid>s5</guid>
      <enclosure url="https://cdn.example.com/s5.mp3" type="audio/mpeg"/></item>
    </channel></rss>`;
  const r = Feed.parseFeed(xml, FEED_URL);
  assert.equal(r.count, 5);
  const by = {};
  r.episodes.forEach(e => { by[e.guid] = e; });
  assert.equal(by.s1.seasonNum, 3);
  assert.equal(by.s1.episodeNum, 12);
  assert.equal(by.s2.seasonNum, 2);
  assert.equal(by.s2.episodeNum, 0);
  assert.equal(by.s3.seasonNum, 0);
  assert.equal(by.s3.episodeNum, 0);
  assert.equal(by.s4.seasonNum, 0);
  assert.equal(by.s4.episodeNum, 0);
  assert.equal(by.s5.seasonNum, 0);
  assert.equal(by.s5.episodeNum, 0);
  /* the pre-2B.3 fixtures gain nothing invented */
  const plain = Feed.parseFeed(RSS, FEED_URL);
  assert.equal(plain.episodes[0].seasonNum, 0);
  assert.equal(plain.episodes[0].episodeNum, 0);
});

test('parsePositiveInt accepts digit strings only', () => {
  assert.equal(Feed.parsePositiveInt('7'), 7);
  assert.equal(Feed.parsePositiveInt(' 07 '), 7);
  assert.equal(Feed.parsePositiveInt('0'), 0);
  assert.equal(Feed.parsePositiveInt(''), 0);
  assert.equal(Feed.parsePositiveInt(null), 0);
  assert.equal(Feed.parsePositiveInt('-3'), 0);
  assert.equal(Feed.parsePositiveInt('3.0'), 0);
  assert.equal(Feed.parsePositiveInt('1e3'), 0);
  assert.equal(Feed.parsePositiveInt('12345678901'), 0);
  assert.equal(Feed.parsePositiveInt('٣'), 0);
});

test('episode fields gained in 2B.3 are present on every parsed episode', () => {
  domShim();
  const r = Feed.parseFeed(RSS, FEED_URL);
  r.episodes.forEach(e => {
    assert.ok(Object.prototype.hasOwnProperty.call(e, 'seasonNum'), e.id);
    assert.ok(Object.prototype.hasOwnProperty.call(e, 'episodeNum'), e.id);
  });
});
