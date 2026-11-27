import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Store = require('./podcast-store.js');
const WIN = readFileSync(new URL('./podcast-window.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const NOW = 1_800_000_000_000;
const FEED = 'https://feeds.example.test/show.xml';
const oldEpisode = {
  id: 'episode-1', guid: 'guid-1', title: 'Saved episode', publishedAt: '2026-11-01T00:00:00.000Z',
  durationSec: 600, audioUrl: 'https://cdn.example.test/episode.mp3', audioType: 'audio/mpeg', description: 'old'
};

function sourceFunction(name) {
  const start = WIN.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, `${name} exists`);
  let open = WIN.indexOf('{', WIN.indexOf(')', start)), depth = 0, end = open;
  for (; end < WIN.length; end++) {
    if (WIN[end] === '{') depth++;
    else if (WIN[end] === '}' && --depth === 0) break;
  }
  assert.equal(depth, 0, `${name} closes`);
  return WIN.slice(start, end + 1);
}

function setup({ siteUrl = null, siteUrlCheckedAt = 0, lastFetchedAt = NOW - 1000 } = {}, addFeed) {
  const data = new Map();
  const storage = {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value))
  };
  const store = Store.create(storage);
  store.registerShow({
    id: 'other', title: 'Other', feedUrl: '', addedAt: 10
  }, []);
  store.registerShow({
    id: 'show-1', title: 'Before refresh', publisher: 'Publisher', feedUrl: FEED,
    siteUrl, siteUrlCheckedAt, addedAt: 123, lastFetchedAt, etag: 'old-etag', lastModified: 'old-date'
  }, [oldEpisode]);
  store.subscribe('other');
  store.subscribe('show-1');
  store.setProgress('episode-1', 42, 600, false);
  store.setQueue(['episode-1']);
  store.saveEpisode({ id: 'episode-1', showId: 'show-1', title: 'Saved episode', audioUrl: oldEpisode.audioUrl, savedAt: 10 });

  const calls = [];
  const context = vm.createContext({
    store,
    REFRESH_MS: 30 * 60 * 1000,
    FETCH_TIMEOUT_MS: 15000,
    DEFAULT_WORKER: 'https://worker.example.test',
    Date: { now: () => NOW },
    window: { VoidPodcastDevConfig: null },
    AbortController: undefined,
    setTimeout: () => 1,
    clearTimeout: () => {},
    fetch: () => Promise.reject(new Error('unexpected fetch')),
    encodeURIComponent,
    Feed: { safeFeedUrl: () => '', parseFeed: () => { throw new Error('unexpected parse'); } },
    catalogSet: () => {},
    addFeed: (url) => { calls.push(url); return addFeed(url); }
  });
  vm.runInContext(`var refreshing = false;\n${sourceFunction('adoptFeed')}\n${sourceFunction('refreshFeeds')}`, context);
  return { store, storage, calls, context, refresh: () => vm.runInContext('refreshFeeds()', context) };
}

function result(siteUrl) {
  return {
    show: { id: 'show-1', title: 'After refresh', publisher: 'Publisher', feedUrl: FEED, siteUrl, artUrl: '', initials: 'AR' },
    episodes: [oldEpisode],
    fetchedMeta: { etag: 'new-etag', lastModified: 'new-date' }
  };
}

async function drain() { await new Promise((resolve) => setImmediate(resolve)); }

test('an old subscribed record bypasses the 30-minute timer and successful RSS discovery persists siteUrl', async () => {
  const h = setup({}, () => Promise.resolve(result('https://rss.com/shows/show-1')));
  const before = JSON.parse(JSON.stringify(h.store.getState()));
  const savedBefore = JSON.stringify(h.store.getSaved());
  h.refresh();
  assert.deepEqual(h.calls, [FEED]);
  await drain();
  assert.equal(h.store.getShow('show-1').siteUrl, 'https://rss.com/shows/show-1');
  assert.equal(h.store.getShow('show-1').siteUrlCheckedAt, NOW);
  const after = h.store.getState();
  assert.deepEqual(after.episodes, before.episodes, 'the complete cached episode collection and order are unchanged');
  assert.deepEqual(after.subscriptions, before.subscriptions, 'subscription IDs and order are unchanged');
  assert.deepEqual(after.progress, before.progress, 'playback progress is unchanged');
  assert.deepEqual(after.queue, before.queue, 'queue data is unchanged');
  assert.equal(JSON.stringify(h.store.getSaved()), savedBefore, 'bookmark snapshots are unchanged');
  for (const field of ['title', 'publisher', 'feedUrl', 'addedAt', 'lastFetchedAt', 'etag', 'lastModified']) {
    assert.equal(after.shows['show-1'][field], before.shows['show-1'][field], `${field} is unchanged`);
  }
  assert.deepEqual(Store.create(h.storage).getState(), after, 'the homepage-only update is persisted without data loss');
});

test('a successful feed with no usable homepage is checked once', async () => {
  const h = setup({}, () => Promise.resolve(result(null)));
  h.refresh();
  await drain();
  assert.equal(h.store.getShow('show-1').siteUrl, null);
  assert.equal(h.store.getShow('show-1').siteUrlCheckedAt, NOW);
  assert.equal(h.store.getShow('show-1').lastFetchedAt, NOW - 1000, 'homepage lookup does not advance the episode refresh timer');
  assert.equal(h.store.getShow('show-1').etag, 'old-etag');
  assert.equal(h.store.getShow('show-1').lastModified, 'old-date');
  h.refresh();
  assert.deepEqual(h.calls, [FEED], 'checked empty result is not fetched just for homepage discovery again');
});

test('a transient failure leaves discovery unchecked and the next library refresh retries', async () => {
  const h = setup({}, () => Promise.reject(new Error('offline')));
  h.refresh();
  await drain();
  assert.equal(h.store.getShow('show-1').siteUrlCheckedAt, 0);
  h.refresh();
  assert.deepEqual(h.calls, [FEED, FEED]);
  await drain();
  assert.equal(h.store.isSubscribed('show-1'), true);
  assert.deepEqual(h.store.getEpisodes('show-1').map((ep) => ep.id), ['episode-1']);
});

test('a show with a valid siteUrl is not force-fetched before its ordinary refresh is due', () => {
  const h = setup({ siteUrl: 'https://publisher.example.test/show', siteUrlCheckedAt: 0 }, () => Promise.resolve(result(null)));
  h.refresh();
  assert.deepEqual(h.calls, []);
});

test('unsafe homepage data is rejected by the store and cannot activate header links', async () => {
  const h = setup({}, () => Promise.resolve(result('javascript:alert(1)')));
  h.refresh();
  await drain();
  assert.equal(h.store.getShow('show-1').siteUrl, null);
  assert.equal(h.store.getShow('show-1').siteUrlCheckedAt, NOW);
  assert.match(WIN, /if \(!siteUrl \|\| isTV\(\)\) \{ return; \}/);
});

test('successful refresh keeps an existing valid siteUrl if the feed omits a homepage link', async () => {
  const h = setup({ siteUrl: 'https://publisher.example.test/show', siteUrlCheckedAt: 0 }, () => Promise.resolve(result(null)));
  assert.equal(h.store.setHomepageDiscovery('show-1', null, NOW), true);
  assert.equal(h.store.getShow('show-1').siteUrl, 'https://publisher.example.test/show');
  assert.equal(h.store.getShow('show-1').siteUrlCheckedAt, NOW);
});

test('a subsequent ordinary refresh still adopts episodes and advances normal fetch metadata', async () => {
  let count = 0;
  const updatedEpisode = { ...oldEpisode, id: 'episode-2', title: 'New episode' };
  const h = setup({}, () => Promise.resolve(++count === 1 ? result('https://publisher.example.test/show') : {
    ...result(null), episodes: [updatedEpisode], fetchedMeta: { etag: 'next-etag', lastModified: 'next-date' }
  }));
  h.refresh();
  await drain();
  assert.deepEqual(h.store.getEpisodes('show-1').map((ep) => ep.id), ['episode-1'], 'backfill keeps original episode cache');
  h.store.setFetchMeta('show-1', { lastFetchedAt: NOW - 31 * 60 * 1000 });
  h.refresh();
  await drain();
  assert.deepEqual(h.store.getEpisodes('show-1').map((ep) => ep.id), ['episode-2'], 'ordinary refresh still adopts the feed episode list');
  assert.equal(h.store.getShow('show-1').lastFetchedAt, NOW);
  assert.equal(h.store.getShow('show-1').etag, 'next-etag');
  assert.equal(h.store.getShow('show-1').lastModified, 'next-date');
});

test('a homepage-only persistence failure leaves the state and cached episodes intact', () => {
  const h = setup({}, () => Promise.resolve(result('https://publisher.example.test/show')));
  const before = JSON.stringify(h.store.getState());
  const oldWrite = h.storage.setItem;
  h.storage.setItem = (key, value) => {
    if (key === Store.KEY) { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; }
    return oldWrite(key, value);
  };
  assert.equal(h.store.setHomepageDiscovery('show-1', 'https://publisher.example.test/show', NOW), false);
  assert.equal(JSON.stringify(h.store.getState()), before, 'failed metadata writes do not fall back to clearing cached episodes');
});

test('a 304 response rejects without marking discovery complete and remains retryable', async () => {
  const h = setup({}, () => Promise.resolve(result('https://publisher.example.test/show')));
  const requests = [];
  h.context.fetch = (url, options) => {
    requests.push({ url, options });
    return Promise.resolve({
      ok: false, status: 304,
      json: () => Promise.reject(new Error('304 has no JSON body')),
      text: () => Promise.resolve('')
    });
  };
  vm.runInContext([
    sourceFunction('feedBase'), sourceFunction('fetchFeedText'), sourceFunction('addFeed')
  ].join('\n'), h.context);
  h.refresh();
  await drain();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.headers, undefined, 'homepage discovery does not send conditional validators');
  assert.equal(h.store.getShow('show-1').siteUrlCheckedAt, 0);
  h.refresh();
  await drain();
  assert.equal(requests.length, 2, '304 leaves discovery eligible for retry');
  assert.equal(h.store.getShow('show-1').siteUrlCheckedAt, 0);
});

test('homepage links remain rendered only from the validated stored siteUrl', () => {
  assert.match(WIN, /setHomepageLinks\(isSavedView \? null : sh\.siteUrl, showTitle\.textContent\)/);
  assert.match(WIN, /if \(!siteUrl \|\| isTV\(\)\) \{ return; \}/);
});
