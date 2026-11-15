# Void — Production release & Support-panel integrity

## `main` is the GitHub Pages production branch

The public site **https://minoodar.github.io/void/** is published by GitHub Pages
**from the `main` branch** (Pages → Build and deployment → Source: *Deploy from a
branch*, branch `main`, root `/`).

- **A fix only becomes publicly visible once it reaches `main`.**
- **A successful push to any other branch does NOT update the live site.**
  Feature branches such as `chromium70-phase-a` are staging/integration branches;
  pushing to them changes nothing on the public URL while Pages source is `main`.
- **Do not "fix" production by switching the Pages source branch** to a feature
  branch as a shortcut. Feature branches can lack work that only exists on `main`
  (for example **Source Divides**), so switching the source would regress the live
  site. Integrate the fix into `main` instead.

## Frontend release procedure (Pages)

1. Back up the current `main` release state before editing.
2. Integrate the approved change **into the existing `main` files** — do not
   overwrite `main` wholesale with an older branch version, and do not discard
   unrelated or in-progress work.
3. Run the Support-panel integrity guard (below) and a focused browser check.
4. Create one clean commit on `main` and push to `origin/main`.
5. Wait for the **pages build and deployment** run to finish, then verify the
   **live bytes** (e.g. `void-support.js` and `void-qr.js` return HTTP 200 and the
   served file md5 equals the committed blob). A green Git push alone is not proof
   of a live release.

Pages (frontend) and the Cloudflare Worker (backend) are **separate** deployments.
A Pages push does not deploy D1/R2 or run migrations. The Worker is deployed by
Workers Builds on `main`; `.github/workflows/deploy-letters-worker.yml` is a
manual-only fallback. Do not conflate the two.

## Support-panel regression guard

The three-option Support panel must remain intact in every production release:

- **IRR / Donito** → opens `https://donito.me/u-b8wjr`
- **USDT (BEP20)** → the configured wallet address + its locally generated QR
- **BTC (BEP20)** → the configured wallet address + its locally generated QR

Files: `void-support.js`, `void-support.css`, `void-qr.js` (local QR encoder),
wired into `index.html` (stylesheet link, the `<button id="void-topnav-support">`
rail trigger, and the two deferred scripts). The wallet address is configured
once in `void-support.js`; never reconstruct or replace it.

### What the guard checks

`scripts/check-support-release.mjs` (no dependencies) **fails** when:

- `index.html` no longer references `void-support.js`, `void-qr.js` or `void-support.css`;
- `void-support.js` or `void-qr.js` is missing from the release;
- any of the three methods (`donito`, `btc`, `usdt`) is removed from `void-support.js`;
- the Support rail control reverts from the modal `<button>` to a plain link;
- the Donito target or the configured wallet address constant is missing.

It prints only PASS/FAIL labels and never prints the wallet address.

### Where it runs

- **CI:** `.github/workflows/release-integrity.yml` runs the guard on every
  **push to `main`** and **pull request targeting `main`** (and manually via
  *workflow_dispatch*). A broken Support panel turns the check red.
- **Locally, before publishing:**

  ```bash
  node scripts/check-support-release.mjs
  ```

  Exit code `0` = intact, `1` = broken. Keep it green before pushing to `main`.