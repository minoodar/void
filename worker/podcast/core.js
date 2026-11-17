// Void Podcast — RSS proxy Worker (Stage 3A). Standalone service `void-podcast`.
// No D1, no R2, no KV, no secrets, no cookies, no analytics. The Worker only
// ever sees "fetch this feed URL"; audio is never proxied (episodes stream
// directly from the publisher to the listener).
//
// Privacy: full feed URLs are never logged. Only short error codes appear in
// logs, and only for unexpected internal failures.
//
// Testable core: every side effect (fetch, Cache API, SHA-256, clock, rate
// buckets) is injected through `deps`, so Node tests run with mocks and no
// network. The default export wires the real Workers runtime globals.

const PROD_ORIGINS = ['https://minoodar.github.io', 'https://void.runs-at.dev'];
const LOCAL_ORIGINS = ['http://127.0.0.1:8765', 'http://localhost:8765'];
const MAX_URL_LEN = 2048;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8000;
const MAX_BYTES = 5 * 1024 * 1024;
const HTML_MAX_BYTES = 1024 * 1024;
const CACHE_TTL_MS = 20 * 60 * 1000;
const STALE_MAX_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;
const USER_AGENT = 'VoidPodcast/1.0 (+https://minoodar.github.io/void/)';
const FEED_TYPES = [
  'application/rss+xml', 'application/atom+xml', 'application/xml',
  'text/xml', 'text/plain'
];
const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.1';

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const SPECIAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.example', '.invalid', '.test'];

/* https only, port 443 only, no credentials, no IP literals (any family, any
   encoding — the URL parser normalizes decimal/octal/hex forms to dotted
   IPv4), no localhost or private/special-use names, max length. */
function validateFeedUrl(raw) {
  if (typeof raw !== 'string' || !raw) { return { ok: false, reason: 'missing' }; }
  if (raw.length > MAX_URL_LEN) { return { ok: false, reason: 'too-long' }; }
  let u;
  try { u = new URL(raw); } catch (e) { return { ok: false, reason: 'malformed' }; }
  if (u.protocol !== 'https:') { return { ok: false, reason: 'not-https' }; }
  if (u.port !== '' && u.port !== '443') { return { ok: false, reason: 'bad-port' }; }
  if (u.username || u.password) { return { ok: false, reason: 'credentials' }; }
  let h = u.hostname.toLowerCase();
  if (h.endsWith('.')) { h = h.slice(0, -1); }
  if (!h || h === 'localhost' || h.indexOf('.') < 0) { return { ok: false, reason: 'private-host' }; }
  if (h.startsWith('[') || IPV4_RE.test(h)) { return { ok: false, reason: 'ip-literal' }; }
  for (let i = 0; i < SPECIAL_SUFFIXES.length; i++) {
    if (h.endsWith(SPECIAL_SUFFIXES[i])) { return { ok: false, reason: 'private-host' }; }
  }
  u.hash = '';
  u.hostname = h;
  return { ok: true, url: u.toString(), normalized: u.toString() };
}

function isLocalRequest(requestUrl) {
  try {
    const h = new URL(requestUrl).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch (e) { return false; }
}

/* Exact-origin allowlist, never `*`. Local dev origins are honored only while
   the Worker itself is being served from localhost (wrangler dev --local). */
function corsFor(origin, requestUrl) {
  if (!origin) { return null; }
  let allowed = PROD_ORIGINS;
  if (isLocalRequest(requestUrl)) { allowed = allowed.concat(LOCAL_ORIGINS); }
  if (allowed.indexOf(origin) < 0) { return null; }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

/* Free, best-effort per-IP sliding window kept in isolate memory. No KV, no
   D1, no paid feature. Resets when the isolate recycles; CF may spread a
   client across isolates, so this is a speed bump, not a hard quota. */
function checkRate(buckets, ip, now) {
  let b = buckets.get(ip);
  if (!b || now - b.start >= RATE_WINDOW_MS) { b = { start: now, count: 0 }; }
  b.count += 1;
  buckets.set(ip, b);
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) { if (now - v.start >= RATE_WINDOW_MS) { buckets.delete(k); } }
  }
  if (b.count > RATE_LIMIT) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - b.start)) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}

async function sha256Hex(subtle, text) {
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) { out += bytes[i].toString(16).padStart(2, '0'); }
  return out;
}

function fail(code, status) { const e = new Error(code); e.code = code; e.status = status; return e; }

/* Stream with a hard byte cap; cancel the upstream body the moment it is
   exceeded so a huge feed never buffers fully into memory. */
async function readCapped(response, cap) {
  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > cap) { throw fail('too-large', 413); }
    return buf;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) { break; }
    total += r.value.byteLength;
    if (total > cap) { try { await reader.cancel(); } catch (e) { /* already closed */ } throw fail('too-large', 413); }
    chunks.push(r.value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (let i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].byteLength; }
  return out;
}

/* redirect:'manual', at most MAX_REDIRECTS hops, EVERY hop re-validated with
   the same URL rules. Only our fixed headers travel upstream — never the
   caller's headers, never cookies. */
async function fetchChain(startUrl, deps, signal, conditional) {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const v = validateFeedUrl(current);
    if (!v.ok) { throw fail('invalid-url', 400); }
    const headers = { 'User-Agent': USER_AGENT, 'Accept': ACCEPT };
    if (hop === 0 && conditional) {
      if (conditional.etag) { headers['If-None-Match'] = conditional.etag; }
      if (conditional.lastModified) { headers['If-Modified-Since'] = conditional.lastModified; }
    }
    const res = await deps.fetch(v.url, { method: 'GET', redirect: 'manual', signal, headers });
    if ([301, 302, 303, 307, 308].indexOf(res.status) >= 0) {
      const loc = res.headers.get('location');
      try { if (res.body) { await res.body.cancel(); } } catch (e) { /* noop */ }
      if (!loc) { throw fail('unreachable', 502); }
      let next;
      try { next = new URL(loc, v.url).toString(); } catch (e) { throw fail('unreachable', 502); }
      current = next;
      continue;
    }
    return { res, finalUrl: v.url };
  }
  throw fail('unreachable', 502);
}

function pickAutodiscoveryLink(html, baseUrl) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (!/rel\s*=\s*["']?alternate["']?/i.test(t)) { continue; }
    if (!/type\s*=\s*["']?(application\/(rss|atom)\+xml)["']?/i.test(t)) { continue; }
    const m = t.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = m && (m[2] || m[3] || m[4]);
    if (!href) { continue; }
    try { return new URL(href, baseUrl).toString(); } catch (e) { /* keep scanning */ }
  }
  return null;
}

function json(body, status, cors, extra) {
  const headers = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors || {}, extra || {});
  return new Response(JSON.stringify(body), { status, headers });
}

function withCors(response, cors, extra) {
  if (!cors && !extra) { return response; }
  const headers = new Headers(response.headers);
  Object.keys(cors || {}).forEach(k => headers.set(k, cors[k]));
  Object.keys(extra || {}).forEach(k => headers.set(k, extra[k]));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleFeed(request, deps) {
  const now = deps.now();
  let reqUrl;
  try { reqUrl = new URL(request.url); } catch (e) { return json({ ok: false, error: 'bad-request' }, 400); }
  const origin = request.headers.get('Origin');
  const cors = corsFor(origin, request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: Object.assign({ 'Allow': 'GET, OPTIONS' }, cors || {}) });
  }
  if (reqUrl.pathname !== '/feed') { return json({ ok: false, error: 'not-found' }, 404, cors); }
  if (request.method !== 'GET') { return json({ ok: false, error: 'method-not-allowed' }, 405, cors, { 'Allow': 'GET, OPTIONS' }); }

  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const rate = checkRate(deps.rateBuckets, ip, now);
  if (!rate.ok) { return json({ ok: false, error: 'rate-limited' }, 429, cors, { 'Retry-After': String(rate.retryAfter) }); }

  const v = validateFeedUrl(reqUrl.searchParams.get('url'));
  if (!v.ok) { return json({ ok: false, error: 'invalid-url', reason: v.reason }, 400, cors); }

  const keyUrl = 'https://void-podcast.cache/feed/' + await sha256Hex(deps.subtle, v.normalized);
  const keyReq = new Request(keyUrl, { method: 'GET' });
  let cached = null;
  try { cached = await deps.cache.match(keyReq); } catch (e) { cached = null; }
  const cachedAt = cached ? parseInt(cached.headers.get('x-void-cached-at') || '0', 10) : 0;
  const age = cached ? now - cachedAt : Infinity;

  if (cached && age >= 0 && age < CACHE_TTL_MS) {
    return withCors(cached, cors, { 'x-void-cache': 'hit' });
  }

  const conditional = cached ? {
    etag: cached.headers.get('x-void-etag') || '',
    lastModified: cached.headers.get('x-void-last-modified') || ''
  } : null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs || TIMEOUT_MS);
  try {
    let out = await fetchChain(v.url, deps, controller.signal, conditional);
    let res = out.res;

    if (res.status === 304 && cached) {
      const headers = new Headers(cached.headers);
      headers.set('x-void-cached-at', String(now));
      const refreshed = new Response(cached.body, { status: 200, headers });
      deps.waitUntil(deps.cache.put(keyReq, refreshed.clone()).catch(() => {}));
      return withCors(refreshed, cors, { 'x-void-cache': 'revalidated' });
    }
    if (res.status < 200 || res.status >= 300) { throw fail('unreachable', 502); }

    const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    let bytes;
    if (FEED_TYPES.indexOf(ct) >= 0) {
      bytes = await readCapped(res, MAX_BYTES);
    } else if (ct === 'text/html') {
      const htmlBytes = await readCapped(res, HTML_MAX_BYTES);
      const link = pickAutodiscoveryLink(new TextDecoder().decode(htmlBytes), out.finalUrl);
      if (!link) { throw fail('not-feed', 415); }
      const lv = validateFeedUrl(link);
      if (!lv.ok) { throw fail('not-feed', 415); }
      out = await fetchChain(lv.url, deps, controller.signal, null);
      res = out.res;
      if (res.status < 200 || res.status >= 300) { throw fail('unreachable', 502); }
      const fct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (FEED_TYPES.indexOf(fct) < 0) { throw fail('not-feed', 415); }
      bytes = await readCapped(res, MAX_BYTES);
    } else {
      try { if (res.body) { await res.body.cancel(); } } catch (e) { /* noop */ }
      throw fail('not-feed', 415);
    }

    const headers = {
      'Content-Type': ct === 'text/html' ? (res.headers.get('content-type') || 'application/xml') : (res.headers.get('content-type') || ct),
      'Cache-Control': 'public, max-age=' + Math.floor(CACHE_TTL_MS / 1000),
      'x-void-cached-at': String(now)
    };
    const etag = res.headers.get('etag');
    const lm = res.headers.get('last-modified');
    if (etag) { headers['x-void-etag'] = etag; }
    if (lm) { headers['x-void-last-modified'] = lm; }
    const fresh = new Response(bytes, { status: 200, headers });
    deps.waitUntil(deps.cache.put(keyReq, fresh.clone()).catch(() => {}));
    return withCors(fresh, cors, { 'x-void-cache': 'miss' });
  } catch (err) {
    if (cached && age >= 0 && age < STALE_MAX_MS) {
      return withCors(cached, cors, { 'x-void-cache': 'stale', 'Warning': '110 void-podcast "Response is stale"' });
    }
    let code = err && typeof err.code === 'string' ? err.code : null;
    if (!code) { code = controller.signal.aborted ? 'timeout' : 'unreachable'; }
    const status = err && err.status ? err.status : (code === 'timeout' ? 504 : 502);
    return json({ ok: false, error: code }, status, cors);
  } finally {
    clearTimeout(timer);
  }
}

export {
  PROD_ORIGINS, LOCAL_ORIGINS, MAX_URL_LEN, MAX_REDIRECTS, TIMEOUT_MS, MAX_BYTES,
  HTML_MAX_BYTES, CACHE_TTL_MS, STALE_MAX_MS, RATE_LIMIT, RATE_WINDOW_MS, USER_AGENT,
  FEED_TYPES, validateFeedUrl, isLocalRequest, corsFor, checkRate, sha256Hex,
  readCapped, fetchChain, pickAutodiscoveryLink, handleFeed
};