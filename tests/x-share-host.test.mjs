/* Focused tests for the X share-intent host swap (Phase B).
   These do not reimplement the builders: each construction statement is
   extracted from the shipped source text and evaluated in a vm, and the same
   extraction runs against the pre-change bytes from `git show HEAD:<file>` so
   the only permitted difference is the hostname. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The checkout is CRLF (core.autocrlf) while `git show` yields LF; compare content. */
const work = (file) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
function baseline(file) {
  return execFileSync('git', ['-C', ROOT, 'show', `HEAD:${file}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
}

/* ---- fixtures: Persian copy, a hashtag, and a link carrying its own query + fragment ---- */
const FA = 'ستاره‌ای در کهکشان جای گذاشتم. ✶ تا محو نشده بخوانیدش #VoidGalaxy';
const EN = 'A star is burning in the Void. ✶ Read it before it fades! #VoidGalaxy';
const LINK = 'https://minoodar.github.io/void/?tab=letters&id=9f2c&lang=fa#open';

/* ---- extraction ---- */
function xIntentDecl(src) {
  const m = src.match(/^[ \t]*var X_INTENT = '([^']+)';[ \t]*$/m);
  assert.ok(m, 'X_INTENT declaration present');
  return m[1];
}
function lettersStatements(src) {
  const out = [...src.matchAll(/^[ \t]*(var url = X_INTENT[^\n]*;)[ \t]*$/gm)].map(m => m[1]);
  assert.equal(out.length, 2, 'both Letters share builders found');
  return out;
}
function lettersOpenCalls(src) {
  const out = [...src.matchAll(/window\.open\(url, '([^']+)', '([^']+)'\)/g)].map(m => [m[1], m[2]]);
  assert.ok(out.length >= 2, 'Letters window.open calls found');
  return out;
}
function podcastStatement(src) {
  const m = src.match(/^[ \t]*(shareBtn\('X',[^\n]*\);)[ \t]*$/m);
  assert.ok(m, 'Podcast X share builder present');
  return m[1];
}
function podcastSiblings(src) {
  return [...src.matchAll(/^[ \t]*(shareBtn\('(?:WhatsApp|Telegram)',[^\n]*;)[ \t]*$/gm)].map(m => m[1]);
}
function openShareUrlFn(src) {
  const m = src.match(/function openShareUrl\(u\) \{[\s\S]*?\n {2}\}/);
  assert.ok(m, 'Podcast openShareUrl present');
  return m[0];
}

/* ---- execution of the extracted bytes ---- */
function runLetters(stmt, intent, text, link) {
  const ctx = vm.createContext({
    X_INTENT: intent, text, link, shareUrl: link, encodeURIComponent,
    window: { open: () => {} }
  });
  vm.runInContext(stmt, ctx, { filename: 'letters-extract' });
  return vm.runInContext('url', ctx);
}
function runPodcast(stmt, openFn, text, ep) {
  const opened = [];
  let click = null;
  const ctx = vm.createContext({
    shareBtn: (label, fn) => { click = fn; return {}; },
    text, ep, encodeURIComponent,
    window: { open: (...a) => opened.push(a) }
  });
  vm.runInContext(stmt + '\n' + openFn, ctx, { filename: 'podcast-extract' });
  click();
  return { url: opened[0] && opened[0][0], args: opened[0] && opened[0].slice(1) };
}

function assertIntentShape(url, params, label) {
  const u = new URL(url);
  assert.equal(u.protocol, 'https:', label + ' protocol');
  assert.equal(u.host, 'x.com', label + ' host');
  assert.equal(u.pathname, '/intent/tweet', label + ' intent path preserved');
  assert.equal(u.hash, '', label + ' fragment stays inside the encoded param');
  assert.deepEqual([...u.searchParams.keys()], params, label + ' query parameter order');
  return u;
}

function assertEncodingStyle(url, label) {
  assert.equal(url.includes('+'), false, label + ': spaces encode as %20 (encodeURIComponent, not URLSearchParams)');
  assert.match(url, /%20/, label + ': percent-encoded space present');
  assert.match(url, /%23VoidGalaxy/, label + ': hashtag survives with # encoded');
}

function onlyHostDiffers(oldUrl, newUrl, label) {
  assert.equal(oldUrl.includes('twitter.com'), true, label + ': baseline used twitter.com');
  assert.equal(newUrl, oldUrl.replace('twitter.com', 'x.com'), label + ': only the host differs');
}

/* ========================= Letters ========================= */

test('Letters: X_INTENT is x.com and keeps /intent/tweet', () => {
  assert.equal(xIntentDecl(baseline('void-letters.js')), 'https://twitter.com/intent/tweet?text=');
  assert.equal(xIntentDecl(work('void-letters.js')), 'https://x.com/intent/tweet?text=');
});

for (const idx of [0, 1]) {
  test(`Letters: builder #${idx + 1} generates an x.com intent with unchanged path, params and encoding`, () => {
    const stmt = lettersStatements(work('void-letters.js'))[idx];
    const oldStmt = lettersStatements(baseline('void-letters.js'))[idx];
    for (const [text, label] of [[FA, 'persian'], [EN, 'english']]) {
      const now = runLetters(stmt, xIntentDecl(work('void-letters.js')), text, LINK);
      const before = runLetters(oldStmt, xIntentDecl(baseline('void-letters.js')), text, LINK);
      const u = assertIntentShape(now, ['text', 'url'], `Letters #${idx + 1} ${label}`);
      onlyHostDiffers(before, now, `Letters #${idx + 1} ${label}`);
      assertEncodingStyle(now, `Letters #${idx + 1} ${label}`);
      assert.equal(u.searchParams.get('text'), text, 'Letters: share text preserved');
      assert.equal(u.searchParams.get('url'), LINK, 'Letters: nested link preserved');
      assert.match(now, /id%3D9f2c%26lang%3Dfa%23open/, 'Letters: nested query and fragment stay encoded');
      assert.match(before, /id%3D9f2c%26lang%3Dfa%23open/, 'Letters: identical encoding before the change');
    }
  });
}

test('Letters: window.open arguments unchanged', () => {
  assert.deepEqual(lettersOpenCalls(work('void-letters.js')), lettersOpenCalls(baseline('void-letters.js')));
  for (const args of lettersOpenCalls(work('void-letters.js'))) {
    assert.deepEqual(args, ['_blank', 'noopener,noreferrer']);
  }
});

test('Letters: Persian panel copy from the fixed table encodes intact', () => {
  const src = work('void-letters.js');
  const m = src.match(/var X_PANEL_TEXT_FA = '([^']+)';/);
  assert.ok(m, 'X_PANEL_TEXT_FA present');
  const fa = JSON.parse('"' + m[1] + '"');
  const url = runLetters(lettersStatements(src)[0], xIntentDecl(src), fa, LINK);
  assert.equal(new URL(url).searchParams.get('text'), fa);
  assert.match(fa, /[\u0600-\u06FF]/);
});

/* ========================= Podcast ========================= */

test('Podcast: X share builder generates an x.com intent with unchanged text encoding', () => {
  const stmt = podcastStatement(work('podcast-window.js'));
  const oldStmt = podcastStatement(baseline('podcast-window.js'));
  assert.match(oldStmt, /https:\/\/twitter\.com\/intent\/tweet\?text=/);
  assert.match(stmt, /https:\/\/x\.com\/intent\/tweet\?text=/);
  const openFn = openShareUrlFn(work('podcast-window.js'));
  for (const [title, label] of [['«آوازِ کهکشان» تا محو نشده #VoidGalaxy', 'persian'], ['Song of the Galaxy ✶ #VoidGalaxy', 'english']]) {
    const ep = { title, audioUrl: 'https://cdn.example.org/ep/7.mp3?t=1&sig=ab%2Fcd#frag' };
    const now = runPodcast(stmt, openFn, title, ep);
    const before = runPodcast(oldStmt, openShareUrlFn(baseline('podcast-window.js')), title, ep);
    const u = assertIntentShape(now.url, ['text'], `Podcast ${label}`);
    onlyHostDiffers(before.url, now.url, `Podcast ${label}`);
    assertEncodingStyle(now.url, `Podcast ${label}`);
    assert.equal(u.searchParams.get('text'), title + ' ' + ep.audioUrl, 'Podcast: title + audio URL preserved');
    assert.match(now.url, /mp3%3Ft%3D1%26sig%3Dab%252Fcd%23frag/, 'Podcast: audio URL with its own query stays encoded');
  }
});

test('Podcast: openShareUrl window.open options unchanged', () => {
  const openFn = openShareUrlFn(work('podcast-window.js'));
  assert.equal(openFn, openShareUrlFn(baseline('podcast-window.js')));
  const now = runPodcast(podcastStatement(work('podcast-window.js')), openFn, 'x', { title: 'x', audioUrl: 'https://e/x.mp3' });
  assert.deepEqual(now.args, ['_blank', 'noopener']);
});

test('Podcast: sibling WhatsApp/Telegram builders byte-identical', () => {
  const list = podcastSiblings(work('podcast-window.js'));
  assert.equal(list.length, 2);
  assert.deepEqual(list, podcastSiblings(baseline('podcast-window.js')));
});

/* ========================= untouched surfaces ========================= */

test('Golden Folder carries no X intent, so nothing was changed there', () => {
  const invite = work('void-invite.js');
  assert.doesNotMatch(invite, /twitter\.com|x\.com/i, 'void-invite.js has no X host at all');
  assert.equal(invite.includes("BASE + '?invite=' + encodeURIComponent(id)"), true);
  assert.equal(invite, baseline('void-invite.js'), 'void-invite.js bytes untouched');
});

test('Local Music and index.html gain no X sharing', () => {
  assert.doesNotMatch(work('void-music.js'), /twitter\.com|x\.com\/intent/i);
  assert.doesNotMatch(work('index.html'), /twitter\.com|x\.com\/intent/i);
});

test('no twitter.com share intent remains in the two edited files', () => {
  assert.doesNotMatch(work('void-letters.js'), /twitter\.com/);
  assert.doesNotMatch(work('podcast-window.js'), /twitter\.com/);
});

test('scope: only the two approved files carry a share-host change', () => {
  const changed = execFileSync('git', ['-C', ROOT, 'status', '--porcelain=v1', '--untracked-files=all'],
    { encoding: 'utf8' }).split('\n').filter(Boolean)
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, '')).sort();
  /* The UX-polish round (auto-close, follow link, title re-entry) sits on top of
     Phase B in this tree, plus the cache-key bumps it required; nothing else. */
  assert.deepEqual(changed, ['index.html', 'podcast-player.js', 'podcast-window.css', 'podcast-window.js',
    'tests/podcast-ux.test.mjs', 'tests/x-share-host.test.mjs', 'void-domains.js', 'void-letters.js']);
  const diff = execFileSync('git', ['-C', ROOT, 'diff', '-U0', 'HEAD'], { encoding: 'utf8' })
    .replace(/\r\n/g, '\n');
  let file = '';
  const hostTouched = [];
  for (const line of diff.split('\n')) {
    const f = line.match(/^\+\+\+ b\/(.+)$/);
    if (f) { file = f[1]; continue; }
    if (/^[-+]/.test(line) && /(twitter\.com|x\.com)\/intent\/tweet/.test(line)) { hostTouched.push(file); }
  }
  assert.deepEqual([...new Set(hostTouched)].sort(), ['podcast-window.js', 'void-letters.js'],
    'no other file gained or lost an X intent line');
  assert.equal(hostTouched.length, 4, 'one added and one removed intent line per approved file');
  const keyed = diff.split('\n').filter((l) => /^[-+][^-+]/.test(l) && /\?v=/.test(l));
  assert.equal(keyed.length, 8, 'four keyed lines changed: two in index.html, two in void-domains.js');
  assert.ok(keyed.every((l) => /void-letters\.js|void-domains\.js|podcast-window\.(js|css)|podcast-player\.js/.test(l)),
    'every keyed change belongs to a file whose bytes changed');
});
