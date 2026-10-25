# Void Galaxy Music

Standalone web build of the Void Galaxy music player. The original Chrome
extension in `../Void Galaxy` is untouched.

```
index.html          page shell + auto-hide top navigation
void-music.css      player styles (plus the #void-counter exemption in the body hide rules)
void-music.js       player (copied from the extension, with hasExt() guards)
void-music-viz.js   galaxy visualizer (unchanged)
void-counter.css    visitor counter styles
void-counter.js     visitor counter logic
worker/             Cloudflare Worker + D1 backend for the counter
```

## Run locally

Serve the folder over HTTP (opening `index.html` from disk can block fetch):

```
python -m http.server 8137
# http://127.0.0.1:8137/
```

The player opens automatically. The visitor counter is designed to stay hidden
until `void-counter.js` points at a working Worker and returns valid stats.

## Visitor counter

A 9px amber dot sits in the bottom-left corner (top-left below 1040px wide,
where the player controls occupy the bottom-left). Hover, focus, or tap it to
expand a small glass pill:

```
1,284 listeners
37% returned · 2,408 sessions
```

- `listeners` = distinct hashed visitors
- `returned` = visitors with more than one session ÷ distinct visitors
- `sessions` = one per browser tab session

It auto-collapses after 3s of no interaction, closes on outside tap or Escape,
does no polling and runs no animation frames (the dot's pulse is CSS only), and
pauses that pulse while the tab is hidden. With reduced motion the pulse and
count-up are disabled. The widget is only shown while the player is open, sits
below the player UI and navigation in z-order, and never covers the dock, seek
bar, or volume controls.

The player hides stray body overlays when music mode starts. The widget clears
that marker from itself, so it stays visible without any change to the player.
Keyboard focus opens the pill only when the browser reports `:focus-visible`;
a touch tap therefore toggles it once, without a focus-open fighting the click.

Measured sizes: JavaScript 3,943 B minified (5,383 B source); CSS 1,983 B
minified (2,020 B source). Budgets: 4 KB and 2 KB. The widget never blocks the
player: it is appended to `body`, waits for `load`, and its only animation is a
CSS pulse that pauses in hidden tabs.

### Configure the API

At the top of `void-counter.js`:

```js
const API = 'https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev';
```

Use the Worker origin only (no trailing slash, no `/stats`). Until this is a
real deployed URL, the widget stays invisible by design.

Behavior: one `POST /hit` per tab session (`sessionStorage('vgm-counted')`),
then `GET /stats`; reloads reuse the session marker. `localStorage('vgm-visitor')`
is only a boolean returning marker. Stats are cached in `sessionStorage` for
5 minutes. With `navigator.doNotTrack === '1'` or Global Privacy Control
enabled, no hit is sent — stats come from the 5-minute cache when available,
otherwise from `GET /stats`. Any network or payload failure leaves the widget
hidden, with no console output.

## Deploy the Worker

No Worker existed in this workspace, so a complete one is provided in `worker/`.
It targets Cloudflare Workers + D1 and uses ES modules.

```bash
cd worker
npx wrangler login

npx wrangler d1 create void-galaxy-counter
# copy the returned database_id into wrangler.toml

npx wrangler d1 execute void-galaxy-counter --remote --file=schema.sql
npx wrangler secret put SALT          # long random string, e.g. openssl rand -hex 32
npx wrangler secret put ADMIN_TOKEN   # long random string for /admin
npx wrangler deploy
```

Set the deployed URL as `API` in `void-counter.js`.

- `SALT` and `ADMIN_TOKEN` are Worker secrets; never commit them.
- CORS allows `https://minoodar.github.io` (see `PROD_ORIGIN` in
  `worker/worker.js`). For local testing against `wrangler dev`, set
  `ALLOW_LOCAL = "1"` in `wrangler.toml`; keep it `"0"` in production.
- `POST /hit` ignores requests with an empty or bot-like User-Agent and limits
  each hashed IP to 60 hits/hour. Raw IPs are only used in memory to compute
  `SHA-256(ip + SALT)`; they are never stored or returned.
- `GET /stats` returns `{unique_visitors, total_sessions, returning_ratio}` with
  `Cache-Control: public, max-age=60`; `returning_ratio` is `0..1`.
- `GET /admin` requires `Authorization: Bearer $ADMIN_TOKEN` and returns the top
  200 visitors by hits (hash truncated to 12 chars, with hits, sessions,
  first_seen, last_seen) plus the last 30 daily rows.

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/admin
```

Timestamps are Unix epoch milliseconds (UTC).

## Customize

- **Position / breakpoint / colors** — `void-counter.css`: edit the `left` /
  `bottom` of `#void-counter` and the `max-width: 1039px` query for the narrow
  layout; the amber dot colors are in `.vc-d`.
- **Auto-collapse** — `later(3000)` on open and `later(1200)` on pointer-leave
  in `void-counter.js`.
- **Cache and count-up** — the `300000` ms stats cache in `start()` and the
  `560` ms ease-out in `countUp()`.
- **Admin page size / rate limit** — the `LIMIT 200` queries and `HIT_LIMIT`
  in `worker/worker.js`.

## Privacy

No cookies, no third-party scripts, no fingerprinting, no raw IP storage.
The only browser storage is the session marker, the returning marker, and the
5-minute stats cache. Hashed IPs can still be pseudonymous personal data under
the GDPR/UK GDPR; publish a short site privacy note, keep `SALT` secret, and
define a retention policy for the D1 tables. Suggested note:

> Anonymous visitor counts, made from salted, hashed IP addresses. No cookies,
> no tracking, and no raw IP addresses are stored.

## Manual test checklist

1. First visit (new tab, no storage): one `POST /hit` → dot appears after stats.
2. Reload: no new hit; dot returns from the 5-minute cache.
3. New tab: one new session; visiting again makes `returned` rise.
4. Do Not Track on: no `/hit`; stats still read.
5. API offline / placeholder URL: no widget, no errors, player unaffected.
6. Hover/focus/tap: pill expands; outside tap, Escape, and 3s idle collapse it.
7. Keyboard only: Tab to the dot, Enter/Space toggles, Escape closes (focus
   stays on the dot).
8. Mobile 390×844: top-left dot, expanded pill clears the dock, seek, volume and
   the reopen button.
9. Reduced motion: no pulse, no count-up.
10. Player closed: widget hides; reopens with the player.

Nothing in this workspace has been deployed or published.
