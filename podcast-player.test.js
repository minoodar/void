/* podcast-player logic — Node tests: resume rewind, queue rules, sleep timer,
   skip clamping, chapter lookup, formatting. Pure helpers only (no DOM). */
'use strict';
const assert = require('assert');
const L = require('./podcast-player.js');
const sample = require('./podcast-sample-data.js');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); checks++; }

/* Resume: 3s rewind, completed restarts, zero/missing stays 0, clamped. */
{
  eq(L.resumePosition(null, 2400), 0, 'resume: no entry -> 0');
  eq(L.resumePosition({ positionSec: 0, completed: false }, 2400), 0, 'resume: zero -> 0');
  eq(L.resumePosition({ positionSec: 1440, completed: false }, 2400), 1437, 'resume: 3s rewind');
  eq(L.resumePosition({ positionSec: 2, completed: false }, 2400), 0, 'resume: never below 0');
  eq(L.resumePosition({ positionSec: 2399, completed: false }, 2400), 2396, 'resume: near end');
  eq(L.resumePosition({ positionSec: 2400, completed: true }, 2400), 0, 'resume: completed restarts');
  eq(L.resumePosition({ positionSec: 5000, completed: false }, 2400), 2400, 'resume: clamped to duration');
  eq(L.resumePosition({ positionSec: NaN, completed: false }, 2400), 0, 'resume: NaN -> 0');
  eq(L.resumePosition({ positionSec: 100, completed: false }, 0), 97, 'resume: unknown duration keeps rewind');
}

/* Queue: from current onward in newest-first order; advance; remove; purity. */
{
  /* Phase 2B.4: the queue is the WHOLE show (feed order, newer first, current
     left in place), so end-of-episode rollover and Previous/Next walk one and
     the same list — index +1 is the next older episode, index -1 the newer one. */
  const eps = sample.episodesOf('show-night-frequencies');
  const q = L.queueFrom(eps, 'nf-03');
  eq(q, ['nf-05', 'nf-04', 'nf-03', 'nf-02', 'nf-01'], 'queue: whole show, current kept in place');
  eq(L.queueFrom(eps, 'nf-05'), q, 'queue: current at the first row keeps the full list');
  eq(L.queueFrom(eps, 'unknown'), ['unknown'], 'queue: unknown id -> single (no bridge to other episodes)');
  eq(L.nextInQueue(q, 'nf-03'), 'nf-02', 'queue: advance (rollover unchanged)');
  eq(L.nextInQueue(q, 'nf-01'), null, 'queue: end -> null');
  eq(L.nextInQueue(q, 'nope'), null, 'queue: missing current -> null');
  eq(L.prevInQueue(q, 'nf-03'), 'nf-04', 'queue: step back to the newer row');
  eq(L.prevInQueue(q, 'nf-05'), null, 'queue: first row has no previous (never wraps)');
  eq(L.prevInQueue(q, 'nope'), null, 'queue: missing current -> no previous');
  eq(L.upcomingFrom(q, 'nf-03'), ['nf-02', 'nf-01'], 'up next: tail after the current row');
  eq(L.upcomingFrom(q, 'nf-05'), ['nf-04', 'nf-03', 'nf-02', 'nf-01'], 'up next: same list as the old queue slice');
  eq(L.upcomingFrom(['unknown'], 'unknown'), [], 'up next: current alone -> empty');
  eq(L.withoutId(q, 'nf-02'), ['nf-05', 'nf-04', 'nf-03', 'nf-01'], 'queue: remove middle');
  eq(L.withoutId(q, 'nf-03'), ['nf-05', 'nf-04', 'nf-02', 'nf-01'], 'queue: remove the current row (it keeps playing)');
  eq(L.nextInQueue(L.withoutId(q, 'nf-03'), 'nf-03'), null, 'queue: current removed -> no advance');
  eq(L.nextInQueue(L.withoutId(q, 'nf-02'), 'nf-03'), 'nf-01', 'queue: a skipped row is skipped on advance too');
  eq(L.prevInQueue(L.withoutId(q, 'nf-04'), 'nf-03'), 'nf-05', 'queue: a skipped row is skipped on step back too');
  eq(q, ['nf-05', 'nf-04', 'nf-03', 'nf-02', 'nf-01'], 'queue: withoutId is pure');
}

/* Sleep: only 15/30/60 minutes or 'end'; deadline math; remaining clamps at 0. */
{
  const now = 1000000;
  eq(L.sleepDeadline(now, 15), now + 15 * 60000, 'sleep: 15 min');
  eq(L.sleepDeadline(now, 30), now + 30 * 60000, 'sleep: 30 min');
  eq(L.sleepDeadline(now, 60), now + 60 * 60000, 'sleep: 60 min');
  eq(L.sleepDeadline(now, '30'), now + 30 * 60000, 'sleep: numeric string accepted');
  eq(L.sleepDeadline(now, 'end'), null, 'sleep: end-of-episode has no deadline');
  eq(L.sleepDeadline(now, 'off'), null, 'sleep: off');
  eq(L.sleepDeadline(now, 45), null, 'sleep: unsupported minutes rejected');
  eq(L.sleepDeadline(now, 0), null, 'sleep: zero rejected');
  eq(L.sleepDeadline(now, -15), null, 'sleep: negative rejected');
  eq(L.sleepRemainingMs(now, now + 90000), 90000, 'sleep: remaining');
  eq(L.sleepRemainingMs(now + 999999, now + 90000), 0, 'sleep: remaining never negative');
  eq(L.sleepRemainingMs(now, null), null, 'sleep: no deadline -> null');
}

/* Skip: -15/+30 clamped to [0, duration]; unknown duration clamps at 0 only. */
{
  eq(L.skipTarget(100, 30, 2400), 130, 'skip: +30');
  eq(L.skipTarget(100, -15, 2400), 85, 'skip: -15');
  eq(L.skipTarget(5, -15, 2400), 0, 'skip: floor at 0');
  eq(L.skipTarget(2390, 30, 2400), 2400, 'skip: ceiling at duration');
  eq(L.skipTarget(100, 30, 0), 130, 'skip: unknown duration still seeks');
  eq(L.skipTarget(NaN, -15, 2400), 0, 'skip: NaN current -> 0');
  eq(L.SKIP_BACK_SEC, 15, 'skip: back constant');
  eq(L.SKIP_FWD_SEC, 30, 'skip: forward constant');
}

/* Chapters: index at position; boundaries; empty. */
{
  const nf04 = sample.EPISODES.filter(e => e.id === 'nf-04')[0];
  const ch = nf04.chapters;
  eq(L.chapterIndexAt(ch, 0), 0, 'chapter: at 0');
  eq(L.chapterIndexAt(ch, 359), 0, 'chapter: just before second');
  eq(L.chapterIndexAt(ch, 360), 1, 'chapter: exact boundary');
  eq(L.chapterIndexAt(ch, 2399), 4, 'chapter: last');
  eq(L.chapterIndexAt([], 10), -1, 'chapter: empty -> -1');
  eq(L.chapterIndexAt(null, 10), -1, 'chapter: null -> -1');
}

/* Formats and rates. */
{
  eq(L.fmtTime(0), '0:00', 'fmt: zero');
  eq(L.fmtTime(65), '1:05', 'fmt: m:ss');
  eq(L.fmtTime(3600), '1:00:00', 'fmt: h:mm:ss');
  eq(L.fmtTime(-5), '0:00', 'fmt: negative clamps');
  eq(L.rateLabel(1), '1\u00D7', 'rate: 1x');
  eq(L.rateLabel(0.75), '0.75\u00D7', 'rate: 0.75x');
  eq(L.RATES, [0.75, 1, 1.25, 1.5, 1.75, 2], 'rate: the six speeds');
  eq(L.SLEEP_MINUTES, [15, 30, 60], 'sleep: the three durations');
}

console.log('podcast-player: ' + checks + ' assertions passed');