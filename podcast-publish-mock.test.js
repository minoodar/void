/* podcast-publish-mock — Node tests for the Phase 1 UI preview adapter.
   Covers the product-visible rules the preview is built on: seven-day lifetime,
   the uniform "gone" answer, Q6 republish rules, capability idempotency, the
   uniform report response, Save/Follow independence with a capacity refusal,
   expiry-aware un-hide, isolated persistence, and a Chromium-70 syntax scan of
   every preview file. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mock = require('./podcast-publish-mock.js');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); checks++; }

function memStorage(seed) {
  const map = new Map(seed ? Object.entries(seed) : []);
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    dump: () => Object.fromEntries(map)
  };
}
function fresh(opts) {
  return mock.createApi(Object.assign({ storage: memStorage(), latency: 0 }, opts || {}));
}
const DAY = mock.DAY_MS;

(async function run() {
  /* ---- A. constants and fixtures ---- */
  eq(mock.LIFETIME_MS, 7 * DAY, 'A1: lifetime is seven days');
  ok(mock.SHOWS.length === 4 && mock.EPISODES.length === 9, 'A2: fixture catalogue present');
  ok(mock.SHOWS.every(s => /\.example\.org$|\.example\.org\//.test(s.feedUrl)),
    'A3: every fixture feed sits on a reserved example domain, never a real one');
  ok(mock.EPISODES.every(e => e.audioUrl === '' || /media\.example\.org/.test(e.audioUrl)),
    'A4: no fixture points at real media');
  const noteCap = mock.EPISODES.filter(e => !e.audioUrl).length;
  ok(noteCap < mock.EPISODES.length, 'A5: at least one fixture carries media, so the real-episode path is demoable');

  /* ---- B. ambient list ---- */
  {
    const api = fresh();
    const { publications } = await api.list();
    eq(publications.length, 3, 'B1: only the three viewable publications are listed');
    ok(publications.every(p => p.kind === 'active' || p.status === 'active'), 'B2: every listed publication is active');
    ok(JSON.stringify(publications).indexOf('example.org') < 0, 'B3: the ambient payload carries no feed address');
    ok(publications.every(p => !('feedUrl' in p) && !('guid' in p)), 'B4: detail-only fields absent from the list view');
    ok(publications.every(p => p.createdAt >= p.expiresAt - mock.LIFETIME_MS - 1), 'B5: expiresAt is createdAt + lifetime');
    const sorted = publications.map(p => p.createdAt);
    eq(sorted.slice().sort((a, b) => b - a), sorted, 'B6: newest first');
  }

  /* ---- C. one indistinguishable "gone" answer ---- */
  {
    const api = fresh();
    const expired = await api.get('vgld02');    /* seeded 9 days old */
    const hidden = await api.get('vgld09');     /* hidden by moderation */
    const removed = await api.get('vgpl06');    /* removed tombstone */
    const unknown = await api.get('not-a-real-id');
    const shape = o => JSON.stringify(Object.keys(o).sort());
    eq(expired, { kind: 'gone', id: 'vgld02' }, 'C1: expired reads as gone, id echoed, nothing else');
    eq(hidden, { kind: 'gone', id: 'vgld09' }, 'C2: hidden reads as gone with no publication id or reason');
    eq(removed, { kind: 'gone', id: 'vgpl06' }, 'C3: removed reads as gone, permanently');
    eq(unknown.kind, 'gone', 'C4: unknown id answers the same way, so no existence oracle');
    eq(shape(expired), shape(unknown), 'C5: gone responses are the same shape whatever the cause');
    const live = await api.get('vgnf04');
    eq(live.kind, 'publication', 'C6: an active publication returns detail');
    ok(live.feedUrl && live.guid, 'C7: detail carries the feed address and GUID the client needs');
    ok(!('audioUrl' in live) && JSON.stringify(live).indexOf('.mp3') < 0,
      'C8: no audio URL is ever carried by a publication record');
  }

  /* ---- D. Q6 republish rules ---- */
  {
    const api = fresh();
    const dupActive = await api.publish({ capability: mock.makeCapability(), kind: 'episode', target: 'nf-04', note: 'again' });
    eq([dupActive.ok, dupActive.code, dupActive.publicationId], [false, 'duplicate', 'vgnf04'],
      'D1: an unexpired active duplicate names the existing publication');
    const dupHidden = await api.publish({ capability: mock.makeCapability(), kind: 'episode', target: 'ld-09', note: 'again' });
    eq([dupHidden.ok, dupHidden.code, dupHidden.publicationId], [false, 'publication-unavailable', undefined],
      'D2: a hidden duplicate blocks without revealing any id');
    const dupRemoved = await api.publish({ capability: mock.makeCapability(), kind: 'episode', target: 'pl-06', note: 'again' });
    eq([dupRemoved.ok, dupRemoved.code], [false, 'publication-unavailable'], 'D3: a removed duplicate blocks permanently');
    const afterExpired = await api.publish({ capability: mock.makeCapability(), kind: 'episode', target: 'ld-02', note: 'fresh look' });
    ok(afterExpired.ok && afterExpired.publication.id !== 'vgld02',
      'D4: an expired publication releases the identity key and the new one gets a new id');
    const old = await api.get('vgld02');
    eq(old.kind, 'gone', 'D5: the expired original keeps its id and stays unavailable, never revived');
    eq([await api.publish({ capability: mock.makeCapability(), kind: 'episode', target: 'nope', note: 'x' }).then(r => r.code),
        await api.publish({ capability: mock.makeCapability(), kind: 'episode', target: 'nf-01', note: '' }).then(r => r.code)],
      ['unknown-target', 'note-required'], 'D6: unknown target and empty note are refused');
    const showWide = await api.publish({ capability: mock.makeCapability(), kind: 'show', target: 'nf', note: 'start here' });
    ok(showWide.ok, 'D7: a Show publication is accepted');
    const showDup = await api.publish({ capability: mock.makeCapability(), kind: 'show', target: 'nf', note: 'start here' });
    eq(showDup.code, 'duplicate', 'D8: a second Show publication for the same feed is a duplicate');
    const epDup = await api.publish({ capability: mock.makeCapability(), kind: 'episode', target: 'nf-01', note: 'one episode' });
    ok(epDup.ok, 'D9: an episode inside an already-published Show is still publishable on its own');
  }

  /* ---- E. capability: fresh, idempotent, never in a payload again ---- */
  {
    const cap = mock.makeCapability();
    eq(cap.length, 43, 'E1: capability is 43 base64url characters (256 bits)');
    ok(/^[A-Za-z0-9_-]{43}$/.test(cap), 'E2: base64url alphabet only, no padding');
    const seen = new Set();
    for (let i = 0; i < 200; i++) { seen.add(mock.makeCapability()); }
    eq(seen.size, 200, 'E3: two hundred draws never repeat, so a capability is per-publication');
    const api = fresh();
    const a = await api.publish({ capability: cap, kind: 'episode', target: 'so-07', note: 'retry me' });
    const between = api.__preview.recordCount();
    const b = await api.publish({ capability: cap, kind: 'episode', target: 'so-07', note: 'retry me' });
    ok(a.ok && b.ok && a.publication.id === b.publication.id && b.idempotent === true,
      'E4: retry with the same capability returns the same publication instead of a conflict');
    eq(api.__preview.recordCount(), between, 'E5: the retry created no second record');
    ok(JSON.stringify((await api.list()).publications).indexOf(cap) < 0,
      'E6: the capability never appears in the ambient payload');
    const mine = api.mine();
    ok(mine.some(m => m.capability === cap), 'E7: the client keeps the capability locally for revocation');
    ok(JSON.stringify(mine).indexOf(cap) >= 0, 'E8: mine() is the only read that hands the capability back, to its owner');
  }

  /* ---- F. report is uniform ---- */
  {
    const api = fresh();
    const r1 = await api.report('vgnf04');
    const r2 = await api.report('vgnf04');
    const r3 = await api.report('nothing-here');
    const r4 = await api.report('vgld09');
    eq([r1, r2, r3, r4], [{ ok: true }, { ok: true }, { ok: true }, { ok: true }],
      'F1: recorded, repeated, unknown and hidden all answer identically');
    const after = await api.get('vgnf04');
    eq(after.kind, 'publication', 'F2: reporting an active publication does not hide it by itself');
    eq(Object.keys(r1), ['ok'], 'F3: the report answer carries no extra field');
  }

  /* ---- G. revoke ---- */
  {
    const api = fresh();
    const cap = mock.makeCapability();
    const pub = await api.publish({ capability: cap, kind: 'episode', target: 'pl-03', note: 'mine' });
    eq((await api.get(pub.publication.id)).kind, 'publication', 'G1: published and readable');
    const bad = await api.revoke({ capability: mock.makeCapability() });
    eq(bad.ok, false, 'G2: an unrelated capability revokes nothing');
    eq(bad.code, 'publication-unavailable', 'G3: and the refusal reveals nothing about the id');
    const good = await api.revoke({ capability: cap });
    ok(good.ok && good.publicationId === pub.publication.id, 'G4: the held capability revokes its own publication');
    eq((await api.get(pub.publication.id)).kind, 'gone', 'G5: revoked publications read as gone');
    const again = await api.revoke({ capability: cap });
    ok(again.ok === true && again.publicationId === pub.publication.id,
      'G6: a second revoke is a no-op for the same owner rather than a new state');
    eq((await api.get(pub.publication.id)).kind, 'gone', 'G6b: and the publication stays unavailable');
    const replay = await api.publish({ capability: cap, kind: 'episode', target: 'pl-03', note: 'again' });
    ok(replay.ok && replay.idempotent === true && replay.publication.id === pub.publication.id,
      'G7: the same capability always resolves to the publication it created');
    const fresh2 = await api.publish({ capability: mock.makeCapability(), kind: 'episode', target: 'pl-03', note: 'again' });
    ok(fresh2.ok && fresh2.publication.id !== pub.publication.id,
      'G8: a revoked row releases the identity key, so a new capability gets a new publication');
    eq((await api.get(pub.publication.id)).kind, 'gone',
      'G9: the revoked original keeps its id and stays unavailable');
  }

  /* ---- H. Save and Follow stay independent, and capacity refuses ---- */
  {
    const api = fresh();
    eq(api.isSaved('vgnf04'), false, 'H1: nothing is saved at first');
    eq(api.followed(), [], 'H2: nothing is followed at first');
    ok(api.save('vgnf04').ok, 'H3: Save works');
    eq([api.followed().length, api.isSaved('vgnf04')], [0, true], 'H4: Save did not Follow');
    api.follow('nf');
    eq([api.isSaved('vgnf04'), api.isFollowed('nf')], [true, true], 'H5: Follow keeps the Save');
    eq(api.unfollow('nf').ok, true, 'H6: unfollowing succeeds');
    eq([api.isFollowed('nf'), api.isSaved('vgnf04')], [false, true],
      'H7: removing a Follow cannot reach a Save, and vice versa');
    ok(!('isFavorite' in api) && !('favorite' in api) && !('toggleFavorite' in api),
      'H8: the preview exposes no Favorite verb at all, so Save cannot imply one');
    const dup = api.save('vgnf04');
    eq([dup.ok, dup.already], [true, true], 'H9: re-Saving is a no-op, not a second row');
    eq(api.save('nope').code, 'publication-unavailable', 'H10: saving an unknown publication refuses');
    const filled = api.__preview.fillSaves(120);
    eq(filled.saved, mock.SAVE_CAP, 'H11: local Saves stop at the approved 100');
    const unsaved = (await api.list()).publications.filter(p => !api.isSaved(p.id));
    ok(unsaved.length > 0, 'H11b: at least one real publication is still unsavable');
    const capped = api.save(unsaved[0].id);
    ok(capped.ok === false && capped.code === 'save-capacity',
      'H12: at capacity a new Save is refused, never silently dropped in place of an older one');
    eq(api.saved().length, mock.SAVE_CAP, 'H13: nothing was evicted to make room');
    api.__preview.clearLocal();
    eq([api.saved().length, api.followed().length, (await api.list()).publications.length], [0, 0, 3],
      'H14: the reset removes the fillers and every local record, leaving the seeded catalogue');
  }

  /* ---- I. expiry never deletes a Save, and un-hide is expiry-aware ---- */
  {
    const api = fresh();
    api.save('vgso02');
    api.__preview.expire('vgso02');
    const list = api.saved();
    eq(list.length, 1, 'I1: the Save is still there after the publication expired');
    eq([list[0].available, !!list[0].publication], [false, true],
      'I2: it is presented as unavailable but its detail is kept for rendering');
    eq(list[0].publication.id, 'vgso02', 'I3: the saved row still points at the same publication id');
    eq((await api.get('vgso02')).kind, 'gone', 'I4: and the live read is gone, consistently');
    api.__preview.moderate('vgso02', 'hide');
    eq(api.__preview.unmoderate('vgso02').status, 'expired',
      'I5: un-hiding a hidden publication past its lifetime goes to expired, never active');
    const api2 = fresh();
    eq(api2.__preview.unmoderate('vgld09').status, 'active',
      'I6: an unexpired hidden publication can go back to active');
    eq([api2.__preview.unmoderate('vgpl06').ok, api2.__preview.unmoderate('vgld02').ok], [false, false],
      'I7: only a hidden row can be un-hidden; a removed tombstone and an expired row cannot');
    eq((await api2.get('vgpl06')).kind, 'gone',
      'I8: a removed tombstone is never revived by un-hide');
    api2.__preview.unmoderate('vgpl06');
    eq((await api2.get('vgpl06')).kind, 'gone', 'I9: and an attempted un-hide leaves it gone');
  }

  /* ---- J. persistence stays inside its own key and survives reload ---- */
  {
    const bag = memStorage();
    const one = mock.createApi({ storage: bag, latency: 0 });
    one.save('vgnf04'); one.follow('so');
    const pub = await one.publish({ capability: mock.makeCapability(), kind: 'episode', target: 'nf-05', note: 'kept' });
    const dumped = bag.dump();
    eq(Object.keys(dumped), ['void.publishPreview.v1'],
      'J1: the preview writes exactly one key and never touches the Podcast store keys');
    const two = mock.createApi({ storage: bag, latency: 0 });
    eq([two.isSaved('vgnf04'), two.isFollowed('so')], [true, true], 'J2: saves and follows reload');
    ok(two.mine().some(m => m.publication.id === pub.publication.id), 'J3: my publications reload with their capability');
    const corrupt = mock.createApi({ storage: memStorage({ 'void.publishPreview.v1': '{not json' }), latency: 0 });
    eq(corrupt.saved(), [], 'J4: corrupt storage degrades to defaults instead of throwing');
    const wrong = mock.createApi({ storage: memStorage({ 'void.publishPreview.v1': '{"saves":"nope","follows":null}' }), latency: 0 });
    eq([wrong.saved().length, wrong.followed().length], [0, 0], 'J5: wrong-typed fields degrade too');
    const hostile = memStorage();
    hostile.setItem = () => { throw new Error('quota'); };
    const blocked = mock.createApi({ storage: hostile, latency: 0 });
    ok(blocked.save('vgnf04').ok, 'J6: a throwing storage adapter cannot break the session');
  }

  /* ---- K. change listeners ---- */
  {
    const api = fresh();
    let hits = 0;
    const off = api.onChange(() => { hits++; });
    api.save('vgnf04');
    ok(hits >= 1, 'K1: a save notifies listeners');
    off();
    const before = hits;
    api.follow('pl');
    eq(hits, before, 'K2: an unsubscribed listener is not called again');
    const bad = api.onChange(null);
    eq(typeof bad, 'function', 'K3: onChange(null) returns a usable unsubscribe');
  }

  /* ---- L. a target handed over by the Podcast window, not a fixture ---- */
  {
    const api = fresh();
    const show = {
      feedUrl: 'https://real.example.com/feed/podcast.xml', showId: 'feed-abc123',
      title: 'A Real Show', titleFa: 'نمایش واقعی', publisher: 'Someone', initials: 'AR'
    };
    const ep = Object.assign({}, show, {
      guid: 'guid-777', title: 'A Real Episode', titleFa: 'اپیزود واقعی',
      durationSec: 1500, description: 'Real text from a real feed.'
    });
    const cap = mock.makeCapability();
    const r1 = await api.publish({ capability: cap, kind: 'show', target: show, note: 'The whole real show.' });
    ok(r1.ok && r1.publication.kind === 'show', 'L1: a real show can be published as a Show');
    eq(r1.publication.showTitle, 'A Real Show', 'L2: the show title comes through');
    ok(r1.publication.external === true, 'L3: the payload says this came from a subscription, not the sample catalogue');
    const r2 = await api.publish({ kind: 'episode', target: ep, note: 'One real episode.' });
    ok(r2.ok, 'L4: a real episode can be published as an Episode');
    const det = await api.get(r2.publication.id);
    eq(det.feedUrl, 'https://real.example.com/feed/podcast.xml', 'L5: the detail keeps the real feed address');
    eq(det.guid, 'guid-777', 'L6: the guid survives');
    eq(det.durationSec, 1500, 'L7: duration carried for the transport');
    ok(!/\.mp3/.test(JSON.stringify(det)), 'L8: still no audio URL anywhere in the payload');
    ok(api.follow('feed-abc123').ok, 'L9: a show published from a subscription is followable');
    ok(api.isFollowed('feed-abc123'), 'L10: the follow registered');
    const sh = api.showById('feed-abc123');
    eq(sh.title, 'A Real Show', 'L11: showById resolves an external show');
    eq(sh.external, true, 'L12: and marks it external');
    eq(mock.targetKey({ kind: 'show', feedUrl: show.feedUrl }).indexOf('show|') , 0, 'L13: show keys stay feed-only');
    const r3 = await api.publish({ kind: 'episode', target: { feedUrl: show.feedUrl, title: 'No guid' }, note: 'x' });
    eq([r3.ok, r3.code], [false, 'unknown-target'], 'L14: an episode target without a guid is refused');
    const r4 = await api.publish({ kind: 'show', target: { title: 'No feed' }, note: 'x' });
    eq([r4.ok, r4.code], [false, 'unknown-target'], 'L15: a target without a feed address is refused');
    /* republishing the same real thing is a duplicate, exactly as with a fixture */
    const r5 = await api.publish({ kind: 'show', target: show, note: 'again' });
    eq([r5.ok, r5.code, r5.publicationId], [false, 'duplicate', r1.publication.id], 'L16: Q6 duplicate rule holds for external targets');
  }

  /* ---- M. the preview files stay ES5 and free of the defective spike code ---- */
  {
    const files = fs.readdirSync(__dirname)
      .filter(f => /^podcast-publish-/.test(f) && /\.js$/.test(f) && !/\.test\.js$/.test(f));
    eq(files.slice().sort(), ['podcast-publish-loader.js', 'podcast-publish-mock.js',
      'podcast-publish-signals.js', 'podcast-publish-ui.js'], 'M0: all four preview modules are present');
    /* ES2015+ constructs that Chromium 70 rejects or that the TV build avoids. */
    const banned = [
      [/=>/, 'arrow function'],
      [/\bconst\s/, 'const'],
      [/\blet\s/, 'let'],
      [/`/, 'template literal'],
      [/\.\.\./, 'spread or rest'],
      [/\?\./, 'optional chaining'],
      [/\?\?/, 'nullish coalescing'],
      [/\bclass\s/, 'class'],
      [/\basync\s+function|\bawait\s/, 'async or await'],
      [/\bfor\s*\([^;]*\bof\b/, 'for..of'],
      [/\bfunction\s*[A-Za-z0-9_$]*\s*\([^)]*=[^)]*\)/, 'default parameter'],
      [/\bpadStart\b|\bpadEnd\b|\bflatMap\b|\bObject\.entries\b|\bObject\.fromEntries\b|\bObject\.values\b/, 'newer builtin']
    ];
    /* A typeof guard makes every globalThis on the same line Ch70-safe: that
       branch never evaluates on Chromium 70, whose parser sees only ES5. A use
       anywhere else is a defect. Stripping is per line so every other ban
       pattern still sees the rest of that line. */
    function stripGuarded(src) {
      return src.split('\n').map(function (line) {
        return /typeof\s+globalThis/.test(line) ? line.replace(/globalThis/g, '') : line;
      }).join('\n');
    }
    function codeOnly(src) {
      return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    }
    function es5Hits(src) {
      const body = stripGuarded(codeOnly(src));
      const hits = banned.filter(b => b[0].test(body)).map(b => b[1]);
      if (/globalThis/.test(body)) { hits.push('unguarded globalThis'); }
      return hits;
    }
    files.forEach(f => {
      const raw = fs.readFileSync(path.join(__dirname, f), 'utf8');
      const hits = es5Hits(raw);
      ok(hits.length === 0, 'M1: ' + f + ' is free of ES2015+ syntax' + (hits.length ? ' (found: ' + hits.join(', ') + ')' : ''));
    });
    /* The spike's two defective functions must not have travelled here. */
    /* The remaining guards are about executable code: a comment is allowed to
       name the thing the preview must never do, so comments are stripped. */
    const all = files.map(f => codeOnly(fs.readFileSync(path.join(__dirname, f), 'utf8'))).join('\n');
    ok(!/function\s+normIp\b/.test(all), 'M2: the defective normIp() was not copied into the preview');
    ok(!/function\s+pruneBuckets\b/.test(all), 'M3: the unbounded pruneBuckets() was not copied into the preview');
    /* Nothing in a frontend preview may reach the network or the real store. */
    ok(!/\bfetch\s*\(/.test(all), 'M4: no preview module calls fetch');
    ok(!/XMLHttpRequest/.test(all), 'M5: no preview module uses XHR');
    ok(!/void\.podcast\.(v1|saved\.v1)/.test(all), 'M6: the real Podcast storage keys are never named');
    ok(!/new\s+Audio\b|document\.createElement\(\s*['"]audio/.test(all), 'M7: the preview never builds an Audio element');
    ok(!/mediaSession/.test(all), 'M8: the preview never touches MediaSession');
    /* Controls: the detector must neither be inert nor cry wolf. */
    const dirty = 'const x = () => 1; let y = `a`; f(...g); a?.b; class C {} async function h(){} for (const k of s) {} Object.entries(o)';
    ok(banned.filter(b => b[0].test(dirty)).length >= 8, 'M9: the detector fires on real ES2015+ source');
    eq(es5Hits('var x = 1; function y(a, b) { if (typeof globalThis !== "undefined") { return globalThis && a + b; } return b; }').length, 0,
      'M10: a globalThis used on its guard line counts as guarded');
    ok(es5Hits('var g = globalThis; g.doThing();').indexOf('unguarded globalThis') >= 0,
      'M11: a bare globalThis on an unguarded line is still caught');
    ok(es5Hits('if (typeof globalThis !== "undefined") {\n  globalThis.foo();\n}').indexOf('unguarded globalThis') >= 0,
      'M12: a globalThis use on the line after the guard is caught, so the guarded form must stay on one line');
  }

  console.log('podcast-publish-mock: ' + checks + ' assertions passed');
  if (checks === 0) { process.exit(1); }
})().catch(function (err) {
  console.error('podcast-publish-mock FAILED: ' + (err && err.message));
  console.error('  after ' + checks + ' passing assertions');
  process.exit(1);
});
