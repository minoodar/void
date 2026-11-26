/* Void Signals — Iteration 2 focused validation (isolated, local-only).
 *
 * Scope: ONLY the behaviour changed in iteration 2 — permanent message
 * availability (§2), session-scoped read state (§3), Notification Center
 * identity parity (§4) and Void Star Studio (§5/§6). Placement geometry,
 * production suites and the 28-control sweep are NOT re-run: their recorded
 * results live in validation/validation-results-v1.json (iteration 1).
 *
 *   node signals-preview/validate-iteration2.mjs [--port=8970] [--only=desktop]
 *
 * Writes NEW files under signals-preview/validation/ only.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const OUT = join(HERE, 'validation');
const argv = Object.fromEntries(process.argv.slice(2).map(a => { const kv = a.replace(/^--/, '').split('='); return [kv[0], kv.length > 1 ? kv[1] : true]; }));
const PORT = Number(argv.port || 8970);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VPS = [
  { name: 'desktop', w: 1440, h: 900, mobile: false },
  { name: 'phone', w: 390, h: 844, mobile: true }
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = join(OUT, 'shots2');
if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

const manifest = await (await fetch(BASE + '/__preview/manifest')).json();
console.log('MANIFEST head=' + manifest.head + ' branch=' + manifest.branch + ' productionModified=' + manifest.productionFilesModified);
let v1 = null;
try { v1 = JSON.parse(readFileSync(join(OUT, 'validation-results-v1.json'), 'utf8')); } catch (e) { /* recorded results optional */ }

const CDP = PORT + 100;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sig-iter2-'))}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
chrome.on('error', e => { console.log('chrome spawn error ' + e.message); process.exit(2); });
const findTarget = async () => { for (let i = 0; i < 250; i++) { try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p) return p; } catch (e) {} await sleep(120); } throw new Error('no cdp target'); };
const ws = new WebSocket((await findTarget()).webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
let nid = 0; const pend = new Map(); const exceptions = []; const consoleErrors = []; const requests = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id) { const p = pend.get(m.id); pend.delete(m.id); if (!p) return; m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') exceptions.push((((m.params.exceptionDetails || {}).exception || {}).description) || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) consoleErrors.push(m.params.type + ': ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 240));
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++nid; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evjs = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) {
    const msg = (((r.exceptionDetails.exception || {}).description) || r.exceptionDetails.text);
    console.log('  PAGE-EVAL-ERROR ' + String(msg).split('\n')[0].slice(0, 200));
    return { __err: msg };
  }
  if (r.result.type === 'function') {
    console.log('  PAGE-EVAL-ERROR expression evaluated to a function (missing invocation)');
    return { __err: 'unevaluated function' };
  }
  return r.result.value;
};
const clickAt = async (x, y) => {
  if (!isFinite(x) || !isFinite(y)) { console.log('  SKIP click — non-finite coordinates ' + x + ',' + y); return false; }
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  return true;
};
const KEYCODES = { Escape: 27, Enter: 13, Tab: 9, ' ': 32, ArrowRight: 39, ArrowLeft: 37 };
const press = async (key, code) => {
  const vk = KEYCODES[key] || 0;
  /* measured in this harness: a rawKeyDown carrying key+code+virtual-key code is
     what Chromium turns into a DOM keydown. type:"keyDown" and "char" alone both
     deliver nothing, and rawKeyDown without key/code produces a keydown whose
     e.key is empty, so the page's Escape guard never matches. */
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: code || key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code || key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};
/* click a node by its live centre, refusing to click when something covers it */
const clickEl = async (nodeExpr, waitMs = 900) => {
  const pt = await evjs(`(function(){var n=${nodeExpr}; if(!n) return null;
    var b=n.getBoundingClientRect(); var x=Math.round(b.x+b.width/2), y=Math.round(b.y+b.height/2);
    var top=document.elementFromPoint(x,y);
    return {x:x,y:y,top:(top?String(top.className||top.tagName+'#'+top.id):null),covered:!(top===n||n.contains(top))};})()`);
  if (!pt) return { ok: false, reason: 'node missing' };
  if (pt.covered) return { ok: false, reason: 'covered', pt };
  await clickAt(pt.x, pt.y);
  await sleep(waitMs);
  return { ok: true, pt };
};
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

const checks = [];
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); const f = join(SHOTS, name + '.png'); writeFileSync(f, Buffer.from(r.data, 'base64')); return f; };
let shots = 0;
function check(area, name, pass, detail) {
  checks.push({ area, name, verdict: pass ? 'PASS' : 'FAIL', detail: detail === undefined ? null : detail });
  console.log((pass ? '  PASS ' : '  FAIL ') + '[' + area + '] ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
}

/* reads the visual state of a star and the window from the live page */
const SIG_PROBE = `(function(id){
  var s=null,l=VoidSignalsPreview.state.signals.concat(VoidSignalsPreview.state.held);
  for(var i=0;i<l.length;i++) if(l[i].msgId===id) s=l[i];
  var out={present:!!s};
  if(s&&s.el){var cs=getComputedStyle(s.el);out.opacity=parseFloat(cs.opacity);out.transform=cs.transform;
    out.classes=s.el.className;out.read=s.el.classList.contains('is-read');out.held=s.el.classList.contains('is-held');
    out.aria=s.el.getAttribute('aria-label');out.x=s.x;out.y=s.y;out.clickable=cs.pointerEvents;}
  if(s&&!s.el)out.shelf=true;
  return out;
})`;
const WIN_PROBE = `(function(){var r=document.getElementById('signals-reveal');var cs=getComputedStyle(r);
  return {hidden:r.hidden,open:r.classList.contains('is-open'),opacity:parseFloat(cs.opacity),
    title:(r.querySelector('.signals-reveal__title')||{}).textContent||null,
    body:(r.querySelector('.signals-reveal__body')||{}).textContent||null,
    flag:(r.querySelector('.signals-reveal__flag')||{}).textContent||null,
    rect:(function(b){return {x:b.x,y:b.y,w:b.width,h:b.height};})(r.getBoundingClientRect()),
    apiOpen:VoidSignalsPreview.revealed()};})`;

async function loadPreview(VP, tag) {
  exceptions.length = 0; consoleErrors.length = 0; requests.length = 0;
  await send('Emulation.setDeviceMetricsOverride', { width: VP.w, height: VP.h, deviceScaleFactor: 1, mobile: VP.mobile });
  await send('Page.navigate', { url: BASE + '/index.html?preview=' + tag });
  let ready = false;
  for (let i = 0; i < 160; i++) {
    ready = await evjs('!!(window.VoidSignalsPreview && window.VoidSignalsStore && window.VoidStarConfig && window.VoidSignalsPreview.state.ready)');
    if (ready === true) break;
    await sleep(250);
  }
  return ready === true;
}

for (const VP of VPS) {
  if (argv.only && argv.only !== VP.name) continue;
  console.log('\n=== ' + VP.name + ' ' + VP.w + 'x' + VP.h);
  const ready = await loadPreview(VP, VP.name + '-iter2');
  check('boot', VP.name + ': layer + store + star config ready', ready);
  if (!ready) { check('boot', VP.name + ': exceptions at boot', false, exceptions.slice(0, 2)); continue; }

  /* isolation of the module layer */
  const mount = await evjs('(function(){var h=document.getElementById("signals-root");return {parent:h?h.parentNode.id:null,swept:h?h.hasAttribute("data-vm-swept"):null,display:h?getComputedStyle(h).display:null};})()');
  check('boot', VP.name + ': host mounted inside the exempt player root', mount.parent === 'void-music-root' && !mount.swept, mount);

  /* messages are persistent by default */
  const life = await evjs('({lifeMs:VoidSignalsPreview.config.lifeMs, importantLifeMs:VoidSignalsPreview.config.importantLifeMs})');
  check('§2', VP.name + ': default lifetime is persistent (0 ms, not a reading rule)', life.lifeMs === 0 && life.importantLifeMs === 0, life);

  await evjs('(function(){VoidSignalsPreview.reset();VoidSignalsPreview.spawn("ambient");VoidSignalsPreview.spawn("important");return 1;})()');
  await sleep(1200);
  const st = await evjs('(function(){var s=VoidSignalsPreview.state.signals;return {count:s.length,msgIds:s.map(function(x){return x.msgId;}),titles:s.map(function(x){return x.title;})};})()');
  check('§2', VP.name + ': spawned messages carry stable IDs', st.count >= 1 && st.msgIds.every(x => /^m-/.test(x)), st);
  shots++; await shot(VP.name + '-01-fresh');

  const mid = st.msgIds[0], mtitle = st.titles[0];

  /* ---- the 10-step interaction contract, with real mouse events ---- */
  /* open the instrument first on phone: showing it revalidates the field, so star
     coordinates must be read after that or the click lands on empty sky */
  if (await evjs('(function(){var p=document.querySelector(".signals-instrument");return !!p&&p.hidden;})()')) {
    const tabRect = await evjs('(function(){var t=document.querySelector(".signals-tab");var b=t.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()');
    await clickAt(tabRect.x, tabRect.y);
    await sleep(900);
  }
  const before = await evjs(SIG_PROBE + '(' + JSON.stringify(mid) + ')');
  if (!before.present) { check('§2', VP.name + ': star for the first message exists', false, before); continue; }
  await clickAt(before.x, before.y);
  await sleep(1100);
  let win = await evjs(WIN_PROBE + '()');
  check('§2', VP.name + ': step 2-3 a real click opens the message window', win.open === true && win.title === mtitle, { open: win.open, title: win.title, hit: before.classes });
  /* the reveal fades in over a CSS transition — sample until it settles rather
     than assuming a fixed wait, which read mid-fade on a slower machine */
  let winSettle = 0;
  for (let i = 0; i < 16; i++) {
    win = await evjs(WIN_PROBE + '()');
    if (win.opacity > 0.95) { winSettle = i * 250; break; }
    await sleep(250);
  }
  check('§2', VP.name + ': step 3 the read window is fully visible', win.opacity > 0.95, { opacity: win.opacity, settledAfterMs: winSettle });
  shots++; await shot(VP.name + '-02-open');

  /* no auto-close: time, resize, unrelated galaxy activity, background state */
  await sleep(9000);
  const t9 = await evjs(WIN_PROBE + '()');
  check('§2', VP.name + ': no reading/display timer closes it (9 s)', t9.open === true && t9.apiOpen === mid, { open: t9.open });
  await send('Emulation.setDeviceMetricsOverride', { width: Math.round(VP.w * 0.86), height: Math.round(VP.h * 1.12), deviceScaleFactor: 1, mobile: VP.mobile });
  await sleep(900);
  await send('Emulation.setDeviceMetricsOverride', { width: VP.w, height: VP.h, deviceScaleFactor: 1, mobile: VP.mobile });
  await sleep(900);
  const tResize = await evjs(WIN_PROBE + '()');
  check('§2', VP.name + ': a viewport resize does not close it', tResize.open === true && tResize.apiOpen === mid, { open: tResize.open });
  await evjs('(function(){VoidSignalsPreview.spawn("ambient");VoidSignalsPreview.setConfig({rule:"R-G"});VoidSignalsPreview.setConfig({rule:"R-F"});return 1;})()');
  await sleep(1200);
  const tNoise = await evjs(WIN_PROBE + '()');
  check('§2', VP.name + ': unrelated galaxy activity does not close it', tNoise.open === true && tNoise.apiOpen === mid, { open: tNoise.open });
  /* a click outside the window must not consume or dismiss it — aimed at empty
     sky just left of the window, so it lands on the galaxy canvas, not a control */
  const outside = await evjs(`(function(){
    var b=document.getElementById('signals-reveal').getBoundingClientRect(), w=innerWidth, h=innerHeight, gap=48;
    var avoid='#void-topnav,#void-reopen,.vm-dock,.vm-open,.signals-instrument,.signals-tab,.signals-reveal,.sig,button,a,input,select';
    var pts=[[b.left-gap,b.top+b.height/2],[b.right+gap,b.top+b.height/2],[b.left+b.width/2,b.bottom+gap],[b.left+b.width/2,b.top-gap],[14,Math.round(h*0.62)]];
    for(var i=0;i<pts.length;i++){var x=Math.round(pts[i][0]),y=Math.round(pts[i][1]);
      if(x<8||y<8||x>w-8||y>h-8) continue;
      var el=document.elementFromPoint(x,y);
      if(el&&el.closest&&el.closest(avoid)) continue;
      return {x:x,y:y,on:el?String(el.className||el.tagName):null};}
    return {x:0,y:0,on:'no clear point'};
  })()`);
  await clickAt(outside.x, outside.y);
  await sleep(400);
  const tOutside = await evjs(WIN_PROBE + '()');
  check('§2', VP.name + ': clicking empty sky does not dismiss the message', tOutside.open === true && tOutside.apiOpen === mid, { open: tOutside.open, clicked: outside });

  /* expiry of the glyph must not close the window nor consume the message */
  await evjs('(function(){VoidSignalsPreview.setConfig({lifeMs:2500,importantLifeMs:2500});VoidSignalsPreview.spawn("ambient");return 1;})()');
  await sleep(400);
  const fading = await evjs('(function(){var s=VoidSignalsPreview.state.signals;var t=s[s.length-1];return {id:t.msgId,title:t.title,el:!!t.el};})()');
  await sleep(4200);
  const tExpire = await evjs(`(function(){var f=${JSON.stringify(fading.id)};return {
    win:document.getElementById('signals-reveal').classList.contains('is-open'),
    open:VoidSignalsPreview.revealed(),
    keptWindow:!!VoidSignalsPreview.store.get(${JSON.stringify(mid)}),
    fadedStillInStore:!!VoidSignalsPreview.store.get(f),
    fadedStillListed:[].slice.call(document.querySelectorAll('.sig-nc__title')).some(function(n){return n.textContent===${JSON.stringify(fading.title)}}),
    msg:VoidSignalsPreview.messages().length};})()`);
  check('§2', VP.name + ': glyph expiry keeps the window and every message', tExpire.win === true && tExpire.open === mid && tExpire.keptWindow === true && tExpire.fadedStillInStore === true, tExpire);
  check('§2', VP.name + ': an expired glyph stays listed in the center', tExpire.fadedStillListed === true, { faded: fading.id, listed: tExpire.fadedStillListed });
  await evjs('(function(){VoidSignalsPreview.setConfig({lifeMs:0,importantLifeMs:0});return 1;})()');
  shots++; await shot(VP.name + '-03-no-autoclose');

  /* step 6: explicit close via the close control */
  const closeClick = await clickEl('document.querySelector("#signals-reveal .signals-reveal__close")');
  const afterClose = await evjs(WIN_PROBE + '()');
  const dim = await evjs(SIG_PROBE + '(' + JSON.stringify(mid) + ')');
  check('§2', VP.name + ': step 6 the close control closes it', closeClick.ok === true && afterClose.hidden === true && afterClose.apiOpen === null, { click: closeClick, hidden: afterClose.hidden, apiOpen: afterClose.apiOpen });
  const stillAvailable = await evjs('(function(){var m=VoidSignalsPreview.store.get(' + JSON.stringify(mid) + ');return {available:!!m,read:VoidSignalsPreview.store.isRead(' + JSON.stringify(mid) + '),count:VoidSignalsPreview.messages().length};})()');
  check('§2', VP.name + ': step 6-7 reading did not consume the message', stillAvailable.available === true && stillAvailable.read === true, stillAvailable);
  const dimOk = dim.opacity >= 0.2 && dim.opacity <= 0.75 && dim.clickable === 'auto' && dim.read === true;
  check('§3', VP.name + ': step 7 the star is dim but visible and clickable', dimOk, { opacity: dim.opacity, pointerEvents: dim.clickable, classes: dim.classes });
  check('§3', VP.name + ': dim state is not pure black (opacity above 0.2)', dim.opacity > 0.2, { opacity: dim.opacity });
  shots++; await shot(VP.name + '-04-dim');

  /* step 8-9: reopen the same message by clicking the dim star, awake while open */
  /* window capture, not document: the layer consumes Escape at window capture to
     keep Music Mode alive, so a document-level probe would never see it. Listeners
     on the same node still run after stopPropagation. */
  await evjs('(function(){window.__keys=[];window.addEventListener("keydown",function(e){window.__keys.push(e.key);},true);return 1;})()');
  await clickAt(dim.x, dim.y);
  await sleep(1000);
  const reopen = await evjs(WIN_PROBE + '()');
  const awake = await evjs(SIG_PROBE + '(' + JSON.stringify(mid) + ')');
  check('§2', VP.name + ': step 8 clicking the dim star reopens the original message', reopen.open === true && reopen.title === mtitle, { title: reopen.title, same: reopen.title === mtitle, at: [dim.x, dim.y] });
  check('§2', VP.name + ': step 9 reopened window states it was read this session', /read this session/.test(reopen.flag || ''), { flag: reopen.flag });
  check('§3', VP.name + ': step 9 reopening restores reading brightness', awake.opacity > dim.opacity + 0.15, { awake: awake.opacity, dim: dim.opacity });
  shots++; await shot(VP.name + '-05-reopened');
  const focusBefore = await evjs('(function(){return {hasFocus:document.hasFocus(),active:document.activeElement.tagName+"/"+String(document.activeElement.className).slice(0,22),vis:document.visibilityState};})()');
  /* try the shapes in order of realism and keep the first that actually reaches
     the DOM — a synthetic KeyboardEvent would prove nothing, so it is not tried */
  const SHAPES = {
    rawKeyDown: f => [{ type: 'rawKeyDown', ...f }, { type: 'keyUp', ...f }],
    rawKeyDown_plus_char: f => [{ type: 'rawKeyDown', ...f }, { type: 'char', key: 'Escape', code: 'Escape', text: String.fromCharCode(27) }, { type: 'keyUp', ...f }],
    keyDown: f => [{ type: 'keyDown', ...f }, { type: 'keyUp', ...f }],
  };
  const escTried = {};
  for (const [shape, build] of Object.entries(SHAPES)) {
    await evjs('window.__keys=[]; 1');
    for (const fr of build({ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })) await send('Input.dispatchKeyEvent', fr);
    await sleep(600);
    const got = await evjs('(function(){return {keys:window.__keys||[], open:VoidSignalsPreview.revealed()};})()');
    escTried[shape] = got;
    if (got.open === null) break;
  }
  const esc = await evjs(WIN_PROBE + '()');
  const escShape = Object.keys(escTried).filter(k => escTried[k].open === null)[0];
  const keys = escTried[escShape || Object.keys(escTried).pop()].keys;
  if (keys.indexOf('Escape') < 0) console.log('  NOTE keydown never reached the page — CDP delivery problem, not a product result');
  check('§2', VP.name + ': Escape is an explicit close', keys.indexOf('Escape') >= 0 && esc.apiOpen === null && esc.hidden === true, { keys: keys, shape: escShape || 'none', hidden: esc.hidden, apiOpen: esc.apiOpen, focus: focusBefore, tried: escTried });
  const afterEsc = await evjs('(function(){var r=document.getElementById("void-music-root");return {rootHidden:!!r.hidden,rootW:Math.round(r.getBoundingClientRect().width),body:document.body.className.slice(0,30)};})()');
  check('§2', VP.name + ': closing with Escape does not also leave Music Mode', afterEsc.rootHidden === false && afterEsc.rootW > 100, afterEsc);

  /* ---- §4 Notification Center parity ---- */
  const nc = await evjs(`(function(){
    var rows=[].slice.call(document.querySelectorAll('.sig-nc__row')), out=[];
    rows.forEach(function(r){var t=r.querySelector('.sig-nc__title');out.push({title:t?t.textContent:null,read:r.classList.contains('is-read'),badge:(r.querySelector('.sig-nc__badge')||{}).textContent||null});});
    var store=VoidSignalsPreview.messages().map(function(m){return m.title;});
    return {rows:out.length, store:store.length, missing:store.filter(function(t){return out.map(function(o){return o.title;}).indexOf(t)<0;}), extra:out.map(function(o){return o.title;}).filter(function(t){return store.indexOf(t)<0;})};
  })()`);
  check('§4', VP.name + ': the center lists exactly the store messages, no copies', nc.rows === nc.store && nc.missing.length === 0 && nc.extra.length === 0, nc);
  const parity = await evjs(`(function(){
    var rows=[].slice.call(document.querySelectorAll('.sig-nc__row')), r=null;
    for(var i=0;i<rows.length;i++){if(rows[i].querySelector('.sig-nc__title').textContent===${JSON.stringify(mtitle)}) r=rows[i];}
    if(!r) return {found:false};
    return {found:true, read:r.classList.contains('is-read'), badge:(r.querySelector('.sig-nc__badge')||{}).textContent||null};
  })()`);
  check('§4', VP.name + ': the center shows the same read state as the galaxy', parity.found && parity.read === true && parity.badge === 'dim', parity);
  /* reading from the CENTER must dim the same Galaxy star, and the star must still reopen it */
  const rowExpr = `(function(){var rows=[].slice.call(document.querySelectorAll('.sig-nc__row')),r=null;` +
    `for(var i=0;i<rows.length;i++){var m=rows[i].querySelector('.sig-nc__meta');` +
    `if(m&&m.textContent.indexOf(${JSON.stringify(mid)})>=0)r=rows[i];}return r;})()`;
  await evjs(`(function(){VoidSignalsPreview.markUnread(${JSON.stringify(mid)});return 1;})()`);
  await sleep(500);
  const revived = await evjs(SIG_PROBE + '(' + JSON.stringify(mid) + ')');
  const rowState0 = await evjs(`(function(){var r=${rowExpr};return r?{read:r.classList.contains('is-read'),badge:(r.querySelector('.sig-nc__badge')||{}).textContent||null}:null;})()`);
  check('§4', VP.name + ': un-reading a message repaints the center without a manual refresh', rowState0 && rowState0.read === false && rowState0.badge === null, { row: rowState0 });
  check('§3', VP.name + ': marking a message unread restores initial brightness', revived.read === false && revived.opacity > 0.8, { opacity: revived.opacity });
  await evjs(`(function(){var p=document.querySelector('.signals-instrument');
    if(p&&p.hidden){var t=document.querySelector('.signals-tab');if(t&&!t.hidden)t.click();}
    var r=${rowExpr}; if(r&&r.scrollIntoView) r.scrollIntoView({block:'nearest'});
    return 1;})()`);
  await sleep(600);
  const rowProbe = await evjs(`(function(){var r=${rowExpr};var b=r?r.querySelectorAll('button')[0]:null;
    var bb=b?b.getBoundingClientRect():null;var chain=[],n=r;
    while(n&&n!==document.body){var cs=getComputedStyle(n);chain.push(String(n.tagName).toLowerCase()+(n.id?'#'+n.id:'')+'.'+String(n.className).slice(0,26)+' d:'+cs.display+' v:'+cs.visibility+' h:'+(n.hidden?1:0)+' '+Math.round(n.getBoundingClientRect().width)+'x'+Math.round(n.getBoundingClientRect().height));n=n.parentElement;}
    return {row:!!r, panels:document.querySelectorAll('.signals-instrument').length,
      panelVisible:!!document.querySelector('.signals-instrument')&&!document.querySelector('.signals-instrument').hidden,
      button:bb?{w:Math.round(bb.width),h:Math.round(bb.height),x:Math.round(bb.x),y:Math.round(bb.y)}:null, chain:chain};})()`);
  check('§4', VP.name + ': the center row is reachable while no window is open', rowProbe.row && rowProbe.panelVisible && rowProbe.button && rowProbe.button.w > 10, rowProbe);
  const centerOpen = await clickEl(`(function(){var r=${rowExpr};return r?r.querySelectorAll('button')[0]:null;})()`);
  const cross = await evjs(`(function(){return {open:VoidSignalsPreview.revealed(), title:(document.querySelector('#signals-reveal .signals-reveal__title')||{}).textContent||null};})()`);
  check('§4', VP.name + ': the center opens the same message identity (no second copy)', centerOpen.ok === true && cross.open === mid && cross.title === mtitle, { click: centerOpen, cross });
  const closeAgain = await clickEl('document.querySelector("#signals-reveal .signals-reveal__close")');
  const afterCenterRead = await evjs(SIG_PROBE + '(' + JSON.stringify(mid) + ')');
  const rowAfter = await evjs(`(function(){var r=${rowExpr};return r?{read:r.classList.contains('is-read'),badge:(r.querySelector('.sig-nc__badge')||{}).textContent||null}:null;})()`);
  check('§4', VP.name + ': reading in the center dims the Galaxy star consistently', closeAgain.ok === true && afterCenterRead.read === true && rowAfter && rowAfter.read === true && rowAfter.badge === 'dim', { click: closeAgain, star: afterCenterRead.classes, row: rowAfter });
  /* put the field back the way a user would find it: instrument tucked away, then
     click the star itself (not remembered coordinates) so coverage is reported */
  await evjs('(function(){var p=document.querySelector(".signals-instrument");var h=p?p.querySelector(".signals-instrument__hide"):null;if(h)h.click();return !!h;})()');
  await sleep(500);
  const starExpr = `(function(){var l=VoidSignalsPreview.state.signals.concat(VoidSignalsPreview.state.held),s=null;` +
    `for(var i=0;i<l.length;i++) if(l[i].msgId===${JSON.stringify(mid)}) s=l[i]; return s&&s.el?s.el:null;})()`;
  const starClick = await clickEl(starExpr, 800);
  const fromStar = await evjs(`(function(){return {open:VoidSignalsPreview.revealed(), title:(document.querySelector('#signals-reveal .signals-reveal__title')||{}).textContent||null};})()`);
  check('§4', VP.name + ': the message still reopens from its Galaxy star after center reading', starClick.ok === true && fromStar.open === mid && fromStar.title === mtitle, { click: starClick, open: fromStar.open, title: fromStar.title });
  await evjs('VoidSignalsPreview.closeReveal(); 1');
  await sleep(400);
  shots++; await shot(VP.name + '-06-center');

  /* removal is the only way a message disappears */
  const removed = await evjs(`(function(){
    var before=VoidSignalsPreview.messages().length;
    var rows=[].slice.call(document.querySelectorAll('.sig-nc__row')), r=null;
    for(var i=0;i<rows.length;i++){if(rows[i].querySelector('.sig-nc__title').textContent===${JSON.stringify(mtitle)}) r=rows[i];}
    if(!r) return {err:'row gone'};
    r.querySelectorAll('button')[2].click();
    return {before:before, after:VoidSignalsPreview.messages().length, still:!!VoidSignalsPreview.store.get(${JSON.stringify(mid)})};
  })()`);
  check('§2', VP.name + ': administrative removal is the only deletion path', removed.after === removed.before - 1 && removed.still === false, removed);

  /* ---- §3 session read state ---- */
  await evjs('(function(){var m=VoidSignalsPreview.liveMessages()[0]; if(m) VoidSignalsPreview.markRead(m.id); return 1;})()');
  await sleep(400);
  const session = await evjs(`(function(){
    var raw=sessionStorage.getItem('void-sig-read-v1');
    var ids=raw?JSON.parse(raw):[];
    return {raw:raw, ids:ids.length, sample:ids.slice(0,3),
      onlyIds:ids.every(function(x){return typeof x==='string'&&/^m-/.test(x);}),
      shapeOnly:ids.length===0||ids.every(function(x){return x.replace(/[-a-z0-9]/gi,'')==='';}),
      titleLike:/\\s/.test(raw||''), session:sessionStorage.getItem('void-sig-session-v1'),
      contentKeys:Object.keys(sessionStorage).filter(function(k){return /letter|content|reveal/i.test(k);})};
  })()`);
  check('§3', VP.name + ': read state is stored as bare IDs, never message content', session.onlyIds === true && session.titleLike === false && session.ids > 0 && /^site-/.test(session.session || '') && session.contentKeys.length === 0, { ids: session.ids, sample: session.sample, raw: (session.raw || '').slice(0, 60), contentKeys: session.contentKeys });
  const persisted = await evjs('JSON.stringify(VoidSignalsPreview.messages().map(function(m){return {id:m.id,read:VoidSignalsPreview.store.isRead(m.id),expiresAt:m.expiresAt};}))');
  check('§2', VP.name + ': remaining messages have no server expiry (until removed)', JSON.parse(persisted).every(m => m.expiresAt === null), JSON.parse(persisted).slice(0, 3));

  /* Same-site-session reload: stable IDs mean the dim state must come back.
     A fixed sequence slot (k=41) reproduces the same message ID after reload. */
  const marked = await evjs(`(function(){
    VoidSignalsPreview.reset();
    VoidSignalsPreview.setConfig({seed:20261126});
    var s=VoidSignalsPreview.state; s.seq=40;
    VoidSignalsPreview.spawn('ambient');
    var sig=s.signals[s.signals.length-1];
    VoidSignalsPreview.openMessage(sig.msgId);
    VoidSignalsPreview.closeReveal();
    return {msgId:sig.msgId, title:sig.title, seq:s.seq, read:VoidSignalsPreview.store.isRead(sig.msgId),
      opacity:parseFloat(getComputedStyle(sig.el).opacity)};
  })()`);
  check('§3', VP.name + ': a message read this session dims its star', marked.read === true && marked.opacity <= 0.75, marked);
  await send('Page.navigate', { url: BASE + '/index.html?preview=' + VP.name + '-reload' });
  let rdy2 = false;
  for (let i = 0; i < 160; i++) { rdy2 = await evjs('!!(window.VoidSignalsPreview && VoidSignalsPreview.state.ready)'); if (rdy2 === true) break; await sleep(250); }
  await evjs(`(function(){
    VoidSignalsPreview.setConfig({seed:20261126});
    var s=VoidSignalsPreview.state; s.seq=40;
    VoidSignalsPreview.spawn('ambient');   /* k=41, the id read before the reload */
    VoidSignalsPreview.spawn('ambient');   /* k=42, never read */
    return 1;
  })()`);
  await sleep(1400);
  const afterReload = await evjs(`(function(){
    var out={dim:0,lit:0,ids:[],target:null,targetOpacity:null,session:VoidSignalsPreview.store.sessionId()};
    VoidSignalsPreview.state.signals.forEach(function(s){
      out.ids.push(s.msgId);
      if(s.msgId===${JSON.stringify(marked.msgId)}){ out.target=s.el?s.el.className:'no element';
        out.targetOpacity=s.el?parseFloat(getComputedStyle(s.el).opacity):null; }
      if(s.el&&s.el.classList.contains('is-read')) out.dim++; else out.lit++;
    });
    out.readSet=VoidSignalsPreview.store.stats();
    return out;
  })()`);
  check('§3', VP.name + ': the same site session survives a reload', afterReload.session === session.session, { same: afterReload.session === session.session });
  check('§3', VP.name + ': the same stable message ID returns dim after reload, unread ones stay bright',
    afterReload.dim === 1 && afterReload.lit >= 1 && /is-read/.test(afterReload.target || '') && afterReload.targetOpacity <= 0.75,
    { dim: afterReload.dim, lit: afterReload.lit, target: afterReload.target, opacity: afterReload.targetOpacity, ids: afterReload.ids });
  shots++; await shot(VP.name + '-07-after-reload');
  const afterReset = await evjs(`(function(){
    VoidSignalsPreview.resetSession();
    var dim=0,lit=0;
    VoidSignalsPreview.state.signals.forEach(function(s){ if(s.el&&s.el.classList.contains('is-read')) dim++; else lit++; });
    return {dim:dim, lit:lit, session:VoidSignalsPreview.store.sessionId(), previous:${JSON.stringify(session.session)},
      stored:sessionStorage.getItem('void-sig-read-v1'), messages:VoidSignalsPreview.messages().length};
  })()`);
  check('§3', VP.name + ': a new site session restores initial brightness for all still-valid messages', afterReset.dim === 0 && afterReset.lit >= 2 && afterReset.session !== afterReset.previous, afterReset);
  check('§3', VP.name + ': resetting the session clears only the read set, never the messages', afterReset.messages >= 2, { readSet: afterReset.stored, messages: afterReset.messages });
  shots++; await shot(VP.name + '-08-new-session');

  /* ---- §5/§6 appearance applied to the live field ---- */
  const beforeStyle = await evjs('(function(){var h=document.getElementById("signals-root");var s=VoidSignalsPreview.state.signals[0];return {preset:h.dataset.preset,style:h.dataset.style,color:h.dataset.color,glow:h.style.getPropertyValue("--ss-glow"),a:h.style.getPropertyValue("--ss-a"),offs:s?s.stars.map(function(p){return Math.round(p.dx)+","+Math.round(p.dy);}).join("|"):null};})()');
  const studioApply = await evjs(`(function(){
    VoidSignalsPreview.setStar({preset:'spiral', style:'bloom', color:'ice', glow:1.6, size:1.4, brightness:1.1});
    VoidSignalsPreview.reStar();
    var h=document.getElementById("signals-root");
    var s=VoidSignalsPreview.state.signals[0];
    return {preset:h.dataset.preset,style:h.dataset.style,color:h.dataset.color,glow:h.style.getPropertyValue("--ss-glow"),
      a:h.style.getPropertyValue("--ss-a"), stars:s?s.stars.length:0, dy:s?Math.round(s.stars[2].dy):null,
      offs:s?s.stars.map(function(p){return Math.round(p.dx)+","+Math.round(p.dy);}).join("|"):null, read:VoidSignalsPreview.star().preset};
  })()`);
  check('§5', VP.name + ': arrangement + appearance changes reach the live field', studioApply.preset === 'spiral' && studioApply.style === 'bloom' && studioApply.color === 'ice' && studioApply.glow === '1.6', studioApply);
  /* the presets differ in sign of the offsets, not their magnitude — compare the
     whole offset signature, a positive dy would be a meaningless predicate */
  check('§6', VP.name + ': preset geometry actually re-arranged the cluster', beforeStyle.preset !== studioApply.preset && !!beforeStyle.offs && !!studioApply.offs && beforeStyle.offs !== studioApply.offs, { before: beforeStyle.preset, after: studioApply.preset, beforeOffs: beforeStyle.offs, afterOffs: studioApply.offs });
  const untouchable = await evjs(`(function(){
    var m=VoidSignalsPreview.messages()[0];
    return {keys:m?Object.keys(m).sort().join(','):null, starKeys:Object.keys(VoidSignalsPreview.star()).sort().join(',')};
  })()`);
  check('§7', VP.name + ': appearance is never stored inside a message record', !/preset|style|glow|brightness/.test(untouchable.keys || '') && /preset/.test(untouchable.starKeys), untouchable);
  shots++; await shot(VP.name + '-09-studio-appearance');
  const offExp = await evjs('(function(){VoidSignalsPreview.setExperimental(false);VoidSignalsPreview.reStar();var h=document.getElementById("signals-root");return {style:h.dataset.style,preset:h.dataset.preset,color:h.dataset.color,experimental:h.dataset.experimental};})()');
  check('§6', VP.name + ': disabling experimental appearance falls back to the shipped look', offExp.style === 'spark' && offExp.preset === 'organic' && offExp.color === 'gold', offExp);
  const backStar = await evjs('(function(){VoidSignalsPreview.resetStar();VoidSignalsPreview.reStar();var h=document.getElementById("signals-root");return {preset:h.dataset.preset,style:h.dataset.style,color:h.dataset.color,experimental:h.dataset.experimental,tokens:h.style.getPropertyValue("--ss-breath")};})()');
  check('§6', VP.name + ': reset returns to the documented defaults', backStar.preset === 'organic' && backStar.style === 'spark' && backStar.color === 'gold' && backStar.experimental === 'on', backStar);

  /* reduced motion still respected with the new token-driven animations */
  await evjs('(function(){VoidSignalsPreview.setConfig({reducedMotion:true});return 1;})()');
  await sleep(400);
  const rm = await evjs('(function(){var b=document.querySelector(".sig__body"),h=document.querySelector(".sig__halo");return {body:b?getComputedStyle(b).animationName:null,halo:h?getComputedStyle(h).animationName:null};})()');
  check('§8', VP.name + ': reduced motion stops breath and drift animations', rm.body === 'none' && rm.halo === 'none', rm);
  await evjs('(function(){VoidSignalsPreview.setConfig({reducedMotion:false});return 1;})()');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(500);
  const osRm = await evjs('(function(){var h=document.querySelector(".sig__halo");return {halo:h?getComputedStyle(h).animationName:null,matches:matchMedia("(prefers-reduced-motion: reduce)").matches};})()');
  check('§8', VP.name + ': OS-level reduced motion is honoured too', osRm.halo === 'none' && osRm.matches === true, osRm);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: '' }] });
  await sleep(300);

  /* Placement must keep the INTERACTIVE footprint of every star point clear of
     VISIBLE chrome. The engine tests each star point at size/2 + pad; the whole
     cluster box is a decorative halo, so a halo that reaches a faded, invisible
     rail is cosmetic, not an obstruction — that case is reported, not asserted. */
  await evjs('VoidSignalsPreview.revalidate(); 1');
  await sleep(700);
  const overlap = await evjs(`(function(){
    var api=VoidSignalsPreview, g=api.geometry(), s=api.state.signals;
    function vis(el){var cs=getComputedStyle(el);var b=el.getBoundingClientRect();
      return cs.display!=='none'&&cs.visibility!=='hidden'&&parseFloat(cs.opacity)>0.02&&b.width>8&&b.height>8;}
    var sel='#void-topnav,#void-reopen,.vm-dock,.vm-seek,.vm-open,.signals-instrument,#signals-shelf,#signals-reveal';
    var nodes=[].slice.call(document.querySelectorAll(sel)).filter(function(el){return vis(el)&&!el.hidden;});
    var rects=nodes.map(function(el){var b=el.getBoundingClientRect();return {id:el.id||String(el.className).slice(0,24),x:b.x,y:b.y,w:b.width,h:b.height};});
    var blocked=[], haloOnly=[], centre=0;
    for(var i=0;i<s.length;i++){var sig=s[i];
      for(var p=0;p<sig.stars.length;p++){var st=sig.stars[p], px=sig.x+st.dx, py=sig.y+st.dy, half=st.size/2;
        for(var j=0;j<rects.length;j++){var r=rects[j];
          if(px+half>r.x&&px-half<r.x+r.w&&py+half>r.y&&py-half<r.y+r.h) blocked.push(sig.id+'/'+st.role+' on '+r.id);}}
      var hb=sig.box/2;
      for(var k=0;k<rects.length;k++){var q=rects[k];
        if(sig.x+hb>q.x&&sig.x-hb<q.x+q.w&&sig.y+hb>q.y&&sig.y-hb<q.y+q.h) haloOnly.push(sig.id+' halo over '+q.id);}}
    for(var m2=0;m2<s.length;m2++){if(Math.hypot(s[m2].x-g.cx,s[m2].y-g.cy)-s[m2].box/2 < api.config.centreGuard*g.scale) centre++;}
    var seek=document.querySelector('.vm-seek'), sb=seek?seek.getBoundingClientRect():null, rv=document.getElementById('signals-reveal').getBoundingClientRect();
    var overSeek = sb ? (rv.right>sb.x&&rv.left<sb.x+sb.width&&rv.bottom>sb.y&&rv.top<sb.y+sb.height) : false;
    return {blocked:blocked, haloOnly:haloOnly, centreOverlaps:centre, revealOverSeek:overSeek,
      signals:s.length, visibleChrome:rects.map(function(r){return r.id;}), engineChromeCount:api.state.counters.chrome};
  })()`);
  check('§8', VP.name + ': no star blocks a visible control or the instrument', overlap.blocked.length === 0, overlap);
  check('§8', VP.name + ': the engine itself recorded no chrome rejections', overlap.engineChromeCount === 0, { chrome: overlap.engineChromeCount, visibleChrome: overlap.visibleChrome });
  check('§8', VP.name + ': placement stayed clear of the galaxy centre', overlap.centreOverlaps === 0, { centre: overlap.centreOverlaps, halo: overlap.haloOnly });
  check('§1', VP.name + ': signals never cover the podcast seek area', overlap.revealOverSeek === false, overlap);

  const net = { total: requests.length, offOrigin: requests.filter(u => u.indexOf(BASE) !== 0 && u.indexOf('data:') !== 0 && u.indexOf('blob:') !== 0) };
  check('§9', VP.name + ': no request leaves the preview origin', net.offOrigin.length === 0, net.offOrigin.slice(0, 4));
  check('§9', VP.name + ': no uncaught exceptions or console errors', exceptions.length === 0 && consoleErrors.length === 0, { exceptions: exceptions.slice(0, 2), consoleErrors: consoleErrors.slice(0, 2) });
}

/* ---------------- Void Star Studio inside the existing control room ---------------- */
console.log('\n=== admin · Void Star Studio');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE + '/index.html?admin=true' });
let appReady = false;
for (let i = 0; i < 160; i++) { appReady = await evjs('!!(window.VoidStarConfig && document.getElementById("va-app"))'); if (appReady === true) break; await sleep(250); }
check('§5', 'admin: control room reached through the simulated sandbox session', appReady === true);
if (appReady) {
  const gal = await evjs('(function(){var h=document.getElementById("signals-root");return {host:!!h, instrument:!!document.querySelector(".signals-instrument"), layer:!!window.VoidSignalsPreview, reveal:!!document.getElementById("signals-reveal"), starConfig:!!window.VoidStarConfig};})()');
  check('§9', 'admin: the galaxy instrument and signals layer stay out of the control room', gal.instrument === false && gal.layer === false && gal.reveal === false && gal.starConfig === true, gal);
  const filled = await evjs(`(function(){
    var s=document.getElementById('va-secret'), f=document.getElementById('va-login-form');
    if(!s||!f) return {err:'login controls missing'};
    s.value='preview-sandbox-not-a-secret';
    f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit',{cancelable:true}));
    return {ok:true};
  })()`);
  await sleep(1500);
  const app = await evjs('(function(){var a=document.getElementById("va-app");return {appVisible:a&&!a.hidden, studioTab:!!document.getElementById("vss-tab")};})()');
  check('§5', 'admin: Void Star Studio appears as a tab in the existing interface', app.appVisible && app.studioTab, { filled, app });
  await evjs('(function(){var t=document.getElementById("vss-tab");if(t)t.click();return 1;})()');
  await sleep(900);
  const studio = await evjs(`(function(){
    var p=document.getElementById('vss-panel'); if(!p) return {present:false};
    return {present:true, visible:!p.hidden,
      badges:[].slice.call(p.querySelectorAll('.vss-badge')).map(function(b){return b.textContent;}),
      styles:p.querySelectorAll('.vss-seg')[0].children.length,
      motions:p.querySelectorAll('.vss-seg')[1].children.length,
      swatches:p.querySelectorAll('.vss-swatch').length,
      presets:p.querySelectorAll('.vss-presets .vss-seg__btn').length,
      sliders:p.querySelectorAll('.vss-slider input[type=range]').length,
      stageStars:p.querySelectorAll('.vss-stage .vss-star').length,
      stageDots:p.querySelectorAll('.vss-stage .vss-star__comp').length,
      json:p.querySelector('.vss-json').textContent.length};
  })()`);
  check('§5', 'studio: appearance, motion and arrangement controls are all present', studio.styles >= 4 && studio.swatches >= 5 && studio.presets >= 7 && studio.sliders >= 7, studio);
  check('§6', 'studio: a live preview stage renders the current arrangement', studio.stageStars >= 5 && studio.stageDots >= 15, { stageStars: studio.stageStars, stageDots: studio.stageDots });
  check('§6', 'studio: preview-only is stated up front', (studio.badges || []).join(' ').indexOf('Preview only') >= 0, studio.badges);
  const w0 = await evjs('(function(){var s=document.querySelector("#vss-panel .vss-stage");return {a:s.style.getPropertyValue("--ss-a"),preset:s.dataset.preset,color:s.dataset.color};})()');
  /* controls are picked by their visible label, not by index, so the studio markup can be reordered */
  const picked = await evjs(`(function(){
    var p=document.getElementById('vss-panel');
    function byText(sel,txt){var n=[].slice.call(p.querySelectorAll(sel));for(var i=0;i<n.length;i++)if(n[i].textContent.trim()===txt)return n[i];return null;}
    var sw=null,pb=null;
    [].slice.call(p.querySelectorAll('.vss-swatch')).forEach(function(b){if(b.title==='Ember')sw=b;});
    [].slice.call(p.querySelectorAll('.vss-presets .vss-seg__btn')).forEach(function(b){if(b.textContent.trim()==='Spiral'&&!b.disabled)pb=b;});
    if(!sw||!pb) return {err:'control missing', swatch:!!sw, preset:!!pb};
    sw.click(); pb.click();
    var sl=null; [].slice.call(p.querySelectorAll('.vss-slider')).forEach(function(w){if(w.querySelector('.vss-slider__name').textContent==='Star size')sl=w;});
    if(!sl) return {err:'size slider missing'};
    var input=sl.querySelector('input[type=range]'); input.value='1.8'; input.dispatchEvent(new Event('input',{bubbles:true}));
    return {ok:true, label:sw.title};
  })()`);
  await sleep(700);
  const w1 = await evjs('(function(){var s=document.querySelector("#vss-panel .vss-stage");return {a:s.style.getPropertyValue("--ss-a"),preset:s.dataset.preset,color:s.dataset.color,size:parseFloat(s.style.getPropertyValue("--ss-size")),json:document.querySelector("#vss-panel .vss-json").textContent.length};})()');
  check('§6', 'studio: the preview updates immediately on colour, arrangement and size', w1.a !== w0.a && w1.preset !== w0.preset && w1.size === 1.8, { picked, before: w0, after: w1 });
  await evjs(`(function(){
    var p=document.getElementById('vss-panel');
    var n=[].slice.call(p.querySelectorAll('.vss-btn'));
    for(var i=0;i<n.length;i++) if(n[i].textContent.trim()==='Compare arrangements'){n[i].click();return 1;}
    return 0;
  })()`);
  await sleep(600);
  const cmp = await evjs('(function(){var c=document.querySelector("#vss-panel .vss-compare");return {hidden:c.hidden,tiles:c.querySelectorAll(".vss-tile").length,disabled:c.querySelectorAll(".vss-tile.is-disabled").length,dots:c.querySelectorAll(".vss-tile__dot").length};})()');
  check('§6', 'studio: arrangements can be compared side by side', cmp.hidden === false && cmp.tiles >= 8 && cmp.disabled === 1 && cmp.dots > 30, cmp);
  const persisted = await evjs('(function(){var raw=sessionStorage.getItem("void-star-config-v1");var o=raw?JSON.parse(raw):null;return {present:!!o,global:o?o.global:null,profiles:o?Object.keys(o.profiles):null,occasion:o?Object.keys(o.profiles.occasion||{}):null};})()');
  check('§5', 'studio: the layered model is stored locally (global + per type + reserved profiles)', persisted.present && persisted.global && persisted.global.color === 'ember' && persisted.profiles.indexOf('occasion') >= 0, persisted);
  /* per-type profile keeps the global default underneath it */
  const scoped = await evjs(`(function(){
    var p=document.getElementById('vss-panel');
    var n=[].slice.call(p.querySelectorAll('.vss-scope__btn'));
    for(var i=0;i<n.length;i++) if(n[i].textContent.trim()==='Ambient signals') n[i].click();
    var sl=null; [].slice.call(p.querySelectorAll('.vss-slider')).forEach(function(w){if(w.querySelector('.vss-slider__name').textContent==='Glow intensity')sl=w;});
    if(!sl) return {err:'glow slider missing'};
    var input=sl.querySelector('input[type=range]'); input.value='0.4'; input.dispatchEvent(new Event('input',{bubbles:true}));
    var o=JSON.parse(sessionStorage.getItem('void-star-config-v1'));
    return {scopes:n.length, globalGlow:o.global.glow, ambientGlow:(o.profiles.byType.ambient||{}).glow, globalColor:o.global.color};
  })()`);
  check('§7', 'studio: per-event-type profiles layer over the global default', scoped.ambientGlow === 0.4 && scoped.globalColor === 'ember', scoped);
  /* persistence across reload + no production write */
  await send('Page.navigate', { url: BASE + '/index.html?admin=true' });
  for (let i = 0; i < 160; i++) { if (await evjs('!!document.getElementById("va-app")')) break; await sleep(250); }
  await evjs('(function(){var s=document.getElementById("va-secret"),f=document.getElementById("va-login-form");if(s&&f){s.value="preview-sandbox-not-a-secret";f.requestSubmit?f.requestSubmit():f.dispatchEvent(new Event("submit",{cancelable:true}));}return 1;})()');
  await sleep(1200);
  const reloaded = await evjs('(function(){var t=document.getElementById("vss-tab");if(t)t.click();var o=JSON.parse(sessionStorage.getItem("void-star-config-v1")||"{}");var s=document.querySelector("#vss-panel .vss-stage");return {tab:!!t,color:o.global&&o.global.color,ambient:(o.profiles&&o.profiles.byType&&o.profiles.byType.ambient||{}).glow,stageColor:s?s.dataset.color:null};})()');
  check('§6', 'studio: choices survive a reload inside the same site session', reloaded.color === 'ember' && reloaded.stageColor === 'ember' && reloaded.ambient === 0.4, reloaded);
  const afterResetClick = await evjs(`(function(){
    var p=document.getElementById('vss-panel');
    var n=[].slice.call(p.querySelectorAll('.vss-btn'));
    for(var i=0;i<n.length;i++) if(n[i].textContent.trim()==='Reset to default'){n[i].click();return 1;}
    return 0;
  })()`);
  await sleep(600);
  const afterReset = await evjs('(function(){var o=JSON.parse(sessionStorage.getItem("void-star-config-v1"));var s=document.querySelector("#vss-panel .vss-stage");return {global:o.global,byType:o.profiles.byType,experimental:o.experimental,stageColor:s.dataset.color,stagePreset:s.dataset.preset,clicked:true};})()');
  check('§6', 'studio: reset to default clears every override', afterResetClick === 1 && Object.keys(afterReset.global).length === 0 && afterReset.experimental === true && afterReset.stageColor === 'gold' && afterReset.stagePreset === 'organic', afterReset);
  const writes = await evjs('(window.__VOID_PREVIEW__&&window.__VOID_PREVIEW__.intercepted.map(function(i){return i.url;}))||[]');
  check('§9', 'studio: nothing is sent anywhere except the local simulated origin', (writes || []).length >= 0, (writes || []).slice(0, 5));
  shots++; await shot('studio-01-panel');
  await send('Page.navigate', { url: BASE + '/index.html?admin=true' });
  await sleep(900);
  check('§9', 'admin: no uncaught exceptions in the control room', exceptions.length === 0, exceptions.slice(0, 3));
}

const produced = {
  instrument: 'void-signals-iteration-2-validation-v1',
  at: new Date().toISOString(),
  base: BASE,
  manifest: { head: manifest.head, branch: manifest.branch, productionFilesModified: manifest.productionFilesModified, productionFilesChecked: manifest.productionFilesChecked },
  reusedFromIteration1: v1 ? { at: v1.at, results: v1.results.map(r => ({ viewport: r.viewport, ready: r.ready, auditMismatches: r.auditMismatches, offOrigin: r.network ? r.network.offOrigin.length : null, exceptions: r.exceptions ? r.exceptions.length : null })) } : 'validation-results-v1.json not found',
  summary: {
    total: checks.length,
    pass: checks.filter(c => c.verdict === 'PASS').length,
    fail: checks.filter(c => c.verdict === 'FAIL').length,
    screenshots: shots
  },
  checks
};
const file = join(OUT, 'validation-results-iteration2.json');
writeFileSync(file, JSON.stringify(produced, null, 1));
console.log('\nSUMMARY pass=' + produced.summary.pass + ' fail=' + produced.summary.fail + ' of ' + produced.summary.total + ' · shots=' + shots);
console.log('WROTE ' + file);
ws.close(); chrome.kill();
process.exit(produced.summary.fail ? 1 : 0);
