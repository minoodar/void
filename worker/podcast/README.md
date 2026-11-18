# void-podcast — RSS proxy Worker (Podcast Stage 3A)

A new, separate Cloudflare Worker. It does one thing: `GET /feed?url=<https feed URL>`
returns the feed XML (or a small JSON error). The browser parses the feed; audio is
**never** proxied — episodes stream directly from the publisher to the listener.

No D1, no R2, no KV, no secrets, no cookies, no analytics. Subscriptions, favorites
and progress live in the visitor's localStorage; the Worker only sees "fetch this
feed URL". Full feed URLs are never logged.

## Endpoint

| Route | Behaviour |
|---|---|
| `GET /feed?url=…` | Validated fetch of the feed, cached ~20 min, CORS for the site origins |
| `OPTIONS /feed` | Preflight: `GET, OPTIONS`, exact-origin allowlist, never `*` |
| anything else | JSON `404` / `405` |

Errors are JSON `{ ok:false, error:<code> }` with codes: `invalid-url` (400, plus a
`reason`), `not-feed` (415), `too-large` (413), `unreachable` (502), `timeout` (504),
`rate-limited` (429 + `Retry-After`), `method-not-allowed` (405), `not-found` (404).

## Security rules (all enforced in `core.js`, unit-tested with mocked fetch)

- **URL validation:** https only; port 443 only; no credentials in the URL; max 2048
  chars; rejects localhost, single-label hosts, `.local` / `.internal` / `.localhost` /
  `.home.arpa` / `.example` / `.invalid` / `.test`, and **all IP literals** (IPv4 and
  IPv6, including decimal/octal/hex forms — the URL parser normalizes them first).
- **Redirects:** `redirect:'manual'`, at most 3 hops, **every hop re-validated** with
  the same rules. Only a fixed `User-Agent` (`VoidPodcast/1.0`) and `Accept` travel
  upstream; the caller's headers and cookies are never forwarded.
- **Limits:** one 8 s `AbortController` for the whole chain; 5 MB response cap
  enforced **while streaming** (the upstream body is cancelled on overflow);
  content-type allowlist `application/rss+xml, application/atom+xml, application/xml,
  text/xml, text/plain` — everything else is rejected.
- **Autodiscovery:** if the URL returns `text/html` (≤ 1 MB), the Worker looks for
  `<link rel="alternate" type="application/rss+xml|atom+xml" href="…">` and fetches
  that feed under the same rules. Verified 2026-11-17: rss.com show pages expose
  exactly this link (e.g. `https://media.rss.com/syntax/feed.xml`).
- **Cache:** Cache API keyed by `SHA-256(normalized URL)` (fragment stripped, host
  lowercased). TTL 20 min; conditional upstream requests via stored
  `ETag` / `Last-Modified`; `stale-if-error` up to 24 h. Cached responses carry
  `x-void-cache: hit|miss|revalidated|stale`.
- **CORS:** exact origins `https://minoodar.github.io` and `https://void.runs-at.dev`
  (the production origins already used by `void-galaxy-letters`). The local dev
  origins `http://127.0.0.1:8765` and `http://localhost:8765` are honored **only**
  when the Worker itself is served from localhost (`wrangler dev --local`). Never `*`.
- **Rate limiting (free, best-effort):** per-isolate in-memory sliding window,
  30 requests/minute per `CF-Connecting-IP`. No KV/D1/paid feature. Trade-off: the
  map resets when an isolate recycles and Cloudflare may spread a client across
  isolates — this is a speed bump against casual abuse, not a hard quota. A hard
  quota would need KV or D1 (deliberately out of scope for Stage 3A).
- **Privacy:** no cookies set or forwarded, no analytics, no logging of feed URLs.

**Egress note:** production egress is the Cloudflare network; some publishers block
datacenter IPs. That cannot be verified without deploying (owner-only). Validation
applies regardless, and local `wrangler dev` fetches from the dev machine instead.

## Local run (no login, no remote bindings)

Wrangler 4.160.0 is already installed under `worker/letters/node_modules` — reuse it
(read-only) or `npx wrangler@4.160.0`:

```sh
cd worker/podcast
../letters/node_modules/.bin/wrangler dev --local --port 8788
# Windows: ..\letters\node_modules\.bin\wrangler.cmd dev --local --port 8788
```

`--local` disables remote bindings; there are none anyway. Smoke test:

```sh
curl "http://127.0.0.1:8788/feed?url=https%3A%2F%2Fmedia.rss.com%2Fsyntax%2Ffeed.xml"
```

Tests (Node ≥ 24, no network):

```sh
cd worker/podcast
node --test test/
```

## Owner deployment (later — never part of an agent task)

No secrets are required. From a machine where the owner is logged in to Cloudflare:

```sh
cd worker/podcast
wrangler login          # owner only, interactive
wrangler deploy         # reads wrangler.toml; creates/updates `void-podcast`
```

The service then answers at `https://void-podcast.minoodar.workers.dev/feed?url=…`.
The frontend default points there; local development overrides it via the
git-ignored `podcast-dev-config.local.js` (`feedWorker: 'http://127.0.0.1:8788'`).

This Worker is **not** connected to Workers Builds; pushing the repo does not
deploy it. The existing `void-galaxy-letters` Worker, its `wrangler.toml` and its
D1 binding are untouched by Stage 3A.