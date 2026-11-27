/* Void Signals — Phase B preview validation (isolated, local-only).
 * Drives a real headless Chrome over CDP against the local preview server,
 * exercises the full demo loop at three viewports, and records evidence.
 *
 *   node signals-preview/validate-preview.mjs [--port=8970] [--only=desktop]
 *
 * Writes NEW files under signals-preview/validation/ only.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
  { name: 'tablet', w: 820, h: 1180, mobile: false },
  { name: 'phone', w: 390, h: 844, mobile: true }
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const SHOTS = join(OUT, 'shots');
if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

const manifest = await (await fetch(BASE + '/__preview/manifest')).json();
console.log('MANIFEST head=' + manifest.head + ' branch=' + manifest.branch + ' productionModified=' + manifest.productionFilesModified);

const CDP = PORT + 100;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sig-preview-'))}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
chrome.on('error', e => { console.log('chrome spawn error ' + e.message); process.exit(2); });

const findTarget = async () => { for (let i = 0; i < 250; i++) { try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p) return p; } catch (e) {} await sleep(120); } throw new Error('no cdp target'); };
const ws = new WebSocket((await findTarget()).webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
let nid = 0; const pend = new Map(); const exceptions = []; const consoleErrors = []; const requests = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id) { const p = pend.get(m.id); pend.delete(m.id); if (!p) return; m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') exceptions.push((((m.params.exceptionDetails || {}).exception || {}).description) || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) consoleErrors.push(m.params.type + ': ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 240));
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++nid; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evjs = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) return { __err: (((r.exceptionDetails.exception || {}).description) || r.exceptionDetails.text) };
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

const results = [];
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = join(SHOTS, name + '.png');
  writeFileSync(f, Buffer.from(r.data, 'base64'));
  return f;
};

for (const VP of VPS) {
  if (argv.only && argv.only !== VP.name) continue;
  exceptions.length = 0; consoleErrors.length = 0; requests.length = 0;
  const rec = { viewport: VP.name, css: { w: VP.w, h: VP.h }, steps: [], screenshots: [] };
  await send('Emulation.setDeviceMetricsOverride', { width: VP.w, height: VP.h, deviceScaleFactor: 1, mobile: VP.mobile });
  await send('Page.navigate', { url: BASE + '/index.html?preview=' + VP.name });
  let ready = false;
  for (let i = 0; i < 160; i++) {
    ready = await evjs('!!(window.VoidSignalsPreview && window.VoidSignalsPreview.data() && window.VoidSignalsPreview.state.ready && window.VoidMusicViz && window.VoidMusicViz._test && window.VoidMusicViz._test.V)');
    if (ready === true) break;
    await sleep(250);
  }
  rec.ready = ready === true;
  console.log(`\n=== ${VP.name} ${VP.w}x${VP.h} ready=${rec.ready}`);
  if (!rec.ready) { rec.exceptions = exceptions.slice(); results.push(rec); continue; }

  /* local simulated tone so the galaxy runs its real camera cycle */
  const tone = await evjs(`(async function(){ try { await window.VoidMusic.add([{url: location.origin + '/__sim/audio/demo-tone.wav', name:'demo-tone.wav'}], {}); return 'added'; } catch(e){ return String(e); } })()`, true);
  rec.tone = tone;
  await sleep(4000);
  rec.geometry = await evjs('(function(){var g=VoidSignalsPreview.geometry();return {w:g.w,h:g.h,cx:g.cx,cy:g.cy,scale:g.scale,live:g.live,vp:g.vp};})()');
  rec.instrument = await evjs('(function(){var p=document.querySelector(".signals-instrument");if(!p)return {present:false};var b=p.getBoundingClientRect();var cs=getComputedStyle(p);return {present:true,x:b.x,y:b.y,w:b.width,h:b.height,visibility:cs.visibility,opacity:cs.opacity,display:cs.display,hidden:p.hidden,controls:p.querySelectorAll("input,select,button").length};})()');
  console.log('  instrument ' + JSON.stringify(rec.instrument));
  rec.initial = await evjs('(function(){var s=VoidSignalsPreview.state;return {signals:s.signals.length,held:s.held.length,counters:s.counters,candidates:s.candidates.length,metrics:s.metrics};})()');
  rec.screenshots.push(await shot(VP.name + '-01-default'));
  rec.openedFromTab = !!rec.instrument.hidden;
  if (rec.openedFromTab) {
    rec.tab = await evjs('(function(){var t=document.querySelector(".signals-tab");var b=t.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,hidden:t.hidden};})()');
    await evjs('(function(){document.querySelector(".signals-tab").click();return 1;})()');
    await sleep(600);
    rec.instrument = await evjs('(function(){var p=document.querySelector(".signals-instrument");var b=p.getBoundingClientRect();var cs=getComputedStyle(p);return {present:true,x:b.x,y:b.y,w:b.width,h:b.height,visibility:cs.visibility,opacity:cs.opacity,display:cs.display,hidden:p.hidden,controls:p.querySelectorAll("input,select,button").length};})()');
    console.log('  instrument-open ' + JSON.stringify(rec.instrument));
    rec.screenshots.push(await shot(VP.name + '-01b-instrument-open'));
  }

  const step = async (name, expr, waitMs) => {
    const before = exceptions.length;
    const out = await evjs(expr, true);
    if (waitMs) await sleep(waitMs);
    const st = await evjs('(function(){var s=VoidSignalsPreview.state,c=s.counters;return {signals:s.signals.length,held:s.held.length,placed:c.placed,heldCount:c.held,chrome:c.chrome,centre:c.centre,bright:c.bright,edge:c.edge,separation:c.separation,capacity:c.capacity,rule:VoidSignalsPreview.config.rule,thr:VoidSignalsPreview.config.thr};})()');
    rec.steps.push({ name, out, state: st, newExceptions: exceptions.length - before });
    console.log(`  ${name}: signals=${st.signals} held=${st.held} chrome=${st.chrome} centre=${st.centre} bright=${st.bright} sep=${st.separation}`);
    return st;
  };

  /* ---- the full demo loop ---- */
  await step('clear', 'VoidSignalsPreview.clear(); "cleared"', 500);
  await step('spawn-ambient-1', 'VoidSignalsPreview.spawn("ambient") ? "ok" : "null"', 1200);
  await step('spawn-ambient-2', 'VoidSignalsPreview.spawn("ambient") ? "ok" : "null"', 900);
  await step('spawn-important', 'VoidSignalsPreview.spawn("important") ? "ok" : "null"', 1600);
  rec.screenshots.push(await shot(VP.name + '-02-three-signals'));
  await step('reveal-first', '(function(){var s=VoidSignalsPreview.state.signals[0];return s?String(VoidSignalsPreview.reveal(s.id)):"none";})()', 700);
  rec.revealRect = await evjs('(function(){var r=document.getElementById("signals-reveal");var b=r.getBoundingClientRect();return {hidden:r.hidden,x:b.x,y:b.y,w:b.width,h:b.height,open:r.classList.contains("is-open")};})()');
  rec.revealAudit = await evjs(`(function(){
    var api=VoidSignalsPreview, rects=api.chrome().filter(function(c){return c.id!=='signals-reveal';}), r=document.getElementById('signals-reveal').getBoundingClientRect();
    var hits=[]; for(var j=0;j<rects.length;j++){var c=rects[j];
      if(r.right>c.x&&r.left<c.x+c.w&&r.bottom>c.y&&r.top<c.y+c.h) hits.push(c.id);}
    var s=api.state.signals, cover=[];
    for(var i=0;i<s.length;i++){var g=s[i],h=g.box/2;
      if(r.right>g.x-h&&r.left<g.x+h&&r.bottom>g.y-h&&r.top<g.y+h) cover.push(g.k);}
    return {chromeHits:hits,signalCover:cover};
  })()`);
  console.log('  reveal chromeHits=' + rec.revealAudit.chromeHits.length + ' signalCover=' + rec.revealAudit.signalCover.length);
  rec.screenshots.push(await shot(VP.name + '-03-reveal'));
  await step('close-reveal', 'VoidSignalsPreview.closeReveal(); "closed"', 500);

  /* REV-3 as specified: expected to place nothing at the measured thresholds */
  await step('rule-R-C-thr0.15', 'VoidSignalsPreview.setConfig({rule:"R-C",thr:0.15}); "set"', 700);
  await step('R-C-spawn', 'VoidSignalsPreview.spawn("ambient") ? "ok" : "null"', 700);
  rec.rev3Fallback = await evjs('(function(){var s=VoidSignalsPreview.state;return {signals:s.signals.length,held:s.held.length,shelfHidden:document.getElementById("signals-shelf").hidden};})()');
  rec.screenshots.push(await shot(VP.name + '-04-rev3-fallback'));
  await step('fallback-shelf', 'VoidSignalsPreview.setConfig({fallback:"shelf"}); "set"', 500);
  rec.screenshots.push(await shot(VP.name + '-05-shelf'));
  await step('fallback-hold', 'VoidSignalsPreview.setConfig({fallback:"hold"}); "set"', 300);

  /* threshold + rule sweep, live */
  rec.sweep = [];
  for (const rule of ['R-C', 'R-Cn', 'R-F', 'R-G', 'R-A', 'R-0']) {
    for (const thr of [0.05, 0.15, 0.30]) {
      const r = await evjs(`(function(){VoidSignalsPreview.clear();VoidSignalsPreview.setConfig({rule:"${rule}",thr:${thr}});var n=0;for(var i=0;i<14;i++){if(VoidSignalsPreview.spawn(i%4===0?"important":"ambient"))n++;}var s=VoidSignalsPreview.state;return {rule:"${rule}",thr:${thr},spawned:n,inField:s.signals.length,held:s.held.length};})()`);
      rec.sweep.push(r);
      await sleep(120);
    }
  }
  console.log('  sweep ' + rec.sweep.map(s => `${s.rule}@${s.thr}:${s.inField}/${s.held}`).join(' '));
  rec.auditCompare = await evjs('VoidSignalsPreview.auditCompare()');
  const mism = rec.auditCompare.filter(r => r.auditK1 !== null && r.livePlaced !== r.auditK1);
  rec.auditMismatches = mism.length;
  console.log('  auditCompare rows=' + rec.auditCompare.length + ' mismatches=' + mism.length + (mism.length ? ' ' + mism.slice(0, 8).map(m => `${m.rule}@${m.thr}:live${m.livePlaced}/audit${m.auditK1}`).join(' ') : ''));

  /* rail reservation both ways (owner requirement) */
  await step('reset-default', 'VoidSignalsPreview.reset(); "reset"', 600);
  await step('fill-default', '(function(){for(var i=0;i<12;i++)VoidSignalsPreview.spawn(i%3===0?"important":"ambient");return VoidSignalsPreview.state.signals.length;})()', 900);
  const railOn = await evjs('(function(){var s=VoidSignalsPreview.state;return {rail:VoidSignalsPreview.config.railReserve,signals:s.signals.length,held:s.held.length,chrome:s.counters.chrome};})()');
  await step('rail-off', 'VoidSignalsPreview.setConfig({railReserve:false}); "off"', 600);
  const railOff = await evjs('(function(){var s=VoidSignalsPreview.state;return {rail:VoidSignalsPreview.config.railReserve,signals:s.signals.length,held:s.held.length,chrome:s.counters.chrome};})()');
  await step('rail-on', 'VoidSignalsPreview.setConfig({railReserve:true}); "on"', 600);
  rec.railBothWays = { on: railOn, off: railOff };
  console.log('  rail on=' + JSON.stringify(railOn) + ' off=' + JSON.stringify(railOff));

  /* live control responsiveness */
  await step('size-slider', 'VoidSignalsPreview.setConfig({size:18}); "size18"', 500);
  await step('separation-slider', 'VoidSignalsPreview.setConfig({separation:40}); "sep40"', 500);
  await step('glow-slider', 'VoidSignalsPreview.setConfig({glow:1.6}); "glow"', 300);
  await step('companions-off', 'VoidSignalsPreview.setConfig({companions:false}); "off"', 400);
  await step('companions-on', 'VoidSignalsPreview.setConfig({companions:true}); "on"', 400);
  await step('boxes-on', 'VoidSignalsPreview.setConfig({showBoxes:true,showCentre:true}); "on"', 400);
  rec.screenshots.push(await shot(VP.name + '-06-diagnostics'));
  await step('boxes-off', 'VoidSignalsPreview.setConfig({showBoxes:false,showCentre:false}); "off"', 300);

  /* reduced motion */
  await step('reduced-motion', 'VoidSignalsPreview.setConfig({reducedMotion:true}); "rm"', 500);
  rec.reducedMotion = await evjs('(function(){var r=document.getElementById("signals-root");var b=document.querySelector(".sig__body");var cs=b?getComputedStyle(b):null;return {rootClass:r.className,animation:cs?cs.animationName:null,transition:getComputedStyle(document.querySelector(".sig")||r).transitionDuration};})()');
  rec.screenshots.push(await shot(VP.name + '-07-reduced-motion'));
  await step('motion-back', 'VoidSignalsPreview.setConfig({reducedMotion:false}); "back"', 300);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(500);
  rec.osReducedMotion = await evjs('(function(){var b=document.querySelector(".sig__body");var cs=b?getComputedStyle(b):null;var s=document.querySelector(".sig");return {animation:cs?cs.animationName:null,transition:s?getComputedStyle(s).transitionDuration:null,matches:matchMedia("(prefers-reduced-motion: reduce)").matches,cfg:VoidSignalsPreview.config.reducedMotion};})()');
  console.log('  os-reduced-motion ' + JSON.stringify(rec.osReducedMotion));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: '' }] });
  await sleep(400);

  /* auto demo, then off */
  await step('auto-on', 'VoidSignalsPreview.setConfig({autoDemo:true}); "on"', 6500);
  rec.autoDemo = await evjs('(function(){var s=VoidSignalsPreview.state;return {signals:s.signals.length,held:s.held.length,spawned:s.counters.spawned};})()');
  await step('auto-off', 'VoidSignalsPreview.setConfig({autoDemo:false}); "off"', 400);

  /* experiment off / on */
  await step('experiment-off', 'VoidSignalsPreview.setConfig({enabled:false}); "off"', 500);
  rec.disabled = await evjs('(function(){return {fieldDisplay:getComputedStyle(document.getElementById("signals-field")).display,signals:VoidSignalsPreview.state.signals.length};})()');
  await step('experiment-on', 'VoidSignalsPreview.setConfig({enabled:true}); "on"', 500);

  /* independent overlap audit: no signal box may touch chrome or the galaxy centre */
  rec.overlapAudit = await evjs(`(function(){
    var api=VoidSignalsPreview, g=api.geometry(), rects=api.chrome();
    var bad=[], centreBad=[], out=[], s=api.state.signals;
    for(var i=0;i<s.length;i++){
      var sig=s[i], half=sig.box/2;
      for(var j=0;j<rects.length;j++){var r=rects[j];
        if(sig.x+half>r.x&&sig.x-half<r.x+r.w&&sig.y+half>r.y&&sig.y-half<r.y+r.h) bad.push({k:sig.k,chrome:r.id});}
      var d=Math.hypot(sig.x-g.cx,sig.y-g.cy);
      if(d-half < api.config.centreGuard*g.scale) centreBad.push({k:sig.k,d:Math.round(d)});
      out.push({k:sig.k,x:Math.round(sig.x),y:Math.round(sig.y),box:Math.round(sig.box),r:Math.round(d)});
    }
    var seek=document.querySelector('.vm-seek');var sb=seek?seek.getBoundingClientRect():null;
    return {signals:out,chromeOverlaps:bad,centreOverlaps:centreBad,seekRect:sb?{x:sb.x,y:sb.y,w:sb.width,h:sb.height}:null,chromeRects:rects.length};
  })()`);
  console.log('  overlap chrome=' + rec.overlapAudit.chromeOverlaps.length + ' centre=' + rec.overlapAudit.centreOverlaps.length);

  /* clean visual: instrument hidden */
  await evjs('(function(){var b=document.querySelector(".signals-instrument__hide");if(b)b.click();return 1;})()');
  await sleep(600);
  rec.screenshots.push(await shot(VP.name + '-08-clean'));
  if (!rec.openedFromTab) await evjs('(function(){var b=document.querySelector(".signals-tab");if(b)b.click();return 1;})()');
  await sleep(400);

  /* reset + randomize + export */
  await step('randomize', 'VoidSignalsPreview.randomize(); "rand"', 600);
  await step('export', 'String(VoidSignalsPreview.exportJSON())', 600);
  await step('final-reset', 'VoidSignalsPreview.reset(); "reset"', 600);
  await step('final-fill', '(function(){for(var i=0;i<10;i++)VoidSignalsPreview.spawn(i%3===0?"important":"ambient");return VoidSignalsPreview.state.signals.length;})()', 1500);
  rec.screenshots.push(await shot(VP.name + '-09-final'));

  /* performance sample from the production renderer, on demand */
  rec.metrics = await evjs('(function(){var m=VoidMusicViz.getMetrics();return {stage:m.stage,fps:m.fps,cpuMs:m.cpuMs,quality:m.quality};})()');
  rec.perfSamples = [];
  for (let i = 0; i < 3; i++) { await sleep(1200); rec.perfSamples.push(await evjs('(function(){var m=VoidMusicViz.getMetrics();return {fps:m.fps,cpuMs:m.cpuMs};})()')); }

  /* isolation evidence */
  rec.network = { total: requests.length, offOrigin: requests.filter(u => u.indexOf(BASE) !== 0 && u.indexOf('data:') !== 0 && u.indexOf('blob:') !== 0) };
  rec.intercepted = await evjs('(window.__VOID_PREVIEW__&&window.__VOID_PREVIEW__.intercepted.length)||0');
  rec.exceptions = exceptions.slice();
  rec.consoleErrors = consoleErrors.slice(0, 20);
  console.log('  network off-origin=' + rec.network.offOrigin.length + ' exceptions=' + rec.exceptions.length + ' consoleErrors=' + rec.consoleErrors.length);
  if (rec.exceptions.length) console.log('   EXC ' + rec.exceptions.slice(0, 3).join(' ;; ').slice(0, 400));
  if (rec.consoleErrors.length) console.log('   CON ' + rec.consoleErrors.slice(0, 3).join(' ;; ').slice(0, 400));
  results.push(rec);
}

const file = join(OUT, 'validation-results-v1.json');
writeFileSync(file, JSON.stringify({ instrument: 'void-signals-phase-b-validation-v1', at: new Date().toISOString(), base: BASE, manifest: { head: manifest.head, branch: manifest.branch, productionFilesModified: manifest.productionFilesModified, productionFilesChecked: manifest.productionFilesChecked }, results }, null, 1));
console.log('\nWROTE ' + file);
console.log('SHOTS ' + results.reduce((n, r) => n + r.screenshots.length, 0));
ws.close(); chrome.kill();
process.exit(0);