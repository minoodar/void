// Void Galaxy Music — "Message to God" letters service.
// Deployed as the standalone Worker `void-galaxy-letters`.
//
// Privacy: a raw IP is used only in memory to derive
//   HMAC-SHA-256(LETTER_SALT, "letters:v1|" + ip)   (letter senders)
//   HMAC-SHA-256(LETTER_SALT, "visitors:v1|" + ip)  (visitor counting)
//   HMAC-SHA-256(LETTER_SALT, "votes:v1|" + ip)     (letter votes)
//   HMAC-SHA-256(LETTER_SALT, "admin:v1|" + ip)     (failed admin logins)
// and is never stored or logged. The domain prefix keeps the hash spaces
// independent, so one row can never be matched against another.
//
// The visitor counter lives here too: /visitors/hit and /visitors/stats read the
// visitors/daily/rate tables of this same database (see migrations).

const PROD_ORIGINS = new Set([
  'https://minoodar.github.io',
  'https://void.runs-at.dev'
]);
// Phase A design assumption, not a proven production ceiling.
const GLOBAL_HOURLY_LIMIT = 500;
// Three letters per sender inside a sliding 24h window. Enforced by the guarded
// claim INSERT, not by this number alone; the quota route reports it verbatim.
const DAILY_SENDER_LIMIT = 3;
const DAY_SEC = 86400;
// Idempotency is kept for the longest possible letter lifetime (90d).
const SUBMISSION_RETENTION_SEC = 7776000;
const MAX_BODY_BYTES = 4096;
const MAX_TRACK_BODY_BYTES = 8192;
const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;
const MAX_ADMIN_PAGE = 500;
const MAX_TRACKS = 200;
const PRUNE_PER_RUN = 25;
const VISITOR_HIT_LIMIT = 60;
const VISITOR_WINDOW_SEC = 3600;
// Failed admin logins per IP per hour; a successful login is never counted.
const ADMIN_AUTH_HOURLY_LIMIT = 10;
const DEV_SALT = 'DEV_FALLBACK_SALT_DO_NOT_USE_IN_PROD';
const RESET_CONFIRMATION = 'RESET GALAXY';
const TRACK_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LETTER_SORTS = Object.freeze({
  seq: 'seq',
  created: 'created_at',
  expires: 'expires_at',
  id: 'id'
});

const TTL_MAP = Object.freeze({
  '24h': 86400,
  '7d': 604800,
  '30d': 2592000,
  '90d': 7776000
});

// Symbolic presence is a fixed vocabulary, never free text: only these names
// may reach the database, and anything else reads back as 'none'.
const PRESENCE_VALUES = Object.freeze({
  none: 1,
  human: 1,
  moon: 1,
  root: 1,
  unknown: 1
});

function presenceOf(value) {
  return typeof value === 'string' && PRESENCE_VALUES[value] === 1 ? value : 'none';
}

const VOTE_TYPES = Object.freeze({ like: 1, dislike: 1 });
const VOTE_HOURLY_LIMIT = 30;
// A letter can never outlive 90 days from creation and always keeps a small
// minimum before it fades, no matter how many dislikes arrive.
const MAX_LIFETIME_SEC = 7776000;
const MIN_REMAINING_SEC = 3600;

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
// Public letter ids are 32 lowercase hex characters (see randomId()).
const LETTER_ID_REGEX = /^[0-9a-f]{32}$/;

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
      // Must stay above /letters/:id, or "quota" is read as a letter id.
      if (url.pathname === '/letters/quota' && request.method === 'GET') {
        return await senderQuota(request, env, cors);
      }
      if (url.pathname.startsWith('/letters/') && url.pathname.endsWith('/vote') &&
          ['POST', 'PUT', 'DELETE'].indexOf(request.method) !== -1) {
        const id = url.pathname.slice('/letters/'.length, -'/vote'.length);
        if (request.method === 'POST') return await voteLetter(request, id, env, cors);
        if (request.method === 'PUT') return await putVote(request, id, env, cors);
        return await deleteVote(request, id, env, cors);
      }
      if (url.pathname.startsWith('/letters/') && request.method === 'GET') {
        return await getLetterById(url.pathname.slice('/letters/'.length), env, cors);
      }
      if (url.pathname === '/letters' && request.method === 'GET') {
        return await listLetters(url, env, cors);
      }
      if (url.pathname === '/letters' && request.method === 'POST') {
        return await createLetter(request, env, cors);
      }
      if (url.pathname === '/tracks' && request.method === 'GET') {
        return await listTracks(env, cors, false);
      }
      if (url.pathname === '/site/domain-status' && request.method === 'GET') return await musicDomainStatus(env,cors);
      if (url.pathname === '/tracks/domains' && request.method === 'GET') return await musicDomainTracks(env,cors);
      if (url.pathname === '/visitors/hit' && request.method === 'POST') {
        return await recordVisitorHit(request, env, cors);
      }
      if (url.pathname === '/visitors/stats' && request.method === 'GET') {
        return await visitorStats(env, cors);
      }
      if (url.pathname === '/site/updates' && request.method === 'GET') {
        return await siteUpdates(url, env, cors);
      }

      // One guard for every management route: no handler below can forget auth.
      if (url.pathname.startsWith('/admin/')) {
        const headers = adminHeaders(cors);
        // Before the secret check, so a blocked caller learns nothing about it.
        if (await adminAuthBlocked(request, env)) {
          return json({ ok: false, error: 'rate_limited' }, 429, headers);
        }
        const auth = await adminAuthorized(request, env);
        if (!auth.ok) {
          // Count only a presented-but-wrong credential: 503 is a server fault and a
          // missing header is a probe, not a guess.
          if (auth.status === 403 || (auth.status === 401 && request.headers.get('Authorization'))) await adminAuthFailed(request, env);
          return json({ ok: false, error: auth.status === 503 ? 'unavailable' : 'forbidden' }, auth.status, headers);
        }
        if (url.pathname === '/admin/domain-readiness' && request.method === 'GET') return await adminDomainReadiness(env,cors);
        if (url.pathname === '/admin/domain-tracks' && request.method === 'GET') return await adminDomainTracks(env,cors);
        if (url.pathname === '/admin/domain-audit' && request.method === 'GET') return await adminDomainAudit(env,cors);
        if (url.pathname === '/admin/domain-classifications' && request.method === 'POST') return await adminDomainMutate(request,env,cors);
        if (url.pathname === '/admin/domain-release/accept' && request.method === 'POST') return await adminDomainAccept(request,env,cors);
        if (url.pathname.startsWith('/admin/domain-audit/') && url.pathname.endsWith('/undo') && request.method === 'POST') return await adminDomainUndo(url.pathname.slice('/admin/domain-audit/'.length,-'/undo'.length),env,cors);
        if (url.pathname === '/admin/session' && request.method === 'GET') {
          return json({ ok: true, service: 'void-galaxy-letters' }, 200, headers);
        }
        if (url.pathname === '/admin/letters' && request.method === 'GET') {
          return await adminListLetters(url, env, cors);
        }
        if (url.pathname === '/admin/letters/clear' && request.method === 'POST') {
          return await adminClearLetters(request, env, cors);
        }
        if (url.pathname.startsWith('/admin/letters/') && request.method === 'DELETE') {
          return await adminDeleteLetter(url.pathname.slice('/admin/letters/'.length), env, cors);
        }
        if (url.pathname === '/admin/tracks' && request.method === 'GET') {
          return await listTracks(env, cors, true);
        }
        if (url.pathname === '/admin/tracks' && request.method === 'POST') {
          return await createTrack(request, env, cors);
        }
        if (url.pathname === '/admin/tracks/reorder' && request.method === 'POST') {
          return await reorderTracks(request, env, cors);
        }
        if (url.pathname.startsWith('/admin/tracks/') && (request.method === 'PUT' || request.method === 'DELETE')) {
          return await mutateTrack(url.pathname.slice('/admin/tracks/'.length), request, env, cors);
        }
        return json({ ok: false, error: 'not_found' }, 404, headers);
      }
      return json({ ok: false, error: 'not_found' }, 404, cors.headers);
    } catch (e) {
      logUnhandled(request, url, e);
      return json({ ok: false, error: 'unavailable' }, 503, cors.headers);
    }
  }
};

// Logs only the method, a route label, and the error name/message. Never the
// request body, letter text, IP, hashes, or secrets; ids are masked.
function logUnhandled(request, url, e) {
  try {
    const route = url.pathname.replace(/[0-9a-f]{32}/gi, ':id').slice(0, 80);
    const name = e && e.name ? String(e.name) : 'Error';
    const message = e && e.message ? String(e.message).slice(0, 300) : '';
    console.error('unhandled_error', request.method, route, name, message);
  } catch (_) { /* logging must never break the response */ }
}

function isLocalEnv(env) {
  return env.ENVIRONMENT === 'local-dev' || env.ALLOW_LOCAL === '1';
}

function corsFor(origin, env) {
  const local = isLocalEnv(env) && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowed = PROD_ORIGINS.has(origin) || local;
  const headers = { Vary: 'Origin' };
  if (allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
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

async function hashIp(ip, salt, scope) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(`${scope || 'letters'}:v1|${ip}`));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') ||
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         '127.0.0.1';
}

export async function getSenderHash(request, secretSalt) {
  return await hashIp(clientIp(request), secretSalt || DEV_SALT);
}

export function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Invalid JSON body' };
  }

  const { text, expiry, request_id, lang, secret_ink, presence } = payload;

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

  // Missing presence is how older clients submit: a normal, unmarked letter.
  // A present value outside the five names — null, empty or whitespace-padded
  // strings, wrong casing, unknown names, or non-strings — is rejected.
  let validPresence = 'none';
  if (presence !== undefined) {
    if (typeof presence !== 'string' || PRESENCE_VALUES[presence] !== 1) {
      return { ok: false, error: 'invalid_presence' };
    }
    validPresence = presence;
  }

  return {
    ok: true,
    data: {
      text: normalized,
      ttl: TTL_MAP[expiry],
      requestId: request_id.toLowerCase(),
      lang: validLang,
      // Strict boolean: anything else (including a missing field, which is how
      // older clients submit) is a normal, fully visible letter.
      secretInk: secret_ink === true,
      presence: validPresence
    }
  };
}

async function readJsonBody(request, maxBytes) {
  const max = maxBytes || MAX_BODY_BYTES;
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > max) {
    return { ok: false, status: 413, error: 'payload_too_large' };
  }
  let raw;
  try {
    raw = await request.text();
  } catch (e) {
    return { ok: false, status: 400, error: 'invalid_json' };
  }
  // raw.length is UTF-16 code units, not bytes: Persian and emoji doubled the cap.
  if (new TextEncoder().encode(raw).length > max) {
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

// IPv6 subscribers rotate the low 64 bits (RFC 4941), so a per-address counter
// resets for free. Hash the /64 prefix; IPv4 stays per-address.
function adminIpKey(raw) {
  let ip = String(raw).trim().toLowerCase();
  const close = ip.indexOf(']');
  if (ip[0] === '[' && close !== -1) ip = ip.slice(1, close);
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.indexOf(':') === -1) return ip;
  const dbl = ip.indexOf('::');
  const groups = s => (s ? s.split(':').filter(Boolean) : []);
  const head = groups(dbl === -1 ? ip : ip.slice(0, dbl));
  const tail = groups(dbl === -1 ? '' : ip.slice(dbl + 2));
  const parts = tail.length ? tail : head;
  const last = parts[parts.length - 1] || '';
  if (last.indexOf('.') !== -1) {
    const o = last.split('.').map(Number);
    if (o.length !== 4 || o.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return ip;
    parts.splice(parts.length - 1, 1, ((o[0] << 8) | o[1]).toString(16), ((o[2] << 8) | o[3]).toString(16));
  }
  const fill = 8 - head.length - tail.length;
  if (dbl === -1 ? head.length !== 8 : fill < 1) return ip;
  const all = head.concat(new Array(fill).fill('0'), tail);
  if (all.slice(0, 5).every(g => g === '0') && all[5] === 'ffff') {
    const n = all.slice(6).map(g => parseInt(g, 16));
    return [(n[0] >> 8) & 255, n[0] & 255, (n[1] >> 8) & 255, n[1] & 255].join('.');
  }
  return all.slice(0, 4).map(g => g.padStart(4, '0')).join(':') + '::/64';
}

// Reuses letter_limits with hourly buckets, so pruneBuckets already collects
// these rows and no schema change is needed. Only the HMAC of the IP is stored.
async function adminAuthScope(request, env) {
  if (!env || !env.DB) return null;
  const salt = resolveSalt(env);
  if (!salt) return null;
  return 'admin:' + await hashIp(adminIpKey(clientIp(request)), salt, 'admin');
}

// Fail-open: an unreadable counter must never lock the owner out of the dashboard.
async function adminAuthBlocked(request, env) {
  try {
    const scope = await adminAuthScope(request, env);
    if (!scope) return false;
    const now = Math.floor(Date.now() / 1000);
    const row = await env.DB
      .prepare('SELECT count FROM letter_limits WHERE scope = ? AND bucket = ?')
      .bind(scope, Math.floor(now / 3600))
      .first();
    return Number(row && row.count) >= ADMIN_AUTH_HOURLY_LIMIT;
  } catch (e) {
    return false;
  }
}

async function adminAuthFailed(request, env) {
  try {
    const scope = await adminAuthScope(request, env);
    if (!scope) return;
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      'INSERT INTO letter_limits (scope, bucket, count) VALUES (?, ?, 1) ' +
      'ON CONFLICT(scope, bucket) DO UPDATE SET count = count + 1 WHERE count < ?'
    ).bind(scope, Math.floor(now / 3600), ADMIN_AUTH_HOURLY_LIMIT).run();
  } catch (e) {
    // A counter write must never turn a login attempt into a 503.
  }
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
    .prepare('SELECT id, created_at, expires_at, secret_ink, presence FROM letters WHERE id = ? AND expires_at > ?')
    .bind(id, now)
    .first();
}

function recoveredResponse(letter, headers) {
  return json({
    ok: true,
    id: letter.id,
    created_at: Number(letter.created_at),
    expires_at: Number(letter.expires_at),
    secret_ink: Number(letter.secret_ink) === 1,
    presence: presenceOf(letter.presence),
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

  const { text, ttl, requestId, lang, secretInk, presence } = validated.data;
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

  // Sliding 24h per-sender ceiling (DAILY_SENDER_LIMIT letters).
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
  // both slip past the per-sender ceiling; the batch is transactional.
  const claimStmt = env.DB.prepare(
    'INSERT INTO letter_submissions (request_id, sender_hash, letter_id, created_at) ' +
    'SELECT ?, ?, ?, ? ' +
    'WHERE (SELECT COUNT(*) FROM letter_submissions WHERE sender_hash = ? AND created_at > ?) < ? ' +
    'ON CONFLICT(request_id) DO NOTHING'
  ).bind(requestId, senderHash, id, now, senderHash, now - DAY_SEC, DAILY_SENDER_LIMIT);

  const insertStmt = env.DB.prepare(
    'INSERT INTO letters (id, body, lang, created_at, expires_at, base_expires_at, base_votes_net, secret_ink, presence) ' +
    'SELECT ?, ?, ?, ?, ?, ?, 0, ?, ? ' +
    'WHERE EXISTS (SELECT 1 FROM letter_submissions WHERE sender_hash = ? AND request_id = ? AND letter_id = ?) ' +
    'ON CONFLICT(id) DO NOTHING'
  ).bind(
    id, text, lang, now, expiresAt, expiresAt, secretInk ? 1 : 0,
    presence === 'none' ? null : presence,
    senderHash, requestId, id
  );

  const bumpGlobal = env.DB.prepare(
    'INSERT INTO letter_limits (scope, bucket, count) VALUES (?, ?, 1) ' +
    'ON CONFLICT(scope, bucket) DO UPDATE SET count = count + 1 WHERE count < ?'
  ).bind('global', hour, GLOBAL_HOURLY_LIMIT);

  // Votes go before their letters: the subquery must still see the expired
  // rows, which pruneLetters removes later in the same batch.
  const pruneVotes = env.DB.prepare(
    'DELETE FROM letter_votes WHERE letter_id IN ' +
    '(SELECT id FROM letters WHERE expires_at < ? LIMIT ?)'
  ).bind(now, PRUNE_PER_RUN);

  const pruneLetters = env.DB.prepare(
    'DELETE FROM letters WHERE seq IN ' +
    '(SELECT seq FROM letters WHERE expires_at < ? ORDER BY expires_at LIMIT ?)'
  ).bind(now, PRUNE_PER_RUN);

  const pruneBuckets = env.DB.prepare('DELETE FROM letter_limits WHERE bucket < ?').bind(hour - 2);

  const pruneVoteRate = env.DB.prepare('DELETE FROM letter_vote_rate_v2 WHERE bucket < ?').bind(hour - 2);

  const pruneSubmissions = env.DB.prepare(
    'DELETE FROM letter_submissions WHERE request_id IN ' +
    '(SELECT request_id FROM letter_submissions WHERE created_at < ? LIMIT ?)'
  ).bind(now - SUBMISSION_RETENTION_SEC, PRUNE_PER_RUN);

  // D1 batch is documented as transactional; the guarded statements use
  // meta.changes so both ceilings still hold if two requests race.
  const results = await env.DB.batch([
    claimStmt, insertStmt, bumpGlobal, pruneVotes, pruneLetters, pruneBuckets,
    pruneVoteRate, pruneSubmissions
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
    console.error('letter_insert_no_rows');
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
    expires_at: expiresAt,
    secret_ink: secretInk,
    presence
  }, 201, headers);
}

function changesOf(result) {
  const meta = result && result.meta;
  const changes = meta && meta.changes;
  return changes == null ? 0 : Number(changes);
}

/* ---------------------------------------------------------------- */
/* Votes and dynamic lifespan                                        */
/* ---------------------------------------------------------------- */

// Counts are always derived from letter_votes, so there is no separate tally
// that a crash or a race could desynchronise.
async function letterVoteState(env, id, now) {
  return await env.DB.prepare(
    'SELECT l.id, l.created_at, l.expires_at, ' +
    "(SELECT COUNT(*) FROM letter_votes v WHERE v.letter_id = l.id AND v.vote_type = 'like') AS votes_like, " +
    "(SELECT COUNT(*) FROM letter_votes v WHERE v.letter_id = l.id AND v.vote_type = 'dislike') AS votes_dislike " +
    'FROM letters l WHERE l.id = ? AND l.expires_at > ?'
  ).bind(id, now).first();
}

function votePayload(letter, now) {
  const expiresAt = Number(letter.expires_at);
  return {
    expires_at: expiresAt,
    remaining_seconds: Math.max(0, expiresAt - now),
    votes_like: Number(letter.votes_like) || 0,
    votes_dislike: Number(letter.votes_dislike) || 0
  };
}

function alreadyVotedResponse(letter, voteType, now, headers) {
  return json(Object.assign({
    ok: false,
    error: 'already_voted',
    type: voteType
  }, votePayload(letter, now)), 409, headers);
}

function voteRateLimited(now, headers) {
  return json({
    ok: false,
    error: 'rate_limited',
    retry_after: 3600 - (now % 3600)
  }, 429, headers);
}

const PRUNE_VOTES_SQL =
  'DELETE FROM letter_votes WHERE letter_id IN (SELECT id FROM letters WHERE expires_at < ?)';

function lifespanStmt(env, id, now) {
  return env.DB.prepare(
    'UPDATE letters SET expires_at = MIN(created_at + ?, ' +
    'MAX(? + ?, COALESCE(base_expires_at, expires_at) + ? * (' +
    "(SELECT COUNT(*) FROM letter_votes WHERE letter_id = ? AND vote_type = 'like') - " +
    "(SELECT COUNT(*) FROM letter_votes WHERE letter_id = ? AND vote_type = 'dislike') - " +
    'COALESCE(base_votes_net, 0)))) ' +
    'WHERE id = ? AND expires_at > ?'
  ).bind(MAX_LIFETIME_SEC, now, MIN_REMAINING_SEC, DAY_SEC, id, id, id, now);
}

async function voteContext(request, rawId, env, cors, needsBody) {
  const headers = Object.assign({ 'Cache-Control': 'no-store' }, cors.headers);
  if (!env || !env.DB) return { err: json({ ok: false, error: 'unavailable' }, 503, headers) };
  if (!LETTER_ID_REGEX.test(rawId)) return { err: json({ ok: false, error: 'not_found' }, 404, headers) };
  const salt = resolveSalt(env);
  if (!salt) return { err: json({ ok: false, error: 'unavailable' }, 503, headers) };
  let type = null;
  if (needsBody) {
    const body = await readJsonBody(request, 256);
    if (!body.ok) return { err: json({ ok: false, error: body.error }, body.status, headers) };
    type = body.value && body.value.type;
    if (!Object.prototype.hasOwnProperty.call(VOTE_TYPES, type)) {
      return { err: json({ ok: false, error: 'invalid_vote' }, 400, headers) };
    }
  }
  const voterHash = await hashIp(clientIp(request), salt, 'votes');
  const now = Math.floor(Date.now() / 1000);
  return { headers, type, voterHash, now, hour: Math.floor(now / 3600) };
}

async function bumpVoteRate(env, voterHash, hour) {
  const result = await env.DB.prepare(
    'INSERT INTO letter_vote_rate_v2 (voter_hash, bucket, count) VALUES (?, ?, 1) ' +
    'ON CONFLICT(voter_hash, bucket) DO UPDATE SET count = count + 1 WHERE count < ?'
  ).bind(voterHash, hour, VOTE_HOURLY_LIMIT).run();
  return changesOf(result) > 0;
}

async function storedVote(env, id, voterHash) {
  const row = await env.DB.prepare(
    'SELECT vote_type FROM letter_votes WHERE letter_id = ? AND voter_hash = ?'
  ).bind(id, voterHash).first();
  return row && (row.vote_type === 'like' || row.vote_type === 'dislike') ? row.vote_type : null;
}

function voteSuccess(id, type, changed, capped, letter, now, headers) {
  return json(Object.assign({
    ok: true,
    id,
    type,
    changed: !!changed,
    capped: !!capped
  }, votePayload(letter, now)), 200, headers);
}

async function putVote(request, rawId, env, cors) {
  const context = await voteContext(request, rawId, env, cors, true);
  if (context.err) return context.err;
  const { headers, type, voterHash, now, hour } = context;
  const letter = await letterVoteState(env, rawId, now);
  if (!letter) return json({ ok: false, error: 'not_found' }, 404, headers);

  const existing = await storedVote(env, rawId, voterHash);
  if (existing === type) return voteSuccess(rawId, type, false, false, letter, now, headers);
  if (!(await bumpVoteRate(env, voterHash, hour))) return voteRateLimited(now, headers);

  const results = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO letter_votes (letter_id, voter_hash, vote_type, created_at) ' +
      'SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM letters WHERE id = ? AND expires_at > ?) ' +
      'ON CONFLICT(letter_id, voter_hash) DO UPDATE SET ' +
      'vote_type = excluded.vote_type, created_at = excluded.created_at'
    ).bind(rawId, voterHash, type, now, rawId, now),
    lifespanStmt(env, rawId, now),
    env.DB.prepare(PRUNE_VOTES_SQL).bind(now),
    env.DB.prepare('DELETE FROM letter_vote_rate_v2 WHERE bucket < ?').bind(hour - 2)
  ]);
  const final = await letterVoteState(env, rawId, now);
  if (!final) return json({ ok: false, error: 'not_found' }, 404, headers);
  const finalType = await storedVote(env, rawId, voterHash);
  const capped = finalType === 'like'
    ? Number(final.expires_at) >= Number(final.created_at) + MAX_LIFETIME_SEC
    : finalType === 'dislike' && Number(final.expires_at) <= now + MIN_REMAINING_SEC;
  return voteSuccess(rawId, finalType, changesOf(results[0]) > 0, capped, final, now, headers);
}

async function deleteVote(request, rawId, env, cors) {
  const context = await voteContext(request, rawId, env, cors, false);
  if (context.err) return context.err;
  const { headers, voterHash, now, hour } = context;
  const letter = await letterVoteState(env, rawId, now);
  if (!letter) return json({ ok: false, error: 'not_found' }, 404, headers);

  const existing = await storedVote(env, rawId, voterHash);
  if (!existing) return voteSuccess(rawId, null, false, false, letter, now, headers);
  if (!(await bumpVoteRate(env, voterHash, hour))) return voteRateLimited(now, headers);

  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM letter_votes WHERE letter_id = ? AND voter_hash = ?')
      .bind(rawId, voterHash),
    lifespanStmt(env, rawId, now),
    env.DB.prepare(PRUNE_VOTES_SQL).bind(now),
    env.DB.prepare('DELETE FROM letter_vote_rate_v2 WHERE bucket < ?').bind(hour - 2)
  ]);
  const final = await letterVoteState(env, rawId, now);
  if (!final) return json({ ok: false, error: 'not_found' }, 404, headers);
  const finalType = await storedVote(env, rawId, voterHash);
  const capped = finalType === 'like'
    ? Number(final.expires_at) >= Number(final.created_at) + MAX_LIFETIME_SEC
    : finalType === 'dislike' && Number(final.expires_at) <= now + MIN_REMAINING_SEC;
  return voteSuccess(rawId, finalType, changesOf(results[0]) > 0, capped, final, now, headers);
}

// POST /letters/:id/vote  { "type": "like" | "dislike" }
// A like adds 24h, a dislike removes 24h. One immutable vote per hashed
// visitor per letter; the update and the vote row commit in one batch.
async function voteLetter(request, rawId, env, cors) {
  const headers = Object.assign({ 'Cache-Control': 'no-store' }, cors.headers);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);
  if (!LETTER_ID_REGEX.test(rawId)) return json({ ok: false, error: 'not_found' }, 404, headers);

  const salt = resolveSalt(env);
  if (!salt) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const body = await readJsonBody(request, 256);
  if (!body.ok) return json({ ok: false, error: body.error }, body.status, headers);
  const type = body.value && body.value.type;
  if (!Object.prototype.hasOwnProperty.call(VOTE_TYPES, type)) {
    return json({ ok: false, error: 'invalid_vote' }, 400, headers);
  }

  const voterHash = await hashIp(clientIp(request), salt, 'votes');
  const now = Math.floor(Date.now() / 1000);
  const hour = Math.floor(now / 3600);

  const letter = await letterVoteState(env, rawId, now);
  if (!letter) return json({ ok: false, error: 'not_found' }, 404, headers);

  const existing = await env.DB
    .prepare('SELECT vote_type FROM letter_votes WHERE letter_id = ? AND voter_hash = ?')
    .bind(rawId, voterHash)
    .first();
  if (existing) return alreadyVotedResponse(letter, existing.vote_type, now, headers);

  const rate = await env.DB
    .prepare('SELECT count FROM letter_vote_rate_v2 WHERE voter_hash = ? AND bucket = ?')
    .bind(voterHash, hour)
    .first();
  if (Number(rate && rate.count) >= VOTE_HOURLY_LIMIT) return voteRateLimited(now, headers);

  // The guarded increment is the hard ceiling if two requests race.
  const bumpRate = await env.DB.prepare(
    'INSERT INTO letter_vote_rate_v2 (voter_hash, bucket, count) VALUES (?, ?, 1) ' +
    'ON CONFLICT(voter_hash, bucket) DO UPDATE SET count = count + 1 WHERE count < ?'
  ).bind(voterHash, hour, VOTE_HOURLY_LIMIT).run();
  if (changesOf(bumpRate) === 0) return voteRateLimited(now, headers);

  const insertVote = env.DB.prepare(
    'INSERT INTO letter_votes (letter_id, voter_hash, vote_type, created_at) ' +
    'SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM letters WHERE id = ? AND expires_at > ?) ' +
    'ON CONFLICT(letter_id, voter_hash) DO NOTHING'
  ).bind(rawId, voterHash, type, now, rawId, now);

  // The ±24h shift is applied by letter_votes_apply_lifespan (see the
  // original schema trigger for old deployments. The explicit recomputation
  // keeps the legacy POST endpoint correct after that trigger is removed.
  const results = await env.DB.batch([
    insertVote,
    lifespanStmt(env, rawId, now),
    env.DB.prepare(
      'DELETE FROM letter_votes WHERE letter_id IN (SELECT id FROM letters WHERE expires_at < ?)'
    ).bind(now),
    env.DB.prepare('DELETE FROM letter_vote_rate_v2 WHERE bucket < ?').bind(hour - 2)
  ]);

  if (changesOf(results[0]) === 0) {
    // Lost a race with another tab, or the letter faded between the reads.
    const current = await letterVoteState(env, rawId, now);
    if (!current) return json({ ok: false, error: 'not_found' }, 404, headers);
    const raced = await env.DB
      .prepare('SELECT vote_type FROM letter_votes WHERE letter_id = ? AND voter_hash = ?')
      .bind(rawId, voterHash)
      .first();
    return alreadyVotedResponse(current, raced ? raced.vote_type : type, now, headers);
  }

  const final = await letterVoteState(env, rawId, now);
  if (!final) return json({ ok: false, error: 'not_found' }, 404, headers);

  const capped = type === 'like'
    ? Number(final.expires_at) >= Number(final.created_at) + MAX_LIFETIME_SEC
    : Number(final.expires_at) <= now + MIN_REMAINING_SEC;

  return json(Object.assign({
    ok: true,
    id: rawId,
    type,
    capped
  }, votePayload(final, now)), 200, headers);
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
  const columns =
    'SELECT l.seq, l.id, l.body, l.lang, l.secret_ink, l.presence, l.created_at, l.expires_at, ' +
    "(SELECT COUNT(*) FROM letter_votes v WHERE v.letter_id = l.id AND v.vote_type = 'like') AS votes_like, " +
    "(SELECT COUNT(*) FROM letter_votes v WHERE v.letter_id = l.id AND v.vote_type = 'dislike') AS votes_dislike " +
    'FROM letters l ';
  const result = before === null
    ? await env.DB.prepare(
        columns + 'WHERE l.expires_at > ? ORDER BY l.seq DESC LIMIT ?'
      ).bind(now, limit).all()
    : await env.DB.prepare(
        columns + 'WHERE l.expires_at > ? AND l.seq < ? ORDER BY l.seq DESC LIMIT ?'
      ).bind(now, before, limit).all();

  const letters = ((result && result.results) || []).map(function (row) {
    return Object.assign({}, row, {
      secret_ink: Number(row.secret_ink) === 1,
      presence: presenceOf(row.presence)
    });
  });
  const nextBefore = letters.length === limit ? Number(letters[letters.length - 1].seq) : null;

  // Strictly read-only: expired rows are filtered above. Pruning happens only
  // in POST /letters.
  return json({ letters, next_before: nextBefore }, 200, headers);
}

// Public single-letter route behind share links (?letter=<id>). Read-only like
// the feed: expired and unknown ids are the same 404, and the id must match our
// 32-hex format so arbitrary strings never reach the database.
async function getLetterById(rawId, env, cors) {
  const headers = Object.assign({ 'Cache-Control': 'public, max-age=30' }, cors.headers);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);
  if (!LETTER_ID_REGEX.test(rawId)) return json({ ok: false, error: 'not_found' }, 404, headers);

  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB
    .prepare(
      'SELECT l.id, l.body AS text, l.lang, l.secret_ink, l.presence, l.created_at, l.expires_at, ' +
      "(SELECT COUNT(*) FROM letter_votes v WHERE v.letter_id = l.id AND v.vote_type = 'like') AS votes_like, " +
      "(SELECT COUNT(*) FROM letter_votes v WHERE v.letter_id = l.id AND v.vote_type = 'dislike') AS votes_dislike " +
      'FROM letters l WHERE l.id = ? AND l.expires_at > ?'
    )
    .bind(rawId, now)
    .first();
  if (!row) return json({ ok: false, error: 'not_found' }, 404, headers);
  return json({
    id: row.id,
    text: row.text,
    created_at: Number(row.created_at),
    expires_at: Number(row.expires_at),
    lang: row.lang || null,
    secret_ink: Number(row.secret_ink) === 1,
    presence: presenceOf(row.presence),
    votes_like: Number(row.votes_like) || 0,
    votes_dislike: Number(row.votes_dislike) || 0
  }, 200, headers);
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
    Object.assign({ 'Cache-Control': 'no-store' }, cors.headers)
  );
}

/* The sender's own remaining capacity, derived from the same HMAC identity and
   the same sliding window the submit path enforces. It is per-IP by design, so
   it must never be cached by a shared proxy; the response carries no hash. */
async function senderQuota(request, env, cors) {
  const headers = Object.assign({ 'Cache-Control': 'no-store' }, cors.headers);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);
  const salt = resolveSalt(env);
  if (!salt) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const senderHash = await getSenderHash(request, salt);
  const now = Math.floor(Date.now() / 1000);
  const stats = await recentSubmissionStats(env, senderHash, now);
  const used = Math.min(DAILY_SENDER_LIMIT, Math.max(0, Number(stats && stats.count) || 0));
  const remaining = DAILY_SENDER_LIMIT - used;
  return json({
    ok: true,
    limit: DAILY_SENDER_LIMIT,
    used,
    remaining,
    window_seconds: DAY_SEC,
    retry_after: remaining === 0 ? dailyRetryAfter(stats, now) : 0,
    server_now: now
  }, 200, headers);
}

/* Visitor counting. Same contract the retired void-galaxy-counter served, but
   stored in this database so one Worker owns every number. The client sends one
   hit per browser session; `returning` only labels the reply, because the
   database already knows whether this hash was seen before. */
async function recordVisitorHit(request, env, cors) {
  const headers = Object.assign({ 'Cache-Control': 'no-store' }, cors.headers);
  const ua = request.headers.get('user-agent') || '';
  // Link previews, crawlers and headless probes must not move the number.
  if (!ua || /bot|crawler|spider|headless/i.test(ua)) {
    return new Response(null, { status: 204, headers });
  }
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);
  const salt = resolveSalt(env);
  if (!salt) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const visitorHash = await hashIp(clientIp(request), salt, 'visitors');

  let body = null;
  try { body = await request.json(); } catch (e) {}
  const returning = !!(body && body.returning);

  const now = Math.floor(Date.now() / 1000);
  const hour = Math.floor(now / VISITOR_WINDOW_SEC);
  const day = new Date(now * 1000).toISOString().slice(0, 10);

  const rate = await env.DB
    .prepare('SELECT count FROM rate WHERE ip_hash = ? AND hour = ?')
    .bind(visitorHash, hour)
    .first();
  if (rate && Number(rate.count) >= VISITOR_HIT_LIMIT) {
    return json({ ok: false, error: 'rate_limited' }, 429, headers);
  }

  const existing = await env.DB
    .prepare('SELECT 1 FROM visitors WHERE ip_hash = ?')
    .bind(visitorHash)
    .first();

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO visitors (ip_hash, hits, sessions, first_seen, last_seen) VALUES (?, 1, 1, ?, ?) ' +
      'ON CONFLICT(ip_hash) DO UPDATE SET hits = hits + 1, sessions = sessions + 1, last_seen = excluded.last_seen'
    ).bind(visitorHash, now, now),
    env.DB.prepare(
      'INSERT INTO daily (day, unique_new, sessions) VALUES (?, ?, 1) ' +
      'ON CONFLICT(day) DO UPDATE SET unique_new = unique_new + excluded.unique_new, sessions = sessions + 1'
    ).bind(day, existing ? 0 : 1),
    env.DB.prepare(
      'INSERT INTO rate (ip_hash, hour, count) VALUES (?, ?, 1) ' +
      'ON CONFLICT(ip_hash, hour) DO UPDATE SET count = count + 1'
    ).bind(visitorHash, hour),
    // Two hours of rate rows are enough to enforce a sliding window.
    env.DB.prepare('DELETE FROM rate WHERE hour < ?').bind(hour - 2)
  ]);

  return json({ ok: true, returning }, 200, headers);
}

async function visitorStats(env, cors) {
  const headers = Object.assign({ 'Cache-Control': 'no-store' }, cors.headers);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);
  const rows = await env.DB.batch([
    env.DB.prepare(
      'SELECT COUNT(*) AS u, COALESCE(SUM(sessions), 0) AS s, ' +
      'COALESCE(SUM(CASE WHEN sessions > 1 THEN 1 ELSE 0 END), 0) AS r FROM visitors'
    )
  ]);
  const first = (rows[0] && rows[0].results && rows[0].results[0]) || {};
  const unique = Number(first.u) || 0;
  const sessions = Number(first.s) || 0;
  const returning = Number(first.r) || 0;
  return json({
    ok: true,
    unique_visitors: unique,
    total_sessions: sessions,
    returning_ratio: unique ? returning / unique : 0
  }, 200, headers);
}

// One foreground refresh for the public UI: active letter count, visitor
// totals, and letters newer than the client's sequence cursor. No schema or
// write is involved; the endpoint is deliberately not cacheable.
async function siteUpdates(url, env, cors) {
  const headers = Object.assign({ 'Cache-Control': 'no-store' }, cors.headers);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const after = parseCursor(url.searchParams.get('after'));
  const limit = parseLimit(url.searchParams.get('limit'));
  if (after === undefined || limit === null || url.searchParams.has('before')) {
    return json({ ok: false, error: 'invalid_query' }, 400, headers);
  }

  const now = Math.floor(Date.now() / 1000);
  const letterColumns =
    'SELECT l.seq, l.id, l.body, l.lang, l.secret_ink, l.presence, l.created_at, l.expires_at, ' +
    "(SELECT COUNT(*) FROM letter_votes v WHERE v.letter_id = l.id AND v.vote_type = 'like') AS votes_like, " +
    "(SELECT COUNT(*) FROM letter_votes v WHERE v.letter_id = l.id AND v.vote_type = 'dislike') AS votes_dislike " +
    'FROM letters l ';
  const lettersStmt = after === null
    ? env.DB.prepare(letterColumns + 'WHERE l.expires_at > ? ORDER BY l.seq DESC LIMIT ?').bind(now, limit)
    : env.DB.prepare(letterColumns + 'WHERE l.seq > ? AND l.expires_at > ? ORDER BY l.seq ASC LIMIT ?').bind(after, now, limit);

  const rows = await env.DB.batch([
    lettersStmt,
    env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS latest_seq FROM letters'),
    env.DB.prepare('SELECT COUNT(*) AS active FROM letters WHERE expires_at > ?').bind(now),
    env.DB.prepare(
      'SELECT COUNT(*) AS u, COALESCE(SUM(sessions), 0) AS s, ' +
      'COALESCE(SUM(CASE WHEN sessions > 1 THEN 1 ELSE 0 END), 0) AS r FROM visitors'
    )
  ]);
  const letters = ((rows[0] && rows[0].results) || []).map(function (row) {
    return Object.assign({}, row, {
      secret_ink: Number(row.secret_ink) === 1,
      presence: presenceOf(row.presence)
    });
  });
  const latestSeq = Number(rows[1] && rows[1].results && rows[1].results[0] && rows[1].results[0].latest_seq) || 0;
  const active = Number(rows[2] && rows[2].results && rows[2].results[0] && rows[2].results[0].active) || 0;
  const visitorRow = (rows[3] && rows[3].results && rows[3].results[0]) || {};
  const unique = Number(visitorRow.u) || 0;
  const nextAfter = after === null
    ? (letters.length ? Number(letters[0].seq) : latestSeq)
    : (letters.length < limit ? latestSeq : Number(letters[letters.length - 1].seq));

  return json({
    ok: true,
    letters,
    next_after: nextAfter,
    active,
    unique_visitors: unique,
    total_sessions: Number(visitorRow.s) || 0,
    returning_ratio: unique ? (Number(visitorRow.r) || 0) / unique : 0
  }, 200, headers);
}

function adminQueryError(headers) {
  return json({ ok: false, error: 'invalid_query' }, 400, headers);
}
// Admin listing keeps the original `before` seq cursor (used by the existing
// contract) and adds page-based mode whenever a sort column is requested.
// Filters and totals are identical in both modes; nothing is ever pruned here.
async function adminListLetters(url, env, cors) {
  const headers = adminHeaders(cors);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const rawLimit = url.searchParams.get('limit');
  let limit = DEFAULT_PAGE;
  if (rawLimit !== null && rawLimit !== '') {
    if (!/^\d+$/.test(rawLimit)) return adminQueryError(headers);
    const n = parseInt(rawLimit, 10);
    if (!Number.isFinite(n) || n < 1) return adminQueryError(headers);
    limit = Math.min(n, MAX_ADMIN_PAGE);
  }

  const rawPage = url.searchParams.get('page');
  let page = 0;
  if (rawPage !== null && rawPage !== '') {
    if (!/^\d+$/.test(rawPage)) return adminQueryError(headers);
    page = parseInt(rawPage, 10);
    if (!Number.isFinite(page) || page > 100000) return adminQueryError(headers);
  }

  const before = parseCursor(url.searchParams.get('before'));
  if (before === undefined) return adminQueryError(headers);

  const rawSort = url.searchParams.get('sort');
  const sortColumn = rawSort ? LETTER_SORTS[rawSort] : null;
  if (rawSort && !sortColumn) return adminQueryError(headers);
  const rawOrder = url.searchParams.get('order');
  if (rawOrder && rawOrder !== 'asc' && rawOrder !== 'desc') return adminQueryError(headers);
  const order = rawOrder === 'asc' ? 'ASC' : 'DESC';

  const q = (url.searchParams.get('q') || '').trim();
  if (q.length > 120 || CONTROL_OR_BIDI_REGEX.test(q)) return adminQueryError(headers);

  const lang = (url.searchParams.get('lang') || '').trim().toLowerCase();
  if (lang && !/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/.test(lang)) return adminQueryError(headers);

  const status = url.searchParams.get('status');
  if (status && status !== 'all' && status !== 'active' && status !== 'expired') {
    return adminQueryError(headers);
  }

  const now = Math.floor(Date.now() / 1000);
  const where = [];
  const args = [];
  if (q) {
    if (LETTER_ID_REGEX.test(q)) {
      where.push('id = ?');
      args.push(q);
    } else {
      where.push("body LIKE ? ESCAPE '\\'");
      args.push('%' + q.replace(/[\\%_]/g, '\\$&') + '%');
    }
  }
  if (lang) { where.push('lang = ?'); args.push(lang); }
  if (status === 'active') { where.push('expires_at > ?'); args.push(now); }
  else if (status === 'expired') { where.push('expires_at <= ?'); args.push(now); }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  const totalRow = await env.DB.prepare('SELECT COUNT(*) AS total FROM letters' + whereSql)
    .bind(...args).first();
  const total = Number(totalRow && totalRow.total) || 0;

  const columns = 'SELECT seq, id, body, lang, created_at, expires_at FROM letters';
  let rows = [];
  let offset = 0;
  let nextBefore = null;

  if (sortColumn) {
    const maxPage = total > 0 ? Math.floor((total - 1) / limit) : 0;
    page = Math.min(page, maxPage);
    offset = page * limit;
    const result = await env.DB.prepare(
      columns + whereSql + ' ORDER BY ' + sortColumn + ' ' + order + ', seq ' + order + ' LIMIT ? OFFSET ?'
    ).bind(...args, limit, offset).all();
    rows = (result && result.results) || [];
  } else if (before === null) {
    const result = await env.DB.prepare(columns + whereSql + ' ORDER BY seq DESC LIMIT ?')
      .bind(...args, limit).all();
    rows = (result && result.results) || [];
  } else {
    const seqWhere = where.length ? whereSql + ' AND seq < ?' : ' WHERE seq < ?';
    const result = await env.DB.prepare(columns + seqWhere + ' ORDER BY seq DESC LIMIT ?')
      .bind(...args, before, limit).all();
    rows = (result && result.results) || [];
  }

  if (!sortColumn && rows.length === limit) nextBefore = Number(rows[rows.length - 1].seq);

  const letters = rows.map(row => Object.assign({}, row, {
    status: Number(row.expires_at) > now ? 'active' : 'expired'
  }));

  return json({
    ok: true,
    letters,
    next_before: nextBefore,
    total,
    page: sortColumn ? page : null,
    limit,
    has_more: sortColumn ? offset + letters.length < total : nextBefore !== null
  }, 200, headers);
}

async function adminDeleteLetter(rawId, env, cors) {
  const headers = adminHeaders(cors);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);
  if (!LETTER_ID_REGEX.test(rawId)) return json({ ok: false, error: 'not_found' }, 404, headers);

  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM letter_votes WHERE letter_id = ?').bind(rawId),
    env.DB.prepare('DELETE FROM letters WHERE id = ?').bind(rawId),
    env.DB.prepare('DELETE FROM letter_submissions WHERE letter_id = ?').bind(rawId),
    env.DB.prepare('DELETE FROM letter_senders WHERE letter_id = ?').bind(rawId)
  ]);

  return json({
    ok: true,
    id: rawId,
    deleted: changesOf(results[1]),
    submissions_cleared: changesOf(results[2]),
    legacy_claims_cleared: changesOf(results[3]),
    votes_cleared: changesOf(results[0])
  }, 200, headers);
}

async function adminClearLetters(request, env, cors) {
  const headers = adminHeaders(cors);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const salt = resolveSalt(env);
  if (!salt) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const body = await readJsonBody(request);
  if (!body.ok) return json({ ok: false, error: body.error }, body.status, headers);
  const payload = body.value;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ ok: false, error: 'invalid_body' }, 400, headers);
  }

  // Nuclear reset: every letter-side row goes. Global hourly buckets stay, so
  // clearing the galaxy does not also remove the service-wide abuse ceiling.
  if (payload.all === true) {
    if (payload.confirm !== RESET_CONFIRMATION) {
      return json({ ok: false, error: 'confirmation_required' }, 400, headers);
    }
    const results = await env.DB.batch([
      env.DB.prepare('DELETE FROM letters'),
      env.DB.prepare('DELETE FROM letter_submissions'),
      env.DB.prepare('DELETE FROM letter_senders'),
      env.DB.prepare("DELETE FROM letter_limits WHERE scope <> 'global'"),
      env.DB.prepare('DELETE FROM letter_votes'),
      env.DB.prepare('DELETE FROM letter_vote_rate'),
      env.DB.prepare('DELETE FROM letter_vote_rate_v2')
    ]);
    return json({
      ok: true,
      mode: 'all',
      letters_deleted: changesOf(results[0]),
      submissions_cleared: changesOf(results[1]),
      legacy_claims_cleared: changesOf(results[2]),
      sender_limits_cleared: changesOf(results[3]),
      votes_cleared: changesOf(results[4]),
      vote_limits_cleared: changesOf(results[5]) + changesOf(results[6])
    }, 200, headers);
  }

  const ip = typeof payload.ip === 'string' ? payload.ip.trim() : '';
  if (!/^[0-9A-Fa-f:.]{2,64}$/.test(ip)) {
    return json({ ok: false, error: 'invalid_ip' }, 400, headers);
  }

  const includeLetters = payload.letters === true;
  const senderHash = await hashIp(ip, salt);
  const statements = [];

  if (includeLetters) {
    // Votes are keyed by letter id, so they go before the letters they hang on.
    statements.push(env.DB.prepare(
      'DELETE FROM letter_votes WHERE letter_id IN (SELECT letter_id FROM letter_submissions WHERE sender_hash = ?)'
    ).bind(senderHash));
    statements.push(env.DB.prepare(
      'DELETE FROM letter_votes WHERE letter_id IN (SELECT letter_id FROM letter_senders WHERE sender_hash = ?)'
    ).bind(senderHash));
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
  const offset = includeLetters ? 4 : 0;
  const lettersDeleted = includeLetters
    ? changesOf(results[2]) + changesOf(results[3])
    : 0;
  const votesCleared = includeLetters
    ? changesOf(results[0]) + changesOf(results[1])
    : 0;

  return json({
    ok: true,
    letters_included: includeLetters,
    letters_deleted: lettersDeleted,
    votes_cleared: votesCleared,
    submissions_cleared: changesOf(results[offset]),
    legacy_claims_cleared: changesOf(results[offset + 1]),
    limits_cleared: changesOf(results[offset + 2])
  }, 200, headers);
}

/* ------------------------------------------------------------------ */
/* Playlist tracks                                                      */
/* ------------------------------------------------------------------ */

function isMissingTracksTable(error) {
  return /no such table:\s*tracks\b/i.test(String((error && error.message) || error || ''));
}

function parseTrackTags(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.filter(tag => typeof tag === 'string') : [];
  } catch (e) {
    return [];
  }
}

function trackFromRow(row, includeMeta) {
  const track = {
    id: row.id,
    title: row.title,
    artist: row.artist || '',
    audio_url: row.audio_url,
    artwork_url: row.artwork_url || null,
    duration: row.duration === null || row.duration === undefined ? null : Number(row.duration),
    tags: parseTrackTags(row.tags),
    position: Number(row.position)
  };
  if (includeMeta) {
    track.created_at = Number(row.created_at);
    track.updated_at = Number(row.updated_at);
  }
  return track;
}

function trackRows(result) {
  return ((result && result.results) || []).map(row => trackFromRow(row, true));
}

async function listTracks(env, cors, admin) {
  const headers = admin
    ? adminHeaders(cors)
    : Object.assign({ 'Cache-Control': 'public, max-age=60' }, cors.headers);
  /* A failure must never be cached alongside the 60-second success response. */
  const failureHeaders = admin
    ? adminHeaders(cors)
    : Object.assign({ 'Cache-Control': 'no-store' }, cors.headers);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, failureHeaders);

  try {
    const result = await env.DB.prepare(
      'SELECT id, title, artist, audio_url, artwork_url, duration, tags, position, created_at, updated_at ' +
      'FROM tracks ORDER BY position ASC, id ASC'
    ).all();
    const tracks = trackRows(result).map(track => admin ? track : {
      id: track.id,
      title: track.title,
      artist: track.artist,
      audio_url: track.audio_url,
      artwork_url: track.artwork_url,
      duration: track.duration,
      tags: track.tags,
      position: track.position
    });
    return json({ ok: true, tracks }, 200, headers);
  } catch (e) {
    if (isMissingTracksTable(e)) {
      return json({ ok: false, error: 'tracks_unavailable' }, 503, failureHeaders);
    }
    throw e;
  }
}


const MUSIC_DOMAINS = ['inner', 'flow', 'beyond'];
const DOMAIN_MAX_BATCH = 200;
function domainEnabled(env) { return !!env && (env.MUSIC_DOMAINS_ENABLED === '1' || env.MUSIC_DOMAINS_ENABLED === true); }
function domainJson(payload, status, cors, admin) { return json(payload, status, Object.assign({ 'Cache-Control': 'no-store' }, admin ? adminHeaders(cors) : cors.headers)); }
function domainBatchId() { return crypto.randomUUID(); }
async function domainSchemaReady(env) {
  try { await env.DB.prepare('SELECT s.version FROM domain_state s JOIN track_domains d ON 1=0 LIMIT 1').first(); return true; }
  catch (_) { return false; }
}
async function domainSnapshot(env) {
  const [state, unclassified, memberships] = await Promise.all([
    env.DB.prepare('SELECT version FROM domain_state WHERE singleton_id=1').first(),
    env.DB.prepare("SELECT t.id,t.title FROM tracks t LEFT JOIN track_domains d ON d.track_id=t.id WHERE d.track_id IS NULL ORDER BY t.position,t.id").all(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM track_domains').first()
  ]);
  const unknown=(unclassified.results||[]).map(x=>({id:x.id,title:x.title}));
  const accepted=await env.DB.prepare('SELECT track_id FROM domain_accepted_tracks ORDER BY track_id').all();
  const acceptedIds=(accepted.results||[]).map(x=>x.track_id);
  const exact=unknown.length===acceptedIds.length && unknown.every(x=>acceptedIds.includes(x.id));
  const acceptance=await env.DB.prepare('SELECT state_version,accepted_count FROM domain_acceptance WHERE singleton_id=1').first();
  const validAcceptance=!!acceptance && Number(acceptance.state_version)===Number(state.version) && Number(acceptance.accepted_count)===unknown.length && exact;
  return {state_version:Number(state.version), unclassified:unknown, membership_count:Number(memberships.n)||0, accepted_ids:acceptedIds, accepted:validAcceptance, ready:unknown.length===0||validAcceptance};
}
async function musicDomainStatus(env,cors) {
  if(!domainEnabled(env)||!env.DB) return domainJson({ok:true,enabled:false},200,cors,false);
  if(!await domainSchemaReady(env)) return domainJson({ok:true,enabled:false},200,cors,false);
  try { const s=await domainSnapshot(env); return domainJson({ok:true,enabled:s.ready,ready:s.ready,state_version:s.state_version,unclassified_count:s.unclassified.length},200,cors,false); }
  catch(_) { return domainJson({ok:true,enabled:false},200,cors,false); }
}
async function musicDomainTracks(env,cors) {
  if(!domainEnabled(env)||!env.DB||!await domainSchemaReady(env)) return domainJson({ok:false,error:'domains_unavailable'},503,cors,false);
  try {
    const rows=await env.DB.prepare("SELECT t.id,t.title,t.artist,t.audio_url,t.artwork_url,t.duration,t.tags,t.position,d.domain FROM tracks t JOIN track_domains d ON d.track_id=t.id ORDER BY t.position,t.id,d.domain").all();
    const map=new Map(); for(const r of rows.results||[]){let x=map.get(r.id);if(!x){x={id:r.id,title:r.title,artist:r.artist,audio_url:r.audio_url,artwork_url:r.artwork_url,duration:r.duration===null?null:Number(r.duration),tags:parseTrackTags(r.tags),position:Number(r.position),domains:[]};map.set(r.id,x);}x.domains.push(r.domain);}
    return domainJson({ok:true,tracks:Array.from(map.values())},200,cors,false);
  } catch(_) { return domainJson({ok:false,error:'domains_unavailable'},503,cors,false); }
}
async function adminDomainReadiness(env,cors) { const h=adminHeaders(cors); if(!await domainSchemaReady(env))return json({ok:false,error:'domains_unavailable'},503,h); try{return json({ok:true,...await domainSnapshot(env)},200,h);}catch(_){return json({ok:false,error:'domains_unavailable'},503,h);} }
async function adminDomainTracks(env,cors) { const h=adminHeaders(cors); if(!await domainSchemaReady(env))return json({ok:false,error:'domains_unavailable'},503,h); const r=await env.DB.prepare("SELECT t.id,t.title,t.artist,t.position,COALESCE(GROUP_CONCAT(d.domain,','),'') domains FROM tracks t LEFT JOIN track_domains d ON d.track_id=t.id GROUP BY t.id ORDER BY t.position,t.id").all();return json({ok:true,tracks:(r.results||[]).map(x=>({...x,domains:x.domains?x.domains.split(','):[]}))},200,h); }
async function adminDomainAudit(env,cors) { const h=adminHeaders(cors); if(!await domainSchemaReady(env))return json({ok:false,error:'domains_unavailable'},503,h); const r=await env.DB.prepare("SELECT b.batch_id,b.operation,b.created_at,b.undo_of_batch_id,b.undone_by_batch_id,c.track_id,c.title_snapshot,c.domain,c.previous_assigned,c.new_assigned FROM domain_audit_batches b LEFT JOIN domain_audit_changes c ON c.batch_id=b.batch_id ORDER BY b.created_at DESC,c.track_id LIMIT 1000").all();return json({ok:true,records:r.results||[]},200,h); }
async function adminDomainMutate(request,env,cors) {
 const h=adminHeaders(cors); if(!await domainSchemaReady(env))return json({ok:false,error:'domains_unavailable'},503,h);
 let b;try{b=await request.json();}catch(_){return json({ok:false,error:'invalid_json'},400,h);}
 const op=b&&b.operation, items=b&&b.items;
 if(!['add','remove','set'].includes(op)||!Array.isArray(items)||!items.length||items.length>DOMAIN_MAX_BATCH)return json({ok:false,error:'validation_failed',committed:false,applied:0,details:{items:'must contain 1..200 tracks'}},400,h);
 const ids=new Set();for(const it of items){if(!it||typeof it.id!=='string'||!TRACK_ID_REGEX.test(it.id)||ids.has(it.id)||!Array.isArray(it.domains)||it.domains.some(d=>!MUSIC_DOMAINS.includes(d))||new Set(it.domains).size!==it.domains.length)return json({ok:false,error:'validation_failed',committed:false,applied:0,details:{track_id:it&&it.id||null,reason:'invalid_or_duplicate_target'}},400,h);ids.add(it.id);}
 const now=Math.floor(Date.now()/1000), id=domainBatchId(), stmts=[env.DB.prepare('INSERT INTO domain_audit_batches(batch_id,operation,created_at) VALUES(?,?,?)').bind(id,op,now)];
 for(const it of items) stmts.push(env.DB.prepare(`INSERT INTO domain_audit_targets(batch_id,track_id,track_ref,title_snapshot) SELECT ?,?,(SELECT id FROM tracks WHERE id=?),ifnull((SELECT title FROM tracks WHERE id=?),char(0))`).bind(id,it.id,it.id,it.id));
 for(const it of items) for(const d of (op==='set'?MUSIC_DOMAINS:it.domains)) { const next=op==='set'?Number(it.domains.includes(d)):Number(op==='add'); stmts.push(env.DB.prepare('INSERT INTO domain_audit_changes(batch_id,track_id,track_ref,title_snapshot,domain,previous_assigned,new_assigned,changed_at) SELECT ?,t.id,t.id,t.title,?,EXISTS(SELECT 1 FROM track_domains x WHERE x.track_id=t.id AND x.domain=?),?,? FROM tracks t WHERE t.id=? AND EXISTS(SELECT 1 FROM track_domains x WHERE x.track_id=t.id AND x.domain=?)<>?').bind(id,d,d,next,now,it.id,d,next)); }
 for(const it of items) for(const d of (op==='set'?MUSIC_DOMAINS:it.domains)) { if(op==='remove'||(op==='set'&&!it.domains.includes(d))) stmts.push(env.DB.prepare('DELETE FROM track_domains WHERE track_id=? AND domain=?').bind(it.id,d)); else stmts.push(env.DB.prepare('INSERT INTO track_domains(track_id,domain,assigned_at) SELECT id,?,? FROM tracks WHERE id=? ON CONFLICT(track_id,domain) DO NOTHING').bind(d,now,it.id)); }
 try{const out=await env.DB.batch(stmts);const auditCount=items.reduce((n,it)=>n+(op==='set'?3:it.domains.length),0);const applied=out.slice(1+items.length,1+items.length+auditCount).reduce((n,x)=>n+changesOf(x),0);const attempted=items.reduce((n,it)=>n+(op==='set'?3:it.domains.length),0);return json({ok:true,committed:true,batch_id:id,applied,already_present:attempted-applied},200,h);}catch(e){return json({ok:false,error:/unknown_track/.test(String(e&&e.message))?'unknown_track':'transaction_failed',committed:false,applied:0,details:{reason:'batch_rolled_back'}},/unknown_track/.test(String(e&&e.message))?404:409,h);}
}
async function adminDomainUndo(batchId,env,cors) {
 const h=adminHeaders(cors);if(!await domainSchemaReady(env))return json({ok:false,error:'domains_unavailable'},503,h);if(!/^[0-9a-f-]{36}$/i.test(batchId))return json({ok:false,error:'not_found'},404,h);
 const undo=domainBatchId(),now=Math.floor(Date.now()/1000);
 const stmts=[env.DB.prepare("INSERT INTO domain_audit_batches(batch_id,operation,created_at,undo_of_batch_id) SELECT ?, 'undo', ?, b.batch_id FROM domain_audit_batches b WHERE b.batch_id=? AND b.operation IN ('add','remove','set') AND b.undone_by_batch_id IS NULL AND NOT EXISTS(SELECT 1 FROM domain_audit_targets a LEFT JOIN tracks t ON t.id=a.track_id WHERE a.batch_id=b.batch_id AND (t.id IS NULL OR a.track_ref IS NULL)) AND NOT EXISTS(SELECT 1 FROM domain_audit_changes c LEFT JOIN domain_audit_targets a ON a.batch_id=c.batch_id AND a.track_id=c.track_id LEFT JOIN tracks t ON t.id=c.track_id LEFT JOIN track_domains d ON d.track_id=c.track_id AND d.domain=c.domain WHERE c.batch_id=b.batch_id AND (a.track_id IS NULL OR t.id IS NULL OR COALESCE(d.track_id IS NOT NULL,0)<>c.new_assigned OR EXISTS(SELECT 1 FROM domain_audit_changes newer JOIN domain_audit_batches newer_batch ON newer_batch.batch_id=newer.batch_id WHERE newer.track_id=c.track_id AND newer.domain=c.domain AND newer_batch.rowid>b.rowid)))").bind(undo,now,batchId),
 env.DB.prepare("UPDATE domain_audit_batches SET undone_by_batch_id=? WHERE batch_id=? AND operation IN ('add','remove','set') AND undone_by_batch_id IS NULL AND EXISTS(SELECT 1 FROM domain_audit_batches u WHERE u.batch_id=? AND u.undo_of_batch_id=domain_audit_batches.batch_id) AND NOT EXISTS(SELECT 1 FROM domain_audit_changes c LEFT JOIN tracks t ON t.id=c.track_id LEFT JOIN track_domains d ON d.track_id=c.track_id AND d.domain=c.domain WHERE c.batch_id=? AND (t.id IS NULL OR COALESCE(d.track_id IS NOT NULL,0)<>c.new_assigned))").bind(undo,batchId,undo,batchId),
 env.DB.prepare("INSERT INTO domain_audit_changes(batch_id,track_id,track_ref,title_snapshot,domain,previous_assigned,new_assigned,changed_at) SELECT ?,c.track_id,c.track_ref,c.title_snapshot,c.domain,c.new_assigned,c.previous_assigned,? FROM domain_audit_changes c JOIN domain_audit_batches o ON o.batch_id=c.batch_id AND o.undone_by_batch_id=?").bind(undo,now,undo),
 env.DB.prepare("DELETE FROM track_domains WHERE EXISTS(SELECT 1 FROM domain_audit_changes c JOIN domain_audit_batches o ON o.batch_id=c.batch_id AND o.undone_by_batch_id=? WHERE c.track_id=track_domains.track_id AND c.domain=track_domains.domain AND c.new_assigned=1)").bind(undo),
 env.DB.prepare("INSERT INTO track_domains(track_id,domain,assigned_at) SELECT c.track_id,c.domain,? FROM domain_audit_changes c JOIN domain_audit_batches o ON o.batch_id=c.batch_id AND o.undone_by_batch_id=? WHERE c.new_assigned=0 ON CONFLICT(track_id,domain) DO NOTHING").bind(now,undo)];
 try{const out=await env.DB.batch(stmts);if(!changesOf(out[0])){const state=await env.DB.prepare("SELECT b.operation,b.undone_by_batch_id,EXISTS(SELECT 1 FROM domain_audit_targets a LEFT JOIN tracks t ON t.id=a.track_id WHERE a.batch_id=b.batch_id AND (t.id IS NULL OR a.track_ref IS NULL)) AS deleted_target,EXISTS(SELECT 1 FROM domain_audit_changes c LEFT JOIN domain_audit_targets a ON a.batch_id=c.batch_id AND a.track_id=c.track_id LEFT JOIN tracks t ON t.id=c.track_id LEFT JOIN track_domains d ON d.track_id=c.track_id AND d.domain=c.domain WHERE c.batch_id=b.batch_id AND (a.track_id IS NULL OR t.id IS NULL OR COALESCE(d.track_id IS NOT NULL,0)<>c.new_assigned OR EXISTS(SELECT 1 FROM domain_audit_changes newer JOIN domain_audit_batches newer_batch ON newer_batch.batch_id=newer.batch_id WHERE newer.track_id=c.track_id AND newer.domain=c.domain AND newer_batch.rowid>b.rowid))) AS state_conflict FROM domain_audit_batches b WHERE b.batch_id=?").bind(batchId).first();const reason=!state?'batch_not_found':state.undone_by_batch_id?'already_undone':state.deleted_target?'track_deleted':!['add','remove','set'].includes(state.operation)?'not_undoable':'membership_or_audit_conflict';return json({ok:false,error:'undo_conflict',committed:false,applied:0,details:{reason,message:reason==='track_deleted'?'A track in this batch was deleted; Undo will not recreate it.':reason==='already_undone'?'This batch has already been undone.':'The current memberships no longer match the batch snapshot.'}},state?409:404,h);}if(!changesOf(out[1]))throw new Error('undo_marker_conflict');return json({ok:true,committed:true,batch_id:undo,undo_of:batchId,applied:changesOf(out[2])},200,h);}catch(e){return json({ok:false,error:/UNIQUE|unique|undo_marker_conflict/i.test(String(e&&e.message))?'undo_conflict':'transaction_failed',committed:false,applied:0,details:{reason:'transaction_rolled_back'}},409,h);}
}
async function adminDomainAccept(request,env,cors){const h=adminHeaders(cors);if(!await domainSchemaReady(env))return json({ok:false,error:'domains_unavailable'},503,h);let b;try{b=await request.json();}catch(_){return json({ok:false,error:'invalid_json'},400,h);}if(!Number.isSafeInteger(b&&b.expected_state_version)||b.expected_state_version<0)return json({ok:false,error:'validation_failed'},400,h);const now=Math.floor(Date.now()/1000);try{const out=await env.DB.batch([env.DB.prepare('DELETE FROM domain_accepted_tracks WHERE EXISTS(SELECT 1 FROM domain_state WHERE singleton_id=1 AND version=?)').bind(b.expected_state_version),env.DB.prepare("INSERT INTO domain_accepted_tracks(track_id,title_snapshot,accepted_at) SELECT t.id,t.title,? FROM tracks t LEFT JOIN track_domains d ON d.track_id=t.id WHERE d.track_id IS NULL AND EXISTS(SELECT 1 FROM domain_state WHERE singleton_id=1 AND version=?)").bind(now,b.expected_state_version),env.DB.prepare("INSERT INTO domain_acceptance(singleton_id,accepted_at,state_version,accepted_count) SELECT 1,?,version,(SELECT COUNT(*) FROM domain_accepted_tracks) FROM domain_state WHERE singleton_id=1 AND version=? ON CONFLICT(singleton_id) DO UPDATE SET accepted_at=excluded.accepted_at,state_version=excluded.state_version,accepted_count=excluded.accepted_count").bind(now,b.expected_state_version)]);if(!changesOf(out[2]))return json({ok:false,error:'stale_snapshot',committed:false},409,h);const snap=await domainSnapshot(env);return json({ok:true,accepted_ids:snap.accepted_ids,state_version:snap.state_version},200,h);}catch(e){return json({ok:false,error:'transaction_failed',committed:false},409,h);}}

function validText(value, field, max) {
  if (typeof value !== 'string') return { ok: false, error: field + '_invalid' };
  const clean = value.normalize('NFC').trim();
  if (!clean) return { ok: false, error: field + '_required' };
  if (clean.length > max) return { ok: false, error: field + '_too_long' };
  if (CONTROL_OR_BIDI_REGEX.test(clean)) return { ok: false, error: field + '_invalid' };
  return { ok: true, value: clean };
}

function optionalText(value, field, max) {
  if (value === undefined || value === null || value === '') return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, error: field + '_invalid' };
  const clean = value.normalize('NFC').trim();
  if (!clean) return { ok: true, value: '' };
  if (clean.length > max) return { ok: false, error: field + '_too_long' };
  if (CONTROL_OR_BIDI_REGEX.test(clean)) return { ok: false, error: field + '_invalid' };
  return { ok: true, value: clean };
}

// Absolute http(s) URLs or same-origin relative paths. The Worker never calls
// these URLs; the browser does, so schemes that execute code are refused.
function validMediaUrl(value, field, required) {
  if (value === undefined || value === null || value === '') {
    return required ? { ok: false, error: field + '_required' } : { ok: true, value: null };
  }
  if (typeof value !== 'string') return { ok: false, error: field + '_invalid' };
  const clean = value.trim();
  if (!clean || clean.length > 2048) return { ok: false, error: field + '_invalid' };
  if (/[\u0000-\u001F\u007F]/.test(clean)) return { ok: false, error: field + '_invalid' };

  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) {
    let parsed;
    try { parsed = new URL(clean); } catch (e) { return { ok: false, error: field + '_invalid' }; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: field + '_invalid' };
    }
    if (parsed.username || parsed.password) return { ok: false, error: field + '_invalid' };
    return { ok: true, value: clean };
  }
  if (clean.startsWith('//')) return { ok: false, error: field + '_invalid' };
  if (!/^[A-Za-z0-9._~!$&'()*+,;=:@%\/?#-]+$/.test(clean)) {
    return { ok: false, error: field + '_invalid' };
  }
  return { ok: true, value: clean };
}

function validDuration(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  let total = null;
  if (typeof value === 'number') {
    total = value;
  } else if (typeof value === 'string') {
    const raw = value.trim();
    if (/^\d+$/.test(raw)) total = Number(raw);
    else {
      const parts = /^(\d{1,3}):([0-5]\d)$/.exec(raw);
      if (!parts) return { ok: false, error: 'duration_invalid' };
      total = Number(parts[1]) * 60 + Number(parts[2]);
    }
  }
  if (!Number.isInteger(total) || total < 0 || total > 359999) {
    return { ok: false, error: 'duration_invalid' };
  }
  return { ok: true, value: total };
}

function validTags(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: [] };
  let list;
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string') list = value.split(',');
  else return { ok: false, error: 'tags_invalid' };

  const tags = [];
  for (const item of list) {
    if (typeof item !== 'string') return { ok: false, error: 'tags_invalid' };
    const tag = item.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!tag) continue;
    if (tag.length > 24 || CONTROL_OR_BIDI_REGEX.test(tag)) {
      return { ok: false, error: 'tags_invalid' };
    }
    if (tags.indexOf(tag) < 0) tags.push(tag);
    if (tags.length > 12) return { ok: false, error: 'tags_invalid' };
  }
  return { ok: true, value: tags };
}

function buildTrackPayload(raw, existing) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_body' };
  }
  const base = existing ? trackFromRow(existing, false) : {};
  const pick = key => Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : base[key];

  const title = validText(pick('title'), 'title', 160);
  if (!title.ok) return title;
  const artist = optionalText(pick('artist'), 'artist', 160);
  if (!artist.ok) return artist;
  const audio = validMediaUrl(pick('audio_url'), 'audio_url', true);
  if (!audio.ok) return audio;
  const artwork = validMediaUrl(pick('artwork_url'), 'artwork_url', false);
  if (!artwork.ok) return artwork;
  const duration = validDuration(pick('duration'));
  if (!duration.ok) return duration;
  const tags = validTags(pick('tags'));
  if (!tags.ok) return tags;

  return {
    ok: true,
    data: {
      title: title.value,
      artist: artist.value,
      audio_url: audio.value,
      artwork_url: artwork.value,
      duration: duration.value,
      tags: tags.value
    }
  };
}

async function readTrackBody(request) {
  const body = await readJsonBody(request, MAX_TRACK_BODY_BYTES);
  if (!body.ok) return body;
  if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
    return { ok: false, status: 400, error: 'invalid_body' };
  }
  return body;
}

async function createTrack(request, env, cors) {
  const headers = adminHeaders(cors);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const body = await readTrackBody(request);
  if (!body.ok) return json({ ok: false, error: body.error }, body.status, headers);

  const validated = buildTrackPayload(body.value, null);
  if (!validated.ok) return json({ ok: false, error: validated.error }, 400, headers);

  try {
    const countRow = await env.DB.prepare('SELECT COUNT(*) AS total FROM tracks').first();
    if (Number(countRow && countRow.total) >= MAX_TRACKS) {
      return json({ ok: false, error: 'track_limit' }, 409, headers);
    }
    const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM tracks').first();
    const position = Number(maxRow && maxRow.max) + 1;
    const now = Math.floor(Date.now() / 1000);
    const id = randomId();
    const data = validated.data;

    await env.DB.prepare(
      'INSERT INTO tracks (id, title, artist, audio_url, artwork_url, duration, tags, position, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id, data.title, data.artist, data.audio_url, data.artwork_url,
      data.duration, JSON.stringify(data.tags), position, now, now
    ).run();

    const row = await env.DB.prepare('SELECT * FROM tracks WHERE id = ?').bind(id).first();
    return json({ ok: true, track: trackFromRow(row, true) }, 201, headers);
  } catch (e) {
    if (isMissingTracksTable(e)) {
      return json({ ok: false, error: 'tracks_unavailable' }, 503, headers);
    }
    throw e;
  }
}

function createdAtEpochSeconds(value){
  if(typeof value==='number')return Number.isSafeInteger(value)?value:null;
  if(typeof value!=='string'||!value.trim())return null;
  const input=value.trim();
  if(/^[+-]?\d+$/.test(input)){
    const seconds=Number(input);
    return Number.isSafeInteger(seconds)?seconds:null;
  }
  const iso=input.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/i);
  if(!iso)return null;
  const year=Number(iso[1]),month=Number(iso[2]),day=Number(iso[3]);
  const daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate();
  if(month<1||month>12||day<1||day>daysInMonth)return null;
  if(iso[4]&&(Number(iso[4])>23||Number(iso[5])>59||Number(iso[6])>59))return null;
  const milliseconds=Date.parse(input);
  if(!Number.isFinite(milliseconds))return null;
  const seconds=Math.floor(milliseconds/1000);
  return Number.isSafeInteger(seconds)?seconds:null;
}
async function deleteTrackWithDomainHistory(rawId,env){const old=await env.DB.prepare('SELECT id,title,artist,created_at FROM tracks WHERE id=?').bind(rawId).first();if(!old)return {deleted:0};const createdAtSnapshot=createdAtEpochSeconds(old.created_at);if(createdAtSnapshot===null)return {deleted:0,error:'invalid_created_at'};const bid=domainBatchId(),now=Math.floor(Date.now()/1000);const r=await env.DB.batch([
env.DB.prepare("INSERT INTO domain_audit_batches(batch_id,operation,created_at) VALUES(?,'track_delete',?)").bind(bid,now),
env.DB.prepare('INSERT INTO domain_audit_targets(batch_id,track_id,track_ref,title_snapshot) VALUES(?,?,?,?)').bind(bid,old.id,old.id,old.title),
env.DB.prepare('INSERT INTO domain_track_deletions(batch_id,track_id,title_snapshot,artist_snapshot,created_at_snapshot,deleted_at) VALUES(?,?,?,?,?,?)').bind(bid,old.id,old.title,old.artist||'',createdAtSnapshot,now),
env.DB.prepare("INSERT INTO domain_audit_changes(batch_id,track_id,track_ref,title_snapshot,domain,previous_assigned,new_assigned,changed_at) SELECT ?,d.track_id,d.track_id,?,d.domain,1,0,? FROM track_domains d WHERE d.track_id=?").bind(bid,old.title,now,old.id),
env.DB.prepare('DELETE FROM track_domains WHERE track_id=?').bind(old.id),
env.DB.prepare('DELETE FROM domain_accepted_tracks WHERE track_id=?').bind(old.id),
env.DB.prepare('UPDATE domain_audit_targets SET track_ref=NULL WHERE track_ref=?').bind(old.id),
env.DB.prepare('UPDATE domain_audit_changes SET track_ref=NULL WHERE track_ref=?').bind(old.id),
env.DB.prepare('DELETE FROM tracks WHERE id=?').bind(old.id),
env.DB.prepare('SELECT changes() AS direct_changes')]);return {deleted:Number(r[9]&&r[9].results&&r[9].results[0]&&r[9].results[0].direct_changes)||0,batch_id:bid};}
async function mutateTrack(rawId, request, env, cors) {
  const headers = adminHeaders(cors);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);
  if (!TRACK_ID_REGEX.test(rawId)) return json({ ok: false, error: 'not_found' }, 404, headers);

  try {
    const existing = await env.DB.prepare('SELECT * FROM tracks WHERE id = ?').bind(rawId).first();

    if (request.method === 'DELETE') {
      const result = await deleteTrackWithDomainHistory(rawId,env);
      if(result.error==='invalid_created_at')return json({ok:false,error:'invalid_track_created_at',deleted:0},422,headers);
      if(!result.deleted)return json({ok:true,id:rawId,deleted:0},200,headers);
      return json({ok:true,id:rawId,deleted:result.deleted,audit_batch_id:result.batch_id},200,headers);
    }

    if (!existing) return json({ ok: false, error: 'not_found' }, 404, headers);
    const body = await readTrackBody(request);
    if (!body.ok) return json({ ok: false, error: body.error }, body.status, headers);

    const validated = buildTrackPayload(body.value, existing);
    if (!validated.ok) return json({ ok: false, error: validated.error }, 400, headers);

    const data = validated.data;
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      'UPDATE tracks SET title = ?, artist = ?, audio_url = ?, artwork_url = ?, duration = ?, tags = ?, updated_at = ? ' +
      'WHERE id = ?'
    ).bind(
      data.title, data.artist, data.audio_url, data.artwork_url,
      data.duration, JSON.stringify(data.tags), now, rawId
    ).run();

    const row = await env.DB.prepare('SELECT * FROM tracks WHERE id = ?').bind(rawId).first();
    return json({ ok: true, track: trackFromRow(row, true) }, 200, headers);
  } catch (e) {
    if (isMissingTracksTable(e)) {
      return json({ ok: false, error: 'tracks_unavailable' }, 503, headers);
    }
    throw e;
  }
}

async function reorderTracks(request, env, cors) {
  const headers = adminHeaders(cors);
  if (!env || !env.DB) return json({ ok: false, error: 'unavailable' }, 503, headers);

  const body = await readTrackBody(request);
  if (!body.ok) return json({ ok: false, error: body.error }, body.status, headers);
  const ids = body.value.ids;
  if (!Array.isArray(ids) || ids.length > MAX_TRACKS) {
    return json({ ok: false, error: 'invalid_order' }, 400, headers);
  }
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== 'string' || !TRACK_ID_REGEX.test(id) || seen.has(id)) {
      return json({ ok: false, error: 'invalid_order' }, 400, headers);
    }
    seen.add(id);
  }

  try {
    const result = await env.DB.prepare('SELECT id FROM tracks').all();
    const stored = (result && result.results) || [];
    if (stored.length !== ids.length || stored.some(row => !seen.has(row.id))) {
      // Reordering a stale list would create duplicate positions; make the
      // client reload instead of silently accepting a partial order.
      return json({ ok: false, error: 'incomplete_order' }, 409, headers);
    }

    const now = Math.floor(Date.now() / 1000);
    const statements = ids.map((id, index) => env.DB.prepare(
      'UPDATE tracks SET position = ?, updated_at = ? WHERE id = ?'
    ).bind(index, now, id));
    await env.DB.batch(statements);
    return json({ ok: true, updated: ids.length }, 200, headers);
  } catch (e) {
    if (isMissingTracksTable(e)) {
      return json({ ok: false, error: 'tracks_unavailable' }, 503, headers);
    }
    throw e;
  }
}
