// Public Signals layer: static gates and pure-logic units.
//
// Runs in a node:vm sandbox with a stubbed fetch and a minimal document. No
// browser, no network, no production data. The behavioural half (stars on the
// page, dialog, links, read state, admin edit) lives in run-signals-public.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiSource = readFileSync(join(root, 'void-signals-api.js'), 'utf8');
const publicSource = readFileSync(join(root, 'void-signals-public.js'), 'utf8');
const publicCss = readFileSync(join(root, 'void-signals-public.css'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const adminSource = readFileSync(join(root, 'void-admin.js'), 'utf8');
const adminJs = readFileSync(join(root, 'void-signals-admin.js'), 'utf8');
const adminCss = readFileSync(join(root, 'void-signals-admin.css'), 'utf8');

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
  if (actual !== expected) {
    throw new Error((msg || 'values differ') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}
/* Comments are prose, not code: a gate must not trip on the word innerHTML in a
   sentence. Newlines are preserved so reported line numbers stay true. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '');
}

function match(re, msg, files) {
  for (const f of files) {
    const lines = stripComments(f.source).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        throw new Error(msg + ' — ' + f.name + ':' + (i + 1) + '  ' + lines[i].trim().slice(0, 88));
      }
    }
  }
}

/* ---------------- sandbox ---------------- */

function makeDom() {
  const created = [];
  function node(tag) {
    const n = {
      tagName: String(tag).toUpperCase(),
      className: '',
      id: '',
      type: '',
      href: '',
      rel: '',
      target: '',
      textContent: '',
      hidden: false,
      children: [],
      style: {
        props: {},
        setProperty(k, v) { this.props[k] = v; },
        removeProperty(k) { delete this.props[k]; }
      },
      dataset: {},
      attrs: {},
      listeners: {},
      setAttribute(k, v) {
        this.attrs[k] = String(v);
        if (k === 'class') this.className = String(v);
      },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        c.parentNode = null;
        return c;
      },
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      removeEventListener(ev, fn) {
        const l = this.listeners[ev] || [];
        const i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
      focus() {},
      contains() { return false; },
      parentNode: null
    };
    created.push(n);
    return n;
  }
  const body = node('body');
  return {
    created,
    body,
    document: {
      readyState: 'complete',
      hidden: false,
      body,
      documentElement: node('html'),
      activeElement: null,
      createElement: (t) => node(t),
      createTextNode: (v) => ({ nodeType: 3, textContent: String(v) }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      contains() { return false; }
    }
  };
}

function loadPublic(over) {
  const dom = makeDom();
  const session = new Map();
  const env = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval, URL, TextEncoder,
    fetch: () => Promise.resolve({ status: 200, text: async () => '{"ok":true}' }),
    location: { search: '', href: 'https://minoodar.github.io/void/' },
    sessionStorage: {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, String(v)),
      removeItem: (k) => session.delete(k)
    },
    document: dom.document,
    innerWidth: 1280,
    innerHeight: 720,
    matchMedia: () => ({ matches: false })
  };
  Object.assign(env, over || {});
  env.window = env;
  env.globalThis = env;
  vm.createContext(env);
  vm.runInContext(publicSource, env);
  return { env, dom, session, P: env.VoidSignalsPublic };
}

function loadApi(base) {
  const calls = [];
  const env = {
    console, setTimeout, clearTimeout,
    fetch: (url, init) => {
      calls.push({ url: String(url), init });
      return Promise.resolve({ status: 200, text: async () => '{"ok":true,"version":7,"messages":[]}' });
    }
  };
  if (base !== undefined) env.__VOID_API_BASE__ = base;
  env.window = env;
  vm.createContext(env);
  vm.runInContext(apiSource, env);
  return { env, calls, api: env.VoidSignalsApi };
}

/* ---------------- A. the API-origin correction ---------------- */

const WORKER = 'https://void-galaxy-letters.minoodar.workers.dev';

await test('createForPage falls back to the Worker when the page sets no base', async () => {
  const { api, calls } = loadApi('');
  await api.forPage().feed(20);
  equal(calls.length, 1, 'one request');
  equal(calls[0].url, WORKER + '/signals/messages?limit=20');
});

await test('an unset __VOID_API_BASE__ also falls back', async () => {
  const { api, calls } = loadApi(undefined);
  await api.forPage().health();
  equal(calls[0].url, WORKER + '/signals/version');
});

await test('a local base still wins and its trailing slash is trimmed', async () => {
  const { api, calls } = loadApi('http://127.0.0.1:8787/');
  await api.forPage().message('abc');
  equal(calls[0].url, 'http://127.0.0.1:8787/signals/messages/abc');
});

await test('Pages never asks github.io for /signals', async () => {
  const { api, calls } = loadApi('');
  await api.forPage().state(40);
  assert(calls[0].url.indexOf('github.io') < 0, 'relative path leaked the Pages origin: ' + calls[0].url);
  equal(calls[0].url, WORKER + '/signals/state?limit=40');
});

await test('the visitor client never carries a credential', async () => {
  const { api, calls } = loadApi('');
  const c = api.forPage();
  await c.health();
  await c.feed(10);
  await c.message('x');
  await c.profile();
  await c.state(10);
  equal(calls.length, 5);
  for (const call of calls) {
    assert(call.url.indexOf('/admin/') < 0, 'admin path reached from forPage(): ' + call.url);
    assert(!call.init.headers.Authorization, 'Authorization header sent');
    assert(!call.init.headers['X-Admin-Token'], 'admin token header sent');
    equal(call.init.credentials, 'omit', call.url);
    equal(call.init.method, 'GET', call.url);
  }
});

/* ---------------- B. URL safety (pure) ---------------- */

const T = () => loadPublic().P.__test;

await test('https, http and percent-encoded queries survive intact', async () => {
  const { splitLine } = T();
  const url = 'https://minoodar.github.io/void/?follow=https%3A%2F%2Frss.com%2Fpodcasts%2Fdivan-khial%2F';
  const parts = splitLine('add a podcast: ' + url + ' now');
  equal(parts.map((p) => p.kind).join(','), 'text,link,text');
  equal(parts[0].value, 'add a podcast: ');
  equal(parts[1].value, url, 'the production message URL must survive exactly');
  equal(parts[2].value, ' now');
  assert(splitLine('plain http://a.example/x').some((p) => p.kind === 'link'), 'http is allowed');
});

await test('http is allowed, an executable scheme is not', async () => {
  const { safeUrl } = T();
  equal(safeUrl('http://example.com/a'), 'http://example.com/a');
  equal(safeUrl('javascript:alert(1)'), null);
  equal(safeUrl('data:text/html,<script>'), null);
  equal(safeUrl('vbscript:msgbox(1)'), null);
  equal(safeUrl('blob:https://a.b/c'), null);
  equal(safeUrl('file:///etc/passwd'), null);
});

await test('a javascript: URL written into prose is never linked', async () => {
  const { splitLine } = T();
  const parts = splitLine('click javascript:alert(document.cookie) please');
  equal(parts.length, 1, 'nothing should be linkified');
  equal(parts[0].kind, 'text');
  assert(parts[0].value.indexOf('javascript:') === 6, 'original text is preserved verbatim');
});

await test('sentence punctuation is not swallowed by the link', async () => {
  const { stripTail, splitLine } = T();
  equal(stripTail('https://a.b/c.'), 'https://a.b/c');
  equal(stripTail('https://a.b/c,'), 'https://a.b/c');
  equal(stripTail('https://a.b/c...'), 'https://a.b/c');
  equal(stripTail('https://a.b/c;'), 'https://a.b/c');
  equal(stripTail('https://a.b/x?a=1&'), 'https://a.b/x?a=1');
  equal(stripTail('https://a.b/x?a=1&b=2'), 'https://a.b/x?a=1&b=2', 'a real query separator must survive');
  const parts = splitLine('see https://a.b/c, then go');
  equal(parts.map((p) => p.kind).join(','), 'text,link,text');
  equal(parts[1].value, 'https://a.b/c');
  equal(parts[2].value, ', then go', 'the comma returns to the prose');
});

/* The whole point of splitting a line is that the reader sees the same line. */
await test('a linkified line rebuilds to the original characters', async () => {
  const { splitLine } = T();
  const lines = [
    'کهکشان باز است https://minoodar.github.io/void/?follow=https%3A%2F%2Frss.com%2Fpodcasts%2Fdivan-khial%2F',
    'see https://a.b/c, then go.',
    '(try https://x.example/p_(q)) ok',
    'two https://a.one/1 and http://b.two/2?x=1&y=2 ends https://c.three/',
    'no link at all',
    'javascript:alert(1) stays prose',
    'trailing https://d.four/x...'
  ];
  for (const line of lines) {
    const rebuilt = splitLine(line).map((p) => p.value).join('');
    equal(rebuilt, line, 'lost or doubled characters in: ' + line);
  }
});

await test('balanced parentheses stay, an unbalanced closer goes', async () => {
  const { stripTail } = T();
  equal(stripTail('https://en.wikipedia.org/wiki/Foo_(bar)'), 'https://en.wikipedia.org/wiki/Foo_(bar)');
  equal(stripTail('https://a.b/c)'), 'https://a.b/c');
  equal(stripTail('https://a.b/c))'), 'https://a.b/c');
});

await test('Persian text against a link keeps both', async () => {
  const { splitLine } = T();
  const parts = splitLine('لینک https://void.example/x. بعد از آن');
  equal(parts.map((p) => p.kind).join(','), 'text,link,text');
  equal(parts[0].value, 'لینک ');
  equal(parts[1].value, 'https://void.example/x');
  equal(parts[2].value, '. بعد از آن');
});

await test('two links in one line keep the text between them', async () => {
  const { splitLine } = T();
  const parts = splitLine('a https://x.one/1 and https://x.two/2 b');
  equal(parts.map((p) => p.kind).join(','), 'text,link,text,link,text');
  equal(parts[2].value, ' and ');
});

await test('a hostless or single-label host is refused', async () => {
  const { safeUrl } = T();
  equal(safeUrl('https://nosuchsinglelabel'), null);
  equal(safeUrl('https://localhost:8787/x'), 'https://localhost:8787/x', 'loopback stays linkable');
  equal(safeUrl(''), null);
  equal(safeUrl(null), null);
});

/* ---------------- C. placement around the core ---------------- */

const GEO = { cx: 640, cy: 324, R: 266, hole: 120, w: 1280, h: 720, live: true };

await test('no star lands on the central disc', async () => {
  const { place } = T();
  const ids = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'];
  const spots = place(ids, GEO, []);
  equal(spots.length, ids.length);
  const inner = Math.max(GEO.R, GEO.hole * 0.9) * 1.16;
  for (const s of spots) {
    assert(s.x !== null, 'every id gets a spot on this viewport');
    const d = Math.hypot(s.x - GEO.cx, s.y - GEO.cy);
    assert(d > inner, 'star at ' + Math.round(d) + 'px is inside ' + Math.round(inner) + 'px');
  }
});

await test('stars stay inside the viewport and apart from each other', async () => {
  const { place } = T();
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10'];
  const spots = place(ids, GEO, []).filter((s) => s.x !== null);
  for (const s of spots) {
    assert(s.x >= 30 && s.x <= GEO.w - 30 && s.y >= 30 && s.y <= GEO.h - 30,
      'outside the edge guard: ' + s.x + ',' + s.y);
  }
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      assert(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) >= 55.9,
        'two stars share a spot');
    }
  }
});

await test('reserved chrome is routed around', async () => {
  const { place } = T();
  const dock = { left: 0, top: 600, right: 420, bottom: 720, area: 50400 };
  const spots = place(['s1', 's2', 's3'], GEO, [dock]).filter((s) => s.x !== null);
  assert(spots.length >= 1, 'placement still succeeds with one corner reserved');
  for (const s of spots) {
    assert(!(s.x > dock.left && s.x < dock.right && s.y > dock.top && s.y < dock.bottom),
      'a star was placed over the music dock: ' + s.x + ',' + s.y);
  }
});

await test('placement is deterministic for the same id set', async () => {
  const { place } = T();
  const ids = ['q1', 'q2', 'q3', 'q4'];
  const a = JSON.stringify(place(ids, GEO, []));
  const b = JSON.stringify(place(ids, GEO, []));
  equal(a, b, 'a repeat poll must not move the sky');
});

await test('a star that cannot be placed is skipped, not crash-inducing', async () => {
  const { place } = T();
  const tiny = { cx: 50, cy: 50, R: 40, hole: 0, w: 100, h: 100, live: false };
  const spots = place(['t1', 't2', 't3'], tiny, []);
  equal(spots.length, 3);
  for (const s of spots) assert(s.x === null || (s.x >= 30 && s.y >= 30), 'bad fallback spot');
});

/* ---------------- D. profile → tokens ---------------- */

await test('category beats importance beats global', async () => {
  const { profileFor } = T();
  const payload = {
    profiles: {
      g: { settings: { color: 'white' } },
      i: { settings: { color: 'ember' } },
      c: { settings: { color: 'ice' } },
      p: { settings: { color: 'silver' } }
    },
    assignments: { global: 'g', byCategory: { event: 'c' }, byImportance: { important: 'i' } }
  };
  equal(profileFor(payload, { category: 'event', importance: 'important' }).color, 'ice');
  equal(profileFor(payload, { category: 'general', importance: 'important' }).color, 'ember');
  equal(profileFor(payload, { category: 'general', importance: 'ambient' }).color, 'white');
  equal(profileFor(payload, { profile_id: 'p', category: 'general', importance: 'ambient' }).color, 'silver',
    'a message profile outranks every assignment');
  assert(profileFor({ profiles: {}, assignments: {} }, {}) === null, 'no profile is a valid answer');
});

await test('an out-of-range or invented setting cannot reach CSS', async () => {
  const { clampSettings, tokenMap } = T();
  const s = clampSettings({ size: 99, color: 'hotpink', style: 'javascript', motion: 'yes', drift: -5 });
  assert(s.size <= 2.2, 'size escaped its range: ' + s.size);
  equal(s.color, 'gold');
  equal(s.style, 'spark');
  equal(s.motion, 'animated');
  equal(s.drift, 0);
  const t = tokenMap(s, false);
  for (const k of Object.keys(t)) {
    assert(!/[<>;"'()]|url\(|expression/.test(String(t[k])), 'unsafe token value ' + k + '=' + t[k]);
  }
});

await test('static motion zeroes the animated tokens', async () => {
  const { tokenMap, clampSettings } = T();
  const t = tokenMap(clampSettings({ motion: 'static', drift: 1, motionIntensity: 1.6 }), true);
  equal(t['--ss-motion'], '0');
  equal(t['--ss-drift'], '0.00');
  const live = tokenMap(clampSettings({ motion: 'animated', drift: 0.5, motionIntensity: 1.2 }), false);
  assert(live['--ss-motion'] !== '0' && live['--ss-drift'] !== '0.00', 'animated profile lost its motion');
});

/* ---------------- E. session read state ---------------- */

await test('read marks persist for the session and nowhere else', async () => {
  const h = loadPublic();
  const { markRead, isRead } = h.P.__test;
  equal(isRead('m1'), false);
  equal(markRead('m1'), true);
  equal(markRead('m1'), false, 'a second open is not a second write');
  equal(JSON.parse(h.session.get('voidSignals.read.v1')).indexOf('m1') >= 0, true);
  const again = loadPublic({});
  equal(again.P.__test.isRead('m1'), false, 'a fresh session starts unread');
});

await test('corrupt read storage is ignored, not fatal', async () => {
  const h = loadPublic({});
  h.session.set('voidSignals.read.v1', '{not json');
  const again = (() => {
    const session = new Map([['voidSignals.read.v1', '{not json']]);
    const env = {
      console, setTimeout, clearTimeout, setInterval, clearInterval, URL,
      fetch: () => Promise.resolve({ status: 200, text: async () => '{}' }),
      location: { search: '' },
      sessionStorage: {
        getItem: (k) => (session.has(k) ? session.get(k) : null),
        setItem: (k, v) => session.set(k, v), removeItem: (k) => session.delete(k)
      },
      document: makeDom().document, innerWidth: 1280, innerHeight: 720
    };
    env.window = env;
    vm.createContext(env);
    vm.runInContext(publicSource, env);
    return env.VoidSignalsPublic;
  })();
  equal(again.__test.isRead('anything'), false);
});

await test('a non-array read payload cannot poison the map', async () => {
  const session = new Map([['voidSignals.read.v1', '{"a":1}']]);
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, URL,
    fetch: () => Promise.resolve({ status: 200, text: async () => '{}' }),
    location: { search: '' },
    sessionStorage: {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, v), removeItem: (k) => session.delete(k)
    },
    document: makeDom().document, innerWidth: 1280, innerHeight: 720
  };
  env.window = env;
  vm.createContext(env);
  vm.runInContext(publicSource, env);
  equal(env.VoidSignalsPublic.__test.isRead('a'), false);
});

/* ---------------- F. Chromium 70 floor ---------------- */

const publicPair = [
  { name: 'void-signals-public.js', source: publicSource },
  { name: 'void-signals-public.css', source: publicCss }
];
const publicJs = [{ name: 'void-signals-public.js', source: publicSource }];
const publicCssOnly = [{ name: 'void-signals-public.css', source: publicCss }];

await test('public JS avoids syntax newer than Chromium 70', async () => {
  match(/\?\./, 'optional chaining (Chrome 80)', publicPair);
  match(/\?\?/, 'nullish coalescing (Chrome 80)', publicPair);
  match(/\.replaceAll\(/, 'String.replaceAll (Chrome 85)', publicPair);
  match(/\.at\(/, 'Array/String.at (Chrome 92)', publicPair);
  match(/Object\.hasOwn\(/, 'Object.hasOwn (Chrome 93)', publicPair);
  match(/\.allSettled\(/, 'Promise.allSettled (Chrome 76)', publicPair);
  match(/\.matchAll\(/, 'String.matchAll (Chrome 74)', publicPair);
  match(/ResizeObserver/, 'ResizeObserver (Chrome 73)', publicPair);
  match(/IntersectionObserver/, 'IntersectionObserver stays unused', publicPair);
});

await test('public CSS avoids properties newer than Chromium 70', async () => {
  match(/\binset\s*:/, 'inset shorthand (Chrome 87)', publicCssOnly);
  match(/:has\(/, ':has() (Chrome 105)', publicCssOnly);
  match(/:is\(|:where\(/, ':is()/:where() (Chrome 88)', publicCssOnly);
  match(/[^-a-z]gap\s*:/, 'flex/grid gap (Chrome 84)', publicCssOnly);
  match(/[^-a-z]min\(|[^-a-z]max\(|[^-a-z]clamp\(/, 'math functions (Chrome 79)', publicCssOnly);
  match(/:focus-visible/, ':focus-visible (Chrome 86)', publicCssOnly);
  match(/aspect-ratio/, 'aspect-ratio (Chrome 88)', publicCssOnly);
  match(/overflow:\s*clip/, 'overflow:clip (Chrome 90)', publicCssOnly);
});

await test('backdrop-filter is never the only contrast', async () => {
  const i = publicCss.indexOf('backdrop-filter');
  assert(i > 0, 'expected a backdrop-filter rule');
  assert(publicCss.slice(i - 260, i).indexOf('@supports') >= 0, 'backdrop-filter must sit inside @supports');
  const block = publicCss.slice(publicCss.indexOf('dialog.vs-reveal'), i);
  assert(/background:\s*rgba\(/.test(block), 'the panel needs a solid fallback fill: ' + block);
});

await test('the dialog path degrades without showModal', async () => {
  assert(/typeof dlg\.showModal === 'function'/.test(publicSource), 'no showModal guard');
  assert(/vs-reveal--plain/.test(publicSource) && /vs-reveal--plain/.test(publicCss),
    'no non-modal fallback style');
});

/* ---------------- G. security boundaries ---------------- */

await test('signal text never reaches a markup parser', async () => {
  match(/innerHTML/, 'innerHTML in the public module', publicJs);
  match(/outerHTML/, 'outerHTML in the public module', publicJs);
  match(/insertAdjacentHTML/, 'insertAdjacentHTML in the public module', publicJs);
  match(/document\.write/, 'document.write in the public module', publicJs);
  match(/\beval\(/, 'eval in the public module', publicJs);
});

await test('the public layer holds no admin surface', async () => {
  match(/\/admin\//, 'admin endpoint in a public file', publicPair);
  match(/ADMIN_SECRET/, 'an admin secret in a public file', publicJs);
  match(/Authorization/, 'an authorization header in the public layer', publicJs);
  match(/localStorage/, 'persistent storage where the brief asked for session scope', publicJs);
});

await test('every link the layer builds is a new tab without opener access', async () => {
  assert(/a\.target = '_blank'/.test(publicSource), 'links must open in a new tab');
  assert(/a\.rel = 'noopener noreferrer'/.test(publicSource), 'links must drop window.opener');
});

await test('admin CSS stays scoped to the admin root', async () => {
  /* Keyframe bodies are steps, not selectors; a naive split sees "to {" as one. */
  const css = stripComments(adminCss).replace(/@(-webkit-)?keyframes[^{]*\{[\s\S]*?\n\}/g, '');
  const rules = css.split('}').filter((b) => b.indexOf('{') > 0);
  const loose = rules.filter((b) => {
    const sel = b.slice(0, b.indexOf('{')).trim();
    return sel && sel.charAt(0) !== '@' && sel.indexOf('#void-admin-root') !== 0;
  });
  equal(loose.length, 0, 'unscoped admin selectors: ' + loose.map((b) => b.slice(0, 40)).join(' | '));
});

/* ---------------- H. the wiring ---------------- */

await test('index.html loads the public layer before void-admin.js', async () => {
  const pub = indexHtml.indexOf('void-signals-public.js');
  const adm = indexHtml.indexOf('src="void-admin.js');
  assert(pub > 0, 'public layer is not referenced by index.html');
  assert(indexHtml.indexOf('void-signals-api.js') > 0, 'public client is not referenced');
  assert(indexHtml.indexOf('void-signals-public.css') > 0, 'public stylesheet is not referenced');
  /* Deferred scripts run in document order, so the public copy exists by the time
     the admin bundle decides what to inject. */
  assert(pub < adm, 'the admin bundle would load its own copy first');
});

await test('the admin bundle skips a module the page already has', async () => {
  assert(/BUNDLE_GLOBALS/.test(adminSource), 'no dedupe map in void-admin.js');
  assert(/VoidSignalsApi/.test(adminSource) && /VoidSignalsAdminExtra/.test(adminSource),
    'dedupe map does not cover the real globals');
});

await test('every public tag carries a cache key', async () => {
  const tags = indexHtml.match(/(void-signals-(?:public|api)\.[a-z]+)\?v=([0-9a-z]+)/g) || [];
  equal(tags.length, 3, 'expected css + api + public, each versioned');
  for (const t of tags) assert(/[?&]v=\d{8}[a-z]?/.test(t), 'weak cache key: ' + t);
});

await test('the admin edit affordances survived into this diff', async () => {
  assert(/function setDetailOpen/.test(adminJs), 'no single writer for the detail row');
  assert(!/addEventListener\('click', onMessagesClick\);\s*\n\s*if \(hosts\.messages\)/.test(adminJs),
    'the duplicate host-level toggle may be back');
  assert(/rowAction\('Edit', 'edit'/.test(adminJs), 'the Active table lost its Edit action');
  assert(/aria-controls/.test(adminJs), 'the title button lost aria-controls');
});

/* ---------------- I. the layer against the real client envelope ----------------
   The browser suite found this layer reading r.value while the shared client
   resolves { ok, status, data }. Nothing else here would catch that, so the whole
   chain runs in one context: real void-signals-api.js in front of a scripted fetch. */

const FEED_PAYLOAD = {
  ok: true,
  version: 12,
  server_time: 1795700000,
  messages: [
    {
      id: 'bc30d9f543481df3cdde28de6a00b846', title: 'پیام تست',
      body: 'با این لینک میتوانید یک پادکست درجه یک را اضافه کنید ' +
        'https://minoodar.github.io/void/?follow=https%3A%2F%2Frss.com%2Fpodcasts%2Fdivan-khial%2F',
      category: 'event', importance: 'important', type: 'important',
      published_at: 1795690000, expires_at: null, profile_id: null, metadata: { lang: 'fa' }
    },
    {
      id: '1111111111111111111111111111aaaa', title: 'Release notes',
      body: 'Two lines.\nSecond with (parens) https://en.wikipedia.org/wiki/Void_(astronomy) end.',
      category: 'release', importance: 'important', type: 'important',
      published_at: 1795691000, expires_at: 1795800000, profile_id: 'p-gold', metadata: {}
    },
    {
      id: '7295d5b6b259591901a8ae9201cc6c6b', title: 'تست 2', body: 'این یک پیام تست است',
      category: 'general', importance: 'ambient', type: 'ambient',
      published_at: 1795692000, expires_at: null, profile_id: null, metadata: {}
    }
  ],
  profiles: {
    'p-base': {
      id: 'p-base', name: 'Base', version: 1,
      settings: { size: 1, glow: 1, style: 'spark', color: 'gold', preset: 'organic' }
    },
    'p-gold': {
      id: 'p-gold', name: 'Gold', version: 2,
      settings: { size: 1.4, glow: 1.5, style: 'bloom', color: 'ember' }
    }
  },
  assignments: { global: 'p-base', byCategory: { release: 'p-gold' }, byImportance: {} }
};

async function loadBoth(opts) {
  const want = opts || {};
  const dom = makeDom();
  const session = new Map();
  const calls = [];
  /* Enough of a MutationObserver to prove the layer watches for the container and
     lets go of it on stop(). Real mutation delivery is the browser suite's job. */
  const observers = [];
  function FakeObserver(cb) {
    const self = this;
    self.cb = cb;
    self.active = false;
    observers.push(self);
    self.observe = function (target, opts) {
      self.target = target;
      self.opts = opts;
      self.active = true;
    };
    self.disconnect = function () { self.active = false; };
  }
  const musicRoot = want.galaxy ? dom.document.createElement('div') : null;
  if (musicRoot) {
    musicRoot.id = 'void-music-root';
    dom.body.appendChild(musicRoot);
    dom.document.getElementById = (id) => (id === 'void-music-root' ? musicRoot : null);
  }
  const env = {
    console, URL, TextEncoder,
    /* The layer arms a 90 s poll and per-message expiry timers; a vm context
       shares the host event loop, so real timers here would keep the suite
       alive for hours. Nothing under test depends on a timer firing. */
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    fetch: (url) => {
      calls.push(String(url));
      const body = /\/signals\/version$/.test(String(url))
        ? { ok: true, version: FEED_PAYLOAD.version }
        : /\/signals\/messages\?/.test(String(url))
          ? { ok: true, version: FEED_PAYLOAD.version, messages: FEED_PAYLOAD.messages }
          : FEED_PAYLOAD;
      return Promise.resolve({ status: 200, text: async () => JSON.stringify(body) });
    },
    location: { search: '', href: 'https://minoodar.github.io/void/' },
    sessionStorage: {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, String(v)),
      removeItem: (k) => session.delete(k)
    },
    document: dom.document,
    innerWidth: 1280,
    innerHeight: 720,
    matchMedia: () => ({ matches: false }),
    MutationObserver: FakeObserver,
    addEventListener() {}, removeEventListener() {},
    __VOID_API_BASE__: 'https://worker.test'
  };
  env.window = env;
  env.globalThis = env;
  vm.createContext(env);
  vm.runInContext(apiSource, env);
  vm.runInContext(publicSource, env);
  await env.VoidSignalsPublic.refresh();
  return {
    env, dom, musicRoot, observers, P: env.VoidSignalsPublic, calls,
    fire: () => observers.forEach((o) => { if (o.active) o.cb([]); })
  };
}

function hostOf(dom) {
  return dom.body.children.filter((n) => n.id === 'void-signals-layer')[0];
}

await test('the layer prefers the existing Galaxy container over the body', async () => {
  const { musicRoot, observers, P } = await loadBoth({ galaxy: true });
  const host = musicRoot.children.filter((n) => n.id === 'void-signals-layer')[0];
  assert(host, 'the host was mounted inside #void-music-root');
  assert(!/vs-layer--body/.test(host.className), 'the body fallback class is not used');
  equal(host.hidden, false, 'a layer with stars is revealed');
  equal(host.children.length, 3, 'the stars live in that host');
  equal(observers.length, 0, 'a layer already in place watches nothing');
  P.stop();
  assert(!musicRoot.children.length, 'stop() removes only our own node');
});

await test('without the Galaxy container the body fallback still works', async () => {
  const { dom, P } = await loadBoth();
  const host = hostOf(dom);
  assert(host, 'the host fell back to the body');
  assert(/vs-layer--body/.test(host.className), 'the fallback class is set');
  P.stop();
});

/* The shell builds #void-music-root the first time the Galaxy view opens, which
   is after DOMContentLoaded. A body-level layer then sits under that root (z-index
   1000) and stops taking clicks, so the watcher has to move it. */
await test('a Galaxy container built after boot reclaims the layer', async () => {
  const { dom, observers, fire, P } = await loadBoth();
  const host = hostOf(dom);
  equal(P.counts().mount, 'body', 'the layer started on the body fallback');
  equal(observers.length, 1, 'start() watches the body for the container');
  assert(observers[0].active && observers[0].target === dom.body, 'watching body childList');
  const musicRoot = dom.document.createElement('div');
  musicRoot.id = 'void-music-root';
  dom.body.appendChild(musicRoot);
  dom.document.getElementById = (id) => (id === 'void-music-root' ? musicRoot : null);
  fire();
  equal(P.counts().mount, 'galaxy', 'the watcher moved it without waiting for the next poll');
  equal(host.parentNode, musicRoot, 'the host is now a child of the container');
  assert(!/vs-layer--body/.test(host.className), 'and the fallback class is gone');
  equal(musicRoot.children.filter((n) => n.id === 'void-signals-layer').length, 1, 'one host, not two');
  equal(host.children.length, 3, 'the stars travelled with it');
  equal(observers[0].active, false, 'the watcher stands down once the layer is in place');
  fire();
  equal(musicRoot.children.length, 1, 'a later body mutation adds nothing');
  P.stop();
  equal(observers.length, 1, 'stop() has no observer left to release');
  equal(P.counts().mount, 'none', 'stop() forgets the mount');
});

await test('a Worker payload becomes stars through the shared client', async () => {
  const { env, dom, P, calls } = await loadBoth();
  const counts = P.counts();
  equal(counts.errors, 0, 'no error recorded: ' + counts.lastError);
  equal(counts.eligible, 3, 'eligible taken from the payload');
  equal(counts.version, 12, 'version read from the payload');
  const host = hostOf(dom);
  assert(host, 'the layer host is in the body');
  const ids = host.children.map((n) => n.attrs['data-signal-id']).sort();
  equal(ids.join(','), FEED_PAYLOAD.messages.map((m) => m.id).sort().join(','), 'star ids follow the feed');
  assert(calls.some((u) => /\/signals\/state\?limit=40$/.test(u)), 'boot used the combined state endpoint');
  P.stop();
  assert(!hostOf(dom), 'stop() takes the host out of the body');
  const after = env.VoidSignalsPublic.counts();
  equal(after.eligible, 0, 'stop() empties the item set');
  equal(after.placed, 0, 'nothing is left placed');
  assert(!after.revealed, 'no surface stays open after stop()');
});

await test('the profile the Worker ships reaches the star tokens', async () => {
  const { dom, P } = await loadBoth();
  const host = hostOf(dom);
  equal(host.attrs['data-color'], 'gold', 'the global profile sets the layer baseline');
  equal(host.style.props['--ss-size'], '1', 'global size written once on the host');
  const star = host.children.filter((n) => n.attrs['data-signal-id'] === '1111111111111111111111111111aaaa')[0];
  equal(star.attrs['data-style'], 'bloom', 'style came from the category profile');
  equal(star.style.props['--ss-size'], '1.4', 'the override is written on the star');
  equal(star.style.props['--ss-a'], '#f0b072', 'ember came through as the token pair');
  const plain = host.children.filter((n) => n.attrs['data-signal-id'] === '7295d5b6b259591901a8ae9201cc6c6b')[0];
  equal(plain.attrs['data-style'], 'spark', 'an unmatched message keeps the global profile');
  assert(!plain.style.props['--ss-size'], 'and writes no duplicate tokens');
  P.stop();
});

await test('opening a star from that payload builds a safe clickable link', async () => {
  const { dom, P } = await loadBoth();
  assert(P.open('bc30d9f543481df3cdde28de6a00b846'), 'open reported success');
  const dlg = dom.created.filter((n) => n.className.indexOf('vs-reveal') === 0)[0];
  assert(dlg, 'a reveal surface was built');
  const layerHost = hostOf(dom);
  assert(dlg.parentNode === layerHost.parentNode, 'the reveal is a sibling of the layer host in the same container');
  assert(dlg.parentNode !== layerHost, 'never inside the layer itself, which is pointer-events:none');
  equal(dom.created.filter((n) => n.tagName === 'H2')[0].textContent, 'پیام تست');
  const links = dom.created.filter((n) => n.tagName === 'A');
  equal(links.length, 1, 'one anchor for the one URL in that body');
  equal(links[0].href, 'https://minoodar.github.io/void/?follow=https%3A%2F%2Frss.com%2Fpodcasts%2Fdivan-khial%2F');
  equal(links[0].target, '_blank');
  equal(links[0].rel, 'noopener noreferrer');
  equal(P.readState('bc30d9f543481df3cdde28de6a00b846'), true, 'opening marks it read');
  P.close();
  P.stop();
});

/* The one browser run could not teach: Music Mode routes keydown on document in the
   capture phase (void-music.js:2955), so a bare Escape never reaches the dialog and the
   router leaves Music Mode instead. The reveal has to claim it on the window first, and
   only a bare Escape, or every other shell shortcut goes with it. */
await test('the reveal claims a bare Escape on the window before the Music Mode router', async () => {
  const { env, P } = await loadBoth();
  const added = [], removed = [];
  env.addEventListener = function (ev, fn, cap) { added.push([ev, fn, !!cap]); };
  env.removeEventListener = function (ev, fn, cap) { removed.push([ev, fn, !!cap]); };
  const fire = (props) => {
    let prevented = 0, stopped = 0;
    added.filter((r) => r[0] === 'keydown').forEach((r) => r[1].call(env, Object.assign({
      ctrlKey: false, metaKey: false, altKey: false,
      preventDefault: () => { prevented++; },
      stopPropagation: () => { stopped++; }
    }, props)));
    return { prevented, stopped, keys: added.filter((r) => r[0] === 'keydown').length };
  };
  P.open('bc30d9f543481df3cdde28de6a00b846');
  const owner = added.filter((r) => r[0] === 'keydown');
  equal(owner.length, 1, 'exactly one keydown owner per open reveal');
  equal(owner[0][2], true, 'bound in the capture phase, the only phase ahead of document capture');
  const esc = fire({ key: 'Escape' });
  equal(esc.prevented, 1, 'a bare Escape is claimed so the router never runs');
  equal(esc.stopped, 1, 'and propagation is halted at the window');
  assert(!P.instance().reveal, 'the first Escape closes the reveal');
  P.open('7295d5b6b259591901a8ae9201cc6c6b');
  equal(fire({ key: 'm' }).prevented, 0, 'other shortcuts are left to the shell');
  assert(!!P.instance().reveal, 'and the surface stays open for them');
  equal(fire({ key: 'Escape', ctrlKey: true }).prevented, 0, 'a modified Escape is not ours');
  assert(!!P.instance().reveal, 'so the reveal survives it');
  P.close();
  const off = removed.filter((r) => r[0] === 'keydown');
  equal(off.length, added.filter((r) => r[0] === 'keydown').length,
    'every window listener the reveal bound was released, one per open');
  assert(off.length > 0 && off.every((r) => r[2]), 'each released with the capture flag it was bound with');
  P.stop();
  equal(removed.filter((r) => r[0] === 'keydown').length,
    added.filter((r) => r[0] === 'keydown').length, 'nothing left dangling after stop()');
});

await test('the layer reads the client envelope from one field only', async () => {
  assert(!/r\.value|result\.value/.test(publicSource),
    'the client resolves { ok, status, data }; reading .value yields undefined');
  assert(/r\.data/.test(publicSource), 'no envelope read found at all');
});

/* Additions the two floor gates above do not cover: the mount watcher has to be
   feature-guarded, and globalThis (Chrome 71) is only ever reached in the footer. */
await test('the mount watcher and the module footer stay on the floor', async () => {
  assert(/global\.MutationObserver &&/.test(publicSource), 'the container watcher is feature-guarded');
  assert(!/structuredClone/.test(publicSource), 'structuredClone (Chrome 98)');
  const gti = publicSource.split('\n').filter((l) => l.indexOf('globalThis') !== -1);
  equal(gti.length, 1, 'globalThis (Chrome 71) appears only in the UMD footer');
  assert(/typeof window !== 'undefined' \? window : globalThis/.test(gti[0] || ''),
    'and only as the non-browser fallback: ' + String(gti[0]).trim());
});

console.log('\n' + passed + '/' + (passed + failed) + ' checks passed');
if (failed) {
  console.log('FAILURES:');
  for (const f of failures) console.log('- ' + f);
  process.exitCode = 1;
}
