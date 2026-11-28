/* Mock Void Signals Worker + static file server for the browser suite.
 *
 * Listens on 127.0.0.1:8787 so the real index.html can be driven with
 * ?local-api=1, which is the page's own supported way to aim at a local worker.
 * Nothing here touches the deployed Worker or its D1: rows live in memory and
 * every write is journaled for the tests to assert against.
 *
 *   node tests/signals-public-server.mjs [port]
 */
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8787);
const TOKEN = 'Bearer test-token';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain'
};

let version = 4;
let now = () => Math.floor(Date.now() / 1000);
let failMode = 'off';
let writes = [];

/* Six rows spanning every status, and bodies that carry the URL cases the
   acceptance path needs. The ids are opaque 32-hex like the Worker's own. */
function seed() {
  const t = now();
  return [
    {
      id: 'bc30d9f543481df3cdde28de6a00b846', title: 'پیام تست', status: 'active',
      category: 'event', importance: 'important', state_version: 1,
      created_at: t - 3600, updated_at: t - 3600, published_at: t - 3600,
      scheduled_at: null, expires_at: null, profile_id: null,
      metadata: { lang: 'fa' },
      body: 'با این لینک میتوانید یک پادکست درجه یک را اضافه کنید ' +
        'https://minoodar.github.io/void/?follow=https%3A%2F%2Frss.com%2Fpodcasts%2Fdivan-khial%2F'
    },
    {
      id: '7295d5b6b259591901a8ae9201cc6c6b', title: 'تست 2', status: 'active',
      category: 'general', importance: 'ambient', state_version: 1,
      created_at: t - 900, updated_at: t - 900, published_at: t - 900,
      scheduled_at: null, expires_at: null, profile_id: null, metadata: { lang: 'fa' },
      body: 'این یک پیام تست است'
    },
    {
      id: '1111111111111111111111111111aaaa', title: 'Release notes', status: 'active',
      category: 'release', importance: 'important', state_version: 3,
      created_at: t - 600, updated_at: t - 60, published_at: t - 60,
      scheduled_at: null, expires_at: t + 3600, profile_id: 'p-gold',
      metadata: {},
      body: 'Two lines here.\nSecond line with (parens) https://en.wikipedia.org/wiki/Void_(astronomy) and a tail.\n\n- bullet row'
    },
    {
      id: '2222222222222222222222222222bbbb', title: 'Draft never shown', status: 'draft',
      category: 'general', importance: 'ambient', state_version: 1,
      created_at: t - 30, updated_at: t - 30, published_at: null,
      scheduled_at: null, expires_at: null, profile_id: null, metadata: {},
      body: 'not public yet https://draft.example/'
    },
    {
      id: '3333333333333333333333333333cccc', title: 'Hidden note', status: 'hidden',
      category: 'general', importance: 'ambient', state_version: 2,
      created_at: t - 700, updated_at: t - 200, published_at: t - 700,
      scheduled_at: null, expires_at: null, profile_id: null, metadata: {},
      body: 'hidden https://hidden.example/'
    },
    {
      id: '4444444444444444444444444444dddd', title: 'Revoked notice', status: 'revoked',
      category: 'maintenance', importance: 'important', state_version: 4,
      created_at: t - 800, updated_at: t - 400, published_at: t - 800,
      scheduled_at: null, expires_at: null, profile_id: null, metadata: {},
      body: 'revoked https://revoked.example/'
    },
    {
      id: '5555555555555555555555555555eeee', title: 'Already expired', status: 'active',
      category: 'general', importance: 'ambient', state_version: 2,
      created_at: t - 5000, updated_at: t - 100, published_at: t - 5000,
      scheduled_at: null, expires_at: t - 60, profile_id: null, metadata: {},
      body: 'gone https://expired.example/'
    },
    {
      id: '6666666666666666666666666666ffff', title: 'Scheduled ahead', status: 'scheduled',
      category: 'event', importance: 'ambient', state_version: 1,
      created_at: t - 10, updated_at: t - 10, published_at: null,
      scheduled_at: t + 3600, expires_at: null, profile_id: null, metadata: {},
      body: 'soon https://scheduled.example/'
    }
  ];
}

let rows = seed();

const profiles = {
  'p-gold': {
    id: 'p-gold', name: 'Gold default', version: 2,
    settings: {
      preset: 'organic', style: 'spark', color: 'gold', motion: 'animated', size: 1.15,
      brightness: 1.2, glow: 1.4, softness: 0.2, motionIntensity: 1.1,
      glowTransitionMs: 900, drift: 0.5
    }
  },
  'p-ice': {
    id: 'p-ice', name: 'Ice', version: 1,
    settings: {
      preset: 'circular', style: 'point', color: 'ice', motion: 'static', size: 0.8,
      brightness: 0.9, glow: 0.6, softness: 0, motionIntensity: 0.4,
      glowTransitionMs: 400, drift: 0.1
    }
  }
};
let assignments = { global: 'p-gold', byCategory: { release: 'p-ice' }, byImportance: {} };

function eligible(row) {
  if (row.expires_at !== null && row.expires_at <= now()) return false;
  if (row.status === 'active') return true;
  return row.status === 'scheduled' && row.scheduled_at !== null && row.scheduled_at <= now();
}

function publicRow(row) {
  return {
    id: row.id, title: row.title, body: row.body, category: row.category,
    importance: row.importance, type: row.importance,
    published_at: row.published_at, expires_at: row.expires_at,
    profile_id: row.profile_id, metadata: row.metadata || {}
  };
}
function adminRow(row) {
  return Object.assign(publicRow(row), {
    status: row.status, state_version: row.state_version, created_at: row.created_at,
    updated_at: row.updated_at, scheduled_at: row.scheduled_at,
    expired: row.expires_at !== null && row.expires_at <= now(),
    eligible: eligible(row), next_transition: row.status === 'active' ? ['hide', 'revoke'] : []
  });
}
const feed = () => rows.filter(eligible)
  .sort((a, b) => (b.published_at || 0) - (a.published_at || 0))
  .map(publicRow);

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((done) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { done(raw ? JSON.parse(raw) : {}); } catch (e) { done({}); }
    });
  });
}

function authorized(req) {
  return String(req.headers.authorization || '') === TOKEN;
}

/* The shell loads other tabs on boot; these answer benignly so a signal
   failure cannot be hidden behind unrelated "offline" noise.
   The shell authenticates with `Authorization: Bearer <secret>` and no body, like the
   real worker (worker/letters/worker.js:472-477 reads the header only and serves
   /admin/session as a GET), so a body-token check here would 401 every login. */
async function handleAdmin(req, res, path) {
  if (path === '/admin/session') {
    writes.push({ kind: 'session', at: now() });
    return authorized(req)
      ? json(res, 200, { ok: true, role: 'owner', scopes: ['signals', 'letters', 'tracks'] })
      : json(res, 401, { ok: false, error: 'unauthorized' });
  }
  if (!authorized(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
  if (/^\/admin\/(tracks|letters|domain-|visitors)/.test(path)) {
    return json(res, 200, { ok: true, items: [], tracks: [], letters: [], total: 0, count: 0 });
  }
  const del = /^\/admin\/signals\/messages\/([0-9a-f]{32})$/.exec(path);
  if (del && req.method === 'DELETE') {
    const row = rows.find((r) => r.id === del[1]);
    writes.push({ kind: 'delete', id: del[1] });
    if (!row) return json(res, 404, { ok: false, error: 'signal_not_found' });
    rows = rows.filter((r) => r.id !== del[1]);
    version++;
    return json(res, 200, { ok: true, removed: del[1], version });
  }
  const m = /^\/admin\/signals\/messages\/([0-9a-f]{32})(\/transition)?$/.exec(path);
  const list = /^\/admin\/signals\/messages$/.exec(path);
  if (list && req.method === 'GET') {
    return json(res, 200, {
      ok: true, version, items: rows.map(adminRow), total: rows.length,
      limit: 50, offset: 0, server_time: now(),
      totals: { active: rows.filter((r) => r.status === 'active').length, all: rows.length }
    });
  }
  if (list && req.method === 'POST') {
    const b = await readBody(req);
    const id = Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32);
    rows.push({
      id, title: b.title, body: b.body, category: b.category || 'general',
      importance: b.importance || 'ambient', status: b.status || 'draft',
      state_version: 1, created_at: now(), updated_at: now(), created_by: b.created_by || 'tester',
      published_at: (b.status || 'draft') === 'active' ? now() : null,
      scheduled_at: b.scheduled_at || null, expires_at: null,
      profile_id: null, metadata: {}
    });
    version++;
    writes.push({ kind: 'create', id, at: now() });
    return json(res, 201, { ok: true, message: adminRow(rows[rows.length - 1]), version });
  }
  if (m && req.method === 'GET') {
    const row = rows.find((r) => r.id === m[1]);
    return row ? json(res, 200, {
      ok: true, message: adminRow(row), profile: null,
      allowed_transitions: ['hide', 'revoke'], version, server_time: now()
    }) : json(res, 404, { ok: false, error: 'signal_not_found' });
  }
  if (m && req.method === 'PUT') {
    const row = rows.find((r) => r.id === m[1]);
    if (!row) return json(res, 404, { ok: false, error: 'signal_not_found' });
    const b = await readBody(req);
    writes.push({ kind: 'update', id: row.id, body: b, sent: Object.keys(b).sort() });
    if (b.expected_version !== row.state_version) {
      return json(res, 409, { ok: false, error: 'stale_snapshot', current_version: row.state_version });
    }
    if (b.status || b.expires_at !== undefined) {
      return json(res, 400, { ok: false, error: 'status_requires_transition' });
    }
    if (typeof b.title !== 'string' || !b.title.trim()) {
      return json(res, 400, { ok: false, error: 'title_required' });
    }
    if (/[<>]/.test(b.title) || /[<>]/.test(String(b.body || ''))) {
      return json(res, 400, { ok: false, error: 'markup_prohibited' });
    }
    row.title = b.title;
    row.body = String(b.body || '');
    row.state_version++;
    row.updated_at = now();
    version++;
    return json(res, 200, { ok: true, message: adminRow(row), version });
  }
  if (m && m[2] && req.method === 'POST') {
    const row = rows.find((r) => r.id === m[1]);
    const b = await readBody(req);
    writes.push({ kind: 'transition', id: row && row.id, action: b.action });
    if (!row) return json(res, 404, { ok: false, error: 'signal_not_found' });
    if (b.expected_version !== row.state_version) {
      return json(res, 409, { ok: false, error: 'stale_snapshot', current_version: row.state_version });
    }
    const next = { hide: 'hidden', revoke: 'revoked', publish: 'active', reopen: 'draft', schedule: 'scheduled' }[b.action];
    if (!next) return json(res, 400, { ok: false, error: 'invalid_transition' });
    row.status = next;
    if (next === 'active') row.published_at = now();
    row.state_version++;
    row.updated_at = now();
    version++;
    return json(res, 200, { ok: true, message: adminRow(row), action: b.action, version });
  }
  if (/^\/admin\/signals\/profiles$/.test(path)) {
    return json(res, 200, {
      ok: true, version, items: Object.values(profiles).map((p) => ({
        id: p.id, name: p.name, current_version: p.version, active_version: p.version,
        settings: p.settings, scopes: []
      }))
    });
  }
  if (/^\/admin\/signals\/assignments$/.test(path)) {
    return json(res, 200, { ok: true, version, items: [] });
  }
  if (/^\/admin\/signals\/state$/.test(path)) {
    return json(res, 200, { ok: true, version });
  }
  return json(res, 404, { ok: false, error: 'not_found', path });
}

async function handlePublic(req, res, path, query) {
  if (failMode === '500') return json(res, 503, { ok: false, error: 'unavailable' });
  if (failMode === 'malformed') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('this is not json {{{');
  }
  if (failMode === 'empty') return json(res, 200, { ok: true, version, messages: [], profiles: {}, assignments: {} });
  if (path === '/signals/version') return json(res, 200, { ok: true, version, server_time: now() });
  if (path === '/signals/messages') {
    const limit = Math.min(60, Math.max(1, Number(query.get('limit')) || 60));
    return json(res, 200, { ok: true, version, server_time: now(), messages: feed().slice(0, limit) });
  }
  if (path === '/signals/state') {
    return json(res, 200, {
      ok: true, version, server_time: now(), messages: feed(), profiles, assignments
    });
  }
  const one = /^\/signals\/messages\/([0-9a-f]{32})$/.exec(path);
  if (one) {
    const row = rows.find((r) => r.id === one[1]);
    if (!row || !eligible(row)) {
      /* Uniform refusal: an ineligible row and a missing row are indistinguishable. */
      return json(res, 404, { ok: false, error: 'message_not_available' });
    }
    return json(res, 200, { ok: true, message: publicRow(row) });
  }
  const asset = /^\/signals\/profile$/.exec(path);
  if (asset) return json(res, 200, { ok: true, version, profiles, assignments });
  return json(res, 404, { ok: false, error: 'not_found', path });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
  const path = decodeURIComponent(url.pathname);
  server.log.push({ method: req.method, path });
  if (path === '/__writes') return json(res, 200, { writes });
  if (path === '/__requests') return json(res, 200, { log: server.log });
  if (path === '/__reset') {
    rows = seed();
    version = 4;
    writes = [];
    server.log = [];
    failMode = 'off';
    return json(res, 200, { ok: true });
  }
  if (path === '/__fail') {
    failMode = url.searchParams.get('mode') || 'off';
    return json(res, 200, { ok: true, failMode });
  }
  if (path === '/__seed') {
    const b = await readBody(req);
    if (b.version !== undefined) version = Number(b.version);
    if (b.assignments) assignments = b.assignments;
    if (b.push) rows = rows.concat(b.push.map((r) => Object.assign({
      state_version: 1, created_at: now(), updated_at: now(), scheduled_at: null,
      expires_at: null, profile_id: null, metadata: {}, published_at: now()
    }, r, { status: r.status || 'active' })));
    if (b.status) {
      const row = rows.find((r) => r.id === b.status.id);
      if (row) {
        row.status = b.status.status;
        row.state_version++;
        if (row.status === 'active') row.published_at = now();
      }
    }
    if (b.expires) {
      const row = rows.find((r) => r.id === b.expires.id);
      if (row) {
        row.expires_at = b.expires.at;
        row.state_version++;
      }
    }
    if (!b.quiet) version++;
    return json(res, 200, { ok: true, version, eligible: feed().length });
  }
  if (path.indexOf('/admin/') === 0) return handleAdmin(req, res, path);
  if (path.indexOf('/signals') === 0) return handlePublic(req, res, path, url.searchParams);
  if (path === '/tracks/domains') return json(res, 200, { ok: true, tracks: {} });
  if (path === '/tracks') return json(res, 200, { ok: true, tracks: [], items: [] });
  if (path === '/letters/count') return json(res, 200, { ok: true, count: 0 });
  if (path.indexOf('/void/') === 0 || path === '/') {
    /* Pages serves the app under /void/, so the same tree answers both roots. */
    return serveFile(path.replace(/^\/void/, '') || '/index.html', res);
  }
  return serveFile(path, res);
});

function serveFile(path, res) {
  const rel = path === '/' ? '/index.html' : path;
  const file = join(root, rel);
  if (!file.startsWith(root) || extname(file) === '.sql' || rel.indexOf('secrets') >= 0) {
    return json(res, 403, { ok: false, error: 'refused' });
  }
  return stat(file).then((s) => {
    if (!s.isFile()) throw new Error('not a file');
    return readFile(file);
  }).then((buf) => {
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  }).catch(() => json(res, 404, { ok: false, error: 'no_such_file', path: rel }));
}

server.log = [];
server.listen(PORT, '127.0.0.1', () => {
  console.log('signals mock worker + static server on http://127.0.0.1:' + PORT);
  console.log('eligible rows:', feed().length, '| version', version);
});
