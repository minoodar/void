// Void Galaxy Music — "Message to God" letters service.
// Deployed as the standalone Worker `void-galaxy-letters`.
//
// Privacy: a raw IP is used only in memory to derive
//   HMAC-SHA-256(LETTER_SALT, "letters:v1|" + ip)
// and is never stored or logged. The domain prefix and a secret separate from
// the visitor counter's SALT keep the two hash spaces independent.
//
// Additive by design: the counter tables (visitors, daily, rate) are untouched.

const PROD_ORIGIN = 'https://minoodar.github.io';
// Phase A design assumption, not a proven production ceiling.
const GLOBAL_HOURLY_LIMIT = 500;
const DAILY_SENDER_LIMIT = 2;
const DAY_SEC = 86400;
// Idempotency is kept for the longest possible letter lifetime (90d).
const SUBMISSION_RETENTION_SEC = 7776000;
const MAX_BODY_BYTES = 4096;
const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;
const PRUNE_PER_RUN = 25;
const DEV_SALT = 'DEV_FALLBACK_SALT_DO_NOT_USE_IN_PROD';

const TTL_MAP = Object.freeze({
  '24h': 86400,
  '7d': 604800,
  '30d': 2592000,
  '90d': 7776000
});

// Reject non-printable controls and bidi embedding/override markers.
const CONTROL_OR_BIDI_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;
// ZWNJ/ZWJ are legitimate Persian and emoji orthography, so the stored body
// keeps them. Only non-orthographic zero-width characters are removed from
// storage; a derived copy with every zero-width character removed is used for
// link detection so they cannot split a URL. Unpaired surrogates are rejected.
const STORAGE_ZERO_WIDTH_REGEX = /[\u200B\u2060\uFEFF]/g;
const DETECTION_ZERO_WIDTH_REGEX = /[\u200B-\u200D\u2060\uFEFF]/g;
const LONE_SURROGATE_REGEX = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const LINK_DETECTOR_REGEX = /(?:https?:\/\/|ftp:\/\/|\/\/|www\.)[^\s/$.?#].[^\s]*|[a-z0-9-]+\.(?:com|org|net|edu|gov|io|co|me|info|biz|dev|app|ai|xyz)\b|\b\d{1,3}(?:\.\d{1,3}){3}\b/i;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsFor(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: cors.allowed ? 204 : 403, headers: cors.headers });
    }

    try {
      if (origin && !cors.allowed) return json({ ok: false, error: 'forbidden' }, 403, cors.headers);
      if (url.pathname === '/letters/count' && request.method === 'GET') {
        return await countLetters(env, cors);
      }
      if (url.pathname === '/letters' && request.method === 'GET') {
        return await listLetters(url, env, cors);
      }
      if (url.pathname === '/letters' && request.method === 'POST') {
        return await createLetter(request, env, cors);
      }
      if (url.pathname === '/admin/letters' && request.method === 'GET') {
        return await adminListLetters(url, env, cors, request);
      }
      if (url.pathname === '/admin/letters/clear' && request.method === 'POST') {
        return await adminClearLetters(request, env, cors);
      }
      return json({ ok: false, error: 'not_found' }, 404, cors.headers);
    } catch (e) {
      return json({ ok: false, error: 'unavailable' }, 503, cors.headers);
    }
  }
};

function isLocalEnv(env) {
  return env.ENVIRONMENT === 'local-dev' || env.ALLOW_LOCAL === '1';
}

function corsFor(origin, env) {
  const local = isLocalEnv(env) && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowed = origin === PROD_ORIGIN || local;
  const headers = { Vary: 'Origin' };
  if (allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return { allowed, headers };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    }, headers)
  });
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

async function hashIp(ip, salt) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(`letters:v1|${ip}`));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function getSenderHash(request, secretSalt) {
  const ip = request.headers.get('cf-connecting-ip') ||
             request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
             '127.0.0.1';
  return await hashIp(ip, secretSalt || DEV_SALT);
}

export function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Invalid JSON body' };
  }

  const { text, expiry, request_id, lang } = payload;

  if (typeof request_id !== 'string' || !UUID_V4_REGEX.test(request_id)) {
    return { ok: false, error: 'Valid UUIDv4 request_id is required' };
  }

  if (typeof expiry !== 'string' || !Object.prototype.hasOwnProperty.call(TTL_MAP, expiry)) {
    return { ok: false, error: 'Invalid expiry duration. Must be 24h, 7d, 30d, or 90d' };
  }

  if (typeof text !== 'string') {
    return { ok: false, error: 'Field "text" must be a string' };
  }

  if (LONE_SURROGATE_REGEX.test(text)) {
    return { ok: false, error: 'Text contains invalid Unicode' };
  }

  if (CONTROL_OR_BIDI_REGEX.test(text)) {
    return { ok: false, error: 'Control characters and bidi overrides are prohibited' };
  }

  // NFC for storage; ZWNJ/ZWJ stay in the body for Persian and emoji.
  const normalized = text.normalize('NFC').replace(STORAGE_ZERO_WIDTH_REGEX, '').trim();
  const storedCount = Array.from(normalized).length;
  // Derived copy for the visible-length floor and link checks: every zero-width
  // character is removed here, so ZWNJ/ZWJ cannot split a URL.
  const detectionText = normalized.replace(DETECTION_ZERO_WIDTH_REGEX, '');
  const visibleCount = Array.from(detectionText).length;

  if (visibleCount < 3) {
    return { ok: false, error: 'Message is too short (min 3 codepoints)' };
  }
  if (storedCount > 500) {
    return { ok: false, error: 'Message exceeds maximum limit of 500 codepoints' };
  }

  // NFKC catches full-width/compatibility obfuscation before link detection.
  const linkProbe = detectionText.normalize('NFKC');
  if (LINK_DETECTOR_REGEX.test(linkProbe)) {
    return { ok: false, error: 'Hyperlinks, domains, and protocol references are prohibited' };
  }

  let validLang = null;
  if (typeof lang === 'string') {
    const cleanLang = lang.trim().toLowerCase();
    if (/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/.test(cleanLang)) validLang = cleanLang;
  }

  return {
    ok: true,
    data: {
      text: normalized,
      ttl: TTL_MAP[expiry],
      requestId: request_id.toLowerCase(),
      lang: validLang
    }
  };
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'payload_too_large' };
  }
  let raw;
  try {
    raw = await request.text();
  } catch (e) {
    return { ok: false, status: 400, error: 'invalid_json' };
  }
  if (raw.length > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'payload_too_large' };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, status: 400, error: 'invalid_json' };
  }
}

function resolveSalt(env) {
  if (env.LETTER_SALT) return env.LETTER_SALT;
  if (isLocalEnv(env)) return DEV_SALT;
  return null;
}

async function findSubmission(env, senderHash, requestId) {
  return await env.DB
    .prepare('SELECT letter_id, created_at FROM letter_submissions WHERE sender_hash = ? AND request_id = ?')
    .bind(senderHash, requestId)
    .first();
}

async function recentSubmissionStats(env, senderHash, now) {
  return await env.DB
    .prepare('SELECT COUNT(*) AS count, MIN(created_at) AS oldest FROM letter_submissions ' +
      'WHERE sender_hash = ? AND created_at > ?')
    .bind(senderHash, now - DAY_SEC)
    .first();
}

function dailyRetryAfter(stats, now) {
  const oldest = Number(stats && stats.oldest) || now;
  return Math.max(1, oldest + DAY_SEC - now);
}

async function adminAuthorized(request, env) {
  const secret = env && env.ADMIN_SECRET;
  if (typeof secret !== 'string' || secret.length < 16) return { ok: false, status: 503 };
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return { ok: false, status: 401 };
  const encoder = new TextEncoder();
  const [given, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(match[1])),
    crypto.subtle.digest('SHA-256', encoder.encode(secret))
  ]);
  const a = new Uint8Array(given);
  const b = new Uint8Array(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? { ok: true } : { ok: false, status: 403 };
}

function adminHeaders(cors) {
  return Object.assign({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, cors.headers);
}

async function findActiveLetterById(env, id, now) {
  return await env.DB
    .prepare('SELECT id, created_at, expires_at FROM letters WHERE id = ? AND expires_at > ?')
    .bind(id, now)
    .first();
}

function recoveredResponse(letter, headers) {
  return json({
    ok: true,
    id: letter.id,
    created_at: Number(letter.created_at),
    expires_at: Number(letter.expires_at),
    recovered: true
  }, 200, headers);
}

async function createLetter(request, env, cors) {
  const headers = Object.assign({ 'Cache-Control': 'no-store' }, cors.headers);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const salt = resolveSalt(env);
  if (!salt) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const body = await readJsonBody(request);
  if (!body.ok) return json({ ok: false, error: body.error }, body.status, headers);

  const validated = validatePayload(body.value);
  if (!validated.ok) return json({ ok: false, error: validated.error }, 400, headers);

  const { text, ttl, requestId, lang } = validated.data;
  const senderHash = await getSenderHash(request, salt);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttl;
  const hour = Math.floor(now / 3600);

  // Idempotent retry: the same sender + request_id always maps to one letter.
  const existing = await findSubmission(env, senderHash, requestId);
  if (existing) {
    const letter = await findActiveLetterById(env, existing.letter_id, now);
    if (letter) return recoveredResponse(letter, headers);
    return json({ ok: false, error: 'expired' }, 410, headers);
  }

  // Sliding 24h per-sender ceiling (2 letters).
  const recent = await recentSubmissionStats(env, senderHash, now);
  if (Number(recent && recent.count) >= DAILY_SENDER_LIMIT) {
    return json({
      ok: false,
      error: 'rate_limited',
      retry_after: dailyRetryAfter(recent, now)
    }, 429, headers);
  }

  // Cheap global pre-check; the guarded increment below is the hard ceiling.
  const globalRow = await env.DB
    .prepare('SELECT count FROM letter_limits WHERE scope = ? AND bucket = ?')
    .bind('global', hour)
    .first();
  if (Number(globalRow && globalRow.count) >= GLOBAL_HOURLY_LIMIT) {
    return json({
      ok: false,
      error: 'rate_limited',
      retry_after: 3600 - (now % 3600)
    }, 429, headers);
  }

  const id = randomId();

  // The count is repeated inside the INSERT so two concurrent requests cannot
  // both slip past the 2-per-24h ceiling; the batch is transactional.
  const claimStmt = env.DB.prepare(
    'INSERT INTO letter_submissions (request_id, sender_hash, letter_id, created_at) ' +
    'SELECT ?, ?, ?, ? ' +
    'WHERE (SELECT COUNT(*) FROM letter_submissions WHERE sender_hash = ? AND created_at > ?) < ? ' +
    'ON CONFLICT(request_id) DO NOTHING'
  ).bind(requestId, senderHash, id, now, senderHash, now - DAY_SEC, DAILY_SENDER_LIMIT);

  const insertStmt = env.DB.prepare(
    'INSERT INTO letters (id, body, lang, created_at, expires_at) ' +
    'SELECT ?, ?, ?, ?, ? ' +
    'WHERE EXISTS (SELECT 1 FROM letter_submissions WHERE sender_hash = ? AND request_id = ? AND letter_id = ?) ' +
    'ON CONFLICT(id) DO NOTHING'
  ).bind(id, text, lang, now, expiresAt, senderHash, requestId, id);

  const bumpGlobal = env.DB.prepare(
    'INSERT INTO letter_limits (scope, bucket, count) VALUES (?, ?, 1) ' +
    'ON CONFLICT(scope, bucket) DO UPDATE SET count = count + 1 WHERE count < ?'
  ).bind('global', hour, GLOBAL_HOURLY_LIMIT);

  const pruneLetters = env.DB.prepare(
    'DELETE FROM letters WHERE seq IN ' +
    '(SELECT seq FROM letters WHERE expires_at < ? ORDER BY expires_at LIMIT ?)'
  ).bind(now, PRUNE_PER_RUN);

  const pruneBuckets = env.DB.prepare('DELETE FROM letter_limits WHERE bucket < ?').bind(hour - 2);

  const pruneSubmissions = env.DB.prepare(
    'DELETE FROM letter_submissions WHERE request_id IN ' +
    '(SELECT request_id FROM letter_submissions WHERE created_at < ? LIMIT ?)'
  ).bind(now - SUBMISSION_RETENTION_SEC, PRUNE_PER_RUN);

  // D1 batch is documented as transactional; the guarded statements use
  // meta.changes so both ceilings still hold if two requests race.
  const results = await env.DB.batch([
    claimStmt, insertStmt, bumpGlobal, pruneLetters, pruneBuckets, pruneSubmissions
  ]);

  const claimChanges = changesOf(results[0]);
  const letterChanges = changesOf(results[1]);
  const globalChanges = changesOf(results[2]);

  if (claimChanges === 0) {
    // Either the same request_id raced ahead of us or the daily ceiling filled.
    const current = await findSubmission(env, senderHash, requestId);
    if (current) {
      const letter = await findActiveLetterById(env, current.letter_id, now);
      if (letter) return recoveredResponse(letter, headers);
      return json({ ok: false, error: 'expired' }, 410, headers);
    }
    const stats = await recentSubmissionStats(env, senderHash, now);
    return json({
      ok: false,
      error: 'rate_limited',
      retry_after: dailyRetryAfter(stats, now)
    }, 429, headers);
  }

  if (letterChanges === 0) {
    return json({ ok: false, error: 'unavailable' }, 503, headers);
  }

  if (globalChanges === 0) {
    // The global ceiling refused this request after the claim was written:
    // remove exactly this submission and letter so no over-limit content survives.
    await env.DB.batch([
      env.DB.prepare(
        'DELETE FROM letters WHERE id = ? AND EXISTS ' +
        '(SELECT 1 FROM letter_submissions WHERE sender_hash = ? AND request_id = ? AND letter_id = ?)'
      ).bind(id, senderHash, requestId, id),
      env.DB.prepare('DELETE FROM letter_submissions WHERE sender_hash = ? AND request_id = ?')
        .bind(senderHash, requestId)
    ]);
    return json({
      ok: false,
      error: 'rate_limited',
      retry_after: 3600 - (now % 3600)
    }, 429, headers);
  }

  return json({
    ok: true,
    id,
    created_at: now,
    expires_at: expiresAt
  }, 201, headers);
}

function changesOf(result) {
  const meta = result && result.meta;
  const changes = meta && meta.changes;
  return changes == null ? 0 : Number(changes);
}

function parseLimit(raw) {
  if (raw === null || raw === '') return DEFAULT_PAGE;
  if (!/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, MAX_PAGE);
}

function parseCursor(raw) {
  if (raw === null || raw === '') return null;
  if (!/^\d+$/.test(raw)) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function listLetters(url, env, cors) {
  const headers = Object.assign({ 'Cache-Control': 'no-store' }, cors.headers);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const limit = parseLimit(url.searchParams.get('limit'));
  const before = parseCursor(url.searchParams.get('before'));
  if (limit === null || before === undefined) {
    return json({ ok: false, error: 'invalid_query' }, 400, headers);
  }

  const now = Math.floor(Date.now() / 1000);
  const result = before === null
    ? await env.DB.prepare(
        'SELECT seq, id, body, lang, created_at, expires_at FROM letters ' +
        'WHERE expires_at > ? ORDER BY seq DESC LIMIT ?'
      ).bind(now, limit).all()
    : await env.DB.prepare(
        'SELECT seq, id, body, lang, created_at, expires_at FROM letters ' +
        'WHERE expires_at > ? AND seq < ? ORDER BY seq DESC LIMIT ?'
      ).bind(now, before, limit).all();

  const letters = (result && result.results) || [];
  const nextBefore = letters.length === limit ? Number(letters[letters.length - 1].seq) : null;

  // Strictly read-only: expired rows are filtered above. Pruning happens only
  // in POST /letters.
  return json({ letters, next_before: nextBefore }, 200, headers);
}

async function countLetters(env, cors) {
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, cors.headers);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB
    .prepare('SELECT COUNT(*) AS active FROM letters WHERE expires_at > ?')
    .bind(now)
    .first();
  return json(
    { active: Number(row && row.active) || 0 },
    200,
    Object.assign({ 'Cache-Control': 'public, max-age=60' }, cors.headers)
  );
}

async function adminListLetters(url, env, cors, request) {
  const headers = adminHeaders(cors);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const auth = await adminAuthorized(request, env);
  if (!auth.ok) {
    return json({ ok: false, error: auth.status === 503 ? 'unavailable' : 'forbidden' }, auth.status, headers);
  }

  const rawLimit = url.searchParams.get('limit');
  let limit = -1; // SQLite: negative LIMIT means no limit.
  if (rawLimit !== null && rawLimit !== '') {
    if (!/^\d+$/.test(rawLimit)) return json({ ok: false, error: 'invalid_query' }, 400, headers);
    const n = parseInt(rawLimit, 10);
    if (!Number.isFinite(n) || n < 1) return json({ ok: false, error: 'invalid_query' }, 400, headers);
    limit = Math.min(n, 1000);
  }
  const before = parseCursor(url.searchParams.get('before'));
  if (before === undefined) return json({ ok: false, error: 'invalid_query' }, 400, headers);

  // Admin sees every row, including expired letters; nothing is pruned here.
  const result = before === null
    ? await env.DB.prepare(
        'SELECT seq, id, body, lang, created_at, expires_at FROM letters ' +
        'ORDER BY seq DESC LIMIT ?'
      ).bind(limit).all()
    : await env.DB.prepare(
        'SELECT seq, id, body, lang, created_at, expires_at FROM letters ' +
        'WHERE seq < ? ORDER BY seq DESC LIMIT ?'
      ).bind(before, limit).all();

  const letters = (result && result.results) || [];
  const nextBefore = limit > 0 && letters.length === limit
    ? Number(letters[letters.length - 1].seq)
    : null;
  return json({ ok: true, letters, next_before: nextBefore }, 200, headers);
}

async function adminClearLetters(request, env, cors) {
  const headers = adminHeaders(cors);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const auth = await adminAuthorized(request, env);
  if (!auth.ok) {
    return json({ ok: false, error: auth.status === 503 ? 'unavailable' : 'forbidden' }, auth.status, headers);
  }

  const salt = resolveSalt(env);
  if (!salt) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const body = await readJsonBody(request);
  if (!body.ok) return json({ ok: false, error: body.error }, body.status, headers);
  const payload = body.value;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ ok: false, error: 'invalid_body' }, 400, headers);
  }

  const ip = typeof payload.ip === 'string' ? payload.ip.trim() : '';
  if (!/^[0-9A-Fa-f:.]{2,64}$/.test(ip)) {
    return json({ ok: false, error: 'invalid_ip' }, 400, headers);
  }

  const includeLetters = payload.letters === true;
  const senderHash = await hashIp(ip, salt);
  const statements = [];

  if (includeLetters) {
    statements.push(env.DB.prepare(
      'DELETE FROM letters WHERE id IN (SELECT letter_id FROM letter_submissions WHERE sender_hash = ?)'
    ).bind(senderHash));
    statements.push(env.DB.prepare(
      'DELETE FROM letters WHERE id IN (SELECT letter_id FROM letter_senders WHERE sender_hash = ?)'
    ).bind(senderHash));
  }
  statements.push(env.DB.prepare('DELETE FROM letter_submissions WHERE sender_hash = ?').bind(senderHash));
  statements.push(env.DB.prepare('DELETE FROM letter_senders WHERE sender_hash = ?').bind(senderHash));
  statements.push(env.DB.prepare('DELETE FROM letter_limits WHERE scope = ?').bind('sender:' + senderHash));

  const results = await env.DB.batch(statements);
  const offset = includeLetters ? 2 : 0;
  const lettersDeleted = includeLetters
    ? changesOf(results[0]) + changesOf(results[1])
    : 0;

  return json({
    ok: true,
    letters_included: includeLetters,
    letters_deleted: lettersDeleted,
    submissions_cleared: changesOf(results[offset]),
    legacy_claims_cleared: changesOf(results[offset + 1]),
    limits_cleared: changesOf(results[offset + 2])
  }, 200, headers);
}
