// Phase A offline verification harness.
// Runs the real worker.js against an in-memory SQLite database through a small
// D1-compatible shim. No network, no wrangler, no Cloudflare account needed.
//
// Run:
//   ELECTRON_RUN_AS_NODE=1 "C:/Users/minoodar/AppData/Local/Programs/Qoder/Qoder.exe" worker/letters/test/phase-a.test.mjs

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const schemaSql = await readFile(join(root, 'schema.sql'), 'utf8');
const workerSource = await readFile(join(root, 'worker.js'), 'utf8');
const wranglerToml = await readFile(join(root, 'wrangler.toml'), 'utf8');
const migrationSql = await readFile(join(root, 'migrations', '2026-10-30-daily-limit-admin.sql'), 'utf8');

const workerUrl = 'data:text/javascript;base64,' + Buffer.from(workerSource, 'utf8').toString('base64');
const worker = await import(workerUrl);

const PROD = 'https://minoodar.github.io';
const TEST_SALT = 'phase-a-test-salt-not-a-secret';
const TTL = { '24h': 86400, '7d': 604800, '30d': 2592000, '90d': 7776000 };
const DAY_SEC = 86400;
const DAILY_LIMIT = 2;
const TEST_ADMIN_SECRET = 'phase-a-admin-secret-not-a-real-secret';

class D1Statement {
  constructor(d1, sql, params = []) {
    this.d1 = d1;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new D1Statement(this.d1, this.sql, params);
  }

  async first() {
    const row = this.d1.raw.prepare(this.sql).get(...this.params);
    return row === undefined ? null : row;
  }

  async all() {
    return {
      results: this.d1.raw.prepare(this.sql).all(...this.params),
      success: true,
      meta: { changes: 0 }
    };
  }

  async run() {
    return this.d1.runStatement(this.sql, this.params);
  }
}

class D1 {
  constructor(raw) {
    this.raw = raw;
    this.writes = 0;
  }

  prepare(sql) {
    return new D1Statement(this, sql);
  }

  runStatement(sql, params) {
    this.writes += 1;
    const result = this.raw.prepare(sql).run(...params);
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid)
      }
    };
  }

  async batch(statements) {
    this.raw.exec('BEGIN');
    try {
      const out = [];
      for (const statement of statements) {
        if (/^\s*SELECT\b/i.test(statement.sql)) {
          out.push({
            results: this.raw.prepare(statement.sql).all(...statement.params),
            success: true,
            meta: { changes: 0 }
          });
        } else {
          out.push(this.runStatement(statement.sql, statement.params));
        }
      }
      this.raw.exec('COMMIT');
      return out;
    } catch (error) {
      try { this.raw.exec('ROLLBACK'); } catch (e) {}
      throw error;
    }
  }
}

function createEnv(overrides = {}) {
  const raw = new DatabaseSync(':memory:');
  raw.exec(schemaSql);
  return Object.assign({
    DB: new D1(raw),
    LETTER_SALT: TEST_SALT,
    ADMIN_SECRET: TEST_ADMIN_SECRET,
    ENVIRONMENT: 'local-dev',
    __raw: raw
  }, overrides);
}

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return '198.51.100.' + ((ipCounter % 200) + 10);
}

function makeRequest(path, opts = {}) {
  const {
    method = 'GET',
    body,
    origin = PROD,
    ip = '203.0.113.10',
    headers = {}
  } = opts;
  const h = Object.assign({ 'CF-Connecting-IP': ip }, headers);
  if (origin !== null) h.Origin = origin;
  if (body !== undefined && !Object.prototype.hasOwnProperty.call(h, 'Content-Type')) {
    h['Content-Type'] = 'application/json';
  }
  return new Request('https://letters.local' + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
}

async function call(env, path, opts) {
  const response = await worker.default.fetch(makeRequest(path, opts), env);
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: response.status, headers: response.headers, data, text };
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    process.stdout.write('PASS  ' + name + '\n');
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    process.stdout.write('FAIL  ' + name + ' :: ' + error.message + '\n');
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
  }
}

function validBody(overrides = {}) {
  return Object.assign({
    text: 'hello galaxy',
    expiry: '7d',
    request_id: randomUUID(),
    lang: 'en'
  }, overrides);
}

function tableRows(env, table) {
  return env.__raw.prepare('SELECT * FROM ' + table).all();
}

function currentHour() {
  return Math.floor(Date.now() / 1000 / 3600);
}

// ---------------------------------------------------------------------------
// Static and schema checks
// ---------------------------------------------------------------------------

await test('schema.sql executes and creates only the isolated tables', async () => {
  const env = createEnv();
  const names = env.__raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name);
  for (const table of ['letters', 'letter_senders', 'letter_submissions', 'letter_limits']) {
    assert(names.includes(table), 'missing table ' + table);
  }
  for (const counterTable of ['visitors', 'daily', 'rate']) {
    assert(!names.includes(counterTable), 'counter table leaked into isolated schema: ' + counterTable);
  }
});

await test('the daily-limit migration applies to an existing schema and is idempotent', async () => {
  const env = createEnv();
  env.__raw.exec('DROP TABLE letter_submissions');
  env.__raw.exec(migrationSql);
  env.__raw.exec(migrationSql);
  const names = env.__raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert(names.includes('letter_submissions'), 'migration did not create letter_submissions');
  const cols = env.__raw.prepare('PRAGMA table_info(letter_submissions)').all().map(c => c.name);
  for (const col of ['request_id', 'sender_hash', 'letter_id', 'created_at']) {
    assert(cols.includes(col), 'missing column ' + col);
  }
});

await test('wrangler.toml targets the letters Worker and its D1 binding', async () => {  assert(wranglerToml.includes('name = "void-galaxy-letters"'), 'worker name missing');
  assert(wranglerToml.includes('main = "worker.js"'), 'entrypoint must be worker.js');
  assert(/compatibility_date = "\d{4}-\d{2}-\d{2}"/.test(wranglerToml), 'compatibility_date missing');
  assert(wranglerToml.includes('binding = "DB"'), 'D1 binding DB missing');
  assert(wranglerToml.includes('database_name = "void-galaxy-letters-db"'), 'D1 database_name missing');
  assert(wranglerToml.includes('559070d9-afb4-471e-8839-78866e9437a1'), 'D1 database_id missing');
});

await test('worker source has no logging and no outbound fetch', async () => {
  assert(!/console\s*\./.test(workerSource), 'console usage found');
  assert(!/\bfetch\s*\(\s*['"`]/.test(workerSource), 'outbound fetch found');
  assert(!/\bXMLHttpRequest\b|\bsendBeacon\b/.test(workerSource), 'outbound request API found');
});

// ---------------------------------------------------------------------------
// validatePayload unit checks
// ---------------------------------------------------------------------------

await test('valid payload normalizes request_id and keeps TTL', async () => {
  const id = randomUUID();
  const result = worker.validatePayload(validBody({ request_id: id.toUpperCase() }));
  assert(result.ok, JSON.stringify(result));
  equal(result.data.ttl, TTL['7d'], 'ttl');
  equal(result.data.requestId, id.toLowerCase(), 'request id normalized');
  equal(result.data.text, 'hello galaxy', 'text');
});

await test('500 emoji are counted as 500 code points, not 1000 UTF-16 units', async () => {
  const emoji = '😀'.repeat(500);
  equal(emoji.length, 1000, 'precondition: UTF-16 length is 1000');
  const result = worker.validatePayload(validBody({ text: emoji }));
  assert(result.ok, JSON.stringify(result));
  equal(Array.from(result.data.text).length, 500, 'code point count');
});

await test('501 emoji are rejected', async () => {
  const result = worker.validatePayload(validBody({ text: '😀'.repeat(501) }));
  assert(!result.ok, 'expected rejection');
});

await test('Persian ZWNJ is preserved unchanged and counted as a code point', async () => {
  const text = 'می\u200Cخواهم';
  const result = worker.validatePayload(validBody({ text }));
  assert(result.ok, JSON.stringify(result));
  equal(result.data.text, text, 'ZWNJ preserved');
  assert(result.data.text.includes('\u200C'), 'ZWNJ present in stored text');
  equal(Array.from(result.data.text).length, 8, 'ZWNJ counts toward the limit');
});

await test('ZWJ emoji sequences are preserved unchanged', async () => {
  const text = '👨\u200D👩\u200D👧';
  const result = worker.validatePayload(validBody({ text }));
  assert(result.ok, JSON.stringify(result));
  equal(result.data.text, text, 'ZWJ sequence preserved');
  equal(Array.from(result.data.text).length, 5, 'family emoji is 5 code points');
});

await test('non-orthographic zero-width characters are still removed from storage', async () => {
  const result = worker.validatePayload(validBody({ text: 'ab\u200Bcd' }));
  assert(result.ok, JSON.stringify(result));
  equal(result.data.text, 'abcd', 'U+200B removed from stored body');
});

await test('hidden links split by ZWNJ are still rejected', async () => {
  const result = worker.validatePayload(validBody({ text: 'exa\u200Cmple.com' }));
  assert(!result.ok, 'ZWNJ-obfuscated domain must be rejected');
});

await test('control characters are rejected', async () => {
  const result = worker.validatePayload(validBody({ text: 'abc\u0000def' }));
  assert(!result.ok, 'control chars must be rejected');
});

await test('bidi overrides are rejected', async () => {
  const result = worker.validatePayload(validBody({ text: 'abc\u202Edef' }));
  assert(!result.ok, 'bidi override must be rejected');
});

await test('unpaired surrogates are rejected', async () => {
  const result = worker.validatePayload(validBody({ text: 'ab\uD800cd' }));
  assert(!result.ok, 'lone surrogate must be rejected');
});

await test('links and domains are rejected', async () => {
  const bad = [
    'see http://example.com now',
    'see https://example.com now',
    'ftp://example.com/file',
    '//example.com/path',
    'www.example.com is here',
    'mail me at example.com',
    'server 185.203.1.4 is up',
    'exa\u200Bmple.com hidden',
    'ｅｘａｍｐｌｅ.ｃｏｍ fullwidth'
  ];
  for (const text of bad) {
    const result = worker.validatePayload(validBody({ text }));
    assert(!result.ok, 'expected rejection for: ' + JSON.stringify(text));
  }
});

await test('plain prose is accepted and text shorter than 3 code points is rejected', async () => {
  assert(worker.validatePayload(validBody({ text: 'hello world' })).ok, 'prose rejected');
  assert(!worker.validatePayload(validBody({ text: 'ab' })).ok, 'short text accepted');
  assert(!worker.validatePayload(validBody({ text: '   ' })).ok, 'blank text accepted');
});

await test('request_id must be UUIDv4 and expiry must be whitelisted', async () => {
  assert(!worker.validatePayload(validBody({ request_id: 'not-a-uuid' })).ok, 'bad uuid accepted');
  assert(!worker.validatePayload(validBody({ expiry: '1y' })).ok, 'bad ttl accepted');
  assert(!worker.validatePayload(validBody({ expiry: 'constructor' })).ok, 'prototype key accepted');
  assert(!worker.validatePayload(validBody({ expiry: 'toString' })).ok, 'prototype key accepted');
  for (const expiry of Object.keys(TTL)) {
    const result = worker.validatePayload(validBody({ expiry }));
    assert(result.ok, 'ttl rejected: ' + expiry);
    equal(result.data.ttl, TTL[expiry], 'ttl value ' + expiry);
  }
});

await test('lang is normalized or dropped', async () => {
  const fa = worker.validatePayload(validBody({ lang: 'fa-IR' }));
  equal(fa.data.lang, 'fa-ir', 'lang normalized');
  const bad = worker.validatePayload(validBody({ lang: 'not a lang!' }));
  assert(bad.ok, 'invalid lang should not reject the letter');
  equal(bad.data.lang, null, 'invalid lang dropped');
});

await test('non-string and non-object payloads are rejected', async () => {
  assert(!worker.validatePayload(null).ok, 'null accepted');
  assert(!worker.validatePayload([]).ok, 'array accepted');
  assert(!worker.validatePayload(validBody({ text: 42 })).ok, 'number text accepted');
});

// ---------------------------------------------------------------------------
// HTTP integration checks
// ---------------------------------------------------------------------------

await test('POST /letters creates one letter and one submission', async () => {
  const env = createEnv();
  const ip = nextIp();
  const body = validBody({ text: 'a calm letter about stars', expiry: '24h', lang: 'en' });
  const response = await call(env, '/letters', { method: 'POST', ip, body });

  equal(response.status, 201, 'status');
  assert(/^[0-9a-f]{32}$/.test(response.data.id), 'id is 128-bit hex');
  equal(response.data.expires_at - response.data.created_at, TTL['24h'], 'TTL applied');
  equal(response.data.ok, true, 'ok flag');

  const letters = tableRows(env, 'letters');
  equal(letters.length, 1, 'one letter');
  equal(letters[0].body, 'a calm letter about stars', 'body stored');
  equal(letters[0].lang, 'en', 'lang stored');

  const submissions = tableRows(env, 'letter_submissions');
  equal(submissions.length, 1, 'one submission');
  equal(submissions[0].letter_id, response.data.id, 'submission points at the letter');
  equal(submissions[0].created_at, response.data.created_at, 'created_at recorded');
  assert(/^[0-9a-f]{64}$/.test(submissions[0].sender_hash), 'sender hash is 64 hex');
  equal(tableRows(env, 'letter_senders').length, 0, 'legacy claim ledger untouched');

  const limits = tableRows(env, 'letter_limits');
  equal(limits.length, 1, 'only the global counter row exists');
  equal(limits[0].scope, 'global', 'global scope');
  equal(limits[0].count, 1, 'global counter');
});

await test('identical request_id is idempotent and does not consume quota twice', async () => {
  const env = createEnv();
  const ip = nextIp();
  const body = validBody();
  const first = await call(env, '/letters', { method: 'POST', ip, body });
  equal(first.status, 201, 'first status');

  const retry = await call(env, '/letters', { method: 'POST', ip, body });
  equal(retry.status, 200, 'retry status');
  equal(retry.data.recovered, true, 'recovered flag');
  equal(retry.data.id, first.data.id, 'same id');
  equal(tableRows(env, 'letters').length, 1, 'no duplicate letter');

  const limits = tableRows(env, 'letter_limits');
  equal(limits.find(r => r.scope === 'global').count, 1, 'global count unchanged');
});

await test('uppercase request_id retry resolves to the same letter', async () => {
  const env = createEnv();
  const ip = nextIp();
  const id = randomUUID();
  const first = await call(env, '/letters', { method: 'POST', ip, body: validBody({ request_id: id }) });
  equal(first.status, 201, 'first status');
  const retry = await call(env, '/letters', { method: 'POST', ip, body: validBody({ request_id: id.toUpperCase() }) });
  equal(retry.status, 200, 'retry status');
  equal(retry.data.id, first.data.id, 'same id');
});

await test('two letters per sender in 24h are accepted and the third is limited', async () => {
  const env = createEnv();
  const ip = nextIp();
  const first = await call(env, '/letters', { method: 'POST', ip, body: validBody() });
  equal(first.status, 201, 'first status');
  const second = await call(env, '/letters', { method: 'POST', ip, body: validBody() });
  equal(second.status, 201, 'second status');
  assert(second.data.id !== first.data.id, 'second letter has its own id');

  const third = await call(env, '/letters', { method: 'POST', ip, body: validBody() });
  equal(third.status, 429, 'third status');
  equal(third.data.error, 'rate_limited', 'error');
  assert(Number(third.data.retry_after) > 86000 && Number(third.data.retry_after) <= DAY_SEC,
    'retry_after is the remaining 24h window');
  equal(tableRows(env, 'letters').length, DAILY_LIMIT, 'no third letter');
  equal(tableRows(env, 'letter_submissions').length, DAILY_LIMIT, 'no third submission');
});

await test('the daily window slides: quota returns after 24 hours', async () => {
  const env = createEnv();
  const ip = nextIp();
  equal((await call(env, '/letters', { method: 'POST', ip, body: validBody() })).status, 201, 'first');
  equal((await call(env, '/letters', { method: 'POST', ip, body: validBody() })).status, 201, 'second');
  equal((await call(env, '/letters', { method: 'POST', ip, body: validBody() })).status, 429, 'third limited');

  const now = Math.floor(Date.now() / 1000);
  env.__raw.prepare('UPDATE letter_submissions SET created_at = ?').run(now - DAY_SEC - 1);
  const fourth = await call(env, '/letters', { method: 'POST', ip, body: validBody() });
  equal(fourth.status, 201, 'quota returns after the window passes');
  equal(tableRows(env, 'letters').length, 3, 'three letters stored');
});

await test('a retry of an accepted request_id is recovered even at the daily cap', async () => {
  const env = createEnv();
  const ip = nextIp();
  const firstBody = validBody();
  const first = await call(env, '/letters', { method: 'POST', ip, body: firstBody });
  equal(first.status, 201, 'first');
  equal((await call(env, '/letters', { method: 'POST', ip, body: validBody() })).status, 201, 'second');

  const retry = await call(env, '/letters', { method: 'POST', ip, body: firstBody });
  equal(retry.status, 200, 'retry status');
  equal(retry.data.recovered, true, 'recovered');
  equal(retry.data.id, first.data.id, 'same letter');
  equal(tableRows(env, 'letters').length, 2, 'no extra letter');
});

await test('expired letters are never returned and idempotent retry returns 410', async () => {
  const env = createEnv();
  const ip = nextIp();
  const body = validBody();
  const created = await call(env, '/letters', { method: 'POST', ip, body });
  equal(created.status, 201, 'created');
  env.__raw.prepare('UPDATE letters SET expires_at = created_at - 1').run();

  const list = await call(env, '/letters', { ip });
  equal(list.status, 200, 'list status');
  equal(list.data.letters.length, 0, 'expired letter hidden');
  const count = await call(env, '/letters/count', { ip });
  equal(count.data.active, 0, 'count excludes expired');
  const retry = await call(env, '/letters', { method: 'POST', ip, body });
  equal(retry.status, 410, 'retry after expiry');
  equal(retry.data.error, 'expired', 'expired error');
});

await test('idempotent retry returns 410 when the referenced letter was pruned', async () => {
  const env = createEnv();
  const ip = nextIp();
  const body = validBody();
  const created = await call(env, '/letters', { method: 'POST', ip, body });
  equal(created.status, 201, 'created');
  env.__raw.prepare('DELETE FROM letters WHERE id = ?').run(created.data.id);

  const retry = await call(env, '/letters', { method: 'POST', ip, body });
  equal(retry.status, 410, 'retry after prune');
  equal(retry.data.error, 'expired', 'expired error after prune');
});

await test('GET /letters paginates newest first with a seq cursor', async () => {
  const env = createEnv();
  const now = Math.floor(Date.now() / 1000);
  const insert = env.__raw.prepare(
    'INSERT INTO letters (id, body, lang, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (let i = 1; i <= 3; i++) insert.run('id' + i, 'body ' + i, null, now, now + 3600);

  const page1 = await call(env, '/letters?limit=2', { ip: nextIp() });
  equal(page1.status, 200, 'page 1 status');
  equal(page1.data.letters.length, 2, 'page 1 length');
  equal(page1.data.letters[0].body, 'body 3', 'newest first');
  equal(typeof page1.data.next_before, 'number', 'cursor present');

  const page2 = await call(env, '/letters?limit=2&before=' + page1.data.next_before, { ip: nextIp() });
  equal(page2.status, 200, 'page 2 status');
  equal(page2.data.letters.length, 1, 'page 2 length');
  equal(page2.data.letters[0].body, 'body 1', 'oldest remains');
  equal(page2.data.next_before, null, 'no further cursor');

  const invalid = await call(env, '/letters?before=abc', { ip: nextIp() });
  equal(invalid.status, 400, 'invalid cursor rejected');
});

await test('POST prunes expired letters opportunistically', async () => {
  const env = createEnv();
  const now = Math.floor(Date.now() / 1000);
  env.__raw.prepare(
    'INSERT INTO letters (id, body, lang, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run('expired-id', 'old letter', null, now - 1000, now - 500);

  const response = await call(env, '/letters', { method: 'POST', ip: nextIp(), body: validBody() });
  equal(response.status, 201, 'post status');
  const rows = env.__raw.prepare('SELECT id FROM letters').all();
  assert(!rows.some(r => r.id === 'expired-id'), 'expired row was not pruned');
});

await test('GET /letters and GET /letters/count perform no DB writes', async () => {
  const env = createEnv();
  const now = Math.floor(Date.now() / 1000);
  const insert = env.__raw.prepare(
    'INSERT INTO letters (id, body, lang, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  );
  insert.run('expired-id', 'old letter', null, now - 1000, now - 500);
  insert.run('active-id', 'active letter', null, now - 10, now + 500);

  env.DB.writes = 0;
  const list = await call(env, '/letters', { ip: nextIp() });
  equal(list.status, 200, 'list status');
  equal(env.DB.writes, 0, 'GET /letters wrote to the database');

  const count = await call(env, '/letters/count', { ip: nextIp() });
  equal(count.status, 200, 'count status');
  equal(env.DB.writes, 0, 'GET /letters/count wrote to the database');

  const expired = env.__raw.prepare('SELECT 1 AS present FROM letters WHERE id = ?').get('expired-id');
  assert(expired && expired.present === 1, 'GET pruned or modified the expired row');
  const rows = env.__raw.prepare('SELECT COUNT(*) AS n FROM letters').get();
  equal(rows.n, 2, 'GET changed the row count');
});

await test('global hourly ceiling returns 429 and stores nothing', async () => {
  const env = createEnv();
  const ip = nextIp();
  env.__raw.prepare(
    'INSERT INTO letter_limits (scope, bucket, count) VALUES (?, ?, ?)'
  ).run('global', currentHour(), 500);

  const response = await call(env, '/letters', { method: 'POST', ip, body: validBody() });
  equal(response.status, 429, 'status');
  equal(response.data.error, 'rate_limited', 'error');
  equal(tableRows(env, 'letters').length, 0, 'no letter');
  equal(tableRows(env, 'letter_submissions').length, 0, 'no submission');
});

await test('the daily limit is per sender: another IP is unaffected', async () => {
  const env = createEnv();
  const ipA = nextIp();
  const ipB = nextIp();
  equal((await call(env, '/letters', { method: 'POST', ip: ipA, body: validBody() })).status, 201, 'A first');
  equal((await call(env, '/letters', { method: 'POST', ip: ipA, body: validBody() })).status, 201, 'A second');
  equal((await call(env, '/letters', { method: 'POST', ip: ipA, body: validBody() })).status, 429, 'A limited');
  const b = await call(env, '/letters', { method: 'POST', ip: ipB, body: validBody() });
  equal(b.status, 201, 'B unaffected');
  equal(tableRows(env, 'letter_submissions').length, 3, 'three accepted submissions overall');
});

await test('CORS allows only the production origin and localhost in local-dev', async () => {
  const local = createEnv();
  const preflight = await call(local, '/letters', { method: 'OPTIONS', origin: PROD });
  equal(preflight.status, 204, 'prod preflight');
  equal(preflight.headers.get('access-control-allow-origin'), PROD, 'prod ACAO');

  const evil = await call(local, '/letters', { method: 'OPTIONS', origin: 'https://evil.example' });
  equal(evil.status, 403, 'evil preflight');
  const evilPost = await call(local, '/letters', { method: 'POST', origin: 'https://evil.example', ip: nextIp(), body: validBody() });
  equal(evilPost.status, 403, 'evil post');

  const devPreflight = await call(local, '/letters', { method: 'OPTIONS', origin: 'http://localhost:5173' });
  equal(devPreflight.status, 204, 'localhost preflight in local-dev');

  const prod = createEnv({ ENVIRONMENT: 'production' });
  const prodLocal = await call(prod, '/letters', { method: 'OPTIONS', origin: 'http://localhost:5173' });
  equal(prodLocal.status, 403, 'localhost blocked outside local-dev');
});

await test('requests without Origin still work (non-browser clients)', async () => {
  const env = createEnv();
  const response = await call(env, '/letters/count', { origin: null });
  equal(response.status, 200, 'count status');
  equal(response.data.active, 0, 'active count');
  equal(response.headers.get('cache-control'), 'public, max-age=60', 'count cache header');
});

await test('missing database or salt fails closed in production', async () => {
  const noDb = createEnv();
  delete noDb.DB;
  const r1 = await call(noDb, '/letters', { method: 'POST', ip: nextIp(), body: validBody(), origin: null });
  equal(r1.status, 503, 'missing DB');

  const noSalt = createEnv({ ENVIRONMENT: 'production' });
  delete noSalt.LETTER_SALT;
  const r2 = await call(noSalt, '/letters', { method: 'POST', ip: nextIp(), body: validBody() });
  equal(r2.status, 503, 'missing salt in production');

  const devNoSalt = createEnv();
  delete devNoSalt.LETTER_SALT;
  const r3 = await call(devNoSalt, '/letters', { method: 'POST', ip: nextIp(), body: validBody() });
  equal(r3.status, 201, 'local-dev fallback salt');
});

await test('malformed and oversized bodies are rejected', async () => {
  const env = createEnv();
  const invalid = await call(env, '/letters', { method: 'POST', ip: nextIp(), body: '{not json' });
  equal(invalid.status, 400, 'invalid json');

  const oversized = await call(env, '/letters', {
    method: 'POST', ip: nextIp(), body: validBody({ text: 'x'.repeat(5000) })
  });
  equal(oversized.status, 413, 'oversized body');

  const tooLong = await call(env, '/letters', {
    method: 'POST', ip: nextIp(), body: validBody({ text: 'x'.repeat(501) })
  });
  equal(tooLong.status, 400, '501 codepoints');

  const badRequest = await call(env, '/letters', { method: 'POST', ip: nextIp(), body: validBody({ request_id: 'nope' }) });
  equal(badRequest.status, 400, 'bad request id');
});

await test('unknown routes and wrong methods return 404', async () => {
  const env = createEnv();
  equal((await call(env, '/unknown', { origin: null })).status, 404, 'unknown path');
  equal((await call(env, '/letters', { method: 'DELETE', origin: null })).status, 404, 'wrong method');
});

await test('letter text is stored as inert data, not HTML', async () => {
  const env = createEnv();
  const payload = '<script>alert(1)</script> plain text';
  const created = await call(env, '/letters', { method: 'POST', ip: nextIp(), body: validBody({ text: payload }) });
  equal(created.status, 201, 'created');
  const list = await call(env, '/letters', { ip: nextIp() });
  equal(list.data.letters[0].body, payload, 'text unchanged');
  assert(list.headers.get('content-type').startsWith('application/json'), 'JSON response');
  equal(list.headers.get('x-content-type-options'), 'nosniff', 'nosniff header');
});

await test('no raw IP is stored anywhere; only hashes and text', async () => {
  const env = createEnv();
  const ip = '203.0.113.77';
  const created = await call(env, '/letters', { method: 'POST', ip, body: validBody() });
  equal(created.status, 201, 'created');
  const dump = JSON.stringify([
    tableRows(env, 'letters'),
    tableRows(env, 'letter_senders'),
    tableRows(env, 'letter_submissions'),
    tableRows(env, 'letter_limits')
  ]);
  assert(!dump.includes(ip), 'raw IP found in database');
  assert(!dump.includes('203.0.113'), 'IP prefix found in database');
});

// ---------------------------------------------------------------------------
// Admin API checks
// ---------------------------------------------------------------------------

function adminAuth(secret = TEST_ADMIN_SECRET) {
  return { Authorization: 'Bearer ' + secret };
}

await test('admin endpoints reject missing, wrong, and unset secrets', async () => {
  const env = createEnv();
  equal((await call(env, '/admin/letters', { origin: null })).status, 401, 'missing header');
  equal((await call(env, '/admin/letters', { origin: null, headers: adminAuth('wrong-secret-value') })).status, 403, 'wrong secret');

  const noSecret = createEnv({ ADMIN_SECRET: undefined });
  equal((await call(noSecret, '/admin/letters', { origin: null, headers: adminAuth() })).status, 503, 'unset ADMIN_SECRET fails closed');
});

await test('GET /admin/letters lists every letter, including expired ones', async () => {
  const env = createEnv();
  const now = Math.floor(Date.now() / 1000);
  const insert = env.__raw.prepare(
    'INSERT INTO letters (id, body, lang, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  );
  insert.run('active-1', 'first', 'en', now - 10, now + 500);
  insert.run('active-2', 'second', 'fa', now - 5, now + 500);
  insert.run('expired-1', 'third', null, now - 1000, now - 500);

  const admin = await call(env, '/admin/letters', { origin: null, headers: adminAuth() });
  equal(admin.status, 200, 'status');
  equal(admin.data.ok, true, 'ok');
  equal(admin.data.letters.length, 3, 'expired letter included');
  equal(admin.data.letters[0].id, 'expired-1', 'newest seq first');
  equal(admin.headers.get('cache-control'), 'no-store', 'not cacheable');

  const publicList = await call(env, '/letters', { ip: nextIp() });
  equal(publicList.data.letters.length, 2, 'public feed still hides expired');
});

await test('GET /admin/letters paginates with limit and before', async () => {
  const env = createEnv();
  const now = Math.floor(Date.now() / 1000);
  const insert = env.__raw.prepare(
    'INSERT INTO letters (id, body, lang, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (let i = 1; i <= 3; i++) insert.run('admin-' + i, 'body ' + i, null, now, now + 600);

  const page1 = await call(env, '/admin/letters?limit=2', { origin: null, headers: adminAuth() });
  equal(page1.status, 200, 'page 1');
  equal(page1.data.letters.length, 2, 'page 1 length');
  equal(typeof page1.data.next_before, 'number', 'cursor present');

  const page2 = await call(env, '/admin/letters?limit=2&before=' + page1.data.next_before, {
    origin: null, headers: adminAuth()
  });
  equal(page2.status, 200, 'page 2');
  equal(page2.data.letters.length, 1, 'page 2 length');
  equal(page2.data.next_before, null, 'no further cursor');

  equal((await call(env, '/admin/letters?limit=abc', { origin: null, headers: adminAuth() })).status, 400, 'bad limit');
});

await test('POST /admin/letters/clear resets one IP daily quota without deleting letters', async () => {
  const env = createEnv();
  const ip = nextIp();
  equal((await call(env, '/letters', { method: 'POST', ip, body: validBody() })).status, 201, 'first');
  equal((await call(env, '/letters', { method: 'POST', ip, body: validBody() })).status, 201, 'second');
  equal((await call(env, '/letters', { method: 'POST', ip, body: validBody() })).status, 429, 'limited');

  const cleared = await call(env, '/admin/letters/clear', {
    method: 'POST', origin: null, headers: adminAuth(), body: { ip }
  });
  equal(cleared.status, 200, 'clear status');
  equal(cleared.data.letters_deleted, 0, 'letters kept by default');
  equal(cleared.data.submissions_cleared, 2, 'quota rows reset');
  equal(tableRows(env, 'letters').length, 2, 'letters still stored');
  assert(!JSON.stringify(cleared.data).includes(ip), 'raw IP not returned');

  equal((await call(env, '/letters', { method: 'POST', ip, body: validBody() })).status, 201, 'quota available again');
});

await test('POST /admin/letters/clear with letters:true deletes that IP letters only', async () => {
  const env = createEnv();
  const ipA = nextIp();
  const ipB = nextIp();
  const a = await call(env, '/letters', { method: 'POST', ip: ipA, body: validBody() });
  equal(a.status, 201, 'A letter');
  equal((await call(env, '/letters', { method: 'POST', ip: ipB, body: validBody() })).status, 201, 'B letter');

  const cleared = await call(env, '/admin/letters/clear', {
    method: 'POST', origin: null, headers: adminAuth(), body: { ip: ipA, letters: true }
  });
  equal(cleared.status, 200, 'clear status');
  equal(cleared.data.letters_deleted, 1, 'exactly A letter deleted');
  equal(tableRows(env, 'letters').length, 1, 'B letter survives');
  equal(tableRows(env, 'letter_submissions').length, 1, 'only B submission remains');
});

await test('POST /admin/letters/clear handles legacy 30-day claim rows', async () => {
  const env = createEnv();
  const ip = nextIp();
  const now = Math.floor(Date.now() / 1000);
  const hash = await worker.getSenderHash(makeRequest('/letters', { ip }), TEST_SALT);
  env.__raw.prepare(
    'INSERT INTO letters (id, body, lang, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run('legacy-letter', 'legacy body', null, now, now + 600);
  env.__raw.prepare(
    'INSERT INTO letter_senders (sender_hash, letter_id, request_id, claimed_at, next_allowed_at) VALUES (?, ?, ?, ?, ?)'
  ).run(hash, 'legacy-letter', randomUUID(), now, now + 2592000);

  const cleared = await call(env, '/admin/letters/clear', {
    method: 'POST', origin: null, headers: adminAuth(), body: { ip, letters: true }
  });
  equal(cleared.status, 200, 'status');
  equal(cleared.data.letters_deleted, 1, 'legacy letter deleted');
  equal(cleared.data.legacy_claims_cleared, 1, 'legacy claim deleted');
  equal(tableRows(env, 'letter_senders').length, 0, 'legacy ledger empty');
});

await test('POST /admin/letters/clear validates IP and body', async () => {
  const env = createEnv();
  equal((await call(env, '/admin/letters/clear', {
    method: 'POST', origin: null, headers: adminAuth(), body: { ip: 'not an ip!' }
  })).status, 400, 'invalid ip');
  equal((await call(env, '/admin/letters/clear', {
    method: 'POST', origin: null, headers: adminAuth(), body: {}
  })).status, 400, 'missing ip');
  equal((await call(env, '/admin/letters/clear', {
    method: 'POST', origin: null, headers: adminAuth(), body: ['x']
  })).status, 400, 'array body');
  equal((await call(env, '/admin/letters/clear', {
    method: 'POST', origin: null, headers: adminAuth('nope'), body: { ip: '203.0.113.9' }
  })).status, 403, 'admin auth required');
});

// ---------------------------------------------------------------------------

const failed = results.filter(r => !r.ok);
process.stdout.write('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed\n');
if (failed.length) {
  process.stdout.write('FAILURES:\n');
  for (const failure of failed) process.stdout.write('- ' + failure.name + ': ' + failure.error + '\n');
  process.exitCode = 1;
}
