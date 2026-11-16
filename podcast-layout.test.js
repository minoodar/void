const assert = require('assert');
const { computeLayout } = require('./podcast-layout.js');
const cases = [[1920,1080],[1366,768],[1280,720],[768,1024],[390,844],[360,640],[320,568],[844,390],[667,375]];
for (const [vw,vh] of cases) {
  const cx=vw/2, cy=vh/2, Ro=Math.min(vw,vh)*.12;
  const l=computeLayout({vw,vh,cx,cy,Ro,R:Math.min(vw,vh)*.37,d0:72,topSafe:56,bottomSafe:vh*.22,sideSafe:Math.max(16,vw*.05),minD:44});
  assert.ok(l.dp>=44, `${vw}x${vh}: podcast hit target`);
  assert.strictEqual(l.pos.flow.x, cx, `${vw}x${vh}: flow axis`);
  assert.strictEqual(l.pos.podcast.x, cx, `${vw}x${vh}: podcast axis`);
  assert.ok(l.pos.inner.y < cy && l.pos.flow.y < cy && l.pos.beyond.y < cy, `${vw}x${vh}: domains above`);
  assert.ok(l.pos.podcast.y > cy, `${vw}x${vh}: podcast below`);
  const ids=['inner','flow','beyond','podcast'];
  const radii={inner:l.d/2,flow:l.d/2,beyond:l.d/2,podcast:l.dp/2};
  for (const id of ids) assert.ok(Math.hypot(l.pos[id].x-cx,l.pos[id].y-cy)>=Ro+radii[id]+7.9, `${vw}x${vh}: orb gap ${id}`);
  for (let i=0;i<ids.length;i++) for(let j=i+1;j<ids.length;j++) assert.ok(Math.hypot(l.pos[ids[i]].x-l.pos[ids[j]].x,l.pos[ids[i]].y-l.pos[ids[j]].y)>=radii[ids[i]]+radii[ids[j]]+7.9, `${vw}x${vh}: overlap`);
}
console.log('podcast-layout: 9 viewport cases passed');
