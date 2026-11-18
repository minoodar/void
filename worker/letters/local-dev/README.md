# Local Podcast visual test

This setup uses a local Wrangler Worker and local D1 storage. It never targets the production Worker or production D1 when the commands below are used exactly.

## One-time setup

From `worker/letters`:

```powershell
$env:PATH='C:\Users\minoodar\AppData\Local\Programs\NodeJS-26-portable\node-v26.13.1-win-x64;' + $env:PATH
& 'C:\Users\minoodar\AppData\Local\Programs\NodeJS-26-portable\node-v26.13.1-win-x64\npm.cmd' ci
New-Item -ItemType Directory -Force .wrangler/podcast-local | Out-Null
& '.\node_modules\.bin\wrangler.cmd' d1 execute DB --local --persist-to .wrangler/podcast-local --config wrangler.local.toml --file=schema.sql
& '.\node_modules\.bin\wrangler.cmd' d1 execute DB --local --persist-to .wrangler/podcast-local --config wrangler.local.toml --file=local-dev/podcast-schema.sql
& '.\node_modules\.bin\wrangler.cmd' d1 execute DB --local --persist-to .wrangler/podcast-local --config wrangler.local.toml --file=local-dev/seed.sql
```

The local schema extension permits the Stage 1 `podcast` membership while leaving the production schema untouched. Do not run the production migration chain against this database, and never add `--remote` to any command.

## Start the Worker

```powershell
& '.\node_modules\.bin\wrangler.cmd' dev --local --persist-to .wrangler/podcast-local --config wrangler.local.toml --port 8787
```

The local API is `http://127.0.0.1:8787`. The config sets `ENVIRONMENT=local-dev`, `ALLOW_LOCAL=1`, and `MUSIC_DOMAINS_ENABLED=1`; no secret or production credential is used.

## Start the frontend

In a second PowerShell window, from the repository root:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/index.html?local-api=1&podcast=1`.

## Checks

```powershell
Invoke-WebRequest http://127.0.0.1:8787/tracks
Invoke-WebRequest http://127.0.0.1:8787/tracks/domains
$cors=@{Origin='http://127.0.0.1:8765'}
Invoke-WebRequest http://127.0.0.1:8787/tracks -Headers $cors
$preflight=@{Origin='http://127.0.0.1:8765';'Access-Control-Request-Method'='GET'}
Invoke-WebRequest -Method Options http://127.0.0.1:8787/tracks -Headers $preflight
```

The browser requests should show successful CORS responses from `http://127.0.0.1:8765`. Omit `podcast=1` to verify the original three-domain behavior; omit `local-api=1` only when intentionally testing the production API from an allowed origin.
