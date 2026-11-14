import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'void-domains.js'), 'utf8').replace(/\r\n/g, '\n');
const folderSource = readFileSync(join(root, 'void-folder.js'), 'utf8').replace(/\r\n/g, '\n');
const normalizerStart = folderSource.indexOf('function resolveMedia');
const normalizerEnd = folderSource.indexOf('/* A failed load', normalizerStart);
assert.notEqual(normalizerStart, -1, 'Golden Folder media normalizer exists');
assert.notEqual(normalizerEnd, -1, 'Golden Folder normalizer boundary exists');
const normalizerSource = folderSource.slice(normalizerStart, normalizerEnd);
const normalizeTracks = vm.runInNewContext(
  `(function () { ${normalizerSource}\n return normalizeTracks; })()`,
  { URL, location: { href: 'https://void.test/' }, Object }
);
const domainCss = readFileSync(join(root, 'void-domains.css'), 'utf8');
const htmlSource = readFileSync(join(root, 'index.html'), 'utf8');
const adapterMarker = "(function () {\n  'use strict';\n  var button=document.getElementById('void-golden-folder');";
const adapterStart = source.indexOf(adapterMarker);
assert.notEqual(adapterStart, -1, 'domain adapter entrypoint exists');
const adapterSource = source.slice(adapterStart);
const replaceMethod = folderSource.match(/replaceTracks: function \(tracks\) \{([\s\S]*?)\n    \},\n    find:/);
assert.ok(replaceMethod, 'Golden Folder exposes the filtered-view API');

function harness(fetchImpl, catalogue) {
  const clickListeners = [];
  const closeListeners = [];
  const note = {
    className: '', textContent: '',
    setAttribute() {},
    classList: { add() {}, remove() {} }
  };
  const button = {
    attrs: {}, contains(target) { return target === this; },
    setAttribute(name, value) { this.attrs[name] = value; }
  };
  const dialog = { addEventListener(name, listener) { if (name === 'close') closeListeners.push(listener); } };
  const document = {
    body: { appendChild() {} },
    getElementById(id) {
      if (id === 'void-golden-folder') return button;
      if (id === 'void-music-root') return {};
      if (id === 'void-golden-modal') return dialog;
      return null;
    },
    createElement() { return note; },
    addEventListener(name, listener, capture) { if (name === 'click' && capture) clickListeners.push(listener); }
  };

  let selectorOpen = false;
  let callbacks;
  const original = catalogue || [
    { id: 'inner-1', title: 'Still Water', url: 'https://media.test/inner.mp3' },
    { id: 'flow-1', title: 'Moving Air', url: 'https://media.test/flow.mp3' }
  ];
  let visibleTracks = original.slice();
  const replaced = [];
  let openedGolden = 0;
  const queue = ['already-playing-track'];
  const golden = {
    getTracks() { return visibleTracks.map(track => ({ ...track })); },
    replaceTracks(tracks) {
      if (!Array.isArray(tracks)) return false;
      const ids = new Set(original.map(track => track.id));
      if (tracks.some(track => !track || !ids.has(track.id))) return false;
      visibleTracks = tracks.map(track => original.find(item => item.id === track.id));
      replaced.push(visibleTracks.map(track => track.id));
      return true;
    },
    open() { openedGolden++; }
  };
  const window = {
    innerWidth: 1280,
    innerHeight: 800,
    VoidDomains: {
      DOMAIN_ORDER: ['inner', 'flow', 'beyond'],
      createConstellation(options) {
        callbacks = options;
        return {
          isOpen() { return selectorOpen; },
          open() { selectorOpen = true; options.onOpen(); },
          close() { selectorOpen = false; options.onClose(); }
        };
      }
    },
    VoidLettersApi: { base: 'https://worker.test' },
    VoidGolden: golden
  };
  const context = {
    window, document,
    fetch: fetchImpl,
    setTimeout() { return 1; },
    clearTimeout() {},
    Set,
    Promise
  };
  vm.runInNewContext(adapterSource, context, { filename: 'void-domains.js' });

  async function clickGolden() {
    clickListeners[0]({ target: button, preventDefault() {}, stopImmediatePropagation() {} });
    await new Promise(resolve => setImmediate(resolve));
  }
  return {
    button, callbacks, dialog, note, original, visible: () => visibleTracks.map(track => track.id),
    replaced, queue, openedGolden: () => openedGolden, selectorOpen: () => selectorOpen,
    close() { closeListeners.forEach(listener => listener()); }, clickGolden,
    choose(domain) { callbacks.onSelect(domain); }
  };
}

const response = tracks => ({ ok: true, async json() { return { ok: true, tracks }; } });

test('domain selection filters the Golden Folder view and closing restores the catalogue without changing playback queue', async () => {
  const app = harness(async () => response([
    { id: 'inner-1', domains: ['inner'] },
    { id: 'flow-1', domains: ['flow'] }
  ]));
  await app.clickGolden();
  app.choose('inner');
  assert.deepEqual(app.visible(), ['inner-1']);
  assert.equal(app.openedGolden(), 1);
  assert.deepEqual(app.queue, ['already-playing-track']);
  app.close();
  assert.deepEqual(app.visible(), ['inner-1', 'flow-1']);
  assert.deepEqual(app.replaced, [['inner-1'], ['inner-1', 'flow-1']]);
  assert.deepEqual(app.queue, ['already-playing-track']);
});

test('an empty domain is valid and does not alter the Golden Folder list', async () => {
  const app = harness(async () => response([{ id: 'inner-1', domains: ['inner'] }]));
  await app.clickGolden();
  app.choose('beyond');
  assert.deepEqual(app.visible(), ['inner-1', 'flow-1']);
  assert.equal(app.openedGolden(), 0);
});

test('domain filtering distinguishes different track IDs that share the same audio URL', async () => {
  const sharedUrl = 'https://media.test/state-of-siege.mp3';
  const app = harness(async () => response([
    { id: 'state-of-siege-a', domains: ['inner'] },
    { id: 'state-of-siege-b', domains: ['flow'] }
  ]), [
    { id: 'state-of-siege-a', title: 'State Of Siege I', url: sharedUrl },
    { id: 'state-of-siege-b', title: 'State Of Siege II', url: sharedUrl }
  ]);
  await app.clickGolden();
  app.choose('flow');
  assert.deepEqual(app.visible(), ['state-of-siege-b']);
  assert.equal(app.original[0].url, app.original[1].url);
  assert.notEqual(app.original[0].id, app.original[1].id);
});

test('an unavailable or malformed domain response falls back to the existing Golden Folder', async t => {
  for (const [name, fetchImpl] of [
    ['HTTP failure', async () => ({ ok: false, status: 503 })],
    ['malformed payload', async () => ({ ok: true, async json() { return { ok: true, tracks: [{ id: 'bad', domains: ['unknown'] }] }; } })]
  ]) {
    await t.test(name, async () => {
      const app = harness(fetchImpl);
      await app.clickGolden();
      assert.equal(app.openedGolden(), 1);
      assert.deepEqual(app.visible(), ['inner-1', 'flow-1']);
      assert.equal(app.selectorOpen(), false);
    });
  }
});

test('domain API is read-only and requests the deployed tracks/domains endpoint with GET', async () => {
  let request;
  const app = harness(async (url, options) => {
    request = { url, options };
    return response([]);
  });
  await app.clickGolden();
  assert.equal(request.url, 'https://worker.test/tracks/domains');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.method, undefined);
});

test('VoidGolden.replaceTracks accepts only unique tracks from the canonical catalogue and accepts empty views', () => {
  const sharedUrl = 'https://media.test/shared.mp3';
  const catalogue = [{ id: 'one', title: 'One', url: sharedUrl }, { id: 'two', title: 'Two', url: sharedUrl }];
  const applied = [];
  let view = catalogue.slice();
  const replaceTracks = vm.runInNewContext(
    `(function (tracks) {${replaceMethod[1]}\n})`,
    { CATALOGUE: catalogue, applyTracks(next, filtered) { view = next; applied.push({ next, filtered }); } }
  );
  assert.equal(replaceTracks([{ id: 'two' }]), true);
  assert.deepEqual(JSON.parse(JSON.stringify(view)), [catalogue[1]]);
  assert.equal(view[0].url, sharedUrl, 'selection resolves to the canonical record by ID even when its URL is shared');
  assert.equal(applied[0].filtered, true);
  assert.equal(replaceTracks([]), true);
  assert.deepEqual(JSON.parse(JSON.stringify(view)), []);
  assert.equal(replaceTracks([{ id: 'unknown' }]), false);
  assert.equal(replaceTracks([{ id: 'one' }, { id: 'one' }]), false);
  assert.equal(replaceTracks(null), false);
  assert.equal(applied.length, 2, 'invalid filters do not rebuild the Golden Folder list');
});

test('Golden Folder rejects missing or duplicate backend IDs instead of inventing position-based identities', () => {
  const duplicateUrl = 'https://media.test/state-of-siege.mp3';
  const rows = [
    { id: 'state-of-siege-a', title: 'State Of Siege I', audio_url: duplicateUrl },
    { id: 'state-of-siege-b', title: 'State Of Siege II', audio_url: duplicateUrl }
  ];
  const normalized = normalizeTracks({ ok: true, tracks: rows });
  const normalizedKeys = JSON.parse(JSON.stringify(normalized.map(track => ({ id: track.id, url: track.url }))));
  const expectedKeys = rows.map(row => ({ id: row.id, url: row.audio_url }));
  assert.deepEqual(normalizedKeys, expectedKeys);
  assert.equal(normalizeTracks({ ok: true, tracks: [{ title: 'No ID', audio_url: duplicateUrl }] }), null);
  assert.equal(normalizeTracks({ ok: true, tracks: [rows[0], { ...rows[0], title: 'Duplicate ID' }] }), null);
});

test('domain assets load externally under the existing same-origin CSP and after Golden Folder setup', () => {
  assert.match(htmlSource, /Content-Security-Policy[^>]*script-src 'self'/);
  assert.match(htmlSource, /connect-src[^\"]*https:\/\/void-galaxy-letters\.minoodar\.workers\.dev/);
  assert.match(htmlSource, /href="void-domains\.css\?v=20261114"/);
  assert.match(htmlSource, /src="void-folder\.js\?v=20261111"/);
  assert.match(htmlSource, /src="void-admin\.js\?v=20261114" defer/);
  assert.match(htmlSource, /src="void-domains\.js\?v=20261114" defer/);
  assert.ok(htmlSource.indexOf('src="void-folder.js?v=20261111"') < htmlSource.indexOf('src="void-domains.js?v=20261114" defer'));
  assert.ok(htmlSource.indexOf('src="void-admin.js?v=20261114" defer') < htmlSource.indexOf('src="void-domains.js?v=20261114" defer'));
  assert.doesNotMatch(domainCss, /#void-music-root\s*>\s*:not\(/, 'domain CSS must not rewrite z-index for unrelated player children');
});
