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
  eq(s.getState(), { subscriptions: [], progress: {}, queue: [] }, 'empty: defaults');
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

console.log('podcast-store: ' + checks + ' assertions passed');