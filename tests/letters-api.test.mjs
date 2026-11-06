// Frontend letter API harness: runs void-letters-api.js in a vm sandbox with a
// stubbed fetch and an in-memory sessionStorage. No network, no real letters.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'void-letters-api.js'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS  ' + name);
  } catch (e) {
    failed++;
    failures.push(name + ': ' + (e && e.message ? e.message : String(e)));
    console.log('FAIL  ' + name + '\n      ' + (e && e.message ? e.message : e));
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function equal(actual, expected, msg) {
  if (actual !== expected) throw new Error((msg || 'values differ') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function response(status, data) {
  return { status, text: async () => (data === undefined ? '' : JSON.stringify(data)) };
}

function makeEnv(handler) {
  const store = new Map();
  const env = {
    calls: [],
    store,
    setTimeout, clearTimeout, AbortController,
    crypto: globalThis.crypto,
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    },
    fetch: (url, init) => {
      env.calls.push({ url, init });
      return Promise.resolve(handler(url, init, env));
    }
  };
  env.window = env;
  vm.createContext(env);
  vm.runInContext(source, env);
  return env;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ok201 = (over) => response(201, Object.assign({ ok: true, id: '0123456789abcdef0123456789abcdef', created_at: 100, expires_at: 200 }, over));
function bodyOf(call) { return JSON.parse(call.init.body); }

await test('POST payload carries exactly text, expiry, request_id and lang', async () => {
  const env = makeEnv(() => ok201());
  const api = env.window.VoidLettersApi;
  const pending = api.begin('hello there', '24h', 'en');
  assert(env.store.size === 1, 'pending must be stored before the request');
  await api.submit(pending);
  const call = env.calls[0];
  assert(call.url.endsWith('/letters'), 'wrong endpoint: ' + call.url);
  equal(call.init.method, 'POST');
  equal(call.init.headers['Content-Type'], 'application/json');
  const body = bodyOf(call);
  equal(Object.keys(body).sort().join(','), 'expiry,lang,request_id,text');
  equal(body.text, 'hello there');
  equal(body.expiry, '24h');
  equal(body.lang, 'en');
});

await test('request_id is a valid UUIDv4', async () => {
  const env = makeEnv(() => ok201());
  const api = env.window.VoidLettersApi;
  assert(UUID_V4.test(api.begin('abc', '7d', null).request_id), 'not UUIDv4');
  assert(UUID_V4.test(api.newRequestId()), 'fallback generator is not UUIDv4');
});

await test('ZWNJ and ZWJ are preserved in the sent body', async () => {
  const env = makeEnv(() => ok201());
  const api = env.window.VoidLettersApi;
  const text = '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645 \ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67';
  await api.submit(api.begin(text, '7d', 'fa'));
  const body = bodyOf(env.calls[0]);
  equal(body.text, text, 'text was altered');
  assert(body.text.indexOf('\u200c') > -1 && body.text.indexOf('\u200d') > -1, 'ZWNJ/ZWJ missing');
});

await test('Secret Ink is sent only when enabled and survives the pending record', async () => {
  const env = makeEnv(() => ok201());
  const api = env.window.VoidLettersApi;
  const pending = api.begin('secret words', '7d', 'en', true);
  equal(pending.secret_ink, true, 'pending carries the flag');
  equal(api.loadPending().secret_ink, true, 'stored pending keeps the flag');
  await api.submit(pending);
  const body = bodyOf(env.calls[0]);
  equal(body.secret_ink, true, 'secret_ink missing from the POST');
  equal(body.text, 'secret words', 'the stored text is the original, not masked');
});

await test('changing Secret Ink starts a new submission without the flag', async () => {
  const env = makeEnv(() => ok201());
  const api = env.window.VoidLettersApi;
  const first = api.begin('same words', '7d', null, true);
  const second = api.begin('same words', '7d', null, false);
  assert(second.request_id !== first.request_id, 'toggling Secret Ink must not reuse the request id');
  equal(second.secret_ink, false, 'second pending is a visible letter');
  await api.submit(second);
  assert(!('secret_ink' in bodyOf(env.calls[0])), 'a visible letter must not send secret_ink');
});

await test('each allowed presence travels with the letter and survives pending storage', async () => {
  for (const kind of ['human', 'moon', 'root', 'unknown']) {
    const env = makeEnv(() => ok201({ presence: kind }));
    const api = env.window.VoidLettersApi;
    const pending = api.begin('a marked letter', '7d', 'fa', false, kind);
    equal(pending.presence, kind, 'pending lost ' + kind);
    equal(api.loadPending().presence, kind, 'stored pending lost ' + kind);
    await api.submit(pending);
    equal(bodyOf(env.calls[0]).presence, kind, 'POST lost ' + kind);
    equal(bodyOf(env.calls[0]).text, 'a marked letter', 'the text must stay untouched');
  }
});

await test('none presence is never sent, whether chosen or omitted', async () => {
  const env = makeEnv(() => ok201());
  const api = env.window.VoidLettersApi;
  await api.submit(api.begin('no mark chosen', '24h', null, false, 'none'));
  assert(!('presence' in bodyOf(env.calls[0])), 'explicit none reached the POST');
  await api.submit(api.begin('no mark given', '24h', null));
  assert(!('presence' in bodyOf(env.calls[1])), 'omitted presence reached the POST');
  equal(bodyOf(env.calls[1]).expiry, '24h');
});

await test('an unknown presence is normalized to none and never sent', async () => {
  const env = makeEnv(() => ok201());
  const api = env.window.VoidLettersApi;
  for (const bad of ['dragon', 'HUMAN', ' human', '', 42, {}, ['moon']]) {
    const pending = api.begin('invalid mark ' + String(bad), '24h', null, false, bad);
    equal(pending.presence, 'none', 'invalid value survived: ' + String(bad));
    await api.submit(pending);
    assert(!('presence' in bodyOf(env.calls[env.calls.length - 1])), 'invalid value was sent: ' + String(bad));
  }
});

await test('presence is part of the pending idempotency key', async () => {
  const env = makeEnv(() => ok201());
  const api = env.window.VoidLettersApi;
  const first = api.begin('same words', '7d', null, false, 'moon');
  const repeat = api.begin('same words', '7d', null, false, 'moon');
  equal(repeat.request_id, first.request_id, 'an identical retry must reuse the UUID');
  const implicitNone = api.begin('same words', '7d', null);
  const explicitNone = api.begin('same words', '7d', null, false, 'none');
  equal(explicitNone.request_id, implicitNone.request_id, 'none and omitted must be the same payload');
  const changed = api.begin('same words', '7d', null, false, 'root');
  assert(changed.request_id !== first.request_id, 'changing presence must start a new letter');
});

await test('a pending letter with presence is retried after reload with the same UUID', async () => {
  const first = makeEnv(() => { throw new TypeError('offline'); });
  const pending = first.window.VoidLettersApi.begin('moon after reload', '30d', null, false, 'moon');
  await first.window.VoidLettersApi.submit(pending);

  const second = makeEnv(() => ok201({ presence: 'moon' }));
  for (const [k, v] of first.store) second.store.set(k, v);
  const api = second.window.VoidLettersApi;
  const restored = api.loadPending();
  assert(restored && restored.presence === 'moon', 'presence was lost across reload');
  await api.submit(restored);
  equal(bodyOf(second.calls[0]).request_id, pending.request_id, 'retry changed the UUID');
  equal(bodyOf(second.calls[0]).presence, 'moon', 'retry lost the presence');
});

await test('a second submit while one is in flight is refused', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const env = makeEnv(() => gate.then(() => ok201()));
  const api = env.window.VoidLettersApi;
  const pending = api.begin('one letter', '24h', null);
  const first = api.submit(pending);
  const second = await api.submit(pending);
  equal(second.kind, 'busy');
  equal(env.calls.length, 1, 'double POST reached the network');
  release();
  equal((await first).kind, 'created');
});

await test('201 creates and clears the pending record', async () => {
  const env = makeEnv(() => ok201());
  const api = env.window.VoidLettersApi;
  const out = await api.submit(api.begin('created letter', '30d', null));
  equal(out.kind, 'created');
  equal(out.id, '0123456789abcdef0123456789abcdef');
  equal(api.loadPending(), null, 'pending survived a definitive response');
});

await test('200 with recovered:true is reported as recovered', async () => {
  const env = makeEnv(() => response(200, { ok: true, recovered: true, id: 'fedcba9876543210fedcba9876543210', created_at: 1, expires_at: 2 }));
  const api = env.window.VoidLettersApi;
  const out = await api.submit(api.begin('retry letter', '7d', null));
  equal(out.kind, 'recovered');
  equal(out.id, 'fedcba9876543210fedcba9876543210');
  equal(api.loadPending(), null);
});

await test('409 already_submitted keeps next_allowed_at and clears pending', async () => {
  const env = makeEnv(() => response(409, { ok: false, error: 'already_submitted', next_allowed_at: 1790000000 }));
  const api = env.window.VoidLettersApi;
  const out = await api.submit(api.begin('second letter', '7d', null));
  equal(out.kind, 'already');
  equal(out.next_allowed_at, 1790000000);
  equal(api.loadPending(), null);
});

await test('410 expired clears pending and the next attempt gets a new UUID', async () => {
  const env = makeEnv(() => response(410, { ok: false, error: 'expired' }));
  const api = env.window.VoidLettersApi;
  const first = api.begin('expired letter', '24h', null);
  const out = await api.submit(first);
  equal(out.kind, 'expired');
  equal(api.loadPending(), null);
  const next = api.begin('expired letter', '24h', null);
  assert(next.request_id !== first.request_id, 'UUID was reused after 410');
});

await test('429 keeps pending and exposes retry_after in seconds', async () => {
  const env = makeEnv(() => response(429, { ok: false, error: 'rate_limited', retry_after: 42 }));
  const api = env.window.VoidLettersApi;
  const pending = api.begin('rate letter', '24h', null);
  const out = await api.submit(pending);
  equal(out.kind, 'rate');
  equal(out.retry_after, 42);
  const kept = api.loadPending();
  assert(kept && kept.request_id === pending.request_id, 'pending was not kept for retry');
});

await test('400 maps a known server reason and clears pending', async () => {
  const env = makeEnv(() => response(400, { ok: false, error: 'Message exceeds maximum limit of 500 codepoints' }));
  const api = env.window.VoidLettersApi;
  const out = await api.submit(api.begin('long letter', '24h', null));
  equal(out.kind, 'invalid');
  equal(out.reason, 'long');
  equal(api.loadPending(), null);
});

await test('503 keeps pending and the same UUID for the retry', async () => {
  const env = makeEnv(() => response(503, { ok: false, error: 'unavailable' }));
  const api = env.window.VoidLettersApi;
  const pending = api.begin('retry after 503', '24h', null);
  equal((await api.submit(pending)).kind, 'unavailable');
  const kept = api.loadPending();
  assert(kept && kept.request_id === pending.request_id, 'pending lost on 503');
});

await test('network failure keeps pending and retries with the same UUID', async () => {
  let attempt = 0;
  const env = makeEnv(() => {
    attempt++;
    if (attempt === 1) throw new TypeError('Failed to fetch');
    return ok201();
  });
  const api = env.window.VoidLettersApi;
  const pending = api.begin('network letter', '7d', null);
  equal((await api.submit(pending)).kind, 'network');
  const kept = api.loadPending();
  assert(kept && kept.request_id === pending.request_id, 'pending lost on network error');
  const out = await api.submit(api.begin('network letter', '7d', null));
  equal(out.kind, 'created');
  equal(bodyOf(env.calls[1]).request_id, pending.request_id, 'retry changed the UUID');
});

await test('editing the letter after a failure produces a new UUID', async () => {
  const env = makeEnv(() => { throw new TypeError('offline'); });
  const api = env.window.VoidLettersApi;
  const first = api.begin('original text', '7d', null);
  await api.submit(first);
  const edited = api.begin('edited text', '7d', null);
  assert(edited.request_id !== first.request_id, 'edited payload reused the old UUID');
});

await test('pending survives a reload (same sessionStorage, new instance)', async () => {
  const first = makeEnv(() => { throw new TypeError('offline'); });
  const pending = first.window.VoidLettersApi.begin('reload letter', '30d', null);
  await first.window.VoidLettersApi.submit(pending);

  const second = makeEnv(() => ok201());
  for (const [k, v] of first.store) second.store.set(k, v);
  const env = second;
  const api = env.window.VoidLettersApi;
  const restored = api.loadPending();
  assert(restored && restored.request_id === pending.request_id, 'pending not restored');
  await api.submit(api.begin(restored.text, restored.expiry, restored.lang));
  equal(bodyOf(env.calls[0]).request_id, pending.request_id, 'reloaded retry changed the UUID');
});

await test('feed paginates newest first, appends without duplicates', async () => {
  const pages = {
    first: response(200, {
      letters: [
        { seq: 3, id: 'l3', body: 'third', lang: 'fa', created_at: 3, expires_at: 999 },
        { seq: 2, id: 'l2', body: 'second', lang: null, created_at: 2, expires_at: 999 }
      ],
      next_before: 2
    }),
    second: response(200, {
      letters: [
        { seq: 2, id: 'l2', body: 'second', lang: null, created_at: 2, expires_at: 999 },
        { seq: 1, id: 'l1', body: 'first', lang: null, created_at: 1, expires_at: 999 }
      ],
      next_before: null
    })
  };
  let page = 0;
  const env = makeEnv(() => (page++ === 0 ? pages.first : pages.second));
  const feed = env.window.VoidLettersApi.createFeed();
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const res = await feed.next();
    if (res.status !== 'ok') break;
    seen.push(res.letter.id);
  }
  equal(seen.join(','), 'l3,l2,l1');
  equal(env.calls.length, 2, 'expected exactly two page requests');
  assert(env.calls[0].url.includes('/letters?limit=20') && !env.calls[0].url.includes('before='), 'first page URL wrong: ' + env.calls[0].url);
  assert(env.calls[1].url.includes('before=2'), 'cursor missing: ' + env.calls[1].url);
  equal(env.calls[0].init.method, 'GET');
});

await test('counter and feed fail independently', async () => {
  const env = makeEnv((url) => {
    if (url.includes('/letters/count')) return response(500, { ok: false });
    return response(200, { letters: [{ id: 'a', body: 'text', created_at: 1, expires_at: 999 }], next_before: null });
  });
  const api = env.window.VoidLettersApi;
  const [n, page] = await Promise.all([api.count(), api.createFeed().prefetch()]);
  equal(n, null, 'failed counter must resolve null');
  equal(page.status, 'ok');
  assert(env.calls.some((c) => c.url.includes('/letters/count')), 'count not requested');
});

await test('quota reads the sender allowance with GET and maps the shape', async () => {
  const env = makeEnv(() => response(200, {
    ok: true, limit: 3, used: 1, remaining: 2, window_seconds: 86400, retry_after: 0, server_now: 1700000000
  }));
  const api = env.window.VoidLettersApi;
  const q = await api.quota();
  equal(q.limit, 3);
  equal(q.used, 1);
  equal(q.remaining, 2);
  equal(q.retry_after, 0);
  equal(q.server_now, 1700000000);
  equal(env.calls[0].url, 'https://void-galaxy-letters.minoodar.workers.dev/letters/quota');
  equal(env.calls[0].init.method, 'GET');
});

await test('quota is null for every inconsistent or failed answer', async () => {
  const bad = [
    response(500, { ok: false, error: 'unavailable' }),
    response(404, { ok: false, error: 'not_found' }),
    response(200, { ok: false }),
    response(200, { ok: true, limit: 3, used: 1, remaining: 1, server_now: 10 }),
    response(200, { ok: true, limit: 0, used: 0, remaining: 0 }),
    response(200, { ok: true, limit: 11, used: 0, remaining: 11 }),
    response(200, { ok: true, limit: 3, used: 1.5, remaining: 1.5 }),
    response(200, { ok: true, limit: 3, used: 'one', remaining: 'two' })
  ];
  for (let i = 0; i < bad.length; i++) {
    const env = makeEnv(() => bad[i]);
    equal(await env.window.VoidLettersApi.quota(), null, 'must be null for case ' + i);
  }
  const offline = makeEnv(() => { throw new TypeError('Failed to fetch'); });
  equal(await offline.window.VoidLettersApi.quota(), null, 'offline must be null');
});

await test('quota normalizes a missing server clock and a negative retry', async () => {
  const env = makeEnv(() => response(200, { ok: true, limit: 3, used: 3, remaining: 0, retry_after: -5 }));
  const q = await env.window.VoidLettersApi.quota();
  equal(q.used, 3);
  equal(q.remaining, 0);
  equal(q.retry_after, 0, 'negative retry is clamped');
  equal(q.server_now, null, 'missing server clock stays unknown');
});

await test('empty feed is empty, never demo data', async () => {
  const env = makeEnv(() => response(200, { letters: [], next_before: null }));
  const api = env.window.VoidLettersApi;
  const res = await api.createFeed().next();
  equal(res.status, 'empty');
  equal(env.window.VoidLettersDevDemo, undefined, 'demo flag must default off');
  assert(!/demo-/i.test(source), 'api layer must not embed demo letters');
});

await test('share URL is built only for 32-hex ids', async () => {
  const env = makeEnv(() => response(200, { letters: [], next_before: null }));
  const api = env.window.VoidLettersApi;
  equal(api.hasPublicLetterRoute, true);
  const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  equal(api.letterUrl(id), 'https://minoodar.github.io/void/?letter=' + id);
  equal(api.letterUrl('abc123'), null, 'short id must not become a URL');
  equal(api.letterUrl('../letters'), null, 'path injection must not become a URL');
  equal(api.letterUrl('A'.repeat(32)), null, 'uppercase ids are not the Worker format');
  equal(api.letterUrl(null), null);
});

await test('getLetter returns the letter, maps 404 to not_found, and never writes', async () => {
  const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const env = makeEnv((url) => {
    if (url.endsWith('/letters/' + id)) {
      return response(200, { id, text: 'star text', lang: 'fa', created_at: 10, expires_at: 20 });
    }
    return response(404, { ok: false, error: 'not_found' });
  });
  const api = env.window.VoidLettersApi;

  const hit = await api.getLetter(id);
  equal(hit.status, 'ok');
  equal(hit.letter.text, 'star text');
  equal(hit.letter.lang, 'fa');
  equal(hit.letter.expires_at, 20);
  equal(env.calls[0].url, 'https://void-galaxy-letters.minoodar.workers.dev/letters/' + id);
  equal(env.calls[0].init.method, 'GET');

  const missing = await api.getLetter('b'.repeat(32));
  equal(missing.status, 'not_found');

  const secretId = 'd'.repeat(32);
  const secretEnv = makeEnv(() => response(200, {
    id: secretId, text: 'secret text', secret_ink: true, created_at: 1, expires_at: 2
  }));
  const secret = await secretEnv.window.VoidLettersApi.getLetter(secretId);
  equal(secret.status, 'ok');
  equal(secret.letter.secret_ink, true, 'secret_ink true is preserved');
  equal(secret.letter.text, 'secret text', 'the unmasked text is what the service sends');

  const plainEnv = makeEnv(() => response(200, { id: secretId, text: 'plain text', created_at: 1, expires_at: 2 }));
  const plain = await plainEnv.window.VoidLettersApi.getLetter(secretId);
  equal(plain.letter.secret_ink, false, 'a missing flag maps to false');

  for (const call of env.calls) equal(call.init.method, 'GET', 'getLetter must never POST');
});

await test('getLetter refuses a reply for a different id', async () => {
  const id = 'a'.repeat(32);
  const env = makeEnv(() => response(200, { id: 'b'.repeat(32), text: 'wrong letter', created_at: 1, expires_at: 2 }));
  const out = await env.window.VoidLettersApi.getLetter(id);
  equal(out.status, 'error');
});

await test('getLetter rejects malformed ids locally and reports network failure', async () => {
  let offline = false;
  const env = makeEnv((url) => {
    if (offline) throw new TypeError('Failed to fetch');
    return response(200, { id: 'c'.repeat(32), text: 'ok', created_at: 1, expires_at: 2 });
  });
  const api = env.window.VoidLettersApi;

  for (const bad of ['abc', '../letters', '', null, undefined, 'A'.repeat(32), 'c'.repeat(31)]) {
    const res = await api.getLetter(bad);
    equal(res.status, 'not_found', 'malformed id: ' + String(bad));
  }
  equal(env.calls.length, 0, 'malformed ids reached the network');

  offline = true;
  const failed = await api.getLetter('c'.repeat(32));
  equal(failed.status, 'error');
});

await test('feed and count never POST', async () => {
  const env = makeEnv((url) => response(200, url.includes('count') ? { active: 3 } : { letters: [], next_before: null }));
  const api = env.window.VoidLettersApi;
  await api.count();
  await api.createFeed().prefetch();
  for (const call of env.calls) equal(call.init.method, 'GET', 'non-POST expected: ' + call.url);
});

await test('the feed maps secret_ink to a boolean and defaults it to false', async () => {
  const env = makeEnv(() => response(200, {
    letters: [
      { seq: 2, id: 'secret', body: 'hidden', lang: null, secret_ink: 1, created_at: 2, expires_at: 999 },
      { seq: 1, id: 'plain', body: 'visible', lang: null, created_at: 1, expires_at: 999 }
    ],
    next_before: null
  }));
  const feed = env.window.VoidLettersApi.createFeed();
  const secret = await feed.next();
  const plain = await feed.next();
  equal(secret.letter.id, 'secret');
  equal(secret.letter.secret_ink, true, 'numeric 1 maps to true');
  equal(secret.letter.text, 'hidden', 'feed text is not masked');
  equal(plain.letter.secret_ink, false, 'missing flag maps to false');
});

await test('the feed maps presence from each letter and defaults it to none', async () => {
  const env = makeEnv(() => response(200, {
    letters: [
      { seq: 4, id: 'human', body: 'a', presence: 'human', created_at: 4, expires_at: 999 },
      { seq: 3, id: 'invalid', body: 'b', presence: 'dragon', created_at: 3, expires_at: 999 },
      { seq: 2, id: 'missing', body: 'c', created_at: 2, expires_at: 999 },
      { seq: 1, id: 'null', body: 'd', presence: null, created_at: 1, expires_at: 999 }
    ],
    next_before: null
  }));
  const feed = env.window.VoidLettersApi.createFeed();
  equal((await feed.next()).letter.presence, 'human');
  equal((await feed.next()).letter.presence, 'none', 'invalid presence must not reach the reader');
  equal((await feed.next()).letter.presence, 'none', 'missing presence is none');
  equal((await feed.next()).letter.presence, 'none', 'NULL presence is none');
});

await test('updates-first merging keeps the mark delivered by /site/updates', async () => {
  const updatesPayload = {
    ok: true,
    letters: [
      { seq: 5, id: 'moon5', body: 'new moon', presence: 'moon', created_at: 5, expires_at: 999 },
      { seq: 4, id: 'plain4', body: 'new plain', created_at: 4, expires_at: 999 }
    ],
    next_after: 5, active: 6, unique_visitors: 1, total_sessions: 1, returning_ratio: 0
  };
  const env = makeEnv((url) => url.includes('/site/updates') ? response(200, updatesPayload) : response(200, {
    letters: [
      { seq: 5, id: 'moon5', body: 'new moon', presence: 'moon', created_at: 5, expires_at: 999 },
      { seq: 4, id: 'plain4', body: 'new plain', created_at: 4, expires_at: 999 },
      { seq: 1, id: 'older1', body: 'older', presence: 'human', created_at: 1, expires_at: 999 }
    ],
    next_before: null
  }));
  const feed = env.window.VoidLettersApi.createFeed();
  await feed.refreshLatest();
  await feed.prefetch();

  const first = await feed.next();
  const second = await feed.next();
  const third = await feed.next();
  equal(first.letter.id, 'moon5', 'updates-first copy is rendered first');
  equal(first.letter.presence, 'moon', 'the updates copy keeps its mark');
  equal(second.letter.id, 'plain4');
  equal(second.letter.presence, 'none', 'an unmarked update is none');
  equal(third.letter.id, 'older1', 'the older page letter still arrives once');
  equal(third.letter.presence, 'human', 'the merged page copy keeps its mark');
});

await test('a later refresh delivers presence for a newly arrived letter', async () => {
  const fresh = [];
  const env = makeEnv((url) => url.includes('/site/updates') ? response(200, {
    ok: true, letters: fresh.slice(), next_after: fresh.length ? 2 : 1,
    active: 2, unique_visitors: 1, total_sessions: 1, returning_ratio: 0
  }) : response(200, {
    letters: [{ seq: 1, id: 'first1', body: 'first', presence: 'human', created_at: 1, expires_at: 999 }],
    next_before: null
  }));
  const feed = env.window.VoidLettersApi.createFeed();
  await feed.prefetch();
  equal((await feed.next()).letter.presence, 'human', 'initial letter keeps its mark');

  fresh.push({ seq: 2, id: 'root2', body: 'later root', presence: 'root', created_at: 2, expires_at: 999 });
  const refreshed = await feed.refreshLatest();
  equal(refreshed.added, 1, 'the new letter is merged');
  const updatesCall = env.calls.find((call) => call.url.includes('/site/updates'));
  assert(updatesCall.url.includes('after=1'), 'refresh must resume after the newest known seq: ' + updatesCall.url);

  const later = await feed.next();
  equal(later.letter.id, 'root2');
  equal(later.letter.presence, 'root', 'a refreshed letter keeps its mark');
});

await test('updates without a usable presence degrade to none', async () => {
  const env = makeEnv((url) => url.includes('/site/updates') ? response(200, {
    ok: true,
    letters: [
      { seq: 2, id: 'legacy2', body: 'legacy', created_at: 2, expires_at: 999 },
      { seq: 1, id: 'hostile1', body: 'hostile', presence: 'dragon', created_at: 1, expires_at: 999 }
    ],
    next_after: 2, active: 2, unique_visitors: 1, total_sessions: 1, returning_ratio: 0
  }) : response(200, { letters: [], next_before: null }));
  const feed = env.window.VoidLettersApi.createFeed();
  await feed.refreshLatest();
  equal((await feed.next()).letter.presence, 'none', 'a missing updates presence is none');
  equal((await feed.next()).letter.presence, 'none', 'an invalid updates presence is none');
});

await test('the single-letter response maps presence and rejects unknown names', async () => {
  const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const marked = makeEnv(() => response(200, {
    id, text: 'marked', presence: 'root', created_at: 1, expires_at: 2
  }));
  equal((await marked.window.VoidLettersApi.getLetter(id)).letter.presence, 'root');

  const legacy = makeEnv(() => response(200, { id, text: 'legacy', created_at: 1, expires_at: 2 }));
  equal((await legacy.window.VoidLettersApi.getLetter(id)).letter.presence, 'none', 'legacy NULL is none');

  const hostile = makeEnv(() => response(200, {
    id, text: 'hostile', presence: '<svg onload=alert(1)>', created_at: 1, expires_at: 2
  }));
  equal((await hostile.window.VoidLettersApi.getLetter(id)).letter.presence, 'none', 'arbitrary markup must not pass through');
});

await test('recordVisit posts only the returning flag and never rejects', async () => {
  const env = makeEnv(() => response(200, { ok: true, returning: true }));
  const api = env.window.VoidLettersApi;
  equal(await api.recordVisit(true), true);
  equal(env.calls.length, 1, 'one hit');
  equal(env.calls[0].url, 'https://void-galaxy-letters.minoodar.workers.dev/visitors/hit');
  equal(env.calls[0].init.method, 'POST');
  equal(JSON.stringify(bodyOf(env.calls[0])), '{"returning":true}', 'only returning is sent');

  const limited = makeEnv(() => response(429, { ok: false, error: 'rate_limited' }));
  equal(await limited.window.VoidLettersApi.recordVisit(false), false, '429 resolves false');

  const offline = makeEnv(() => { throw new TypeError('Failed to fetch'); });
  equal(await offline.window.VoidLettersApi.recordVisit(false), false, 'offline resolves false');
});

await test('visitorStats maps the counter payload and fails to null', async () => {
  const env = makeEnv(() => response(200, {
    ok: true, unique_visitors: 54, total_sessions: 71, returning_ratio: 0.42
  }));
  const api = env.window.VoidLettersApi;
  const stats = await api.visitorStats();
  equal(stats.u, 54);
  equal(stats.t, 71);
  equal(stats.r, 0.42);
  equal(env.calls[0].url, 'https://void-galaxy-letters.minoodar.workers.dev/visitors/stats');
  equal(env.calls[0].init.method, 'GET');

  const clamped = makeEnv(() => response(200, {
    ok: true, unique_visitors: 2, total_sessions: -1, returning_ratio: 5
  }));
  const weird = await clamped.window.VoidLettersApi.visitorStats();
  equal(weird.t, 0, 'negative sessions clamp to 0');
  equal(weird.r, 1, 'ratio clamps to 1');

  const broken = makeEnv(() => response(200, { ok: true, unique_visitors: 'x' }));
  equal(await broken.window.VoidLettersApi.visitorStats(), null, 'unusable payload → null');

  const down = makeEnv(() => response(503, { ok: false, error: 'unavailable' }));
  equal(await down.window.VoidLettersApi.visitorStats(), null, '503 → null');

  const offline = makeEnv(() => { throw new TypeError('Failed to fetch'); });
  equal(await offline.window.VoidLettersApi.visitorStats(), null, 'offline → null');
});

await test('vote uses PUT with exactly the type and maps a successful reply', async () => {
  const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const env = makeEnv((url) => {
    if (url.endsWith('/letters/' + id + '/vote')) {
      return response(200, {
        ok: true, id, type: 'like', expires_at: 2000, remaining_seconds: 900,
        votes_like: 3, votes_dislike: 1, capped: false, changed: true
      });
    }
    return response(404, { ok: false, error: 'not_found' });
  });
  const api = env.window.VoidLettersApi;
  const out = await api.vote(id, 'like');
  equal(out.status, 'ok');
  equal(out.type, 'like');
  equal(out.letter.expires_at, 2000);
  equal(out.letter.remaining_seconds, 900);
  equal(out.letter.votes_like, 3);
  equal(out.letter.votes_dislike, 1);
  equal(out.capped, false);
  equal(env.calls.length, 1, 'one vote request');
  equal(env.calls[0].url, api.base + '/letters/' + id + '/vote');
  equal(env.calls[0].init.method, 'PUT');
  equal(env.calls[0].init.headers['Content-Type'], 'application/json');
  equal(JSON.stringify(bodyOf(env.calls[0])), '{"type":"like"}', 'only type is sent');
});

await test('retractVote uses DELETE and validates the null vote state', async () => {
  const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const env = makeEnv(() => response(200, {
    ok: true, id, type: null, changed: true, capped: false,
    expires_at: 1800, remaining_seconds: 700, votes_like: 2, votes_dislike: 1
  }));
  const api = env.window.VoidLettersApi;
  const out = await api.retractVote(id);
  equal(out.status, 'ok');
  equal(out.type, null);
  equal(out.changed, true);
  equal(out.letter.expires_at, 1800);
  equal(env.calls[0].init.method, 'DELETE');
  equal(env.calls[0].init.body, undefined, 'DELETE sends no unnecessary body');
});

await test('vote refuses malformed ids and unknown types locally', async () => {
  const env = makeEnv(() => response(200, { ok: true }));
  const api = env.window.VoidLettersApi;
  for (const id of ['abc', '../letters', '', null, undefined, 'A'.repeat(32), 'c'.repeat(31)]) {
    equal((await api.vote(id, 'like')).status, 'invalid', 'malformed id: ' + String(id));
  }
  const id = 'c'.repeat(32);
  for (const type of ['upvote', '', null, undefined, 'LIKE']) {
    equal((await api.vote(id, type)).status, 'invalid', 'bad type: ' + String(type));
  }
  equal(env.calls.length, 0, 'invalid votes reached the network');
});

await test('vote classifies duplicate, missing, limited, failed and offline replies', async () => {
  const id = 'd'.repeat(32);
  const already = makeEnv(() => response(409, {
    ok: false, error: 'already_voted', type: 'dislike', expires_at: 500, votes_like: 1, votes_dislike: 2
  }));
  const dup = await already.window.VoidLettersApi.vote(id, 'like');
  equal(dup.status, 'already');
  equal(dup.type, 'dislike', 'server choice wins');
  equal(dup.letter.votes_dislike, 2);

  const missing = makeEnv(() => response(404, { ok: false, error: 'not_found' }));
  equal((await missing.window.VoidLettersApi.vote(id, 'like')).status, 'not_found');

  const limited = makeEnv(() => response(429, { ok: false, error: 'rate_limited', retry_after: 120 }));
  const rate = await limited.window.VoidLettersApi.vote(id, 'like');
  equal(rate.status, 'rate');
  equal(rate.retry_after, 120);

  const bad = makeEnv(() => response(400, { ok: false, error: 'invalid_vote' }));
  equal((await bad.window.VoidLettersApi.vote(id, 'like')).status, 'invalid');

  const broken = makeEnv(() => response(503, { ok: false, error: 'unavailable' }));
  const failed = await broken.window.VoidLettersApi.vote(id, 'like');
  equal(failed.status, 'error');
  equal(failed.code, 503);

  const offline = makeEnv(() => { throw new TypeError('Failed to fetch'); });
  equal((await offline.window.VoidLettersApi.vote(id, 'like')).status, 'network');
});

await test('vote ignores a reply that belongs to another letter', async () => {
  const id = 'e'.repeat(32);
  const env = makeEnv(() => response(200, {
    ok: true, id: 'f'.repeat(32), type: 'like', expires_at: 10, votes_like: 1, votes_dislike: 0
  }));
  const out = await env.window.VoidLettersApi.vote(id, 'like');
  equal(out.status, 'error');
});

await test('feed and single-letter payloads expose vote counts', async () => {
  const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const env = makeEnv((url) => {
    if (url.includes('/letters?')) {
      return response(200, {
        letters: [{ seq: 1, id, body: 'counted', created_at: 1, expires_at: 999, votes_like: 4, votes_dislike: 2 }],
        next_before: null
      });
    }
    return response(200, {
      id, text: 'single counted', created_at: 1, expires_at: 999, votes_like: 7, votes_dislike: 'x'
    });
  });
  const api = env.window.VoidLettersApi;
  const feed = await api.createFeed().next();
  equal(feed.letter.votes_like, 4, 'feed likes');
  equal(feed.letter.votes_dislike, 2, 'feed dislikes');

  const single = await api.getLetter(id);
  equal(single.letter.votes_like, 7, 'single likes');
  equal(single.letter.votes_dislike, 0, 'unusable count clamps to 0');
});

console.log('\n' + passed + '/' + (passed + failed) + ' checks passed');
if (failed) {
  console.log('FAILURES:');
  for (const f of failures) console.log('- ' + f);
  process.exitCode = 1;
}
