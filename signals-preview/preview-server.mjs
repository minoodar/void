/* Void Signals — Phase B visual preview server (isolated, local-only).
 *
 * Serves the PRISTINE production checkout of this worktree. The only transformation
 * is at serve time: index.html gets three extra tags (shim, layer CSS, layer JS +
 * demo console). The file on disk is never touched, so `git status` stays clean for
 * every production path and the preview is removable by deleting signals-preview/.
 *
 * Every non-local API request is answered by /__sim/* with simulated data. There is
 * no write endpoint, no production contact, no DNS/hosting/Worker change.
 *
 *   node signals-preview/preview-server.mjs [--port=8970]
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..');
const argv = Object.fromEntries(process.argv.slice(2).map(a => { const kv = a.replace(/^--/, '').split('='); return [kv[0], kv.length > 1 ? kv[1] : true]; }));
const PORT = Number(argv.port || 8970);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8'
};

/* ---- production byte proof: disk must equal the committed blob at HEAD ---- */
const HEAD = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const BRANCH = execFileSync('git', ['-C', ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
const tracked = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  .split('\n').filter(Boolean).filter(p => !p.startsWith('signals-preview/'));
const proof = [];
let drifted = 0;
/* "Unmodified" is decided by git itself, not by raw byte equality: this checkout has
   core.autocrlf=true, so 90 text files are CRLF-smudged on disk while their blobs are
   LF, and one file (privacy-policy.html) stores mixed endings. Raw hashing reports
   false drift in both directions. `git diff --name-only HEAD` + `git status` are the
   state-of-record checks; per-file hashes are recorded as evidence only. */
const changedPathsAll = execFileSync('git', ['-C', ROOT, 'diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
/* the preview's own directory is allowed to be dirty: the proof is about production files */
const changedPaths = changedPathsAll.filter(p => !p.startsWith('signals-preview/'));
for (const rel of tracked) {
  const disk = join(ROOT, rel);
  if (!existsSync(disk)) { proof.push({ rel, state: 'missing-on-disk' }); drifted++; continue; }
  const blobSha = execFileSync('git', ['-C', ROOT, 'rev-parse', `HEAD:${rel}`], { encoding: 'utf8' }).trim();
  const diskSha = execFileSync('git', ['-C', ROOT, 'hash-object', '--no-filters', '--', disk], { encoding: 'utf8' }).trim();
  const gitClean = changedPaths.indexOf(rel) < 0;
  if (!gitClean) drifted++;
  proof.push({ rel, state: gitClean ? 'identical-per-git' : 'MODIFIED', bytes: statSync(disk).size, blobSha, diskSha, rawBytesEqual: blobSha === diskSha });
}
let gitDiffClean = changedPaths.length === 0;
const status = execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' });
/* parse the XY status column properly: it is position-sensitive (" M path"), so
   trimming or fixed-offset slicing misreads the path — strip the code instead */
const dirtyProduction = status.split('\n')
  .map(l => l.replace(/^.{0,2}\s+/, '').trim())
  .filter(Boolean)
  .filter(p => !p.startsWith('signals-preview/'));
console.log(`PRODUCTION BYTE-PROOF  head=${HEAD}  branch=${BRANCH}  files=${proof.length}  gitModified=${drifted}  gitDiffClean=${gitDiffClean}  dirtyProductionPaths=${dirtyProduction.length}`);
console.log(`                     raw-byte identical=${proof.filter(p => p.rawBytesEqual).length}/${proof.length} (rest differ only by the checkout's CRLF smudge)`);
if (drifted || !gitDiffClean || dirtyProduction.length) {
  for (const p of proof.filter(x => x.state !== 'identical-per-git')) console.log('  DRIFT ' + p.rel + ' ' + p.state);
  for (const l of dirtyProduction) console.log('  STATUS ' + l);
  console.log('ABORT: production files differ from HEAD; the preview refuses to serve a modified checkout.');
  process.exit(3);
}

const INJECT_HEAD = '<script src="signals-preview/preview-shim.js"></script>\n<link rel="stylesheet" href="signals-preview/signals-layer.css">\n<link rel="stylesheet" href="signals-preview/star-studio.css">';
/* order matters: identity/lifetime and the appearance model exist before the
   layer and the studio read them */
const INJECT_BODY = '<script src="signals-preview/message-store.js"></script>' +
  '\n<script src="signals-preview/star-config.js"></script>' +
  '\n<script src="signals-preview/signals-layer.js"></script>' +
  '\n<script src="signals-preview/signals-demo-console.js"></script>' +
  '\n<script src="signals-preview/star-studio.js"></script>';

function injectIndex(html) {
  let out = String(html);
  if (out.indexOf('</head>') < 0) throw new Error('index.html has no </head>');
  out = out.replace('</head>', INJECT_HEAD + '\n</head>');
  if (out.indexOf('</body>') < 0) throw new Error('index.html has no </body>');
  out = out.replace('</body>', INJECT_BODY + '\n</body>');
  return out;
}

/* ---- simulated, local-only data. No production shape is written anywhere. ---- */
const SIM_TRACKS = [
  { id: 'sim-01', title: 'Aurora Drift (demo tone)', artist: 'Void Signals preview', audio_url: '/__sim/audio/demo-tone.wav', duration: 96, tags: ['demo'] },
  { id: 'sim-02', title: 'Silver Meridian (demo tone)', artist: 'Void Signals preview', audio_url: '/__sim/audio/demo-tone.wav', duration: 96, tags: ['demo'] }
];
function sim(path) {
  if (path.startsWith('/tracks')) return { ok: true, tracks: SIM_TRACKS, simulated: true };
  if (path.startsWith('/visitors/hit')) return { ok: true, returning: false, simulated: true };
  if (path.startsWith('/visitors/stats')) return { ok: true, total: 0, today: 0, simulated: true };
  if (path.startsWith('/letters/count')) return { ok: true, count: 0, simulated: true };
  if (path.startsWith('/letters/quota')) return { ok: true, remaining: 0, simulated: true };
  if (path.startsWith('/letters')) return { ok: true, letters: [], simulated: true };
  /* The control-room shell is opened against a local sandbox session so the
     Void Star Studio can be shown inside the real admin interface. It is not a
     production credential: every read is simulated and the server refuses all
     writes (non-GET) with 405, so nothing here can reach a Worker or D1. */
  if (path.startsWith('/admin/session')) return { ok: true, simulated: true, previewSandbox: true, role: 'preview-sandbox' };
  if (path.startsWith('/admin/tracks/reorder')) return { ok: true, simulated: true };
  if (path.startsWith('/admin/tracks')) return { ok: true, tracks: SIM_TRACKS, simulated: true };
  if (path.startsWith('/admin/letters/clear')) return { ok: true, simulated: true };
  if (path.startsWith('/admin/letters')) return { ok: true, letters: [], total: 0, page: 1, has_more: false, simulated: true };
  if (path.startsWith('/admin/domain-readiness')) return { ok: true, ready: true, state_version: 0, unclassified: [], simulated: true };
  if (path.startsWith('/admin/domain-tracks')) return { ok: true, tracks: [], simulated: true };
  if (path.startsWith('/admin/domain-audit')) return { ok: true, records: [], simulated: true };
  if (path.startsWith('/admin/')) return { ok: true, simulated: true, empty: true, path };
  if (path.startsWith('/podcast')) return { ok: true, episodes: [], simulated: true };
  return { ok: true, simulated: true, empty: true, path };
}

/* a short local ambient tone, synthesised on demand — never a production asset */
function demoWav() {
  const sr = 22050, sec = 96, n = sr * sec;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  let s = 20261126 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < n; i++) {
    const t = i / sr, bt = t / 0.6, ph = bt - Math.floor(bt), bar = Math.floor(bt / 4);
    const kick = Math.sin(2 * Math.PI * (52 + 22 * ph) * t) * Math.exp(-ph * 6) * 0.7;
    const hz = [110, 146.83, 98, 164.81][bar % 4];
    const pad = (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(2 * Math.PI * hz * 2 * t)) * 0.13;
    const air = (rnd() * 2 - 1) * 0.012;
    const v = Math.max(-1, Math.min(1, kick + pad + air));
    buf.writeInt16LE((v * 32767) | 0, 44 + i * 2);
  }
  return buf;
}
let wavCache = null;

const server = createServer((req, res) => {
  const raw = decodeURIComponent((req.url || '/').split('?')[0]);
  const send = (code, body, type, extra) => {
    const h = Object.assign({ 'content-type': type, 'cache-control': 'no-store', 'content-length': body.length, 'x-void-preview': 'isolated' }, extra || {});
    res.writeHead(code, h);
    res.end(body);
  };
  const json = (code, obj) => send(code, Buffer.from(JSON.stringify(obj)), 'application/json; charset=utf-8');

  if (raw.startsWith('/__sim/audio/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { ok: false, error: 'preview is read-only' });
    if (!wavCache) wavCache = demoWav();
    return send(200, wavCache, 'audio/wav', { 'accept-ranges': 'bytes' });
  }
  if (raw.startsWith('/__sim/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { ok: false, error: 'preview is read-only', simulated: true });
    return json(200, sim(raw.slice(6)));
  }
  if (raw === '/__preview/manifest') {
    return json(200, {
      preview: 'void-signals-phase-b', branch: BRANCH, head: HEAD, port: PORT,
      productionFilesChecked: proof.length, productionFilesModified: drifted,
      injected: { head: INJECT_HEAD, body: INJECT_BODY },
      simulated: true, writes: false,
      productionProof: proof.filter(p => ['index.html', 'void-music.js', 'void-music-viz.js', 'void-music.css', 'podcast-player.js'].includes(p.rel))
    });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { ok: false, error: 'preview is read-only' });

  const rel = raw === '/' ? 'index.html' : raw.replace(/^\/+/, '');
  const disk = normalize(join(ROOT, rel));
  if (!disk.startsWith(ROOT)) return send(403, Buffer.from('forbidden'), 'text/plain');
  if (!existsSync(disk) || !statSync(disk).isFile()) return send(404, Buffer.from('not found: ' + rel), 'text/plain');
  const body = readFileSync(disk);
  if (rel === 'index.html') return send(200, Buffer.from(injectIndex(body)), MIME['.html']);
  return send(200, body, MIME[extname(disk).toLowerCase()] || 'application/octet-stream');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`PREVIEW  http://127.0.0.1:${PORT}/   branch=${BRANCH}  head=${HEAD.slice(0, 12)}`);
  console.log('         production files served byte-identical; signals layer injected at serve time only.');
  console.log('         all API traffic simulated locally (/__sim/*). No production contact.');
});