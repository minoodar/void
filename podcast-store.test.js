/* podcast-store — Node tests: empty/corrupt storage, subscriptions, progress,
   queue, purity of helpers, listener isolation, throwing storage adapters. */
'use strict';
const assert = require('assert');
const store = require('./podcast-store.js');
const sample = require('./podcast-sample-data.js');

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

/* Empty storage -> defaults, nothing persisted yet. */
{
  const s = store.create(memStorage());
  eq(s.getState(), { subscriptions: [], progress: {}, queue: [], shows: {}, episodes: {}, opened: {}, rate: 1 }, 'empty: defaults');
  ok(!s.hasPersisted(), 'empty: nothing persisted');
  ok(s.getProgress('nf-01') === null, 'empty: no progress');
  ok(!s.isSubscribed('show-slow-orbit'), 'empty: not subscribed');
  eq(s.getQueue(), [], 'empty: empty queue');
}

/* Corrupt / hostile payloads degrade safely. */
[
  ['{oops', 'broken json'],
  ['null', 'null'],
  ['42', 'number'],
  ['"str"', 'string'],
  ['[]', 'array'],
  ['{"subscriptions":"nope","progress":7}', 'wrong types'],
  ['{"subscriptions":[1,null,"a","a",""],"progress":{"x":{"episodeId":"y"},"nf-01":{"episodeId":"nf-01","positionSec":-5,"completed":"yes","updatedAt":"x"},"nf-02":{"episodeId":"nf-02","positionSec":12.5,"completed":true,"updatedAt":99}}}', 'mixed garbage']
].forEach(([raw, name]) => {
  const st = store.parseState(raw);
  ok(Array.isArray(st.subscriptions) && st.progress && typeof st.progress === 'object', 'corrupt safe: ' + name);
});
{
  const st = store.parseState('{"subscriptions":[1,null,"a","a",""],"progress":{"x":{"episodeId":"y"},"nf-01":{"episodeId":"nf-01","positionSec":-5,"completed":"yes","updatedAt":"x"},"nf-02":{"episodeId":"nf-02","positionSec":12.5,"completed":true,"updatedAt":99}}}');
  eq(st.subscriptions, ['a'], 'sanitize: dedupe + strings only');
  ok(!st.progress.x, 'sanitize: mismatched episodeId dropped');
  eq(st.progress['nf-01'], { episodeId: 'nf-01', positionSec: 0, completed: false, updatedAt: 0 }, 'sanitize: bad fields defaulted');
  eq(st.progress['nf-02'], { episodeId: 'nf-02', positionSec: 12.5, completed: true, updatedAt: 99 }, 'sanitize: good entry kept');
}

/* Subscriptions persist and round-trip through a fresh store instance. */
{
  const mem = memStorage();
  const a = store.create(mem);
  a.subscribe('show-night-frequencies');
  a.subscribe('show-night-frequencies');
  a.subscribe('show-slow-orbit');
  eq(a.getState().subscriptions, ['show-night-frequencies', 'show-slow-orbit'], 'subscribe: dedupe, order kept');
  ok(a.hasPersisted(), 'subscribe: persisted');
  const b = store.create(mem);
  eq(b.getState().subscriptions, a.getState().subscriptions, 'round-trip: subscriptions restored');
  b.unsubscribe('show-night-frequencies');
  b.unsubscribe('show-night-frequencies');
  eq(b.getState().subscriptions, ['show-slow-orbit'], 'unsubscribe: idempotent');
  eq(store.create(mem).getState().subscriptions, ['show-slow-orbit'], 'round-trip: unsubscribe persisted');
}

/* Progress: clamping, completion, updatedAt, persistence, round-trip. */
{
  const mem = memStorage();
  const s = store.create(mem);
  const p = s.setProgress('nf-03', 1500, 3120);
  ok(p.positionSec === 1500 && !p.completed && p.updatedAt > 0, 'progress: mid-listen');
  ok(Math.abs(store.listenedFraction(p, 3120) - 1500 / 3120) < 1e-9, 'fraction: mid');
  const done = s.setProgress('nf-03', 99999, 3120);
  ok(done.positionSec === 3120 && done.completed, 'progress: clamped + completed');
  ok(store.listenedFraction(done, 3120) === 1, 'fraction: full');
  const neg = s.setProgress('nf-02', -40, 1980);
  ok(neg.positionSec === 0 && !neg.completed, 'progress: negative clamped to 0');
  ok(!store.isUnlistened(neg), 'started: a zero-position entry still counts as started');
  ok(store.isUnlistened(null), 'unlistened: no entry');
  ok(!store.isUnlistened(done), 'listened: completed entry');
  const restored = store.create(mem).getProgress('nf-03');
  ok(restored && restored.completed && restored.positionSec === 3120, 'round-trip: progress restored');
}

/* Completion rule: >=95% or the ended flag; just below 95% stays incomplete. */
{
  const s = store.create(memStorage());
  const below = s.setProgress('ep-a', 949, 1000);
  ok(!below.completed, 'completion: 94.9% not completed');
  const at = s.setProgress('ep-a', 950, 1000);
  ok(at.completed, 'completion: exactly 95% completed');
  const endedEarly = s.setProgress('ep-b', 120, 1000, true);
  ok(endedEarly.completed && endedEarly.positionSec === 120, 'completion: ended flag forces completed, keeps position');
  const zeroDur = s.setProgress('ep-c', 50, 0);
  ok(!zeroDur.completed, 'completion: unknown duration never auto-completes');
  ok(store.withProgress(store.defaultState(), 'ep-d', 10, 100, 5, false).progress['ep-d'].completed === false, 'completion: explicit false flag');
}

/* Queue: ids only, dedupe, order kept, persisted, corrupt-safe, pure. */
{
  const mem = memStorage();
  const s = store.create(mem);
  s.setQueue(['nf-04', 'nf-03', 'nf-04', '', 7, 'nf-02']);
  eq(s.getQueue(), ['nf-04', 'nf-03', 'nf-02'], 'queue: sanitize + dedupe + order');
  eq(store.create(mem).getQueue(), ['nf-04', 'nf-03', 'nf-02'], 'queue: round-trip');
  s.setQueue([]);
  eq(store.create(mem).getQueue(), [], 'queue: cleared persists');
  eq(store.parseState('{"queue":"nope"}').queue, [], 'queue: wrong type -> []');
  eq(store.parseState('{"queue":["a","a",null,"b"]}').queue, ['a', 'b'], 'queue: corrupt entries dropped');
  const base = store.defaultState();
  const q = store.withQueue(base, ['x', 'y']);
  eq(base.queue, [], 'queue: pure mutator');
  q.queue.push('z');
  eq(store.withQueue(q, ['x']).queue, ['x'], 'queue: copy isolated from later edits');
  const got = s.getQueue();
  got.push('intruder');
  eq(s.getQueue(), [], 'queue: getQueue returns a copy');
}

/* Pure helpers never mutate their input. */
{
  const base = store.defaultState();
  const snap = JSON.stringify(base);
  const a = store.withSubscription(base, 'show-x', true);
  const b = store.withProgress(a, 'ep-1', 10, 100, 123);
  const c = store.withSubscription(b, 'show-x', false);
  eq(JSON.stringify(base), snap, 'purity: input untouched');
  ok(a.subscriptions.length === 1 && b.progress['ep-1'].positionSec === 10 && c.subscriptions.length === 0, 'purity: chain works');
  ok(a.progress['ep-1'] === undefined, 'purity: earlier states unaffected');
  eq(store.withProgress(base, 'ep-2', NaN, 100, 5).progress['ep-2'].positionSec, 0, 'purity: NaN position -> 0');
}

/* Listeners: notified on change, removable, isolated from throws. */
{
  const s = store.create(memStorage());
  let hits = 0;
  const off = s.onChange(() => { hits++; });
  s.onChange(() => { throw new Error('bad listener'); });
  s.subscribe('show-paper-lanterns');
  s.setProgress('pl-01', 5, 1560);
  ok(hits === 2, 'listeners: notified despite throwing sibling');
  off();
  s.unsubscribe('show-paper-lanterns');
  ok(hits === 2, 'listeners: removal works');
}

/* Throwing storage adapter: never crashes, stays usable in memory. */
{
  const hostile = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
  const s = store.create(hostile);
  eq(s.getState(), store.defaultState(), 'hostile: defaults');
  ok(!s.hasPersisted(), 'hostile: hasPersisted false');
  s.subscribe('show-slow-orbit');
  s.setProgress('so-01', 100, 2100);
  ok(s.isSubscribed('show-slow-orbit') && s.getProgress('so-01').positionSec === 100, 'hostile: in-memory state still works');
}

/* Sample catalogue integrity (shapes the window relies on). */
{
  ok(sample.SHOWS.length === 3, 'sample: 3 shows');
  sample.SHOWS.forEach(sh => {
    const eps = sample.episodesOf(sh.id);
    ok(eps.length >= 4 && eps.length <= 5, 'sample: 4-5 episodes for ' + sh.id);
    eps.forEach(e => {
      ok(e.showId === sh.id && typeof e.title === 'string' && e.audioUrl === '' && e.durationSec > 0 &&
        typeof e.description === 'string' && !isNaN(Date.parse(e.publishedAt)), 'sample: episode shape ' + e.id);
    });
    ok(eps[0].publishedAt >= eps[eps.length - 1].publishedAt, 'sample: newest first ' + sh.id);
  });
  const latest = sample.latest(8);
  ok(latest.length === 8 && latest[0].publishedAt >= latest[7].publishedAt, 'sample: latest sorted desc');
  ok(sample.showById('show-slow-orbit').publisher === 'Deep Field Media', 'sample: showById');
  ok(sample.showById('nope') === null, 'sample: unknown id -> null');
  const chaptered = sample.EPISODES.filter(e => Array.isArray(e.chapters) && e.chapters.length > 0);
  ok(chaptered.length === 1, 'sample: exactly one episode carries chapters');
  const ch = chaptered[0].chapters;
  ok(ch[0].startSec === 0, 'sample: chapters start at 0');
  for (let i = 1; i < ch.length; i++) {
    ok(ch[i].startSec > ch[i - 1].startSec && ch[i].startSec < chaptered[0].durationSec &&
      typeof ch[i].title === 'string' && ch[i].title.length > 0, 'sample: chapter order/bounds ' + i);
  }
}

/* ---- Stage 3A: show metadata + cached episodes ---- */
{
  const mem = memStorage();
  const s = store.create(mem);
  const show = { id: 'feed-abc', title: 'Real Show', titleFa: '', publisher: 'Pub', feedUrl: 'https://f.example.com/x.xml', artUrl: '', initials: 'RS' };
  const eps = [
    { id: 'ep-1', guid: 'g1', title: 'One', publishedAt: '2026-11-01T00:00:00.000Z', durationSec: 600, audioUrl: 'https://cdn.example.com/1.mp3', audioType: 'audio/mpeg', description: 'd'.repeat(900) },
    { id: 'ep-2', guid: 'g2', title: 'Two', publishedAt: '2026-11-02T00:00:00.000Z', durationSec: 700, audioUrl: 'https://cdn.example.com/2.mp3', audioType: 'audio/mpeg', description: 'ok' }
  ];
  s.registerShow(show, eps);
  s.subscribe('feed-abc');
  ok(s.getShow('feed-abc').title === 'Real Show', 'show: registered');
  ok(s.getEpisodes('feed-abc').length === 2, 'show: episodes cached');
  ok(s.getEpisodes('feed-abc')[0].description.length <= store.DESC_CAP, 'show: description capped at 600');
  const restored = store.create(mem);
  ok(restored.getShow('feed-abc').feedUrl === show.feedUrl, 'show: round-trip');
  ok(restored.getEpisodes('feed-abc').length === 2, 'show: episodes round-trip');
  ok(restored.isSubscribed('feed-abc'), 'show: subscription round-trip');
  const got = restored.getEpisodes('feed-abc');
  got.push({ id: 'intruder' });
  ok(restored.getEpisodes('feed-abc').length === 2, 'show: getEpisodes returns a copy');
  /* old payloads without the new fields still parse */
  const legacy = store.parseState('{"subscriptions":["show-x"],"progress":{},"queue":[]}');
  eq(legacy.shows, {}, 'legacy: shows default');
  eq(legacy.episodes, {}, 'legacy: episodes default');
  eq(legacy.opened, {}, 'legacy: opened default');
  /* hostile metadata degrades */
  const hostileMeta = store.parseState('{"shows":{"a":"nope","b":{"title":"T"}},"episodes":{"b":[null,{"id":"e","title":"E"},"x"],"c":"nope"},"opened":{"b":"soon"}}');
  ok(!hostileMeta.shows.a, 'meta: non-object show dropped');
  ok(hostileMeta.shows.b && hostileMeta.shows.b.title === 'T', 'meta: partial show sanitized');
  ok(hostileMeta.episodes.b.length === 1 && hostileMeta.episodes.b[0].id === 'e', 'meta: bad episodes dropped');
  ok(!hostileMeta.episodes.c, 'meta: non-array episodes dropped');
  ok(hostileMeta.opened.b === 0, 'meta: non-number opened -> 0');
  /* episode cap on parse */
  let many = '{"episodes":{"s":[';
  for (let i = 0; i < 150; i++) { many += (i ? ',' : '') + '{"id":"e' + i + '","title":"E"}'; }
  many += ']}}';
  ok(store.parseState(many).episodes.s.length === store.EPISODE_CAP, 'meta: episodes capped at 100 on parse');
}

/* ---- Stage 3A amendment: saved snapshots are self-contained + separate key ---- */
{
  const mem = memStorage();
  const s = store.create(mem);
  const snap = {
    id: 'ep-1', guid: 'g1', showId: 'feed-abc', title: 'One', showTitle: 'Real Show',
    showFeedUrl: 'https://f.example.com/x.xml', audioUrl: 'https://cdn.example.com/1.mp3',
    audioType: 'audio/mpeg', durationSec: 600, publishedAt: '2026-11-01T00:00:00.000Z',
    artUrl: '', description: 'desc'
  };
  s.registerShow({ id: 'feed-abc', title: 'Real Show', feedUrl: snap.showFeedUrl }, [{ id: 'ep-1', title: 'One', audioUrl: snap.audioUrl, durationSec: 600 }]);
  s.subscribe('feed-abc');
  s.setProgress('ep-1', 120, 600);
  s.setQueue(['ep-1']);
  s.saveEpisode(snap);
  ok(s.isSaved('ep-1'), 'saved: isSaved');
  ok(mem.dump()[store.SAVED_KEY], 'saved: persisted under separate key');
  ok(!mem.dump()[store.KEY].includes('"saved"'), 'saved: not inside the main key');
  const restored = store.create(mem);
  ok(restored.isSaved('ep-1'), 'saved: round-trip');
  ok(restored.getSaved()[0].audioUrl === snap.audioUrl, 'saved: snapshot self-contained');
  /* unsubscribe must NEVER delete saved episodes or their progress */
  restored.unsubscribe('feed-abc');
  ok(!restored.isSubscribed('feed-abc'), 'unsub: subscription gone');
  ok(!restored.getShow('feed-abc'), 'unsub: show meta gone');
  ok(restored.getEpisodes('feed-abc').length === 0, 'unsub: cached episodes gone');
  eq(restored.getQueue(), [], 'unsub: queue ids of the show removed');
  ok(restored.isSaved('ep-1'), 'unsub: saved snapshot kept');
  ok(restored.getProgress('ep-1').positionSec === 120, 'unsub: progress kept');
  ok(store.create(mem).isSaved('ep-1'), 'unsub: saved kept on disk');
  /* dedupe by id replaces; removal is explicit only */
  const s2 = store.create(mem);
  s2.saveEpisode(Object.assign({}, snap, { title: 'Renamed' }));
  ok(s2.getSaved().length === 1 && s2.getSaved()[0].title === 'Renamed', 'saved: same id replaces');
  s2.removeSaved('ep-1');
  ok(!s2.isSaved('ep-1') && !store.create(mem).isSaved('ep-1'), 'saved: explicit removal persists');
  /* corrupt saved payloads degrade */
  eq(store.parseSaved('{oops').saved, [], 'saved: corrupt -> empty');
  eq(store.parseSaved('[null,{"id":"x"},{"id":"y","audioUrl":"https://a.example.com/x.mp3"}]').saved.length, 1, 'saved: entries without audio dropped');
  eq(store.parseSaved('{"saved":[{"id":"a","audioUrl":"https://a.example.com/a.mp3"},{"id":"a","audioUrl":"https://a.example.com/a.mp3"}]}').saved.length, 1, 'saved: duplicate ids collapse');
}

/* ---- Stage 3A: progress hygiene (cap 500, 90-day prune, saved/in-progress kept) ---- */
{
  const now = 1000000000000;
  const day = 86400000;
  const progress = {
    oldSaved: { episodeId: 'oldSaved', positionSec: 10, completed: true, updatedAt: now - 200 * day },
    oldActive: { episodeId: 'oldActive', positionSec: 10, completed: false, updatedAt: now - 200 * day },
    oldDone: { episodeId: 'oldDone', positionSec: 10, completed: true, updatedAt: now - 200 * day },
    fresh: { episodeId: 'fresh', positionSec: 0, completed: false, updatedAt: now - day }
  };
  const pruned = store.pruneProgress(progress, ['oldSaved'], now);
  ok(pruned.oldSaved, 'prune: saved kept despite age');
  ok(pruned.oldActive, 'prune: in-progress kept despite age');
  ok(!pruned.oldDone, 'prune: old completed dropped');
  ok(pruned.fresh, 'prune: fresh kept');
  ok(progress.oldDone, 'prune: pure');
  const big = {};
  for (let i = 0; i < 600; i++) { big['e' + i] = { episodeId: 'e' + i, positionSec: 1, completed: false, updatedAt: now - i * 1000 }; }
  const capped = store.pruneProgress(big, [], now);
  ok(Object.keys(capped).length === store.PROGRESS_CAP, 'prune: capped at 500');
  ok(capped.e0 && capped.e499 && !capped.e500, 'prune: newest kept');
  /* setProgress applies the prune live */
  const s = store.create(memStorage());
  const old = store.withProgress(store.defaultState(), 'ancient', 5, 100, now - 200 * day, true);
  ok(!s.getProgress('ancient'), 'prune: absent before');
  const mem2 = memStorage({ [store.KEY]: JSON.stringify(old) });
  const s2 = store.create(mem2);
  ok(!s2.getProgress('ancient'), 'prune: old completed dropped on load');
}

/* ---- Stage 3A: opened markers + fetch meta ---- */
{
  const s = store.create(memStorage());
  s.registerShow({ id: 'feed-x', title: 'X', feedUrl: 'https://x.example.com/f' }, []);
  s.markOpened('feed-x');
  ok(s.getState().opened['feed-x'] > 0, 'opened: timestamp written');
  s.setFetchMeta('feed-x', { lastFetchedAt: 123, etag: '"e"', lastModified: 'lm' });
  const sh = s.getShow('feed-x');
  ok(sh.lastFetchedAt === 123 && sh.etag === '"e"' && sh.lastModified === 'lm', 'fetchMeta: stored');
  s.setFetchMeta('missing', { lastFetchedAt: 1 });
  ok(!s.getShow('missing'), 'fetchMeta: unknown show ignored');
}

/* ---- Stage 3A: quota fallbacks — cached lists first, saved never dropped ---- */
{
  const disk = new Map();
  const quotaStorage = {
    getItem: k => (disk.has(k) ? disk.get(k) : null),
    setItem: (k, v) => {
      if (k === store.KEY && String(v).length > 2000) { const e = new Error('quota exceeded'); e.name = 'QuotaExceededError'; throw e; }
      disk.set(k, String(v));
    }
  };
  const s = store.create(quotaStorage);
  s.saveEpisode({ id: 'ep-q', audioUrl: 'https://a.example.com/q.mp3', title: 'Q' });
  const bigEps = [];
  for (let i = 0; i < 40; i++) { bigEps.push({ id: 'e' + i, title: 'T'.repeat(50), audioUrl: 'https://a.example.com/' + i + '.mp3', description: 'd'.repeat(600) }); }
  s.registerShow({ id: 'feed-q', title: 'Q', feedUrl: 'https://q.example.com/f' }, bigEps);
  s.subscribe('feed-q');
  ok(s.isSubscribed('feed-q'), 'quota: subscription survives in memory');
  ok(s.isSaved('ep-q'), 'quota: saved survives');
  ok(disk.has(store.SAVED_KEY), 'quota: saved key persisted');
  ok(!disk.get(store.KEY).includes('"episodes":{"feed-q":[{"id"'), 'quota: cached lists dropped from persisted main key');
  /* saved-key quota: existing saved bytes on disk stay intact */
  const disk2 = new Map([[store.SAVED_KEY, '{"saved":[{"id":"old","audioUrl":"https://a.example.com/old.mp3"}]}']]);
  const savedQuota = {
    getItem: k => (disk2.has(k) ? disk2.get(k) : null),
    setItem: (k, v) => { if (k === store.SAVED_KEY) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } disk2.set(k, String(v)); }
  };
  const s2 = store.create(savedQuota);
  s2.saveEpisode({ id: 'new', audioUrl: 'https://a.example.com/new.mp3' });
  ok(s2.isSaved('old') && s2.isSaved('new'), 'quota: saved kept in memory');
  ok(disk2.get(store.SAVED_KEY).includes('"old"') && !disk2.get(store.SAVED_KEY).includes('"new"'), 'quota: existing saved bytes untouched');
}

/* ---- Stage 3A: exportPayload — one versioned JSON (future Void Key) ---- */
{
  const mem = memStorage();
  const s = store.create(mem);
  s.registerShow({ id: 'feed-z', title: 'Z', feedUrl: 'https://z.example.com/f' }, [{ id: 'ep-z', title: 'Z1', audioUrl: 'https://a.example.com/z.mp3', durationSec: 100 }]);
  s.subscribe('feed-z');
  s.setProgress('ep-z', 30, 100);
  s.saveEpisode({ id: 'ep-z', audioUrl: 'https://a.example.com/z.mp3', title: 'Z1', showTitle: 'Z', showFeedUrl: 'https://z.example.com/f' });
  s.setQueue(['ep-z']);
  const payload = s.exportPayload();
  ok(payload.schemaVersion === 1, 'export: schemaVersion 1');
  ok(typeof payload.exportedAt === 'string' && !isNaN(Date.parse(payload.exportedAt)), 'export: exportedAt ISO');
  eq(payload.subscriptions, ['feed-z'], 'export: subscriptions');
  ok(payload.saved.length === 1 && payload.progress['ep-z'].positionSec === 30, 'export: saved + progress');
  const back = store.parseState(JSON.stringify(payload));
  eq(back.subscriptions, ['feed-z'], 'export: main state round-trips');
  ok(back.progress['ep-z'].positionSec === 30, 'export: progress round-trips');
  eq(store.parseSaved(JSON.stringify(payload.saved)).saved.length, 1, 'export: saved round-trips');
  const copy = s.exportPayload();
  copy.subscriptions.push('intruder');
  eq(s.getState().subscriptions, ['feed-z'], 'export: payload is a copy');
}

/* ---- Stage 3A: purity of the new mutators ---- */
{
  const base = store.defaultState();
  const snap = JSON.stringify(base);
  const a = store.withShow(base, { id: 's1', title: 'S' });
  const b = store.withEpisodes(a, 's1', [{ id: 'e1', title: 'E', audioUrl: 'https://a.example.com/e.mp3' }]);
  const c = store.withOpened(b, 's1', 5);
  const d = store.withFetchMeta(c, 's1', { lastFetchedAt: 9 });
  const e = store.withoutShow(d, 's1');
  eq(JSON.stringify(base), snap, 'purity: base untouched');
  ok(a.shows.s1 && b.episodes.s1.length === 1 && c.opened.s1 === 5 && d.shows.s1.lastFetchedAt === 9, 'purity: chain builds');
  ok(!e.shows.s1 && !e.episodes.s1 && !e.opened.s1, 'purity: withoutShow clears');
  ok(d.episodes.s1.length === 1, 'purity: earlier state unaffected');
  const sv = { saved: [] };
  const svSnap = JSON.stringify(sv);
  const s1 = store.withSaved(sv, { id: 'x', audioUrl: 'https://a.example.com/x.mp3' });
  const s2 = store.withoutSaved(s1, 'x');
  eq(JSON.stringify(sv), svSnap, 'purity: saved base untouched');
  ok(s1.saved.length === 1 && s2.saved.length === 0, 'purity: saved chain');
  ok(store.withSaved(sv, { id: 'no-audio' }).saved.length === 0, 'purity: invalid snapshot ignored');
}

/* ---- Phase 2B §B: schema versioning, migration, rate, resolvedFeedUrl ---- */
{
  ok(store.SCHEMA_VERSION === 2, '2B: current schema version is 2');

  const v1 = {
    subscriptions: ['feed-aaa'],
    progress: { 'ep-1': { episodeId: 'ep-1', positionSec: 42, completed: false, updatedAt: 1000 } },
    queue: ['ep-1'],
    shows: { 'feed-aaa': { id: 'feed-aaa', title: 'V1 Show', feedUrl: 'https://v1.example.com/f.xml', addedAt: 5 } },
    episodes: { 'feed-aaa': [{ id: 'ep-1', showId: 'feed-aaa', title: 'Ep', guid: 'g1', audioUrl: 'https://cdn.example.com/a.mp3' }] },
    opened: { 'feed-aaa': 99 }
  };

  const m = store.migratePayload(JSON.parse(JSON.stringify(v1)));
  ok(m.from === 1 && m.to === 2 && m.changed === true, '2B: v1 payload migrates 1->2');
  eq(m.state.rate, 1, '2B: migration gives rate a default');

  const s2 = store.parseState(m.state);
  ok(s2.shows['feed-aaa'].resolvedFeedUrl === '', '2B: sanitize keeps resolvedFeedUrl field present');
  eq(s2.rate, 1, '2B: parsed migrated state carries rate');
  eq(s2.subscriptions, ['feed-aaa'], '2B: migration preserves subscriptions');
  eq(s2.progress['ep-1'].positionSec, 42, '2B: migration preserves progress');
  eq(s2.queue, ['ep-1'], '2B: migration preserves queue');
  eq(s2.opened['feed-aaa'], 99, '2B: migration preserves opened');
  eq(s2.shows['feed-aaa'].title, 'V1 Show', '2B: migration preserves show metadata');
  eq(s2.episodes['feed-aaa'].length, 1, '2B: migration preserves cached episodes');

  const again = store.migratePayload(m.state);
  ok(again.changed === false && again.from === 2, '2B: migration is idempotent on v2 payload');

  const future = store.migratePayload({ v: 9, subscriptions: ['feed-zzz'], shows: {}, episodes: {}, opened: {}, progress: {}, queue: [] });
  ok(future.future === true && future.state.subscriptions[0] === 'feed-zzz', '2B: future payload passes through untouched');

  ok(store.parseState('not json').rate === 1, '2B: corrupt payload degrades with rate default');
  ok(store.parseState({ v: 'x', rate: 1.5 }).rate === 1.5, '2B: parseState accepts objects (migration path)');

  // round trip through a real adapter: v1 payload stored raw -> create() migrates -> persisted payload is v2
  const st = memStorage({ 'void.podcast.v1': JSON.stringify(v1) });
  const s = store.create(st);
  ok(s.getShow('feed-aaa').title === 'V1 Show', '2B: create migrates a stored v1 payload');
  s.setRate(1.5);
  const persisted = JSON.parse(st.dump()['void.podcast.v1']);
  ok(persisted.v === 2, '2B: persisted payload is marked v2');
  eq(persisted.rate, 1.5, '2B: rate persists');
  ok(s.getRate() === 1.5, '2B: getRate returns persisted value');

  const sFresh = store.create(memStorage());
  ok(sFresh.getRate() === 1, '2B: fresh install starts at rate 1');
  sFresh.setRate(9);
  ok(sFresh.getRate() === 4, '2B: rate clamps to the sane range');
  sFresh.setRate(0);
  ok(sFresh.getRate() === 0.25, '2B: rate clamps low');
  sFresh.setRate('x');
  ok(sFresh.getRate() === 1, '2B: garbage rate falls back to 1');

  const sNoStore = store.create(null);
  ok(sNoStore.setRate(2) === 2, '2B: rate works without persistent storage');

  // resolvedFeedUrl survives registerShow + persistence
  const s2b = store.create(memStorage());
  s2b.registerShow({ id: 'feed-r', title: 'R', feedUrl: 'https://r.example.com/f.xml', resolvedFeedUrl: 'https://r.example.com/canonical.xml' }, []);
  ok(s2b.getShow('feed-r').resolvedFeedUrl === 'https://r.example.com/canonical.xml', '2B: registerShow keeps resolvedFeedUrl');
  // setFetchMeta round trip (now wired by the window)
  const s3 = store.create(memStorage());
  s3.registerShow({ id: 'feed-m', title: 'M', feedUrl: 'https://m.example.com/f.xml' }, []);
  s3.setFetchMeta('feed-m', { lastFetchedAt: 1234, etag: '"e1"', lastModified: 'Tue, 04 Nov 2026' });
  ok(s3.getShow('feed-m').lastFetchedAt === 1234, '2B: setFetchMeta keeps lastFetchedAt');
  ok(s3.getShow('feed-m').etag === '"e1"', '2B: setFetchMeta keeps etag');
  ok(s3.getShow('feed-m').lastModified === 'Tue, 04 Nov 2026', '2B: setFetchMeta keeps lastModified');

  const ex = store.create(memStorage());
  ex.registerShow({ id: 'feed-x', title: 'X', feedUrl: 'https://x.example.com/f.xml', resolvedFeedUrl: 'https://x.example.com/c.xml' }, []);
  const payload = ex.exportPayload();
  ok(payload.schemaVersion === 1, '2B: export contract stays schemaVersion 1');
  eq(payload.rate, 1, '2B: export includes rate');
  eq(payload.shows['feed-x'].resolvedFeedUrl, 'https://x.example.com/c.xml', '2B: export includes resolvedFeedUrl');
}

/* ---- Phase 2B.1 §4: v1->v2 migration preserves the separate saved key ---- */
{
  const v1 = {
    subscriptions: ['feed-aaa'],
    progress: { 'ep-1': { episodeId: 'ep-1', positionSec: 42, completed: false, updatedAt: 1000 } },
    queue: ['ep-1'],
    shows: { 'feed-aaa': { id: 'feed-aaa', title: 'V1 Show', feedUrl: 'https://v1.example.com/f.xml', addedAt: 5 } },
    episodes: { 'feed-aaa': [{ id: 'ep-1', showId: 'feed-aaa', title: 'Ep', guid: 'g1', audioUrl: 'https://cdn.example.com/a.mp3' }] },
    opened: { 'feed-aaa': 99 }
  };
  const savedRaw = JSON.stringify([{
    id: 'ep-s', guid: 'gs', showId: 'feed-s', title: 'Saved One', showTitle: 'S Show',
    showFeedUrl: 'https://s.example.com/f.xml', audioUrl: 'https://cdn.example.com/s.mp3',
    audioType: 'audio/mpeg', durationSec: 300, publishedAt: '2026-11-01T00:00:00.000Z',
    artUrl: '', description: ''
  }]);
  const mem = memStorage({
    'void.podcast.v1': JSON.stringify(v1),
    [store.SAVED_KEY]: savedRaw
  });
  const s = store.create(mem);
  ok(s.getShow('feed-aaa').title === 'V1 Show', 'saved-migration: v1 payload migrated in memory');
  s.setRate(1.5);   // first mutation persists the migrated payload (same flow as the 2B round-trip test)
  ok(JSON.parse(mem.dump()[store.KEY]).v === 2, 'saved-migration: main payload migrated to v2');
  eq(mem.dump()[store.SAVED_KEY], savedRaw, 'saved-migration: saved key bytes untouched by the migration write');
  ok(s.isSaved('ep-s'), 'saved-migration: saved episode readable through the migrated store');
  eq(s.getSaved()[0].audioUrl, 'https://cdn.example.com/s.mp3', 'saved-migration: snapshot intact');
  ok(store.create(mem).isSaved('ep-s'), 'saved-migration: saved survives a re-open');
  ok(s.getShow('feed-aaa').title === 'V1 Show', 'saved-migration: migrated main state still intact alongside');
}

/* M4 (Phase 2B.3) — itunes:season / itunes:episode are additive store fields:
   persisted as sanitized non-negative integers, never invented, and absent keys
   in a pre-2B.3 payload still load as 0. */
{
  const mem = memStorage();
  const s = store.create(mem);
  const show = { id: 'feed-sea', title: 'Numbered', feedUrl: 'https://n.example.com/f.xml' };
  s.registerShow(show, [
    { id: 'n1', title: 'Both', seasonNum: 3, episodeNum: 12 },
    { id: 'n2', title: 'Strings', seasonNum: '7', episodeNum: '-4' },
    { id: 'n3', title: 'Fraction', seasonNum: 2.9, episodeNum: NaN },
    { id: 'n4', title: 'Negative', seasonNum: -1, episodeNum: null }
  ]);
  const eps = s.getEpisodes('feed-sea');
  eq(eps[0].seasonNum, 3, 'M4: season persisted');
  eq(eps[0].episodeNum, 12, 'M4: episode number persisted');
  eq(eps[1].seasonNum, 0, 'M4: numeric string is not a number -> 0');
  eq(eps[1].episodeNum, 0, 'M4: negative string -> 0');
  eq(eps[2].seasonNum, 2, 'M4: fractional season floored');
  eq(eps[2].episodeNum, 0, 'M4: NaN episode -> 0');
  eq(eps[3].seasonNum, 0, 'M4: negative season never stored');
  eq(eps[3].episodeNum, 0, 'M4: null episode -> 0');
  const reboot = store.create(mem);
  const back = reboot.getEpisodes('feed-sea');
  eq(back[0].seasonNum, 3, 'M4: season survives a reload');
  eq(back[0].episodeNum, 12, 'M4: episode number survives a reload');
  eq(back[1].seasonNum, 0, 'M4: sanitized values stay sanitized after reload');
  const legacy = store.parseState('{"episodes":{"old":[{"id":"o1","title":"Old","durationSec":600}]}}');
  eq(legacy.episodes.old[0].seasonNum, 0, 'M4: legacy payload -> season 0');
  eq(legacy.episodes.old[0].episodeNum, 0, 'M4: legacy payload -> episode 0');
  eq(legacy.episodes.old[0].durationSec, 600, 'M4: legacy fields untouched');
}

console.log('podcast-store: ' + checks + ' assertions passed');
