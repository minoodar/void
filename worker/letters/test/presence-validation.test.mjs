// Presence validation contract for the letters Worker.
// Imports validatePayload directly, so it runs without the migration files that
// block the phase-a harness. createLetter maps every validatePayload failure to
// HTTP 400 (worker.js: `if (!validated.ok) return json({ ok:false, error:validated.error }, 400, ...)`),
// so a rejected presence below is a 400 invalid_presence response.
//
// Run:
//   ELECTRON_RUN_AS_NODE=1 "C:/Users/minoodar/AppData/Local/Programs/Qoder/Qoder.exe" worker/letters/test/presence-validation.test.mjs

import { validatePayload } from '../worker.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS  ' + name);
  } catch (e) {
    failed++;
    failures.push(name + ': ' + (e && e.message ? e.message : String(e)));
    console.log('FAIL  ' + name + '\n      ' + (e && e.message ? e.message : e));
  }
}

function equal(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'values differ') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

const base = {
  text: 'hello there',
  expiry: '7d',
  request_id: '11111111-1111-4111-8111-111111111111'
};

test('missing presence defaults to none', () => {
  const out = validatePayload({ ...base });
  equal(out.ok, true, 'missing presence must be accepted');
  equal(out.data.presence, 'none');
});

for (const value of ['none', 'human', 'moon', 'root', 'unknown']) {
  test('accepts presence ' + value, () => {
    const out = validatePayload({ ...base, presence: value });
    equal(out.ok, true, value + ' must be accepted');
    equal(out.data.presence, value);
  });
}

const rejected = [
  null,
  '',
  ' ',
  '\t',
  '\n',
  ' human',
  'human ',
  ' human ',
  '\thuman',
  'human\n',
  'human\t',
  'Human',
  'HUMAN',
  'Moon',
  'NONE',
  'dragon',
  'star',
  'none-ish',
  1,
  0,
  true,
  false,
  {},
  []
];

for (const value of rejected) {
  test('rejects presence ' + JSON.stringify(value) + ' as invalid_presence', () => {
    const out = validatePayload({ ...base, presence: value });
    equal(out.ok, false, 'must be rejected');
    equal(out.error, 'invalid_presence', 'error code must be invalid_presence');
  });
}

test('presence never enters the stored body', () => {
  const out = validatePayload({ ...base, presence: 'moon', text: 'hello moon' });
  equal(out.ok, true);
  equal(out.data.text, 'hello moon', 'the body must not carry the presence');
  equal(out.data.presence, 'moon');
});

console.log('\n' + passed + '/' + (passed + failed) + ' checks passed');
if (failed) {
  console.log('FAILURES:');
  for (const f of failures) console.log('- ' + f);
  process.exitCode = 1;
}
