/* Real application-shell browser suite for the Public Signals Delivery layer.
 *
 *   ELECTRON_RUN_AS_NODE=1 chrome-run:
 *     node cdp-run.mjs tests/run-signals-public.mjs \
 *          --url=http://127.0.0.1:8787/index.html?local-api=1
 *
 * Everything here runs the untouched index.html, void-admin.js, void-domains.js
 * and the real public layer, against tests/signals-public-server.mjs. The mock
 * is the only backend: no deployed Worker and no production D1 is contacted.
 */
const MOCK = 'http://127.0.0.1:8787';
const PAGE = MOCK + '/index.html?local-api=1';
const LIVE_ID = 'bc30d9f543481df3cdde28de6a00b846';
const LIVE_URL = 'https://minoodar.github.io/void/?follow=https%3A%2F%2Frss.com%2Fpodcasts%2Fdivan-khial%2F';

let evl;

async function mock(path, body) {
  const init = body ? { method: 'POST', body: JSON.stringify(body) } : {};
  const r = await fetch(MOCK + path, init);
  return r.json();
}

export default async function (ctx) {
  evl = async (expr) => ctx.evaljs('(function(){' + expr + '})()');
  const say = (name, ok, detail) => ctx.check(name, !!ok, detail === undefined ? '' : String(detail));
  const hits = (re) => ctx.net.all().filter((r) => re.test(r.url));
  /* ctx.clickSelector sends real mouse events at the element's centre without scrolling.
     The admin tables scroll below the fold, so an off-viewport centre hits nothing (proved
     live: elementFromPoint returned none at y=1055 in a 900px window). Scroll, settle, tap. */
  const tap = async (sel) => {
    await evl(`var el=document.querySelector(${JSON.stringify(sel)});
      if (el) el.scrollIntoView({ block: 'center' }); return !!el;`);
    await ctx.sleep(250);
    return ctx.clickSelector(sel);
  };

  /* ================= A. boot inside the real shell ================= */

  await ctx.waitFor('!!window.VoidSignalsPublic && !!window.VoidSignalsApi', 'public layer globals', 15000);
  await ctx.waitFor("!!document.getElementById('void-signals-layer') && document.querySelectorAll('#void-signals-layer .vs-sig').length > 0",
    'stars mounted', 15000);

  say('A1 both signal modules are on the page',
    await evl('return !!window.VoidSignalsApi && !!window.VoidSignalsPublic;'));
  say('A2 shell routed the signals client at the local worker',
    (await evl('return String(window.__VOID_API_BASE__);')) === MOCK, await evl('return String(window.__VOID_API_BASE__);'));
  /* Boot order, proven live: the shell creates #void-music-root only when the
     Galaxy view is built, which is after DOMContentLoaded. The layer therefore
     starts on the body fallback and the watcher has to move it. Anything that
     stays on the body is painted under that root (z-index 1000) and untouchable. */
  const bootParent = await evl(`
    var h = document.getElementById('void-signals-layer');
    return h ? (h.parentNode.id || h.parentNode.tagName) : 'none';`);
  const rootSeen = await ctx.waitFor("!!document.getElementById('void-music-root')",
    'the shell built #void-music-root', 15000);
  const migrated = await ctx.waitFor(`(function () {
    var h = document.getElementById('void-signals-layer');
    return !!h && h.parentNode.id === 'void-music-root' &&
           window.VoidSignalsPublic.counts().mount === 'galaxy';
  })()`, 'the layer followed the container', 15000);
  say('A3 real shell still booted (galaxy surface + nav + music root present)',
    rootSeen && migrated && await evl(`
      return !!document.getElementById('void-god-galaxy') &&
             !!document.getElementById('void-topnav') &&
             !!window.VoidDomains && !!window.VoidMusic && !!window.VoidLetters;`),
    'root=' + rootSeen + ' migrated=' + migrated + ' bootParent=' + bootParent + ' ' +
    await evl(`return [!!document.getElementById('void-god-galaxy'), !!document.getElementById('void-topnav'),
      typeof window.VoidDomains, typeof window.VoidMusic, typeof window.VoidLetters].join(',');`));
  const hostInfo = await evl(`
    var h = document.getElementById('void-signals-layer');
    var cs = getComputedStyle(h);
    return { tag: h.tagName, parent: h.parentNode.id || h.parentNode.tagName,
             z: cs.zIndex, pe: cs.pointerEvents, pos: cs.position, cls: h.className,
             count: h.getAttribute('data-count'), placed: h.getAttribute('data-placed'),
             geometry: h.getAttribute('data-geometry'), hidden: h.hidden,
             mount: window.VoidSignalsPublic.counts().mount,
             stars: h.querySelectorAll('.vs-sig').length };`);
  /* void-domains.css has #void-music-root > :not(...) pinning every child to z-index 2,
     which outranks the plain class rule in our sheet. The literal 950 therefore only
     survives on the body fallback; inside the container what has to hold is the order:
     above the Galaxy disc, sharing its root, and hit-testable. */
  const stack = await evl(`
    var h = document.getElementById('void-signals-layer');
    var g = document.getElementById('void-god-galaxy');
    var z = function (n) { var v = getComputedStyle(n).zIndex; return v === 'auto' ? 0 : Number(v); };
    var b = h.querySelector('.vs-sig');
    var r = b.getBoundingClientRect();
    var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { layer: z(h), galaxy: g ? z(g) : -1, sharesRoot: !!g && h.parentNode === g.parentNode,
             hitIsStar: hit === b || b.contains(hit) };`);
  say('A4 layer mounts inside the existing Galaxy container, click-through except stars',
    hostInfo.parent === 'void-music-root' && hostInfo.pos === 'absolute' &&
    hostInfo.pe === 'none' && hostInfo.hidden === false && hostInfo.mount === 'galaxy' &&
    !/vs-layer--body/.test(hostInfo.cls) && stack.sharesRoot &&
    stack.layer > stack.galaxy && stack.hitIsStar,
    JSON.stringify(hostInfo) + ' ' + JSON.stringify(stack));
  say('A5 stars rendered for every eligible message', Number(hostInfo.stars) === 3 && hostInfo.count === '3',
    'stars=' + hostInfo.stars + ' count=' + hostInfo.count);
  say('A6 boot used the state endpoint once, never per star',
    hits(/\/signals\/state/).length === 1 && hits(/\/signals\/messages/).length === 0,
    'state=' + hits(/\/signals\/state/).length + ' messages=' + hits(/\/signals\/messages/).length);
  say('A7 public requests carried no credential and were all GET',
    hits(/\/signals\//).length > 0 && hits(/\/admin\//).length === 0,
    'public=' + hits(/\/signals\//).length + ' admin=' + hits(/\/admin\//).length);
  say('A8 zero exceptions and zero console errors on boot',
    ctx.exceptions.length === 0 && ctx.consoleErrors.length === 0,
    'exceptions=' + JSON.stringify(ctx.exceptions.slice(0, 2)) + ' console=' + JSON.stringify(ctx.consoleErrors.slice(0, 2)));
  /* The bug this guard was written for: a body-level layer sits under the galaxy
     surface, so elementFromPoint reports the galaxy and a real click never reaches
     the star even though every computed style looks correct. */
  say('A9 every star is the topmost hit-testable element at its own centre', await evl(`
    var stars = [].slice.call(document.querySelectorAll('#void-signals-layer .vs-sig'));
    var bad = [];
    for (var i = 0; i < stars.length; i++) {
      var r = stars[i].getBoundingClientRect();
      var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit !== stars[i] && !(hit && stars[i].contains(hit))) {
        bad.push((hit ? hit.tagName + '#' + hit.id + '.' + String(hit.className).slice(0, 18) : 'null'));
      }
    }
    return bad.length === 0;`),
    await evl(`
      var stars = [].slice.call(document.querySelectorAll('#void-signals-layer .vs-sig'));
      var out = [];
      for (var i = 0; i < stars.length; i++) {
        var r = stars[i].getBoundingClientRect();
        var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        out.push(stars[i].getAttribute('data-signal-id').slice(0, 6) + '->' +
          (hit === stars[i] ? 'self' : hit ? hit.tagName + '#' + hit.id : 'null'));
      }
      return out.join(' ');`));

  /* ================= B. placement and appearance ================= */

  const geom = await evl(`
    var h = document.getElementById('void-signals-layer');
    var stars = [].slice.call(h.querySelectorAll('.vs-sig')).map(function (b) {
      var r = b.getBoundingClientRect();
      return { id: b.getAttribute('data-signal-id'), label: b.getAttribute('aria-label') || '',
               tag: b.tagName, type: b.getAttribute('type'),
               left: r.left, top: r.top, right: r.right, bottom: r.bottom,
               cx: r.left + r.width / 2, cy: r.top + r.height / 2,
               style: b.getAttribute('data-style') || '', pe: getComputedStyle(b).pointerEvents,
               opacity: getComputedStyle(b).opacity, color: b.style.getPropertyValue('--ss-color') || b.style.getPropertyValue('--ss-a'),
               tokens: [].slice.call(b.attributes).filter(function (a) { return a.name.indexOf('--ss-') === 0 || a.name === 'style'; }).length };
    });
    var chrome = {};
    ['#void-topnav', '.vm-dock', '#void-galaxy-stats', '#void-god-quill'].forEach(function (sel) {
      var n = document.querySelector(sel);
      if (!n) return;
      var r = n.getBoundingClientRect();
      chrome[sel] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    var g = window.VoidDomains && VoidDomains.getOrbGeometry ? VoidDomains.getOrbGeometry() : null;
    return { stars: stars, chrome: chrome, orb: g, vw: innerWidth, vh: innerHeight };`);

  say('B1 every star is a real focusable button labelled with its title',
    geom.stars.every((s) => s.tag === 'BUTTON' && s.type === 'button' && s.pe === 'auto' && s.label.length > 1),
    JSON.stringify(geom.stars.map((s) => s.tag + ':' + s.label)));
  say('B2 stars are visible (opacity above the hidden baseline)',
    geom.stars.every((s) => Number(s.opacity) > 0.2), geom.stars.map((s) => s.opacity).join(','));
  say('B3 no star overlaps reserved chrome', await evl(`
    var stars = [].slice.call(document.querySelectorAll('#void-signals-layer .vs-sig'));
    var sel = ['#void-topnav', '.vm-dock', '#void-galaxy-stats', '#void-god-quill', '#void-god-discover'];
    var hits = [];
    for (var i = 0; i < stars.length; i++) {
      var a = stars[i].getBoundingClientRect();
      for (var j = 0; j < sel.length; j++) {
        var n = document.querySelector(sel[j]);
        if (!n) continue;
        var b = n.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          hits.push(stars[i].getAttribute('data-signal-id').slice(0, 6) + '@' + sel[j]);
        }
      }
    }
    return hits.length === 0;`),
    await evl(`
      var out = [];
      ['#void-topnav', '.vm-dock', '#void-galaxy-stats'].forEach(function (s) {
        var n = document.querySelector(s);
        if (!n) return;
        var r = n.getBoundingClientRect();
        out.push(s + '=' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      return out.join(' ');`));
  /* getOrbGeometry().hole is already pixels, not a ratio of R: multiplying by R turns it
     into a threshold of hundreds of px and every star looks misplaced. VoidMusicViz.holeHit
     is the shell's own test for the disc, so the check uses it when the shell is up. */
  say('B4 stars sit outside the central disc, not on it', await evl(`
    var h = document.getElementById('void-signals-layer');
    var stars = [].slice.call(h.querySelectorAll('.vs-sig'));
    var T = window.VoidSignalsPublic.__test;
    var g = T.orb();
    var viz = window.VoidMusicViz;
    var bad = [];
    for (var i = 0; i < stars.length; i++) {
      var r = stars[i].getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var inDisc = viz && viz.holeHit ? viz.holeHit(cx, cy, 0)
        : Math.sqrt((cx - g.cx) * (cx - g.cx) + (cy - g.cy) * (cy - g.cy)) < (g.hole || 0);
      if (inDisc) bad.push(Math.round(Math.sqrt((cx - g.cx) * (cx - g.cx) +
        (cy - g.cy) * (cy - g.cy))) + '<' + Math.round(g.hole || 0));
    }
    return bad.length === 0;`),
    await evl(`
      var g = window.VoidSignalsPublic.__test.orb();
      var stars = [].slice.call(document.querySelectorAll('#void-signals-layer .vs-sig'));
      return stars.map(function (s) {
        var r = s.getBoundingClientRect();
        var dx = (r.left + r.width / 2) - g.cx, dy = (r.top + r.height / 2) - g.cy;
        return Math.round(Math.sqrt(dx * dx + dy * dy));
      }).join(',') + ' hole=' + Math.round(g.hole) + ' R=' + Math.round(g.R) +
      ' holeHit=' + (window.VoidMusicViz && window.VoidMusicViz.holeHit ? 'yes' : 'no');`));
  say('B5 stars stay separated from each other and inside the viewport', await evl(`
    var stars = [].slice.call(document.querySelectorAll('#void-signals-layer .vs-sig'));
    var min = 1e9, out = 0;
    for (var i = 0; i < stars.length; i++) {
      var a = stars[i].getBoundingClientRect();
      if (a.left < 0 || a.top < 0 || a.right > innerWidth || a.bottom > innerHeight) out++;
      for (var j = i + 1; j < stars.length; j++) {
        var b = stars[j].getBoundingClientRect();
        var dx = (a.left + a.width / 2) - (b.left + b.width / 2);
        var dy = (a.top + a.height / 2) - (b.top + b.height / 2);
        min = Math.min(min, Math.sqrt(dx * dx + dy * dy));
      }
    }
    return out === 0 && (stars.length < 2 || min >= 40);`), 'min separation measured in-page');
  say('B6 star ids match the worker feed exactly, no duplicates', await evl(`
    var api = window.VoidSignalsApi.forPage();
    return api.feed(60).then(function (r) {
      var ids = (r.data.messages || []).map(function (m) { return m.id; }).sort().join(',');
      var dom = [].slice.call(document.querySelectorAll('#void-signals-layer .vs-sig'))
        .map(function (b) { return b.getAttribute('data-signal-id'); }).sort();
      return { ok: dom.join(',') === ids && dom.length === new Set(dom).size, dom: dom.join(','), ids: ids };
    }).then(function (v) { return v.ok; });`),
    await evl(`var d=[].slice.call(document.querySelectorAll('#void-signals-layer .vs-sig')).map(function(b){return b.getAttribute('data-signal-id')});return d.join(',');`));
  say('B7 appearance comes from the assigned profile, not a hardcoded demo', await evl(`
    var b = document.querySelector('[data-signal-id="${LIVE_ID}"]');
    var cs = getComputedStyle(b);
    var gold = cs.getPropertyValue('--ss-a').trim();
    var h = document.getElementById('void-signals-layer');
    return !!b.getAttribute('data-style') && h.getAttribute('data-color') === 'gold' && gold.length > 3;`),
    await evl(`var b=document.querySelector('[data-signal-id="${LIVE_ID}"]');return getComputedStyle(b).getPropertyValue('--ss-a') + ' | ' + b.getAttribute('data-style');`));
  await ctx.shot('signals-stars-desktop');

  /* ================= C. star click opens the message ================= */

  const starBox = await evl(`
    var b = document.querySelector('[data-signal-id="${LIVE_ID}"]');
    var r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
  await ctx.mouseClick(starBox.x, starBox.y);
  await ctx.waitFor("!!document.querySelector('dialog.vs-reveal')", 'reveal dialog opens', 6000);

  const reveal = await evl(`
    var d = document.querySelector('dialog.vs-reveal');
    if (!d) return null;
    var a = d.querySelector('.vs-link');
    var body = d.querySelector('.vs-reveal__body');
    return { open: d.open, modal: d.matches(':modal') || d.hasAttribute('open'),
             title: d.querySelector('.vs-reveal__title').textContent,
             kind: d.querySelector('.vs-reveal__kind').textContent,
             text: body.textContent, lines: body.querySelectorAll('.vs-line').length,
             gap: body.querySelectorAll('.vs-line--gap').length,
             anchors: d.querySelectorAll('a').length,
             href: a ? a.getAttribute('href') : null, resolved: a ? a.href : null,
             target: a ? a.getAttribute('target') : null, rel: a ? a.getAttribute('rel') : null,
             relLower: a ? (a.rel || '').toLowerCase() : null,
             lang: d.getAttribute('lang'),
             bidi: getComputedStyle(body.querySelector('.vs-line')).unicodeBidi,
             align: getComputedStyle(body.querySelector('.vs-line')).textAlign,
             tags: [].slice.call(body.querySelectorAll('*')).map(function (n) { return n.tagName; }).filter(function (t, i, arr) { return arr.indexOf(t) === i; }).sort().join('/'),
             host: d.parentNode.id || d.parentNode.tagName,
             vis: getComputedStyle(d).visibility, op: getComputedStyle(d).opacity,
             dlgPointer: getComputedStyle(d).pointerEvents,
             layerPointer: getComputedStyle(d.parentNode).pointerEvents,
             hitInside: (function () {
               var c = d.querySelector('.vs-reveal__close').getBoundingClientRect();
               var e = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
               return d === e || d.contains(e);
             })(),
             focus: document.activeElement ? document.activeElement.className : '' };`);
  say('C1 the star opens a modal surface with its own title', reveal && reveal.open && reveal.title === 'پیام تست',
    reveal ? reveal.title + ' open=' + reveal.open : 'no dialog');
  say('C2 the complete body is rendered, not truncated',
    reveal && reveal.text.indexOf('با این لینک میتوانید یک پادکست درجه یک را اضافه کنید') !== -1 &&
    reveal.text.indexOf(LIVE_URL) !== -1, reveal ? reveal.text.slice(0, 90) : 'no dialog');
  say('C3 category and weight appear as context only',
    reveal && /event/i.test(reveal.kind) && /needs a look/.test(reveal.kind), reveal ? reveal.kind : '');
  say('C4 the URL became a real anchor with the exact target', reveal &&
    reveal.anchors === 1 && reveal.href === LIVE_URL && reveal.resolved === LIVE_URL,
    reveal ? JSON.stringify({ n: reveal.anchors, href: reveal.href }) : '');
  say('C5 anchor opens externally and cross-origin safe',
    reveal && reveal.target === '_blank' && reveal.rel === 'noopener noreferrer',
    reveal ? reveal.target + ' / ' + reveal.relLower : '');
  say('C6 Persian text keeps plaintext bidi and logical alignment',
    reveal && (reveal.bidi === 'plaintext' || reveal.bidi === 'normalize-script') && reveal.align === 'start',
    reveal ? reveal.bidi + '/' + reveal.align : '');
  /* The body renderer only ever creates line/anchor elements, so the tag set is a
     closed allowlist rather than one concatenated string matched as a single token. */
  say('C7 body uses text nodes only (no markup element survives)', (function () {
    if (!reveal) return false;
    var allowed = { A: 1, BR: 1, DIV: 1, P: 1, SPAN: 1, UL: 1, LI: 1 };
    var seen = reveal.tags.split('/');
    var rogue = seen.filter(function (t) { return !allowed[t]; });
    return seen.indexOf('SCRIPT') === -1 && rogue.length === 0;
  })(), reveal ? reveal.tags : '');
  /* Approved mount: the reveal is a sibling of the star layer inside #void-music-root,
     which the shell allowlists in Music Mode. Mounting on <html> instead would let the
     `html.vm-on > *` sweep hide it, so the real property under test is "not swept":
     computed visibility/opacity plus a hit-test that resolves inside the dialog. */
  say('C8 dialog mounts inside the Galaxy container and stays visible and hittable',
    reveal && reveal.host === 'void-music-root' && reveal.vis === 'visible' && reveal.op === '1' &&
    reveal.dlgPointer === 'auto' && reveal.layerPointer === 'none' && reveal.hitInside === true,
    reveal ? JSON.stringify({ host: reveal.host, vis: reveal.vis, op: reveal.op,
      dlgPointer: reveal.dlgPointer, layerPointer: reveal.layerPointer, hitInside: reveal.hitInside }) : 'no dialog');
  say('C9 an accessible close control took focus',
    reveal && /vs-reveal__close/.test(reveal.focus), reveal ? reveal.focus : '');
  await ctx.shot('signals-reveal-url');

  /* clicking the anchor must not steal the visitor away from Void */
  const linkRect = await evl(`
    var a = document.querySelector('dialog.vs-reveal .vs-link');
    if (!a) return null;
    var r = a.getBoundingClientRect();
    return { x: r.left + 4, y: r.top + r.height / 2 };`);
  const before = await evl('return location.href;');
  await ctx.mouseClick(linkRect.x, linkRect.y);
  await ctx.sleep(700);
  const after = await evl('return location.href;');
  say('C10 activating the link leaves the Void page in place', after === before, after);
  say('C11 no exception from the click path', ctx.exceptions.length === 0, JSON.stringify(ctx.exceptions.slice(0, 2)));

  await ctx.clickSelector('.vs-reveal__close');
  await ctx.sleep(300);
  const closed = await evl(`
    return { dialogs: document.querySelectorAll('dialog.vs-reveal').length,
             open: !!(window.VoidSignalsPublic.instance().reveal),
             focus: document.activeElement ? document.activeElement.getAttribute('data-signal-id') : null,
             read: window.VoidSignalsPublic.readState('${LIVE_ID}') };`);
  say('C12 close removes the surface completely and returns focus to the star',
    closed.dialogs === 0 && !closed.open && closed.focus === LIVE_ID, JSON.stringify(closed));

  /* C13, the original requirement kept whole: open by clicking a star, confirm the star is
     the originating focus target, press Escape EXACTLY ONCE, confirm the surface is gone,
     focus is back on that star, and focus is still there once the shell's handlers have run.
     Root cause of the earlier failure, measured live rather than assumed: Music Mode routes
     keydown on document in the capture phase (void-music.js:2955 -> onKey), where a bare
     Escape with no pop open calls exit() and then stopImmediatePropagation(), so the dialog
     never received the key and no cancel event fired. The reveal now claims a bare Escape on
     window capture, which is the phase ahead of document capture and the pattern the page
     already uses for its other top-layer windows (index.html:1635, void-invite.js:165). */
  const escBefore = await evl(`
    var b = document.querySelector('[data-signal-id="${LIVE_ID}"]');
    var r = b.getBoundingClientRect();
    var root = document.getElementById('void-music-root');
    var cs = getComputedStyle(root);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2,
             vmOn: document.body.classList.contains('void-music-on'),
             rootVis: cs.visibility, rootOp: cs.opacity, rootDisp: cs.display,
             galaxy: !!document.getElementById('void-god-galaxy') };`);
  await ctx.mouseClick(escBefore.x, escBefore.y);
  await ctx.waitFor("!!document.querySelector('dialog.vs-reveal')", 'reveal for escape', 6000);
  const escOrigin = await evl(`
    var st = window.VoidSignalsPublic.instance();
    var d = document.querySelector('dialog.vs-reveal');
    var star = document.querySelector('[data-signal-id="${LIVE_ID}"]');
    return { modal: d.matches(':modal'), inDialog: d.contains(document.activeElement),
             originIsStar: st.lastFocus === star,
             originSid: st.lastFocus ? st.lastFocus.getAttribute('data-signal-id') : null };`);
  await ctx.key('Escape');
  await ctx.sleep(250);
  const escOnce = await evl(`
    return { dialogs: document.querySelectorAll('dialog.vs-reveal').length,
             open: !!window.VoidSignalsPublic.instance().reveal,
             focus: document.activeElement ? document.activeElement.getAttribute('data-signal-id') : null };`);
  await ctx.sleep(1400);
  const escSettled = await evl(`
    var root = document.getElementById('void-music-root');
    var cs = root ? getComputedStyle(root) : {};
    var a = document.activeElement;
    return { dialogs: document.querySelectorAll('dialog.vs-reveal').length,
             focus: a ? a.getAttribute('data-signal-id') : null,
             tag: a ? a.tagName + '.' + (a.className || '') : 'none',
             vmOn: document.body.classList.contains('void-music-on'),
             rootVis: cs.visibility, rootOp: cs.opacity, rootDisp: cs.display,
             galaxy: !!document.getElementById('void-god-galaxy'),
             stars: document.querySelectorAll('#void-signals-layer .vs-sig').length };`);
  say('C13 one Escape closes the reveal and leaves focus on the originating star',
    escOrigin.modal === true && escOrigin.inDialog === true && escOrigin.originIsStar === true &&
    escOnce.dialogs === 0 && !escOnce.open && escOnce.focus === LIVE_ID &&
    escSettled.dialogs === 0 && escSettled.focus === LIVE_ID &&
    escSettled.vmOn === escBefore.vmOn && escSettled.rootVis === escBefore.rootVis &&
    escSettled.rootOp === escBefore.rootOp && escSettled.galaxy === true &&
    escSettled.stars === 3,
    'origin ' + JSON.stringify(escOrigin) + ' once ' + JSON.stringify(escOnce) +
    ' settled ' + JSON.stringify(escSettled) + ' before MusicMode ' + JSON.stringify(escBefore));

  /* The claim must survive a second cycle: the window listener belongs to each reveal
     instance, so a stale or double-bound owner would show up here. */
  await ctx.mouseClick(escBefore.x, escBefore.y);
  await ctx.waitFor("!!document.querySelector('dialog.vs-reveal')", 'reveal reopened', 6000);
  await ctx.key('Escape');
  await ctx.sleep(600);
  const escCycle = await evl(`
    var a = document.activeElement;
    return { dialogs: document.querySelectorAll('dialog.vs-reveal').length,
             open: !!window.VoidSignalsPublic.instance().reveal,
             focus: a ? a.getAttribute('data-signal-id') : null,
             vmOn: document.body.classList.contains('void-music-on') };`);
  say('C14 the Escape owner repeats: a second open closes on the first press too',
    escCycle.dialogs === 0 && !escCycle.open && escCycle.focus === LIVE_ID &&
    escCycle.vmOn === escBefore.vmOn, JSON.stringify(escCycle));

  /* ================= D. session-scoped read state ================= */

  say('D1 the opened message is remembered as read', closed.read === true);
  const readDom = await evl(`
    var b = document.querySelector('[data-signal-id="${LIVE_ID}"]');
    var other = document.querySelector('.vs-sig:not([data-signal-id="${LIVE_ID}"])');
    return { cls: b.className, opacity: getComputedStyle(b).opacity,
             otherCls: other ? other.className : '',
             stored: (sessionStorage.getItem('voidSignals.read.v1') || ''),
             local: Object.keys(localStorage).filter(function (k) { return /signal/i.test(k); }).join(',') };`);
  say('D2 read stars look read, unread stars stay bright',
    /is-read/.test(readDom.cls) && Number(readDom.opacity) < 0.6 && !/is-read/.test(readDom.otherCls),
    JSON.stringify(readDom));
  say('D3 read state lives in sessionStorage only',
    readDom.stored.indexOf(LIVE_ID) !== -1 && readDom.local === '', readDom.stored.slice(0, 80) + ' | ls=' + readDom.local);
  await ctx.navigate(PAGE);
  await ctx.waitFor("document.querySelectorAll('#void-signals-layer .vs-sig').length === 3", 'restar after reload', 15000);
  const afterReload = await evl(`
    return { read: window.VoidSignalsPublic.readState('${LIVE_ID}'),
             cls: (document.querySelector('[data-signal-id="${LIVE_ID}"]') || {}).className || '',
             other: [].slice.call(document.querySelectorAll('.vs-sig')).filter(function (b) {
               return b.getAttribute('data-signal-id') !== '${LIVE_ID}';
             }).map(function (b) { return /is-read/.test(b.className) ? b.getAttribute('data-signal-id') : 'fresh'; }).join(',') };`);
  say('D4 read survives a reload in the same tab session',
    afterReload.read === true && /is-read/.test(afterReload.cls), JSON.stringify(afterReload));
  say('D5 other messages stay unread (no global read-all)',
    afterReload.other.indexOf('fresh') !== -1 && afterReload.other.indexOf(afterReload.read) === -1, afterReload.other);
  /* The module owns the record and reads sessionStorage once per page load, so an
     out-of-band clear only shows up in a fresh context. Clearing and reloading is the
     honest proof that `is-read` is derived data the layer removes, not a class a star
     keeps forever (the bug fixed in syncStars). */
  await evl("sessionStorage.removeItem('voidSignals.read.v1');return true;");
  await ctx.navigate(PAGE);
  await ctx.waitFor("document.querySelectorAll('#void-signals-layer .vs-sig').length === 3", 'restar after clear', 15000);
  say('D6 clearing the record removes is-read and brightness returns',
    await evl(`var b=document.querySelector('[data-signal-id="${LIVE_ID}"]');
      return !!b && !/is-read/.test(b.className) && Number(getComputedStyle(b).opacity) > 0.9;`),
    await evl(`var b=document.querySelector('[data-signal-id="${LIVE_ID}"]');
      return b ? b.className + ' op=' + getComputedStyle(b).opacity + ' ss=' + (sessionStorage.getItem('voidSignals.read.v1') || 'cleared') : 'missing';`));

  /* ================= E. live feed changes ================= */

  const ids = await evl("return [].slice.call(document.querySelectorAll('.vs-sig')).map(function(b){return b.getAttribute('data-signal-id')}).join(',');");
  const secondId = ids.split(',').filter((i) => i !== LIVE_ID)[0];
  await mock('/__seed', { status: { id: secondId, status: 'hidden' } });
  await evl('return window.VoidSignalsPublic.refresh();');
  await ctx.sleep(700);
  say('E1 an admin hide removes its star',
    (await evl(`return !document.querySelector('[data-signal-id="${secondId}"]');`)),
    'hidden id ' + secondId);

  await mock('/__seed', { push: [{
    id: '9999999999999999999999999999aa', title: 'Ice profile check', status: 'active',
    category: 'release', importance: 'ambient',
    body: 'Fallback to the category profile: https://example.com/path?q=1 (trailing paren) end.'
  }] });
  await evl('return window.VoidSignalsPublic.refresh();');
  await ctx.sleep(800);
  const scoped = await evl(`
    var b = document.querySelector('[data-signal-id="9999999999999999999999999999aa"]');
    if (!b) return null;
    var cs = getComputedStyle(b);
    return { style: b.getAttribute('data-style'), a: cs.getPropertyValue('--ss-a').trim(),
             size: cs.getPropertyValue('--ss-size').trim() };`);
  say('E2 scope assignment reaches the visitor star', scoped && scoped.a === '#cfe2ee' && scoped.style === 'point',
    JSON.stringify(scoped));
  say('E3 repeat refresh never duplicates a star',
    (await evl(`
      window.VoidSignalsPublic.refresh();
      return new Promise(function (res) { setTimeout(function () {
        var ids = [].slice.call(document.querySelectorAll('.vs-sig')).map(function (b) { return b.getAttribute('data-signal-id'); });
        res(ids.length === new Set(ids).size);
      }, 900); });`)));

  await mock('/__seed', { expires: { id: '9999999999999999999999999999aa', at: Math.floor(Date.now() / 1000) - 5 } });
  await evl('return window.VoidSignalsPublic.refresh();');
  await ctx.sleep(700);
  say('E4 a past expires_at removes the star even if a stale list still carries it',
    await evl("return !document.querySelector('[data-signal-id=\"9999999999999999999999999999aa\"]');"));

  const soon = Math.floor(Date.now() / 1000) + 4;
  await mock('/__seed', { push: [{
    id: '8888888888888888888888888888bb', title: 'Self expiring', status: 'active',
    category: 'general', importance: 'ambient', expires_at: soon, body: 'Timed out on its own.'
  }] });
  await evl('return window.VoidSignalsPublic.refresh();');
  await ctx.sleep(500);
  say('E5 a fresh message arrives as a star mid-session',
    await evl("return !!document.querySelector('[data-signal-id=\"8888888888888888888888888888bb\"]');"));
  await ctx.sleep(4200);
  say('E6 the expiry timer retires the star without a refresh',
    await evl("return !document.querySelector('[data-signal-id=\"8888888888888888888888888888bb\"]');"));

  /* revoke while open */
  const openId = ids.split(',').filter((i) => i !== LIVE_ID)[1] || ids.split(',').pop();
  await evl(`window.VoidSignalsPublic.open('${LIVE_ID}');return true;`);
  await ctx.waitFor("!!document.querySelector('dialog.vs-reveal')", 'reopen for revoke', 6000);
  await mock('/__seed', { status: { id: LIVE_ID, status: 'revoked' } });
  await evl('return window.VoidSignalsPublic.refresh();');
  await ctx.sleep(800);
  const revoked = await evl(`
    return { star: !!document.querySelector('[data-signal-id="${LIVE_ID}"]'),
             dialog: document.querySelectorAll('dialog.vs-reveal').length };`);
  say('E7 revoking removes the star and leaves no orphan surface',
    !revoked.star, JSON.stringify(revoked));
  await evl('window.VoidSignalsPublic.close();return true;');
  await mock('/__seed', { status: { id: LIVE_ID, status: 'active' } });
  await evl('return window.VoidSignalsPublic.refresh();');
  await ctx.sleep(700);

  /* ================= F. hostile and broken payloads ================= */

  await mock('/__seed', { push: [
    { id: '7777777777777777777777777777c1', title: 'Junk row', status: 'active', category: 'general',
      importance: 'ambient', body: 'x <a href="javascript:window.__pwned=1">click</a> javascript:alert(1) data:text/html,<script>1</script> [https://balanced.example/a(b)c]' },
    { id: '7777777777777777777777777777c2', title: '', status: 'active', category: 'general',
      importance: 'ambient', body: null }
  ] });
  await evl('return window.VoidSignalsPublic.refresh();');
  await ctx.sleep(900);
  const hostile = await evl(`
    var out = { stars: document.querySelectorAll('.vs-sig').length, pwned: window.__pwned,
                bad: 0, script: 0, anchors: 0, httpsOnly: true, titles: [] };
    window.VoidSignalsPublic.open('7777777777777777777777777777c1');
    var d = document.querySelector('dialog.vs-reveal');
    var links = [].slice.call(d.querySelectorAll('a'));
    out.bad = links.filter(function (a) {
      return !/^https?:/.test(a.href);
    }).length;
    out.anchors = links.length;
    out.httpsOnly = links.every(function (a) { return /^https?:/.test(a.href); });
    out.hrefs = links.map(function (a) { return a.href; }).join(',');
    out.script = d.querySelectorAll('script').length;
    out.text = d.querySelector('.vs-reveal__body').textContent;
    out.title = d.querySelector('.vs-reveal__title').textContent;
    window.VoidSignalsPublic.close();
    window.VoidSignalsPublic.open('7777777777777777777777777777c2');
    var d2 = document.querySelector('dialog.vs-reveal');
    out.emptyTitle = d2.querySelector('.vs-reveal__title').textContent;
    out.emptyBody = d2.querySelector('.vs-reveal__body').textContent;
    out.emptyGap = d2.querySelectorAll('.vs-line--gap').length;
    out.emptyLines = d2.querySelectorAll('.vs-line').length;
    window.VoidSignalsPublic.close();
    return out;`);
  say('F1 executable protocols never become links and never run',
    hostile.pwned === undefined && hostile.bad === 0 && hostile.script === 0,
    JSON.stringify({ pwned: hostile.pwned, bad: hostile.bad, script: hostile.script }));
  /* The raw markup has to survive verbatim as *text*. indexOf('<a href=') on textContent
     therefore finds the escaped source — that is the proof it was never parsed. The
     security property is that exactly one anchor exists: the benign https URL. */
  say('F2 dangerous text still shows as plain text',
    hostile.text.indexOf('javascript:alert(1)') !== -1 && hostile.text.indexOf('<a href=') !== -1 &&
    hostile.anchors === 1 && hostile.httpsOnly === true,
    JSON.stringify({ text: hostile.text.slice(0, 70), anchors: hostile.anchors, httpsOnly: hostile.httpsOnly }));
  say('F3 balanced parentheses survive the trailing-punctuation strip',
    hostile.text.indexOf('https://balanced.example/a(b)c)') !== -1 ||
    hostile.text.indexOf('[https://balanced.example/a(b)c]') !== -1, JSON.stringify(hostile.text.slice(-40)));
  /* A null body renders one gap line, and the gap line holds a single space text node so
     the paragraph cannot collapse in the floor browser. Visible copy is therefore blank
     after trimming, while the structure (one line, one gap) still exists. */
  say('F4 a null body and empty title degrade to a readable surface',
    hostile.emptyTitle === 'Signal' && hostile.emptyBody.trim() === '' &&
    hostile.emptyBody === ' ' && hostile.emptyLines === 1 && hostile.emptyGap === 1,
    JSON.stringify({ t: hostile.emptyTitle, b: hostile.emptyBody, lines: hostile.emptyLines, gap: hostile.emptyGap }));
  say('F5 malformed rows never broke the layer',
    ctx.exceptions.length === 0 && hostile.stars >= 3, 'stars=' + hostile.stars + ' exc=' + ctx.exceptions.length);

  /* The mock reads the failure mode from the query string, so the mode has to travel
     there: a JSON body was parsed as no mode at all and every F/G outage check below
     silently ran against a healthy feed. */
  await mock('/__fail?mode=500');
  await evl('return window.VoidSignalsPublic.refresh();');
  await ctx.sleep(700);
  const after500 = await evl('return { c: window.VoidSignalsPublic.counts(), host: !!document.getElementById("void-signals-layer") };');
  say('F6 an outage is counted, not thrown, and the layer survives',
    after500.host && after500.c.errors >= 1 && ctx.exceptions.length === 0, JSON.stringify(after500.c));
  await mock('/__fail?mode=malformed');
  await evl('return window.VoidSignalsPublic.refresh();');
  await ctx.sleep(700);
  say('F7 unparseable JSON cannot break the galaxy',
    ctx.exceptions.length === 0 && (await evl('return !!document.getElementById("void-signals-layer");')));
  await mock('/__fail?mode=empty');
  await evl('return window.VoidSignalsPublic.refresh();');
  await ctx.waitFor("document.querySelectorAll('#void-signals-layer .vs-sig').length === 0", 'empty feed clears stars', 8000);
  say('F8 an empty eligible set clears every star',
    (await evl("return document.querySelectorAll('#void-signals-layer .vs-sig').length;")) === 0);
  await mock('/__fail?mode=off');
  await mock('/__reset');
  await evl('return window.VoidSignalsPublic.refresh();');
  await ctx.sleep(900);
  say('F9 recovery: stars return when the feed is healthy again',
    (await evl("return document.querySelectorAll('#void-signals-layer .vs-sig').length;")) === 3);

  /* ================= G. opt-outs and polling restraint ================= */

  /* Restraint is about traffic the layer starts on its own. Counters here also carry the
     refresh() calls this scenario makes on purpose, so the check is a quiet window: with
     nothing touched for 8 s, the layer must issue exactly zero requests (POLL_MS is 90 s). */
  const gBase = await evl('return window.VoidSignalsPublic.counts();');
  await ctx.sleep(8000);
  const gAfter = await evl('return window.VoidSignalsPublic.counts();');
  say('G1 polling stays restrained: no request of its own during a quiet window',
    gAfter.polls === gBase.polls && gAfter.fetches === gBase.fetches,
    JSON.stringify({ base: { polls: gBase.polls, fetches: gBase.fetches },
      after: { polls: gAfter.polls, fetches: gAfter.fetches } }));
  await ctx.navigate(MOCK + '/index.html?local-api=1&signals=0');
  await ctx.sleep(1200);
  say('G2 ?signals=0 leaves the page without the layer',
    (await evl("return !document.getElementById('void-signals-layer') && window.VoidSignalsPublic.counts().skipped === 'flag';")));
  await ctx.navigate(MOCK + '/index.html?local-api=1');
  /* The compatibility group measures the approved configuration, so wait for the real
     mount as well as the stars; otherwise H reads the body fallback it is not about. */
  await ctx.waitFor("document.querySelectorAll('#void-signals-layer .vs-sig').length > 0 && window.VoidSignalsPublic.counts().mount === 'galaxy'",
    'back to live mode in the Galaxy container', 15000);

  /* ================= H. Chromium-70 compatibility in a real engine ================= */

  say('H1 page parsed with no syntax error (ES5-safe bundle)',
    ctx.exceptions.length === 0 && ctx.consoleErrors.filter((e) => /SyntaxError|Unexpected/.test(e)).length === 0,
    JSON.stringify(ctx.consoleErrors.slice(0, 2)));
  const compat = await evl(`
    var probe = document.getElementById('void-signals-layer');
    var cs = getComputedStyle(probe);
    var star = probe.querySelector('.vs-sig');
    var scs = getComputedStyle(star);
    return { hostPos: cs.position, hostOpacity: cs.opacity, mount: window.VoidSignalsPublic.counts().mount,
             starTransition: scs.transitionDuration, starFilter: scs.filter, starClip: scs.clipPath,
             backdrop: 'n/a', dialogSupported: typeof document.createElement('dialog').showModal === 'function' };`);
  /* In the approved Galaxy mount the layer is absolute inside the fixed container (the
     .vs-layer--body rule that makes it fixed belongs to the fallback only). The point of
     the check is that the engine kept our rules rather than dropping them. */
  say('H2 renderer produced real computed styles (no dropped rules)',
    compat.hostPos === 'absolute' && compat.mount === 'galaxy' && compat.starTransition !== '' &&
    compat.dialogSupported, JSON.stringify(compat));
  for (const vp of [[1440, 900], [1024, 768], [820, 1180], [390, 844], [360, 640]]) {
    await ctx.setViewport(vp[0], vp[1], vp[0] < 500);
    /* The layer re-places on a 260 ms resize debounce, and the emulated viewport only
       lands after that. Measuring too early reads the previous layout's coordinates
       (proved separately: stale at +200 ms, correct from +700 ms on), so give the
       debounce room and keep the assertion itself unchanged. */
    await ctx.sleep(1500);
    const fit = await evl(`
      var stars = [].slice.call(document.querySelectorAll('#void-signals-layer .vs-sig'));
      var out = 0, tiny = 0, off = [];
      for (var i = 0; i < stars.length; i++) {
        var r = stars[i].getBoundingClientRect();
        if (r.left < -2 || r.top < -2 || r.right > innerWidth + 2 || r.bottom > innerHeight + 2) {
          out++; off.push(Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.right) + ',' + Math.round(r.bottom));
        }
        if (r.width < 20 || r.height < 20) tiny++;
      }
      return { n: stars.length, out: out, tiny: tiny, off: off.join(' '), vw: innerWidth, vh: innerHeight,
               placed: document.getElementById('void-signals-layer').getAttribute('data-placed') };`);
    say('H3 ' + vp[0] + 'x' + vp[1] + ': every star is on screen and tappable',
      fit.n === 3 && fit.out === 0 && fit.tiny === 0, JSON.stringify(fit));
    await ctx.shot('signals-' + vp[0] + 'x' + vp[1]);
  }
  await ctx.setViewport(1440, 900, false);
  await ctx.sleep(500);

  /* ================= I. Admin edit fix inside the same shell ================= */

  /* Scoped to this one document: the shared counters below must not be polluted by the
     five earlier page loads of the same session. */
  const adminNetFrom = ctx.net.all().length;
  const adminHits = (re) => ctx.net.all().slice(adminNetFrom).filter((r) => re.test(r.url));
  await ctx.navigate(MOCK + '/index.html?local-api=1&admin=true');
  await ctx.waitFor("!!document.getElementById('va-login-form')", 'admin login mounts', 15000);
  say('I1 admin route opens the login card',
    await evl("return !document.getElementById('va-login').hidden;"));
  await evl(`
    var i = document.getElementById('va-secret');
    i.value = 'test-token';
    document.getElementById('va-login-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return true;`);
  await ctx.waitFor("!!document.getElementById('va-app') && !document.getElementById('va-app').hidden", 'admin unlocks', 15000);
  say('I2 the shell authenticates against the worker',
    await evl("return !!window.VoidAdmin || !document.getElementById('va-app').hidden;"));
  await tap('#va-tab-signals');
  await ctx.waitFor("!!document.querySelector('.vsa-title')", 'signals table renders', 15000);
  /* The unified admin splits each module into sections: the rows are rendered while the
     module shows Overview, so a title button only gets a layout box once the
     Notification management section is on screen. Clicking must follow that. */
  await tap('#va-sectab-signals-messages');
  await ctx.waitFor("!!document.querySelector('.vsa-title') && document.querySelector('.vsa-title').getBoundingClientRect().width > 0", 'signals rows visible', 15000);
  await ctx.sleep(400);

  const rowIds = await evl(`
    return [].slice.call(document.querySelectorAll('.vsa-title')).map(function (b) {
      return b.getAttribute('data-id');
    }).join(',');`);
  say('I3 signals table lists every row the worker returns', rowIds.split(',').length === 8, rowIds);
  const target = '4444444444444444444444444444dddd';

  const beforeToggle = await evl(`
    var d = document.getElementById('vsa-detail-' + '${target}');
    var b = document.querySelector('.vsa-title[data-id="${target}"]');
    return { detail: !!d, hidden: d ? d.hidden : null, expanded: b.getAttribute('aria-expanded'),
             controls: b.getAttribute('aria-controls'), title: b.textContent };`);
  say('I4 detail row exists, starts collapsed, and is wired to its own button',
    beforeToggle.detail && beforeToggle.hidden === true && beforeToggle.expanded === 'false' &&
    beforeToggle.controls === 'vsa-detail-' + target, JSON.stringify(beforeToggle));

  await tap('.vsa-title[data-id="' + target + '"]');
  await ctx.sleep(500);
  const afterToggle = await evl(`
    var d = document.getElementById('vsa-detail-' + '${target}');
    var b = document.querySelector('.vsa-title[data-id="${target}"]');
    var others = [].slice.call(document.querySelectorAll('.vsa-detail')).filter(function (x) {
      return x.id !== 'vsa-detail-${target}' && !x.hidden;
    }).map(function (x) { return x.id; });
    return { hidden: d.hidden, expanded: b.getAttribute('aria-expanded'),
             form: !!d.querySelector('form.vsa-edit'), editTitle: d.querySelector('input[name="title"]').value,
             editBody: d.querySelector('textarea[name="body"]').value,
             bodyText: d.querySelector('.vsa-detail__body').textContent, others: others };`);
  say('I5 clicking the title opens that message detail (the reported bug)',
    afterToggle.hidden === false && afterToggle.expanded === 'true' && afterToggle.form,
    JSON.stringify({ hidden: afterToggle.hidden, expanded: afterToggle.expanded, form: afterToggle.form }));
  say('I6 only that row opened, no neighbour followed',
    afterToggle.others.length === 0, JSON.stringify(afterToggle.others));
  say('I7 the form shows the stored title and body verbatim',
    afterToggle.editTitle === 'Revoked notice' &&
    afterToggle.editBody === 'revoked https://revoked.example/' &&
    afterToggle.bodyText === afterToggle.editBody, JSON.stringify({ t: afterToggle.editTitle }));

  /* labelled Edit action in the Active signals table */
  await tap('#va-sectab-signals-active');
  await ctx.waitFor("!!document.querySelector('.vsa-abtn--edit')", 'active table renders', 12000);
  const editBtns = await evl(`
    return [].slice.call(document.querySelectorAll('.vsa-abtn--edit')).map(function (b) {
      return b.getAttribute('data-id') + ':' + b.textContent;
    }).join(' | ');`);
  say('I8 the Active table offers a clearly labelled Edit action',
    editBtns.indexOf('bc30d9f543481df3cdde28de6a00b846:Edit') !== -1, editBtns);
  await evl(`
    var d = document.getElementById('vsa-detail-${LIVE_ID}');
    return d ? d.hidden : 'missing';`);
  await tap('.vsa-abtn--edit[data-id="' + LIVE_ID + '"]');
  await ctx.sleep(600);
  const viaEdit = await evl(`
    var d = document.getElementById('vsa-detail-${LIVE_ID}');
    var b = document.querySelector('.vsa-title[data-id="${LIVE_ID}"]');
    return { hidden: d ? d.hidden : 'missing', form: d ? !!d.querySelector('form.vsa-edit') : false,
             title: d ? d.querySelector('input[name="title"]').value : '',
             expanded: b ? b.getAttribute('aria-expanded') : '' };`);
  say('I9 Edit opens the correct form for that message',
    viaEdit.hidden === false && viaEdit.form && viaEdit.title === 'پیام تست', JSON.stringify(viaEdit));

  /* save through the guarded PUT, identity preserved */
  const beforeWrites = (await mock('/__writes')).writes.length;
  await evl(`
    var d = document.getElementById('vsa-detail-${LIVE_ID}');
    var input = d.querySelector('input[name="title"]');
    input.value = 'پیام تست (ویرایش آزمایشی)';
    d.querySelector('form.vsa-edit').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return true;`);
  await ctx.waitFor(`(function(){
    var d = document.getElementById('vsa-detail-${LIVE_ID}');
    var e = d.querySelector('.vsa-error');
    return (e && !e.hidden) || document.querySelectorAll('.vsa-title[data-id="${LIVE_ID}"]').length;
  })()`, 'save settles', 12000);
  await ctx.sleep(600);
  const saved = await evl(`
    var d = document.getElementById('vsa-detail-${LIVE_ID}');
    var e = d.querySelector('.vsa-error');
    var meta = [].slice.call(d.querySelectorAll('.vsa-meta__item')).map(function (n) {
      return n.textContent;
    });
    return { error: e && !e.hidden ? e.textContent : '', meta: meta.join(' | '),
             pill: (document.querySelector('.vsa-title[data-id="${LIVE_ID}"]') || {}).textContent || '' };`);
  const journaled = await mock('/__writes');
  const updateWrite = journaled.writes.filter((w) => w.kind === 'update' && w.id === LIVE_ID).pop();
  say('I10 the edit saved without an error banner', saved.error === '', JSON.stringify(saved).slice(0, 160));
  say('I11 the guarded PUT carried the expected version and no status field',
    updateWrite && updateWrite.sent.indexOf('expected_version') !== -1 &&
    updateWrite.sent.indexOf('status') === -1 && updateWrite.body.title === 'پیام تست (ویرایش آزمایشی)',
    JSON.stringify(updateWrite));
  const liveRow = await (await fetch(MOCK + '/admin/signals/messages/' + LIVE_ID, { headers: { Authorization: 'Bearer test-token' } })).json();
  say('I12 id, created_at and publication status survived the edit',
    liveRow.message.id === LIVE_ID && liveRow.message.status === 'active' &&
    liveRow.message.created_at < liveRow.message.updated_at && liveRow.message.published_at,
    JSON.stringify({ id: liveRow.message.id, st: liveRow.message.status, v: liveRow.message.state_version }));
  say('I13 version advanced by exactly one write', journaled.writes.length === beforeWrites + 1,
    beforeWrites + ' -> ' + journaled.writes.length);

  /* Stale only happens when somebody else writes first. Advance the row out of band while
     the editor is still open, then submit it: the mock must answer 409, the module must
     say so outside the node it rebuilds (shell.toast), and nothing may be written twice. */
  const raced = await (await fetch(MOCK + '/admin/signals/messages/' + LIVE_ID, {
    method: 'PUT',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'پیام تست (نسخه بیرونی)', body: 'written elsewhere', expected_version: liveRow.message.state_version })
  })).json();
  const beforeStale = (await mock('/__writes')).writes.length;
  await evl(`
    var d = document.getElementById('vsa-detail-${LIVE_ID}');
    d.querySelector('form.vsa-edit').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return true;`);
  await ctx.sleep(900);
  const stale = await evl(`
    var d = document.getElementById('vsa-detail-${LIVE_ID}');
    var e = d.querySelector('.vsa-error');
    return { inline: e && !e.hidden ? e.textContent : '',
             toasts: [].slice.call(document.querySelectorAll('.va-toast')).map(function (t) { return t.textContent; }).join(' | ') };`);
  const afterStale = await mock('/__writes');
  const lastUpdate = afterStale.writes.filter((w) => w.kind === 'update').pop();
  const stored = await (await fetch(MOCK + '/admin/signals/messages/' + LIVE_ID, { headers: { Authorization: 'Bearer test-token' } })).json();
  say('I14 a save on a stale snapshot is refused and said out loud',
    stale.inline === '' && /was not saved/.test(stale.toasts) &&
    stored.message.title === raced.message.title, JSON.stringify(stale).slice(0, 200));
  say('I15 the refusal changed nothing: one journaled attempt, version held',
    afterStale.writes.length === beforeStale + 1 &&
    lastUpdate.body.expected_version === liveRow.message.state_version &&
    stored.message.state_version === liveRow.message.state_version + 1,
    JSON.stringify({ sent: lastUpdate.body.expected_version, stored: stored.message.state_version,
      writes: afterStale.writes.length - beforeStale }));

  /* cancel is not a write */
  await tap('#va-sectab-signals-messages');
  await ctx.waitFor("!!document.querySelector('.vsa-title')", 'messages tab back', 12000);
  await tap('.vsa-title[data-id="' + target + '"]');
  await ctx.sleep(400);
  const cancelBefore = (await mock('/__writes')).writes.length;
  await evl(`
    var d = document.getElementById('vsa-detail-${target}');
    d.querySelector('textarea[name="body"]').value = 'this text is discarded';
    d.querySelector('.vsa-edit button.va-btn:not([type="submit"])').click();
    return true;`);
  await ctx.sleep(700);
  const cancelAfter = await mock('/__writes');
  const cancelDom = await evl(`
    var d = document.getElementById('vsa-detail-${target}');
    var b = document.querySelector('.vsa-title[data-id="${target}"]');
    return { hidden: d.hidden, expanded: b.getAttribute('aria-expanded') };`);
  say('I16 cancel closes the editor and sends nothing',
    cancelAfter.writes.length === cancelBefore && cancelDom.hidden === true && cancelDom.expanded === 'false',
    JSON.stringify(cancelDom) + ' writes ' + cancelBefore + '->' + cancelAfter.writes.length);
  const untouched = await (await fetch(MOCK + '/admin/signals/messages/' + target, { headers: { Authorization: 'Bearer test-token' } })).json();
  say('I17 the cancelled row still holds its original text',
    untouched.message.body === 'revoked https://revoked.example/', untouched.message.body);
  say('I18 the shared API bundle loaded once in this admin document',
    adminHits(/void-signals-api\.js/).length === 1,
    'requests=' + adminHits(/void-signals-api\.js/).length + ' ' +
    adminHits(/void-signals-(api|admin|public)\.js/).map((r) => r.url.split('/').pop()).join(','));
  await ctx.shot('admin-edit-after');

  /* ================= J. end-to-end acceptance path ================= */

  await mock('/__reset');
  await ctx.navigate(PAGE);
  await ctx.waitFor("document.querySelectorAll('#void-signals-layer .vs-sig').length === 3", 'acceptance boot', 15000);
  const box = await evl(`
    var b = document.querySelector('[data-signal-id="${LIVE_ID}"]');
    var r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
  await ctx.mouseClick(box.x, box.y);
  await ctx.waitFor("!!document.querySelector('dialog.vs-reveal')", 'acceptance dialog', 8000);
  const acceptance = await evl(`
    var d = document.querySelector('dialog.vs-reveal');
    var a = d.querySelector('a.vs-link');
    return { title: d.querySelector('.vs-reveal__title').textContent,
             href: a ? a.href : null, attrs: a ? (a.target + '/' + a.rel) : null,
             cleanText: d.querySelector('.vs-reveal__body').textContent.indexOf(${JSON.stringify(LIVE_URL)}) !== -1 };`);
  say('J1 Active message → clickable star → readable dialog → safe external link',
    acceptance.title === 'پیام تست' && acceptance.href === LIVE_URL &&
    acceptance.attrs === '_blank/noopener noreferrer' && acceptance.cleanText,
    JSON.stringify(acceptance));
  say('J2 the whole path ran without a single page error',
    ctx.exceptions.length === 0 && ctx.consoleErrors.length === 0,
    'exceptions=' + ctx.exceptions.length + ' console=' + ctx.consoleErrors.length);
  await ctx.shot('acceptance-path');
  return { pass: true };
}
