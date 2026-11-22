// Node tests for the void-podcast Worker — mocked fetch/Cache/subtle, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFeedUrl, corsFor, isLocalRequest, checkRate, sha256Hex,
  pickAutodiscoveryLink, handleFeed, RATE_LIMIT, RATE_WINDOW_MS,
  CACHE_TTL_MS, STALE_MAX_MS, MAX_BYTES, USER_AGENT, PROD_ORIGINS
} from '../core.js';

const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>' +
  '<item><title>E</title><enclosure url="https://cdn.example.com/e.mp3" type="audio/mpeg"/></item></channel></rss>';
const PROD = 'https://void-podcast.minoodar.workers.dev';
const LOCAL = 'http://127.0.0.1:8788';

function feedReq(url, opts) {
  opts = opts || {};
  const headers = {};
  if (opts.origin) { headers.Origin = opts.origin; }
  if (opts.ip) { headers['CF-Connecting-IP'] = opts.ip; }
  if (opts.cookie) { headers.Cookie = opts.cookie; }
  if (opts.extra) { Object.assign(headers, opts.extra); }
  const base = opts.base || PROD;
  const q = url === undefined ? '' : '?url=' + encodeURIComponent(url);
  return new Request(base + '/feed' + q, { method: opts.method || 'GET', headers });
}

function mockCache() {
  const store = new Map();
  return {
    store,
    async match(req) {
      const e = store.get(req.url);
      if (!e) { return undefined; }
      return new Response(e.bytes.slice(0), { status: e.status, headers: e.headers });
    },
    async put(req, res) {
      const bytes = new Uint8Array(await res.clone().arrayBuffer());
      const headers = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      store.set(req.url, { status: res.status, headers, bytes });
    }
  };
}

function makeDeps(over) {
  const pending = [];
  const deps = Object.assign({
    fetch: async () => new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml' } }),
    cache: mockCache(),
    subtle: globalThis.crypto.subtle,
    now: () => 1000000,
    timeoutMs: 8000,
    rateBuckets: new Map(),
    waitUntil: p => { pending.push(p); }
  }, over || {});
  deps.settle = () => Promise.all(pending);
  return deps;
}

function streamOf(chunkBytes, n) {
  return new ReadableStream({
    start(c) { for (let i = 0; i < n; i++) { c.enqueue(new Uint8Array(chunkBytes)); } c.close(); }
  });
}

/* ---- URL validation ---- */

test('accepts a plain https feed URL and normalizes it', () => {
  const v = validateFeedUrl('https://Example.COM/feed.xml#frag');
  assert.equal(v.ok, true);
  assert.equal(v.normalized, 'https://example.com/feed.xml');
  assert.equal(validateFeedUrl('https://example.com:443/feed').ok, true);
});

test('rejects http, other schemes, bad ports and credentials', () => {
  assert.equal(validateFeedUrl('http://example.com/feed').reason, 'not-https');
  assert.equal(validateFeedUrl('ftp://example.com/feed').reason, 'not-https');
  assert.equal(validateFeedUrl('https://example.com:8443/feed').reason, 'bad-port');
  assert.equal(validateFeedUrl('https://user:pass@example.com/feed').reason, 'credentials');
  assert.equal(validateFeedUrl('not a url').reason, 'malformed');
  assert.equal(validateFeedUrl('').reason, 'missing');
  assert.equal(validateFeedUrl('https://example.com/' + 'a'.repeat(2100)).reason, 'too-long');
});

test('rejects localhost, private names and every IP literal form', () => {
  const bad = [
    'https://localhost/feed', 'https://foo.localhost/feed', 'https://printer.local/feed',
    'https://db.internal/feed', 'https://x.home.arpa/feed', 'https://y.example/feed',
    'https://z.invalid/feed', 'https://w.test/feed', 'https://intranet/feed',
    'https://127.0.0.1/feed', 'https://10.0.0.1/feed', 'https://192.168.1.1/feed',
    'https://169.254.169.254/latest/meta-data/', 'https://[::1]/feed', 'https://[2001:db8::1]/feed',
    'https://2130706433/feed', 'https://0x7f000001/feed', 'https://0177.0.0.1/feed',
    'https://8.8.8.8/feed'
  ];
  bad.forEach(u => {
    const v = validateFeedUrl(u);
    assert.equal(v.ok, false, u);
    assert.ok(['private-host', 'ip-literal'].indexOf(v.reason) >= 0, u + ' -> ' + v.reason);
  });
});

/* ---- CORS ---- */

test('CORS is exact-origin, never wildcard, local only when served locally', () => {
  PROD_ORIGINS.forEach(o => {
    const h = corsFor(o, PROD + '/feed');
    assert.equal(h['Access-Control-Allow-Origin'], o);
  });
  assert.equal(corsFor('https://evil.example.com', PROD + '/feed'), null);
  assert.equal(corsFor('https://minoodar.github.io.evil.com', PROD + '/feed'), null);
  assert.equal(corsFor('http://127.0.0.1:8765', PROD + '/feed'), null);
  assert.equal(corsFor('http://127.0.0.1:8765', LOCAL + '/feed')['Access-Control-Allow-Origin'], 'http://127.0.0.1:8765');
  assert.equal(corsFor('http://localhost:8765', LOCAL + '/feed')['Access-Control-Allow-Origin'], 'http://localhost:8765');
  assert.equal(corsFor('http://127.0.0.1:9999', LOCAL + '/feed'), null);
  assert.equal(isLocalRequest(PROD + '/feed'), false);
  assert.equal(isLocalRequest(LOCAL + '/feed'), true);
});

/* ---- Phase 2B.3 (M2): the effective feed URL is reported to the client ---- */

const REDIRECT_FETCH = async (u) => {
  if (u === 'https://a.example.com/feed') { return new Response(null, { status: 302, headers: { location: 'https://b.example.com/feed' } }); }
  if (u === 'https://b.example.com/feed') { return new Response(null, { status: 301, headers: { location: '/final.xml' } }); }
  return new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
};

test('a redirected feed reports the final URL in x-void-final-url', async () => {
  const deps = makeDeps({ fetch: REDIRECT_FETCH });
  const res = await handleFeed(feedReq('https://a.example.com/feed'), deps);
  await deps.settle();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-void-final-url'), 'https://b.example.com/final.xml');
});

test('without redirects the header carries the normalized URL actually fetched', async () => {
  const deps = makeDeps();
  const res = await handleFeed(feedReq('https://Example.COM/Feed.xml#frag'), deps);
  await deps.settle();
  assert.equal(res.headers.get('x-void-final-url'), 'https://example.com/Feed.xml');
});

test('the final URL survives cache hits, revalidation and stale replies', async () => {
  let t = 1000000;
  let fail = false;
  const deps = makeDeps({
    now: () => t,
    fetch: async (u, init) => {
      if (fail) { throw new TypeError('network down'); }
      if (init.headers['If-None-Match']) { return new Response(null, { status: 304 }); }
      if (u === 'https://a.example.com/feed') { return new Response(null, { status: 302, headers: { location: 'https://b.example.com/final.xml' } }); }
      return new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml', etag: '"v1"' } });
    }
  });
  await handleFeed(feedReq('https://a.example.com/feed'), deps);
  await deps.settle();
  const hit = await handleFeed(feedReq('https://a.example.com/feed'), deps);
  assert.equal(hit.headers.get('x-void-cache'), 'hit');
  assert.equal(hit.headers.get('x-void-final-url'), 'https://b.example.com/final.xml');
  t += CACHE_TTL_MS + 1;
  const reval = await handleFeed(feedReq('https://a.example.com/feed'), deps);
  await deps.settle();
  assert.equal(reval.headers.get('x-void-cache'), 'revalidated');
  assert.equal(reval.headers.get('x-void-final-url'), 'https://b.example.com/final.xml');
  fail = true;
  t += CACHE_TTL_MS + 1;
  const stale = await handleFeed(feedReq('https://a.example.com/feed'), deps);
  assert.equal(stale.headers.get('x-void-cache'), 'stale');
  assert.equal(stale.headers.get('x-void-final-url'), 'https://b.example.com/final.xml');
});

test('autodiscovery reports the feed it resolved, not the HTML page', async () => {
  const deps = makeDeps({
    fetch: async (u) => {
      if (u === 'https://show.example.com/') {
        return new Response('<html><head><link rel="alternate" type="application/rss+xml" href="https://feeds.example.com/rss"></head></html>',
          { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    }
  });
  const res = await handleFeed(feedReq('https://show.example.com/'), deps);
  await deps.settle();
  assert.equal(res.headers.get('x-void-final-url'), 'https://feeds.example.com/rss');
});

test('every x-void-* header the client reads is CORS-exposed', () => {
  const exposed = corsFor('https://minoodar.github.io', PROD + '/feed')['Access-Control-Expose-Headers']
    .split(',').map(s => s.trim());
  ['x-void-cache', 'x-void-cached-at', 'x-void-etag', 'x-void-last-modified', 'x-void-final-url']
    .forEach(n => assert.ok(exposed.indexOf(n) >= 0, n));
  assert.equal(corsFor('https://evil.example', PROD + '/feed'), null);
});


/* ---- rate limiting ---- */

test('sliding window allows RATE_LIMIT then blocks with Retry-After', () => {
  const b = new Map();
  for (let i = 0; i < RATE_LIMIT; i++) { assert.equal(checkRate(b, '1.2.3.4', 1000 + i).ok, true); }
  const blocked = checkRate(b, '1.2.3.4', 2000);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60);
  assert.equal(checkRate(b, '1.2.3.4', 1000 + RATE_WINDOW_MS).ok, true);
  assert.equal(checkRate(b, '5.6.7.8', 2000).ok, true);
});

/* ---- happy path + cache ---- */

test('GET /feed returns the XML with exact CORS and caches it', async () => {
  const deps = makeDeps();
  const res = await handleFeed(feedReq('https://example.com/feed.xml', { origin: 'https://minoodar.github.io', ip: '9.9.9.9' }), deps);
  await deps.settle();
  assert.equal(res.status, 200);
  assert.equal(await res.text(), RSS);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://minoodar.github.io');
  assert.equal(res.headers.get('x-void-cache'), 'miss');
  assert.equal(deps.cache.store.size, 1);
  const key = [...deps.cache.store.keys()][0];
  assert.ok(key.startsWith('https://void-podcast.cache/feed/'));
  assert.equal(key.length, 'https://void-podcast.cache/feed/'.length + 64);
});

test('second request within TTL is a cache hit (no upstream fetch)', async () => {
  let calls = 0;
  const deps = makeDeps({ fetch: async () => { calls++; return new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml', etag: '"v1"', 'last-modified': 'Mon, 01 Nov 2026 00:00:00 GMT' } }); } });
  await handleFeed(feedReq('https://example.com/feed.xml'), deps);
  await deps.settle();
  const res2 = await handleFeed(feedReq('https://example.com/feed.xml'), deps);
  assert.equal(res2.headers.get('x-void-cache'), 'hit');
  assert.equal(await res2.text(), RSS);
  assert.equal(calls, 1);
});

test('expired entry revalidates conditionally; 304 refreshes the cache', async () => {
  let t = 1000000;
  let sent = null;
  const deps = makeDeps({
    now: () => t,
    fetch: async (u, init) => {
      sent = init.headers;
      if (sent['If-None-Match']) { return new Response(null, { status: 304 }); }
      return new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml', etag: '"v1"', 'last-modified': 'Mon, 01 Nov 2026 00:00:00 GMT' } });
    }
  });
  await handleFeed(feedReq('https://example.com/feed.xml'), deps);
  await deps.settle();
  t += CACHE_TTL_MS + 1;
  const res = await handleFeed(feedReq('https://example.com/feed.xml'), deps);
  await deps.settle();
  assert.equal(sent['If-None-Match'], '"v1"');
  assert.equal(sent['If-Modified-Since'], 'Mon, 01 Nov 2026 00:00:00 GMT');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-void-cache'), 'revalidated');
  assert.equal(await res.text(), RSS);
});

test('stale-if-error serves the old body, then gives up after 24h', async () => {
  let t = 1000000;
  let fail = false;
  const deps = makeDeps({
    now: () => t,
    fetch: async () => {
      if (fail) { throw new TypeError('network down'); }
      return new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    }
  });
  await handleFeed(feedReq('https://example.com/feed.xml'), deps);
  await deps.settle();
  fail = true;
  t += CACHE_TTL_MS + 1;
  const stale = await handleFeed(feedReq('https://example.com/feed.xml'), deps);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get('x-void-cache'), 'stale');
  assert.equal(await stale.text(), RSS);
  t += STALE_MAX_MS + 1;
  const dead = await handleFeed(feedReq('https://example.com/feed.xml'), deps);
  assert.equal(dead.status, 502);
  assert.equal((await dead.json()).error, 'unreachable');
});

/* ---- redirects ---- */

test('follows up to 3 manual redirects, re-validating each hop', async () => {
  const seen = [];
  const deps = makeDeps({
    fetch: async (u, init) => {
      seen.push({ u, init });
      if (u === 'https://a.example.com/feed') { return new Response(null, { status: 302, headers: { location: 'https://b.example.com/feed' } }); }
      if (u === 'https://b.example.com/feed') { return new Response(null, { status: 301, headers: { location: '/final.xml' } }); }
      return new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    }
  });
  const res = await handleFeed(feedReq('https://a.example.com/feed'), deps);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), RSS);
  assert.deepEqual(seen.map(s => s.u), ['https://a.example.com/feed', 'https://b.example.com/feed', 'https://b.example.com/final.xml']);
  seen.forEach(s => {
    assert.equal(s.init.redirect, 'manual');
    assert.equal(s.init.headers['User-Agent'], USER_AGENT);
    assert.equal(s.init.headers.Cookie, undefined);
    assert.equal(s.init.headers['X-Secret'], undefined);
  });
});

test('a redirect to http, a private host or a 4th hop is rejected', async () => {
  const chain = locs => makeDeps({
    fetch: async (u) => {
      const i = locs.findIndex(l => u === l.from);
      if (i >= 0) { return new Response(null, { status: 302, headers: { location: locs[i].to } }); }
      return new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    }
  });
  let res = await handleFeed(feedReq('https://a.example.com/feed'), chain([{ from: 'https://a.example.com/feed', to: 'http://b.example.com/feed' }]));
  assert.equal(res.status, 400);
  res = await handleFeed(feedReq('https://a.example.com/feed'), chain([{ from: 'https://a.example.com/feed', to: 'https://127.0.0.1/feed' }]));
  assert.equal(res.status, 400);
  res = await handleFeed(feedReq('https://a.example.com/feed'), chain([
    { from: 'https://a.example.com/feed', to: 'https://b.example.com/feed' },
    { from: 'https://b.example.com/feed', to: 'https://c.example.com/feed' },
    { from: 'https://c.example.com/feed', to: 'https://d.example.com/feed' },
    { from: 'https://d.example.com/feed', to: 'https://e.example.com/feed' }
  ]));
  assert.equal(res.status, 502);
});

test('caller headers and cookies never travel upstream', async () => {
  let sent = null;
  const deps = makeDeps({ fetch: async (u, init) => { sent = init; return new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml' } }); } });
  await handleFeed(feedReq('https://example.com/feed', { cookie: 'session=abc', extra: { 'X-Secret': 'hunter2', Authorization: 'Bearer x' } }), deps);
  assert.equal(sent.headers.Cookie, undefined);
  assert.equal(sent.headers['X-Secret'], undefined);
  assert.equal(sent.headers.Authorization, undefined);
  assert.deepEqual(Object.keys(sent.headers).sort(), ['Accept', 'User-Agent']);
});

/* ---- limits ---- */

test('streaming body over 5 MB is cancelled and rejected with 413', async () => {
  const deps = makeDeps({
    fetch: async () => new Response(streamOf(1024 * 1024, 6), { status: 200, headers: { 'content-type': 'application/rss+xml' } })
  });
  const res = await handleFeed(feedReq('https://example.com/big.xml'), deps);
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, 'too-large');
});

test('a body just under the cap passes', async () => {
  const chunk = new Uint8Array(MAX_BYTES - 10);
  const deps = makeDeps({
    fetch: async () => new Response(streamOf(chunk.byteLength, 1), { status: 200, headers: { 'content-type': 'text/xml' } })
  });
  const res = await handleFeed(feedReq('https://example.com/ok.xml'), deps);
  assert.equal(res.status, 200);
  assert.equal((await res.arrayBuffer()).byteLength, MAX_BYTES - 10);
});

test('the 8s abort produces a 504 timeout', async () => {
  const deps = makeDeps({
    timeoutMs: 25,
    fetch: (u, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })
  });
  const res = await handleFeed(feedReq('https://example.com/slow'), deps);
  assert.equal(res.status, 504);
  assert.equal((await res.json()).error, 'timeout');
});

test('content-type allowlist rejects json; html without a feed link is not-feed', async () => {
  let res = await handleFeed(feedReq('https://example.com/api'), makeDeps({
    fetch: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }));
  assert.equal(res.status, 415);
  res = await handleFeed(feedReq('https://example.com/page'), makeDeps({
    fetch: async () => new Response('<html><head><title>Hi</title></head></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }));
  assert.equal(res.status, 415);
  assert.equal((await res.json()).error, 'not-feed');
});

/* ---- autodiscovery ---- */

test('html with an alternate RSS link fetches that feed under the same rules', async () => {
  const seen = [];
  const html = '<html><head><link rel="alternate" type="application/rss+xml" title="Feed" href="/show/feed.xml"></head></html>';
  const deps = makeDeps({
    fetch: async (u) => {
      seen.push(u);
      if (u === 'https://show.example.com/page') { return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }); }
      return new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    }
  });
  const res = await handleFeed(feedReq('https://show.example.com/page'), deps);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), RSS);
  assert.deepEqual(seen, ['https://show.example.com/page', 'https://show.example.com/show/feed.xml']);
});

test('autodiscovery link to a private host is rejected', async () => {
  const html = '<link rel="alternate" type="application/rss+xml" href="https://10.0.0.1/feed.xml">';
  const deps = makeDeps({ fetch: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }) });
  const res = await handleFeed(feedReq('https://show.example.com/page'), deps);
  assert.equal(res.status, 415);
});

test('pickAutodiscoveryLink handles attribute order, quotes and atom', () => {
  assert.equal(pickAutodiscoveryLink('<link href="https://x.example.com/f" type="application/atom+xml" rel="alternate">', 'https://x.example.com/'), 'https://x.example.com/f');
  assert.equal(pickAutodiscoveryLink('<link rel=alternate type=application/rss+xml href=/f.xml>', 'https://x.example.com/p/'), 'https://x.example.com/f.xml');
  assert.equal(pickAutodiscoveryLink('<link rel="alternate" hrefLang="en" href="https://x.example.com/">', 'https://x.example.com/'), null);
  assert.equal(pickAutodiscoveryLink('<a rel="alternate" type="application/rss+xml" href="/f">', 'https://x.example.com/'), null);
});

/* ---- methods, routing, CORS plumbing, rate limit ---- */

test('OPTIONS preflight, POST 405, unknown path 404, missing url 400', async () => {
  const deps = makeDeps();
  let res = await handleFeed(feedReq('https://example.com/f', { method: 'OPTIONS', origin: 'https://minoodar.github.io' }), deps);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://minoodar.github.io');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
  res = await handleFeed(feedReq('https://example.com/f', { method: 'OPTIONS', origin: 'https://evil.example.com' }), deps);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  res = await handleFeed(feedReq('https://example.com/f', { method: 'POST' }), deps);
  assert.equal(res.status, 405);
  res = await handleFeed(new Request(PROD + '/nope'), deps);
  assert.equal(res.status, 404);
  res = await handleFeed(feedReq(undefined), deps);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid-url');
});

test('no Origin header still serves (non-browser) but without ACAO', async () => {
  const res = await handleFeed(feedReq('https://example.com/feed.xml'), makeDeps());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('disallowed Origin gets the feed bytes but no CORS header', async () => {
  const res = await handleFeed(feedReq('https://example.com/feed.xml', { origin: 'https://evil.example.com' }), makeDeps());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('the 31st request in a minute is rate-limited with Retry-After', async () => {
  const deps = makeDeps();
  let last;
  for (let i = 0; i <= RATE_LIMIT; i++) {
    last = await handleFeed(feedReq('https://example.com/feed.xml', { ip: '7.7.7.7' }), deps);
  }
  assert.equal(last.status, 429);
  assert.equal((await last.json()).error, 'rate-limited');
  assert.ok(parseInt(last.headers.get('Retry-After'), 10) >= 1);
});

test('local dev origin is allowed end-to-end only on a localhost-served worker', async () => {
  const deps = makeDeps();
  let res = await handleFeed(feedReq('https://example.com/feed.xml', { base: LOCAL, origin: 'http://127.0.0.1:8765' }), deps);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:8765');
  res = await handleFeed(feedReq('https://example.com/feed.xml', { base: PROD, origin: 'http://127.0.0.1:8765' }), deps);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('sha256Hex is stable and 64 hex chars', async () => {
  const h = await sha256Hex(globalThis.crypto.subtle, 'https://example.com/feed');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await sha256Hex(globalThis.crypto.subtle, 'https://example.com/feed'));
});