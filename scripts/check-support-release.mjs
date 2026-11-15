#!/usr/bin/env node
/* Release-integrity guard for the Void Support panel.
   GitHub Pages publishes the production site from `main`. This check fails if
   the three-option Support panel (Donito IRR + BTC/USDT address & local QR) is
   broken in the release:
     - index.html stops referencing void-support.js / void-qr.js / void-support.css
     - void-support.js or void-qr.js is missing from the release
     - the three Support methods (donito / btc / usdt) are removed
     - the Support rail control reverts to a plain link instead of the modal button
   No dependencies; deploys nothing; never touches Cloudflare Workers / D1 / R2.
   Run from the repo root:  node scripts/check-support-release.mjs [repoRoot] */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = process.argv[2] || fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const ok = (label) => console.log('PASS  ' + label);
const bad = (label) => { failures.push(label); console.log('FAIL  ' + label); };
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

/* 1. Required release files exist. */
for (const f of ['void-support.js', 'void-qr.js', 'void-support.css']) {
  if (existsSync(join(root, f))) ok('release file present: ' + f);
  else bad('release file missing: ' + f);
}

/* 2. index.html still wires the panel. */
const html = read('index.html');
if (html == null) {
  bad('index.html missing');
} else {
  for (const ref of ['void-support.js', 'void-qr.js', 'void-support.css']) {
    if (html.includes(ref)) ok('index.html references ' + ref);
    else bad('index.html no longer references ' + ref);
  }
  if (/<button[^>]*id="void-topnav-support"/.test(html)) ok('Support rail control is the modal button');
  else bad('Support rail control is not <button id="void-topnav-support"> (link regression)');
}

/* 3. The three methods, the Donito target and a configured address survive.
      The address value is never printed. */
const support = read('void-support.js');
if (support == null) {
  bad('void-support.js unreadable for method check');
} else {
  const keys = [...support.matchAll(/key:\s*'([a-z]+)'/g)].map((m) => m[1]);
  for (const need of ['donito', 'btc', 'usdt']) {
    if (keys.includes(need)) ok('Support method present: ' + need);
    else bad('Support method removed: ' + need);
  }
  if (support.includes('https://donito.me/u-b8wjr')) ok('Donito (IRR) target intact');
  else bad('Donito (IRR) target changed or missing');
  if (/var\s+ADDRESS\s*=\s*'0x[0-9a-fA-F]{40}'/.test(support)) ok('wallet address configured (value not printed)');
  else bad('wallet address constant missing or malformed');
}

console.log('');
if (failures.length) {
  console.log('RELEASE INTEGRITY: FAIL (' + failures.length + ') - the three-option Support panel is broken in this release.');
  process.exit(1);
}
console.log('RELEASE INTEGRITY: PASS - three-option Support panel intact.');